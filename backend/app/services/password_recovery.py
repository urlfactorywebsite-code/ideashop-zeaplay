"""Purpose-isolated recovery links and encrypted delivery through the existing outbox."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from urllib.parse import urlencode, urlsplit
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import select, update

from .. import cache, email_utils, models
from ..auth import hash_password
from ..config import get_settings
from . import notification_outbox, security_audit

EVENT = "password_reset"
INVALID_LINK = "This password reset link is invalid or expired. Request a new link."
GENERIC_REQUEST = "If an active account matches this email, reset instructions will be emailed shortly."


class UndeliverableReset(ValueError):
    pass


def _key(purpose):
    return hmac.new(get_settings().jwt_secret_key.encode(), ("zea:recovery:v1:" + purpose).encode(), hashlib.sha256).digest()


def _fingerprint(user):
    value = f"{user.id}:{user.tenant_id}:{user.email}:{user.credentials_version}:{user.hashed_password}"
    return hmac.new(_key("fingerprint"), value.encode(), hashlib.sha256).hexdigest()


def reset_url():
    settings = get_settings()
    production = settings.environment.lower() == "production"
    value = settings.password_reset_url or (None if production else "http://localhost:6300/#/reset-password")
    try:
        url = urlsplit(value or "")
        origin = f"{url.scheme}://{url.netloc}"
        if (not url.hostname or url.username is not None or url.password is not None or url.query
                or url.fragment != "/reset-password" or url.scheme not in {"http", "https"}
                or production and (url.scheme != "https" or len(settings.jwt_secret_key) < 32)
                or origin not in {item.rstrip("/") for item in settings.cors_allow_origins}):
            raise ValueError()
    except ValueError:
        raise HTTPException(503, "Password recovery is not configured. Contact your administrator.") from None
    return value


def check_delivery_configuration(db):
    url = reset_url()
    config = email_utils.resolve_smtp_config(db, "welcome_password")
    if (not config or not email_utils._is_config_complete(config)
            or get_settings().environment.lower() == "production" and str(config.encryption).lower() not in {"tls", "ssl"}):
        raise HTTPException(503, "Password recovery is not configured. Contact your administrator.")
    return url


def rate_limit(request, identity, *, redeem=False):
    settings = get_settings()
    client = cache.get_redis_client()
    if client is None:
        raise HTTPException(503, "Password recovery is temporarily unavailable. Please try again later.")
    peer = request.client.host if request.client else "unknown"
    window = 900
    script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n"
    limits = [("ip", peer, settings.password_reset_requests_per_ip),
              ("redeem" if redeem else "email", identity.casefold(), 10 if redeem else settings.password_reset_requests_per_email)]
    try:
        for kind, value, maximum in limits:
            digest = hmac.new(_key("rate-limit"), value.encode(), hashlib.sha256).hexdigest()
            count = client.eval(script, 1, f"{settings.cache_prefix}:recovery:{kind}:{digest}", window)
            if count > maximum:
                raise HTTPException(429, "Too many requests. Please try again later.", headers={"Retry-After": str(window)})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Password recovery is temporarily unavailable. Please try again later.") from None


def create_link(user, base):
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": user.id, "tenant_id": str(user.tenant_id), "aud": "zea-password-reset",
        "token_type": EVENT, "jti": secrets.token_urlsafe(32), "fingerprint": _fingerprint(user),
        "iat": now, "exp": now + timedelta(minutes=get_settings().password_reset_expire_minutes)}, _key("signing"), algorithm="HS256")
    return base + "?" + urlencode({"token": token}), token


def token_user(db, token):
    try:
        claims = jwt.decode(token, _key("signing"), algorithms=["HS256"], audience="zea-password-reset")
        if claims.get("token_type") != EVENT or not isinstance(claims.get("sub"), str):
            raise ValueError()
        user = db.scalar(select(models.User).where(models.User.id == claims["sub"],
            models.User.tenant_id == UUID(claims["tenant_id"]), models.User.status == models.UserStatusEnum.ACTIVE))
        if not user or not hmac.compare_digest(_fingerprint(user), str(claims.get("fingerprint", ""))):
            raise ValueError()
        return user
    except (JWTError, KeyError, ValueError, TypeError):
        raise HTTPException(400, INVALID_LINK) from None


def queue_link(db, user, base):
    _, token = create_link(user, base)
    ciphertext = Fernet(base64.urlsafe_b64encode(_key("mail"))).encrypt(token.encode()).decode()
    event_id = str(uuid4())
    row = notification_outbox.enqueue_email(db, tenant_id=user.tenant_id, recipient_user_id=user.id,
        event_type=EVENT, event_id=event_id, dedupe_key=f"recovery:{event_id}", subject="Zea.Play password reset", body="")
    if row is None:
        return
    row.payload = {**row.payload, "notification_type": "welcome_password", "encrypted_recovery": ciphertext,
                   "reset_url": base}


def delivery_body(db, outbox):
    payload = outbox.payload or {}
    try:
        token = Fernet(base64.urlsafe_b64encode(_key("mail"))).decrypt(payload["encrypted_recovery"].encode()).decode()
        user = token_user(db, token)
        base = check_delivery_configuration(db)
        if (user.id != outbox.recipient_user_id or user.tenant_id != outbox.tenant_id
                or user.email != payload.get("to_address") or payload.get("reset_url") != base):
            raise ValueError()
        link = base + "?" + urlencode({"token": token})
        return f"Use this link to reset your Zea.Play password:\n\n{link}\n\nThis link expires shortly and can be used once. If you did not request it, ignore this message."
    except (HTTPException, InvalidToken, KeyError, ValueError, UnicodeError):
        raise UndeliverableReset("Recovery email expired or is no longer authorized") from None


def replace_password(db, user, password, *, actor, reason):
    expected_hash = user.hashed_password
    version = user.credentials_version
    changed = db.execute(update(models.User).where(models.User.id == user.id, models.User.tenant_id == user.tenant_id,
        models.User.hashed_password == expected_hash, models.User.credentials_version == version,
        models.User.status == user.status, models.User.email == user.email)
        .values(hashed_password=hash_password(password), credentials_version=models.User.credentials_version + 1)
        .execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        raise HTTPException(409, "Credentials changed concurrently. Please try again.")
    db.refresh(user, attribute_names=["hashed_password", "credentials_version"])
    security_audit.append_event(db, actor=actor, event_type="user.credentials_changed", entity_type="user",
        entity_id=user.id, payload={"tenant_id": str(user.tenant_id), "reason": reason})
    event_id = str(uuid4())
    row = notification_outbox.enqueue_email(db, tenant_id=user.tenant_id, recipient_user_id=user.id,
        event_type="password_changed", event_id=event_id, dedupe_key=f"credential-change:{event_id}",
        subject="Zea.Play password changed", body="Your Zea.Play password was changed. If this was not you, contact your administrator immediately.")
    if row:
        row.payload = {**row.payload, "notification_type": "welcome_password"}
