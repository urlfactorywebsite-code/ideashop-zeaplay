from __future__ import annotations

import math
from collections import Counter
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from . import audit_logger, projects as project_service, security_audit


STATUS_POLICY = (
    "Task.status is the manual parent-task status and always remains the persisted source of truth. "
    "Dashboard derived_status is read-only: terminal/manual control statuses take precedence; otherwise "
    "subtasks roll up to BLOCKED, IN_REVIEW, IN_PROGRESS, WAITING_FOR_REQUIREMENT or DONE. "
    "Progress is computed only from subtasks whose workflow status is DONE and never changes task.status or XP."
)

MANUAL_PRECEDENCE_STATUSES = {
    models.TaskStatusEnum.DEPLOYED,
    models.TaskStatusEnum.FAILED,
    models.TaskStatusEnum.GRAVEYARD,
    models.TaskStatusEnum.ON_HOLD,
}

ACTIONABLE_SUBTASK_STATUSES = {
    models.SubtaskStatusEnum.TODO,
    models.SubtaskStatusEnum.IN_PROGRESS,
}


def _is_subtask_done(subtask: models.Subtask | schemas.ProjectDashboardSubtask) -> bool:
    return subtask.status == models.SubtaskStatusEnum.DONE


def _is_admin(actor: models.User) -> bool:
    return actor.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}


def _project_manager_ids(project: models.Project) -> set[str]:
    return {
        member.user_id
        for member in project.members
        if member.role == models.ProjectMemberRoleEnum.MANAGER
        and member.user is not None
        and member.user.status == models.UserStatusEnum.ACTIVE
    }


def _ensure_can_override(project: models.Project, actor: models.User) -> None:
    if _is_admin(actor):
        return
    if actor.role == models.RoleEnum.MANAGER and actor.id in _project_manager_ids(project):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project manager access required")


def _task_query():
    return (
        select(models.Task)
        .options(
            selectinload(models.Task.assignee),
            selectinload(models.Task.time_entries),
            selectinload(models.Task.project).selectinload(models.Project.client),
            selectinload(models.Task.project).selectinload(models.Project.members).selectinload(models.ProjectMember.user),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.assigned_user),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.dependency_edges),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.dependent_edges),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.time_entries),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.completion_submissions),
        )
        .order_by(models.Task.created_at.desc(), models.Task.id.asc())
    )


def _subtask_dependency_state(subtask: models.Subtask, subtasks_by_id: dict[str, models.Subtask]) -> str:
    if subtask.status == models.SubtaskStatusEnum.WAITING:
        return "WAITING"
    dependencies = sorted(subtask.dependency_edges, key=lambda edge: edge.dependency_order)
    if not dependencies:
        return "READY"
    predecessor_statuses = [
        subtasks_by_id[edge.depends_on_subtask_id].status
        for edge in dependencies
        if edge.depends_on_subtask_id in subtasks_by_id
    ]
    if any(status == models.SubtaskStatusEnum.BLOCKED for status in predecessor_statuses):
        return "BLOCKED"
    if any(status != models.SubtaskStatusEnum.DONE for status in predecessor_statuses):
        return "WAITING"
    return "READY"


def _derive_task_status(task: models.Task) -> tuple[models.TaskStatusEnum, str]:
    if task.status in MANUAL_PRECEDENCE_STATUSES:
        return task.status, "manual_override"
    if not task.subtasks:
        return task.status, "task_status"
    statuses = [subtask.status for subtask in task.subtasks]
    if all(_is_subtask_done(subtask) for subtask in task.subtasks):
        return models.TaskStatusEnum.DONE, "subtask_rollup"
    if any(status == models.SubtaskStatusEnum.BLOCKED for status in statuses):
        return models.TaskStatusEnum.BLOCKED, "subtask_rollup"
    if any(status == models.SubtaskStatusEnum.IN_REVIEW for status in statuses):
        return models.TaskStatusEnum.IN_REVIEW, "subtask_rollup"
    if any(status == models.SubtaskStatusEnum.IN_PROGRESS for status in statuses):
        return models.TaskStatusEnum.IN_PROGRESS, "subtask_rollup"
    if all(status == models.SubtaskStatusEnum.WAITING for status in statuses):
        return models.TaskStatusEnum.WAITING_FOR_REQUIREMENT, "subtask_rollup"
    return task.status, "task_status"


def _progress(task: models.Task) -> tuple[int, int, int]:
    total = len(task.subtasks)
    done = sum(1 for subtask in task.subtasks if _is_subtask_done(subtask))
    percent = int(round((done / total) * 100)) if total else 0
    return done, total, percent


def _active_timer_users(entries: list[models.TimeEntry]) -> list[str]:
    return sorted({entry.user_id for entry in entries if entry.stopped_at is None})


def _tracked_seconds(entries: list[models.TimeEntry]) -> int:
    return sum(entry.duration_seconds or 0 for entry in entries if entry.stopped_at is not None)


def _latest_submission_status(subtask: models.Subtask) -> Optional[models.CompletionSubmissionStatusEnum]:
    if not subtask.completion_submissions:
        return None
    latest = max(subtask.completion_submissions, key=lambda submission: submission.created_at)
    return latest.status


def _force_started(db: Session, subtask_id: str) -> bool:
    return (
        db.execute(
            select(models.SubtaskWorkflowEvent.id)
            .where(models.SubtaskWorkflowEvent.subtask_id == subtask_id)
            .where(models.SubtaskWorkflowEvent.event_type == "SUBTASK_FORCE_STARTED")
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )


def _serialize_dashboard_task(
    db: Session,
    task: models.Task,
    *,
    force_started_ids: Optional[set[str]] = None,
) -> schemas.ProjectDashboardTask:
    sorted_subtasks = sorted(task.subtasks, key=lambda subtask: (subtask.sort_order or 0, subtask.id))
    subtasks_by_id = {subtask.id: subtask for subtask in sorted_subtasks}
    done, total, percent = _progress(task)
    derived_status, status_source = _derive_task_status(task)
    task_seconds = _tracked_seconds(task.time_entries)
    subtask_seconds = sum(_tracked_seconds(subtask.time_entries) for subtask in sorted_subtasks)
    task_active_timer_users = _active_timer_users(task.time_entries)
    subtasks = []
    for subtask in sorted_subtasks:
        dependencies = sorted(subtask.dependency_edges, key=lambda edge: edge.dependency_order)
        subtasks.append(
            schemas.ProjectDashboardSubtask(
                id=subtask.id,
                title=subtask.title,
                completed=subtask.completed,
                assigned_to_id=subtask.assigned_to_id,
                assigned_user_name=subtask.assigned_user.name if subtask.assigned_user else None,
                status=subtask.status,
                sort_order=subtask.sort_order,
                dependency_ids=[edge.depends_on_subtask_id for edge in dependencies],
                dependent_ids=[edge.subtask_id for edge in sorted(subtask.dependent_edges, key=lambda edge: edge.dependency_order)],
                dependency_state=_subtask_dependency_state(subtask, subtasks_by_id),
                branch_key=dependencies[0].branch_key if dependencies else None,
                total_tracked_seconds=_tracked_seconds(subtask.time_entries),
                active_timer_user_ids=_active_timer_users(subtask.time_entries),
                completion_approval_required=bool(
                    task.subtask_approval_required
                    if task.subtask_approval_required is not None
                    else task.project and task.project.subtask_approval_required_default
                ),
                latest_submission_status=_latest_submission_status(subtask),
                force_started=subtask.id in force_started_ids if force_started_ids is not None else _force_started(db, subtask.id),
            )
        )
    return schemas.ProjectDashboardTask(
        id=task.id,
        title=task.title,
        description=task.description or "",
        status=task.status,
        derived_status=derived_status,
        status_source=status_source,
        priority=task.priority,
        assigned_to_id=task.assigned_to_id,
        assigned_user_name=task.assignee.name if task.assignee else None,
        project_id=task.project_id,
        due_at=task.due_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
        progress_percent=percent,
        completed_subtasks=done,
        total_subtasks=total,
        total_tracked_seconds=task_seconds + subtask_seconds,
        active_timer_user_ids=task_active_timer_users,
        subtasks=subtasks,
    )


def _build_workload(project: models.Project, tasks: list[models.Task]) -> list[schemas.ProjectDashboardWorkload]:
    workload = {
        member.user_id: schemas.ProjectDashboardWorkload(
            user_id=member.user_id,
            name=member.user.name if member.user else member.user_id,
            role=member.role,
        )
        for member in project.members
        if member.user is not None
    }
    for task in tasks:
        if task.assigned_to_id in workload:
            workload[task.assigned_to_id].assigned_tasks += 1
            workload[task.assigned_to_id].total_tracked_seconds += _tracked_seconds(task.time_entries)
        for subtask in task.subtasks:
            if subtask.assigned_to_id not in workload:
                continue
            item = workload[subtask.assigned_to_id]
            item.assigned_subtasks += 1
            item.total_tracked_seconds += _tracked_seconds(subtask.time_entries)
            if subtask.status in ACTIONABLE_SUBTASK_STATUSES:
                item.actionable_subtasks += 1
            elif subtask.status == models.SubtaskStatusEnum.WAITING:
                item.waiting_subtasks += 1
            elif subtask.status == models.SubtaskStatusEnum.BLOCKED:
                item.blocked_subtasks += 1
            elif subtask.status == models.SubtaskStatusEnum.IN_REVIEW:
                item.in_review_subtasks += 1
            elif subtask.status == models.SubtaskStatusEnum.DONE:
                item.completed_subtasks += 1
    return sorted(workload.values(), key=lambda item: (item.role.value, item.name.casefold()))


def _force_started_ids(db: Session, tasks: list[models.Task]) -> set[str]:
    subtask_ids = [subtask.id for task in tasks for subtask in task.subtasks]
    if not subtask_ids:
        return set()
    return set(
        db.execute(
            select(models.SubtaskWorkflowEvent.subtask_id)
            .where(models.SubtaskWorkflowEvent.subtask_id.in_(subtask_ids))
            .where(models.SubtaskWorkflowEvent.event_type == "SUBTASK_FORCE_STARTED")
        ).scalars().all()
    )


def project_task_dashboard(
    db: Session,
    *,
    project_id: str,
    actor: models.User,
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    status_filter: Optional[models.TaskStatusEnum] = None,
    priority_filter: Optional[models.TaskPriorityEnum] = None,
    member_id: Optional[str] = None,
) -> schemas.ProjectTaskDashboardResponse:
    project = project_service.get_project(db, tenant_id=actor.tenant_id, project_id=project_id, actor=actor)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    stmt = _task_query().where(models.Task.project_id == project.id)
    if search:
        needle = f"%{search.strip().casefold()}%"
        stmt = stmt.where(or_(func.lower(models.Task.title).like(needle), func.lower(models.Task.description).like(needle)))
    if status_filter:
        stmt = stmt.where(models.Task.status == status_filter)
    if priority_filter:
        stmt = stmt.where(models.Task.priority == priority_filter)
    if member_id:
        stmt = stmt.where(
            or_(
                models.Task.assigned_to_id == member_id,
                models.Task.subtasks.any(models.Subtask.assigned_to_id == member_id),
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    tasks = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).unique().scalars().all()
    all_project_tasks = db.execute(_task_query().where(models.Task.project_id == project.id)).unique().scalars().all()
    force_started_ids = _force_started_ids(db, all_project_tasks)
    dashboard_tasks = [_serialize_dashboard_task(db, task, force_started_ids=force_started_ids) for task in tasks]
    all_dashboard_tasks = [_serialize_dashboard_task(db, task, force_started_ids=force_started_ids) for task in all_project_tasks]

    status_counts = Counter(task.status for task in all_project_tasks)
    derived_status_counts = Counter(task.derived_status for task in all_dashboard_tasks)
    priority_counts = Counter(task.priority for task in all_project_tasks)
    subtask_status_counts: Counter[models.SubtaskStatusEnum] = Counter()
    subtask_total = 0
    completed_subtasks = 0
    total_tracked_seconds = 0
    active_timer_users = set()
    for task in all_dashboard_tasks:
        total_tracked_seconds += task.total_tracked_seconds
        active_timer_users.update(task.active_timer_user_ids)
        for subtask in task.subtasks:
            subtask_total += 1
            subtask_status_counts[subtask.status] += 1
            completed_subtasks += 1 if _is_subtask_done(subtask) else 0
            active_timer_users.update(subtask.active_timer_user_ids)
    progress_percent = int(round((completed_subtasks / subtask_total) * 100)) if subtask_total else 0

    summary = schemas.ProjectDashboardSummary(
        task_total=len(all_project_tasks),
        subtask_total=subtask_total,
        completed_subtasks=completed_subtasks,
        progress_percent=progress_percent,
        total_tracked_seconds=total_tracked_seconds,
        active_timer_count=len(active_timer_users),
        status_counts={status: int(status_counts.get(status, 0)) for status in models.TaskStatusEnum},
        derived_status_counts={status: int(derived_status_counts.get(status, 0)) for status in models.TaskStatusEnum},
        subtask_status_counts={status: int(subtask_status_counts.get(status, 0)) for status in models.SubtaskStatusEnum},
        priority_counts={priority: int(priority_counts.get(priority, 0)) for priority in models.TaskPriorityEnum},
        workload=_build_workload(project, all_project_tasks),
    )
    return schemas.ProjectTaskDashboardResponse(
        project=project_service.to_read(project, task_count=len(all_project_tasks)),
        summary=summary,
        items=dashboard_tasks,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=max(1, math.ceil(total / page_size)) if total else 1,
        status_policy=STATUS_POLICY,
    )


def override_project_task_status(
    db: Session,
    *,
    project_id: str,
    task_id: str,
    payload: schemas.ProjectTaskStatusOverride,
    actor: models.User,
) -> schemas.ProjectDashboardTask:
    project = project_service.get_project(db, tenant_id=actor.tenant_id, project_id=project_id, actor=actor)
    _ensure_can_override(project, actor)
    task = db.execute(_task_query().where(models.Task.id == task_id).where(models.Task.project_id == project.id)).unique().scalars().first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    previous_status = task.status
    task.status = payload.status
    task.updated_at = datetime.utcnow()
    security_audit.append_event(
        db,
        actor=actor,
        event_type="task.status_overridden",
        entity_type="task",
        entity_id=task.id,
        payload={
            "project_id": project.id,
            "from_status": previous_status.value,
            "to_status": payload.status.value,
            "reason_provided": bool(payload.reason),
            "xp_awarded": False,
        },
    )
    db.commit()
    db.refresh(task)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="PROJECT_TASK_STATUS_OVERRIDE",
            category=models.AuditLogCategoryEnum.TASK,
            actor_id=actor.id,
            actor_role=actor.role.value if actor.role else None,
            entity_type="task",
            entity_id=task.id,
            old_value=previous_status.value,
            new_value=payload.status.value,
            source=models.AuditLogSourceEnum.MANUAL,
            reason=payload.reason,
            metadata={"project_id": project.id, "xp_awarded": False},
        )
    )
    task = db.execute(_task_query().where(models.Task.id == task.id)).unique().scalars().first()
    return _serialize_dashboard_task(db, task, force_started_ids=_force_started_ids(db, [task]))
