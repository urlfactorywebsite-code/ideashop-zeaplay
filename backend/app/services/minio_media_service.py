"""MinIO-backed media file workflow for presigned uploads."""

from __future__ import annotations

import os
from contextlib import closing
from datetime import datetime
from io import BytesIO
from typing import Optional, Tuple
from uuid import uuid4

try:
    from botocore.exceptions import ClientError
except ModuleNotFoundError:
    class ClientError(Exception):
        """Fallback exception when botocore isn't installed."""

        pass
from fastapi import HTTPException, status
from PIL import Image, ImageOps
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from ..storage.minio import build_media_object_key, get_minio_client, sanitize_filename

try:
    import magic
except Exception:
    magic = None

settings = get_settings()

EXPIRES_IN_SECONDS = 300
DEFAULT_PAGE_SIZE = 24
MAX_PAGE_SIZE = 96

MAX_SIZE_BYTES = {
    "images": 5 * 1024 * 1024,
    "videos": 200 * 1024 * 1024,
    "documents": 20 * 1024 * 1024,
    "zip": 50 * 1024 * 1024,
    "avatar": 5 * 1024 * 1024,
}

ALLOWED_CONTENT_TYPES = {
    "images": {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/svg+xml",
        "image/avif",
    },
    "videos": {
        "video/mp4",
        "video/webm",
        "video/quicktime",
    },
    "documents": {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
    },
    "zip": {
        "application/zip",
        "application/x-zip-compressed",
    },
    "avatar": {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/svg+xml",
        "image/avif",
    },
}

TAB_TO_MEDIA_TYPE = {
    "images": models.MediaFileTypeEnum.IMAGE,
    "videos": models.MediaFileTypeEnum.VIDEO,
    "documents": models.MediaFileTypeEnum.DOCUMENT,
    "zip": models.MediaFileTypeEnum.ZIP,
}

ALLOWED_AVATAR_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
AVATAR_SIZES = (256, 512)
SNIFF_BYTES = 4096

_MAGIC_MIME = None
if magic is not None:
    try:
        _MAGIC_MIME = magic.Magic(mime=True)
    except Exception:
        _MAGIC_MIME = None


def _normalize_content_type(content_type: str) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def _sniff_content_type(data: Optional[bytes]) -> Optional[str]:
    if not data or _MAGIC_MIME is None:
        return None
    try:
        detected = _MAGIC_MIME.from_buffer(data)
    except Exception:
        return None
    return _normalize_content_type(detected)


def _fetch_object_snippet(client, *, bucket: str, object_key: str) -> Optional[bytes]:
    try:
        response = client.get_object(
            Bucket=bucket,
            Key=object_key,
            Range=f"bytes=0-{SNIFF_BYTES - 1}",
        )
    except ClientError:
        return None
    body = response.get("Body")
    if body is None:
        return None
    with closing(body):
        return body.read(SNIFF_BYTES)


def _enforce_sniffed_type(
    *,
    client,
    media_file: models.MediaFile,
) -> None:
    if media_file.media_type not in {
        models.MediaFileTypeEnum.IMAGE,
        models.MediaFileTypeEnum.VIDEO,
        models.MediaFileTypeEnum.AVATAR,
    }:
        return

    tab_key = "images"
    if media_file.media_type == models.MediaFileTypeEnum.VIDEO:
        tab_key = "videos"
    elif media_file.media_type == models.MediaFileTypeEnum.AVATAR:
        tab_key = "avatar"

    snippet = _fetch_object_snippet(client, bucket=media_file.bucket, object_key=media_file.object_key)
    sniffed = _sniff_content_type(snippet)
    if not sniffed or sniffed == "application/octet-stream":
        return

    allowed_types = ALLOWED_CONTENT_TYPES.get(tab_key, set())
    if sniffed not in allowed_types:
        allowed_label = ", ".join(sorted(allowed_types))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Detected content_type {sniffed} is not allowed. Allowed: {allowed_label}",
        )

    if media_file.content_type != sniffed:
        media_file.content_type = sniffed


def _truncate_filename(filename: str, *, max_length: int = 255) -> str:
    if len(filename) <= max_length:
        return filename
    base, ext = os.path.splitext(filename)
    keep = max_length - len(ext)
    if keep <= 0:
        return filename[:max_length]
    return f"{base[:keep]}{ext}"


def _require_bucket() -> str:
    bucket = settings.minio_bucket_attachments
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MinIO bucket is not configured",
        )
    return bucket


def _get_minio_client():
    try:
        return get_minio_client()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


def _validate_upload(
    *,
    purpose: str,
    tab: Optional[str],
    content_type: str,
    size_bytes: int,
) -> Tuple[models.MediaFileTypeEnum, str]:
    normalized_type = _normalize_content_type(content_type)
    if not normalized_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_type is required")
    if size_bytes <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="size_bytes must be greater than 0")

    if purpose == "library":
        normalized_tab = (tab or "").lower()
        if not normalized_tab:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tab is required for library uploads")
        media_type = TAB_TO_MEDIA_TYPE.get(normalized_tab)
        if not media_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported media tab")
        allowed_types = ALLOWED_CONTENT_TYPES.get(normalized_tab, set())
        max_size = MAX_SIZE_BYTES.get(normalized_tab, MAX_SIZE_BYTES["images"])
    elif purpose == "avatar":
        media_type = models.MediaFileTypeEnum.AVATAR
        allowed_types = ALLOWED_CONTENT_TYPES["avatar"]
        max_size = MAX_SIZE_BYTES["avatar"]
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid purpose")

    if normalized_type not in allowed_types:
        allowed_label = ", ".join(sorted(allowed_types))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported content_type. Allowed: {allowed_label}",
        )

    if size_bytes > max_size:
        max_mb = int(max_size / (1024 * 1024))
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds max size of {max_mb}MB",
        )

    return media_type, normalized_type


def _build_avatar_key(*, user_id: str, filename: str, now: Optional[datetime] = None) -> str:
    timestamp = now or datetime.utcnow()
    safe_name = sanitize_filename(filename)
    return f"avatars/{user_id}/{timestamp:%Y}/{timestamp:%m}/{uuid4().hex}_{safe_name}"


def _ensure_media_file_tenant(media_file: models.MediaFile, user: models.User) -> None:
    if not media_file.owner or media_file.owner.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")


def _generate_presigned_put(bucket: str, object_key: str, content_type: str) -> str:
    client = _get_minio_client()
    try:
        return client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": object_key, "ContentType": content_type},
            ExpiresIn=EXPIRES_IN_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload URL",
        ) from exc


def generate_presigned_get(bucket: str, object_key: str) -> str:
    client = _get_minio_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": object_key},
            ExpiresIn=EXPIRES_IN_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate read URL",
        ) from exc


def presign_media_upload(
    db: Session,
    *,
    user: models.User,
    purpose: str,
    tab: Optional[str],
    file_name: str,
    content_type: str,
    size_bytes: int,
) -> Tuple[models.MediaFile, str, int]:
    media_type, normalized_type = _validate_upload(
        purpose=purpose,
        tab=tab,
        content_type=content_type,
        size_bytes=size_bytes,
    )

    safe_filename = sanitize_filename(file_name)
    safe_filename = _truncate_filename(safe_filename)
    if not safe_filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file_name")

    bucket = _require_bucket()

    if purpose == "avatar":
        object_key = _build_avatar_key(user_id=user.id, filename=safe_filename)
    else:
        workspace = user.employer_id or "global"
        object_key = build_media_object_key(
            workspace=workspace,
            department_id=user.department_id,
            user_id=user.id,
            media_type=media_type.value,
            filename=safe_filename,
        )

    media_file = models.MediaFile(
        user_id=user.id,
        department_id=user.department_id,
        media_type=media_type,
        bucket=bucket,
        object_key=object_key,
        original_filename=safe_filename,
        content_type=normalized_type,
        size_bytes=size_bytes,
        status=models.MediaFileStatusEnum.PENDING,
    )
    db.add(media_file)
    db.commit()
    db.refresh(media_file)

    upload_url = _generate_presigned_put(bucket, object_key, normalized_type)
    return media_file, upload_url, EXPIRES_IN_SECONDS


def confirm_media_upload(
    db: Session,
    *,
    user: models.User,
    file_id: str,
    crop_metadata: Optional[dict] = None,
) -> models.MediaFile:
    media_file = db.get(models.MediaFile, file_id)
    if not media_file or media_file.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")
    _ensure_media_file_tenant(media_file, user)

    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER} and media_file.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to confirm this upload")

    client = _get_minio_client()
    try:
        client.head_object(Bucket=media_file.bucket, Key=media_file.object_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded object not found") from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to verify uploaded object",
        ) from exc

    _enforce_sniffed_type(client=client, media_file=media_file)

    if crop_metadata and media_file.media_type != models.MediaFileTypeEnum.AVATAR:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Crop metadata is only allowed for avatars")

    if media_file.media_type == models.MediaFileTypeEnum.AVATAR and crop_metadata:
        media_file.crop_metadata = crop_metadata

    media_file.status = models.MediaFileStatusEnum.CONFIRMED
    db.add(media_file)
    db.commit()
    db.refresh(media_file)
    return media_file


def list_media_files(
    db: Session,
    *,
    user: models.User,
    tab: str,
    search: Optional[str],
    from_date: Optional[datetime],
    to_date: Optional[datetime],
    page: int,
    page_size: int,
) -> Tuple[list[models.MediaFile], int]:
    normalized_tab = (tab or "").lower()
    media_type = TAB_TO_MEDIA_TYPE.get(normalized_tab)
    if not media_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported media tab")

    page = max(1, page)
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))

    query = db.query(models.MediaFile).filter(models.MediaFile.deleted_at.is_(None))
    query = query.filter(models.MediaFile.owner.has(models.User.tenant_id == user.tenant_id))
    query = query.filter(models.MediaFile.media_type == media_type)
    query = query.filter(models.MediaFile.status == models.MediaFileStatusEnum.CONFIRMED)

    if user.role == models.RoleEnum.MANAGER:
        if user.department_id:
            query = query.filter(models.MediaFile.department_id == user.department_id)
        else:
            query = query.filter(models.MediaFile.user_id == user.id)
    elif user.role == models.RoleEnum.USER:
        query = query.filter(models.MediaFile.user_id == user.id)

    if search:
        query = query.filter(models.MediaFile.original_filename.ilike(f"%{search}%"))
    if from_date:
        query = query.filter(models.MediaFile.created_at >= from_date)
    if to_date:
        query = query.filter(models.MediaFile.created_at <= to_date)

    total = query.count()
    items = (
        query.order_by(desc(models.MediaFile.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total


def delete_media_file(db: Session, *, media_file: models.MediaFile) -> None:
    client = _get_minio_client()
    try:
        client.delete_object(Bucket=media_file.bucket, Key=media_file.object_key)
    except ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to delete object from storage",
        ) from exc

    media_file.deleted_at = datetime.utcnow()
    db.add(media_file)
    db.commit()


def _load_avatar_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image data") from exc

    image_format = (image.format or "").upper()
    if image_format not in ALLOWED_AVATAR_FORMATS:
        allowed_label = ", ".join(sorted(ALLOWED_AVATAR_FORMATS))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image format. Allowed: {allowed_label}",
        )
    return image


def _apply_crop(image: Image.Image, crop: dict) -> Image.Image:
    left = max(0, int(round(crop.get("x", 0))))
    top = max(0, int(round(crop.get("y", 0))))
    width = max(1, int(round(crop.get("width", image.width))))
    height = max(1, int(round(crop.get("height", image.height))))
    right = min(image.width, left + width)
    bottom = min(image.height, top + height)
    if right <= left or bottom <= top:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid crop area")
    return image.crop((left, top, right, bottom))


def _encode_webp(image: Image.Image, *, quality: int = 90) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def _public_object_url(bucket: str, object_key: str) -> str:
    base = settings.minio_public_base.rstrip("/")
    return f"{base}/{bucket}/{object_key}"


def finalize_avatar_upload(
    db: Session,
    *,
    user: models.User,
    file_id: str,
    crop_metadata: dict,
    delete_original: bool = True,
) -> tuple[models.MediaFile, str, str]:
    media_file = db.get(models.MediaFile, file_id)
    if not media_file or media_file.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")
    if media_file.media_type != models.MediaFileTypeEnum.AVATAR:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Media file is not an avatar upload")
    if media_file.status != models.MediaFileStatusEnum.CONFIRMED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar upload must be confirmed first")
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER} and media_file.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to finalize this avatar")

    client = _get_minio_client()
    try:
        response = client.get_object(Bucket=media_file.bucket, Key=media_file.object_key)
        raw_bytes = response["Body"].read()
    except ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to download avatar upload",
        ) from exc

    image = _load_avatar_image(raw_bytes)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    cropped = _apply_crop(image, crop_metadata)

    avatar_key = f"avatars/{media_file.user_id}/avatar.webp"
    preview_key = f"avatars/{media_file.user_id}/avatar_256.webp"

    for size in AVATAR_SIZES:
        resized = ImageOps.fit(cropped, (size, size), method=Image.Resampling.LANCZOS)
        encoded = _encode_webp(resized)
        target_key = avatar_key if size == 512 else preview_key
        try:
            client.put_object(
                Bucket=media_file.bucket,
                Key=target_key,
                Body=encoded,
                ContentType="image/webp",
            )
        except ClientError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to upload processed avatar",
            ) from exc

    media_file.crop_metadata = crop_metadata
    db.add(media_file)

    profile_url = _public_object_url(media_file.bucket, avatar_key)
    user.profile_image_key = avatar_key
    user.profile_image_url = profile_url
    db.add(user)
    db.commit()
    db.refresh(media_file)
    db.refresh(user)

    if delete_original:
        try:
            client.delete_object(Bucket=media_file.bucket, Key=media_file.object_key)
        except ClientError:
            pass

    return media_file, avatar_key, profile_url
