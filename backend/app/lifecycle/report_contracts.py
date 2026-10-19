"""Read-only execution report contracts. Unknown historical facts remain nullable."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .contracts import TimeMetrics


class ReportPerson(BaseModel):
    id: str
    name: str | None = None


class ExecutionEntity(BaseModel):
    id: str
    title: str | None
    status: str | None
    creator: ReportPerson | None
    assignee: ReportPerson | None
    created_at: datetime | None
    creation_source: Literal["task_record", "captured_event", "not_recorded"]
    first_started_at: datetime | None
    first_session_started_at: datetime | None
    last_completed_at: datetime | None
    final_completed_at: datetime | None
    final_completion_source: Literal["captured_event", "task_record", "not_recorded"]
    completion_count: int
    reopened_count: int
    event_counts: dict[str, int]
    time: TimeMetrics
    linked_paused_seconds: int
    unresolved_pause_count: int
    deleted: bool = False


class ExecutionReport(BaseModel):
    task_id: str
    as_of: datetime
    history_complete: bool
    capture_started_at: datetime
    retained_sessions_only: bool = True
    deleted_session_count: int
    task: ExecutionEntity
    subtasks: list[ExecutionEntity]
    direct: TimeMetrics
    children: TimeMetrics
    aggregate: TimeMetrics


class ReportCompletion(BaseModel):
    id: str
    task_id: str
    subtask_id: str
    attempt_number: int
    description: str
    status: str
    approval_required: bool
    submitted_by: ReportPerson | None
    created_at: datetime
    reviewed_by: ReportPerson | None
    reviewed_at: datetime | None
    review_reason: str | None


class CompletionPage(BaseModel):
    items: list[ReportCompletion]
    next_after_id: str | None


class ReportEvidence(BaseModel):
    id: str
    source: Literal["completion", "media", "media_file", "unverified"]
    task_id: str
    subtask_id: str | None = None
    submission_id: str | None = None
    filename: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    uploaded_by: ReportPerson | None = None
    uploaded_at: datetime | None = None
    availability: Literal["available", "missing", "deleted", "unverified", "provider_check_required"]
    can_preview: bool = False
    can_download: bool = False


class EvidencePage(BaseModel):
    items: list[ReportEvidence] = Field(default_factory=list)
    next_after_id: str | None
