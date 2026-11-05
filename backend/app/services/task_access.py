"""Shared tenant boundary; role and project visibility policies remain with their owners."""
from sqlalchemy import and_, or_
from fastapi import HTTPException

from .. import models


def task_tenant_predicate(user: models.User):
    return or_(
        models.Task.project.has(models.Project.tenant_id == user.tenant_id),
        and_(models.Task.project_id.is_(None), models.Task.creator.has(models.User.tenant_id == user.tenant_id)),
    )


def task_belongs_to_user_tenant(task: models.Task, user: models.User) -> bool:
    tenant = task.project.tenant_id if task.project else task.creator.tenant_id if task.creator else None
    return tenant is not None and str(tenant) == str(user.tenant_id)


def ensure_task_update_access(task, user):
    if not task_belongs_to_user_tenant(task, user):
        raise HTTPException(404, 'Task not found')
    if task.ticket_id:
        if user.id not in {task.created_by_id, task.assigned_to_id}:
            raise HTTPException(403, 'Only the task creator or assignee can update this ticket task')
        return
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER} or user.id in {task.created_by_id, task.assigned_to_id}:
        return
    if user.role == models.RoleEnum.MANAGER:
        if task.project and any(member.user_id == user.id and member.role == models.ProjectMemberRoleEnum.MANAGER for member in task.project.members):
            return
        if not task.project and user.department_id and task.assignee and task.assignee.department_id == user.department_id:
            return
    raise HTTPException(403, 'Task updates require ownership, assignment, or manager access')
