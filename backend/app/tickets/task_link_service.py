"""Ticket-to-task linking service."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..events.bus import emit_ticket_event
from ..services.gamification import COMPLETED_STATUSES
from .models import Ticket, TicketActivityLog, TicketPriorityEnum, TicketStatusEnum, TicketTaskLink, TicketParticipant, TicketParticipantRoleEnum


def _now() -> datetime:
    return datetime.utcnow()


def _normalize_roles(roles: Iterable[str]) -> set[str]:
    return {str(role).lower() for role in roles or []}


def _user_can_access_ticket(
    db: Session,
    *,
    ticket: Ticket,
    user_id: str,
    roles: Iterable[str],
) -> bool:
    role_set = _normalize_roles(roles)
    if role_set.intersection({"admin", "owner"}):
        return True
    if ticket.owner_id == user_id or ticket.created_by == user_id:
        return True
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
    if not participant:
        return False
    return participant.role in {
        TicketParticipantRoleEnum.OWNER,
        TicketParticipantRoleEnum.ASSIGNEE,
        TicketParticipantRoleEnum.FOLLOWER,
    }


def _fetch_ticket(db: Session, *, tenant_id, ticket_id) -> Ticket:
    ticket = db.execute(
        select(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _map_priority(ticket_priority: TicketPriorityEnum) -> models.TaskPriorityEnum:
    if ticket_priority == TicketPriorityEnum.CRITICAL:
        return models.TaskPriorityEnum.URGENT
    if ticket_priority == TicketPriorityEnum.HIGH:
        return models.TaskPriorityEnum.HIGH
    if ticket_priority == TicketPriorityEnum.MEDIUM:
        return models.TaskPriorityEnum.MEDIUM
    return models.TaskPriorityEnum.LOW


def _create_task_from_ticket(
    db: Session,
    *,
    ticket: Ticket,
    created_by_id: str,
    title: str,
    description: str,
) -> models.Task:
    task = models.Task(
        title=title,
        description=description,
        status=models.TaskStatusEnum.TODO,
        priority=_map_priority(ticket.priority),
        team="General",
        assigned_to_id=str(ticket.owner_id) if ticket.owner_id else None,
        created_by_id=created_by_id,
        ticket_id=ticket.id,
    )
    db.add(task)
    db.flush()
    return task


def _link_task(db: Session, *, tenant_id, ticket_id, task_id: str) -> None:
    link = TicketTaskLink(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        task_id=str(task_id),
        created_at=_now(),
    )
    db.add(link)


def create_task_for_ticket(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    roles: Iterable[str],
) -> models.Task:
    ticket = _fetch_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    if not _user_can_access_ticket(db, ticket=ticket, user_id=user_id, roles=roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for ticket")

    task = _create_task_from_ticket(
        db,
        ticket=ticket,
        created_by_id=current_user.id,
        title=ticket.title,
        description=ticket.description,
    )
    _link_task(db, tenant_id=tenant_id, ticket_id=ticket.id, task_id=task.id)

    db.add(
        TicketActivityLog(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.task_linked",
            payload={"task_id": task.id, "source": "create"},
            actor_id=user_id,
            created_at=_now(),
        )
    )

    db.commit()
    db.refresh(task)
    _resolve_ticket_if_all_tasks_completed(db, tenant_id=tenant_id, ticket_id=ticket.id)
    return task


def split_ticket_into_tasks(
    db: Session,
    *,
    tenant_id,
    ticket_id,
    current_user: models.User,
    roles: Iterable[str],
    items: list[dict[str, str]],
) -> list[models.Task]:
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one task is required")

    ticket = _fetch_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    if not _user_can_access_ticket(db, ticket=ticket, user_id=user_id, roles=roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for ticket")

    tasks: list[models.Task] = []
    for item in items:
        title = (item.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task title is required")
        description = (item.get("description") or ticket.description).strip()
        task = _create_task_from_ticket(
            db,
            ticket=ticket,
            created_by_id=current_user.id,
            title=title,
            description=description,
        )
        _link_task(db, tenant_id=tenant_id, ticket_id=ticket.id, task_id=task.id)
        tasks.append(task)

    db.add(
        TicketActivityLog(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.task_split",
            payload={"task_ids": [task.id for task in tasks]},
            actor_id=user_id,
            created_at=_now(),
        )
    )

    db.commit()
    for task in tasks:
        db.refresh(task)

    _resolve_ticket_if_all_tasks_completed(db, tenant_id=tenant_id, ticket_id=ticket.id)
    return tasks


def handle_task_completion(db: Session, *, task_id: str) -> None:
    links = db.execute(
        select(TicketTaskLink.tenant_id, TicketTaskLink.ticket_id)
        .where(
            TicketTaskLink.task_id == str(task_id),
            TicketTaskLink.deleted_at.is_(None),
        )
    ).all()
    if not links:
        return

    seen: set[tuple] = set()
    for tenant_id, ticket_id in links:
        key = (tenant_id, ticket_id)
        if key in seen:
            continue
        seen.add(key)
        _resolve_ticket_if_all_tasks_completed(db, tenant_id=tenant_id, ticket_id=ticket_id)


def _resolve_ticket_if_all_tasks_completed(
    db: Session,
    *,
    tenant_id,
    ticket_id,
) -> None:
    links = db.execute(
        select(TicketTaskLink.task_id)
        .where(
            TicketTaskLink.tenant_id == tenant_id,
            TicketTaskLink.ticket_id == ticket_id,
            TicketTaskLink.deleted_at.is_(None),
        )
    ).scalars().all()

    if not links:
        return

    task_ids = [str(task_id) for task_id in links]
    tasks = db.execute(
        select(models.Task.id, models.Task.status)
        .where(models.Task.id.in_(task_ids))
    ).all()

    if len(tasks) != len(set(task_ids)):
        return

    if not all(status in COMPLETED_STATUSES for _, status in tasks):
        return

    ticket = db.execute(
        select(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()

    if not ticket or ticket.status in {TicketStatusEnum.CLOSED, TicketStatusEnum.RESOLVED}:
        return

    previous_status = ticket.status
    ticket.status = TicketStatusEnum.RESOLVED
    ticket.resolved_at = _now()
    db.add(
        TicketActivityLog(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            event_type="ticket.auto_resolved",
            payload={"task_ids": [task_id for task_id, _ in tasks]},
            actor_id=None,
            created_at=_now(),
        )
    )
    db.commit()

    emit_ticket_event(
        db,
        event_type="ticket.status_changed",
        tenant_id=tenant_id,
        ticket=ticket,
        actor_id=None,
        payload={
            "from_status": previous_status.value,
            "to_status": ticket.status.value,
            "reason": "all_tasks_completed",
        },
    )
