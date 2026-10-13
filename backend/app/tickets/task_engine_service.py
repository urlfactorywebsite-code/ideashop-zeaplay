"""Ticket/task engine service for ticket-linked global tasks."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..services import notifications as notification_service
from .models import TicketTaskLink
from .service import get_ticket


def _now() -> datetime:
    return datetime.utcnow()


def _ensure_ticket_assignee(ticket, user_id: str) -> None:
    if not ticket.assigned_user_id or str(ticket.assigned_user_id) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned user can create ticket tasks",
        )


def list_ticket_tasks(
    db: Session,
    *,
    tenant_id,
    ticket_id,
) -> list[models.Task]:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    return (
        db.execute(
            select(models.Task)
            .where(models.Task.ticket_id == ticket.id)
            .order_by(models.Task.created_at.asc())
        )
        .scalars()
        .all()
    )


def create_ticket_task(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    payload,
) -> models.Task:
    ticket = get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    _ensure_ticket_assignee(ticket, user_id)

    approver_id = payload.approver_id
    if payload.approval_required and not approver_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approver required when approval is enabled",
        )
    if approver_id:
        approver = db.get(models.User, approver_id)
        if not approver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approver not found",
            )

    task = models.Task(
        title=ticket.title,
        description=ticket.description,
        status=models.TaskStatusEnum.TODO,
        priority=payload.priority,
        team="General",
        assigned_to_id=ticket.assigned_user_id or user_id,
        created_by_id=user_id,
        due_at=payload.due_at,
        approval_required=payload.approval_required,
        approval_status=models.TaskApprovalStatusEnum.NONE,
        approver_id=approver_id,
        ticket_id=ticket.id,
    )
    db.add(task)
    db.flush()

    db.add(
        TicketTaskLink(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            task_id=str(task.id),
            created_at=_now(),
        )
    )

    db.add(
        models.AuditEvent(
            actor_id=user_id,
            event_type="task.created",
            entity_type="task",
            entity_id=str(task.id),
            payload={
                "ticket_id": str(ticket.id),
                "approval_required": payload.approval_required,
                "approver_id": approver_id,
            },
            created_at=_now(),
        )
    )

    recipient_id = (
        approver_id if payload.approval_required and approver_id else ticket.owner_id or ticket.created_by or user_id
    )
    if recipient_id:
        notification_service.create_notification(
            db,
            user_id=str(recipient_id),
            notification_type=(
                models.NotificationTypeEnum.APPROVAL_REQUESTED
                if payload.approval_required
                else models.NotificationTypeEnum.TASK_ASSIGNED
            ),
            message=f"Task created for ticket '{ticket.title}'.",
            title="Ticket task created",
            body=f"Task '{task.title}' was created under ticket '{ticket.title}'.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=str(task.id),
            related_task_id=str(task.id),
        )

    db.commit()
    db.refresh(task)
    return task
