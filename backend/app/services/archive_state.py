"""Transaction-owned archive transitions on existing records and audit events."""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, update

from .. import models
from . import security_audit


def locked_entity(db, model, *, tenant_id, entity_id):
    scope = (model.id == entity_id, model.tenant_id == tenant_id)
    if db.get_bind().dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Acquire its writer lock without changing
        # metadata, including on an idempotent retry.
        db.execute(update(model).where(*scope).values(id=model.id, updated_at=model.updated_at)
                   .execution_options(synchronize_session=False))
    record = db.scalar(select(model).where(*scope).with_for_update(of=model)
                       .execution_options(populate_existing=True))
    if record is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return record


def management_actor(db, actor, tenant_id):
    version = actor.credentials_version or 0
    current = db.scalar(select(models.User).where(models.User.id == actor.id)
                        .execution_options(populate_existing=True))
    if current is None or current.tenant_id != tenant_id or (current.credentials_version or 0) != version:
        raise HTTPException(401, "Account changed. Please sign in again.")
    if current.status != models.UserStatusEnum.ACTIVE or current.role not in {
        models.RoleEnum.OWNER, models.RoleEnum.ADMIN, models.RoleEnum.MANAGER
    }:
        raise HTTPException(403, "Management access required")
    return current


def state(record):
    return {"status": record.status.value,
            "archived_at": record.archived_at.isoformat() if record.archived_at else None,
            "archived_by_id": record.archived_by_id}


def audit_transition(db, *, record, actor, entity_type, action, previous, **details):
    event = security_audit.append_event(db, actor=actor, event_type=f"{entity_type}.{action}",
        entity_type=entity_type, entity_id=record.id,
        payload={"tenant_id": str(record.tenant_id), "previous_state": previous,
                 "new_state": state(record), **details})
    # A naive UTC value is interpreted in PostgreSQL's session timezone.
    event.created_at = datetime.now(timezone.utc)
