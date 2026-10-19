"""Utility helpers for sending email via configured SMTP."""

from datetime import datetime
from email.message import EmailMessage
import smtplib
import ssl
from typing import Optional, Union

from sqlalchemy.orm import Session

from . import models
from .services import audit_logger


class EmailDeliveryError(RuntimeError):
    """Raised when the platform cannot send email."""


SmtpConfigLike = Union[models.SmtpConfig, models.MultipleSmtpConfig]


def _sanitize_email_error(exc: Exception) -> str:
    raw = str(exc).strip()
    if not raw:
        return exc.__class__.__name__
    lowered = raw.lower()
    if any(token in lowered for token in ("password", "secret", "token", "credential", "auth")):
        return "Email delivery failed due to provider authentication/configuration"
    return raw[:500] if len(raw) > 500 else raw


def _email_audit_metadata(*, notification_type: Optional[str], to_address: str) -> dict[str, Optional[str]]:
    domain = to_address.rsplit("@", 1)[1].lower() if "@" in to_address else None
    return {
        "notification_type": notification_type,
        "to_domain": domain,
        "provider": "smtp",
    }


def _is_config_complete(config: SmtpConfigLike) -> bool:
    return bool(
        config.host
        and config.port
        and config.username
        and config.password
        and str(config.password).strip()
    )


def _sorted_by_updated(configs: list[models.MultipleSmtpConfig]) -> list[models.MultipleSmtpConfig]:
    return sorted(
        configs,
        key=lambda config: config.updated_at or config.created_at or datetime.min,
        reverse=True,
    )


def resolve_smtp_config(
    db: Session,
    notification_type: Optional[str] = None,
) -> Optional[SmtpConfigLike]:
    candidates: list[models.MultipleSmtpConfig] = []
    if notification_type:
        candidates = [
            config
            for config in db.query(models.MultipleSmtpConfig).all()
            if notification_type in (config.notification_types or [])
        ]
        candidates = _sorted_by_updated(candidates)

    for candidate in candidates:
        if _is_config_complete(candidate):
            return candidate

    primary = db.get(models.SmtpConfig, 1)
    if primary and _is_config_complete(primary):
        return primary

    if candidates:
        return candidates[0]
    return primary


def _send_email_with_config(
    *,
    smtp_config: SmtpConfigLike,
    to_address: str,
    subject: str,
    body: str,
) -> None:
    if not smtp_config.host or not smtp_config.port:
        raise EmailDeliveryError("SMTP host and port are required")
    if not smtp_config.username:
        raise EmailDeliveryError("SMTP username is required")
    if not smtp_config.password:
        raise EmailDeliveryError("SMTP password is required")

    message = EmailMessage()
    message["From"] = smtp_config.username
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)

    try:
        if smtp_config.encryption and smtp_config.encryption.lower() == "ssl":
            with smtplib.SMTP_SSL(smtp_config.host, smtp_config.port, timeout=15, context=ssl.create_default_context()) as client:
                client.login(smtp_config.username, smtp_config.password)
                client.send_message(message)
        else:
            with smtplib.SMTP(smtp_config.host, smtp_config.port, timeout=15) as client:
                client.ehlo()
                if smtp_config.encryption and smtp_config.encryption.lower() == "tls":
                    client.starttls(context=ssl.create_default_context())
                    client.ehlo()
                client.login(smtp_config.username, smtp_config.password)
                client.send_message(message)
    except Exception as exc:  # pragma: no cover - integration point
        raise EmailDeliveryError(str(exc)) from exc


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
) -> None:
    """Send an email using the SMTP profile mapped to a notification type."""

    smtp_config = resolve_smtp_config(db, notification_type)
    if not smtp_config:
        raise EmailDeliveryError("SMTP configuration is required")

    try:
        _send_email_with_config(
            smtp_config=smtp_config,
            to_address=to_address,
            subject=subject,
            body=body,
        )
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="EMAIL_SENT",
                category=models.AuditLogCategoryEnum.NOTIFICATION,
                source=models.AuditLogSourceEnum.AUTOMATION,
                metadata=_email_audit_metadata(notification_type=notification_type, to_address=to_address),
            )
        )
    except EmailDeliveryError as exc:
        safe_error = "Credential email delivery failed" if notification_type == "welcome_password" else _sanitize_email_error(exc)
        audit_logger.log_event(
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
