"""Utility helpers for sending email via configured SMTP."""

from typing import Optional, Union
import logging

from sqlalchemy.orm import Session

from . import models
from .services import audit_logger


from .services.smtp_security import SmtpError as EmailDeliveryError, transport
from .services import smtp_management


SmtpConfigLike = Union[models.SmtpConfig, models.MultipleSmtpConfig]
logger = logging.getLogger(__name__)


def _record_email_audit(event):
    try:
        audit_logger.log_event(event)
    except Exception:
        # Audit storage cannot change a known SMTP outcome or its retry policy.
        logger.warning('Email audit record could not be stored')


def _sanitize_email_error(exc: Exception) -> str:
    return str(exc) if isinstance(exc, EmailDeliveryError) else 'Email delivery failed'


def _email_audit_metadata(*, notification_type: Optional[str], to_address: str) -> dict[str, Optional[str]]:
    domain = to_address.rsplit("@", 1)[1].lower() if "@" in to_address else None
    return {
        "notification_type": notification_type,
        "to_domain": domain,
        "provider": "smtp",
    }


def _is_config_complete(config: SmtpConfigLike) -> bool:
    return smtp_management.complete(config)


def resolve_smtp_config(db: Session, notification_type: Optional[str] = None, tenant_id=None):
    rows = smtp_management.candidates(db, tenant_id, notification_type)
    return rows[0] if rows else None


def _send_email_with_config(*, smtp_config, to_address, subject, body, message_id=None):
    transport(smtp_config, recipient=to_address, subject=subject, body=body, message_id=message_id)


def send_email_with_config(
    *,
    smtp_config: SmtpConfigLike,
    to_address: str,
    subject: str,
    body: str,
) -> None:
    """Send an email using a specific SMTP configuration."""

    _send_email_with_config(
        smtp_config=smtp_config,
        to_address=to_address,
        subject=subject,
        body=body,
    )


def send_system_email(
    *,
    smtp_config: models.SmtpConfig,
    to_address: str,
    subject: str,
    body: str,
) -> None:
    """Send an email using the stored SMTP configuration."""

    _send_email_with_config(
        smtp_config=smtp_config,
        to_address=to_address,
        subject=subject,
        body=body,
    )


def send_notification_email(
    *,
    db: Session,
    notification_type: Optional[str],
    to_address: str,
    subject: str,
    body: str,
    tenant_id=None,
    outbox_id=None,
) -> None:
    """Send an email using the SMTP profile mapped to a notification type."""

    if tenant_id is None:
        recipient = db.query(models.User).filter(models.User.email == to_address).first()
        tenant_id = recipient.tenant_id if recipient else None
    if tenant_id is None:
        raise EmailDeliveryError('configuration')
    try:
        smtp_management.deliver(db, tenant_id=tenant_id, category=notification_type, recipient=to_address,
                                subject=subject, body=body, outbox_id=outbox_id)
        _record_email_audit(
            audit_logger.AuditLogInput(
                action="EMAIL_SENT",
                category=models.AuditLogCategoryEnum.NOTIFICATION,
                source=models.AuditLogSourceEnum.AUTOMATION,
                metadata=_email_audit_metadata(notification_type=notification_type, to_address=to_address),
            )
        )
    except EmailDeliveryError as exc:
        safe_error = "Credential email delivery failed" if notification_type == "welcome_password" else _sanitize_email_error(exc)
        _record_email_audit(
            audit_logger.AuditLogInput(
                action="EMAIL_FAILED",
                category=models.AuditLogCategoryEnum.NOTIFICATION,
                source=models.AuditLogSourceEnum.AUTOMATION,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason=safe_error,
                metadata=_email_audit_metadata(notification_type=notification_type, to_address=to_address),
            )
        )
        raise
