from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from .. import email_utils, models
from ..database import SessionLocal
from . import audit_logger

logger = logging.getLogger(__name__)

RETRY_BACKOFFS_SECONDS = (60, 300, 900, 1800, 3600)
STALE_SENDING_SECONDS = 600

_worker_thread: threading.Thread | None = None
_worker_stop_event = threading.Event()


def _now() -> datetime:
    return datetime.utcnow()


def _next_retry_at(attempts: int, max_attempts: int, now: datetime) -> Optional[datetime]:
    if attempts >= max_attempts:
        return None
    index = min(max(attempts - 1, 0), len(RETRY_BACKOFFS_SECONDS) - 1)
    return now + timedelta(seconds=RETRY_BACKOFFS_SECONDS[index])


def _sanitize_delivery_error(exc: Exception) -> str:
    raw = str(exc).strip()
    if not raw:
        return exc.__class__.__name__
    lowered = raw.lower()
    if any(token in lowered for token in ("password", "secret", "token", "credential", "auth")):
        return "Email delivery failed due to provider authentication/configuration"
    if len(raw) > 500:
        return raw[:500]
    return raw


def enqueue_email(
    db: Session,
    *,
    tenant_id: object,
    recipient_user_id: str,
    event_type: str,
    event_id: str,
    dedupe_key: str,
    subject: str,
    body: str,
    notification_id: Optional[str] = None,
    related_task_id: Optional[str] = None,
    related_subtask_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> Optional[models.NotificationOutbox]:
    existing = db.execute(
        select(models.NotificationOutbox).where(models.NotificationOutbox.dedupe_key == dedupe_key)
    ).scalars().first()
    if existing:
        return existing

    recipient = db.get(models.User, recipient_user_id)
    if (
        not recipient
        or not recipient.email
        or recipient.status != models.UserStatusEnum.ACTIVE
        or str(recipient.tenant_id) != str(tenant_id)
    ):
        return None

    payload: dict[str, Any] = {
        "to_address": recipient.email,
        "subject": subject,
        "body": body,
        "notification_type": event_type,
        "related_task_id": related_task_id,
        "related_subtask_id": related_subtask_id,
        "actor_id": actor_id,
    }
    outbox_id = models.generate_uuid()
    now = _now()
    values = {
        "id": outbox_id,
        "tenant_id": tenant_id,
        "notification_id": notification_id,
        "recipient_user_id": recipient_user_id,
        "channel": models.NotificationOutboxChannelEnum.EMAIL,
        "event_type": event_type,
        "event_id": event_id,
        "dedupe_key": dedupe_key,
        "payload": payload,
        "status": models.NotificationOutboxStatusEnum.PENDING,
        "attempts": 0,
        "max_attempts": len(RETRY_BACKOFFS_SECONDS),
        "created_at": now,
        "updated_at": now,
    }
    dialect_name = db.get_bind().dialect.name
    if dialect_name == "postgresql":
        stmt = postgres_insert(models.NotificationOutbox).values(**values).on_conflict_do_nothing(
            constraint="uq_notification_outbox_dedupe_key"
        )
    elif dialect_name == "sqlite":
        stmt = sqlite_insert(models.NotificationOutbox).values(**values).on_conflict_do_nothing(
            index_elements=["dedupe_key"]
        )
    else:
        stmt = insert(models.NotificationOutbox).values(**values)
    result = db.execute(stmt)
    if result.rowcount != 1:
        existing = db.execute(
            select(models.NotificationOutbox).where(models.NotificationOutbox.dedupe_key == dedupe_key)
        ).scalars().first()
        if not existing:
            raise
        return existing
    outbox = db.get(models.NotificationOutbox, outbox_id)
    return outbox


def run_due_notification_outbox(*, limit: int = 100) -> int:
    with SessionLocal() as db:
        return _run_due_notification_outbox(db, limit=limit)


def _run_due_notification_outbox(db: Session, *, limit: int = 100) -> int:
    now = _now()
    try:
        _recover_stale_sending(db, now=now)
        rows = db.execute(
            select(models.NotificationOutbox)
            .where(
                models.NotificationOutbox.channel == models.NotificationOutboxChannelEnum.EMAIL,
                models.NotificationOutbox.status.in_(
                    [models.NotificationOutboxStatusEnum.PENDING, models.NotificationOutboxStatusEnum.FAILED]
                ),
                models.NotificationOutbox.attempts < models.NotificationOutbox.max_attempts,
                or_(
                    models.NotificationOutbox.next_attempt_at.is_(None),
                    models.NotificationOutbox.next_attempt_at <= now,
                ),
            )
            .order_by(models.NotificationOutbox.created_at.asc())
            .limit(limit)
        ).scalars().all()
    except (OperationalError, ProgrammingError) as exc:
        if "notification_outbox" not in str(exc):
            raise
        db.rollback()
        return 0

    attempted = 0
    for row in rows:
        attempted += _attempt_email_delivery(db, row.id)
    return attempted


def _recover_stale_sending(db: Session, *, now: datetime) -> None:
    stale_before = now - timedelta(seconds=STALE_SENDING_SECONDS)
    db.execute(
        update(models.NotificationOutbox)
        .where(models.NotificationOutbox.status == models.NotificationOutboxStatusEnum.SENDING)
        .where(models.NotificationOutbox.updated_at <= stale_before)
        .values(
            status=models.NotificationOutboxStatusEnum.FAILED,
            last_error="Delivery attempt timed out before completion",
            next_attempt_at=now,
            updated_at=now,
        )
    )
    db.flush()


def _attempt_email_delivery(db: Session, outbox_id: str) -> int:
    claimed = db.execute(
        update(models.NotificationOutbox)
        .where(models.NotificationOutbox.id == outbox_id)
        .where(
            models.NotificationOutbox.status.in_(
                [models.NotificationOutboxStatusEnum.PENDING, models.NotificationOutboxStatusEnum.FAILED]
            )
        )
        .values(status=models.NotificationOutboxStatusEnum.SENDING, updated_at=_now())
    )
    if claimed.rowcount != 1:
        db.rollback()
        return 0
    db.commit()

    outbox = db.get(models.NotificationOutbox, outbox_id)
    if not outbox:
        return 0

    payload = outbox.payload or {}
    now = _now()
    attempts = (outbox.attempts or 0) + 1
    try:
        email_utils.send_notification_email(
            db=db,
            notification_type=payload.get("notification_type") or outbox.event_type,
            to_address=payload["to_address"],
            subject=payload["subject"],
            body=payload["body"],
        )
        outbox.status = models.NotificationOutboxStatusEnum.SENT
        outbox.attempts = attempts
        outbox.sent_at = now
        outbox.next_attempt_at = None
        outbox.last_error = None
        outbox.updated_at = now
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="NOTIFICATION_EMAIL_DELIVERED",
                category=models.AuditLogCategoryEnum.NOTIFICATION,
                target_user_id=outbox.recipient_user_id,
                source=models.AuditLogSourceEnum.AUTOMATION,
                metadata={"outbox_id": outbox.id, "event_type": outbox.event_type, "attempts": attempts},
            )
        )
    except Exception as exc:  # pragma: no cover - SMTP integration point
        safe_error = _sanitize_delivery_error(exc)
        outbox.attempts = attempts
        outbox.last_error = safe_error
        outbox.status = models.NotificationOutboxStatusEnum.FAILED
        outbox.next_attempt_at = _next_retry_at(attempts, outbox.max_attempts, now)
        outbox.updated_at = now
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="NOTIFICATION_EMAIL_FAILED",
                category=models.AuditLogCategoryEnum.NOTIFICATION,
                target_user_id=outbox.recipient_user_id,
                source=models.AuditLogSourceEnum.AUTOMATION,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason=safe_error,
                metadata={
                    "outbox_id": outbox.id,
                    "event_type": outbox.event_type,
                    "attempts": attempts,
                    "terminal": outbox.next_attempt_at is None,
                },
            )
        )
    db.commit()
    return 1


def start_notification_outbox_worker(poll_interval_seconds: int = 30) -> None:
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return

    _worker_stop_event.clear()

    def _worker_loop() -> None:
        while not _worker_stop_event.is_set():
            try:
                run_due_notification_outbox()
            except OperationalError as exc:
                logger.warning("Notification outbox worker skipped due to database connection error: %s", exc)
            except Exception:
                logger.exception("Notification outbox worker failed")
            _worker_stop_event.wait(poll_interval_seconds)

    _worker_thread = threading.Thread(target=_worker_loop, daemon=True)
    _worker_thread.start()


def stop_notification_outbox_worker(timeout_seconds: float = 1.0) -> None:
    global _worker_thread
    if not _worker_thread:
        return
    _worker_stop_event.set()
    _worker_thread.join(timeout=timeout_seconds)
    _worker_thread = None
