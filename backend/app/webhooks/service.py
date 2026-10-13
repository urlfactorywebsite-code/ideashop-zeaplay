from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

import uuid

from ..config import get_settings
from ..database import SessionLocal
from ..tickets.models import WebhookDeliveryLog, WebhookDeliveryStatusEnum, WebhookSubscription
from . import dispatcher
from . import payloads

logger = logging.getLogger(__name__)


def _is_event_allowed(event_name: str) -> bool:
    settings = get_settings()
    if event_name in payloads.DEV_ONLY_EVENTS and settings.environment != "development":
        return False
    return True


def _normalize_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, BaseModel):
        return payload.model_dump()
    if isinstance(payload, dict):
        return payload
    if payload is None:
        return {}
    return {"value": payload}


def resolve_event_data(db: Session, event_name: str, payload: Any | None) -> dict[str, Any]:
    normalized = _normalize_payload(payload)
    if event_name.startswith("task."):
        task_data = normalized.get("task")
        task_id = normalized.get("taskId") or normalized.get("task_id")
        if not task_data and task_id:
            task = db.get(payloads.models.Task, str(task_id))
            if task:
                task_data = payloads.schemas.TaskRead.model_validate(task).model_dump()
        if task_data:
            merged = dict(normalized)
            merged["task"] = task_data
            return merged
        if "title" in normalized and "status" in normalized:
            return {"task": normalized}
    if event_name.startswith("comment."):
        comment_data = normalized.get("comment")
        comment_id = normalized.get("commentId") or normalized.get("comment_id")
        if not comment_data and comment_id:
            comment = db.get(payloads.models.Comment, str(comment_id))
            if comment:
                comment_data = payloads.schemas.CommentRead.model_validate(comment).model_dump()
        if comment_data:
            merged = dict(normalized)
            merged["comment"] = comment_data
            return merged
        if "content" in normalized and "task_id" in normalized:
            return {"comment": normalized}
    if event_name.startswith("user."):
        if "user" in normalized:
            return normalized
        if "email" in normalized and "name" in normalized:
            return {"user": normalized}
        user_id = normalized.get("id") or normalized.get("userId") or normalized.get("user_id")
        if user_id:
            user = db.get(payloads.models.User, str(user_id))
            if user:
                return {"user": payloads.schemas.UserRead.model_validate(user).model_dump()}
    if event_name.startswith("reward."):
        if event_name == "reward.claimed":
            if "claim" in normalized:
                return normalized
            claim_id = normalized.get("id") or normalized.get("claimId") or normalized.get("claim_id")
            if claim_id:
                claim = db.get(payloads.models.RewardClaim, str(claim_id))
                if claim:
                    return {"claim": payloads.schemas.RewardClaimRead.model_validate(claim).model_dump()}
            if normalized:
                return {"claim": normalized}
        if "reward" in normalized:
            return normalized
        if "title" in normalized:
            return {"reward": normalized}
        reward_id = normalized.get("id") or normalized.get("rewardId") or normalized.get("reward_id")
        if reward_id:
            reward = db.get(payloads.models.Reward, str(reward_id))
            if reward:
                return {"reward": payloads.schemas.RewardRead.model_validate(reward).model_dump()}
    if event_name.startswith("notification."):
        if "notification" in normalized:
            return normalized
        if "type" in normalized and "message" in normalized:
            return {"notification": normalized}
        notification_id = normalized.get("id") or normalized.get("notificationId") or normalized.get("notification_id")
        if notification_id:
            notification = db.get(payloads.models.Notification, str(notification_id))
            if notification:
                return {"notification": payloads.schemas.NotificationRead.model_validate(notification).model_dump()}
    if event_name.startswith("department."):
        if "department" in normalized or "name" in normalized:
            return {"department": normalized} if "department" not in normalized else normalized
        department_id = normalized.get("id") or normalized.get("departmentId") or normalized.get("department_id")
        if department_id:
            department = db.get(payloads.models.Department, str(department_id))
            if department:
                return {"department": payloads.schemas.DepartmentRead.model_validate(department).model_dump()}
    if event_name.startswith("points_table."):
        if "points_table" in normalized or "points_config" in normalized:
            return {"points_table": normalized} if "points_table" not in normalized else normalized
        points_table = db.get(payloads.models.PointsTableConfig, 1)
        if points_table:
            return {
                "points_table": payloads.schemas.PointsTableConfigRead.model_validate(points_table).model_dump()
            }
    if normalized:
        return normalized
    return payloads.get_sample_data(db, event_name)


def queue_event(db: Session, *, event_name: str, data: dict[str, Any]) -> list[WebhookDeliveryLog]:
    if not _is_event_allowed(event_name):
        return []
    if isinstance(data, dict) and {"event", "occurred_at", "ticket_id", "actor_user_id", "actor_name"}.issubset(data):
        payload = data
    else:
        payload = payloads.build_payload(event_name, data)
    return dispatcher.queue_webhook_deliveries(db, event_type=event_name, payload=payload)


def enqueue_event(event_name: str, payload: Any | None) -> None:
    if not _is_event_allowed(event_name):
        return
    try:
        with SessionLocal() as db:
            data = resolve_event_data(db, event_name, payload)
            dispatcher.queue_webhook_deliveries(
                db,
                event_type=event_name,
                payload=payloads.build_payload(event_name, data),
            )
            db.commit()
    except Exception:
        logger.exception("Failed to enqueue webhook event %s", event_name)


def create_test_delivery(
    db: Session,
    *,
    webhook: WebhookSubscription,
    event_name: str,
    data: dict[str, Any],
) -> WebhookDeliveryLog:
    payload = payloads.build_payload(event_name, data)
    settings = get_settings()
    log = WebhookDeliveryLog(
        tenant_id=uuid.UUID(settings.default_tenant_id),
        subscription_id=webhook.id,
        event_type=event_name,
        payload=payload,
        status=WebhookDeliveryStatusEnum.PENDING,
        attempt_count=0,
    )
    db.add(log)
    db.flush()
    dispatcher.dispatch_webhook_deliveries(db, [log.id])
    db.refresh(log)
    return log
