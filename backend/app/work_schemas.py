"""Public active-work projections; legacy interval fields remain compatible."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel
from .schemas import TimeEntryRead


class WorkInterval(BaseModel):
    id: str
    started_at: datetime
    ended_at: datetime | None
    active_seconds: float
    corrected: bool
    paused_seconds: float = 0
    paused_until: datetime | None = None


class WorkEvent(BaseModel):
    event: str
    at: datetime


class WorkSession(BaseModel):
    target_accessible: bool = True
    id: str
    entry_id: str
    status: Literal["RUNNING", "PAUSED", "STOPPED"]
    task_id: str
    subtask_id: str | None
    project_name: str
    task_title: str
    subtask_title: str | None
    subtask_status: str
    started_at: datetime
    stopped_at: datetime | None
    running_since: datetime | None
    active_seconds: float
    paused_seconds: float
    range_active_seconds: float
    range_paused_seconds: float
    subtask_total_seconds: float
    intervals: list[WorkInterval]
    timeline: list[WorkEvent]


class WorkSnapshot(BaseModel):
    user_id: str
    tenant_id: str
    items: list[WorkSession]
    server_time: datetime
    limit: int
    running_count: int
    next_offset: int | None


class WorkMutation(TimeEntryRead):
    session: WorkSession | None = None
    server_time: datetime
    limit: int
    running_count: int
