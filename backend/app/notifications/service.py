from __future__ import annotations

import logging
import uuid
from datetime import datetime
from string import Template
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..email_utils import EmailDeliveryError
from ..emails import smtp as email_sender
from ..models import User
from ..tickets.models import TicketNotification

logger = logging.getLogger(__name__)

DEFAULT_NOTIFICATION_TEMPLATES: dict[str, dict[str, str]] = {
    "ticket.created": {
        "title": "Ticket created",
        "body": "$actor_name created ticket \"$ticket_title\".",
    },
    "ticket.status_changed": {
        "title": "Ticket status updated",
        "body": "Ticket \"$ticket_title\" moved from $status_from to $status_to.",
    },
    "ticket.closed": {
        "title": "Ticket closed",
        "body": "$actor_name closed ticket \"$ticket_title\".",
    },
    "ticket.reopened": {
        "title": "Ticket reopened",
        "body": "$actor_name reopened ticket \"$ticket_title\".",
    },
    "ticket.assigned": {
        "title": "Ticket assigned",
        "body": "You were assigned to ticket \"$ticket_title\".",
    },
    "ticket.mentioned": {
        "title": "You were mentioned",
        "body": "$actor_name mentioned you on ticket \"$ticket_title\".",
    },
    "ticket.approval.requested": {
        "title": "Approval requested",
        "body": "$actor_name requested approval for \"$ticket_title\" (attempt $attempt_no).",
    },
    "ticket.approval.result": {
        "title": "Approval result",
        "body": "Approval attempt $attempt_no for \"$ticket_title\" is $approval_status.",
    },
    "ticket.approval.decision": {
        "title": "Approval decision recorded",
        "body": "$actor_name marked approval for \"$ticket_title\" as $decision.",
    },
    "ticket.approval.expired": {
        "title": "Approval expired",
        "body": "Approval attempt $attempt_no for \"$ticket_title\" expired.",
    },
}

DEFAULT_FALLBACK_TEMPLATE = {
    "title": "Ticket update",
    "body": "Ticket \"$ticket_title\" has a new update.",
}


def _now() -> datetime:
    return datetime.utcnow()


def _normalize_recipient_ids(recipient_ids: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in recipient_ids:
        user_id = str(raw).strip()
        if not user_id:
            continue
        if user_id in seen:
            continue
        seen.add(user_id)
        normalized.append(user_id)
    return normalized


def _render_notification(event_type: str, context: dict[str, Any]) -> tuple[str, str]:
    template = DEFAULT_NOTIFICATION_TEMPLATES.get(event_type, DEFAULT_FALLBACK_TEMPLATE)
    title = Template(template["title"]).safe_substitute(context).strip()
    body = Template(template["body"]).safe_substitute(context).strip()
    return title, body


def create_ticket_notifications(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    recipient_ids: Iterable[str],
    event_type: str,
    context: dict[str, Any],
    data: dict[str, Any],
) -> list[TicketNotification]:
    recipients = _normalize_recipient_ids(recipient_ids)
    if not recipients:
        return []

    title, body = _render_notification(event_type, context)
    now = _now()
    notifications: list[TicketNotification] = []
    for user_id in recipients:
        notification = TicketNotification(
            tenant_id=tenant_id,
            user_id=user_id,
            type=event_type,
            title=title,
            body=body,
            data=data,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        notifications.append(notification)
    return notifications


def send_ticket_emails(
    db: Session,
    *,
    recipient_ids: Iterable[str],
    event_type: str,
    context: dict[str, Any],
) -> None:
    recipients = _normalize_recipient_ids(recipient_ids)
    if not recipients:
        return

    recipient_lookup = [str(user_id) for user_id in recipients]
    users = db.execute(select(User).where(User.id.in_(recipient_lookup))).scalars().all()

    for user in users:
        if not user.email:
            continue
        email_context = dict(context)
        email_context.update(
            {
                "recipient_name": user.name or user.email,
                "recipient_email": user.email,
                "recipient_id": user.id,
            }
        )
        try:
            email_sender.send_ticket_event_email(
                db,
                to_address=user.email,
                event_type=event_type,
                context=email_context,
            )
        except EmailDeliveryError as exc:
            logger.warning("Failed to send ticket email to %s: %s", user.email, exc)
