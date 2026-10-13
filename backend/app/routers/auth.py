from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from ..dependencies import get_current_active_user
from ..database import get_db
from ..config import get_settings
from ..services import audit_logger

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _derive_tenant_id(employer_id: Optional[str]) -> uuid.UUID:
    if not employer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="employer_id is required to register a tenant-scoped user",
        )
    try:
        return uuid.UUID(str(employer_id))
    except ValueError:
        return uuid.uuid5(uuid.NAMESPACE_URL, f"zea-play-tenant:{employer_id}")


def _build_token_claims(user: models.User) -> dict[str, object]:
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is missing tenant assignment",
        )
    return {
        "tenant_id": str(user.tenant_id),
        "roles": [user.role.value],
    }


@router.post("/register", response_model=schemas.AuthResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: schemas.UserCreate, db: Session = Depends(get_db)) -> schemas.AuthResponse:
    existing_user = db.execute(select(models.User).where(models.User.email == payload.email)).scalar_one_or_none()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    tenant_id = _derive_tenant_id(payload.employer_id)
    user = models.User(
        tenant_id=tenant_id,
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        status=payload.status,
        department_id=payload.department_id,
        employer_id=payload.employer_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_REGISTERED",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(user.id),
            actor_role=user.role.value if user.role else None,
            target_user_id=str(user.id),
            entity_type="user",
            entity_id=str(user.id),
            source=models.AuditLogSourceEnum.API,
            metadata={"email": user.email},
        )
    )

    claims = _build_token_claims(user)
    token = schemas.Token(
        access_token=create_access_token(user.id, extra_claims=claims),
        refresh_token=create_refresh_token(user.id, extra_claims=claims),
    )
    return schemas.AuthResponse(token=token, user=user)


async def _extract_credentials(request: Request) -> tuple[str, str]:
    content_type = (request.headers.get("content-type") or "").lower()
    username: Optional[str] = None
    password: Optional[str] = None

    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        username = form.get("username") or form.get("email")
        password = form.get("password")
    else:
        try:
            body = await request.json()
        except Exception:  # JSON decode error or empty body
            body = {}
        if isinstance(body, dict):
            username = body.get("email") or body.get("username")
            password = body.get("password")

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email/username and password are required",
        )

    return username, password


@router.post("/login", response_model=schemas.AuthResponse)
async def login(request: Request, db: Session = Depends(get_db)) -> schemas.AuthResponse:
    username, password = await _extract_credentials(request)
    user = db.execute(select(models.User).where(models.User.email == username)).scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="USER_LOGIN_FAILED",
                category=models.AuditLogCategoryEnum.SECURITY,
                actor_id=str(user.id) if user else None,
                actor_role=user.role.value if user and user.role else None,
                target_user_id=str(user.id) if user else None,
                entity_type="user",
                entity_id=str(user.id) if user else None,
                source=models.AuditLogSourceEnum.MANUAL,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason="Invalid credentials",
                metadata={"email": username},
                request=request,
            )
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if user.status != models.UserStatusEnum.ACTIVE:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="USER_LOGIN_BLOCKED",
                category=models.AuditLogCategoryEnum.SECURITY,
                actor_id=str(user.id),
                actor_role=user.role.value if user.role else None,
                target_user_id=str(user.id),
                entity_type="user",
                entity_id=str(user.id),
                source=models.AuditLogSourceEnum.MANUAL,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason="Account deactivated",
                request=request,
            )
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is deactivated")

    extra_claims = _build_token_claims(user)
    token = schemas.Token(
        access_token=create_access_token(user.id, extra_claims=extra_claims),
        refresh_token=create_refresh_token(user.id, extra_claims=extra_claims),
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_LOGIN",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(user.id),
            actor_role=user.role.value if user.role else None,
            target_user_id=str(user.id),
            entity_type="user",
            entity_id=str(user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            request=request,
        )
    )
    return schemas.AuthResponse(token=token, user=user)


@router.post("/refresh", response_model=schemas.Token)
def refresh_token(
    payload: schemas.RefreshRequest,
    db: Session = Depends(get_db),
) -> schemas.Token:
    from ..auth import decode_token

    try:
        token_payload = decode_token(payload.refresh_token, refresh=True)
    except ValueError as exc:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TOKEN_REFRESH_FAILED",
                category=models.AuditLogCategoryEnum.SECURITY,
                source=models.AuditLogSourceEnum.API,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason="Invalid refresh token",
            )
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    user = db.get(models.User, token_payload.sub)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    extra_claims = _build_token_claims(user)
    return schemas.Token(
        access_token=create_access_token(user.id, extra_claims=extra_claims),
        refresh_token=create_refresh_token(user.id, extra_claims=extra_claims),
    )


@router.get("/me", response_model=schemas.UserRead)
def get_me(current_user=Depends(get_current_active_user)):
    return current_user


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: schemas.LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Mock password reset - in production integrate with email service."""
    user = db.execute(select(models.User).where(models.User.email == payload.email)).scalar_one_or_none()
    # Intentionally do not reveal whether user exists
    if user and user.status == models.UserStatusEnum.ACTIVE:
        # TODO: integrate with email service
        pass
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_PASSWORD_RESET_REQUESTED",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(user.id) if user else None,
            actor_role=user.role.value if user and user.role else None,
            target_user_id=str(user.id) if user else None,
            entity_type="user",
            entity_id=str(user.id) if user else None,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"email": payload.email},
            request=request,
        )
    )
    return {"message": "If an account exists, reset instructions have been sent."}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_LOGOUT",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            target_user_id=str(current_user.id),
            entity_type="user",
            entity_id=str(current_user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            request=request,
        )
    )


@router.post("/generate-token", response_model=schemas.TokenMintResponse)
def generate_scoped_token(
    payload: schemas.TokenMintRequest,
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TokenMintResponse:
    """Issue an access token for the current user with optional custom scopes."""
    normalized_scopes = sorted(set(payload.scopes))
    expires_minutes = payload.expires_in_minutes or settings.access_token_expire_minutes
    extra_claims = _build_token_claims(current_user)
    access_token = create_access_token(
        current_user.id,
        expires_minutes=expires_minutes,
        scopes=normalized_scopes or None,
        extra_claims=extra_claims,
    )
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=expires_minutes)
    return schemas.TokenMintResponse(
        access_token=access_token,
        token_type="bearer",
        scopes=normalized_scopes,
        issued_at=issued_at,
        expires_at=expires_at,
        subject=current_user.id,
        label=payload.label or current_user.name,
    )


@router.get("/presence-token", response_model=schemas.TokenMintResponse)
def issue_presence_token(
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TokenMintResponse:
    """Issue a short-lived token for the presence socket."""
    expires_minutes = 60
    extra_claims = _build_token_claims(current_user)
    access_token = create_access_token(
        current_user.id,
        expires_minutes=expires_minutes,
        scopes=["presence"],
        extra_claims=extra_claims,
    )
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=expires_minutes)
    return schemas.TokenMintResponse(
        access_token=access_token,
        token_type="bearer",
        scopes=["presence"],
        issued_at=issued_at,
        expires_at=expires_at,
        subject=current_user.id,
        label="Presence socket",
    )
