from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..cache import build_cache_key, get_cached_json, invalidate_prefix, set_cached_json, tenant_prefix
from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_user, get_tenant_id, require_roles
from ..models import User
from ..schemas import ApprovalActionPayload, TaskRead
from ..services import notifications as notification_service
from ..notifiers import get_notifier
from .models import (
    TicketApprovalCycle,
    TicketApprovalCycleStatusEnum,
    TicketPriorityEnum,
    TicketStatusEnum,
)
from .schemas import (
    PendingApprovalItemRead,
    TicketApprovalActionPayload,
    TicketApprovalCycleRead,
    TicketApprovalRequestPayload,
    TicketActivityRead,
    TicketApprovalRead,
    TicketApprovalDecision,
    TicketClosePayload,
    TicketCreate,
    TicketParticipantsUpdate,
    TicketParticipantRead,
    TicketFollowerRead,
    TicketRead,
    TicketListResponse,
    TicketTaskCreate,
    TicketTaskRead,
    TicketTaskSplitRequest,
    TicketTaskUpdate,
    TicketTransfer,
    TicketUpdate,
    TicketTimelineRead,
)
from .task_link_service import create_task_for_ticket, split_ticket_into_tasks
from .approvals_service import act_override_close, request_override_close
from .service import (
    create_ticket,
    decide_ticket_approval,
    get_ticket_for_user,
    list_ticket_activity,
    list_ticket_approvals,
    list_ticket_followers,
    list_tickets,
    list_ticket_participants,
    request_ticket_approval,
    reopen_ticket,
    soft_delete_ticket,
    transfer_ticket,
    update_participants,
    update_ticket,
)
from .workflow_service import (
    approve_ticket_cycle,
    close_ticket,
    complete_ticket_task,
    create_ticket_task,
    list_pending_approvals,
    list_ticket_approval_cycles,
    list_ticket_logs,
    list_ticket_status_history,
    list_ticket_tasks,
    reject_ticket_cycle,
    request_ticket_approval,
    update_ticket_status,
    update_ticket_task,
)
from .timeline_service import build_ticket_timeline, build_ticket_timeline_csv


router = APIRouter(prefix="/tickets", tags=["tickets"])
settings = get_settings()


def _invalidate_ticket_cache(tenant_id: uuid.UUID) -> None:
    invalidate_prefix(tenant_prefix(resource="tickets:list", tenant_id=str(tenant_id)))


@router.post("", response_model=TicketRead, status_code=status.HTTP_201_CREATED)
def create_ticket_handler(
    payload: TicketCreate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
) -> TicketRead:
    ticket = create_ticket(db, tenant_id=tenant_id, current_user=current_user, payload=payload)
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.get("", response_model=TicketListResponse)
def list_tickets_handler(
    request: Request,
    status_filter: Optional[TicketStatusEnum] = Query(default=None, alias="status"),
    priority: Optional[TicketPriorityEnum] = Query(default=None, alias="priority"),
    department_id: Optional[uuid.UUID] = Query(default=None),
    assignee_id: Optional[str] = Query(default=None),
    follower_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    my_tickets: bool = Query(default=False, alias="myTickets"),
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketListResponse:
    cache_key = build_cache_key(
        resource="tickets:list",
        tenant_id=str(tenant_id),
        user_id=str(current_user.id),
        path=request.url.path,
        params=request.query_params.multi_items(),
    )
    cached_payload = get_cached_json(cache_key)
    if cached_payload is not None:
        return TicketListResponse(data=[TicketRead.model_validate(item) for item in cached_payload])
    tickets = list_tickets(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        roles=roles,
        status_filter=status_filter,
        priority=priority,
        department_id=department_id,
        assignee_id=assignee_id,
        follower_id=follower_id,
        search=search,
        my_tickets=my_tickets,
    )
    serialized = [TicketRead.model_validate(ticket) for ticket in tickets]
    set_cached_json(
        cache_key,
        [item.model_dump(mode="json") for item in serialized],
        ttl_seconds=settings.cache_default_ttl_seconds,
    )
    return TicketListResponse(data=serialized)


def _get_active_approval_cycle_id(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> uuid.UUID:
    cycle_id = db.execute(
        select(TicketApprovalCycle.id)
        .where(
            TicketApprovalCycle.tenant_id == tenant_id,
            TicketApprovalCycle.ticket_id == ticket_id,
            TicketApprovalCycle.status.in_(
                [
                    TicketApprovalCycleStatusEnum.PENDING,
                    TicketApprovalCycleStatusEnum.OVERDUE,
                ]
            ),
        )
        .order_by(TicketApprovalCycle.requested_at_utc.desc())
        .limit(1)
    ).scalar_one_or_none()
    if not cycle_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active approval cycle not found",
        )
    return cycle_id


@router.get("/{ticket_id}", response_model=TicketRead)
def get_ticket_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    notifications = db.execute(
        select(models.Notification).where(
            models.Notification.user_id == current_user.id,
            models.Notification.entity_type == models.NotificationEntityTypeEnum.TICKET,
            models.Notification.entity_id == str(ticket.id),
            models.Notification.is_read.is_(False),
        )
    ).scalars().all()
    for notification in notifications:
        notification.is_read = True

    now = datetime.utcnow()
    sla_breached = False
    if ticket.resolution_due_at and ticket.resolution_due_at < now and ticket.status not in {TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED}:
        sla_breached = True
    if ticket.first_response_due_at and ticket.first_response_due_at < now and ticket.first_response_at is None:
        sla_breached = True
    if sla_breached:
        recipient_id = ticket.assigned_user_id or ticket.owner_id or ticket.created_by
        if recipient_id:
            existing = db.execute(
                select(models.Notification.id).where(
                    models.Notification.user_id == recipient_id,
                    models.Notification.type == models.NotificationTypeEnum.SLA_BREACH,
                    models.Notification.entity_type == models.NotificationEntityTypeEnum.TICKET,
                    models.Notification.entity_id == str(ticket.id),
                )
            ).scalar_one_or_none()
            if not existing:
                notification_service.create_notification(
                    db,
                    user_id=str(recipient_id),
                    notification_type=models.NotificationTypeEnum.SLA_BREACH,
                    message=f"SLA breached for ticket '{ticket.title}'.",
                    title="SLA breach",
                    body=f"Ticket '{ticket.title}' breached its SLA.",
                    entity_type=models.NotificationEntityTypeEnum.TICKET,
                    entity_id=str(ticket.id),
                    deep_link=f"/tickets/{ticket.id}",
                )
                get_notifier().send_webex_message(
                    f"SLA breach detected for ticket '{ticket.title}' (id: {ticket.id})."
                )
    db.commit()
    status_history = list_ticket_status_history(db, tenant_id=tenant_id, ticket_id=ticket_id)
    approvals = list_ticket_approval_cycles(db, tenant_id=tenant_id, ticket_id=ticket_id)
    tasks = list_ticket_tasks(db, tenant_id=tenant_id, ticket_id=ticket_id)
    ticket_read = TicketRead.model_validate(ticket)
    ticket_data = ticket_read.model_dump()
    ticket_data["status_history"] = status_history
    ticket_data["approval_cycles"] = approvals
    ticket_data["tasks"] = tasks
    return TicketRead(**ticket_data)


@router.patch("/{ticket_id}", response_model=TicketRead)
def update_ticket_handler(
    ticket_id: uuid.UUID,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = update_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        payload=payload,
    )
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_ticket_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> None:
    soft_delete_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    _invalidate_ticket_cache(tenant_id)


@router.post("/{ticket_id}/transfer", response_model=TicketRead)
def transfer_ticket_handler(
    ticket_id: uuid.UUID,
    payload: TicketTransfer,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = transfer_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        payload=payload,
    )
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.post("/{ticket_id}/participants", response_model=TicketRead)
def update_participants_handler(
    ticket_id: uuid.UUID,
    payload: TicketParticipantsUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = update_participants(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        payload=payload,
    )
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.get("/{ticket_id}/participants", response_model=list[TicketParticipantRead])
def list_participants_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> list[TicketParticipantRead]:
    get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    return list_ticket_participants(db, tenant_id=tenant_id, ticket_id=ticket_id)


@router.get("/{ticket_id}/followers", response_model=list[TicketFollowerRead])
def list_followers_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> list[TicketFollowerRead]:
    get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    return list_ticket_followers(db, tenant_id=tenant_id, ticket_id=ticket_id)


@router.get("/{ticket_id}/activity", response_model=list[TicketActivityRead])
def list_ticket_activity_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> list[dict]:
    get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    activity = list_ticket_activity(db, tenant_id=tenant_id, ticket_id=ticket_id)
    return [TicketActivityRead.model_validate(entry) for entry in activity]


@router.get("/{ticket_id}/approvals", response_model=list[TicketApprovalCycleRead])
def list_ticket_approvals_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> list[TicketApprovalCycleRead]:
    get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    return list_ticket_approval_cycles(db, tenant_id=tenant_id, ticket_id=ticket_id)


@router.get("/{ticket_id}/timeline", response_model=TicketTimelineRead)
def get_ticket_timeline_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketTimelineRead:
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    return build_ticket_timeline(db, ticket=ticket)


@router.get("/{ticket_id}/timeline.csv")
def export_ticket_timeline_csv_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
):
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    timeline = build_ticket_timeline(db, ticket=ticket)
    csv_payload = build_ticket_timeline_csv(timeline)
    filename = f"ticket-{ticket_id}-timeline.csv"
    return Response(
        content=csv_payload,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{ticket_id}/approvals", response_model=TicketApprovalCycleRead, status_code=status.HTTP_201_CREATED)
def request_ticket_approval_handler(
    ticket_id: uuid.UUID,
    payload: TicketApprovalRequestPayload,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketApprovalCycleRead:
    return request_ticket_approval(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        approval_type=payload.approval_type,
        approvers=[(item.approver_user_id, item.message) for item in payload.approvers],
        deadline_utc=payload.deadline_utc,
    )


@router.post("/{ticket_id}/approvals/{approval_id}/decisions", response_model=TicketApprovalRead)
def decide_ticket_approval_handler(
    ticket_id: uuid.UUID,
    approval_id: uuid.UUID,
    payload: TicketApprovalDecision,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketApprovalRead:
    return decide_ticket_approval(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        approval_id=approval_id,
        current_user=current_user,
        roles=roles,
        payload=payload,
    )


@router.post("/{ticket_id}/approve", response_model=TicketApprovalCycleRead)
def approve_ticket_action_handler(
    ticket_id: uuid.UUID,
    payload: TicketApprovalActionPayload,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketApprovalCycleRead:
    cycle_id = _get_active_approval_cycle_id(db, tenant_id=tenant_id, ticket_id=ticket_id)
    return approve_ticket_cycle(
        db,
        tenant_id=tenant_id,
        cycle_id=cycle_id,
        current_user=current_user,
        roles=roles,
        message=payload.message,
    )


@router.post("/{ticket_id}/reject", response_model=TicketApprovalCycleRead)
def reject_ticket_action_handler(
    ticket_id: uuid.UUID,
    payload: TicketApprovalActionPayload,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketApprovalCycleRead:
    cycle_id = _get_active_approval_cycle_id(db, tenant_id=tenant_id, ticket_id=ticket_id)
    return reject_ticket_cycle(
        db,
        tenant_id=tenant_id,
        cycle_id=cycle_id,
        current_user=current_user,
        roles=roles,
        message=payload.message,
    )


@router.post("/{ticket_id}/close", response_model=TicketRead)
def close_ticket_handler(
    ticket_id: uuid.UUID,
    payload: TicketClosePayload,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = close_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        payload=payload,
    )
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.post("/{ticket_id}/override-close/request", status_code=status.HTTP_201_CREATED)
def request_override_close_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> dict:
    approval = request_override_close(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    db.commit()
    db.refresh(approval)
    return {"approval_id": str(approval.id), "status": approval.status.value}


@router.post("/{ticket_id}/override-close/act", status_code=status.HTTP_200_OK)
def act_override_close_handler(
    ticket_id: uuid.UUID,
    payload: ApprovalActionPayload,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> dict:
    if payload.decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid decision")
    approval = act_override_close(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        decision=payload.decision,
        comment=payload.comment,
    )
    db.commit()
    db.refresh(approval)
    return {"approval_id": str(approval.id), "status": approval.status.value}


@router.post("/{ticket_id}/reopen", response_model=TicketRead)
def reopen_ticket_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TicketRead:
    ticket = reopen_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    _invalidate_ticket_cache(tenant_id)
    return ticket


@router.post("/{ticket_id}/tasks/create", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task_from_ticket_handler(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> TaskRead:
    task = create_task_for_ticket(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    return TaskRead.model_validate(task)


@router.post("/{ticket_id}/tasks/split", response_model=list[TaskRead], status_code=status.HTTP_201_CREATED)
def split_ticket_into_tasks_handler(
    ticket_id: uuid.UUID,
    payload: TicketTaskSplitRequest,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    roles: list[str] = Depends(require_roles()),
) -> list[TaskRead]:
    tasks = split_ticket_into_tasks(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
        items=[item.model_dump() for item in payload.tasks],
    )
    return [TaskRead.model_validate(task) for task in tasks]
