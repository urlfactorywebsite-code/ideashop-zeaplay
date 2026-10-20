from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from cryptography.hazmat.primitives import serialization
from fastapi import HTTPException
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
import requests
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from .push_security import decode_push_key, validate_push_auth, validate_push_endpoint, validate_push_public_key

logger = logging.getLogger(__name__)


def _read_env(key: str) -> str | None:
    return os.getenv(key) or os.getenv(f"VEE_{key}") or getattr(get_settings(), key.lower(), None)


def get_vapid_public_key() -> str | None:
    return _read_env("VAPID_PUBLIC_KEY")


def _get_vapid_private_key() -> str | None:
    return _read_env("VAPID_PRIVATE_KEY")


def _get_vapid_subject() -> str | None:
    return _read_env("VAPID_SUBJECT")


def _configuration() -> tuple[dict[str, bool], Vapid | None, str | None]:
    public_key, private_key, subject = get_vapid_public_key(), _get_vapid_private_key(), _get_vapid_subject()
    status = {
        "public_key_configured": bool(public_key),
        "private_key_configured": bool(private_key),
        "subject_configured": bool(subject),
        "configuration_valid": False,
        "configured": False,
    }
    if not all((public_key, private_key, subject)):
        return status, None, None
    try:
        validate_push_public_key(public_key)
        # Preserve PEM-file deployments, but never generate a key during status.
        if "-----BEGIN" in private_key:
            vapid = Vapid.from_pem(private_key.encode("utf-8"))
        elif len(private_key) < 1024 and Path(private_key).is_file():
            contents = Path(private_key).read_text(encoding="utf-8").strip()
            vapid = Vapid.from_pem(contents.encode("utf-8")) if "-----BEGIN" in contents else Vapid.from_string(contents)
        else:
            vapid = Vapid.from_string(private_key)
        derived = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        if derived != decode_push_key(public_key):
            raise ValueError("Mismatched VAPID pair")
        # Validate the subject with the same library which signs delivery.
        vapid.sign({"sub": subject, "aud": "https://fcm.googleapis.com"})
        status["configuration_valid"] = status["configured"] = True
        return status, vapid, subject
    except Exception:
        # Private configuration and parser errors never enter diagnostics.
        return status, None, None


def configuration_status() -> dict[str, bool]:
    return _configuration()[0]


def subscription_metadata(subscription: models.PushSubscription) -> dict:
    def utc(value):
        return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value

    return {
        "id": subscription.id,
        "endpoint_hash": hashlib.sha256(subscription.endpoint.encode("utf-8")).hexdigest(),
        "device_label": subscription.device_label,
        "user_agent": subscription.user_agent,
        "created_at": utc(subscription.created_at),
        "last_seen_at": utc(subscription.last_seen_at),
    }


def save_subscription(
    db: Session,
    *,
    user_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None = None,
    device_label: str | None = None,
) -> models.PushSubscription:
    validate_push_endpoint(endpoint)
    validate_push_public_key(p256dh)
    validate_push_auth(auth)
    now = datetime.now(timezone.utc)
    values = dict(
        id=models.generate_uuid(), user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth,
        user_agent=user_agent, device_label=device_label, created_at=now, last_seen_at=now, revoked_at=None,
    )
    dialect = db.get_bind().dialect.name
    insert = postgres_insert if dialect == "postgresql" else sqlite_insert
    statement = insert(models.PushSubscription).values(**values)
    statement = statement.on_conflict_do_update(
        index_elements=["endpoint"],
        set_={key: values[key] for key in ("p256dh", "auth", "user_agent", "device_label", "last_seen_at", "revoked_at")},
        where=models.PushSubscription.user_id == user_id,
    ).returning(models.PushSubscription.id)
    subscription_id = db.execute(statement).scalar_one_or_none()
    if not subscription_id:
        raise HTTPException(status_code=409, detail="This browser subscription belongs to another account. Reset this browser's push subscription and enable notifications again.")
    return db.get(models.PushSubscription, subscription_id, populate_existing=True)


def revoke_subscription(db: Session, *, user_id: str, endpoint: str) -> bool:
    result = db.execute(update(models.PushSubscription).where(
        models.PushSubscription.user_id == user_id,
        models.PushSubscription.endpoint == endpoint,
        models.PushSubscription.revoked_at.is_(None),
    ).values(revoked_at=datetime.now(timezone.utc)))
    return result.rowcount > 0


@dataclass
class PushDeliveryResult:
    attempted: int = 0
    accepted: int = 0
    failed: int = 0
    revoked: int = 0


class _NoRedirectSession(requests.Session):
    def post(self, url, **kwargs):
        # Never forward VAPID headers to a provider redirect destination.
        kwargs["allow_redirects"] = False
        return super().post(url, **kwargs)


def send_push_result(
    db: Session, *, user_ids: Iterable[str], payload: dict, subscription_id: str | None = None
) -> PushDeliveryResult:
    result = PushDeliveryResult()
    status, vapid, subject = _configuration()
    if not status["configured"]:
        logger.warning("Push delivery skipped: VAPID configuration is incomplete or invalid")
        return result
    recipients = sorted({str(user_id) for user_id in user_ids if user_id})
    if not recipients:
        return result
    statement = select(models.PushSubscription, models.User).join(
        models.User, models.User.id == models.PushSubscription.user_id,
    ).where(
        models.PushSubscription.user_id.in_(recipients),
        models.PushSubscription.revoked_at.is_(None),
        models.User.status == models.UserStatusEnum.ACTIVE,
    )
    if subscription_id:
        statement = statement.where(models.PushSubscription.id == subscription_id)
    subscriptions = db.execute(statement).all()
    now = datetime.now(timezone.utc)
    with _NoRedirectSession() as transport:
        for subscription, recipient in subscriptions:
            result.attempted += 1
            try:
                # Revalidate legacy records at the outbound boundary too.
                validate_push_endpoint(subscription.endpoint)
                validate_push_public_key(subscription.p256dh)
                validate_push_auth(subscription.auth)
            except ValueError:
                subscription.revoked_at = now
                result.failed += 1
                result.revoked += 1
                logger.warning("Push subscription rejected: id=%s reason=invalid_subscription", subscription.id)
                continue
            try:
                response = webpush(
                    subscription_info={
                        "endpoint": subscription.endpoint,
                        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                    },
                    data=json.dumps({
                        **payload,
                        "recipient_user_id": str(recipient.id),
                        "recipient_tenant_id": str(recipient.tenant_id),
                    }),
                    vapid_private_key=vapid,
                    vapid_claims={"sub": subject},
                    timeout=(3.05, 5),
                    ttl=300,
                    requests_session=transport,
                )
                if response is not None and not 200 <= response.status_code < 300:
                    raise WebPushException("Provider rejected push", response=response)
                subscription.last_seen_at = now
                result.accepted += 1
            except Exception as exc:
                # Provider failures must not roll back a business operation.
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None)
                result.failed += 1
                logger.warning("Push delivery failed: id=%s status=%s", subscription.id, status_code)
                if status_code in {404, 410}:
                    subscription.revoked_at = now
                    result.revoked += 1
    return result


def send_push(db: Session, *, user_ids: Iterable[str], payload: dict) -> int:
    """Return provider acceptances, which do not prove browser display."""
    return send_push_result(db, user_ids=user_ids, payload=payload).accepted
