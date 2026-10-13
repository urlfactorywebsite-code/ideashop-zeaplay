"""Ticket workflow extensions for approvals, tasks, status history, and logs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .. import models as app_models
from ..models import NotificationTypeEnum, User
from ..notifiers import get_notifier
from ..services import notifications as notification_service
from ..webhooks import payloads as webhook_payloads
from ..webhooks import service as webhook_service
from .models import (
    PointsLedger,
    Ticket,
    TicketApprovalCycle,
    TicketApprovalCycleStatusEnum,
    TicketApprovalItem,
    TicketApprovalItemStatusEnum,
    TicketApprovalStateEnum,
    TicketApprovalTypeEnum,
    TicketAuditLog,
    TicketCloseEvent,
    TicketCloseReasonEnum,
    TicketParticipant,
    TicketResolutionEnum,
    TicketStatusEnum,
    TicketStatusHistory,
    TicketTask,
    TicketTaskStatusEnum,
)
from .schemas import (
    PendingApprovalItemRead,
    TicketApprovalCycleRead,
    TicketApprovalItemRead,
    TicketAuditLogPage,
    TicketAuditLogRead,
    TicketClosePayload,
    TicketStatusHistoryRead,
    TicketTaskCreate,
    TicketTaskRead,
    TicketTaskUpdate,
)
from .service import get_ticket_for_user, get_ticket


def _now() -> datetime:
    return datetime.utcnow()


APPROVAL_ATTEMPTS_PER_CYCLE = 3
MAX_APPROVERS = 5


def _normalize_roles(roles: Iterable[str]) -> set[str]:
    return {str(role).lower() for role in roles if role}


def _has_role(roles: Iterable[str], *allowed: str) -> bool:
    allowed_set = {role.lower() for role in allowed if role}
    return bool(_normalize_roles(roles) & allowed_set)


def _require_role_for_approval(roles: Iterable[str]) -> None:
    if not _has_role(roles, "admin", "owner", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to approve")

def _record_status_history(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    from_status: Optional[str],
    to_status: str,
    actor_user_id: Optional[str],
    metadata: Optional[dict] = None,
) -> None:
    db.add(
        TicketStatusHistory(
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            from_status=from_status,
            to_status=to_status,
            actor_user_id=actor_user_id,
            moved_at_utc=_now(),
            metadata_json=metadata,
        )
    )


def _record_audit_log(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    event_type: str,
    actor_user_id: Optional[str],
    summary: str,
    payload: Optional[dict] = None,
) -> None:
    db.add(
        TicketAuditLog(
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            event_type=event_type,
            actor_user_id=actor_user_id,
            created_at_utc=_now(),
            summary=summary,
            payload_json=payload,
        )
    )


def _build_approval_cycle_payload(
    db: Session,
    *,
    cycle: TicketApprovalCycle,
    approvers: list[TicketApprovalItem],
) -> dict:
    approver_ids = [item.approver_user_id for item in approvers]
    users = db.execute(
        select(User).where(User.id.in_(approver_ids))
    ).scalars().all()
    user_map = {str(user.id): user for user in users}
    return {
        "id": str(cycle.id),
        "type": cycle.approval_type.value,
        "deadline": cycle.deadline_utc.isoformat() if cycle.deadline_utc else None,
        "attempts_left": cycle.attempts_left,
        "requested_by": cycle.requested_by,
        "requested_at": cycle.requested_at_utc.isoformat(),
        "approvers": [
            {
                "id": item.approver_user_id,
                "name": user_map.get(item.approver_user_id).name if user_map.get(item.approver_user_id) else "",
                "status": item.status.value,
                "message": item.message,
                "acted_at": item.acted_at_utc.isoformat() if item.acted_at_utc else None,
            }
            for item in approvers
        ],
    }


def _emit_webhook(
    db: Session,
    *,
    event_name: str,
    ticket: Ticket,
    actor: Optional[User],
    approval_cycle: Optional[dict] = None,
    task: Optional[dict] = None,
    occurred_at: Optional[datetime] = None,
) -> None:
    payload = webhook_payloads.build_ticket_webhook_payload(
        event_name=event_name,
        ticket=ticket,
        actor=actor,
        approval_cycle=approval_cycle,
        task=task,
        occurred_at=occurred_at,
    )
    webhook_service.queue_event(db, event_name=event_name, data=payload)


def _ensure_ticket_task_access(
    db: Session,
    *,
    ticket: Ticket,
    user_id: str,
    roles: Iterable[str],
) -> None:
    role_set = _normalize_roles(roles)
    if _has_role(role_set, "admin", "owner"):
        return
    if _has_role(role_set, "manager") and ticket.department_id:
        user = db.get(User, user_id)
        if user and str(user.department_id) == str(ticket.department_id):
            return
    if ticket.created_by == user_id or ticket.assigned_user_id == user_id:
        return
    participant = db.execute(
        select(TicketParticipant)
        .where(
            TicketParticipant.tenant_id == ticket.tenant_id,
            TicketParticipant.ticket_id == ticket.id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if participant:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for ticket")

def list_ticket_status_history(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketStatusHistoryRead]:
    rows = db.execute(
        select(TicketStatusHistory)
        .where(
            TicketStatusHistory.tenant_id == tenant_id,
            TicketStatusHistory.ticket_id == ticket_id,
        )
        .order_by(TicketStatusHistory.moved_at_utc.asc())
    ).scalars().all()
    return [TicketStatusHistoryRead.model_validate(row) for row in rows]


def list_ticket_approval_cycles(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketApprovalCycleRead]:
    cycles = db.execute(
        select(TicketApprovalCycle)
        .where(
            TicketApprovalCycle.tenant_id == tenant_id,
            TicketApprovalCycle.ticket_id == ticket_id,
        )
        .order_by(TicketApprovalCycle.requested_at_utc.desc())
    ).scalars().all()

    if not cycles:
        return []

    cycle_ids = [cycle.id for cycle in cycles]
    items = db.execute(
        select(TicketApprovalItem)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.cycle_id.in_(cycle_ids),
        )
        .order_by(TicketApprovalItem.order_index.asc().nulls_last(), TicketApprovalItem.id.asc())
    ).scalars().all()

    items_by_cycle: dict[uuid.UUID, list[TicketApprovalItem]] = {}
    for item in items:
        items_by_cycle.setdefault(item.cycle_id, []).append(item)

    now = _now()
    updated = False
    for cycle in cycles:
        if cycle.status == TicketApprovalCycleStatusEnum.PENDING and cycle.deadline_utc and cycle.deadline_utc < now:
            cycle.status = TicketApprovalCycleStatusEnum.OVERDUE
            updated = True
            _record_audit_log(
                db,
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                event_type="ticket.approval_overdue",
                actor_user_id=None,
                summary="Approval cycle marked overdue.",
                payload={"cycle_id": str(cycle.id)},
            )
    if updated:
        db.commit()

    result: list[TicketApprovalCycleRead] = []
    for cycle in cycles:
        cycle_items = items_by_cycle.get(cycle.id, [])
        result.append(
            TicketApprovalCycleRead(
                id=cycle.id,
                ticket_id=cycle.ticket_id,
                approval_type=cycle.approval_type,
                deadline_utc=cycle.deadline_utc,
                attempts_left=cycle.attempts_left,
                status=cycle.status,
                requested_by=cycle.requested_by,
                requested_at_utc=cycle.requested_at_utc,
                completed_at_utc=cycle.completed_at_utc,
                approvers=[TicketApprovalItemRead.model_validate(item) for item in cycle_items],
            )
        )
    return result


def request_ticket_approval(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    approval_type: TicketApprovalTypeEnum,
    approvers: list[tuple[str, str]],
    deadline_utc: Optional[datetime],
    notify_approvers: bool = True,
) -> TicketApprovalCycleRead:
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    user_id = str(current_user.id)
    role_set = _normalize_roles(roles)
    if not (
        _has_role(role_set, "admin", "owner", "manager")
        or ticket.assigned_user_id == user_id
        or ticket.created_by == user_id
        or ticket.owner_id == user_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to request approval")

    unique_approvers: list[tuple[str, str]] = []
    for approver_id, message in approvers:
        if not approver_id or not message:
            continue
        if approver_id not in {item[0] for item in unique_approvers}:
            unique_approvers.append((approver_id, message))

    if not unique_approvers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approvers are required")
    if len(unique_approvers) > MAX_APPROVERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many approvers selected")

    now = _now()
    cycle = TicketApprovalCycle(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        approval_type=approval_type,
        deadline_utc=deadline_utc,
        attempts_left=APPROVAL_ATTEMPTS_PER_CYCLE,
        status=TicketApprovalCycleStatusEnum.PENDING,
        requested_by=user_id,
        requested_at_utc=now,
    )
    db.add(cycle)
    db.flush()

    for index, (approver_id, message) in enumerate(unique_approvers):
        db.add(
            TicketApprovalItem(
                tenant_id=tenant_id,
                cycle_id=cycle.id,
                approver_user_id=approver_id,
                message=message,
                status=TicketApprovalItemStatusEnum.PENDING,
                order_index=index + 1,
            )
        )

    ticket.status = TicketStatusEnum.WAITING
    ticket.approval_status = TicketApprovalStateEnum.PENDING
    _record_status_history(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        from_status=None,
        to_status="APPROVAL",
        actor_user_id=user_id,
        metadata={"cycle_id": str(cycle.id)},
    )
    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        event_type="ticket.approval_requested",
        actor_user_id=user_id,
        summary="Approval requested.",
        payload={"cycle_id": str(cycle.id), "approvers": [a for a, _ in unique_approvers]},
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.approval_requested",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={"cycle_id": str(cycle.id), "approvers": [a for a, _ in unique_approvers]},
            created_at=now,
        )
    )

    if notify_approvers:
        first_approver_id = unique_approvers[0][0]
        if first_approver_id and first_approver_id != user_id:
            notification_service.create_notification(
                db,
                user_id=first_approver_id,
                notification_type=NotificationTypeEnum.APPROVAL_REQUESTED,
                message=f'{current_user.name or "Someone"} requested approval for "{ticket.title}".',
            )
        get_notifier().send_webex_message(
            f"Approval requested for ticket '{ticket.title}' (id: {ticket.id})."
        )

    db.commit()
    db.refresh(cycle)

    approver_items = db.execute(
        select(TicketApprovalItem)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.cycle_id == cycle.id,
        )
        .order_by(TicketApprovalItem.order_index.asc().nulls_last())
    ).scalars().all()

    approval_payload = _build_approval_cycle_payload(db, cycle=cycle, approvers=approver_items)
    _emit_webhook(
        db,
        event_name="ticket.approval_requested",
        ticket=ticket,
        actor=current_user,
        approval_cycle=approval_payload,
        occurred_at=now,
    )

    return TicketApprovalCycleRead(
        id=cycle.id,
        ticket_id=cycle.ticket_id,
        approval_type=cycle.approval_type,
        deadline_utc=cycle.deadline_utc,
        attempts_left=cycle.attempts_left,
        status=cycle.status,
        requested_by=cycle.requested_by,
        requested_at_utc=cycle.requested_at_utc,
        completed_at_utc=cycle.completed_at_utc,
        approvers=[TicketApprovalItemRead.model_validate(item) for item in approver_items],
    )

def _get_cycle_with_items(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    cycle_id: uuid.UUID,
) -> tuple[TicketApprovalCycle, list[TicketApprovalItem]]:
    cycle = db.execute(
        select(TicketApprovalCycle)
        .where(
            TicketApprovalCycle.tenant_id == tenant_id,
            TicketApprovalCycle.id == cycle_id,
        )
    ).scalar_one_or_none()
    if not cycle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval cycle not found")
    items = db.execute(
        select(TicketApprovalItem)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.cycle_id == cycle_id,
        )
        .order_by(TicketApprovalItem.order_index.asc().nulls_last())
    ).scalars().all()
    return cycle, items


def _ensure_sequential_turn(
    *,
    cycle: TicketApprovalCycle,
    items: list[TicketApprovalItem],
    approver_id: str,
) -> None:
    if cycle.approval_type != TicketApprovalTypeEnum.SEQUENTIAL:
        return
    pending = [item for item in items if item.status == TicketApprovalItemStatusEnum.PENDING]
    if not pending:
        return
    next_item = sorted(pending, key=lambda item: item.order_index or 0)[0]
    if next_item.approver_user_id != approver_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Awaiting another approver")


def approve_ticket_cycle(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    cycle_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    message: Optional[str] = None,
) -> TicketApprovalCycleRead:
    _require_role_for_approval(roles)
    user_id = str(current_user.id)
    cycle, items = _get_cycle_with_items(db, tenant_id=tenant_id, cycle_id=cycle_id)
    if cycle.status not in {TicketApprovalCycleStatusEnum.PENDING, TicketApprovalCycleStatusEnum.OVERDUE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval cycle is not active")
    _ensure_sequential_turn(cycle=cycle, items=items, approver_id=user_id)

    item = next((row for row in items if row.approver_user_id == user_id), None)
    if not item:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not listed as approver")

    item.status = TicketApprovalItemStatusEnum.APPROVED
    item.acted_at_utc = _now()
    if message:
        item.message = message

    all_approved = all(row.status == TicketApprovalItemStatusEnum.APPROVED for row in items)
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=cycle.ticket_id)
    now = _now()
    if all_approved:
        cycle.status = TicketApprovalCycleStatusEnum.APPROVED
        cycle.completed_at_utc = now
        ticket.status = TicketStatusEnum.IN_PROGRESS
        ticket.approval_status = TicketApprovalStateEnum.APPROVED
        _record_status_history(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            from_status="APPROVAL",
            to_status="IN_PROGRESS",
            actor_user_id=user_id,
            metadata={"cycle_id": str(cycle.id)},
        )
        _record_audit_log(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.approval_approved",
            actor_user_id=user_id,
            summary="Approval cycle approved.",
            payload={"cycle_id": str(cycle.id)},
        )
    else:
        ticket.approval_status = TicketApprovalStateEnum.PENDING
        _record_audit_log(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.approval_decision",
            actor_user_id=user_id,
            summary="Approval decision recorded.",
            payload={"cycle_id": str(cycle.id), "decision": "APPROVED"},
        )

    db.commit()
    db.refresh(cycle)

    approver_items = db.execute(
        select(TicketApprovalItem)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.cycle_id == cycle.id,
        )
        .order_by(TicketApprovalItem.order_index.asc().nulls_last())
    ).scalars().all()
    approval_payload = _build_approval_cycle_payload(db, cycle=cycle, approvers=approver_items)
    _emit_webhook(
        db,
        event_name="ticket.approval_approved" if all_approved else "ticket.approval_requested",
        ticket=ticket,
        actor=current_user,
        approval_cycle=approval_payload,
        occurred_at=now,
    )

    return TicketApprovalCycleRead(
        id=cycle.id,
        ticket_id=cycle.ticket_id,
        approval_type=cycle.approval_type,
        deadline_utc=cycle.deadline_utc,
        attempts_left=cycle.attempts_left,
        status=cycle.status,
        requested_by=cycle.requested_by,
        requested_at_utc=cycle.requested_at_utc,
        completed_at_utc=cycle.completed_at_utc,
        approvers=[TicketApprovalItemRead.model_validate(item) for item in approver_items],
    )


def reject_ticket_cycle(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    cycle_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    message: Optional[str] = None,
) -> TicketApprovalCycleRead:
    _require_role_for_approval(roles)
    user_id = str(current_user.id)
    cycle, items = _get_cycle_with_items(db, tenant_id=tenant_id, cycle_id=cycle_id)
    if cycle.status not in {TicketApprovalCycleStatusEnum.PENDING, TicketApprovalCycleStatusEnum.OVERDUE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval cycle is not active")
    _ensure_sequential_turn(cycle=cycle, items=items, approver_id=user_id)

    item = next((row for row in items if row.approver_user_id == user_id), None)
    if not item:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not listed as approver")

    item.status = TicketApprovalItemStatusEnum.REJECTED
    item.acted_at_utc = _now()
    if message:
        item.message = message

    cycle.status = TicketApprovalCycleStatusEnum.REJECTED
    cycle.completed_at_utc = _now()
    cycle.attempts_left = max(cycle.attempts_left - 1, 0)
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=cycle.ticket_id)
    ticket.status = TicketStatusEnum.OPEN
    ticket.approval_status = TicketApprovalStateEnum.REJECTED

    _record_status_history(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        from_status="APPROVAL",
        to_status="ASSIGNED",
        actor_user_id=user_id,
        metadata={"cycle_id": str(cycle.id)},
    )
    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.approval_rejected",
        actor_user_id=user_id,
        summary="Approval cycle rejected.",
        payload={"cycle_id": str(cycle.id)},
    )

    if cycle.attempts_left == 0 and ticket.owner_id:
        cycle.status = TicketApprovalCycleStatusEnum.ESCALATED
        _record_audit_log(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.approval_escalated",
            actor_user_id=None,
            summary="Approval cycle escalated to owner.",
            payload={"cycle_id": str(cycle.id), "owner_id": ticket.owner_id},
        )

    db.commit()
    db.refresh(cycle)

    approver_items = db.execute(
        select(TicketApprovalItem)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.cycle_id == cycle.id,
        )
        .order_by(TicketApprovalItem.order_index.asc().nulls_last())
    ).scalars().all()
    approval_payload = _build_approval_cycle_payload(db, cycle=cycle, approvers=approver_items)

    event_name = "ticket.approval_escalated" if cycle.status == TicketApprovalCycleStatusEnum.ESCALATED else "ticket.approval_rejected"
    _emit_webhook(
        db,
        event_name=event_name,
        ticket=ticket,
        actor=current_user,
        approval_cycle=approval_payload,
        occurred_at=_now(),
    )

    return TicketApprovalCycleRead(
        id=cycle.id,
        ticket_id=cycle.ticket_id,
        approval_type=cycle.approval_type,
        deadline_utc=cycle.deadline_utc,
        attempts_left=cycle.attempts_left,
        status=cycle.status,
        requested_by=cycle.requested_by,
        requested_at_utc=cycle.requested_at_utc,
        completed_at_utc=cycle.completed_at_utc,
        approvers=[TicketApprovalItemRead.model_validate(item) for item in approver_items],
    )


def list_pending_approvals(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    include_all: bool = False,
) -> list[PendingApprovalItemRead]:
    role_set = _normalize_roles(roles)
    user_id = str(current_user.id)
    if include_all and not _has_role(role_set, "admin", "owner"):
        include_all = False

    cycle_ids_stmt = select(TicketApprovalCycle.id).where(
        TicketApprovalCycle.tenant_id == tenant_id,
        TicketApprovalCycle.status.in_(
            [TicketApprovalCycleStatusEnum.PENDING, TicketApprovalCycleStatusEnum.OVERDUE]
        ),
    )
    cycle_ids = [row[0] for row in db.execute(cycle_ids_stmt).all()]
    if not cycle_ids:
        return []

    item_stmt = select(TicketApprovalItem, TicketApprovalCycle, Ticket).join(
        TicketApprovalCycle, TicketApprovalCycle.id == TicketApprovalItem.cycle_id
    ).join(
        Ticket, Ticket.id == TicketApprovalCycle.ticket_id
    ).where(
        TicketApprovalItem.tenant_id == tenant_id,
        TicketApprovalItem.cycle_id.in_(cycle_ids),
        TicketApprovalItem.status.in_([TicketApprovalItemStatusEnum.PENDING, TicketApprovalItemStatusEnum.OVERDUE]),
    )
    if not include_all:
        item_stmt = item_stmt.where(TicketApprovalItem.approver_user_id == user_id)

    rows = db.execute(item_stmt.order_by(TicketApprovalCycle.requested_at_utc.desc())).all()
    results: list[PendingApprovalItemRead] = []
    for item, cycle, ticket in rows:
        results.append(
            PendingApprovalItemRead(
                cycle_id=cycle.id,
                ticket_id=ticket.id,
                ticket_title=ticket.title,
                ticket_number=str(ticket.id),
                requested_by=cycle.requested_by,
                requested_at_utc=cycle.requested_at_utc,
                deadline_utc=cycle.deadline_utc,
                status=item.status,
                approver_user_id=item.approver_user_id,
                message=item.message,
                order_index=item.order_index,
            )
        )
    return results

def list_ticket_status_history(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketStatusHistoryRead]:
    rows = db.execute(
        select(TicketStatusHistory)
        .where(
            TicketStatusHistory.tenant_id == tenant_id,
            TicketStatusHistory.ticket_id == ticket_id,
        )
        .order_by(TicketStatusHistory.moved_at_utc.asc())
    ).scalars().all()
    return [TicketStatusHistoryRead.model_validate(row) for row in rows]


def list_ticket_tasks(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketTaskRead]:
    rows = db.execute(
        select(TicketTask)
        .where(
            TicketTask.tenant_id == tenant_id,
            TicketTask.ticket_id == ticket_id,
        )
        .order_by(TicketTask.status.asc(), TicketTask.updated_at_utc.desc())
    ).scalars().all()
    return [TicketTaskRead.model_validate(row) for row in rows]


def create_ticket_task(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketTaskCreate,
) -> TicketTaskRead:
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    _ensure_ticket_task_access(db, ticket=ticket, user_id=str(current_user.id), roles=roles)
    now = _now()
    task = TicketTask(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        title=payload.title,
        description=payload.description,
        status=TicketTaskStatusEnum.OPEN,
        assigned_to=payload.assigned_to,
        created_by=str(current_user.id),
        due_at_utc=payload.due_at_utc,
        priority=payload.priority,
        points=payload.points,
        created_at_utc=now,
        updated_at_utc=now,
    )
    db.add(task)
    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        event_type="ticket.task_created",
        actor_user_id=str(current_user.id),
        summary=f"Task created: {task.title}",
        payload={"task_id": str(task.id), "points": task.points},
    )
    db.commit()
    db.refresh(task)

    task_payload = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "assigned_to": task.assigned_to,
        "priority": task.priority.value,
        "points": task.points,
        "created_by": task.created_by,
        "created_at": task.created_at_utc.isoformat(),
        "completed_at": None,
    }
    _emit_webhook(
        db,
        event_name="ticket.task_created",
        ticket=ticket,
        actor=current_user,
        task=task_payload,
        occurred_at=now,
    )
    return TicketTaskRead.model_validate(task)

def update_ticket_task(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    task_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketTaskUpdate,
) -> TicketTaskRead:
    task = db.execute(
        select(TicketTask)
        .where(
            TicketTask.tenant_id == tenant_id,
            TicketTask.id == task_id,
        )
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=task.ticket_id)
    _ensure_ticket_task_access(db, ticket=ticket, user_id=str(current_user.id), roles=roles)

    updated_fields = payload.model_dump(exclude_unset=True)
    for key, value in updated_fields.items():
        setattr(task, key, value)
    task.updated_at_utc = _now()

    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=task.ticket_id,
        event_type="ticket.task_updated",
        actor_user_id=str(current_user.id),
        summary=f"Task updated: {task.title}",
        payload={"task_id": str(task.id), "changes": updated_fields},
    )

    db.commit()
    db.refresh(task)

    task_payload = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "assigned_to": task.assigned_to,
        "priority": task.priority.value,
        "points": task.points,
        "created_by": task.created_by,
        "created_at": task.created_at_utc.isoformat(),
        "completed_at": task.completed_at_utc.isoformat() if task.completed_at_utc else None,
    }
    _emit_webhook(
        db,
        event_name="ticket.task_updated",
        ticket=ticket,
        actor=current_user,
        task=task_payload,
        occurred_at=_now(),
    )
    return TicketTaskRead.model_validate(task)

def complete_ticket_task(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    task_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
) -> TicketTaskRead:
    task = db.execute(
        select(TicketTask)
        .where(
            TicketTask.tenant_id == tenant_id,
            TicketTask.id == task_id,
        )
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=task.ticket_id)
    _ensure_ticket_task_access(db, ticket=ticket, user_id=str(current_user.id), roles=roles)

    if task.status == TicketTaskStatusEnum.COMPLETED:
        return TicketTaskRead.model_validate(task)

    now = _now()
    task.status = TicketTaskStatusEnum.COMPLETED
    task.completed_at_utc = now
    task.updated_at_utc = now

    if task.assigned_to and task.assigned_to != task.created_by:
        assignee = db.get(User, task.assigned_to)
        if assignee:
            assignee.points = (assignee.points or 0) + task.points
            db.add(
                PointsLedger(
                    tenant_id=tenant_id,
                    user_id=task.assigned_to,
                    ticket_id=task.ticket_id,
                    task_id=task.id,
                    points=task.points,
                    reason="ticket_task_completed",
                    created_at_utc=now,
                    created_by=str(current_user.id),
                )
            )
            _record_audit_log(
                db,
                tenant_id=tenant_id,
                ticket_id=task.ticket_id,
                event_type="ticket.points_awarded",
                actor_user_id=str(current_user.id),
                summary=f"Points awarded for task completion: {task.title}",
                payload={"task_id": str(task.id), "points": task.points, "user_id": task.assigned_to},
            )

    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=task.ticket_id,
        event_type="ticket.task_completed",
        actor_user_id=str(current_user.id),
        summary=f"Task completed: {task.title}",
        payload={"task_id": str(task.id)},
    )

    db.commit()
    db.refresh(task)

    task_payload = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "assigned_to": task.assigned_to,
        "priority": task.priority.value,
        "points": task.points,
        "created_by": task.created_by,
        "created_at": task.created_at_utc.isoformat(),
        "completed_at": task.completed_at_utc.isoformat() if task.completed_at_utc else None,
    }
    _emit_webhook(
        db,
        event_name="ticket.task_completed",
        ticket=ticket,
        actor=current_user,
        task=task_payload,
        occurred_at=now,
    )
    return TicketTaskRead.model_validate(task)

def list_ticket_logs(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    page: int,
    page_size: int,
) -> TicketAuditLogPage:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 50)
    stmt = select(TicketAuditLog).where(
        TicketAuditLog.tenant_id == tenant_id,
        TicketAuditLog.ticket_id == ticket_id,
    )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(
        stmt.order_by(TicketAuditLog.created_at_utc.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()
    return TicketAuditLogPage(
        items=[TicketAuditLogRead.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


def close_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketClosePayload,
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)

    if ticket.assigned_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned user can close ticket")

    override_allowed = db.execute(
        select(app_models.Approval)
        .where(
            app_models.Approval.scope_type == app_models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE,
            app_models.Approval.scope_id == str(ticket_id),
            app_models.Approval.status == app_models.ApprovalStatusEnum.APPROVED,
        )
    ).scalar_one_or_none()
    if not override_allowed:
        linked_tasks = db.execute(
            select(app_models.Task).where(app_models.Task.ticket_id == ticket_id)
        ).scalars().all()
        if linked_tasks and any(task.status != app_models.TaskStatusEnum.DONE for task in linked_tasks):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TASKS_PENDING")
        if linked_tasks and any(
            task.approval_required
            and task.approval_status != app_models.TaskApprovalStatusEnum.APPROVED
            for task in linked_tasks
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TASK_APPROVAL_PENDING")

    tasks = db.execute(
        select(TicketTask)
        .where(
            TicketTask.tenant_id == tenant_id,
            TicketTask.ticket_id == ticket_id,
        )
    ).scalars().all()
    if tasks and any(task.status != TicketTaskStatusEnum.COMPLETED for task in tasks):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All ticket tasks must be completed")

    now = _now()
    ticket.status = TicketStatusEnum.CLOSED
    ticket.closed_at = now
    if ticket.resolved_at is None:
        ticket.resolved_at = now
    ticket.resolution_type = payload.resolution_type
    duplicate_ticket_id = payload.duplicate_ticket_id
    if payload.resolution_type == TicketResolutionEnum.DUPLICATE_ISSUE:
        if not duplicate_ticket_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DUPLICATE_TICKET_REQUIRED")
        if str(duplicate_ticket_id) == str(ticket.id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DUPLICATE_TICKET_INVALID")
        duplicate_exists = db.execute(
            select(Ticket).where(Ticket.id == duplicate_ticket_id)
        ).scalar_one_or_none()
        if not duplicate_exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DUPLICATE_TICKET_NOT_FOUND")

    close_reason_map = {
        TicketResolutionEnum.ISSUE_RESOLVED: TicketCloseReasonEnum.RESOLVED,
        TicketResolutionEnum.ISSUE_NOT_SOLVED: TicketCloseReasonEnum.NOT_SOLVED,
        TicketResolutionEnum.DUPLICATE_ISSUE: TicketCloseReasonEnum.DUPLICATE,
    }
    close_reason = close_reason_map[payload.resolution_type]

    db.add(
        TicketCloseEvent(
            id=uuid.uuid4(),
            ticket_id=ticket.id,
            closed_by=user_id,
            close_reason=close_reason,
            duplicate_ticket_id=duplicate_ticket_id,
            created_at=now,
        )
    )

    _record_status_history(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        from_status="RESOLVED",
        to_status="CLOSED",
        actor_user_id=user_id,
        metadata={
            "resolution_type": payload.resolution_type.value,
            "duplicate_ticket_id": str(duplicate_ticket_id) if duplicate_ticket_id else None,
        },
    )
    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.closed",
        actor_user_id=user_id,
        summary="Ticket closed.",
        payload={
            "resolution_type": payload.resolution_type.value,
            "duplicate_ticket_id": str(duplicate_ticket_id) if duplicate_ticket_id else None,
        },
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.closed",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={
                "resolution_type": payload.resolution_type.value,
                "duplicate_ticket_id": str(duplicate_ticket_id) if duplicate_ticket_id else None,
            },
            created_at=now,
        )
    )
    recipients = {ticket.owner_id, ticket.created_by}
    recipients.discard(None)
    for recipient_id in recipients:
        notification_service.create_notification(
            db,
            user_id=str(recipient_id),
            notification_type=app_models.NotificationTypeEnum.TICKET_CLOSED,
            message=f"Ticket '{ticket.title}' closed.",
            title="Ticket closed",
            body=f"Ticket '{ticket.title}' was closed.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link=f"/tickets?status=CLOSED&ticketId={ticket.id}",
        )

    db.commit()
    db.refresh(ticket)
    _emit_webhook(
        db,
        event_name="ticket.closed",
        ticket=ticket,
        actor=current_user,
        occurred_at=now,
    )
    return ticket

def _status_to_stage(status_value: TicketStatusEnum) -> str:
    if status_value == TicketStatusEnum.WAITING:
        return "APPROVAL"
    if status_value == TicketStatusEnum.IN_PROGRESS:
        return "IN_PROGRESS"
    if status_value == TicketStatusEnum.RESOLVED:
        return "RESOLVED"
    if status_value == TicketStatusEnum.CLOSED:
        return "CLOSED"
    return "ASSIGNED"


def update_ticket_status(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    next_status: TicketStatusEnum,
) -> Ticket:
    ticket = get_ticket_for_user(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    user_id = str(current_user.id)

    if not (
        _has_role(roles, "admin", "owner", "manager")
        or ticket.assigned_user_id == user_id
        or ticket.owner_id == user_id
        or ticket.created_by == user_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to change status")

    previous_status = ticket.status
    if previous_status == next_status:
        return ticket

    override_allowed = None
    if next_status == TicketStatusEnum.CLOSED:
        override_allowed = db.execute(
            select(app_models.Approval)
            .where(
                app_models.Approval.scope_type == app_models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE,
                app_models.Approval.scope_id == str(ticket_id),
                app_models.Approval.status == app_models.ApprovalStatusEnum.APPROVED,
            )
        ).scalar_one_or_none()

    if next_status in {TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED} and not override_allowed:
        tasks = db.execute(
            select(app_models.Task).where(app_models.Task.ticket_id == ticket_id)
        ).scalars().all()
        if tasks and any(task.status != app_models.TaskStatusEnum.DONE for task in tasks):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TASKS_PENDING")
        if tasks and any(
            task.approval_required
            and task.approval_status != app_models.TaskApprovalStatusEnum.APPROVED
            for task in tasks
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TASK_APPROVAL_PENDING")

    now = _now()
    ticket.status = next_status
    if next_status == TicketStatusEnum.RESOLVED:
        ticket.resolved_at = now
    if next_status == TicketStatusEnum.CLOSED:
        ticket.closed_at = now

    _record_status_history(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        from_status=_status_to_stage(previous_status),
        to_status=_status_to_stage(next_status),
        actor_user_id=user_id,
        metadata={"from": previous_status.value, "to": next_status.value},
    )
    _record_audit_log(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.status_changed",
        actor_user_id=user_id,
        summary=f"Status changed from {previous_status.value} to {next_status.value}.",
        payload={"from_status": previous_status.value, "to_status": next_status.value},
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.status_changed",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={"from_status": previous_status.value, "to_status": next_status.value},
            created_at=now,
        )
    )
    db.commit()
    db.refresh(ticket)

    _emit_webhook(
        db,
        event_name="ticket.status_changed",
        ticket=ticket,
        actor=current_user,
        occurred_at=now,
    )
    return ticket
