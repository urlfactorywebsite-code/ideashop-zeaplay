from __future__ import annotations

import logging
import uuid
from datetime import datetime
from string import Template
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ..email_utils import EmailDeliveryError
from ..emails import smtp as email_sender
from .. import models
from ..services.notifications import create_notification
from ..services.ticket_notification_access import eligible_ticket_recipients, ticket_notification_key
from ..tickets.models import Ticket, TicketNotification

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
    try:
        ticket = db.get(Ticket, uuid.UUID(str(context["ticket_id"])))
    except (KeyError, TypeError, ValueError):
        return []
    if not ticket or ticket.tenant_id != tenant_id:
        return []
    recipients = [user.id for user in eligible_ticket_recipients(
        db, ticket=ticket, recipient_ids=recipients, actor_id=context.get("actor_id"))]

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
        kind = {
            "ticket.created": models.NotificationTypeEnum.TICKET_CREATED,
            "ticket.status_changed": models.NotificationTypeEnum.TICKET_UPDATED,
            "ticket.reopened": models.NotificationTypeEnum.TICKET_UPDATED,
            "ticket.assigned": models.NotificationTypeEnum.TICKET_ASSIGNED,
            "ticket.closed": models.NotificationTypeEnum.TICKET_CLOSED,
            "ticket.mentioned": models.NotificationTypeEnum.MENTION,
            "ticket.approval.expired": models.NotificationTypeEnum.APPROVAL_ACTED,
        }.get(event_type)
        if event_type == "ticket.status_changed" and data.get("data", {}).get("to_status") == "CLOSED":
            kind = models.NotificationTypeEnum.TICKET_CLOSED
        if kind is not None:
            shared_version = event_type in {
                "ticket.created", "ticket.status_changed", "ticket.reopened", "ticket.closed",
            } or (event_type == "ticket.assigned" and data.get("data", {}).get("role") == "OWNER")
            key = ticket_notification_key(ticket, kind) if shared_version else (
                f"ticket:{ticket.id}:{event_type}:{context.get('event_id') or uuid.uuid4()}")
            create_notification(
                db, user_id=user_id, tenant_id=tenant_id, actor_id=context.get("actor_id") or None,
                notification_type=kind, message=body, title=title, body=body,
                entity_type=models.NotificationEntityTypeEnum.TICKET, entity_id=str(ticket.id),
                deep_link=f"/tickets/{ticket.id}", dedupe_key=key,
            )
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

    try:
        tenant_id = uuid.UUID(str(context['tenant_id']))
        ticket = db.get(Ticket, uuid.UUID(str(context["ticket_id"])))
    except (KeyError, ValueError, TypeError):
        return
    if not ticket or ticket.tenant_id != tenant_id:
        return
    users = eligible_ticket_recipients(
        db, ticket=ticket, recipient_ids=recipients, actor_id=context.get("actor_id"))

    for user in users:
        if not user.email:
            continue
        email_context = dict(context)
        email_context.update(
            {
                "recipient_name": user.name or user.email,
                "recipient_email": user.email,
                "recipient_id": user.id,
                "recipient_tenant_id": str(user.tenant_id),
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
