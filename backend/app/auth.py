"""Authentication helpers for password hashing and JWT handling."""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from fastapi.security import OAuth2PasswordBearer

from .config import get_settings
from .schemas import TokenPayload


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
settings = get_settings()


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Hash a raw password."""
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(password, hashed_password)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def _create_token(
    subject: str,
    expires_delta: timedelta,
    secret_key: str,
    token_type: str,
    extra_claims: Optional[Dict[str, object]] = None,
) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode: Dict[str, object] = {"sub": subject, "exp": expire, "token_type": token_type}
    if extra_claims:
        to_encode.update(extra_claims)
    return jwt.encode(to_encode, secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(
    subject: str,
    expires_minutes: Optional[int] = None,
    scopes: Optional[List[str]] = None,
    extra_claims: Optional[Dict[str, object]] = None,
) -> str:
    expires = expires_minutes or settings.access_token_expire_minutes
    claims: Dict[str, object] = {}
    if scopes:
        claims["scopes"] = scopes
    if extra_claims:
        claims.update(extra_claims)
    return _create_token(
        subject,
        expires_delta=timedelta(minutes=expires),
        secret_key=settings.jwt_secret_key,
        token_type="access",
        extra_claims=claims or None,
    )


def create_refresh_token(
    subject: str,
    expires_minutes: Optional[int] = None,
    extra_claims: Optional[Dict[str, object]] = None,
) -> str:
    expires = expires_minutes or settings.refresh_token_expire_minutes
    return _create_token(
        subject,
        expires_delta=timedelta(minutes=expires),
        secret_key=settings.jwt_refresh_secret_key,
        token_type="refresh",
        extra_claims=extra_claims,
    )


def decode_token(token: str, *, refresh: bool = False) -> TokenPayload:
    secret = settings.jwt_refresh_secret_key if refresh else settings.jwt_secret_key
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
        token_payload = TokenPayload(**payload)
    except JWTError as exc:  # pragma: no cover - fastapi will handle
        raise ValueError("Invalid token") from exc

    expected_type = "refresh" if refresh else "access"
    if token_payload.token_type != expected_type:
        raise ValueError("Incorrect token type")

    return token_payload
