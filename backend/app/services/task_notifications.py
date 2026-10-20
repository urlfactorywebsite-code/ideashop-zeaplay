"""Task status history and push share the same authorized recipients."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from . import notifications as notification_service


def notify_status_change(
    db: Session, *, task: models.Task, actor: models.User,
    previous_status: models.TaskStatusEnum,
) -> None:
    if task.status == previous_status:
        return

    recipients = {task.created_by_id, task.assigned_to_id, actor.id}
    recipients.update(follower.id for follower in task.followers)
    recipients.update(child.assigned_to_id for child in task.subtasks)
    if task.project:
        recipients.update(member.user_id for member in task.project.members
            if member.role == models.ProjectMemberRoleEnum.MANAGER)
    recipients.discard(None)

    titles = dict(db.execute(select(models.KanbanColumn.id, models.KanbanColumn.title)).all())
    previous = titles.get(previous_status.value, previous_status.value.replace("_", " ").title())
    current = titles.get(task.status.value, task.status.value.replace("_", " ").title())
    completed = task.status in {models.TaskStatusEnum.DONE, models.TaskStatusEnum.DEPLOYED}
    title = "Task completed" if completed else "Task status updated"
    message = f"{actor.name} changed task '{task.title}' from {previous} to {current}."
    for recipient_id in sorted(recipients):
        notification_service.create_notification(
            db, user_id=recipient_id, actor_id=actor.id,
            notification_type=(models.NotificationTypeEnum.TASK_COMPLETED if completed
                else models.NotificationTypeEnum.TASK_UPDATED),
            title=title, body=message, message=message,
            entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=task.id,
            related_task_id=task.id, deep_link=f"/tasks/{task.id}",
        )
