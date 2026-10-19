from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import aliased

from ..config import get_settings
from ..models import RealtimeAggregate, RealtimeOutbox
from .contracts import Event
from .transport import publish


def enqueue(connection, event: Event):
    pending = connection.scalar(select(func.count()).select_from(RealtimeOutbox).where(RealtimeOutbox.status != "PUBLISHED"))
    if pending >= get_settings().realtime_outbox_max_pending:
        raise RuntimeError("Realtime outbox capacity exceeded")
    table = RealtimeAggregate.__table__
    values = dict(tenant_id=event.tenant_id, aggregate_type=event.resource_type, aggregate_id=event.resource_id, version=1)
    insert = pg_insert if connection.dialect.name == "postgresql" else sqlite_insert
    version = connection.scalar(insert(table).values(**values).on_conflict_do_update(
        index_elements=[table.c.tenant_id, table.c.aggregate_type, table.c.aggregate_id],
        set_={"version": table.c.version + 1},
    ).returning(table.c.version))
    event = event.model_copy(update={"aggregate_version": version})
    event.encode()
    connection.execute(RealtimeOutbox.__table__.insert().values(
        event_id=event.event_id, tenant_id=event.tenant_id, aggregate_type=event.resource_type,
        aggregate_id=event.resource_id, aggregate_version=version, event_type=event.event_type,
        payload=event.model_dump(mode="json"), status="PENDING", attempt_count=0,
        created_at=event.occurred_at, next_attempt_at=event.occurred_at,
    ))


def relay_batch(db, *, batch_size=100, publisher=publish):
    now = datetime.now(timezone.utc)
    older = aliased(RealtimeOutbox)
    # An unresolved older event (including DEAD) blocks this aggregate, not other aggregates.
    blocked = exists(select(older.event_id).where(
        older.tenant_id == RealtimeOutbox.tenant_id,
        older.aggregate_type == RealtimeOutbox.aggregate_type,
        older.aggregate_id == RealtimeOutbox.aggregate_id,
        older.aggregate_version < RealtimeOutbox.aggregate_version,
        older.status != "PUBLISHED",
    ))
    ids = db.scalars(select(RealtimeOutbox.event_id).where(
        RealtimeOutbox.status == "PENDING", RealtimeOutbox.next_attempt_at <= now, ~blocked,
    ).order_by(RealtimeOutbox.created_at, RealtimeOutbox.event_id).limit(min(max(batch_size, 1), 500))).all()
    processed = 0
    for event_id in ids:
        # Recheck after claiming: another relay may have processed the candidate meanwhile.
        row = db.scalar(select(RealtimeOutbox).where(
            RealtimeOutbox.event_id == event_id, RealtimeOutbox.status == "PENDING",
            RealtimeOutbox.next_attempt_at <= now, ~blocked,
        ).with_for_update(skip_locked=True).execution_options(populate_existing=True))
        if row is None:
            db.rollback()
            continue
        try:
            event = Event.model_validate(row.payload)
            if ((event.event_id, event.tenant_id, event.resource_type, event.resource_id, event.aggregate_version, event.event_type)
                    != (row.event_id, row.tenant_id, row.aggregate_type, row.aggregate_id, row.aggregate_version, row.event_type)):
                raise ValueError("Outbox envelope identity mismatch")
            publisher(event, require_redis=True)
            row.status = "PUBLISHED"
            row.published_at = datetime.now(timezone.utc)
            row.last_error = None
        except Exception as exc:
            row.attempt_count += 1
            row.last_error = type(exc).__name__
            row.status = "DEAD" if row.attempt_count >= 12 else "PENDING"
            row.next_attempt_at = now + timedelta(seconds=min(3600, 2 ** min(row.attempt_count, 12) * random.uniform(0.8, 1.2)))
        db.commit()
        processed += 1
    return processed


def backlog(db):
    counts = dict(db.execute(select(RealtimeOutbox.status, func.count()).group_by(RealtimeOutbox.status)).all())
    oldest = db.scalar(select(func.min(RealtimeOutbox.created_at)).where(RealtimeOutbox.status != "PUBLISHED"))
    if oldest and oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    age = max(0, (datetime.now(timezone.utc) - oldest).total_seconds()) if oldest else 0
    retries = db.scalar(select(func.sum(RealtimeOutbox.attempt_count))) or 0
    return {"counts": counts, "oldest_pending_age_seconds": age, "attempts": retries}


def prune(db, *, batch_size=500):
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, get_settings().realtime_outbox_retention_days))
    ids = select(RealtimeOutbox.event_id).where(RealtimeOutbox.status == "PUBLISHED", RealtimeOutbox.published_at < cutoff).limit(min(batch_size, 500))
    result = db.execute(delete(RealtimeOutbox).where(RealtimeOutbox.event_id.in_(ids)))
    db.commit()
    return result.rowcount
