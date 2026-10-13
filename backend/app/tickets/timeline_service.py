from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Optional, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as app_models
from .models import Ticket, TicketStatusEnum
from .schemas import TicketTimelineRead, TicketTimelineStageRead


STAGES = ["CREATED", "ASSIGNED", "APPROVAL", "IN_PROGRESS", "RESOLVED", "CLOSED"]


def _stage_from_status(status_value: str) -> str:
    try:
        status = TicketStatusEnum(status_value)
    except ValueError:
        return "ASSIGNED"
    if status == TicketStatusEnum.WAITING:
        return "APPROVAL"
    if status == TicketStatusEnum.IN_PROGRESS:
        return "IN_PROGRESS"
    if status == TicketStatusEnum.RESOLVED:
        return "RESOLVED"
    if status == TicketStatusEnum.CLOSED:
        return "CLOSED"
    return "ASSIGNED"


def _format_duration(seconds: Optional[int]) -> Optional[str]:
    if seconds is None:
        return None
    minutes = max(0, seconds) // 60
    hours = minutes // 60
    mins = minutes % 60
    if hours:
        return f"{hours}h {mins}m"
    return f"{mins}m"


def _coerce_payload(payload: Any) -> dict:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return _as_utc_datetime(value)
    if isinstance(value, str):
        cleaned = value.replace("Z", "+00:00")
        try:
            return _as_utc_datetime(datetime.fromisoformat(cleaned))
        except ValueError:
            return None
    return None


def _as_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def build_ticket_timeline(db: Session, *, ticket: Ticket) -> TicketTimelineRead:
    events = db.execute(
        select(app_models.AuditEvent)
        .where(
            app_models.AuditEvent.entity_type == "ticket",
            app_models.AuditEvent.entity_id == str(ticket.id),
        )
        .order_by(app_models.AuditEvent.created_at.asc())
    ).scalars().all()

    stage_events: list[tuple[str, datetime]] = []
    created_at = _coerce_datetime(ticket.created_at) or _coerce_datetime(ticket.updated_at) or datetime.now(timezone.utc)
    stage_events.append(("CREATED", created_at))

    for event in events:
        if event.event_type == "ticket.created":
            event_time = _coerce_datetime(event.created_at)
            if event_time:
                stage_events.append(("CREATED", event_time))
            continue
        if event.event_type == "ticket.approval_requested":
            event_time = _coerce_datetime(event.created_at)
            if event_time:
                stage_events.append(("APPROVAL", event_time))
            continue
        if event.event_type == "ticket.reopened":
            event_time = _coerce_datetime(event.created_at)
            if event_time:
                stage_events.append(("ASSIGNED", event_time))
            continue
        if event.event_type == "ticket.closed":
            event_time = _coerce_datetime(event.created_at)
            if event_time:
                stage_events.append(("CLOSED", event_time))
            continue
        if event.event_type == "ticket.status_changed":
            payload = _coerce_payload(event.payload)
            next_status = payload.get("to_status")
            if isinstance(next_status, str):
                event_time = _coerce_datetime(event.created_at)
                if event_time:
                    stage_events.append((_stage_from_status(next_status), event_time))

    stage_events.sort(key=lambda item: item[1])
    normalized_events: list[tuple[str, datetime]] = []
    for stage, timestamp in stage_events:
        if normalized_events and normalized_events[-1][0] == stage:
            continue
        normalized_events.append((stage, timestamp))

    timeline: dict[str, TicketTimelineStageRead] = {
        stage: TicketTimelineStageRead(stage=stage) for stage in STAGES
    }

    now = datetime.now(timezone.utc)
    for index, (stage, timestamp) in enumerate(normalized_events):
        entry = timeline.get(stage)
        if not entry:
            continue
        entry.entry_time = entry.entry_time or timestamp
        next_timestamp = normalized_events[index + 1][1] if index + 1 < len(normalized_events) else None
        exit_time = (
            next_timestamp
            or _coerce_datetime(ticket.closed_at)
            or _coerce_datetime(ticket.resolved_at)
            or now
        )
        entry.exit_time = next_timestamp or entry.exit_time
        if exit_time and entry.entry_time:
            entry.time_spent_seconds = int((exit_time - entry.entry_time).total_seconds())

    stages = [timeline[stage] for stage in STAGES]

    total_resolution_seconds = None
    closed_at = _coerce_datetime(ticket.closed_at)
    resolved_at = _coerce_datetime(ticket.resolved_at)
    if closed_at:
        total_resolution_seconds = int((closed_at - created_at).total_seconds())
    elif resolved_at:
        total_resolution_seconds = int((resolved_at - created_at).total_seconds())

    return TicketTimelineRead(
        stages=stages,
        total_resolution_seconds=total_resolution_seconds,
        total_resolution_label=_format_duration(total_resolution_seconds),
    )


def build_ticket_timeline_csv(timeline: TicketTimelineRead) -> str:
    lines = ["stage,entry_time,exit_time,time_spent_seconds"]
    for stage in timeline.stages:
        entry = stage.entry_time.isoformat() if stage.entry_time else ""
        exit_time = stage.exit_time.isoformat() if stage.exit_time else ""
        spent = str(stage.time_spent_seconds) if stage.time_spent_seconds is not None else ""
        lines.append(f"{stage.stage},{entry},{exit_time},{spent}")
    return "\n".join(lines) + "\n"
