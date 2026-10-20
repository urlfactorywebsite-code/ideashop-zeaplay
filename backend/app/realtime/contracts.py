from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from ..config import get_settings


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(default_factory=lambda: str(uuid4()), pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    event_type: str = Field(min_length=1, max_length=96)
    event_version: Literal[1] = 1
    tenant_id: str = Field(min_length=1, max_length=64)
    resource_type: Literal["chat", "task", "ticket"]
    resource_id: str = Field(min_length=1, max_length=64)
    actor_id: str | None = None
    occurred_at: AwareDatetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    aggregate_version: int | None = Field(default=None, ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_contract(self):
        self.occurred_at = self.occurred_at.astimezone(timezone.utc)
        allowed = {
            "chat": {"message:new", "message:updated", "message:deleted", "reaction:added", "reaction:removed", "message:read", "typing:started", "typing:stopped", "presence:changed", "unread:updated"},
            "task": {"task.changed", "subtask.workflow", "timer.changed"},
            "ticket": {"ticket.changed", "comment", "typing"},
        }
        if self.event_type not in allowed[self.resource_type]:
            raise ValueError("Unsupported realtime event type")
        browser = self.payload.get("browser")
        if browser is not None:
            if not isinstance(browser, dict) or browser.get("type") != self.event_type:
                raise ValueError("Mismatched browser adapter")
            data = browser.get("payload", {}) if self.resource_type == "chat" else browser
            if not isinstance(data, dict):
                raise ValueError("Invalid browser payload")
            reference = data.get("conversation_id") or data.get("ticket_id")
            if reference and str(reference) != self.resource_id:
                raise ValueError("Mismatched resource")
            if data.get("tenant_id") and str(data["tenant_id"]) != self.tenant_id:
                raise ValueError("Mismatched tenant")
        return self

    def encode(self) -> str:
        raw = self.model_dump_json()
        if len(raw.encode("utf-8")) > get_settings().realtime_max_event_bytes:
            raise ValueError("Realtime event size limit")
        return raw

    @classmethod
    def decode(cls, raw: str | bytes) -> "Event":
        if len(raw.encode("utf-8") if isinstance(raw, str) else raw) > get_settings().realtime_max_event_bytes:
            raise ValueError("Realtime event size limit")
        return cls.model_validate_json(raw)


def durable_enabled(category: str) -> bool:
    settings = get_settings()
    return settings.realtime_outbox_enabled and category in settings.realtime_outbox_categories
