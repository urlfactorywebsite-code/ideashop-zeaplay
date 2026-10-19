"""Shared tenant boundary; role and project visibility policies remain with their owners."""
from sqlalchemy import and_, or_

from .. import models


def task_tenant_predicate(user: models.User):
    return or_(
        models.Task.project.has(models.Project.tenant_id == user.tenant_id),
        and_(models.Task.project_id.is_(None), models.Task.creator.has(models.User.tenant_id == user.tenant_id)),
    )


def task_belongs_to_user_tenant(task: models.Task, user: models.User) -> bool:
    tenant = task.project.tenant_id if task.project else task.creator.tenant_id if task.creator else None
    return tenant is not None and str(tenant) == str(user.tenant_id)
