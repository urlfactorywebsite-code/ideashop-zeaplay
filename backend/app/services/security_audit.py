from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import models


SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "credential",
    "api_key",
    "access_key",
    "private_key",
    "hashed_password",
    "vapid",
)
REDACTED_VALUE = "[REDACTED]"


def _is_sensitive_key(key: object) -> bool:
    normalized = str(key).strip().casefold()
    return any(fragment in normalized for fragment in SENSITIVE_KEY_FRAGMENTS)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): REDACTED_VALUE if _is_sensitive_key(key) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    return value


def append_event(
    db: Session,
    *,
    actor: Optional[models.User],
    event_type: str,
    entity_type: str,
    entity_id: str,
    payload: Optional[dict[str, Any]] = None,
) -> models.AuditEvent:
    event = models.AuditEvent(
        actor_id=actor.id if actor else None,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=redact(payload or {}),
    )
    db.add(event)
    return event
