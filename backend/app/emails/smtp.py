from __future__ import annotations

from pathlib import Path
from string import Template
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..email_utils import send_notification_email

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

DEFAULT_TEMPLATES: dict[str, dict[str, str]] = {
    "ticket.created": {
        "subject": "Ticket created: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name created a ticket.\n\n"
            "Title: $ticket_title\n"
            "Status: $ticket_status\n"
            "Priority: $ticket_priority\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.status_changed": {
        "subject": "Ticket status changed: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name updated the status on \"$ticket_title\".\n\n"
            "From: $status_from\n"
            "To: $status_to\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.closed": {
        "subject": "Ticket closed: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name closed the ticket \"$ticket_title\".\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.reopened": {
        "subject": "Ticket reopened: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name reopened the ticket \"$ticket_title\".\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.assigned": {
        "subject": "Ticket assigned: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "You have been assigned to \"$ticket_title\".\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.mentioned": {
        "subject": "You were mentioned: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name mentioned you on \"$ticket_title\".\n\n"
            "Comment:\n"
            "$comment_body\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.approval.requested": {
        "subject": "Approval requested: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name requested approval for \"$ticket_title\".\n\n"
            "Attempt: $attempt_no\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.approval.result": {
        "subject": "Approval result: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "Approval attempt $attempt_no for \"$ticket_title\" is $approval_status.\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.approval.decision": {
        "subject": "Approval decision recorded: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "$actor_name recorded an approval decision on \"$ticket_title\".\n\n"
            "Decision: $decision\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
    "ticket.approval.expired": {
        "subject": "Approval expired: $ticket_title",
        "body": (
            "Hi $recipient_name,\n\n"
            "Approval attempt $attempt_no for \"$ticket_title\" expired.\n\n"
            "Ticket ID: $ticket_id\n"
        ),
    },
}

DEFAULT_FALLBACK = {
    "subject": "Ticket update: $ticket_title",
    "body": "Hi $recipient_name,\n\nTicket \"$ticket_title\" has a new update.\n",
}


def _read_template(event_type: str, kind: str) -> str | None:
    path = TEMPLATE_DIR / f"{event_type}.{kind}.txt"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def _render_template(event_type: str, context: Mapping[str, Any]) -> tuple[str, str]:
    subject_template = _read_template(event_type, "subject")
    body_template = _read_template(event_type, "body")

    defaults = DEFAULT_TEMPLATES.get(event_type, DEFAULT_FALLBACK)
    subject_source = subject_template or defaults["subject"]
    body_source = body_template or defaults["body"]

    subject = Template(subject_source).safe_substitute(context).strip()
    body = Template(body_source).safe_substitute(context).strip()
    return subject, body


def send_ticket_event_email(
    db: Session,
    *,
    to_address: str,
    event_type: str,
    context: Mapping[str, Any],
) -> None:
    subject, body = _render_template(event_type, context)
    send_notification_email(
        db=db,
        notification_type=event_type,
        to_address=to_address,
        subject=subject,
        body=body,
    )
