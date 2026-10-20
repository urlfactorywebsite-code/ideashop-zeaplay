"""Shared recipient authorization for legacy ticket events and the unified bell."""
from __future__ import annotations

from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models


def eligible_ticket_recipients(db: Session, *, ticket, recipient_ids, actor_id=None) -> list[models.User]:
    from ..tickets.service import get_ticket_for_user

    ids = {str(value) for value in recipient_ids if value}
    ids.discard(str(actor_id))
    if not ids:
        return []
    users = db.scalars(select(models.User).where(
        models.User.id.in_(ids), models.User.tenant_id == ticket.tenant_id,
        models.User.status == models.UserStatusEnum.ACTIVE,
    )).all()
    eligible = []
    for user in users:
        try:
            get_ticket_for_user(db, tenant_id=ticket.tenant_id, ticket_id=ticket.id,
                current_user=user, roles=[user.role.value])
        except HTTPException:
            continue
        eligible.append(user)
    return eligible


def ticket_audience(db: Session, *, ticket, actor_id=None) -> list[models.User]:
    from ..tickets.models import TicketFollower, TicketParticipant

    db.flush()
    ids = {ticket.owner_id, ticket.created_by}
    ids.update(db.scalars(select(TicketParticipant.user_id).where(
        TicketParticipant.tenant_id == ticket.tenant_id, TicketParticipant.ticket_id == ticket.id,
        TicketParticipant.deleted_at.is_(None))))
    ids.update(db.scalars(select(TicketFollower.user_id).where(
        TicketFollower.tenant_id == ticket.tenant_id, TicketFollower.ticket_id == ticket.id,
        TicketFollower.deleted_at.is_(None))))
    ids.update(db.scalars(select(models.User.id).where(
        models.User.tenant_id == ticket.tenant_id,
        or_(models.User.role.in_({models.RoleEnum.ADMIN, models.RoleEnum.OWNER}),
            (models.User.role == models.RoleEnum.MANAGER)
            & (models.User.department_id == str(ticket.department_id))))))
    return eligible_ticket_recipients(db, ticket=ticket, recipient_ids=ids, actor_id=actor_id)


def notify_ticket_change(db: Session, *, ticket, actor, kind, title: str, message: str) -> None:
    from .notifications import create_notification

    for recipient in ticket_audience(db, ticket=ticket, actor_id=actor.id):
        create_notification(
            db, user_id=recipient.id, tenant_id=ticket.tenant_id, actor_id=actor.id,
            notification_type=kind, message=message, title=title, body=message,
            entity_type=models.NotificationEntityTypeEnum.TICKET, entity_id=str(ticket.id),
            deep_link=f"/tickets/{ticket.id}", dedupe_key=ticket_notification_key(ticket, kind),
        )


def ticket_notification_key(ticket, kind: models.NotificationTypeEnum) -> str:
    version = ticket.created_at if kind == models.NotificationTypeEnum.TICKET_CREATED else ticket.updated_at
    normalized = version.replace(tzinfo=timezone.utc) if version.tzinfo is None else version.astimezone(timezone.utc)
    return f"ticket:{ticket.id}:{kind.value}:{normalized.isoformat()}"
