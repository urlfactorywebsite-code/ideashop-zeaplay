from __future__ import annotations

import logging
import threading
import random
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from .. import email_utils, models
from ..database import SessionLocal
from . import audit_logger
from .smtp_categories import category_for
from .smtp_security import SmtpError
from ..config import get_settings

logger = logging.getLogger(__name__)

RETRY_BACKOFFS_SECONDS = (60, 300, 900, 1800, 3600)
STALE_SENDING_SECONDS = 600

_worker_thread: threading.Thread | None = None
_worker_stop_event = threading.Event()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_retry_at(attempts: int, max_attempts: int, now: datetime) -> Optional[datetime]:
    if attempts >= max_attempts:
        return None
    index = min(max(attempts - 1, 0), len(RETRY_BACKOFFS_SECONDS) - 1)
    return now + timedelta(seconds=min(60 * 2 ** index, 3600) * random.uniform(.8, 1.2))


def _sanitize_delivery_error(exc: Exception) -> str:
    return exc.code if isinstance(exc, SmtpError) else 'acceptance_unknown'


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
        if str(existing.tenant_id) != str(tenant_id):
            raise ValueError("Outbox deduplication tenant mismatch")
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
        "notification_type": category_for(event_type),
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
        "delivery_state": "queued",
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
        if str(existing.tenant_id) != str(tenant_id):
            raise ValueError('Outbox deduplication tenant mismatch')
        return existing
    outbox = db.get(models.NotificationOutbox, outbox_id)
    return outbox


def run_due_notification_outbox(*, limit: int = 100) -> int:
    if not get_settings().smtp_delivery_enabled:
        return 0
    with SessionLocal() as db:
        return _run_due_notification_outbox(db, limit=limit)


def _run_due_notification_outbox(db: Session, *, limit: int = 100) -> int:
    now = _now()
    try:
        _recover_stale_sending(db, now=now)
        db.commit()
        rows = db.execute(
            select(models.NotificationOutbox)
            .where(
                models.NotificationOutbox.channel == models.NotificationOutboxChannelEnum.EMAIL,
                models.NotificationOutbox.status.in_(
                    [models.NotificationOutboxStatusEnum.PENDING, models.NotificationOutboxStatusEnum.FAILED]
                ),
                models.NotificationOutbox.delivery_state.in_(["queued", "retrying"]),
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
    # A process may have died after DATA acceptance. Never silently resend that job.
    db.execute(update(models.NotificationOutbox).where(
        models.NotificationOutbox.status == models.NotificationOutboxStatusEnum.SENDING,
        models.NotificationOutbox.updated_at <= now - timedelta(seconds=STALE_SENDING_SECONDS))
        .values(status=models.NotificationOutboxStatusEnum.FAILED, delivery_state='uncertain',
                claim_token=None, last_error='acceptance_unknown', next_attempt_at=None, updated_at=now)
        .execution_options(synchronize_session=False))
    db.flush()


def _attempt_email_delivery(db: Session, outbox_id: str) -> int:
    instant = _now()
    token = str(uuid4())
    claimed = db.execute(update(models.NotificationOutbox).where(
        models.NotificationOutbox.id == outbox_id,
        models.NotificationOutbox.status.in_([models.NotificationOutboxStatusEnum.PENDING, models.NotificationOutboxStatusEnum.FAILED]),
        models.NotificationOutbox.delivery_state.in_(['queued', 'retrying']),
        models.NotificationOutbox.attempts < models.NotificationOutbox.max_attempts,
        or_(models.NotificationOutbox.next_attempt_at.is_(None), models.NotificationOutbox.next_attempt_at <= instant))
        .values(status=models.NotificationOutboxStatusEnum.SENDING, delivery_state='sending', claim_token=token,
                attempts=models.NotificationOutbox.attempts + 1, updated_at=instant)
        .execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        return 0
    db.commit()
    outbox = db.get(models.NotificationOutbox, outbox_id, populate_existing=True)
    if not outbox:
        return 0
    payload = dict(outbox.payload or {})
    values = {'updated_at': _now(), 'claim_token': None}
    error = None
    try:
        recipient = db.get(models.User, outbox.recipient_user_id)
        if not recipient or str(recipient.tenant_id) != str(outbox.tenant_id) or recipient.status != models.UserStatusEnum.ACTIVE or recipient.email != payload.get('to_address'):
            raise SmtpError('recipient_rejected')
        body = payload['body']
        if outbox.event_type == 'password_reset':
            from .password_recovery import delivery_body
            body = delivery_body(db, outbox)
        email_utils.send_notification_email(db=db, tenant_id=outbox.tenant_id, outbox_id=outbox.id,
            notification_type='otp' if outbox.event_type == 'password_reset' else payload.get('notification_type', outbox.event_type),
            to_address=payload['to_address'], subject=payload['subject'], body=body)
        values.update(status=models.NotificationOutboxStatusEnum.SENT, delivery_state='sent', sent_at=_now(),
                      next_attempt_at=None, last_error=None)
    except Exception as exc:
        from .password_recovery import UndeliverableReset
        if isinstance(exc, UndeliverableReset):
            error = SmtpError('configuration')
        elif isinstance(exc, SmtpError):
            error = exc
        else:
            error = SmtpError('acceptance_unknown', uncertain=True)
        retry = _next_retry_at(outbox.attempts, outbox.max_attempts, _now()) if error.retryable and not error.uncertain else None
        if error.retry_at and error.retryable and not error.uncertain:
            retry = max(error.retry_at, _now()) + timedelta(seconds=random.uniform(1, 3))
            values['attempts'] = models.NotificationOutbox.attempts - 1
        values.update(status=models.NotificationOutboxStatusEnum.FAILED,
            delivery_state='uncertain' if error.uncertain else 'retrying' if retry else 'failed',
            last_error=error.code, next_attempt_at=retry)
    if outbox.event_type == 'password_reset' and values['delivery_state'] in {'sent', 'failed'}:
        values['payload'] = {key: value for key, value in payload.items() if key != 'encrypted_recovery'}
    changed = db.execute(update(models.NotificationOutbox).where(models.NotificationOutbox.id == outbox_id,
        models.NotificationOutbox.claim_token == token).values(**values)).rowcount
    db.commit()
    if changed:
        try:
            audit_logger.log_event(audit_logger.AuditLogInput(
                action='NOTIFICATION_EMAIL_DELIVERED' if error is None else 'NOTIFICATION_EMAIL_FAILED',
                category=models.AuditLogCategoryEnum.NOTIFICATION, target_user_id=outbox.recipient_user_id,
                source=models.AuditLogSourceEnum.AUTOMATION,
                metadata={'outbox_id': outbox_id, 'event_type': outbox.event_type, 'state': values['delivery_state']},
                reason=error.code if error else None))
        except Exception:
            logger.warning('SMTP delivery audit could not be recorded')
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
