from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Iterable

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings

logger = logging.getLogger(__name__)


def _read_env(key: str) -> str | None:
    env_value = os.getenv(key) or os.getenv(f"VEE_{key}")
    if env_value:
        return env_value

    return getattr(get_settings(), key.lower(), None)


def get_vapid_public_key() -> str | None:
    return _read_env("VAPID_PUBLIC_KEY")


def _get_vapid_private_key() -> str | None:
    return _read_env("VAPID_PRIVATE_KEY")


def _get_vapid_subject() -> str | None:
    return _read_env("VAPID_SUBJECT")


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
    existing = db.execute(
        select(models.PushSubscription).where(models.PushSubscription.endpoint == endpoint)
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing:
        existing.user_id = user_id
        existing.p256dh = p256dh
        existing.auth = auth
        existing.user_agent = user_agent
        existing.device_label = device_label
        existing.revoked_at = None
        existing.last_seen_at = now
        return existing

    subscription = models.PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh=p256dh,
        auth=auth,
        user_agent=user_agent,
        device_label=device_label,
        created_at=now,
        last_seen_at=now,
    )
    db.add(subscription)
    return subscription


def revoke_subscription(db: Session, *, endpoint: str) -> bool:
    subscription = db.execute(
        select(models.PushSubscription).where(models.PushSubscription.endpoint == endpoint)
    ).scalar_one_or_none()
    if not subscription:
        return False
    subscription.revoked_at = datetime.now(timezone.utc)
    return True


def send_push(db: Session, *, user_ids: Iterable[str], payload: dict) -> int:
    public_key = get_vapid_public_key()
    private_key = _get_vapid_private_key()
    subject = _get_vapid_subject()
    if not public_key or not private_key or not subject:
        logger.warning("Push delivery skipped: VAPID configuration is incomplete")
        return 0

    recipients = list({user_id for user_id in user_ids if user_id})
    if not recipients:
        logger.info("Push delivery skipped: no recipient user ids")
        return 0

    subscriptions = db.execute(
        select(models.PushSubscription).where(
            models.PushSubscription.user_id.in_(recipients),
            models.PushSubscription.revoked_at.is_(None),
        )
    ).scalars().all()

    if not subscriptions:
        logger.info("Push delivery skipped: no active subscriptions for recipients")
        return 0

    delivered = 0
    now = datetime.now(timezone.utc)
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
            )
            subscription.last_seen_at = now
            delivered += 1
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else None
            response_body = None
            if exc.response is not None:
                response_body = getattr(exc.response, "text", None)
            logger.warning(
                "Push delivery failed for subscription %s: status=%s error=%s response=%s",
                subscription.id,
                status,
                exc,
                response_body,
            )
            if status in {404, 410}:
                subscription.revoked_at = now
    return delivered
