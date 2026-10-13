"""Notification helper utilities."""

from typing import Optional

from sqlalchemy.orm import Session

from .. import models
from .notification_dispatcher import dispatch_notification


def create_notification(
    db: Session,
    *,
    user_id: str,
    notification_type: models.NotificationTypeEnum,
    message: str,
    tenant_id: Optional[object] = None,
    dedupe_key: Optional[str] = None,
    title: Optional[str] = None,
    body: Optional[str] = None,
    entity_type: Optional[models.NotificationEntityTypeEnum] = None,
    entity_id: Optional[str] = None,
    deep_link: Optional[str] = None,
    related_task_id: Optional[str] = None,
    related_reward_id: Optional[str] = None,
    related_chat_id: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> models.Notification:
    return dispatch_notification(
        db,
        user_id=user_id,
        notification_type=notification_type,
        message=message,
        tenant_id=tenant_id,
        dedupe_key=dedupe_key,
        title=title,
        body=body,
        entity_type=entity_type,
        entity_id=entity_id,
        deep_link=deep_link,
        related_task_id=related_task_id,
        related_reward_id=related_reward_id,
        related_chat_id=related_chat_id,
        actor_id=actor_id,
    )
