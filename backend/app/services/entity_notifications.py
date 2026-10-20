"""Recipients mirror client/project read access; delivery shares their transaction."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models
from .notifications import create_notification


def project_recipient_ids(db: Session, project: models.Project, actor: models.User) -> list[str]:
    # Flush membership replacements first, so removed members cannot receive an
    # update based on stale objects in project.members.
    db.flush()
    members = select(models.ProjectMember.user_id).where(
        models.ProjectMember.project_id == project.id,
        models.ProjectMember.tenant_id == project.tenant_id,
    )
    return list(db.scalars(select(models.User.id).where(
        models.User.tenant_id == project.tenant_id,
        models.User.status == models.UserStatusEnum.ACTIVE,
        models.User.id != actor.id,
        or_(models.User.role.in_({models.RoleEnum.ADMIN, models.RoleEnum.OWNER}),
            models.User.id.in_(members)),
    ).order_by(models.User.id)))


def notify_project(db: Session, *, project: models.Project, actor: models.User, action: str) -> None:
    if str(actor.tenant_id) != str(project.tenant_id):
        return
    message = f"{actor.name} {action} project '{project.name}'."
    kind = models.NotificationTypeEnum.PROJECT_CREATED if action == "created" else models.NotificationTypeEnum.PROJECT_UPDATED
    for user_id in project_recipient_ids(db, project, actor):
        create_notification(
            db, user_id=user_id, tenant_id=project.tenant_id, actor_id=actor.id,
            notification_type=kind, message=message, body=message,
            title="Project created" if action == "created" else "Project updated",
            entity_type=models.NotificationEntityTypeEnum.PROJECT, entity_id=project.id,
            deep_link=f"/projects/{project.id}",
        )


def notify_client(db: Session, *, client: models.Client, actor: models.User, action: str) -> None:
    if str(actor.tenant_id) != str(client.tenant_id):
        return
    # The client management screen is available to management roles. Never
    # include contact, tax, address or notes fields in notification content.
    user_ids = db.scalars(select(models.User.id).where(
        models.User.tenant_id == client.tenant_id,
        models.User.status == models.UserStatusEnum.ACTIVE,
        models.User.role.in_({models.RoleEnum.ADMIN, models.RoleEnum.OWNER, models.RoleEnum.MANAGER}),
        models.User.id != actor.id,
    ).order_by(models.User.id)).all()
    message = f"{actor.name} {action} client '{client.company_name}'."
    kind = models.NotificationTypeEnum.CLIENT_CREATED if action == "created" else models.NotificationTypeEnum.CLIENT_UPDATED
    for user_id in user_ids:
        create_notification(
            db, user_id=user_id, tenant_id=client.tenant_id, actor_id=actor.id,
            notification_type=kind, message=message, body=message,
            title="Client created" if action == "created" else "Client updated",
            entity_type=models.NotificationEntityTypeEnum.CLIENT, entity_id=client.id,
            deep_link=f"/clients/{client.id}",
        )
