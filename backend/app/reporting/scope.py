"""Backend authorization predicates, independent of browser filter choices."""
from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select

from .. import models as m
from ..services.task_access import task_tenant_predicate


def admin(user):
    return user.role in {m.RoleEnum.ADMIN, m.RoleEnum.OWNER}


def managed_project_ids(user):
    return select(m.ProjectMember.project_id).where(
        m.ProjectMember.tenant_id == user.tenant_id,
        m.ProjectMember.user_id == user.id,
        m.ProjectMember.role == m.ProjectMemberRoleEnum.MANAGER,
    )


def own_task_predicate(user):
    return or_(m.Task.assigned_to_id == user.id,
               m.Task.subtasks.any(m.Subtask.assigned_to_id == user.id))


def authorized_tasks(user):
    stmt = select(m.Task).where(task_tenant_predicate(user))
    if admin(user):
        return stmt
    own = own_task_predicate(user)
    if user.role == m.RoleEnum.MANAGER:
        permitted = [own, m.Task.project_id.in_(managed_project_ids(user)),
                     and_(m.Task.project_id.is_(None), m.Task.created_by_id == user.id)]
        if user.department_id:
            permitted.append(and_(m.Task.project_id.is_(None), m.Task.assignee.has(
                and_(m.User.tenant_id == user.tenant_id, m.User.department_id == user.department_id))))
        return stmt.where(or_(*permitted))
    return stmt.where(own)


def authorized_projects(user):
    stmt = select(m.Project).where(m.Project.tenant_id == user.tenant_id)
    if admin(user):
        return stmt
    own_projects = authorized_tasks(user).with_only_columns(m.Task.project_id).where(m.Task.project_id.is_not(None))
    membership_projects = select(m.ProjectMember.project_id).where(
        m.ProjectMember.tenant_id == user.tenant_id, m.ProjectMember.user_id == user.id)
    if user.role == m.RoleEnum.MANAGER:
        return stmt.where(or_(m.Project.id.in_(managed_project_ids(user)), m.Project.id.in_(own_projects),
                              m.Project.id.in_(membership_projects)))
    return stmt.where(or_(m.Project.id.in_(own_projects), m.Project.id.in_(membership_projects)))


def authorized_users(user):
    stmt = select(m.User).where(m.User.tenant_id == user.tenant_id)
    if admin(user):
        return stmt
    if user.role != m.RoleEnum.MANAGER:
        return stmt.where(m.User.id == user.id)
    members = select(m.ProjectMember.user_id).where(
        m.ProjectMember.tenant_id == user.tenant_id,
        m.ProjectMember.project_id.in_(managed_project_ids(user)))
    managed_tasks = select(m.Task.id).where(task_tenant_predicate(user),
                                           m.Task.project_id.in_(managed_project_ids(user)))
    parent_assignees = select(m.Task.assigned_to_id).where(m.Task.id.in_(managed_tasks))
    child_assignees = select(m.Subtask.assigned_to_id).where(m.Subtask.task_id.in_(managed_tasks))
    managed_children = select(m.Subtask.id).where(m.Subtask.task_id.in_(managed_tasks))
    historical_workers = select(m.TimeEntry.user_id).where(
        m.TimeEntry.tenant_id == user.tenant_id,
        or_(m.TimeEntry.task_id.in_(managed_tasks), m.TimeEntry.subtask_id.in_(managed_children)))
    conditions = [m.User.id == user.id, m.User.id.in_(members), m.User.id.in_(parent_assignees),
                  m.User.id.in_(child_assignees), m.User.id.in_(historical_workers)]
    if user.department_id:
        conditions.append(m.User.department_id == user.department_id)
    return stmt.where(or_(*conditions))


def validate_filters(db, user, filters):
    if filters.employee_id and db.scalar(authorized_users(user).with_only_columns(m.User.id).where(
            m.User.id == filters.employee_id)) is None:
        raise HTTPException(404, "Employee not found")
    if filters.project_id and db.scalar(authorized_projects(user).with_only_columns(m.Project.id).where(
            m.Project.id == filters.project_id)) is None:
        raise HTTPException(404, "Project not found")


def filtered_tasks(user, filters, inventory_dates=True):
    stmt = authorized_tasks(user)
    if filters.project_id:
        stmt = stmt.where(m.Task.project_id == filters.project_id)
    if filters.employee_id:
        stmt = stmt.where(or_(m.Task.assigned_to_id == filters.employee_id,
                             m.Task.subtasks.any(m.Subtask.assigned_to_id == filters.employee_id)))
    if filters.status:
        stmt = stmt.where(m.Task.status == filters.status)
    if filters.search:
        # Escape LIKE metacharacters so search is literal and parameterized.
        needle = filters.search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(m.Task.title.ilike(f"%{needle}%", escape="\\"))
    if inventory_dates:
        if filters.start_at:
            stmt = stmt.where(m.Task.created_at >= filters.start_at.replace(tzinfo=None))
        if filters.end_at:
            stmt = stmt.where(m.Task.created_at < filters.end_at.replace(tzinfo=None))
    return stmt


def visible_subtasks(user, filters, task_ids):
    stmt = select(m.Subtask).where(m.Subtask.task_id.in_(task_ids))
    if not admin(user) and user.role == m.RoleEnum.MANAGER:
        managed = [m.Task.project_id.in_(managed_project_ids(user)),
                   and_(m.Task.project_id.is_(None), m.Task.created_by_id == user.id)]
        if user.department_id:
            managed.append(and_(m.Task.project_id.is_(None), m.Task.assignee.has(
                and_(m.User.tenant_id == user.tenant_id, m.User.department_id == user.department_id))))
        permitted_parents = select(m.Task.id).where(task_tenant_predicate(user), or_(*managed))
        stmt = stmt.where(or_(m.Subtask.assigned_to_id == user.id, m.Subtask.task_id.in_(permitted_parents)))
    if filters.employee_id:
        stmt = stmt.where(m.Subtask.assigned_to_id == filters.employee_id)
    elif not admin(user) and user.role != m.RoleEnum.MANAGER:
        stmt = stmt.where(m.Subtask.assigned_to_id == user.id)
    return stmt
