from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import audit_logger

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[schemas.NotificationRead])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    stmt = (
        select(models.Notification)
        .where(
            models.Notification.user_id == current_user.id,
            or_(
                models.Notification.tenant_id == current_user.tenant_id,
                models.Notification.tenant_id.is_(None),
            ),
        )
        .order_by(models.Notification.created_at.desc())
    )
    return db.execute(stmt).scalars().all()


@router.get("/unread-count", response_model=schemas.NotificationUnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.NotificationUnreadCount:
    count = db.execute(
        select(func.count(models.Notification.id)).where(
            models.Notification.user_id == current_user.id,
            models.Notification.is_read.is_(False),
            or_(
                models.Notification.tenant_id == current_user.tenant_id,
                models.Notification.tenant_id.is_(None),
            ),
        )
    ).scalar_one()
    return schemas.NotificationUnreadCount(unread_count=count)


@router.get("/outbox", response_model=list[schemas.NotificationOutboxRead])
def list_notification_outbox(
    status_filter: models.NotificationOutboxStatusEnum | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.NotificationOutboxRead]:
    if current_user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN, models.RoleEnum.MANAGER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Notification delivery status requires manager access")
    limit = max(1, min(limit, 200))
    stmt = (
        select(models.NotificationOutbox)
        .where(models.NotificationOutbox.tenant_id == current_user.tenant_id)
        .order_by(models.NotificationOutbox.created_at.desc())
        .limit(limit)
    )
    if status_filter:
        stmt = stmt.where(models.NotificationOutbox.status == status_filter)
    return db.execute(stmt).scalars().all()


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    stmt = select(models.Notification).where(
        models.Notification.user_id == current_user.id,
        or_(
            models.Notification.tenant_id == current_user.tenant_id,
            models.Notification.tenant_id.is_(None),
        ),
    )
    notifications = db.execute(stmt).scalars().all()
    for notification in notifications:
        notification.is_read = True
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="NOTIFICATIONS_MARKED_READ",
            category=models.AuditLogCategoryEnum.NOTIFICATION,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="notification",
            entity_id="bulk",
            target_user_id=str(current_user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"count": len(notifications)},
        )
    )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="notifications.read_all",
            entity_type="notification",
            entity_id="bulk",
            payload={"count": len(notifications)},
            created_at=datetime.utcnow(),
        )
    )
    db.commit()


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notifications_read(
    notification_ids: list[str],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    if not notification_ids:
        return
    notifications = db.execute(
        select(models.Notification).where(
            models.Notification.user_id == current_user.id,
            models.Notification.id.in_(notification_ids),
            or_(
                models.Notification.tenant_id == current_user.tenant_id,
                models.Notification.tenant_id.is_(None),
            ),
        )
    ).scalars().all()
    marked_ids = [notification.id for notification in notifications]
    for notification in notifications:
        notification.is_read = True
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="NOTIFICATIONS_MARKED_READ",
            category=models.AuditLogCategoryEnum.NOTIFICATION,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="notification",
            entity_id="bulk",
            target_user_id=str(current_user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"notification_ids": marked_ids},
        )
    )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="notifications.read",
            entity_type="notification",
            entity_id="bulk",
            payload={"notification_ids": marked_ids},
            created_at=datetime.utcnow(),
        )
    )
    db.commit()


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    notification = db.get(models.Notification, notification_id)
    if (
        not notification
        or notification.user_id != current_user.id
        or (notification.tenant_id is not None and notification.tenant_id != current_user.tenant_id)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.is_read = True
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="NOTIFICATION_MARKED_READ",
            category=models.AuditLogCategoryEnum.NOTIFICATION,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="notification",
            entity_id=notification_id,
            target_user_id=str(current_user.id),
            source=models.AuditLogSourceEnum.MANUAL,
        )
    )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="notifications.read",
            entity_type="notification",
            entity_id=notification_id,
            payload={},
            created_at=datetime.utcnow(),
        )
    )
    db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    notification = db.get(models.Notification, notification_id)
    if (
        not notification
        or notification.user_id != current_user.id
        or (notification.tenant_id is not None and notification.tenant_id != current_user.tenant_id)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.delete(notification)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="NOTIFICATION_DELETED",
            category=models.AuditLogCategoryEnum.NOTIFICATION,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="notification",
            entity_id=notification_id,
            target_user_id=str(current_user.id),
            source=models.AuditLogSourceEnum.MANUAL,
        )
    )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="notifications.deleted",
            entity_type="notification",
            entity_id=notification_id,
            payload={},
            created_at=datetime.utcnow(),
        )
    )
    db.commit()
