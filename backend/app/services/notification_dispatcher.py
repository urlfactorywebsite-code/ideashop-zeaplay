from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .. import models, schemas
from ..integrations import trigger_n8n_event
from . import audit_logger, push_service


MODULES = {"tasks", "tickets", "users", "departments", "comments", "chat"}


def resolve_module(
    notification_type: models.NotificationTypeEnum,
    entity_type: Optional[models.NotificationEntityTypeEnum],
) -> Optional[str]:
    if notification_type in {
        models.NotificationTypeEnum.TASK_CREATED,
        models.NotificationTypeEnum.TASK_UPDATED,
        models.NotificationTypeEnum.TASK_DELETED,
        models.NotificationTypeEnum.TASK_COMPLETED,
        models.NotificationTypeEnum.TASK_ASSIGNED,
        models.NotificationTypeEnum.TASK_OVERDUE,
        models.NotificationTypeEnum.SUBTASK_ACTIVATED,
        models.NotificationTypeEnum.SUBTASK_REASSIGNED,
        models.NotificationTypeEnum.SUBTASK_APPROVED,
        models.NotificationTypeEnum.SUBTASK_REJECTED,
        models.NotificationTypeEnum.SUBTASK_FORCE_STARTED,
        models.NotificationTypeEnum.SUBTASK_REVIEW_REQUIRED,
    }:
        return "tasks"
    if notification_type in {
        models.NotificationTypeEnum.TICKET_CREATED,
        models.NotificationTypeEnum.TICKET_UPDATED,
        models.NotificationTypeEnum.TICKET_DELETED,
        models.NotificationTypeEnum.TICKET_ASSIGNED,
        models.NotificationTypeEnum.TICKET_CLOSED,
    }:
        return "tickets"
    if notification_type in {models.NotificationTypeEnum.USER_CREATED, models.NotificationTypeEnum.USER_UPDATED, models.NotificationTypeEnum.USER_DELETED}:
        return "users"
    if notification_type in {
        models.NotificationTypeEnum.DEPARTMENT_CREATED,
        models.NotificationTypeEnum.DEPARTMENT_UPDATED,
        models.NotificationTypeEnum.DEPARTMENT_DELETED,
    }:
        return "departments"
    if notification_type == models.NotificationTypeEnum.COMMENT_ADDED:
        return "comments"
    if notification_type == models.NotificationTypeEnum.MENTION:
        return "comments"
    if notification_type == models.NotificationTypeEnum.CHAT_MESSAGE:
        return "chat"
    if notification_type in {
        models.NotificationTypeEnum.APPROVAL_REQUESTED,
        models.NotificationTypeEnum.APPROVAL_ACTED,
        models.NotificationTypeEnum.SLA_BREACH,
    }:
        if entity_type == models.NotificationEntityTypeEnum.TICKET:
            return "tickets"
        return "tasks"
    return None


def _resolve_url(notification: models.Notification) -> Optional[str]:
    if notification.deep_link:
        return notification.deep_link
    if notification.entity_type == models.NotificationEntityTypeEnum.TASK and notification.entity_id:
        return f"/tasks/{notification.entity_id}"
    if notification.entity_type == models.NotificationEntityTypeEnum.SUBTASK and notification.related_task_id:
        return f"/tasks/{notification.related_task_id}"
    if notification.entity_type == models.NotificationEntityTypeEnum.TICKET and notification.entity_id:
        return f"/tickets/{notification.entity_id}"
    if notification.entity_type == models.NotificationEntityTypeEnum.USER and notification.entity_id:
        return f"/users/{notification.entity_id}"
    if notification.entity_type == models.NotificationEntityTypeEnum.DEPARTMENT and notification.entity_id:
        return f"/departments/{notification.entity_id}"
    if notification.related_chat_id:
        return f"/chat/{notification.related_chat_id}"
    return None


def _resolve_title(notification: models.Notification) -> str:
    if notification.title:
        return notification.title
    return "ZeaPlay Notification"


def _resolve_body(notification: models.Notification) -> str:
    if notification.body:
        return notification.body
    return notification.message


def create_history_notification(
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
    if dedupe_key:
        existing = db.execute(
            select(models.Notification).where(
                models.Notification.user_id == user_id,
                models.Notification.dedupe_key == dedupe_key,
            )
        ).scalars().first()
        if existing:
            existing._already_dispatched = True
            return existing
    resolved_tenant_id = tenant_id
    if resolved_tenant_id is None:
        user = db.get(models.User, user_id)
        resolved_tenant_id = user.tenant_id if user else None
    if dedupe_key:
        notification_id = models.generate_uuid()
        values = {
            "id": notification_id,
            "tenant_id": resolved_tenant_id,
            "user_id": user_id,
            "dedupe_key": dedupe_key,
            "type": notification_type,
            "title": title,
            "body": body,
            "message": message,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "deep_link": deep_link,
            "related_task_id": related_task_id,
            "related_reward_id": related_reward_id,
            "related_chat_id": related_chat_id,
            "created_at": datetime.utcnow(),
        }
        dialect_name = db.get_bind().dialect.name
        if dialect_name == "postgresql":
            stmt = postgres_insert(models.Notification).values(**values).on_conflict_do_nothing(
                index_elements=["user_id", "dedupe_key"],
                index_where=models.Notification.dedupe_key.is_not(None),
            )
        elif dialect_name == "sqlite":
            stmt = sqlite_insert(models.Notification).values(**values).on_conflict_do_nothing(
                index_elements=["user_id", "dedupe_key"],
                index_where=models.Notification.dedupe_key.is_not(None),
            )
        else:
            stmt = insert(models.Notification).values(**values)
        result = db.execute(stmt)
        if result.rowcount != 1:
            existing = db.execute(
                select(models.Notification).where(
                    models.Notification.user_id == user_id,
                    models.Notification.dedupe_key == dedupe_key,
                )
            ).scalars().first()
            if not existing:
                raise
            existing._already_dispatched = True
            return existing
        notification = db.get(models.Notification, notification_id)
    else:
        notification = models.Notification(
            tenant_id=resolved_tenant_id,
            user_id=user_id,
            dedupe_key=dedupe_key,
            type=notification_type,
            title=title,
            body=body,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
            deep_link=deep_link,
            related_task_id=related_task_id,
            related_reward_id=related_reward_id,
            related_chat_id=related_chat_id,
            created_at=datetime.utcnow(),
        )
        db.add(notification)
        db.flush()
    notification._already_dispatched = False
    payload = schemas.NotificationRead.model_validate(notification).model_dump()
    trigger_n8n_event("notification.created", payload)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="NOTIFICATION_SENT",
            category=models.AuditLogCategoryEnum.NOTIFICATION,
            actor_id=str(actor_id) if actor_id else None,
            actor_role=None,
            entity_type="notification",
            entity_id=str(notification.id),
            target_user_id=str(user_id),
            source=models.AuditLogSourceEnum.AUTOMATION,
            metadata={
                "type": notification_type.value,
                "entity_type": entity_type.value if entity_type else None,
                "entity_id": entity_id,
                "deep_link": deep_link,
            },
        )
    )
    return notification


def push_if_enabled(
    db: Session,
    *,
    user_ids: Iterable[str],
    module: Optional[str],
    payload: dict,
) -> int:
    if not module or module not in MODULES:
        return 0

    recipient_ids = list({user_id for user_id in user_ids if user_id})
    if not recipient_ids:
        return 0

    prefs = db.execute(
        select(models.NotificationPreference).where(
            models.NotificationPreference.user_id.in_(recipient_ids),
            models.NotificationPreference.module == module,
        )
    ).scalars().all()
    disabled = {pref.user_id for pref in prefs if not pref.push_enabled}
    eligible = [user_id for user_id in recipient_ids if user_id not in disabled]
    if not eligible:
        return 0
    return push_service.send_push(db, user_ids=eligible, payload=payload)


def dispatch_notification(
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
    notification = create_history_notification(
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
    if getattr(notification, "_already_dispatched", False):
        return notification
    module = resolve_module(notification_type, entity_type)
    push_if_enabled(
        db,
        user_ids=[user_id],
        module=module,
        payload={
            "title": _resolve_title(notification),
            "body": _resolve_body(notification),
            "url": _resolve_url(notification),
            "icon": None,
            "badge": None,
            "module": module,
            "event_type": notification_type.value,
            "notification_id": str(notification.id),
        },
    )
    return notification
