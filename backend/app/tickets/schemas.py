"""Pydantic schemas for the ticket system."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from ..models import TaskPriorityEnum
from .models import (
    TicketParticipantRoleEnum,
    TicketPriorityEnum,
    TicketStatusEnum,
    TicketApprovalTypeEnum,
    TicketApprovalStatusEnum,
    TicketApprovalDecisionEnum,
    TicketResolutionEnum,
    TicketApprovalCycleStatusEnum,
    TicketApprovalItemStatusEnum,
    TicketTaskStatusEnum,
    TicketTaskPriorityEnum,
)


class TicketCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    department_id: Optional[uuid.UUID] = None
    owner_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    priority: TicketPriorityEnum = TicketPriorityEnum.MEDIUM
    due_date: Optional[datetime] = None
    followers: list[str] = Field(default_factory=list)
    approval_enabled: bool = False
    approval_type: Optional[TicketApprovalTypeEnum] = None
    min_approvals: Optional[int] = None
    approvers: list[str] = Field(default_factory=list)
    approval_deadline: Optional[datetime] = None


class TicketUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, min_length=1)
    status: Optional[TicketStatusEnum] = None
    priority: Optional[TicketPriorityEnum] = None
    owner_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    due_date: Optional[datetime] = None
    approval_enabled: Optional[bool] = None
    approval_type: Optional[TicketApprovalTypeEnum] = None
    min_approvals: Optional[int] = None
    approval_deadline: Optional[datetime] = None
    approvers: Optional[list[str]] = None


class TicketTransfer(BaseModel):
    department_id: uuid.UUID


class TicketParticipantChange(BaseModel):
    user_id: str
    role: TicketParticipantRoleEnum


class TicketParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    role: TicketParticipantRoleEnum


class TicketParticipantsUpdate(BaseModel):
    add: list[TicketParticipantChange] = Field(default_factory=list)
    remove: list[TicketParticipantChange] = Field(default_factory=list)


class TicketTaskSplitItem(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None)


class TicketTaskSplitRequest(BaseModel):
    tasks: list[TicketTaskSplitItem] = Field(min_length=1)


class TicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    department_id: Optional[uuid.UUID] = None
    created_by: str
    owner_id: Optional[str] = None
    assigned_user_id: Optional[str] = None
    title: str
    description: str
    due_at: Optional[datetime] = None
    approval_enabled: bool = False
    approval_type: Optional[TicketApprovalTypeEnum] = None
    min_approvals: Optional[int] = None
    approval_deadline: Optional[datetime] = None
    approval_approver_ids: list[str] = Field(default_factory=list)
    status: TicketStatusEnum
    priority: TicketPriorityEnum
    sla_first_response_minutes: Optional[int] = None
    sla_resolution_minutes: Optional[int] = None
    first_response_due_at: Optional[datetime] = None
    resolution_due_at: Optional[datetime] = None
    first_response_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    resolution_type: Optional[TicketResolutionEnum] = None
    created_at: datetime
    updated_at: datetime
    status_history: list["TicketStatusHistoryRead"] = Field(default_factory=list)
    approval_cycles: list["TicketApprovalCycleRead"] = Field(default_factory=list)
    tasks: list["TicketTaskRead"] = Field(default_factory=list)


class TicketListResponse(BaseModel):
    success: bool = True
    data: list[TicketRead] = Field(default_factory=list)


class TicketFollowerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str


class TicketApprovalUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    decision: TicketApprovalDecisionEnum
    comment: Optional[str] = None
    decided_at: Optional[datetime] = None
    sequence_order: Optional[int] = None


class TicketApprovalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    attempt_no: int
    approval_type: TicketApprovalTypeEnum
    min_approvals: int
    status: TicketApprovalStatusEnum
    requested_by: str
    approval_deadline: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    approvers: list[TicketApprovalUserRead] = Field(default_factory=list)


class TicketApprovalRequest(BaseModel):
    approval_type: Optional[TicketApprovalTypeEnum] = None
    min_approvals: Optional[int] = None
    approvers: list[str] = Field(min_length=1, max_length=5)
    approval_deadline: Optional[datetime] = None


class TicketApprovalDecision(BaseModel):
    decision: TicketApprovalDecisionEnum
    comment: Optional[str] = None


class TicketActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    event_type: str
    payload: Optional[dict] = None
    actor_id: Optional[str] = None
    created_at: datetime


class TicketStatusHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    from_status: Optional[str] = None
    to_status: str
    actor_user_id: Optional[str] = None
    moved_at_utc: datetime
    metadata_json: Optional[dict] = None


class TicketApprovalItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approver_user_id: str
    message: Optional[str] = None
    status: TicketApprovalItemStatusEnum
    acted_at_utc: Optional[datetime] = None
    order_index: Optional[int] = None


class TicketApprovalCycleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    approval_type: TicketApprovalTypeEnum
    deadline_utc: Optional[datetime] = None
    attempts_left: int
    status: TicketApprovalCycleStatusEnum
    requested_by: str
    requested_at_utc: datetime
    completed_at_utc: Optional[datetime] = None
    approvers: list[TicketApprovalItemRead] = Field(default_factory=list)


class TicketApprovalMessage(BaseModel):
    approver_user_id: str
    message: str = Field(min_length=1)


class TicketApprovalRequestPayload(BaseModel):
    approval_type: TicketApprovalTypeEnum
    approvers: list[TicketApprovalMessage] = Field(min_length=1, max_length=5)
    deadline_utc: Optional[datetime] = None


class TicketApprovalActionPayload(BaseModel):
    message: Optional[str] = None


class TicketTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    title: str
    description: str
    status: TicketTaskStatusEnum
    assigned_to: Optional[str] = None
    created_by: str
    due_at_utc: Optional[datetime] = None
    priority: TicketTaskPriorityEnum
    points: int
    completed_at_utc: Optional[datetime] = None
    created_at_utc: datetime
    updated_at_utc: datetime


class TicketTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    due_at_utc: Optional[datetime] = None
    priority: TicketTaskPriorityEnum = TicketTaskPriorityEnum.MEDIUM
    points: int
    assigned_to: Optional[str] = None


class TicketTaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, min_length=1)
    due_at_utc: Optional[datetime] = None
    priority: Optional[TicketTaskPriorityEnum] = None
    points: Optional[int] = None
    assigned_to: Optional[str] = None
    status: Optional[TicketTaskStatusEnum] = None


class TicketLinkedTaskCreate(BaseModel):
    due_at: Optional[datetime] = None
    priority: TaskPriorityEnum = TaskPriorityEnum.MEDIUM
    approval_required: bool = False
    approver_id: Optional[str] = None


class TicketClosePayload(BaseModel):
    resolution_type: TicketResolutionEnum
    duplicate_ticket_id: Optional[uuid.UUID] = None


class TicketStatusUpdate(BaseModel):
    status: TicketStatusEnum


class TicketAuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    event_type: str
    actor_user_id: Optional[str] = None
    created_at_utc: datetime
    summary: str
    payload_json: Optional[dict] = None


class TicketTimelineStageRead(BaseModel):
    stage: str
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    time_spent_seconds: Optional[int] = None


class TicketTimelineRead(BaseModel):
    stages: list[TicketTimelineStageRead] = Field(default_factory=list)
    total_resolution_seconds: Optional[int] = None
    total_resolution_label: Optional[str] = None


class TicketAuditLogPage(BaseModel):
    items: list[TicketAuditLogRead] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class PendingApprovalItemRead(BaseModel):
    cycle_id: uuid.UUID
    ticket_id: uuid.UUID
    ticket_title: str
    ticket_number: str
    requested_by: str
    requested_at_utc: datetime
    deadline_utc: Optional[datetime] = None
    status: TicketApprovalItemStatusEnum
    approver_user_id: str
    message: Optional[str] = None
    order_index: Optional[int] = None
