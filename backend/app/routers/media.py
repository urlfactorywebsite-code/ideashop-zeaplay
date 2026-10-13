"""Media Library API routes."""

from __future__ import annotations

from datetime import datetime
import html
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from sqlalchemy.orm import Session

from .. import models, schemas, rate_limit
from ..auth import create_access_token, decode_token
from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import media_service, minio_media_service

router = APIRouter(prefix="/media", tags=["media"])
settings = get_settings()

GOOGLE_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_OAUTH_STATE_MINUTES = 10
GOOGLE_OAUTH_MESSAGE_TYPE = "zea-play:gdrive-oauth"


def _parse_category(value: Optional[str]) -> Optional[models.MediaCategoryEnum]:
    if not value:
        return None
    try:
        return models.MediaCategoryEnum(value)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid media category")


def _require_storage_admin(user: models.User) -> None:
    if user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage provider status requires admin access")


def _gdrive_folder_id() -> str | None:
    return settings.google_drive_folder_id or settings.gdrive_parent_folder_id


def _configured(value: str | None) -> bool:
    if not value:
        return False
    normalized = value.strip().lower()
    if not normalized:
        return False
    return not (
        "your-" in normalized
        or "your_" in normalized
        or normalized in {"change_me", "changeme", "placeholder"}
    )


def _has_gdrive_service_account_config() -> bool:
    return bool(
        _configured(_gdrive_folder_id())
        and (
            _configured(settings.google_service_account_json_path)
            or _configured(settings.gdrive_service_account_json_path)
            or (_configured(settings.google_client_email) and _configured(settings.google_private_key))
        )
    )


def _gdrive_oauth_config() -> dict:
    return {
        "web": {
            "client_id": settings.google_client_id or "",
            "client_secret": settings.google_client_secret or "",
            "auth_uri": GOOGLE_AUTH_URI,
            "token_uri": GOOGLE_TOKEN_URI,
            "redirect_uris": [settings.google_redirect_uri] if settings.google_redirect_uri else [],
        }
    }


def _gdrive_oauth_missing_detail() -> str | None:
    missing = []
    if not _configured(settings.google_client_id):
        missing.append("GOOGLE_CLIENT_ID")
    if not _configured(settings.google_client_secret):
        missing.append("GOOGLE_CLIENT_SECRET")
    if not _configured(_gdrive_folder_id()):
        missing.append("GOOGLE_DRIVE_FOLDER_ID")
    if missing:
        return f"Missing Google Drive OAuth config: {', '.join(missing)}"
    return None


def _gdrive_redirect_uri(request: Request) -> str:
    if settings.google_redirect_uri:
        return settings.google_redirect_uri
    callback_path = request.url.path.rstrip("/")
    if callback_path.endswith("/start"):
        callback_path = callback_path[: -len("/start")] + "/callback"
    return f"{str(request.base_url).rstrip('/')}{callback_path}"


def _build_gdrive_flow(request: Request) -> Flow:
    redirect_uri = _gdrive_redirect_uri(request)
    client_config = _gdrive_oauth_config()
    client_config["web"]["redirect_uris"] = [redirect_uri]
    if redirect_uri.startswith("http://"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    return Flow.from_client_config(
        client_config,
        scopes=GOOGLE_DRIVE_SCOPES,
        redirect_uri=redirect_uri,
    )


def _stored_gdrive_credential(
    db: Session,
    tenant_id,
) -> models.ExternalStorageOAuthCredential | None:
    return (
        db.query(models.ExternalStorageOAuthCredential)
        .filter(
            models.ExternalStorageOAuthCredential.tenant_id == tenant_id,
            models.ExternalStorageOAuthCredential.provider == models.StorageProviderEnum.GDRIVE,
        )
        .one_or_none()
    )


def _credentials_from_record(record: models.ExternalStorageOAuthCredential) -> Credentials:
    return Credentials(
        token=record.access_token,
        refresh_token=record.refresh_token,
        token_uri=record.token_uri or GOOGLE_TOKEN_URI,
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=record.scopes or GOOGLE_DRIVE_SCOPES,
    )


def _sync_credential_refresh(
    db: Session,
    record: models.ExternalStorageOAuthCredential,
    credentials: Credentials,
) -> None:
    if credentials.token and credentials.token != record.access_token:
        record.access_token = credentials.token
    if credentials.refresh_token:
        record.refresh_token = credentials.refresh_token
    if credentials.expiry:
        record.expires_at = credentials.expiry.replace(tzinfo=None)
    record.updated_at = datetime.utcnow()
    db.commit()


def _gdrive_oauth_status(
    db: Session,
    user: models.User,
) -> schemas.MediaProviderStatusResponse | None:
    missing_detail = _gdrive_oauth_missing_detail()
    record = _stored_gdrive_credential(db, user.tenant_id)
    if not record:
        if missing_detail:
            return schemas.MediaProviderStatusResponse(
                provider=models.StorageProviderEnum.GDRIVE,
                status="missing_env",
                details=missing_detail,
            )
        return schemas.MediaProviderStatusResponse(
            provider=models.StorageProviderEnum.GDRIVE,
            status="missing_env",
            details="Google Drive is configured, but no Google account is connected. Click Connect to sign in.",
        )
    try:
        credentials = _credentials_from_record(record)
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(GoogleAuthRequest())
            _sync_credential_refresh(db, record, credentials)
        service = build("drive", "v3", credentials=credentials)
        folder_id = _gdrive_folder_id()
        if folder_id:
            service.files().get(fileId=folder_id, fields="id,name").execute()
        else:
            service.files().list(pageSize=1, fields="files(id)").execute()
        account = f" as {record.provider_account_email}" if record.provider_account_email else ""
        return schemas.MediaProviderStatusResponse(
            provider=models.StorageProviderEnum.GDRIVE,
            status="connected",
            details=f"Google Drive connected{account}.",
        )
    except Exception as exc:
        return schemas.MediaProviderStatusResponse(
            provider=models.StorageProviderEnum.GDRIVE,
            status="error",
            details=f"Google Drive connection failed: {exc}",
        )


def _oauth_popup_html(status_label: str, message: str) -> HTMLResponse:
    escaped_status = status_label.replace("\\", "\\\\").replace('"', '\\"')
    escaped_message = message.replace("\\", "\\\\").replace('"', '\\"')
    html_message = html.escape(message)
    return HTMLResponse(
        f"""
<!doctype html>
<html>
  <head><title>Google Drive Connection</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px;">
    <h1>Google Drive</h1>
    <p>{html_message}</p>
    <script>
      if (window.opener) {{
        window.opener.postMessage({{
          type: "{GOOGLE_OAUTH_MESSAGE_TYPE}",
          status: "{escaped_status}",
          message: "{escaped_message}"
        }}, "*");
      }}
      window.close();
    </script>
  </body>
</html>
""",
        status_code=status.HTTP_200_OK,
    )


@router.post("/presign", response_model=schemas.MediaPresignResponse)
def presign_media_upload(
    payload: schemas.MediaPresignRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.MediaPresignResponse:
    rate_limit.enforce_presign_rate_limit(current_user.id)
    media_file, upload_url, expires_in = minio_media_service.presign_media_upload(
        db,
        user=current_user,
        purpose=payload.purpose,
        tab=payload.tab,
        file_name=payload.file_name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
    )
    return schemas.MediaPresignResponse(
        upload_url=upload_url,
        bucket=media_file.bucket,
        object_key=media_file.object_key,
        file_id=media_file.id,
        expires_in=expires_in,
    )


@router.post("/confirm", response_model=schemas.MediaConfirmResponse)
def confirm_media_upload(
    payload: schemas.MediaConfirmRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.MediaConfirmResponse:
    crop_metadata = payload.crop.model_dump() if payload.crop else None
    media_file = minio_media_service.confirm_media_upload(
        db,
        user=current_user,
        file_id=payload.file_id,
        crop_metadata=crop_metadata,
    )
    return schemas.MediaConfirmResponse(file_id=media_file.id, status=media_file.status.value)


@router.post("/avatar/finalize", response_model=schemas.AvatarFinalizeResponse)
def finalize_avatar_upload(
    payload: schemas.AvatarFinalizeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.AvatarFinalizeResponse:
    media_file, avatar_key, profile_url = minio_media_service.finalize_avatar_upload(
        db,
        user=current_user,
        file_id=payload.file_id,
        crop_metadata=payload.crop.model_dump(),
    )
    return schemas.AvatarFinalizeResponse(
        file_id=media_file.id,
        profile_image_key=avatar_key,
        profile_image_url=profile_url,
    )


@router.get("/list", response_model=schemas.MediaFileListResponse)
def list_media_files(
    tab: str = Query(...),
    search: Optional[str] = Query(default=None, max_length=255),
    from_date: Optional[datetime] = Query(default=None),
    to_date: Optional[datetime] = Query(default=None),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=96),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.MediaFileListResponse:
    items, total = minio_media_service.list_media_files(
        db,
        user=current_user,
        tab=tab,
        search=search,
        from_date=from_date,
        to_date=to_date,
        page=page,
        page_size=page_size,
    )
    response_items = [
        schemas.MediaFileListItem(
            id=item.id,
            original_filename=item.original_filename,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            created_at=item.created_at,
            read_url=minio_media_service.generate_presigned_get(item.bucket, item.object_key),
        )
        for item in items
    ]
    return schemas.MediaFileListResponse(
        items=response_items,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "/upload",
    response_model=schemas.MediaItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_media(
    file: UploadFile = File(...),
    category: Optional[str] = Form(default=None),
    original_id: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    category_enum = _parse_category(category)
    item = await media_service.create_media_item(
        db,
        owner=current_user,
        upload=file,
        category=category_enum,
        original_id=original_id,
    )
    return item


@router.get("", response_model=schemas.MediaListResponse)
def list_media(
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=96),
    q: Optional[str] = Query(default=None, max_length=255),
    category: Optional[models.MediaCategoryEnum] = Query(default=None),
    sort: schemas.MediaSortOption = Query(default=schemas.MediaSortOption.CREATED_DESC),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    owner_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    items, total = media_service.list_media_items(
        db,
        user=current_user,
        page=page,
        page_size=page_size,
        q=q,
        category=category,
        sort=sort.value,
        date_from=date_from,
        date_to=date_to,
        owner_id=owner_id,
    )
    return schemas.MediaListResponse(items=items, page=page, page_size=page_size, total=total)


@router.get("/{media_id}", response_model=schemas.MediaItemRead)
def get_media(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return media_service.get_media_item(db, media_id=media_id, user=current_user)


@router.patch("/{media_id}", response_model=schemas.MediaItemRead)
def rename_media(
    media_id: str,
    payload: schemas.MediaUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    if not payload.filename:
        return media_service.get_media_item(db, media_id=media_id, user=current_user)
    return media_service.rename_media_item(
        db,
        media_id=media_id,
        user=current_user,
        filename=payload.filename,
    )


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(
    media_id: str,
    hard: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    media_file = db.get(models.MediaFile, media_id)
    if media_file:
        if media_file.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")
        if not media_file.owner or media_file.owner.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")
        if current_user.role != models.RoleEnum.OWNER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner privileges required")
        minio_media_service.delete_media_file(db, media_file=media_file)
        return
    media_service.delete_media_item(db, media_id=media_id, user=current_user, hard=hard)


@router.post("/{media_id}/replace", response_model=schemas.MediaItemRead)
async def replace_media(
    media_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return await media_service.replace_media_item(
        db,
        media_id=media_id,
        user=current_user,
        upload=file,
    )


@router.post("/external/connect", response_model=schemas.MediaProviderStatusResponse)
def connect_provider(
    payload: schemas.MediaProviderConnectRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _require_storage_admin(current_user)
    if payload.provider == models.StorageProviderEnum.GDRIVE:
        has_oauth_record = _stored_gdrive_credential(db, current_user.tenant_id) is not None
        if has_oauth_record or not _has_gdrive_service_account_config():
            oauth_status = _gdrive_oauth_status(db, current_user)
            return oauth_status
    adapter = media_service.get_adapter(payload.provider)
    health = adapter.health()
    if not adapter.is_configured:
        status_label = "missing_env"
    else:
        status_label = "connected" if health.ok else "error"
    return schemas.MediaProviderStatusResponse(
        provider=payload.provider,
        status=status_label,
        details=health.details,
    )


@router.get("/external/gdrive/oauth/start", response_model=schemas.GoogleDriveOAuthStartResponse)
def start_google_drive_oauth(
    request: Request,
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.GoogleDriveOAuthStartResponse:
    _require_storage_admin(current_user)
    missing_detail = _gdrive_oauth_missing_detail()
    if missing_detail:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=missing_detail)
    flow = _build_gdrive_flow(request)
    state_token = create_access_token(
        current_user.id,
        expires_minutes=GOOGLE_OAUTH_STATE_MINUTES,
        extra_claims={
            "purpose": "gdrive_oauth",
            "tenant_id": str(current_user.tenant_id),
        },
    )
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state_token,
    )
    return schemas.GoogleDriveOAuthStartResponse(
        authorization_url=authorization_url,
        expires_in=GOOGLE_OAUTH_STATE_MINUTES * 60,
    )


@router.get("/external/gdrive/oauth/callback", response_class=HTMLResponse)
def google_drive_oauth_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        return _oauth_popup_html("error", f"Google Drive authorization failed: {error}")
    if not code or not state:
        return _oauth_popup_html("error", "Google Drive authorization did not return the required code.")
    try:
        state_payload = decode_token(state)
    except ValueError:
        return _oauth_popup_html("error", "Google Drive authorization session expired. Try connecting again.")
    if getattr(state_payload, "purpose", None) != "gdrive_oauth":
        return _oauth_popup_html("error", "Google Drive authorization state is invalid.")

    tenant_id = getattr(state_payload, "tenant_id", None)
    user = db.get(models.User, state_payload.sub)
    if not user or str(user.tenant_id) != str(tenant_id) or user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN}:
        return _oauth_popup_html("error", "Google Drive authorization is not allowed for this user.")

    try:
        flow = _build_gdrive_flow(request)
        flow.fetch_token(code=code)
        credentials = flow.credentials
        service = build("drive", "v3", credentials=credentials)
        provider_email: str | None = None
        try:
            about = service.about().get(fields="user(emailAddress)").execute()
            provider_email = about.get("user", {}).get("emailAddress")
        except Exception:
            provider_email = None
        folder_id = _gdrive_folder_id()
        if folder_id:
            service.files().get(fileId=folder_id, fields="id,name").execute()

        credential = _stored_gdrive_credential(db, user.tenant_id)
        if not credential:
            credential = models.ExternalStorageOAuthCredential(
                tenant_id=user.tenant_id,
                provider=models.StorageProviderEnum.GDRIVE,
                connected_by_id=user.id,
                access_token=credentials.token or "",
                refresh_token=credentials.refresh_token,
                token_uri=credentials.token_uri or GOOGLE_TOKEN_URI,
                scopes=list(credentials.scopes or GOOGLE_DRIVE_SCOPES),
                provider_account_email=provider_email,
                expires_at=credentials.expiry.replace(tzinfo=None) if credentials.expiry else None,
            )
            db.add(credential)
        else:
            credential.connected_by_id = user.id
            credential.access_token = credentials.token or credential.access_token
            if credentials.refresh_token:
                credential.refresh_token = credentials.refresh_token
            credential.token_uri = credentials.token_uri or GOOGLE_TOKEN_URI
            credential.scopes = list(credentials.scopes or GOOGLE_DRIVE_SCOPES)
            credential.provider_account_email = provider_email or credential.provider_account_email
            credential.expires_at = credentials.expiry.replace(tzinfo=None) if credentials.expiry else credential.expires_at
            credential.updated_at = datetime.utcnow()
        db.commit()
        return _oauth_popup_html("connected", "Google Drive connected successfully. You can close this window.")
    except Exception as exc:
        db.rollback()
        return _oauth_popup_html("error", f"Google Drive authorization failed: {exc}")


@router.post("/bulk-delete", response_model=schemas.MediaBulkDeleteResponse)
def bulk_delete_media(
    payload: schemas.MediaBulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    deleted = media_service.bulk_delete_media(
        db,
        user=current_user,
        media_ids=payload.ids,
        hard=payload.hard,
    )
    return schemas.MediaBulkDeleteResponse(deleted=deleted)
