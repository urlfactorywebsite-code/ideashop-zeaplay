"""Service layer for ticket operations."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..dependencies import apply_tenant_filter
from .. import models as app_models
from ..events.bus import emit_ticket_event
from ..models import RoleEnum, User, UserStatusEnum
from ..services.badge_engine import BadgeEvent, process_badge_event
from ..services import notifications as notification_service
from ..services import audit_logger
from .models import (
    Ticket,
    TicketActivityLog,
    TicketApproval,
    TicketApprovalCycle,
    TicketApprovalCycleStatusEnum,
    TicketApprovalDecisionEnum,
    TicketApprovalItem,
    TicketApprovalItemStatusEnum,
    TicketApprovalStatusEnum,
    TicketApprovalTypeEnum,
    TicketApprovalUser,
    TicketFollower,
    TicketNotification,
    TicketParticipant,
    TicketParticipantRoleEnum,
    TicketPriorityEnum,
    TicketSlaPolicy,
    TicketStatusEnum,
    TicketStatusHistory,
    TicketAuditLog,
)
from .schemas import (
    TicketApprovalDecision,
    TicketApprovalRead,
    TicketApprovalRequest,
    TicketCreate,
    TicketParticipantsUpdate,
    TicketTransfer,
    TicketUpdate,
)


def _now() -> datetime:
    return datetime.utcnow()


MAX_APPROVAL_ATTEMPTS = 5
MAX_APPROVERS = 5


def _normalize_roles(roles: Iterable[str]) -> set[str]:
    return {str(role).lower() for role in roles}


def _has_role(roles: Iterable[str], *allowed: str) -> bool:
    allowed_set = {role.lower() for role in allowed if role}
    return bool(_normalize_roles(roles) & allowed_set)


def _get_participant_roles(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    user_id: str,
) -> set[TicketParticipantRoleEnum]:
    stmt = (
        select(TicketParticipant.role)
        .where(
            TicketParticipant.tenant_id == tenant_id,
            TicketParticipant.ticket_id == ticket_id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
    )
    roles = {row[0] for row in db.execute(stmt).all()}
    return roles


def _list_follower_ids(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[str]:
    stmt = (
        select(TicketFollower.user_id)
        .where(
            TicketFollower.tenant_id == tenant_id,
            TicketFollower.ticket_id == ticket_id,
            TicketFollower.deleted_at.is_(None),
        )
    )
    return [str(row[0]) for row in db.execute(stmt).all()]


def _resolve_default_assignee(
    db: Session,
    *,
    department_id: Optional[uuid.UUID],
) -> Optional[str]:
    if not department_id:
        return None
    stmt = (
        select(User)
        .where(
            User.department_id == department_id,
            User.role == RoleEnum.MANAGER,
            User.status == UserStatusEnum.ACTIVE,
        )
        .order_by(User.created_at.asc())
        .limit(1)
    )
    manager = db.execute(stmt).scalar_one_or_none()
    return str(manager.id) if manager else None


def _set_followers(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    follower_ids: Iterable[str],
    actor_id: str,
    ensure_user_id: Optional[str] = None,
) -> list[str]:
    unique_followers = {str(user_id) for user_id in follower_ids if user_id}
    if ensure_user_id:
        unique_followers.add(str(ensure_user_id))

    existing_rows = db.execute(
        select(TicketFollower)
        .where(
            TicketFollower.tenant_id == tenant_id,
            TicketFollower.ticket_id == ticket_id,
        )
    ).scalars().all()
    existing_map = {row.user_id: row for row in existing_rows}

    now = _now()
    for user_id in unique_followers:
        existing = existing_map.get(user_id)
        if existing and existing.deleted_at is None:
            continue
        if existing:
            existing.deleted_at = None
            existing.created_at = now
        else:
            db.add(
                TicketFollower(
                    tenant_id=tenant_id,
                    ticket_id=ticket_id,
                    user_id=user_id,
                    created_at=now,
                )
            )

    for user_id, existing in existing_map.items():
        if user_id in unique_followers:
            continue
        if ensure_user_id and user_id == ensure_user_id:
            continue
        if existing.deleted_at is None:
            existing.deleted_at = now

    return list(unique_followers)


def _is_owner(ticket: Ticket, roles: set[TicketParticipantRoleEnum], user_id: str) -> bool:
    return ticket.owner_id == user_id or TicketParticipantRoleEnum.OWNER in roles


def _is_assignee(roles: set[TicketParticipantRoleEnum]) -> bool:
    return TicketParticipantRoleEnum.ASSIGNEE in roles


def _is_creator(ticket: Ticket, user_id: str) -> bool:
    return ticket.created_by == user_id


def _apply_my_tickets_filter(
    stmt,
    *,
    tenant_id: uuid.UUID,
    user_id: str,
):
    participant_subq = (
        select(TicketParticipant.ticket_id)
        .where(
            TicketParticipant.tenant_id == tenant_id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
    )
    follower_subq = (
        select(TicketFollower.ticket_id)
        .where(
            TicketFollower.tenant_id == tenant_id,
            TicketFollower.user_id == user_id,
            TicketFollower.deleted_at.is_(None),
        )
    )
    return stmt.where(
        or_(
            Ticket.created_by == user_id,
            Ticket.owner_id == user_id,
            Ticket.id.in_(participant_subq),
            Ticket.id.in_(follower_subq),
        )
    )


def _apply_role_scope(
    stmt,
    *,
    tenant_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
):
    role_set = _normalize_roles(roles)
    if _has_role(role_set, "admin", "owner"):
        return stmt
    if _has_role(role_set, "manager"):
        if not current_user.department_id:
            return stmt.where(False)
        return stmt.where(Ticket.department_id == str(current_user.department_id))
    return _apply_my_tickets_filter(stmt, tenant_id=tenant_id, user_id=str(current_user.id))


def _log_activity(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    event_type: str,
    actor_id: Optional[str],
    payload: dict,
) -> None:
    log = TicketActivityLog(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        event_type=event_type,
        payload=payload,
        actor_id=actor_id,
        created_at=_now(),
    )
    db.add(log)


def _log_audit(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    event_type: str,
    actor_id: Optional[str],
    summary: str,
    payload: dict | None = None,
) -> None:
    db.add(
        TicketAuditLog(
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            event_type=event_type,
            actor_user_id=actor_id,
            created_at_utc=_now(),
            summary=summary,
            payload_json=payload,
        )
    )


def _load_sla_policy(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    department_id: Optional[uuid.UUID],
    priority: TicketPriorityEnum,
) -> Optional[TicketSlaPolicy]:
    if department_id is None:
        return None
    stmt = (
        select(TicketSlaPolicy)
        .where(
            TicketSlaPolicy.tenant_id == tenant_id,
            TicketSlaPolicy.department_id == department_id,
            TicketSlaPolicy.priority == priority,
            TicketSlaPolicy.deleted_at.is_(None),
        )
    )
    return db.execute(stmt).scalar_one_or_none()


def _apply_sla(
    ticket: Ticket,
    *,
    policy: Optional[TicketSlaPolicy],
    now: datetime,
) -> None:
    if not policy:
        ticket.sla_first_response_minutes = None
        ticket.sla_resolution_minutes = None
        ticket.first_response_due_at = None
        ticket.resolution_due_at = None
        return

    ticket.sla_first_response_minutes = policy.first_response_minutes
    ticket.sla_resolution_minutes = policy.resolution_minutes
    ticket.first_response_due_at = now + timedelta(minutes=policy.first_response_minutes)
    ticket.resolution_due_at = now + timedelta(minutes=policy.resolution_minutes)


def list_tickets(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    status_filter: Optional[TicketStatusEnum] = None,
    priority: Optional[TicketPriorityEnum] = None,
    department_id: Optional[uuid.UUID] = None,
    assignee_id: Optional[str] = None,
    follower_id: Optional[str] = None,
    search: Optional[str] = None,
    my_tickets: bool = False,
) -> list[Ticket]:
    stmt = select(Ticket).where(Ticket.deleted_at.is_(None))
    stmt = apply_tenant_filter(stmt, tenant_id)

    if status_filter:
        stmt = stmt.where(Ticket.status == status_filter)
    if priority:
        stmt = stmt.where(Ticket.priority == priority)
    if department_id:
        stmt = stmt.where(Ticket.department_id == department_id)
    if search:
        like_value = f"%{search.strip()}%"
        stmt = stmt.where(or_(Ticket.title.ilike(like_value), Ticket.description.ilike(like_value)))

    if assignee_id:
        assignee_subq = (
            select(TicketParticipant.ticket_id)
            .where(
                TicketParticipant.tenant_id == tenant_id,
                TicketParticipant.role == TicketParticipantRoleEnum.ASSIGNEE,
                TicketParticipant.user_id == assignee_id,
                TicketParticipant.deleted_at.is_(None),
            )
        )
        stmt = stmt.where(
            or_(
                Ticket.assigned_user_id == assignee_id,
                Ticket.owner_id == assignee_id,
                Ticket.id.in_(assignee_subq),
            )
        )

    if follower_id:
        follower_subq = (
            select(TicketFollower.ticket_id)
            .where(
                TicketFollower.tenant_id == tenant_id,
                TicketFollower.user_id == follower_id,
                TicketFollower.deleted_at.is_(None),
            )
        )
        stmt = stmt.where(Ticket.id.in_(follower_subq))

    stmt = _apply_role_scope(
        stmt,
        tenant_id=tenant_id,
        current_user=current_user,
        roles=roles,
    )

    if my_tickets:
        stmt = _apply_my_tickets_filter(stmt, tenant_id=tenant_id, user_id=str(current_user.id))

    return db.execute(stmt.order_by(Ticket.created_at.desc())).scalars().all()


def get_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> Ticket:
    stmt = select(Ticket).where(Ticket.id == ticket_id, Ticket.deleted_at.is_(None))
    stmt = apply_tenant_filter(stmt, tenant_id)
    ticket = db.execute(stmt).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def get_ticket_for_user(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    role_set = _normalize_roles(roles)
    if _has_role(role_set, "admin", "owner"):
        return ticket
    if _has_role(role_set, "manager"):
        if current_user.department_id and str(ticket.department_id) == str(current_user.department_id):
            return ticket
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view ticket")

    user_id = str(current_user.id)
    if ticket.owner_id == user_id or ticket.created_by == user_id:
        return ticket

    participant = db.execute(
        select(TicketParticipant)
        .where(
            TicketParticipant.tenant_id == tenant_id,
            TicketParticipant.ticket_id == ticket_id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if participant:
        return ticket

    follower = db.execute(
        select(TicketFollower)
        .where(
            TicketFollower.tenant_id == tenant_id,
            TicketFollower.ticket_id == ticket_id,
            TicketFollower.user_id == user_id,
            TicketFollower.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if follower:
        return ticket

    approval_item = db.execute(
        select(TicketApprovalItem.id)
        .join(TicketApprovalCycle, TicketApprovalCycle.id == TicketApprovalItem.cycle_id)
        .where(
            TicketApprovalItem.tenant_id == tenant_id,
            TicketApprovalItem.approver_user_id == user_id,
            TicketApprovalItem.status.in_(
                [TicketApprovalItemStatusEnum.PENDING, TicketApprovalItemStatusEnum.OVERDUE]
            ),
            TicketApprovalCycle.ticket_id == ticket_id,
            TicketApprovalCycle.status.in_(
                [TicketApprovalCycleStatusEnum.PENDING, TicketApprovalCycleStatusEnum.OVERDUE]
            ),
        )
        .limit(1)
    ).scalar_one_or_none()
    if approval_item:
        return ticket

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view ticket")


def create_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    current_user: User,
    payload: TicketCreate,
) -> Ticket:
    now = _now()
    user_id = str(current_user.id)
    requested_assignee = payload.assigned_user_id or payload.owner_id
    owner_id = str(requested_assignee) if requested_assignee else None
    if owner_id is None:
        owner_id = _resolve_default_assignee(db, department_id=payload.department_id)

    if payload.approval_enabled and not payload.due_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date is required when approvals are enabled",
        )
    if payload.min_approvals is not None and not (1 <= payload.min_approvals <= MAX_APPROVERS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Minimum approvals must be between 1 and 5",
        )

    approval_type = payload.approval_type
    min_approvals = payload.min_approvals
    approver_ids = [str(approver) for approver in payload.approvers]
    unique_approvers: list[str] = []
    for approver_id in approver_ids:
        if approver_id and approver_id not in unique_approvers:
            unique_approvers.append(approver_id)
    if len(unique_approvers) > MAX_APPROVERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum of 5 approvers allowed")
    if payload.approval_enabled:
        approval_type = approval_type or TicketApprovalTypeEnum.PARALLEL
        min_approvals = min_approvals or 1
        if unique_approvers and min_approvals > len(unique_approvers):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum approvals exceed approver count",
            )

    ticket = Ticket(
        tenant_id=tenant_id,
        department_id=payload.department_id,
        created_by=user_id,
        owner_id=owner_id,
        assigned_user_id=owner_id,
        title=payload.title,
        description=payload.description,
        due_at=payload.due_date,
        approval_enabled=payload.approval_enabled,
        approval_type=approval_type,
        min_approvals=min_approvals,
        approval_deadline=payload.approval_deadline,
        approval_approver_ids=unique_approvers,
        status=TicketStatusEnum.OPEN,
        priority=payload.priority,
        created_at=now,
        updated_at=now,
    )

    policy = _load_sla_policy(
        db,
        tenant_id=tenant_id,
        department_id=payload.department_id,
        priority=payload.priority,
    )
    _apply_sla(ticket, policy=policy, now=now)

    db.add(ticket)
    db.flush()

    db.add(
        TicketStatusHistory(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            from_status=None,
            to_status="CREATED",
            actor_user_id=user_id,
            moved_at_utc=now,
            metadata_json={"status": ticket.status.value},
        )
    )
    if ticket.owner_id:
        db.add(
            TicketStatusHistory(
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                from_status="CREATED",
                to_status="ASSIGNED",
                actor_user_id=user_id,
                moved_at_utc=now,
                metadata_json={"owner_id": ticket.owner_id},
            )
        )

    _set_followers(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        follower_ids=payload.followers,
        actor_id=user_id,
        ensure_user_id=user_id,
    )

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.created",
        actor_id=user_id,
        payload={"title": ticket.title, "priority": ticket.priority.value},
    )
    _log_audit(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.created",
        actor_id=user_id,
        summary="Ticket created.",
        payload={"priority": ticket.priority.value},
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.created",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={"priority": ticket.priority.value},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TICKET_CREATED",
            category=app_models.AuditLogCategoryEnum.TICKET,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            target_user_id=ticket.owner_id,
            source=app_models.AuditLogSourceEnum.MANUAL,
            after={
                "title": ticket.title,
                "priority": ticket.priority.value,
                "status": ticket.status.value,
                "owner_id": ticket.owner_id,
                "due_at": ticket.due_at.isoformat() if ticket.due_at else None,
            },
        )
    )

    if ticket.owner_id:
        notification_service.create_notification(
            db,
            user_id=str(ticket.owner_id),
            actor_id=user_id,
            notification_type=app_models.NotificationTypeEnum.TICKET_CREATED,
            message=f"Ticket '{ticket.title}' was created.",
            title="Ticket created",
            body=f"Ticket '{ticket.title}' was created.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="created",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=now,
        ),
    )
    if ticket.owner_id:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="ticket",
                event="assigned",
                actor_id=user_id,
                assigned_to_id=ticket.owner_id,
                created_by_id=ticket.created_by,
                priority=ticket.priority.value,
                occurred_at=now,
            ),
        )

    db.commit()
    db.refresh(ticket)

    emit_ticket_event(
        db,
        event_type="ticket.created",
        tenant_id=tenant_id,
        ticket=ticket,
        actor_id=user_id,
        payload={
            "priority": ticket.priority.value,
            "status": ticket.status.value,
        },
    )

    return ticket


def update_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketUpdate,
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    participant_roles = _get_participant_roles(
        db, tenant_id=tenant_id, ticket_id=ticket_id, user_id=user_id
    )

    if not (_has_role(roles, "admin", "owner") or _is_owner(ticket, participant_roles, user_id) or
            _is_assignee(participant_roles) or _is_creator(ticket, user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to update ticket")

    changes: dict[str, object] = {}
    previous_status = ticket.status
    previous_priority = ticket.priority
    previous_owner_id = ticket.owner_id
    previous_due_at = ticket.due_at
    previous_approval_enabled = ticket.approval_enabled
    previous_approval_type = ticket.approval_type
    previous_min_approvals = ticket.min_approvals
    now = _now()

    if payload.title is not None:
        ticket.title = payload.title
        changes["title"] = payload.title
    if payload.description is not None:
        ticket.description = payload.description
        changes["description"] = payload.description
    if payload.owner_id is not None or payload.assigned_user_id is not None:
        next_owner = payload.assigned_user_id or payload.owner_id
        ticket.owner_id = str(next_owner) if next_owner else None
        ticket.assigned_user_id = ticket.owner_id
        changes["owner_id"] = ticket.owner_id
    if payload.due_date is not None:
        ticket.due_at = payload.due_date
        changes["due_at"] = ticket.due_at.isoformat() if ticket.due_at else None
    if payload.approval_enabled is not None:
        ticket.approval_enabled = payload.approval_enabled
        changes["approval_enabled"] = payload.approval_enabled
    if payload.approval_type is not None:
        ticket.approval_type = payload.approval_type
        changes["approval_type"] = payload.approval_type.value
    if payload.min_approvals is not None:
        if not (1 <= payload.min_approvals <= MAX_APPROVERS):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum approvals must be between 1 and 5",
            )
        ticket.min_approvals = payload.min_approvals
        changes["min_approvals"] = payload.min_approvals
    if payload.approval_deadline is not None:
        ticket.approval_deadline = payload.approval_deadline
        changes["approval_deadline"] = (
            ticket.approval_deadline.isoformat() if ticket.approval_deadline else None
        )
    if payload.approvers is not None:
        unique_approvers: list[str] = []
        for approver_id in payload.approvers:
            if approver_id and approver_id not in unique_approvers:
                unique_approvers.append(str(approver_id))
        if len(unique_approvers) > MAX_APPROVERS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum of 5 approvers allowed")
        ticket.approval_approver_ids = unique_approvers
        changes["approval_approver_ids"] = unique_approvers
    if payload.status is not None:
        if payload.status == TicketStatusEnum.CLOSED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use close endpoint to close tickets",
            )
        if payload.status == TicketStatusEnum.RESOLVED:
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
        ticket.status = payload.status
        changes["status"] = payload.status.value
        if payload.status == TicketStatusEnum.RESOLVED:
            ticket.resolved_at = now
    if ticket.approval_enabled and ticket.due_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date is required when approvals are enabled",
        )
    if ticket.approval_enabled and ticket.min_approvals and ticket.approval_approver_ids:
        if ticket.min_approvals > len(ticket.approval_approver_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum approvals exceed approver count",
            )

    priority_changed = False
    if payload.priority is not None and payload.priority != ticket.priority:
        ticket.priority = payload.priority
        changes["priority"] = payload.priority.value
        priority_changed = True

    if priority_changed:
        policy = _load_sla_policy(
            db,
            tenant_id=tenant_id,
            department_id=ticket.department_id,
            priority=ticket.priority,
        )
        _apply_sla(ticket, policy=policy, now=now)

    if changes:
        before: dict[str, object] = {}
        after: dict[str, object] = {}
        if "status" in changes:
            before["status"] = previous_status.value
            after["status"] = ticket.status.value
        if "priority" in changes:
            before["priority"] = previous_priority.value
            after["priority"] = ticket.priority.value
        if "owner_id" in changes:
            before["owner_id"] = str(previous_owner_id) if previous_owner_id else None
            after["owner_id"] = ticket.owner_id
        if "due_at" in changes:
            before["due_at"] = previous_due_at.isoformat() if previous_due_at else None
            after["due_at"] = changes.get("due_at")
        if "approval_enabled" in changes:
            before["approval_enabled"] = previous_approval_enabled
            after["approval_enabled"] = ticket.approval_enabled
        if "approval_type" in changes:
            before["approval_type"] = (
                previous_approval_type.value if previous_approval_type else None
            )
            after["approval_type"] = ticket.approval_type.value if ticket.approval_type else None
        if "min_approvals" in changes:
            before["min_approvals"] = previous_min_approvals
            after["min_approvals"] = ticket.min_approvals

        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TICKET_UPDATED",
                category=app_models.AuditLogCategoryEnum.TICKET,
                actor_id=user_id,
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="ticket",
                entity_id=str(ticket.id),
                target_user_id=ticket.owner_id,
                source=app_models.AuditLogSourceEnum.MANUAL,
                before=before or None,
                after=after or None,
                metadata={"fields": list(changes.keys())},
            )
        )
        _log_activity(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.updated",
            actor_id=user_id,
            payload=changes,
        )
        _log_audit(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.updated",
            actor_id=user_id,
            summary="Ticket updated.",
            payload=changes,
        )
        db.add(
            app_models.AuditEvent(
                actor_id=user_id,
                event_type="ticket.updated",
                entity_type="ticket",
                entity_id=str(ticket.id),
                payload=changes,
                created_at=now,
            )
        )

    if ticket.owner_id != previous_owner_id and ticket.owner_id:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TICKET_ASSIGNED",
                category=app_models.AuditLogCategoryEnum.TICKET,
                actor_id=user_id,
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="ticket",
                entity_id=str(ticket.id),
                target_user_id=ticket.owner_id,
                source=app_models.AuditLogSourceEnum.MANUAL,
                before={"owner_id": str(previous_owner_id) if previous_owner_id else None},
                after={"owner_id": ticket.owner_id},
            )
        )
        notification_service.create_notification(
            db,
            user_id=str(ticket.owner_id),
            actor_id=user_id,
            notification_type=app_models.NotificationTypeEnum.TICKET_ASSIGNED,
            message=f"You were assigned ticket '{ticket.title}'.",
            title="Ticket assigned",
            body=f"You were assigned ticket '{ticket.title}'.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link=f"/tickets/{ticket.id}",
        )
        db.add(
            app_models.AuditEvent(
                actor_id=user_id,
                event_type="ticket.assigned",
                entity_type="ticket",
                entity_id=str(ticket.id),
                payload={"owner_id": ticket.owner_id},
                created_at=now,
            )
        )

        process_badge_event(
            db,
            event=BadgeEvent(
                entity="ticket",
                event="updated",
                actor_id=user_id,
                assigned_to_id=ticket.owner_id,
                created_by_id=ticket.created_by,
                priority=ticket.priority.value,
                occurred_at=now,
            ),
        )

    status_changed = payload.status is not None and ticket.status != previous_status
    if status_changed:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TICKET_STATUS_CHANGED",
                category=app_models.AuditLogCategoryEnum.TICKET,
                actor_id=user_id,
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="ticket",
                entity_id=str(ticket.id),
                target_user_id=ticket.owner_id,
                source=app_models.AuditLogSourceEnum.MANUAL,
                before={"status": previous_status.value},
                after={"status": ticket.status.value},
            )
        )
        stage_map = {
            TicketStatusEnum.WAITING: "APPROVAL",
            TicketStatusEnum.IN_PROGRESS: "IN_PROGRESS",
            TicketStatusEnum.RESOLVED: "RESOLVED",
            TicketStatusEnum.CLOSED: "CLOSED",
            TicketStatusEnum.OPEN: "ASSIGNED",
        }
        db.add(
            TicketStatusHistory(
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                from_status=stage_map.get(previous_status, previous_status.value),
                to_status=stage_map.get(ticket.status, ticket.status.value),
                actor_user_id=user_id,
                moved_at_utc=now,
                metadata_json={"from": previous_status.value, "to": ticket.status.value},
            )
        )
        _log_audit(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.status_changed",
            actor_id=user_id,
            summary=f"Status changed from {previous_status.value} to {ticket.status.value}.",
            payload={"from_status": previous_status.value, "to_status": ticket.status.value},
        )
        db.add(
            app_models.AuditEvent(
                actor_id=user_id,
                event_type="ticket.status_changed",
                entity_type="ticket",
                entity_id=str(ticket.id),
                payload={"from_status": previous_status.value, "to_status": ticket.status.value},
                created_at=now,
            )
        )

    if (
        (payload.owner_id is not None or payload.assigned_user_id is not None)
        and ticket.owner_id
        and ticket.owner_id != previous_owner_id
    ):
        db.add(
            TicketStatusHistory(
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                from_status="CREATED" if not previous_owner_id else "ASSIGNED",
                to_status="ASSIGNED",
                actor_user_id=user_id,
                moved_at_utc=now,
                metadata_json={"owner_id": ticket.owner_id},
            )
        )
        _log_audit(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.assigned",
            actor_id=user_id,
            summary="Ticket assigned.",
            payload={"owner_id": ticket.owner_id},
        )
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="ticket",
                event="status_changed",
                actor_id=user_id,
                assigned_to_id=ticket.owner_id,
                created_by_id=ticket.created_by,
                priority=ticket.priority.value,
                occurred_at=now,
            ),
        )
        if ticket.status in {TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED}:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="ticket",
                    event="completed",
                    actor_id=user_id,
                    assigned_to_id=ticket.owner_id,
                    created_by_id=ticket.created_by,
                    priority=ticket.priority.value,
                    occurred_at=now,
                ),
            )
        if previous_status in {TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED} and ticket.status == TicketStatusEnum.OPEN:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="ticket",
                    event="reopened",
                    actor_id=user_id,
                    assigned_to_id=ticket.owner_id,
                    created_by_id=ticket.created_by,
                    priority=ticket.priority.value,
                    occurred_at=now,
                ),
            )

    if ticket.priority != previous_priority:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="ticket",
                event="priority_changed",
                actor_id=user_id,
                assigned_to_id=ticket.owner_id,
                created_by_id=ticket.created_by,
                priority=ticket.priority.value,
                occurred_at=now,
            ),
        )
    if ticket.owner_id and ticket.owner_id != previous_owner_id:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="ticket",
                event="assigned",
                actor_id=user_id,
                assigned_to_id=ticket.owner_id,
                created_by_id=ticket.created_by,
                priority=ticket.priority.value,
                occurred_at=now,
            ),
        )

    if update_fields and ticket.created_by and ticket.created_by != user_id:
        notification_service.create_notification(
            db,
            user_id=str(ticket.created_by),
            actor_id=user_id,
            notification_type=app_models.NotificationTypeEnum.TICKET_UPDATED,
            message=f"Ticket '{ticket.title}' was updated.",
            title="Ticket updated",
            body=f"Ticket '{ticket.title}' was updated.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    db.commit()
    db.refresh(ticket)

    if payload.status is not None and ticket.status != previous_status:
        emit_ticket_event(
            db,
            event_type="ticket.status_changed",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "from_status": previous_status.value,
                "to_status": ticket.status.value,
            },
            include_followers=True,
        )

    if (
        (payload.owner_id is not None or payload.assigned_user_id is not None)
        and ticket.owner_id
        and ticket.owner_id != previous_owner_id
    ):
        emit_ticket_event(
            db,
            event_type="ticket.assigned",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "assignee_ids": [str(ticket.owner_id)],
                "role": "OWNER",
            },
            recipient_ids=[ticket.owner_id],
            include_participants=False,
        )

    return ticket


def soft_delete_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
) -> None:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    participant_roles = _get_participant_roles(
        db, tenant_id=tenant_id, ticket_id=ticket_id, user_id=user_id
    )

    if not (_has_role(roles, "admin", "owner") or _is_owner(ticket, participant_roles, user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete ticket")

    now = _now()
    ticket.deleted_at = now
    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.deleted",
        actor_id=user_id,
        payload={},
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.deleted",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={
                "title": ticket.title,
                "priority": ticket.priority.value,
                "status": ticket.status.value,
                "owner_id": str(ticket.owner_id) if ticket.owner_id else None,
            },
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TICKET_DELETED",
            category=app_models.AuditLogCategoryEnum.TICKET,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            target_user_id=str(ticket.owner_id) if ticket.owner_id else None,
            source=app_models.AuditLogSourceEnum.MANUAL,
            metadata={
                "title": ticket.title,
                "priority": ticket.priority.value,
                "status": ticket.status.value,
            },
        )
    )
    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="deleted",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=now,
        ),
    )
    if ticket.created_by and str(ticket.created_by) != user_id:
        notification_service.create_notification(
            db,
            user_id=str(ticket.created_by),
            actor_id=user_id,
            notification_type=app_models.NotificationTypeEnum.TICKET_DELETED,
            message=f"Ticket '{ticket.title}' was deleted.",
            title="Ticket deleted",
            body=f"Ticket '{ticket.title}' was deleted.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link="/tickets",
        )
    db.commit()


def transfer_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketTransfer,
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    participant_roles = _get_participant_roles(
        db, tenant_id=tenant_id, ticket_id=ticket_id, user_id=user_id
    )

    if not (_has_role(roles, "admin", "owner") or _is_owner(ticket, participant_roles, user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to transfer ticket")

    old_department_id = ticket.department_id
    ticket.department_id = payload.department_id

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.transferred",
        actor_id=user_id,
        payload={
            "from_department_id": str(old_department_id) if old_department_id else None,
            "to_department_id": str(payload.department_id),
        },
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TICKET_TRANSFERRED",
            category=app_models.AuditLogCategoryEnum.TICKET,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            target_user_id=str(ticket.owner_id) if ticket.owner_id else None,
            source=app_models.AuditLogSourceEnum.MANUAL,
            before={"department_id": str(old_department_id) if old_department_id else None},
            after={"department_id": str(payload.department_id)},
        )
    )

    _notify_department_members(
        db,
        tenant_id=tenant_id,
        department_id=payload.department_id,
        ticket=ticket,
    )

    db.commit()
    db.refresh(ticket)
    return ticket


def update_participants(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketParticipantsUpdate,
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    participant_roles = _get_participant_roles(
        db, tenant_id=tenant_id, ticket_id=ticket_id, user_id=user_id
    )

    if not (_has_role(roles, "admin", "owner") or _is_owner(ticket, participant_roles, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to manage participants",
        )

    now = _now()
    added: list[dict[str, str]] = []
    removed: list[dict[str, str]] = []
    assigned: list[dict[str, str]] = []

    for change in payload.add:
        participant_id = str(change.user_id)
        existing = db.execute(
            select(TicketParticipant)
            .where(
                TicketParticipant.tenant_id == tenant_id,
                TicketParticipant.ticket_id == ticket_id,
                TicketParticipant.user_id == participant_id,
                TicketParticipant.role == change.role,
            )
            .limit(1)
        ).scalar_one_or_none()

        if existing and existing.deleted_at is None:
            continue
        if existing:
            existing.deleted_at = None
            existing.added_by = user_id
            existing.created_at = now
        else:
            db.add(
                TicketParticipant(
                    tenant_id=tenant_id,
                    ticket_id=ticket_id,
                    user_id=participant_id,
                    role=change.role,
                    added_by=user_id,
                    created_at=now,
                )
            )
        added.append({"user_id": str(participant_id), "role": change.role.value})
        if change.role in {TicketParticipantRoleEnum.ASSIGNEE, TicketParticipantRoleEnum.OWNER}:
            assigned.append({"user_id": str(participant_id), "role": change.role.value})
        if change.role == TicketParticipantRoleEnum.FOLLOWER:
            current_followers = _list_follower_ids(db, tenant_id=tenant_id, ticket_id=ticket_id)
            _set_followers(
                db,
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                follower_ids=[*current_followers, participant_id],
                actor_id=user_id,
                ensure_user_id=ticket.created_by,
            )

    for change in payload.remove:
        participant_id = str(change.user_id)
        if change.role == TicketParticipantRoleEnum.FOLLOWER and participant_id == ticket.created_by:
            continue
        existing = db.execute(
            select(TicketParticipant)
            .where(
                TicketParticipant.tenant_id == tenant_id,
                TicketParticipant.ticket_id == ticket_id,
                TicketParticipant.user_id == participant_id,
                TicketParticipant.role == change.role,
                TicketParticipant.deleted_at.is_(None),
            )
            .limit(1)
        ).scalar_one_or_none()
        if not existing:
            continue
        existing.deleted_at = now
        removed.append({"user_id": str(participant_id), "role": change.role.value})
        if change.role == TicketParticipantRoleEnum.FOLLOWER:
            _set_followers(
                db,
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                follower_ids=[
                    follower_id
                    for follower_id in _list_follower_ids(db, tenant_id=tenant_id, ticket_id=ticket_id)
                    if follower_id != participant_id
                ],
                actor_id=user_id,
                ensure_user_id=ticket.created_by,
            )

    if added or removed:
        _log_activity(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.participants.updated",
            actor_id=user_id,
            payload={"added": added, "removed": removed},
        )

    db.commit()
    db.refresh(ticket)

    if assigned:
        emit_ticket_event(
            db,
            event_type="ticket.assigned",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "assignees": assigned,
                "assignee_ids": [entry["user_id"] for entry in assigned],
            },
            recipient_ids=[entry["user_id"] for entry in assigned],
            include_participants=False,
        )

    return ticket


def list_ticket_participants(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketParticipant]:
    stmt = (
        select(TicketParticipant)
        .where(
            TicketParticipant.tenant_id == tenant_id,
            TicketParticipant.ticket_id == ticket_id,
            TicketParticipant.deleted_at.is_(None),
        )
        .order_by(TicketParticipant.created_at.asc())
    )
    return db.execute(stmt).scalars().all()


def list_ticket_activity(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketActivityLog]:
    stmt = (
        select(TicketActivityLog)
        .where(
            TicketActivityLog.tenant_id == tenant_id,
            TicketActivityLog.ticket_id == ticket_id,
            TicketActivityLog.deleted_at.is_(None),
        )
        .order_by(TicketActivityLog.created_at.asc())
    )
    return db.execute(stmt).scalars().all()


def list_ticket_followers(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketFollower]:
    stmt = (
        select(TicketFollower)
        .where(
            TicketFollower.tenant_id == tenant_id,
            TicketFollower.ticket_id == ticket_id,
            TicketFollower.deleted_at.is_(None),
        )
        .order_by(TicketFollower.created_at.asc())
    )
    return db.execute(stmt).scalars().all()


def list_ticket_approvals(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> list[TicketApprovalRead]:
    approvals = db.execute(
        select(TicketApproval)
        .where(
            TicketApproval.tenant_id == tenant_id,
            TicketApproval.ticket_id == ticket_id,
        )
        .order_by(TicketApproval.attempt_no.asc())
    ).scalars().all()

    if not approvals:
        return []

    now = _now()
    for approval in approvals:
        if (
            approval.status == TicketApprovalStatusEnum.PENDING
            and approval.approval_deadline
            and approval.approval_deadline < now
        ):
            approval.status = TicketApprovalStatusEnum.EXPIRED
            approval.updated_at = now
            _log_activity(
                db,
                tenant_id=tenant_id,
                ticket_id=approval.ticket_id,
                event_type="ticket.approval.expired",
                actor_id=None,
                payload={"attempt_no": approval.attempt_no},
            )
    db.commit()

    approval_ids = [approval.id for approval in approvals]
    approver_rows = db.execute(
        select(TicketApprovalUser)
        .where(
            TicketApprovalUser.tenant_id == tenant_id,
            TicketApprovalUser.approval_id.in_(approval_ids),
        )
        .order_by(TicketApprovalUser.sequence_order.asc().nulls_last(), TicketApprovalUser.created_at.asc())
    ).scalars().all()

    approver_map: dict[uuid.UUID, list[TicketApprovalUser]] = {}
    for approver in approver_rows:
        approver_map.setdefault(approver.approval_id, []).append(approver)

    result: list[TicketApprovalRead] = []
    for approval in approvals:
        approvers = approver_map.get(approval.id, [])
        result.append(
            TicketApprovalRead(
                id=approval.id,
                ticket_id=approval.ticket_id,
                attempt_no=approval.attempt_no,
                approval_type=approval.approval_type,
                min_approvals=approval.min_approvals,
                status=approval.status,
                requested_by=approval.requested_by,
                approval_deadline=approval.approval_deadline,
                created_at=approval.created_at,
                updated_at=approval.updated_at,
                approvers=[
                    {
                        "user_id": approver.user_id,
                        "decision": approver.decision,
                        "comment": approver.comment,
                        "decided_at": approver.decided_at,
                        "sequence_order": approver.sequence_order,
                    }
                    for approver in approvers
                ],
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
    payload: TicketApprovalRequest,
) -> TicketApprovalRead:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    role_set = _normalize_roles(roles)

    if not (_has_role(role_set, "admin", "owner") or ticket.created_by == user_id or ticket.owner_id == user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to request approval")

    approvers = [str(approver) for approver in payload.approvers]
    unique_approvers = []
    for approver_id in approvers:
        if approver_id not in unique_approvers:
            unique_approvers.append(approver_id)

    if user_id in unique_approvers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot self-approve tickets")

    if len(unique_approvers) > MAX_APPROVERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum of 5 approvers allowed")

    attempt_count = db.execute(
        select(TicketApproval)
        .where(TicketApproval.tenant_id == tenant_id, TicketApproval.ticket_id == ticket_id)
        .order_by(TicketApproval.attempt_no.desc())
        .limit(1)
    ).scalar_one_or_none()
    next_attempt = (attempt_count.attempt_no + 1) if attempt_count else 1
    if next_attempt > MAX_APPROVAL_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum approval attempts reached")

    if attempt_count and attempt_count.status == TicketApprovalStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An approval attempt is already pending")

    approval_type = payload.approval_type or ticket.approval_type or TicketApprovalTypeEnum.PARALLEL
    min_approvals = payload.min_approvals or ticket.min_approvals or 1
    if not (1 <= min_approvals <= MAX_APPROVERS):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Minimum approvals must be between 1 and 5")
    if min_approvals > len(unique_approvers):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Minimum approvals exceed approver count")

    now = _now()
    approval = TicketApproval(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        attempt_no=next_attempt,
        approval_type=approval_type,
        min_approvals=min_approvals,
        status=TicketApprovalStatusEnum.PENDING,
        requested_by=user_id,
        approval_deadline=payload.approval_deadline,
        created_at=now,
        updated_at=now,
    )
    db.add(approval)
    db.flush()

    for index, approver_id in enumerate(unique_approvers):
        db.add(
            TicketApprovalUser(
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                approval_id=approval.id,
                user_id=str(approver_id),
                decision=TicketApprovalDecisionEnum.PENDING,
                created_at=now,
                sequence_order=index + 1,
            )
        )

    ticket.approval_enabled = True
    ticket.approval_type = approval_type
    ticket.min_approvals = min_approvals
    ticket.approval_deadline = payload.approval_deadline or ticket.approval_deadline

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        event_type="ticket.approval.requested",
        actor_id=user_id,
        payload={
            "attempt_no": approval.attempt_no,
            "approval_type": approval_type.value,
            "min_approvals": min_approvals,
            "approvers": unique_approvers,
        },
    )

    db.commit()
    db.refresh(approval)

    emit_ticket_event(
        db,
        event_type="ticket.approval.requested",
        tenant_id=tenant_id,
        ticket=ticket,
        actor_id=user_id,
        payload={
            "attempt_no": approval.attempt_no,
            "approval_type": approval_type.value,
            "min_approvals": min_approvals,
            "approvers": unique_approvers,
        },
        recipient_ids=unique_approvers,
        include_participants=False,
        include_followers=False,
    )

    return TicketApprovalRead(
        id=approval.id,
        ticket_id=approval.ticket_id,
        attempt_no=approval.attempt_no,
        approval_type=approval.approval_type,
        min_approvals=approval.min_approvals,
        status=approval.status,
        requested_by=approval.requested_by,
        approval_deadline=approval.approval_deadline,
        created_at=approval.created_at,
        updated_at=approval.updated_at,
        approvers=[
            {
                "user_id": str(approver_id),
                "decision": TicketApprovalDecisionEnum.PENDING,
                "comment": None,
                "decided_at": None,
                "sequence_order": index + 1,
            }
            for index, approver_id in enumerate(unique_approvers)
        ],
    )


def decide_ticket_approval(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    approval_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
    payload: TicketApprovalDecision,
) -> TicketApprovalRead:
    if payload.decision == TicketApprovalDecisionEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision must be approved or rejected")
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    approval = db.execute(
        select(TicketApproval)
        .where(
            TicketApproval.tenant_id == tenant_id,
            TicketApproval.ticket_id == ticket_id,
            TicketApproval.id == approval_id,
        )
    ).scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval attempt not found")
    if approval.status != TicketApprovalStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval attempt is not pending")

    user_id = str(current_user.id)
    role_set = _normalize_roles(roles)
    if user_id == ticket.created_by:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot self-approve tickets")

    approver = db.execute(
        select(TicketApprovalUser)
        .where(
            TicketApprovalUser.tenant_id == tenant_id,
            TicketApprovalUser.approval_id == approval_id,
            TicketApprovalUser.user_id == user_id,
        )
    ).scalar_one_or_none()

    if not approver:
        if _has_role(role_set, "admin", "owner"):
            approver = TicketApprovalUser(
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                approval_id=approval_id,
                user_id=user_id,
                decision=TicketApprovalDecisionEnum.PENDING,
                created_at=_now(),
            )
            db.add(approver)
            db.flush()
        elif _has_role(role_set, "manager") and current_user.department_id and ticket.department_id == current_user.department_id:
            approver = TicketApprovalUser(
                tenant_id=tenant_id,
                ticket_id=ticket_id,
                approval_id=approval_id,
                user_id=user_id,
                decision=TicketApprovalDecisionEnum.PENDING,
                created_at=_now(),
            )
            db.add(approver)
            db.flush()
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to approve")

    if approval.approval_type == TicketApprovalTypeEnum.SEQUENTIAL:
        next_pending = db.execute(
            select(TicketApprovalUser)
            .where(
                TicketApprovalUser.tenant_id == tenant_id,
                TicketApprovalUser.approval_id == approval_id,
                TicketApprovalUser.decision == TicketApprovalDecisionEnum.PENDING,
            )
            .order_by(TicketApprovalUser.sequence_order.asc().nulls_last(), TicketApprovalUser.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()
        if next_pending and next_pending.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sequential approval is pending another approver")

    now = _now()
    approver.decision = payload.decision
    approver.comment = payload.comment
    approver.decided_at = now

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        event_type="ticket.approval.decision",
        actor_id=user_id,
        payload={
            "attempt_no": approval.attempt_no,
            "decision": payload.decision.value,
            "comment": payload.comment,
        },
    )

    approval_users = db.execute(
        select(TicketApprovalUser)
        .where(
            TicketApprovalUser.tenant_id == tenant_id,
            TicketApprovalUser.approval_id == approval_id,
        )
    ).scalars().all()

    approved_count = sum(1 for row in approval_users if row.decision == TicketApprovalDecisionEnum.APPROVED)
    rejected_count = sum(1 for row in approval_users if row.decision == TicketApprovalDecisionEnum.REJECTED)

    final_status = approval.status
    if payload.decision == TicketApprovalDecisionEnum.REJECTED or rejected_count > 0:
        final_status = TicketApprovalStatusEnum.REJECTED
    elif approved_count >= approval.min_approvals:
        final_status = TicketApprovalStatusEnum.APPROVED

    if final_status != approval.status:
        approval.status = final_status
        approval.updated_at = now
        _log_activity(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            event_type="ticket.approval.result",
            actor_id=user_id,
            payload={
                "attempt_no": approval.attempt_no,
                "status": final_status.value,
            },
        )

    db.commit()

    approvers = db.execute(
        select(TicketApprovalUser)
        .where(
            TicketApprovalUser.tenant_id == tenant_id,
            TicketApprovalUser.approval_id == approval_id,
        )
        .order_by(TicketApprovalUser.sequence_order.asc().nulls_last(), TicketApprovalUser.created_at.asc())
    ).scalars().all()

    if final_status in {TicketApprovalStatusEnum.APPROVED, TicketApprovalStatusEnum.REJECTED}:
        emit_ticket_event(
            db,
            event_type="ticket.approval.result",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "attempt_no": approval.attempt_no,
                "status": final_status.value,
            },
            include_followers=True,
        )

    return TicketApprovalRead(
        id=approval.id,
        ticket_id=approval.ticket_id,
        attempt_no=approval.attempt_no,
        approval_type=approval.approval_type,
        min_approvals=approval.min_approvals,
        status=approval.status,
        requested_by=approval.requested_by,
        approval_deadline=approval.approval_deadline,
        created_at=approval.created_at,
        updated_at=approval.updated_at,
        approvers=[
            {
                "user_id": approver.user_id,
                "decision": approver.decision,
                "comment": approver.comment,
                "decided_at": approver.decided_at,
                "sequence_order": approver.sequence_order,
            }
            for approver in approvers
        ],
    )


def close_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    participant_roles = _get_participant_roles(
        db, tenant_id=tenant_id, ticket_id=ticket_id, user_id=user_id
    )

    if not (
        _has_role(roles, "admin", "owner")
        or _is_owner(ticket, participant_roles, user_id)
        or _is_assignee(participant_roles)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to close ticket")

    override_allowed = db.execute(
        select(app_models.Approval)
        .where(
            app_models.Approval.scope_type == app_models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE,
            app_models.Approval.scope_id == str(ticket_id),
            app_models.Approval.status == app_models.ApprovalStatusEnum.APPROVED,
        )
    ).scalar_one_or_none()
    if not override_allowed:
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
    previous_status = ticket.status
    ticket.status = TicketStatusEnum.CLOSED
    ticket.closed_at = now
    if ticket.resolved_at is None:
        ticket.resolved_at = now

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.closed",
        actor_id=user_id,
        payload={},
    )
    db.add(
        app_models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.closed",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TICKET_CLOSED",
            category=app_models.AuditLogCategoryEnum.TICKET,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            target_user_id=ticket.owner_id,
            source=app_models.AuditLogSourceEnum.MANUAL,
            before={"status": previous_status.value},
            after={"status": ticket.status.value},
        )
    )
    recipients = {ticket.owner_id, ticket.created_by}
    recipients.discard(None)
    for recipient_id in recipients:
        notification_service.create_notification(
            db,
            user_id=str(recipient_id),
            actor_id=user_id,
            notification_type=app_models.NotificationTypeEnum.TICKET_CLOSED,
            message=f"Ticket '{ticket.title}' closed.",
            title="Ticket closed",
            body=f"Ticket '{ticket.title}' was closed.",
            entity_type=app_models.NotificationEntityTypeEnum.TICKET,
            entity_id=str(ticket.id),
            deep_link=f"/tickets?status=CLOSED&ticketId={ticket.id}",
        )

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="status_changed",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=now,
        ),
    )
    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="completed",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=now,
        ),
    )

    db.commit()
    db.refresh(ticket)

    emit_ticket_event(
        db,
        event_type="ticket.closed",
        tenant_id=tenant_id,
        ticket=ticket,
        actor_id=user_id,
        payload={},
        include_followers=True,
    )

    if ticket.status != previous_status:
        emit_ticket_event(
            db,
            event_type="ticket.status_changed",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "from_status": previous_status.value,
                "to_status": ticket.status.value,
            },
            include_followers=True,
        )

    return ticket


def reopen_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: Iterable[str],
) -> Ticket:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)

    if not (_has_role(roles, "admin", "owner") or _is_creator(ticket, user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to reopen ticket")

    previous_status = ticket.status
    ticket.status = TicketStatusEnum.OPEN
    ticket.closed_at = None
    ticket.resolved_at = None

    _log_activity(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        event_type="ticket.reopened",
        actor_id=user_id,
        payload={},
    )

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="reopened",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=_now(),
        ),
    )
    process_badge_event(
        db,
        event=BadgeEvent(
            entity="ticket",
            event="status_changed",
            actor_id=user_id,
            assigned_to_id=ticket.owner_id,
            created_by_id=ticket.created_by,
            priority=ticket.priority.value,
            occurred_at=_now(),
        ),
    )

    db.commit()
    db.refresh(ticket)

    emit_ticket_event(
        db,
        event_type="ticket.reopened",
        tenant_id=tenant_id,
        ticket=ticket,
        actor_id=user_id,
        payload={},
        include_followers=True,
    )

    if ticket.status != previous_status:
        emit_ticket_event(
            db,
            event_type="ticket.status_changed",
            tenant_id=tenant_id,
            ticket=ticket,
            actor_id=user_id,
            payload={
                "from_status": previous_status.value,
                "to_status": ticket.status.value,
            },
            include_followers=True,
        )

    return ticket


def _notify_department_members(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    department_id: uuid.UUID,
    ticket: Ticket,
) -> None:
    stmt = select(User).where(User.department_id == str(department_id))
    users = db.execute(stmt).scalars().all()
    for user in users:
        user_id = str(user.id)
        notification = TicketNotification(
            tenant_id=tenant_id,
            user_id=user_id,
            type="ticket.transferred",
            title="Ticket transferred",
            body=f"Ticket '{ticket.title}' moved to your department.",
            data={"ticket_id": str(ticket.id)},
            is_read=False,
            created_at=_now(),
        )
        db.add(notification)
