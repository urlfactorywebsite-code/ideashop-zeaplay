"""Approval workflows for ticket approvals and override-close requests."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..notifiers import get_notifier
from ..services import notifications as notification_service
from ..services import audit_logger
from .models import Ticket, TicketApprovalStateEnum, TicketStatusEnum
from .service import get_ticket, get_ticket_for_user


def _now() -> datetime:
    return datetime.utcnow()


def _normalize_roles(roles: Iterable[str]) -> set[str]:
    return {str(role).lower() for role in roles or []}


def _has_role(roles: Iterable[str], *allowed: str) -> bool:
    allowed_set = {role.lower() for role in allowed if role}
    return bool(_normalize_roles(roles) & allowed_set)


def request_ticket_approvals_sequential(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    roles: Iterable[str],
    approvers: list[tuple[str, str]],
) -> list[models.Approval]:
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
    if len(unique_approvers) > 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum of 5 approvers allowed")

    now = _now()
    approvals: list[models.Approval] = []
    for index, (approver_id, _) in enumerate(unique_approvers, start=1):
        approval = models.Approval(
            scope_type=models.ApprovalScopeTypeEnum.TICKET,
            scope_id=str(ticket.id),
            requested_by=user_id,
            approver_id=str(approver_id),
            order_index=index,
            status=models.ApprovalStatusEnum.PENDING,
            created_at=now,
        )
        db.add(approval)
        approvals.append(approval)

    ticket.approval_status = TicketApprovalStateEnum.PENDING
    db.add(
        models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.approval_requested",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={"approvers": [approver_id for approver_id, _ in unique_approvers]},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="APPROVAL_REQUESTED",
            category=models.AuditLogCategoryEnum.APPROVAL,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            target_user_id=user_id,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={
                "approver_ids": [approver_id for approver_id, _ in unique_approvers],
                "approval_count": len(unique_approvers),
            },
        )
    )

    db.flush()

    first = approvals[0]
    if first.approver_id and first.approver_id != user_id:
        notification_service.create_notification(
            db,
            user_id=str(first.approver_id),
            actor_id=user_id,
            notification_type=models.NotificationTypeEnum.APPROVAL_REQUESTED,
            message=f'{current_user.name or "Someone"} requested approval for "{ticket.title}".',
            title="Approval requested",
            body=f"Approval needed for ticket '{ticket.title}'.",
            entity_type=models.NotificationEntityTypeEnum.APPROVAL,
            entity_id=str(first.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    get_notifier().send_webex_message(
        f"Approval requested for ticket '{ticket.title}' (id: {ticket.id})."
    )

    return approvals


def act_on_ticket_approval(
    db: Session,
    *,
    tenant_id,
    approval_id: str,
    current_user: models.User,
    roles: Iterable[str],
    decision: str,
    comment: Optional[str],
) -> models.Approval:
    approval = db.get(models.Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found")
    if approval.scope_type != models.ApprovalScopeTypeEnum.TICKET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid approval scope")
    if approval.status != models.ApprovalStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval is not pending")

    user_id = str(current_user.id)
    if decision in {"approved", "rejected"} and approval.approver_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to act on approval")
    if decision == "cancelled" and not (
        approval.requested_by == user_id or _has_role(roles, "admin", "owner", "manager")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to cancel approval")
    if decision == "rejected" and not comment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reject requires comment")

    approvals = db.execute(
        select(models.Approval)
        .where(
            models.Approval.scope_type == models.ApprovalScopeTypeEnum.TICKET,
            models.Approval.scope_id == approval.scope_id,
        )
        .order_by(models.Approval.order_index.asc().nulls_last(), models.Approval.created_at.asc())
    ).scalars().all()
    pending = [row for row in approvals if row.status == models.ApprovalStatusEnum.PENDING]
    if pending:
        active = pending[0]
        if str(active.id) != str(approval.id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Awaiting another approver")

    now = _now()
    approval.status = models.ApprovalStatusEnum.PENDING
    if decision == "approved":
        approval.status = models.ApprovalStatusEnum.APPROVED
    elif decision == "rejected":
        approval.status = models.ApprovalStatusEnum.REJECTED
    else:
        approval.status = models.ApprovalStatusEnum.CANCELLED
    approval.acted_at = now
    if comment:
        approval.comment = comment

    if decision in {"rejected", "cancelled"}:
        for row in approvals:
            if row.id != approval.id and row.status == models.ApprovalStatusEnum.PENDING:
                row.status = models.ApprovalStatusEnum.CANCELLED
                row.acted_at = now

    ticket = db.execute(
        select(Ticket).where(Ticket.id == approval.scope_id)
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    if tenant_id and str(ticket.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    if decision == "approved":
        remaining = [row for row in approvals if row.status == models.ApprovalStatusEnum.PENDING and row.id != approval.id]
        if remaining:
            next_approval = remaining[0]
            if next_approval.approver_id and next_approval.approver_id != user_id:
                notification_service.create_notification(
                    db,
                    user_id=str(next_approval.approver_id),
                    actor_id=user_id,
                    notification_type=models.NotificationTypeEnum.APPROVAL_REQUESTED,
                    message=f"Approval requested for ticket '{ticket.title}'.",
                    title="Approval requested",
                    body=f"Please approve ticket '{ticket.title}'.",
                    entity_type=models.NotificationEntityTypeEnum.APPROVAL,
                    entity_id=str(next_approval.id),
                    deep_link=f"/tickets/{ticket.id}",
                )
            ticket.approval_status = TicketApprovalStateEnum.PENDING
        else:
            ticket.approval_status = TicketApprovalStateEnum.APPROVED
            if ticket.status not in {TicketStatusEnum.CLOSED, TicketStatusEnum.RESOLVED}:
                ticket.status = TicketStatusEnum.IN_PROGRESS
    elif decision == "rejected":
        ticket.approval_status = TicketApprovalStateEnum.REJECTED
    else:
        ticket.approval_status = TicketApprovalStateEnum.NONE

    db.add(
        models.AuditEvent(
            actor_id=user_id,
            event_type="ticket.approval_acted",
            entity_type="approval",
            entity_id=str(approval.id),
            payload={"decision": decision, "comment": comment},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="APPROVAL_DECISION",
            category=models.AuditLogCategoryEnum.APPROVAL,
            actor_id=user_id,
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="approval",
            entity_id=str(approval.id),
            approval_id=str(approval.id),
            target_user_id=approval.requested_by,
            source=models.AuditLogSourceEnum.MANUAL,
            status=models.AuditLogStatusEnum.SUCCESS,
            metadata={
                "decision": decision,
                "comment": comment,
                "ticket_id": str(approval.scope_id),
            },
        )
    )

    recipients = {approval.requested_by, ticket.owner_id, ticket.created_by}
    recipients.discard(None)
    recipients.discard(user_id)
    for recipient_id in recipients:
        notification_service.create_notification(
            db,
            user_id=str(recipient_id),
            actor_id=user_id,
            notification_type=models.NotificationTypeEnum.APPROVAL_ACTED,
            message=f"Approval {decision} for ticket '{ticket.title}'.",
            title=f"Approval {decision}",
            body=f"Approval for ticket '{ticket.title}' was {decision}.",
            entity_type=models.NotificationEntityTypeEnum.APPROVAL,
            entity_id=str(approval.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    return approval


def request_override_close(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    roles: Iterable[str],
) -> models.Approval:
    if not _has_role(roles, "owner", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners or managers can request override")

    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    now = _now()
    approval = models.Approval(
        scope_type=models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE,
        scope_id=str(ticket.id),
        requested_by=str(current_user.id),
        approver_id=str(ticket.created_by),
        order_index=1,
        status=models.ApprovalStatusEnum.PENDING,
        created_at=now,
    )
    db.add(approval)
    db.add(
        models.AuditEvent(
            actor_id=str(current_user.id),
            event_type="ticket.override_close_requested",
            entity_type="ticket",
            entity_id=str(ticket.id),
            payload={"approver_id": str(ticket.created_by)},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="APPROVAL_OVERRIDE_REQUESTED",
            category=models.AuditLogCategoryEnum.APPROVAL,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="ticket",
            entity_id=str(ticket.id),
            approval_id=str(approval.id),
            target_user_id=str(ticket.created_by) if ticket.created_by else None,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"approver_id": str(ticket.created_by)},
        )
    )
    db.flush()

    if ticket.created_by and str(ticket.created_by) != str(current_user.id):
        notification_service.create_notification(
            db,
            user_id=str(ticket.created_by),
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.APPROVAL_REQUESTED,
            message=f"Override close approval requested for ticket '{ticket.title}'.",
            title="Override close requested",
            body=f"Please approve override close for ticket '{ticket.title}'.",
            entity_type=models.NotificationEntityTypeEnum.APPROVAL,
            entity_id=str(approval.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    get_notifier().send_webex_message(
        f"Override close requested for ticket '{ticket.title}' (id: {ticket.id})."
    )

    return approval


def act_override_close(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    decision: str,
    comment: Optional[str],
) -> models.Approval:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    if str(ticket.created_by) != str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only ticket creator can act")

    approval = db.execute(
        select(models.Approval)
        .where(
            models.Approval.scope_type == models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE,
            models.Approval.scope_id == str(ticket.id),
            models.Approval.status == models.ApprovalStatusEnum.PENDING,
        )
        .order_by(models.Approval.created_at.desc())
    ).scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override approval not found")
    if decision == "rejected" and not comment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reject requires comment")

    now = _now()
    approval.status = models.ApprovalStatusEnum.APPROVED if decision == "approved" else models.ApprovalStatusEnum.REJECTED
    approval.comment = comment
    approval.acted_at = now

    db.add(
        models.AuditEvent(
            actor_id=str(current_user.id),
            event_type="ticket.override_close_acted",
            entity_type="approval",
            entity_id=str(approval.id),
            payload={"decision": decision, "comment": comment},
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="APPROVAL_OVERRIDE_DECISION",
            category=models.AuditLogCategoryEnum.APPROVAL,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="approval",
            entity_id=str(approval.id),
            approval_id=str(approval.id),
            target_user_id=approval.requested_by,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"decision": decision, "comment": comment, "ticket_id": str(ticket.id)},
        )
    )

    if approval.requested_by and approval.requested_by != str(current_user.id):
        notification_service.create_notification(
            db,
            user_id=str(approval.requested_by),
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.APPROVAL_ACTED,
            message=f"Override close {decision} for ticket '{ticket.title}'.",
            title=f"Override close {decision}",
            body=f"Override close for ticket '{ticket.title}' was {decision}.",
            entity_type=models.NotificationEntityTypeEnum.APPROVAL,
            entity_id=str(approval.id),
            deep_link=f"/tickets/{ticket.id}",
        )

    return approval
