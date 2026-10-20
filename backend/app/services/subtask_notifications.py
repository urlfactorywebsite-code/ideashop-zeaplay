from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from .. import models
from . import notification_outbox
from .notifications import create_notification
from .subtask_workflow import WorkflowDomainEvent


@dataclass(frozen=True)
class SubtaskNotificationSpec:
    notification_type: models.NotificationTypeEnum
    title: str
    message: str
    email_subject: str
    email_body: str


def _task_url(task_id: str) -> str:
    return f"/tasks/{task_id}"


def _safe_task_label(task: models.Task) -> str:
    return task.title or "Task"


def _safe_subtask_label(subtask: models.Subtask) -> str:
    return subtask.title or "Subtask"


def _event_spec(event_type: str, task: models.Task, subtask: models.Subtask) -> Optional[SubtaskNotificationSpec]:
    task_label = _safe_task_label(task)
    subtask_label = _safe_subtask_label(subtask)
    if event_type == "SUBTASK_ACTIVATED":
        return SubtaskNotificationSpec(
            notification_type=models.NotificationTypeEnum.SUBTASK_ACTIVATED,
            title="Subtask ready",
            message=f"{subtask_label} is ready to start.",
            email_subject="A subtask is ready to start",
            email_body=f"{subtask_label} is ready to start in {task_label}. Open ZeaPlay to review the task.",
        )
    if event_type == "SUBTASK_FORCE_STARTED":
        return SubtaskNotificationSpec(
            notification_type=models.NotificationTypeEnum.SUBTASK_FORCE_STARTED,
            title="Subtask force-started",
            message=f"{subtask_label} was force-started.",
            email_subject="A subtask was force-started",
            email_body=f"{subtask_label} was force-started in {task_label}. Open ZeaPlay for the current workflow state.",
        )
    if event_type == "SUBTASK_DOWNSTREAM_REVIEW_REQUIRED":
        return SubtaskNotificationSpec(
            notification_type=models.NotificationTypeEnum.SUBTASK_REVIEW_REQUIRED,
            title="Review required",
            message=f"{subtask_label} needs review after an upstream change.",
            email_subject="A subtask needs review",
            email_body=f"{subtask_label} needs review in {task_label} after an upstream workflow change.",
        )
    return None


def _notify_user(
    db: Session,
    *,
    tenant_id: object,
    recipient_user_id: Optional[str],
    event_type: str,
    event_id: str,
    dedupe_key: str,
    spec: SubtaskNotificationSpec,
    task_id: str,
    subtask_id: str,
    actor_id: Optional[str] = None,
    email: bool = True,
) -> None:
    if not recipient_user_id:
        return
    recipient = db.get(models.User, recipient_user_id)
    if (
        not recipient
        or recipient.status != models.UserStatusEnum.ACTIVE
        or str(recipient.tenant_id) != str(tenant_id)
    ):
        return

    notification = create_notification(
        db,
        tenant_id=tenant_id,
        user_id=recipient_user_id,
        notification_type=spec.notification_type,
        title=spec.title,
        body=spec.message,
        message=spec.message,
        entity_type=models.NotificationEntityTypeEnum.SUBTASK,
        entity_id=subtask_id,
        deep_link=_task_url(task_id),
        related_task_id=task_id,
        actor_id=actor_id,
        dedupe_key=f"inapp:{dedupe_key}",
    )
    if notification is None:
        return
    if email:
        notification_outbox.enqueue_email(
            db,
            tenant_id=tenant_id,
            recipient_user_id=recipient_user_id,
            event_type=event_type,
            event_id=event_id,
            dedupe_key=f"email:{dedupe_key}",
            subject=spec.email_subject,
            body=spec.email_body,
            notification_id=notification.id,
            related_task_id=task_id,
            related_subtask_id=subtask_id,
            actor_id=actor_id,
        )


def enqueue_workflow_notifications(
    db: Session,
    *,
    task: models.Task,
    events: list[WorkflowDomainEvent],
) -> None:
    if not events:
        return

    tenant_id = task.project.tenant_id if task.project else None
    if tenant_id is None and task.assignee:
        tenant_id = task.assignee.tenant_id
    if tenant_id is None and task.creator:
        tenant_id = task.creator.tenant_id
    if tenant_id is None:
        return

    for event in events:
        subtask = db.get(models.Subtask, event.subtask_id)
        if not subtask:
            continue
        spec = _event_spec(event.event_type, task, subtask)
        if not spec:
            continue
        event_id = f"{event.event_type}:{event.task_id}:{event.subtask_id}:{event.to_status}"
        if event.event_type == "SUBTASK_FORCE_STARTED":
            event_id = f"{event_id}:{event.actor_id}"
        recipient_id = subtask.assigned_to_id
        _notify_user(
            db,
            tenant_id=tenant_id,
            recipient_user_id=recipient_id,
            event_type=event.event_type,
            event_id=event_id,
            dedupe_key=f"{event_id}:{recipient_id}",
            spec=spec,
            task_id=event.task_id,
            subtask_id=event.subtask_id,
            actor_id=event.actor_id,
        )


def enqueue_reassignment_notification(
    db: Session,
    *,
    task: models.Task,
    subtask: models.Subtask,
    previous_assignee_id: Optional[str],
    actor_id: Optional[str],
) -> None:
    if not subtask.assigned_to_id or subtask.assigned_to_id == previous_assignee_id:
        return
    tenant_id = task.project.tenant_id if task.project else None
    if tenant_id is None:
        assignee = db.get(models.User, subtask.assigned_to_id)
        tenant_id = assignee.tenant_id if assignee else None
    if tenant_id is None:
        return
    subtask_label = _safe_subtask_label(subtask)
    spec = SubtaskNotificationSpec(
        notification_type=models.NotificationTypeEnum.SUBTASK_REASSIGNED,
        title="Subtask assigned",
        message=f"{subtask_label} was assigned to you.",
        email_subject="A subtask was assigned to you",
        email_body=f"{subtask_label} was assigned to you in {_safe_task_label(task)}. Open ZeaPlay to review it.",
    )
    event_id = f"SUBTASK_REASSIGNED:{task.id}:{subtask.id}:{subtask.assigned_to_id}"
    _notify_user(
        db,
        tenant_id=tenant_id,
        recipient_user_id=subtask.assigned_to_id,
        event_type="SUBTASK_REASSIGNED",
        event_id=event_id,
        dedupe_key=f"{event_id}:{subtask.assigned_to_id}",
        spec=spec,
        task_id=task.id,
        subtask_id=subtask.id,
        actor_id=actor_id,
    )


def enqueue_review_decision_notification(
    db: Session,
    *,
    task: models.Task,
    subtask: models.Subtask,
    submission_id: str,
    approved: bool,
    actor_id: Optional[str],
) -> None:
    tenant_id = task.project.tenant_id if task.project else None
    recipient_id = subtask.assigned_to_id
    if tenant_id is None and recipient_id:
        recipient = db.get(models.User, recipient_id)
        tenant_id = recipient.tenant_id if recipient else None
    if tenant_id is None:
        return
    subtask_label = _safe_subtask_label(subtask)
    notification_type = models.NotificationTypeEnum.SUBTASK_APPROVED if approved else models.NotificationTypeEnum.SUBTASK_REJECTED
    event_type = "SUBTASK_APPROVED" if approved else "SUBTASK_REJECTED"
    status_text = "approved" if approved else "rejected"
    spec = SubtaskNotificationSpec(
        notification_type=notification_type,
        title=f"Subtask {status_text}",
        message=f"{subtask_label} was {status_text}.",
        email_subject=f"Your subtask was {status_text}",
        email_body=f"{subtask_label} was {status_text} in {_safe_task_label(task)}. Open ZeaPlay for details.",
    )
    event_id = f"{event_type}:{submission_id}"
    _notify_user(
        db,
        tenant_id=tenant_id,
        recipient_user_id=recipient_id,
        event_type=event_type,
        event_id=event_id,
        dedupe_key=f"{event_id}:{recipient_id}",
        spec=spec,
        task_id=task.id,
        subtask_id=subtask.id,
        actor_id=actor_id,
    )
