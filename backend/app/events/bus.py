from __future__ import annotations

import enum
import logging
import uuid
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import User
from ..notifications import service as ticket_notifications
from ..tickets.models import Ticket, TicketFollower, TicketParticipant, TicketParticipantRoleEnum
from ..webhooks import payloads as webhook_payloads
from ..webhooks import service as webhook_service

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.utcnow()


def _serialize_value(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _serialize_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_serialize_value(item) for item in value]
    return value


def _resolve_recipient_ids(
    db: Session,
    *,
    ticket: Ticket,
    actor_id: str | None,
    recipient_ids: Iterable[str] | None,
    include_participants: bool,
    include_followers: bool,
    participant_roles: Iterable[TicketParticipantRoleEnum] | None,
) -> set[str]:
    recipients: set[str] = set(recipient_ids or [])

    if include_participants:
        if ticket.owner_id:
            recipients.add(ticket.owner_id)
        if ticket.created_by:
            recipients.add(ticket.created_by)

        participant_stmt = select(TicketParticipant.user_id).where(
            TicketParticipant.tenant_id == ticket.tenant_id,
            TicketParticipant.ticket_id == ticket.id,
            TicketParticipant.deleted_at.is_(None),
        )
        if participant_roles is not None:
            participant_stmt = participant_stmt.where(TicketParticipant.role.in_(participant_roles))
        else:
            participant_stmt = participant_stmt.where(TicketParticipant.role != TicketParticipantRoleEnum.FOLLOWER)
        participant_ids = db.execute(participant_stmt).scalars().all()
        recipients.update(participant_ids)

    if include_followers:
        follower_ids = db.execute(
            select(TicketFollower.user_id)
            .where(
                TicketFollower.tenant_id == ticket.tenant_id,
                TicketFollower.ticket_id == ticket.id,
                TicketFollower.deleted_at.is_(None),
            )
        ).scalars().all()
        recipients.update(follower_ids)

    if actor_id:
        recipients.discard(actor_id)
    recipients.discard(None)
    return recipients


def _load_actor(db: Session, actor_id: str | None) -> User | None:
    if not actor_id:
        return None
    return db.get(User, str(actor_id))


def _build_context(
    *,
    ticket: Ticket,
    actor: User | None,
    event_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    def _list_value(key: str) -> str:
        raw = payload.get(key)
        if isinstance(raw, list):
            return ", ".join(str(item) for item in raw)
        if raw is None:
            return ""
        return str(raw)

    return {
        "event_type": event_type,
        "tenant_id": str(ticket.tenant_id),
        "ticket_id": str(ticket.id),
        "ticket_title": ticket.title,
        "ticket_status": ticket.status.value,
        "ticket_priority": ticket.priority.value,
        "ticket_department_id": str(ticket.department_id) if ticket.department_id else "",
        "ticket_owner_id": str(ticket.owner_id) if ticket.owner_id else "",
        "ticket_created_by": str(ticket.created_by),
        "actor_id": str(actor.id) if actor else "",
        "actor_name": actor.name if actor else "Someone",
        "status_from": payload.get("from_status", ""),
        "status_to": payload.get("to_status", ""),
        "comment_body": payload.get("comment_body", ""),
        "attempt_no": payload.get("attempt_no", ""),
        "approval_status": payload.get("status", ""),
        "decision": payload.get("decision", ""),
        "assignee_ids": _list_value("assignee_ids"),
        "mentioned_user_ids": _list_value("mentioned_user_ids"),
    }


def emit_ticket_event(
    db: Session,
    *,
    event_type: str,
    tenant_id: uuid.UUID,
    ticket: Ticket,
    actor_id: str | None,
    payload: dict[str, Any] | None = None,
    recipient_ids: Iterable[str] | None = None,
    include_participants: bool = True,
    include_followers: bool = False,
    participant_roles: Iterable[TicketParticipantRoleEnum] | None = None,
) -> None:
    if not event_type:
        return

    payload_data = _serialize_value(payload or {})
    if not isinstance(payload_data, dict):
        payload_data = {"value": payload_data}
    event_payload = {
        "event": event_type,
        "tenant_id": str(tenant_id),
        "ticket_id": str(ticket.id),
        "actor_id": str(actor_id) if actor_id else None,
        "data": payload_data,
        "occurred_at": _now().isoformat(),
    }

    recipients = _resolve_recipient_ids(
        db,
        ticket=ticket,
        actor_id=actor_id,
        recipient_ids=recipient_ids,
        include_participants=include_participants,
        include_followers=include_followers,
        participant_roles=participant_roles,
    )
    actor = _load_actor(db, actor_id)
    context = _build_context(
        ticket=ticket,
        actor=actor,
        event_type=event_type,
        payload=payload_data,
    )

    created_notifications = []
    created_webhooks = []
    try:
        if recipients:
            created_notifications = ticket_notifications.create_ticket_notifications(
                db,
                tenant_id=tenant_id,
                recipient_ids=recipients,
                event_type=event_type,
                context=context,
                data=event_payload,
            )

        if event_type.startswith("ticket."):
            webhook_data = webhook_payloads.build_ticket_webhook_payload(
                event_name=event_type,
                ticket=ticket,
                actor=actor,
                occurred_at=_now(),
            )
        else:
            webhook_data = webhook_payloads.build_ticket_event_data(
                ticket=ticket,
                actor=actor,
                payload=payload_data,
            )
        created_webhooks = webhook_service.queue_event(
            db,
            event_name=event_type,
            data=webhook_data,
        )

        if created_notifications or created_webhooks:
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to enqueue ticket event %s", event_type)
        return

    if recipients:
        ticket_notifications.send_ticket_emails(
            db,
            recipient_ids=recipients,
            event_type=event_type,
            context=context,
        )

    # Webhooks are dispatched asynchronously by the background worker.
