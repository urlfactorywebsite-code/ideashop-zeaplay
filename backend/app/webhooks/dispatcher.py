from __future__ import annotations

import enum
import json
import logging
import threading
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Iterable

import httpx
from sqlalchemy import or_, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal
from ..tickets.models import WebhookDeliveryLog, WebhookDeliveryStatusEnum, WebhookSubscription
from ..services import audit_logger
from .. import models as app_models
from .schema import ensure_webhook_schema
from .signing import generate_signature

logger = logging.getLogger(__name__)

RETRY_BACKOFFS_SECONDS = (60, 300, 900)
WEBHOOK_TIMEOUT_SECONDS = 30.0
LOG_RETENTION_DAYS = 30

_worker_thread: threading.Thread | None = None
_worker_stop_event = threading.Event()
_last_cleanup_ts: float | None = None


def _now() -> datetime:
    return datetime.utcnow()


def _json_fallback(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, enum.Enum):
        return str(value.value)
    return str(value)


def _serialize_body(payload: dict[str, Any]) -> tuple[str, bytes]:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=_json_fallback)
    return body, body.encode("utf-8")


def _sign_payload(secret: str, body_bytes: bytes) -> str:
    return generate_signature(secret, body_bytes)


def _next_retry_at(attempt_count: int, now: datetime) -> datetime | None:
    if attempt_count <= len(RETRY_BACKOFFS_SECONDS):
        delay = RETRY_BACKOFFS_SECONDS[attempt_count - 1]
        return now + timedelta(seconds=delay)
    return None


def queue_webhook_deliveries(
    db: Session,
    *,
    event_type: str,
    payload: dict[str, Any],
) -> list[WebhookDeliveryLog]:
    subscriptions = db.execute(
        select(WebhookSubscription)
        .where(
            WebhookSubscription.enabled.is_(True),
            WebhookSubscription.deleted_at.is_(None),
        )
    ).scalars().all()

    if subscriptions:
        filtered: list[WebhookSubscription] = []
        for subscription in subscriptions:
            subscribed_events = subscription.subscribed_events or []
            if subscribed_events:
                if event_type in subscribed_events:
                    filtered.append(subscription)
                continue
            if subscription.event_type == event_type:
                filtered.append(subscription)
        subscriptions = filtered

    if not subscriptions:
        return []

    settings = get_settings()
    tenant_id = uuid.UUID(settings.default_tenant_id)
    now = _now()
    logs: list[WebhookDeliveryLog] = []
    for subscription in subscriptions:
        log = WebhookDeliveryLog(
            tenant_id=tenant_id,
            subscription_id=subscription.id,
            event_type=event_type,
            payload=payload,
            status=WebhookDeliveryStatusEnum.PENDING,
            attempt_count=0,
            created_at=now,
            updated_at=now,
        )
        db.add(log)
        logs.append(log)
    db.flush()
    return logs


def dispatch_webhook_deliveries(db: Session, delivery_ids: Iterable) -> int:
    delivery_ids = [delivery_id for delivery_id in delivery_ids if delivery_id]
    if not delivery_ids:
        return 0

    rows = db.execute(
        select(WebhookDeliveryLog, WebhookSubscription)
        .join(
            WebhookSubscription,
            WebhookSubscription.id == WebhookDeliveryLog.subscription_id,
        )
        .where(WebhookDeliveryLog.id.in_(delivery_ids))
    ).all()

    attempted = 0
    for delivery, subscription in rows:
        attempted += 1
        _attempt_delivery(db, delivery, subscription)

    db.commit()
    return attempted


def _attempt_delivery(
    db: Session,
    delivery: WebhookDeliveryLog,
    subscription: WebhookSubscription,
) -> bool:
    now = _now()
    delivery.attempt_count = (delivery.attempt_count or 0) + 1
    delivery.last_attempt_at = now

    if not subscription.enabled or subscription.deleted_at is not None:
        delivery.status = WebhookDeliveryStatusEnum.FAILED
        delivery.error_message = "Webhook disabled"
        delivery.last_error = delivery.error_message
        delivery.next_retry_at = None
        delivery.updated_at = now
        return False

    event_payload = dict(delivery.payload or {})
    delivery.request_body = event_payload
    _, body_bytes = _serialize_body(event_payload)

    headers = {
        "Content-Type": "application/json",
        "X-Zea-Event": delivery.event_type,
    }
    if subscription.secret:
        headers["X-Zea-Signature"] = _sign_payload(subscription.secret, body_bytes)
    if subscription.custom_headers:
        for key, value in subscription.custom_headers.items():
            if key and value is not None:
                headers[str(key)] = str(value)

    try:
        start = time.perf_counter()
        with httpx.Client(timeout=WEBHOOK_TIMEOUT_SECONDS) as client:
            response = client.post(
                subscription.target_url,
                content=body_bytes,
                headers=headers,
            )
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        delivery.response_status = response.status_code
        delivery.response_body = response.text[:2000] if response.text else None
        delivery.response_time_ms = elapsed_ms
        if 200 <= response.status_code < 300:
            delivery.status = WebhookDeliveryStatusEnum.SUCCESS
            delivery.error_message = None
            delivery.last_error = None
            delivery.next_retry_at = None
            delivery.updated_at = now
            audit_logger.log_event(
                audit_logger.AuditLogInput(
                    action="WEBHOOK_DELIVERED",
                    category=app_models.AuditLogCategoryEnum.AUTOMATION,
                    source=app_models.AuditLogSourceEnum.AUTOMATION,
                    metadata={
                        "subscription_id": str(subscription.id),
                        "event_type": delivery.event_type,
                        "response_status": response.status_code,
                        "response_time_ms": delivery.response_time_ms,
                    },
                )
            )
            return True

        error_body = response.text or ""
        delivery.status = WebhookDeliveryStatusEnum.FAILED
        delivery.error_message = f"HTTP {response.status_code}: {error_body[:500]}"
        delivery.last_error = delivery.error_message
        delivery.next_retry_at = _next_retry_at(delivery.attempt_count, now)
        delivery.updated_at = now
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="WEBHOOK_FAILED",
                category=app_models.AuditLogCategoryEnum.AUTOMATION,
                source=app_models.AuditLogSourceEnum.AUTOMATION,
                severity=app_models.AuditLogSeverityEnum.WARNING,
                status=app_models.AuditLogStatusEnum.FAILED,
                reason=delivery.error_message,
                metadata={
                    "subscription_id": str(subscription.id),
                    "event_type": delivery.event_type,
                    "response_status": response.status_code,
                    "response_body": (response.text or "")[:500],
                    "retry_count": delivery.attempt_count,
                },
            )
        )
        return False
    except Exception as exc:  # pragma: no cover - network integration
        delivery.status = WebhookDeliveryStatusEnum.FAILED
        delivery.error_message = str(exc)
        delivery.last_error = delivery.error_message
        delivery.next_retry_at = _next_retry_at(delivery.attempt_count, now)
        delivery.updated_at = now
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="WEBHOOK_FAILED",
                category=app_models.AuditLogCategoryEnum.AUTOMATION,
                source=app_models.AuditLogSourceEnum.AUTOMATION,
                severity=app_models.AuditLogSeverityEnum.WARNING,
                status=app_models.AuditLogStatusEnum.FAILED,
                reason=str(exc),
                metadata={
                    "subscription_id": str(subscription.id),
                    "event_type": delivery.event_type,
                    "retry_count": delivery.attempt_count,
                },
            )
        )
        return False


def run_due_webhook_deliveries(*, limit: int = 100) -> int:
    with SessionLocal() as db:
        return _run_due_webhook_deliveries(db, limit=limit)


def _run_due_webhook_deliveries(db: Session, *, limit: int) -> int:
    now = _now()
    try:
        rows = db.execute(
            select(WebhookDeliveryLog, WebhookSubscription)
            .join(
                WebhookSubscription,
                WebhookSubscription.id == WebhookDeliveryLog.subscription_id,
            )
            .where(
                WebhookDeliveryLog.deleted_at.is_(None),
                WebhookDeliveryLog.status.in_(
                    [WebhookDeliveryStatusEnum.PENDING, WebhookDeliveryStatusEnum.FAILED]
                ),
                WebhookDeliveryLog.attempt_count <= len(RETRY_BACKOFFS_SECONDS),
                or_(
                    WebhookDeliveryLog.next_retry_at.is_(None),
                    WebhookDeliveryLog.next_retry_at <= now,
                ),
            )
            .order_by(WebhookDeliveryLog.created_at.asc())
            .limit(limit)
        ).all()
    except ProgrammingError:
        ensure_webhook_schema()
        db.rollback()
        return 0

    if not rows:
        _cleanup_old_logs(db)
        return 0

    attempted = 0
    for delivery, subscription in rows:
        attempted += 1
        _attempt_delivery(db, delivery, subscription)

    db.commit()
    _cleanup_old_logs(db)
    return attempted


def _cleanup_old_logs(db: Session) -> None:
    global _last_cleanup_ts
    now_ts = time.time()
    if _last_cleanup_ts and now_ts - _last_cleanup_ts < 3600:
        return
    _last_cleanup_ts = now_ts
    cutoff = _now() - timedelta(days=LOG_RETENTION_DAYS)
    db.query(WebhookDeliveryLog).filter(WebhookDeliveryLog.created_at < cutoff).delete()
    db.commit()


def start_webhook_retry_worker(poll_interval_seconds: int = 30) -> None:
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return

    _worker_stop_event.clear()

    def _worker_loop() -> None:
        while not _worker_stop_event.is_set():
            try:
                run_due_webhook_deliveries()
            except OperationalError as exc:
                logger.warning(
                    "Webhook retry worker skipped due to database connection error: %s",
                    exc,
                )
            except Exception:
                logger.exception("Webhook retry worker failed")
            _worker_stop_event.wait(poll_interval_seconds)

    _worker_thread = threading.Thread(target=_worker_loop, daemon=True)
    _worker_thread.start()


def stop_webhook_retry_worker(timeout_seconds: float = 1.0) -> None:
    global _worker_thread
    if not _worker_thread:
        return
    _worker_stop_event.set()
    _worker_thread.join(timeout=timeout_seconds)
    _worker_thread = None
