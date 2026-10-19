"""Read-only Phase 1 API contracts. Task and subtask status vocabularies stay separate."""
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from ..models import SubtaskStatusEnum, TaskStatusEnum
from ..schemas import TimeEntryRead


class LifecycleEventRead(BaseModel):
    id: int
    task_id: str
    subtask_id: str | None
    time_entry_id: str | None
    event_type: str
    previous_status: str | None
    new_status: str | None
    actor_id: str | None
    occurred_at: datetime
    recorded_at: datetime
    details: dict[str, Any]


class SubtaskStageRead(BaseModel):
    id: str
    status: SubtaskStatusEnum


class TaskJourneyRead(BaseModel):
    task_id: str
    created_by_id: str
    created_at: datetime
    status: TaskStatusEnum
    subtasks: list[SubtaskStageRead]
    capture_started_at: datetime
    history_complete: bool
    items: list[LifecycleEventRead]
    next_after_id: int | None


class TimeMetrics(BaseModel):
    session_count: int
    active_session_count: int
    raw_session_seconds: int
    person_seconds: int
    elapsed_seconds: int


class SubtaskTimeMetrics(TimeMetrics):
    subtask_id: str
    status: SubtaskStatusEnum


class TaskAnalyticsRead(BaseModel):
    task_id: str
    status: TaskStatusEnum
    as_of: datetime
    parent: TimeMetrics
    children: TimeMetrics
    aggregate: TimeMetrics
    subtasks: list[SubtaskTimeMetrics]
    history_complete: bool
    capture_started_at: datetime


class TaskSessionsRead(BaseModel):
    task_id: str
    items: list[TimeEntryRead]
    next_after_id: str | None
