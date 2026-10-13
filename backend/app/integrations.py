"""Integration helpers."""

import logging
from typing import Any, Dict

import httpx

from .config import get_settings
from .webhooks import service as webhook_service
from .services import audit_logger
from . import models

logger = logging.getLogger(__name__)


def trigger_n8n_event(event: str, payload: Dict[str, Any]) -> None:
    settings = get_settings()
    if not settings.enable_n8n_forwarding or not settings.n8n_webhook_url:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="WORKFLOW_QUEUED",
                category=models.AuditLogCategoryEnum.AUTOMATION,
                source=models.AuditLogSourceEnum.AUTOMATION,
                metadata={"event": event},
            )
        )
        webhook_service.enqueue_event(event, payload)
        return

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(settings.n8n_webhook_url, json={"event": event, "payload": payload})
        if response.status_code >= 400:
            audit_logger.log_event(
                audit_logger.AuditLogInput(
                    action="WORKFLOW_TRIGGER_FAILED",
                    category=models.AuditLogCategoryEnum.AUTOMATION,
                    source=models.AuditLogSourceEnum.AUTOMATION,
                    severity=models.AuditLogSeverityEnum.WARNING,
                    status=models.AuditLogStatusEnum.FAILED,
                    reason=f"HTTP {response.status_code}",
                    metadata={
                        "event": event,
                        "response_status": response.status_code,
                        "response_body": (response.text or "")[:500],
                    },
                )
            )
        else:
            audit_logger.log_event(
                audit_logger.AuditLogInput(
                    action="WORKFLOW_TRIGGERED",
                    category=models.AuditLogCategoryEnum.AUTOMATION,
                    source=models.AuditLogSourceEnum.AUTOMATION,
                    metadata={"event": event, "response_status": response.status_code},
                )
            )
    except Exception as exc:  # pragma: no cover - network failure should not crash request
        logger.warning("Failed to send event '%s' to n8n: %s", event, exc)
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="WORKFLOW_TRIGGER_FAILED",
                category=models.AuditLogCategoryEnum.AUTOMATION,
                source=models.AuditLogSourceEnum.AUTOMATION,
                severity=models.AuditLogSeverityEnum.WARNING,
                status=models.AuditLogStatusEnum.FAILED,
                reason=str(exc),
                metadata={"event": event},
            )
        )
    webhook_service.enqueue_event(event, payload)
