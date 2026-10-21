"""Common FastAPI dependencies."""

import uuid
from typing import Any, Iterable

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .auth import credentials_match, oauth2_scheme
from .config import get_settings
from .database import get_db
from .models import RoleEnum, User, UserStatusEnum
from .lifecycle.context import bind_actor

settings = get_settings()


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    token_type = payload.get("token_type")
    if token_type and token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def _extract_user_id(payload: dict[str, Any]) -> str:
    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user identifier",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return str(user_id)


def _normalize_roles(raw_roles: Any) -> list[str]:
    if raw_roles is None:
        return []
    if isinstance(raw_roles, str):
        return [raw_roles]
    if isinstance(raw_roles, Iterable):
        return [str(role) for role in raw_roles]
    return []


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Return the authenticated user from the JWT bearer token."""
    if token.startswith('zoa_'):
        from .services.oauth import delegated_user
        user = delegated_user(db, token, request)
        from .services.navigation import enforce_request
        enforce_request(db, user, request.url.path, request.method)
        return user
    payload = _decode_access_token(token)
    user_id = _extract_user_id(payload)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not credentials_match(user, payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credentials changed. Please sign in again.")

    token_tenant = payload.get("tenant_id")
    if not token_tenant:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing tenant identifier")
    try:
        token_tenant_uuid = uuid.UUID(str(token_tenant))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid tenant identifier") from exc
    if not user.tenant_id or user.tenant_id != token_tenant_uuid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tenant mismatch")

    bind_actor(db, user)
    from .services.navigation import enforce_request
    enforce_request(db, user, request.url.path, request.method)
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.status != UserStatusEnum.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")
    return current_user


async def get_current_admin(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role not in {RoleEnum.ADMIN, RoleEnum.MANAGER, RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user


def ensure_user_admin_scope(actor: User, target: User | None = None, new_role: RoleEnum | None = None) -> None:
    """Account management must not grant authority above the authenticated actor."""
    if actor.role == RoleEnum.OWNER:
        return
    if actor.role not in {RoleEnum.ADMIN, RoleEnum.MANAGER}:
        raise HTTPException(403, 'Administrative privileges required.')
    protected = {RoleEnum.OWNER}
    if actor.role == RoleEnum.MANAGER:
        protected.add(RoleEnum.ADMIN)
    if new_role in protected or (target is not None and target.role in protected):
        raise HTTPException(403, 'You cannot assign or manage an account above your administrative authority.')


async def get_current_owner(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role != RoleEnum.OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner privileges required")
    return current_user


async def get_current_installation_owner(current_user: User = Depends(get_current_owner)) -> User:
    """Legacy singleton infrastructure settings are not tenant-owned records."""
    if str(current_user.tenant_id) != str(settings.default_tenant_id):
        raise HTTPException(403, 'Installation configuration is restricted to the installation workspace.')
    return current_user


async def get_current_installation_admin(current_user: User = Depends(get_current_admin)) -> User:
    if str(current_user.tenant_id) != str(settings.default_tenant_id):
        raise HTTPException(403, 'Installation configuration is restricted to the installation workspace.')
    return current_user


def get_tenant_id(token: str = Depends(oauth2_scheme)) -> uuid.UUID:
    payload = _decode_access_token(token)
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing tenant identifier",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return uuid.UUID(str(tenant_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid tenant identifier",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def require_roles(*required_roles: str):
    required = {role for role in required_roles if role}

    def _dependency(token: str = Depends(oauth2_scheme)) -> list[str]:
        payload = _decode_access_token(token)
        roles = _normalize_roles(payload.get("roles"))
        if required and not (required & set(roles)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role privileges",
            )
        return roles

    return _dependency


def apply_tenant_filter(query, tenant_id: uuid.UUID):
    conditions = []
    if hasattr(query, "column_descriptions"):
        for desc in query.column_descriptions:
            entity = desc.get("entity")
            if entity is not None and hasattr(entity, "tenant_id"):
                conditions.append(entity.tenant_id == tenant_id)
    if not conditions:
        raise ValueError("Query does not include a tenant-aware entity")

    if hasattr(query, "where"):
        return query.where(*conditions)
    return query.filter(*conditions)
