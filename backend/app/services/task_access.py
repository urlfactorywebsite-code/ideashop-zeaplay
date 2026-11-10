"""Shared tenant boundary and assignment isolation for multi-assignee quests."""
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import aliased, object_session
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


def group_assignment_predicate(user: models.User):
    """Intersect existing read scopes; project membership alone cannot expose peers.

    Legacy tasks without a group ID retain their existing permissions. A grouped
    assignment stays private even when it is the last surviving row in its group.
    Admin/Owner already have tenant-wide task access. Managers must have an
    explicit project-manager membership or the existing assignee-department scope.
    Approvers retain their explicit access to the assignment they review.
    """
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return task_tenant_predicate(user)
    allowed = [models.Task.created_by_id == user.id, models.Task.assigned_to_id == user.id,
               models.Task.approver_id == user.id]
    # An authorized project manager can append an assignment under their own
    # creator identity. Retain the original creator's existing project read
    # access to that same logical quest without granting peer write access.
    creator_peer = aliased(models.Task)
    created_group_member = select(creator_peer.id).where(
        creator_peer.task_group_id == models.Task.task_group_id,
        creator_peer.project_id == models.Task.project_id,
        creator_peer.created_by_id == user.id,
    ).correlate(models.Task).exists()
    allowed.append(and_(models.Task.project_id.is_not(None), created_group_member,
        models.Task.project.has(models.Project.members.any(and_(
            models.ProjectMember.user_id == user.id,
            models.ProjectMember.tenant_id == user.tenant_id)))))
    # A single-assignee task can still have an ordered subtask handoff or an
    # explicit observer. Preserve those grants without opening sibling rows in
    # multi-assignee quests, whose subtasks/followers may be copied at creation.
    peer = aliased(models.Task)
    has_peer = select(peer.id).where(
        peer.task_group_id == models.Task.task_group_id, peer.id != models.Task.id,
        or_(peer.project_id == models.Task.project_id,
            and_(peer.project_id.is_(None), models.Task.project_id.is_(None),
                 peer.created_by_id == models.Task.created_by_id)),
    ).correlate(models.Task).exists()
    allowed.append(and_(~has_peer, or_(
        models.Task.subtasks.any(models.Subtask.assigned_to_id == user.id),
        models.Task.followers.any(models.User.id == user.id))))
    if user.role == models.RoleEnum.MANAGER:
        allowed.append(models.Task.project.has(models.Project.members.any(and_(
            models.ProjectMember.user_id == user.id,
            models.ProjectMember.tenant_id == user.tenant_id,
            models.ProjectMember.role == models.ProjectMemberRoleEnum.MANAGER))))
        if user.department_id:
            allowed.append(models.Task.assignee.has(and_(
                models.User.tenant_id == user.tenant_id,
                models.User.department_id == user.department_id)))
    return and_(task_tenant_predicate(user), or_(
        models.Task.task_group_id.is_(None), models.Task.task_group_id == "", *allowed))


def ensure_group_assignment_access(task: models.Task, user: models.User) -> None:
    if not task_belongs_to_user_tenant(task, user):
        raise HTTPException(404, 'Task not found')
    if not task.task_group_id:
        return
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER} or user.id in {
            task.created_by_id, task.assigned_to_id, task.approver_id}:
        return
    # Batch-loaded manager grants avoid a policy query for every task row.
    if user.role == models.RoleEnum.MANAGER:
        if task.project and any(member.user_id == user.id
                and str(member.tenant_id) == str(user.tenant_id)
                and member.role == models.ProjectMemberRoleEnum.MANAGER for member in task.project.members):
            return
        if (user.department_id and task.assignee
                and str(task.assignee.tenant_id) == str(user.tenant_id)
                and task.assignee.department_id == user.department_id):
            return
    db = object_session(task)
    if db is None or not db.scalar(select(models.Task.id).where(
            models.Task.id == task.id, group_assignment_predicate(user))):
        raise HTTPException(403, 'Insufficient permissions for this assignment')


def assignment_reference_predicate(user: models.User, task_id):
    """Hide references to existing restricted assignments, retaining deleted history."""
    return ~select(models.Task.id).where(
        models.Task.id == task_id, ~func.coalesce(group_assignment_predicate(user), False)).exists()


def notification_assignment_predicate(user: models.User):
    notice = models.Notification
    subtask_parent = select(models.Subtask.task_id).where(
        models.Subtask.id == notice.entity_id).correlate(notice).scalar_subquery()
    reference = func.coalesce(notice.related_task_id, case(
        (notice.entity_type == models.NotificationEntityTypeEnum.TASK, notice.entity_id),
        (notice.entity_type == models.NotificationEntityTypeEnum.SUBTASK, subtask_parent)))
    return assignment_reference_predicate(user, reference)


def ensure_task_update_access(task, user):
    if not task_belongs_to_user_tenant(task, user):
        raise HTTPException(404, 'Task not found')
    if task.ticket_id:
        if user.id not in {task.created_by_id, task.assigned_to_id}:
            raise HTTPException(403, 'Only the task creator or assignee can update this ticket task')
        ensure_group_assignment_access(task, user)
        return
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER} or user.id in {task.created_by_id, task.assigned_to_id}:
        ensure_group_assignment_access(task, user)
        return
    if user.role == models.RoleEnum.MANAGER:
        if task.project and any(member.user_id == user.id and member.role == models.ProjectMemberRoleEnum.MANAGER for member in task.project.members):
            ensure_group_assignment_access(task, user)
            return
        if not task.project and user.department_id and task.assignee and task.assignee.department_id == user.department_id:
            ensure_group_assignment_access(task, user)
            return
    raise HTTPException(403, 'Task updates require ownership, assignment, or manager access')
