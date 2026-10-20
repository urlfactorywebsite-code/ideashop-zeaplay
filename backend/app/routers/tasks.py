from datetime import datetime, date, time, timedelta
import hashlib
import json
import time as perf_time
from threading import Lock
from typing import Any, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from ..realtime import capture as realtime_capture
from sqlalchemy import and_, case, func, inspect, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
import os
import shutil
from uuid import uuid4

from .. import models, schemas
from ..cache import build_cache_key, get_cached_json, invalidate_prefix, set_cached_json
from ..config import get_settings
from ..notifiers import get_notifier
from ..database import get_db
from ..dependencies import get_current_active_user
from ..integrations import trigger_n8n_event
from ..services import notifications as notification_service
from ..services import audit_logger, task_events, task_notifications
from ..tickets import task_link_service
from ..tickets.models import Ticket
from ..services.gamification import (
    COMPLETED_STATUSES,
    award_task_completion_points,
    check_and_unlock_achievements,
    record_clarity_rating,
)
from ..services import notification_outbox, security_audit, subtask_completion, subtask_notifications, subtask_workflow
from ..services.badge_engine import BadgeEvent, process_badge_event
from ..services.points_table import get_task_creation_points
from ..services.task_access import (
    task_belongs_to_user_tenant as _task_belongs_to_user_tenant,
    task_tenant_predicate as _task_tenant_predicate,
)
from .task_lifecycle import router as task_lifecycle_router

router = APIRouter(prefix="/tasks", tags=["tasks"])
router.include_router(task_lifecycle_router)
settings = get_settings()
_completion_review_locks: dict[str, Lock] = {}
_completion_review_locks_guard = Lock()


def _completion_review_lock(submission_id: str) -> Lock:
    with _completion_review_locks_guard:
        lock = _completion_review_locks.get(submission_id)
        if lock is None:
            lock = Lock()
            _completion_review_locks[submission_id] = lock
        return lock


def _task_query() -> select:
    # UserRead computes claimed/overall XP from claims; batch these for every
    # serialized assignee instead of issuing one query per subtask user.
    user_details = (
        selectinload(models.User.reward_claims).selectinload(models.RewardClaim.reward),
        joinedload(models.User.department), joinedload(models.User.avatar_asset),
    )
    return (
        select(models.Task)
        .options(
            selectinload(models.Task.subtasks),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.assigned_user).options(*user_details),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.dependency_edges),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.dependent_edges),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.time_entries),
            selectinload(models.Task.subtasks)
            .selectinload(models.Subtask.completion_submissions)
            .selectinload(models.CompletionSubmission.attachments),
            selectinload(models.Task.time_entries),
            selectinload(models.Task.assignee).options(*user_details),
            selectinload(models.Task.creator).options(*user_details),
            selectinload(models.Task.followers),
            selectinload(models.Task.dependencies),
            selectinload(models.Task.project).selectinload(models.Project.client),
            selectinload(models.Task.project).selectinload(models.Project.members),
        )
        .order_by(models.Task.created_at.desc())
    )


def _status_title_map(db: Session) -> dict[str, str]:
    try:
        inspector = inspect(db.bind)
        if "kanban_columns" not in inspector.get_table_names():
            return {}
    except Exception:
        return {}
    rows = db.execute(select(models.KanbanColumn.id, models.KanbanColumn.title)).all()
    return {row[0]: row[1] for row in rows}


def _resolve_status_title(status: models.TaskStatusEnum, status_title_map: dict[str, str]) -> str:
    status_key = getattr(status, "value", status)
    return status_title_map.get(status_key, status_key)


def _serialize_task_project(project: Optional[models.Project]) -> Optional[schemas.TaskProjectSummary]:
    if not project:
        return None
    return schemas.TaskProjectSummary(
        id=project.id,
        name=project.name,
        client_id=project.client_id,
        client_name=project.client.company_name if project.client else None,
        status=project.status,
    )


def _subtask_dependency_state(
    subtask: models.Subtask,
    subtasks_by_id: dict[str, models.Subtask],
) -> str:
    if subtask.status == models.SubtaskStatusEnum.WAITING:
        return "WAITING"
    dependencies = sorted(subtask.dependency_edges, key=lambda edge: edge.dependency_order)
    if not dependencies:
        return "READY"
    dependency_statuses = [
        subtasks_by_id[edge.depends_on_subtask_id].status
        for edge in dependencies
        if edge.depends_on_subtask_id in subtasks_by_id
    ]
    if any(status == models.SubtaskStatusEnum.BLOCKED for status in dependency_statuses):
        return "BLOCKED"
    if any(status != models.SubtaskStatusEnum.DONE for status in dependency_statuses):
        return "WAITING"
    return "READY"


def _serialize_subtask(
    task: models.Task,
    subtask: models.Subtask,
    subtasks_by_id: dict[str, models.Subtask],
    viewer: Optional[models.User] = None,
) -> schemas.SubtaskRead:
    dependencies = sorted(subtask.dependency_edges, key=lambda edge: edge.dependency_order)
    total_tracked_seconds = sum(entry.duration_seconds or 0 for entry in subtask.time_entries)
    tenant = task.project.tenant_id if task.project else task.creator.tenant_id if task.creator else None
    submissions = sorted((row for row in subtask.completion_submissions
        if row.tenant_id == tenant and row.task_id == task.id and row.subtask_id == subtask.id),
        key=lambda row: (row.created_at, row.id))
    serialized_submissions = [_serialize_completion_submission(task, subtask, row, viewer) for row in submissions]
    latest_submission = serialized_submissions[-1] if serialized_submissions else None
    return schemas.SubtaskRead(
        id=subtask.id,
        title=subtask.title,
        completed=subtask.completed,
        assigned_to_id=subtask.assigned_to_id,
        assigned_user=schemas.UserRead.model_validate(subtask.assigned_user) if subtask.assigned_user else None,
        status=subtask.status,
        sort_order=subtask.sort_order,
        dependency_ids=[edge.depends_on_subtask_id for edge in dependencies],
        dependent_ids=[edge.subtask_id for edge in sorted(subtask.dependent_edges, key=lambda edge: edge.dependency_order)],
        dependencies=[schemas.SubtaskDependencyRead.model_validate(edge) for edge in dependencies],
        dependency_state=_subtask_dependency_state(subtask, subtasks_by_id),
        total_tracked_seconds=total_tracked_seconds,
        completion_approval_required=subtask_completion.approval_required_for(task),
        latest_completion_submission=latest_submission,
        completion_submissions=serialized_submissions,
    )


def _serialize_subtasks(task: models.Task, viewer: Optional[models.User] = None) -> list[schemas.SubtaskRead]:
    sorted_subtasks = sorted(task.subtasks, key=lambda subtask: (subtask.sort_order or 0, subtask.id))
    subtasks_by_id = {subtask.id: subtask for subtask in sorted_subtasks}
    return [_serialize_subtask(task, subtask, subtasks_by_id, viewer) for subtask in sorted_subtasks]


def _stabilize_subtasks_for_serialization(task: models.Task) -> None:
    for index, subtask in enumerate(task.subtasks):
        if subtask.sort_order is None:
            set_committed_value(subtask, "sort_order", index)


def _serialize_task(task: models.Task, status_title_map: dict[str, str], viewer: Optional[models.User] = None) -> schemas.TaskRead:
    if task.attachments is None:
        task.attachments = []
    if task.tags is None:
        task.tags = []
    _stabilize_subtasks_for_serialization(task)
    payload = schemas.TaskRead.model_validate(task)
    total_tracked_seconds = sum(entry.duration_seconds or 0 for entry in task.time_entries)
    total_tracked_seconds += sum(
        entry.duration_seconds or 0
        for subtask in task.subtasks
        for entry in subtask.time_entries
    )
    capabilities = {"can_edit": False, "can_manage_subtasks": False, "can_review_subtasks": False}
    if viewer:
        try:
            _ensure_task_access(task, viewer)
        except HTTPException:
            pass
        else:
            for capability, check in (
                ("can_edit", _ensure_task_update_access),
                ("can_manage_subtasks", _ensure_subtask_workflow_write),
                ("can_review_subtasks", _ensure_can_review_subtask_completion),
            ):
                try:
                    check(task, viewer)
                except HTTPException:
                    continue
                capabilities[capability] = True
    return payload.model_copy(update={
        **capabilities,
        "status_title": _resolve_status_title(task.status, status_title_map),
        "follower_ids": [follower.id for follower in task.followers],
        "project": _serialize_task_project(task.project),
        "subtasks": _serialize_subtasks(task, viewer),
        "total_tracked_seconds": total_tracked_seconds,
    })


def _serialize_tasks(tasks: List[models.Task], status_title_map: dict[str, str], viewer: Optional[models.User] = None) -> List[schemas.TaskRead]:
    return [_serialize_task(task, status_title_map, viewer) for task in tasks]


def _serialize_task_list_item(task: models.Task) -> schemas.TaskListItem:
    if task.attachments is None:
        task.attachments = []
    if task.tags is None:
        task.tags = []
    _stabilize_subtasks_for_serialization(task)
    payload = schemas.TaskListItem.model_validate(task)
    total_tracked_seconds = sum(entry.duration_seconds or 0 for entry in task.time_entries)
    total_tracked_seconds += sum(
        entry.duration_seconds or 0
        for subtask in task.subtasks
        for entry in subtask.time_entries
    )
    return payload.model_copy(update={
        "follower_ids": [follower.id for follower in task.followers],
        "project": _serialize_task_project(task.project),
        "subtasks": _serialize_subtasks(task),
        "total_tracked_seconds": total_tracked_seconds,
    })


def _serialize_task_list_items(tasks: List[models.Task]) -> List[schemas.TaskListItem]:
    return [_serialize_task_list_item(task) for task in tasks]


def _serialize_task_card_item(task: models.Task) -> schemas.TaskListItem:
    return schemas.TaskListItem(
        id=task.id,
        title=task.title,
        description=task.description or "",
        status=task.status,
        priority=task.priority,
        team=task.team,
        assigned_to_id=task.assigned_to_id,
        project_id=task.project_id,
        task_group_id=task.task_group_id,
        created_by_id=task.created_by_id,
        created_at=task.created_at,
        updated_at=task.updated_at,
        due_at=task.due_at,
        completed_at=task.completed_at,
        recurrence_rule=task.recurrence_rule,
        recurring_task_id=task.recurring_task_id,
        clarity_rating=task.clarity_rating,
        attachments=task.attachments or [],
        estimated_hours=task.estimated_hours,
        tags=task.tags or [],
        follower_ids=[],
        project=_serialize_task_project(task.project),
        subtasks=[],
    )


def _serialize_task_card_items(tasks: List[models.Task]) -> List[schemas.TaskListItem]:
    return [_serialize_task_card_item(task) for task in tasks]


def _serialize_task_leaderboard(task: models.Task, status_title_map: dict[str, str]) -> schemas.TaskLeaderboardRead:
    payload = schemas.TaskLeaderboardRead.model_validate(task)
    return payload.model_copy(update={"status_title": _resolve_status_title(task.status, status_title_map)})


def _serialize_leaderboard_tasks(tasks: List[models.Task], status_title_map: dict[str, str]) -> List[schemas.TaskLeaderboardRead]:
    return [_serialize_task_leaderboard(task, status_title_map) for task in tasks]


def _invalidate_task_cache(
    current_user: models.User,
    *,
    action: str = "invalidate",
    task_id: Optional[str] = None,
    task_ids: Optional[list[str]] = None,
) -> None:
    tenant_id = str(current_user.tenant_id or settings.default_tenant_id)
    payload: dict[str, Any] = {
        "type": "task.changed",
        "tenant_id": tenant_id,
        "action": action,
    }
    if task_id:
        payload["task_id"] = task_id
    if task_ids:
        payload["task_ids"] = task_ids
    try:
        invalidate_prefix(f"{settings.cache_prefix}:tasks:list:tenant:{tenant_id}:")
        invalidate_prefix(f"{settings.cache_prefix}:tasks:kanban:tenant:{tenant_id}:")
        invalidate_prefix(f"{settings.cache_prefix}:tasks:calendar:tenant:{tenant_id}:")
    except Exception:
        # Caches have bounded TTLs; Redis failure must not undo a committed task write.
        pass
    task_events.publish_task_event(payload)


def _publish_subtask_workflow_events(
    current_user: models.User,
    events: list[subtask_workflow.WorkflowDomainEvent],
) -> None:
    for event in subtask_workflow.event_payloads(events):
        task_events.publish_task_event(
            {
                "tenant_id": str(current_user.tenant_id),
                "type": "subtask.workflow",
                **event,
            }
        )


def _schedule_notification_outbox_delivery(background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(notification_outbox.run_due_notification_outbox)


def _finish_subtask_parent_completion(
    db: Session, task_id: str, result: subtask_workflow.WorkflowResult, background_tasks: BackgroundTasks,
) -> None:
    if result.parent_completed:
        background_tasks.add_task(trigger_n8n_event, "task.completed", {"taskId": task_id})
        task_link_service.handle_task_completion(db, task_id=task_id)


def _fetch_task_or_404(db: Session, task_id: str) -> models.Task:
    task = db.execute(_task_query().where(models.Task.id == task_id)).unique().scalars().first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _is_admin_or_owner(user: models.User) -> bool:
    return user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}


def _same_tenant(left: object, right: object) -> bool:
    return str(left) == str(right)


def _project_member_ids(project: models.Project) -> set[str]:
    return {member.user_id for member in project.members}


def _project_manager_ids(project: models.Project) -> set[str]:
    return {
        member.user_id
        for member in project.members
        if member.role == models.ProjectMemberRoleEnum.MANAGER
    }


def _ensure_project_visible(project: models.Project, user: models.User) -> None:
    if not _same_tenant(project.tenant_id, user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if _is_admin_or_owner(user):
        return
    if user.id not in _project_member_ids(project):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")


def _ensure_project_task_write(project: models.Project, user: models.User) -> None:
    _ensure_project_visible(project, user)
    if _is_admin_or_owner(user):
        return
    if user.role == models.RoleEnum.MANAGER and user.id in _project_manager_ids(project):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project manager access required")


def _fetch_project_for_task(
    db: Session,
    *,
    project_id: str,
    current_user: models.User,
    require_active: bool = True,
    require_write: bool = False,
) -> models.Project:
    project = (
        db.execute(
            select(models.Project)
            .options(selectinload(models.Project.members), selectinload(models.Project.client))
            .where(models.Project.id == project_id)
            .where(models.Project.tenant_id == current_user.tenant_id)
        )
        .scalars()
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if require_active and project.status != models.ProjectStatusEnum.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active project not found")
    if require_write:
        _ensure_project_task_write(project, current_user)
    else:
        _ensure_project_visible(project, current_user)
    return project


def _ensure_user_in_current_tenant(user: models.User, current_user: models.User, *, label: str) -> None:
    if not _same_tenant(user.tenant_id, current_user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")


def _ensure_project_assignee_allowed(project: Optional[models.Project], assignee_id: Optional[str]) -> None:
    if not project or not assignee_id:
        return
    if assignee_id not in _project_member_ids(project):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Task assignee must be a project member",
        )


def _normalize_subtask_status(
    *,
    completed: Optional[bool] = None,
    status_value: Optional[models.SubtaskStatusEnum] = None,
    current_status: Optional[models.SubtaskStatusEnum] = None,
) -> tuple[models.SubtaskStatusEnum, bool]:
    if status_value is not None:
        return status_value, status_value == models.SubtaskStatusEnum.DONE
    if completed is not None:
        return (models.SubtaskStatusEnum.DONE if completed else models.SubtaskStatusEnum.TODO), completed
    resolved_status = current_status or models.SubtaskStatusEnum.TODO
    return resolved_status, resolved_status == models.SubtaskStatusEnum.DONE


def _ensure_subtask_assignee_allowed(
    db: Session,
    task: models.Task,
    assignee_id: Optional[str],
    current_user: models.User,
) -> Optional[models.User]:
    if not assignee_id:
        return None
    assignee = db.get(models.User, assignee_id)
    if not assignee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask assignee not found")
    _ensure_user_in_current_tenant(assignee, current_user, label="Subtask assignee")
    _ensure_project_assignee_allowed(task.project, assignee.id)
    return assignee


def _ensure_subtask_workflow_write(task: models.Task, current_user: models.User) -> None:
    if task.project:
        _ensure_project_task_write(task.project, current_user)
        return
    if current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER, models.RoleEnum.MANAGER}:
        return
    if task.created_by_id == current_user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subtask workflow management requires task ownership")


def _can_override_subtask_workflow(task: models.Task, current_user: models.User) -> bool:
    return subtask_workflow.can_override_workflow(task, current_user)


def _ensure_task_access(task: models.Task, user: models.User) -> None:
    if not _task_belongs_to_user_tenant(task, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return
    if task.approver_id == user.id:
        return
    if task.project and user.id in _project_member_ids(task.project):
        return
    if user.role == models.RoleEnum.MANAGER:
        if (
            task.created_by_id == user.id
            or task.assigned_to_id == user.id
            or any(subtask.assigned_to_id == user.id for subtask in task.subtasks)
        ):
            return
        if any(follower.id == user.id for follower in task.followers):
            return
        if user.department_id:
            assignee_department_id = task.assignee.department_id if task.assignee else None
            if assignee_department_id == user.department_id:
                return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for this task")
    if (
        task.created_by_id != user.id
        and task.assigned_to_id != user.id
        and not any(subtask.assigned_to_id == user.id for subtask in task.subtasks)
        and not any(follower.id == user.id for follower in task.followers)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for this task")


def _ensure_task_update_access(task: models.Task, user: models.User) -> None:
    if not _task_belongs_to_user_tenant(task, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.ticket_id:
        if task.created_by_id != user.id and task.assigned_to_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the task creator or assignee can update this ticket task",
            )
        return
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return
    if user.id in {task.created_by_id, task.assigned_to_id}:
        return
    if user.role == models.RoleEnum.MANAGER:
        if task.project and user.id in _project_manager_ids(task.project):
            return
        if not task.project and user.department_id and task.assignee and task.assignee.department_id == user.department_id:
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Task updates require ownership, assignment, or manager access")


def _ensure_priority_allowed(priority: models.TaskPriorityEnum, user: models.User) -> None:
    return


def _apply_task_visibility(stmt: select, current_user: models.User) -> select:
    stmt = stmt.where(_task_tenant_predicate(current_user))
    if current_user.role == models.RoleEnum.MANAGER:
        visibility_filters = [
            models.Task.created_by_id == current_user.id,
            models.Task.assigned_to_id == current_user.id,
            models.Task.approver_id == current_user.id,
            models.Task.followers.any(models.User.id == current_user.id),
            models.Task.subtasks.any(models.Subtask.assigned_to_id == current_user.id),
            models.Task.project.has(
                models.Project.members.any(models.ProjectMember.user_id == current_user.id)
            ),
        ]
        if current_user.department_id:
            visibility_filters.append(
                models.Task.assignee.has(models.User.department_id == current_user.department_id)
            )
        return stmt.where(or_(*visibility_filters))
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return stmt.where(
            or_(
                models.Task.created_by_id == current_user.id,
                models.Task.assigned_to_id == current_user.id,
                models.Task.approver_id == current_user.id,
                models.Task.followers.any(models.User.id == current_user.id),
                models.Task.subtasks.any(models.Subtask.assigned_to_id == current_user.id),
                models.Task.project.has(
                    models.Project.members.any(models.ProjectMember.user_id == current_user.id)
                ),
            )
        )
    return stmt


def _resolve_task_followers(
    db: Session,
    follower_ids: Optional[List[str]],
    *,
    current_user: Optional[models.User] = None,
    exclude_ids: Optional[set[str]] = None,
) -> List[models.User]:
    """Resolve observer users without mixing them into assignee reward logic."""
    if not follower_ids:
        return []
    exclude_ids = exclude_ids or set()
    resolved: List[models.User] = []
    seen: set[str] = set()
    for follower_id in follower_ids:
        if not follower_id or follower_id in seen or follower_id in exclude_ids:
            continue
        user = db.get(models.User, follower_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Follower user {follower_id} not found")
        if current_user is not None:
            _ensure_user_in_current_tenant(user, current_user, label="Follower user")
        seen.add(follower_id)
        resolved.append(user)
    return resolved


def _notify_task_participants(
    db: Session,
    *,
    task: models.Task,
    current_user: models.User,
    title: str,
    message: str,
    exclude_ids: Optional[set[str]] = None,
    notification_type: models.NotificationTypeEnum = models.NotificationTypeEnum.TASK_UPDATED,
    deep_link: Optional[str] = None,
) -> None:
    recipient_ids = {follower.id for follower in task.followers}
    recipient_ids.update(subtask.assigned_to_id for subtask in task.subtasks if subtask.assigned_to_id)
    if task.assigned_to_id:
        recipient_ids.add(task.assigned_to_id)
    if task.project:
        recipient_ids.update(_project_manager_ids(task.project))
    recipient_ids.difference_update({current_user.id, task.created_by_id, *(exclude_ids or set())})
    for recipient_id in sorted(recipient_ids):
        notification_service.create_notification(
            db,
            user_id=recipient_id,
            actor_id=str(current_user.id),
            notification_type=notification_type,
            message=message,
            title=title,
            body=message,
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link=deep_link or f"/tasks/{task.id}",
            related_task_id=task.id,
        )


def _parse_date_filter(value: Optional[str]) -> Optional[tuple[datetime, datetime]]:
    if not value:
        return None
    try:
        if ".." in value:
            raw_start, raw_end = value.split("..", 1)
            if not raw_start and not raw_end:
                return None
            start_date = date.fromisoformat(raw_start or raw_end)
            end_date = date.fromisoformat(raw_end or raw_start)
            if start_date > end_date:
                start_date, end_date = end_date, start_date
            start = datetime(start_date.year, start_date.month, start_date.day)
            end = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59)
            return start, end

        parsed = date.fromisoformat(value)
        start = datetime(parsed.year, parsed.month, parsed.day)
        end = datetime(parsed.year, parsed.month, parsed.day, 23, 59, 59)
        return start, end
    except ValueError:
        return None


def _status_sort_expression() -> case:
    order = {
        models.TaskStatusEnum.WAITING_FOR_REQUIREMENT: 0,
        models.TaskStatusEnum.TODO: 1,
        models.TaskStatusEnum.IN_PROGRESS: 2,
        models.TaskStatusEnum.BUG_FIXING: 3,
        models.TaskStatusEnum.BLOCKED: 4,
        models.TaskStatusEnum.IN_REVIEW: 5,
        models.TaskStatusEnum.ON_HOLD: 6,
        models.TaskStatusEnum.DONE: 7,
        models.TaskStatusEnum.DEPLOYED: 8,
        models.TaskStatusEnum.FAILED: 9,
        models.TaskStatusEnum.GRAVEYARD: 10,
    }
    return case(order, value=models.Task.status, else_=99)


def _priority_sort_expression() -> case:
    order = {
        models.TaskPriorityEnum.LOW: 0,
        models.TaskPriorityEnum.MEDIUM: 1,
        models.TaskPriorityEnum.HIGH: 2,
        models.TaskPriorityEnum.URGENT: 3,
    }
    return case(order, value=models.Task.priority, else_=99)


def _hash_params(params: dict[str, Any]) -> str:
    payload = json.dumps(params, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _list_cache_key(*, tenant_id: str, user_id: str, params: dict[str, Any]) -> str:
    fingerprint = _hash_params(params)
    return f"{settings.cache_prefix}:tasks:list:tenant:{tenant_id}:user:{user_id}:q:{fingerprint}"


def _kanban_cache_key(*, tenant_id: str, user_id: str, params: dict[str, Any]) -> str:
    fingerprint = _hash_params(params)
    return f"{settings.cache_prefix}:tasks:kanban:tenant:{tenant_id}:user:{user_id}:q:{fingerprint}"


def _calendar_cache_key(*, tenant_id: str, user_id: str, params: dict[str, Any]) -> str:
    fingerprint = _hash_params(params)
    return f"{settings.cache_prefix}:tasks:calendar:tenant:{tenant_id}:user:{user_id}:q:{fingerprint}"


def _lean_task_stmt() -> select:
    return select(models.Task).options(
        selectinload(models.Task.project).selectinload(models.Project.client),
    )


def _apply_task_filters(
    stmt: select,
    db: Session,
    current_user: models.User,
    *,
    search: Optional[str] = None,
    status_filter: Optional[models.TaskStatusEnum] = None,
    priority: Optional[models.TaskPriorityEnum] = None,
    assignee_id: Optional[str] = None,
    project_id: Optional[str] = None,
    team: Optional[str] = None,
    tag: Optional[str] = None,
    due_date: Optional[str] = None,
    created_date: Optional[str] = None,
    quick_filter: Optional[str] = None,
) -> select:
    stmt = _apply_task_visibility(stmt, current_user)
    if search:
        search_value = search.strip()
        if search_value:
            if db.bind and db.bind.dialect.name == "postgresql":
                stmt = stmt.where(
                    models.Task.search_vector.op("@@")(
                        func.websearch_to_tsquery("english", search_value)
                    )
                )
            else:
                like_value = f"%{search_value}%"
                stmt = stmt.where(
                    or_(
                        models.Task.title.ilike(like_value),
                        models.Task.description.ilike(like_value),
                        models.Task.team.ilike(like_value),
                        models.Task.assignee.has(models.User.name.ilike(like_value)),
                    )
                )
    if status_filter:
        stmt = stmt.where(models.Task.status == status_filter)
    if priority:
        stmt = stmt.where(models.Task.priority == priority)
    if assignee_id:
        stmt = stmt.where(models.Task.assigned_to_id == assignee_id)
    if project_id:
        _fetch_project_for_task(
            db,
            project_id=project_id,
            current_user=current_user,
            require_active=False,
            require_write=False,
        )
        stmt = stmt.where(models.Task.project_id == project_id)
    if team:
        team_value = team.strip()
        if team_value:
            stmt = stmt.where(models.Task.team.ilike(team_value))
    if tag:
        tag_value = tag.strip()
        if tag_value:
            stmt = stmt.where(models.Task.tags.contains([tag_value]))
    due_range = _parse_date_filter(due_date)
    if due_range:
        stmt = stmt.where(models.Task.due_at.between(due_range[0], due_range[1]))
    created_range = _parse_date_filter(created_date)
    if created_range:
        stmt = stmt.where(models.Task.created_at.between(created_range[0], created_range[1]))
    if quick_filter == "createdByMe":
        stmt = stmt.where(models.Task.created_by_id == current_user.id)
    elif quick_filter == "myTasks":
        stmt = stmt.where(models.Task.assigned_to_id == current_user.id)
    elif quick_filter == "overdue":
        now = datetime.utcnow()
        stmt = stmt.where(
            models.Task.due_at.is_not(None),
            models.Task.due_at < now,
            ~models.Task.status.in_(COMPLETED_STATUSES),
        )
    elif quick_filter == "completed":
        stmt = stmt.where(models.Task.status.in_(COMPLETED_STATUSES))
    return stmt


def _resolve_sort_column(stmt: select, sort_by: str) -> tuple[select, Any]:
    if sort_by == "dueAt":
        return stmt, models.Task.due_at
    if sort_by == "priority":
        return stmt, _priority_sort_expression()
    if sort_by == "status":
        return stmt, _status_sort_expression()
    if sort_by == "assignee":
        return stmt.join(models.User, models.Task.assigned_to_id == models.User.id, isouter=True), models.User.name
    if sort_by == "lastUpdated":
        return stmt, models.Task.updated_at
    if sort_by == "title":
        return stmt, models.Task.title
    return stmt, models.Task.created_at


def _encode_task_cursor(task: models.Task, sort_by: str) -> Optional[str]:
    if sort_by == "created_at":
        cursor_value = task.created_at.isoformat()
    elif sort_by == "lastUpdated":
        cursor_value = task.updated_at.isoformat()
    elif sort_by == "dueAt":
        cursor_value = task.due_at.isoformat() if task.due_at else ""
    else:
        return None
    return f"{cursor_value}|{task.id}"


def _log_slow_endpoint(label: str, started_at: float, *, threshold_ms: int = 300) -> None:
    elapsed_ms = (perf_time.perf_counter() - started_at) * 1000
    if elapsed_ms >= threshold_ms:
        print(f"[perf] slow endpoint {label}: {elapsed_ms:.1f}ms")


@router.get("", response_model=List[schemas.TaskRead])
def list_tasks(
    request: Request,
    assignee_name: Optional[str] = Query(
        default=None,
        description="Filter tasks by assignee name (partial match).",
    ),
    project_id: Optional[str] = Query(
        default=None,
        description="Filter tasks linked to a project visible to the caller.",
    ),
    skip_overdue_notifications: bool = Query(
        default=True,
        description="Skip overdue notification side effects for faster task listing.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskRead]:
    manager_notifications_created = False
    cache_key = None
    if skip_overdue_notifications:
        tenant_id = str(current_user.tenant_id or settings.default_tenant_id)
        cache_key = build_cache_key(
            resource="tasks:list",
            tenant_id=tenant_id,
            user_id=str(current_user.id),
            path=request.url.path,
            params=[*request.query_params.multi_items(), ("completion_metadata_policy", "2")],
        )
        cached_payload = get_cached_json(cache_key)
        if cached_payload is not None:
            return [schemas.TaskRead.model_validate(item) for item in cached_payload]
    stmt = _apply_task_visibility(_task_query(), current_user)
    if project_id:
        _fetch_project_for_task(
            db,
            project_id=project_id,
            current_user=current_user,
            require_active=False,
            require_write=False,
        )
        stmt = stmt.where(models.Task.project_id == project_id)
    if assignee_name:
        assignee_name = assignee_name.strip()
        if assignee_name:
            stmt = stmt.where(
                models.Task.assignee.has(models.User.name.ilike(f"%{assignee_name}%"))
            )
    tasks = db.execute(stmt).unique().scalars().all()
    now = datetime.utcnow()
    if not skip_overdue_notifications:
        overdue_tasks = [
            task
            for task in tasks
            if task.assigned_to_id == current_user.id
            and task.due_at
            and task.due_at < now
            and task.status not in COMPLETED_STATUSES
        ]
        if overdue_tasks:
            overdue_ids = [task.id for task in overdue_tasks]
            existing_overdue = set(
                db.execute(
                    select(models.Notification.entity_id).where(
                        models.Notification.user_id == current_user.id,
                        models.Notification.type == models.NotificationTypeEnum.TASK_OVERDUE,
                        models.Notification.entity_type == models.NotificationEntityTypeEnum.TASK,
                        models.Notification.entity_id.in_(overdue_ids),
                    )
                ).scalars().all()
            )
            ticket_ids = {task.ticket_id for task in overdue_tasks if task.ticket_id}
            tickets = {}
            if ticket_ids:
                tickets = {
                    ticket.id: ticket
                    for ticket in db.execute(
                        select(Ticket).where(Ticket.id.in_(list(ticket_ids)))
                    ).scalars().all()
                }
            manager_notifications_created = False
            for task in overdue_tasks:
                if task.id in existing_overdue:
                    continue
                notification_service.create_notification(
                    db,
                    user_id=current_user.id,
                    actor_id=str(current_user.id),
                    notification_type=models.NotificationTypeEnum.TASK_OVERDUE,
                    message=f"Task '{task.title}' is overdue.",
                    title="Task overdue",
                    body=f"Task '{task.title}' is overdue.",
                    entity_type=models.NotificationEntityTypeEnum.TASK,
                    entity_id=task.id,
                    deep_link=f"/tasks/{task.id}",
                    related_task_id=task.id,
                )
                ticket = tickets.get(task.ticket_id)
                if ticket:
                    creator = db.get(models.User, ticket.created_by)
                    manager_id = creator.manager_id if creator else None
                    if manager_id:
                        manager_exists = db.execute(
                            select(models.Notification.id).where(
                                models.Notification.user_id == manager_id,
                                models.Notification.type == models.NotificationTypeEnum.TASK_OVERDUE,
                                models.Notification.entity_type == models.NotificationEntityTypeEnum.TASK,
                                models.Notification.entity_id == task.id,
                            )
                        ).scalar_one_or_none()
                        if not manager_exists:
                            notification_service.create_notification(
                                db,
                                user_id=str(manager_id),
                                actor_id=str(current_user.id),
                                notification_type=models.NotificationTypeEnum.TASK_OVERDUE,
                                message=f"Task '{task.title}' is overdue for ticket '{ticket.title}'.",
                                title="Task overdue escalation",
                                body=f"Task '{task.title}' linked to ticket '{ticket.title}' is overdue.",
                                entity_type=models.NotificationEntityTypeEnum.TASK,
                                entity_id=task.id,
                                deep_link=f"/tickets/{ticket.id}",
                                related_task_id=task.id,
                            )
                            manager_notifications_created = True
            db.commit()
    if manager_notifications_created:
        get_notifier().send_webex_message("Task overdue escalation detected.")
    status_title_map = _status_title_map(db)
    serialized = _serialize_tasks(tasks, status_title_map, viewer=current_user)
    if cache_key:
        set_cached_json(
            cache_key,
            [item.model_dump(mode="json") for item in serialized],
            ttl_seconds=settings.cache_default_ttl_seconds,
        )
    return serialized


@router.post("/transfer", response_model=schemas.TaskTransferResponse)
def transfer_tasks(
    payload: schemas.TaskTransferRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskTransferResponse:
    if current_user.role not in {
        models.RoleEnum.MANAGER,
        models.RoleEnum.ADMIN,
        models.RoleEnum.OWNER,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and target users must differ")

    from_user = db.get(models.User, payload.from_user_id)
    to_user = db.get(models.User, payload.to_user_id)
    if not from_user or not to_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user.tenant_id:
        if from_user.tenant_id != current_user.tenant_id or to_user.tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    if current_user.role == models.RoleEnum.MANAGER and current_user.department_id:
        if (
            from_user.department_id != current_user.department_id
            or to_user.department_id != current_user.department_id
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department mismatch")

    stmt = select(models.Task).where(models.Task.assigned_to_id == from_user.id)
    stmt = stmt.options(selectinload(models.Task.project).selectinload(models.Project.members))
    if payload.statuses:
        stmt = stmt.where(models.Task.status.in_(payload.statuses))
    tasks = db.execute(stmt).scalars().all()
    now = datetime.utcnow()
    for task in tasks:
        if task.project:
            _ensure_project_assignee_allowed(task.project, to_user.id)
        task.assigned_to_id = to_user.id
        task.assigned_at = now
    db.commit()

    transferred_ids = [task.id for task in tasks]
    _invalidate_task_cache(current_user, action="transferred", task_ids=transferred_ids)

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TASKS_TRANSFERRED",
            category=models.AuditLogCategoryEnum.TASK,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="task",
            entity_id=from_user.id,
            target_user_id=to_user.id,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={
                "from_user_id": from_user.id,
                "to_user_id": to_user.id,
                "status_filters": [status.value for status in payload.statuses],
                "updated_count": len(tasks),
            },
            request=request,
        )
    )
    db.commit()

    return schemas.TaskTransferResponse(
        from_user_id=from_user.id,
        to_user_id=to_user.id,
        statuses=payload.statuses,
        updated_count=len(tasks),
    )


@router.post("/{task_id}/transfer-requests", response_model=schemas.TaskTransferWorkflowRead)
def create_task_transfer_request(
    task_id: str,
    payload: schemas.TaskTransferWorkflowRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskTransferWorkflowRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)

    if payload.to_user_id == task.assigned_to_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is already assigned to this user")

    target_user = db.get(models.User, payload.to_user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    _ensure_user_in_current_tenant(target_user, current_user, label="Target user")
    _ensure_project_assignee_allowed(task.project, target_user.id)

    existing = db.execute(
        select(models.TaskTransferRequest).where(
            models.TaskTransferRequest.task_id == task.id,
            models.TaskTransferRequest.requested_by_id == current_user.id,
            models.TaskTransferRequest.status == models.TaskTransferStatusEnum.PENDING,
        )
    ).scalar_one_or_none()
    if existing:
        return schemas.TaskTransferWorkflowRead.model_validate(existing)

    now = datetime.utcnow()
    transfer_request = models.TaskTransferRequest(
        task_id=task.id,
        from_user_id=task.assigned_to_id,
        to_user_id=payload.to_user_id,
        requested_by_id=current_user.id,
        note=payload.note,
    )

    auto_approve = current_user.role in {
        models.RoleEnum.MANAGER,
        models.RoleEnum.ADMIN,
        models.RoleEnum.OWNER,
    }
    if auto_approve:
        transfer_request.status = models.TaskTransferStatusEnum.APPROVED
        transfer_request.approved_by_id = current_user.id
        transfer_request.acted_at = now
        task.assigned_to_id = payload.to_user_id
        task.assigned_at = now

    db.add(transfer_request)
    db.commit()

    if auto_approve:
        _invalidate_task_cache(current_user, action="transferred", task_id=task.id)
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TASK_TRANSFER_APPROVED",
                category=models.AuditLogCategoryEnum.TASK,
                actor_id=str(current_user.id),
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="task",
                entity_id=task.id,
                target_user_id=payload.to_user_id,
                source=models.AuditLogSourceEnum.MANUAL,
                metadata={
                    "request_id": transfer_request.id,
                    "from_user_id": transfer_request.from_user_id,
                    "to_user_id": transfer_request.to_user_id,
                },
                request=request,
            )
        )
        db.commit()
    else:
        recipient_ids: set[str] = set()
        managers = db.execute(
            select(models.User.id).where(models.User.role == models.RoleEnum.MANAGER)
        ).scalars().all()
        recipient_ids.update(str(manager_id) for manager_id in managers if manager_id)
        admins = db.execute(
            select(models.User.id).where(models.User.role.in_([models.RoleEnum.ADMIN, models.RoleEnum.OWNER]))
        ).scalars().all()
        recipient_ids.update(str(admin_id) for admin_id in admins if admin_id)
        if current_user.manager_id:
            recipient_ids.add(str(current_user.manager_id))
        if current_user.department_id:
            department_manager_ids = db.execute(
                select(models.User.id).where(
                    models.User.role == models.RoleEnum.MANAGER,
                    models.User.department_id == current_user.department_id,
                )
            ).scalars().all()
            recipient_ids.update(str(manager_id) for manager_id in department_manager_ids if manager_id)
        recipient_ids.discard(str(current_user.id))

        for recipient_id in recipient_ids:
            notification_service.create_notification(
                db,
                user_id=recipient_id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.APPROVAL_REQUESTED,
                message=f"Transfer request for task '{task.title}'.",
                title="Transfer approval requested",
                body=f"{current_user.name} requested to transfer task '{task.title}'.",
                entity_type=models.NotificationEntityTypeEnum.TASK,
                entity_id=task.id,
                deep_link=f"/tasks/{task.id}",
                related_task_id=task.id,
            )
        db.commit()

    return schemas.TaskTransferWorkflowRead.model_validate(transfer_request)


@router.get("/{task_id}/transfer-requests", response_model=List[schemas.TaskTransferWorkflowRead])
def list_task_transfer_requests(
    task_id: str,
    status_filter: Optional[models.TaskTransferStatusEnum] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskTransferWorkflowRead]:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)

    stmt = select(models.TaskTransferRequest).where(models.TaskTransferRequest.task_id == task.id)
    if status_filter:
        stmt = stmt.where(models.TaskTransferRequest.status == status_filter)
    requests = db.execute(stmt.order_by(models.TaskTransferRequest.created_at.desc())).scalars().all()
    return [schemas.TaskTransferWorkflowRead.model_validate(item) for item in requests]


@router.post("/transfer-requests/{request_id}/approve", response_model=schemas.TaskTransferWorkflowRead)
def act_on_transfer_request(
    request_id: str,
    payload: schemas.TaskTransferWorkflowDecision,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskTransferWorkflowRead:
    if current_user.role not in {models.RoleEnum.MANAGER, models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    transfer_request = db.get(models.TaskTransferRequest, request_id)
    if not transfer_request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer request not found")

    if transfer_request.status != models.TaskTransferStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfer request already acted on")

    task = _fetch_task_or_404(db, transfer_request.task_id)
    now = datetime.utcnow()
    transfer_request.approved_by_id = current_user.id
    transfer_request.acted_at = now

    if payload.decision == "approved":
        transfer_request.status = models.TaskTransferStatusEnum.APPROVED
        if transfer_request.to_user_id:
            target_user = db.get(models.User, transfer_request.to_user_id)
            if not target_user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
            _ensure_user_in_current_tenant(target_user, current_user, label="Target user")
            _ensure_project_assignee_allowed(task.project, target_user.id)
        task.assigned_to_id = transfer_request.to_user_id
        task.assigned_at = now
    else:
        transfer_request.status = models.TaskTransferStatusEnum.REJECTED

    db.commit()

    _invalidate_task_cache(current_user, action="transfer_request", task_id=task.id)
    notification_service.create_notification(
        db,
        user_id=str(transfer_request.requested_by_id),
        actor_id=str(current_user.id),
        notification_type=models.NotificationTypeEnum.APPROVAL_ACTED,
        message=f"Transfer request {payload.decision} for task '{task.title}'.",
        title="Transfer request update",
        body=f"Your transfer request was {payload.decision}.",
        entity_type=models.NotificationEntityTypeEnum.TASK,
        entity_id=task.id,
        deep_link=f"/tasks/{task.id}",
        related_task_id=task.id,
    )
    db.commit()

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TASK_TRANSFER_DECISION",
            category=models.AuditLogCategoryEnum.TASK,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="task",
            entity_id=task.id,
            target_user_id=str(transfer_request.to_user_id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={
                "request_id": transfer_request.id,
                "decision": payload.decision,
                "from_user_id": transfer_request.from_user_id,
                "to_user_id": transfer_request.to_user_id,
            },
            request=request,
        )
    )
    db.commit()

    return schemas.TaskTransferWorkflowRead.model_validate(transfer_request)


@router.get("/page", response_model=schemas.TaskListResponse)
def list_tasks_page(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(default=None, description="Search title, description, team, or assignee name."),
    status: Optional[models.TaskStatusEnum] = Query(default=None),
    priority: Optional[models.TaskPriorityEnum] = Query(default=None),
    assignee_id: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    team: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    due_date: Optional[str] = Query(default=None),
    created_date: Optional[str] = Query(default=None),
    quick_filter: Optional[str] = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc"),
    cursor: Optional[str] = Query(default=None, description="Cursor in the form '<sort-value>|<task-id>' for forward pagination."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskListResponse:
    started_at = perf_time.perf_counter()
    tenant_id = str(current_user.tenant_id or settings.default_tenant_id)
    cache_params = {
        "page": page,
        "page_size": page_size,
        "cursor": cursor,
        "search": search,
        "status": status.value if status else None,
        "priority": priority.value if priority else None,
        "assignee_id": assignee_id,
        "project_id": project_id,
        "team": team,
        "tag": tag,
        "due_date": due_date,
        "created_date": created_date,
        "quick_filter": quick_filter,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }
    cache_key = _list_cache_key(tenant_id=tenant_id, user_id=str(current_user.id), params=cache_params)
    cached_payload = get_cached_json(cache_key)
    if cached_payload is not None:
        return schemas.TaskListResponse.model_validate(cached_payload)

    stmt = _apply_task_filters(
        _lean_task_stmt(),
        db,
        current_user,
        search=search,
        status_filter=status,
        priority=priority,
        assignee_id=assignee_id,
        project_id=project_id,
        team=team,
        tag=tag,
        due_date=due_date,
        created_date=created_date,
        quick_filter=quick_filter,
    )
    stmt, order_column = _resolve_sort_column(stmt, sort_by)

    if sort_order == "asc":
        stmt = stmt.order_by(order_column.asc().nullslast())
    else:
        stmt = stmt.order_by(order_column.desc().nullslast())

    base_stmt = stmt
    base_subquery = base_stmt.order_by(None).subquery()
    total = db.execute(select(func.count()).select_from(base_subquery)).scalar_one()
    status_rows = db.execute(
        select(base_subquery.c.status, func.count())
        .select_from(base_subquery)
        .group_by(base_subquery.c.status)
    ).all()
    status_counts = {row[0].value if hasattr(row[0], "value") else str(row[0]): row[1] for row in status_rows}
    total_pages = max(1, (total + page_size - 1) // page_size)

    page_stmt = base_stmt
    if cursor and sort_by in {"created_at", "lastUpdated", "dueAt"}:
        cursor_value, _, cursor_id = cursor.partition("|")
        cursor_dt = datetime.fromisoformat(cursor_value) if cursor_value else None
        cursor_column = models.Task.created_at if sort_by == "created_at" else models.Task.updated_at if sort_by == "lastUpdated" else models.Task.due_at
        if cursor_dt:
            if sort_order == "asc":
                page_stmt = page_stmt.where(or_(cursor_column > cursor_dt, (cursor_column == cursor_dt) & (models.Task.id > cursor_id)))
            else:
                page_stmt = page_stmt.where(or_(cursor_column < cursor_dt, (cursor_column == cursor_dt) & (models.Task.id < cursor_id)))
    else:
        page_stmt = page_stmt.offset((page - 1) * page_size)

    tasks = db.execute(page_stmt.limit(page_size + 1)).scalars().all()
    has_more = len(tasks) > page_size
    visible_tasks = tasks[:page_size]
    serialized = _serialize_task_card_items(visible_tasks)
    next_cursor = _encode_task_cursor(visible_tasks[-1], sort_by) if has_more and visible_tasks else None
    response_payload = schemas.TaskListResponse(
        items=serialized,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
        status_counts=status_counts,
        next_cursor=next_cursor,
        has_more=has_more,
    )
    set_cached_json(
        cache_key,
        response_payload.model_dump(mode="json"),
        ttl_seconds=settings.task_list_cache_ttl_seconds,
    )
    _log_slow_endpoint("tasks.page", started_at)
    return response_payload


@router.get("/kanban", response_model=schemas.TaskKanbanResponse)
def list_tasks_kanban(
    request: Request,
    page_size: int = Query(
        default_factory=lambda: settings.kanban_page_size_per_column, ge=1, le=200
    ),
    search: Optional[str] = Query(default=None),
    priority: Optional[models.TaskPriorityEnum] = Query(default=None),
    assignee_id: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    team: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    due_date: Optional[str] = Query(default=None),
    created_date: Optional[str] = Query(default=None),
    quick_filter: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskKanbanResponse:
    started_at = perf_time.perf_counter()
    tenant_id = str(current_user.tenant_id or settings.default_tenant_id)
    cache_params = {
        "page_size": page_size,
        "search": search,
        "priority": priority.value if priority else None,
        "assignee_id": assignee_id,
        "project_id": project_id,
        "team": team,
        "tag": tag,
        "due_date": due_date,
        "created_date": created_date,
        "quick_filter": quick_filter,
    }
    cache_key = _kanban_cache_key(tenant_id=tenant_id, user_id=str(current_user.id), params=cache_params)
    cached_payload = get_cached_json(cache_key)
    if cached_payload is not None:
        return schemas.TaskKanbanResponse.model_validate(cached_payload)

    base_stmt = _apply_task_filters(
        _lean_task_stmt(),
        db,
        current_user,
        search=search,
        priority=priority,
        assignee_id=assignee_id,
        project_id=project_id,
        team=team,
        tag=tag,
        due_date=due_date,
        created_date=created_date,
        quick_filter=quick_filter,
    )

    columns = db.execute(
        select(models.KanbanColumn).order_by(models.KanbanColumn.order)
    ).scalars().all()

    counts_subquery = base_stmt.order_by(None).subquery()
    counts_rows = db.execute(
        select(counts_subquery.c.status, func.count())
        .select_from(counts_subquery)
        .group_by(counts_subquery.c.status)
    ).all()
    counts = {row[0].value if hasattr(row[0], "value") else str(row[0]): row[1] for row in counts_rows}

    column_payloads: list[schemas.TaskKanbanColumn] = []
    for column in columns:
        status_value = column.id
        tasks = db.execute(
            base_stmt.where(models.Task.status == status_value)
            .order_by(models.Task.updated_at.desc())
            .limit(page_size)
        ).scalars().all()
        column_payloads.append(
            schemas.TaskKanbanColumn(
                status=status_value,
                title=column.title,
                order=column.order,
                count=counts.get(status_value, 0),
                items=_serialize_task_card_items(tasks),
            )
        )

    response_payload = schemas.TaskKanbanResponse(columns=column_payloads)
    set_cached_json(
        cache_key,
        response_payload.model_dump(mode="json"),
        ttl_seconds=settings.task_list_cache_ttl_seconds,
    )
    _log_slow_endpoint("tasks.kanban", started_at)
    return response_payload


def _parse_required_date(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field_name}")


def _date_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return datetime.combine(start_date, time.min), datetime.combine(end_date, time.max)


@router.get("/calendar/summary", response_model=schemas.TaskCalendarSummaryResponse)
def get_calendar_summary(
    start_date: str = Query(..., description="Visible range start date, YYYY-MM-DD."),
    end_date: str = Query(..., description="Visible range end date, YYYY-MM-DD."),
    search: Optional[str] = Query(default=None),
    status_filter: Optional[models.TaskStatusEnum] = Query(default=None, alias="status"),
    priority: Optional[models.TaskPriorityEnum] = Query(default=None),
    assignee_id: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    team: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    due_date: Optional[str] = Query(default=None),
    created_date: Optional[str] = Query(default=None),
    quick_filter: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskCalendarSummaryResponse:
    started_at = perf_time.perf_counter()
    start = _parse_required_date(start_date, "start_date")
    end = _parse_required_date(end_date, "end_date")
    if start > end:
        start, end = end, start
    range_start, range_end = _date_bounds(start, end)
    tenant_id = str(current_user.tenant_id or settings.default_tenant_id)
    cache_params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "search": search,
        "status": status_filter.value if status_filter else None,
        "priority": priority.value if priority else None,
        "assignee_id": assignee_id,
        "project_id": project_id,
        "team": team,
        "tag": tag,
        "due_date": due_date,
        "created_date": created_date,
        "quick_filter": quick_filter,
    }
    cache_key = _calendar_cache_key(tenant_id=tenant_id, user_id=str(current_user.id), params=cache_params)
    cached_payload = get_cached_json(cache_key)
    if cached_payload is not None:
        return schemas.TaskCalendarSummaryResponse.model_validate(cached_payload)

    stmt = _apply_task_filters(
        _lean_task_stmt(),
        db,
        current_user,
        search=search,
        status_filter=status_filter,
        priority=priority,
        assignee_id=assignee_id,
        project_id=project_id,
        team=team,
        tag=tag,
        due_date=due_date,
        created_date=created_date,
        quick_filter=quick_filter,
    ).where(models.Task.due_at.between(range_start, range_end))
    filtered = stmt.order_by(None).subquery()
    day_expr = func.date(filtered.c.due_at)
    now = datetime.utcnow()
    rows = db.execute(
        select(
            day_expr.label("day"),
            func.count(filtered.c.id).label("total"),
            func.sum(case((filtered.c.status.in_(COMPLETED_STATUSES), 1), else_=0)).label("completed"),
            func.sum(case(((filtered.c.due_at < now) & (~filtered.c.status.in_(COMPLETED_STATUSES)), 1), else_=0)).label("overdue"),
            func.sum(case((filtered.c.priority == models.TaskPriorityEnum.URGENT, 1), else_=0)).label("urgent"),
            func.sum(case((filtered.c.priority == models.TaskPriorityEnum.HIGH, 1), else_=0)).label("high"),
            func.sum(case((filtered.c.priority == models.TaskPriorityEnum.MEDIUM, 1), else_=0)).label("medium"),
            func.sum(case((filtered.c.priority == models.TaskPriorityEnum.LOW, 1), else_=0)).label("low"),
            func.sum(case(((filtered.c.due_at >= now) & (filtered.c.due_at <= now + timedelta(days=3)) & (~filtered.c.status.in_(COMPLETED_STATUSES)), 1), else_=0)).label("due_soon"),
        )
        .select_from(filtered)
        .group_by(day_expr)
    ).all()
    row_by_day: dict[str, Any] = {str(row.day): row for row in rows}
    days: list[schemas.TaskCalendarDaySummary] = []
    iterator = start
    while iterator <= end:
        key = iterator.isoformat()
        row = row_by_day.get(key)
        days.append(
            schemas.TaskCalendarDaySummary(
                date=iterator,
                total=int(row.total or 0) if row else 0,
                completed=int(row.completed or 0) if row else 0,
                overdue=int(row.overdue or 0) if row else 0,
                urgent=int(row.urgent or 0) if row else 0,
                high=int(row.high or 0) if row else 0,
                medium=int(row.medium or 0) if row else 0,
                low=int(row.low or 0) if row else 0,
                due_soon=int(row.due_soon or 0) if row else 0,
            )
        )
        iterator = iterator + timedelta(days=1)
    response_payload = schemas.TaskCalendarSummaryResponse(start_date=start, end_date=end, days=days)
    set_cached_json(cache_key, response_payload.model_dump(mode="json"), ttl_seconds=45)
    _log_slow_endpoint("tasks.calendar.summary", started_at)
    return response_payload


@router.get("/calendar/tasks", response_model=List[schemas.TaskRead])
def get_calendar_tasks(
    start_date: str = Query(...),
    end_date: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    status_filter: Optional[models.TaskStatusEnum] = Query(default=None, alias="status"),
    priority: Optional[models.TaskPriorityEnum] = Query(default=None),
    assignee_id: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    team: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    due_date: Optional[str] = Query(default=None),
    created_date: Optional[str] = Query(default=None),
    quick_filter: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskRead]:
    started_at = perf_time.perf_counter()
    start = _parse_required_date(start_date, "start_date")
    end = _parse_required_date(end_date or start_date, "end_date")
    if start > end:
        start, end = end, start
    range_start, range_end = _date_bounds(start, end)
    stmt = _apply_task_filters(
        _task_query().order_by(None),
        db,
        current_user,
        search=search,
        status_filter=status_filter,
        priority=priority,
        assignee_id=assignee_id,
        project_id=project_id,
        team=team,
        tag=tag,
        due_date=due_date,
        created_date=created_date,
        quick_filter=quick_filter,
    ).where(models.Task.due_at.between(range_start, range_end)).order_by(models.Task.due_at.asc(), models.Task.created_at.desc())
    tasks = db.execute(stmt).unique().scalars().all()
    status_title_map = _status_title_map(db)
    _log_slow_endpoint("tasks.calendar.tasks", started_at)
    return _serialize_tasks(tasks, status_title_map, viewer=current_user)


@router.get("/{task_id}/summary", response_model=schemas.TaskSummaryResponse)
def get_task_summary(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskSummaryResponse:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    return schemas.TaskSummaryResponse.model_validate(task)


@router.get("/leaderboard", response_model=List[schemas.TaskLeaderboardRead])
def list_tasks_for_leaderboard(
    limit: int = Query(1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskLeaderboardRead]:
    stmt = _apply_task_visibility(select(models.Task), current_user)
    stmt = stmt.order_by(models.Task.created_at.desc()).limit(limit)
    tasks = db.execute(stmt).scalars().all()
    status_title_map = _status_title_map(db)
    return _serialize_leaderboard_tasks(tasks, status_title_map)


@router.post("", response_model=List[schemas.TaskRead], status_code=status.HTTP_201_CREATED)
def create_task(
    payload: schemas.TaskCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskRead]:
    if not payload.project_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="project_id is required for new task creation",
        )
    project = _fetch_project_for_task(
        db,
        project_id=payload.project_id,
        current_user=current_user,
        require_active=True,
        require_write=False,
    )
    assignee_candidates = list(payload.assigned_to_ids or [])
    if payload.assigned_to_id and payload.assigned_to_id not in assignee_candidates:
        assignee_candidates.append(payload.assigned_to_id)

    normalized_assignees: List[Optional[str]] = []
    seen_assignees: set[Optional[str]] = set()
    for candidate in assignee_candidates:
        normalized = candidate or None
        if normalized in seen_assignees:
            continue
        seen_assignees.add(normalized)
        normalized_assignees.append(normalized)

    if not normalized_assignees:
        normalized_assignees = [None]

    if payload.dependencies:
        dependency_stmt = _task_query().where(models.Task.id.in_(payload.dependencies))
        dependencies = db.execute(dependency_stmt).unique().scalars().all()
        found_ids = {dependency.id for dependency in dependencies}
        missing_ids = [dep_id for dep_id in payload.dependencies if dep_id not in found_ids]
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dependencies not found: {', '.join(missing_ids)}",
            )
    else:
        dependencies = []

    _ensure_priority_allowed(payload.priority, current_user)
    payload_status = payload.status
    creation_points = get_task_creation_points(db)

    task_group_id = payload.task_group_id or str(uuid4())
    existing_assignees: set[Optional[str]] = set()
    if payload.task_group_id:
        existing_group_tasks = (
            db.execute(_task_query().where(models.Task.task_group_id == payload.task_group_id))
            .unique()
            .scalars()
            .all()
        )
        existing_assignees = {task.assigned_to_id for task in existing_group_tasks}

    assignee_cache: dict[str, models.User] = {}
    for user_id in (assignee_id for assignee_id in normalized_assignees if assignee_id):
        user = db.get(models.User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Assigned user {user_id} not found")
        _ensure_user_in_current_tenant(user, current_user, label="Assigned user")
        _ensure_project_assignee_allowed(project, user_id)
        assignee_cache[user_id] = user

    follower_users = _resolve_task_followers(
        db,
        payload.follower_ids,
        current_user=current_user,
        exclude_ids={current_user.id, *assignee_cache.keys()},
    )

    created_tasks: List[models.Task] = []
    for assignee_id in normalized_assignees:
        if payload.task_group_id and assignee_id in existing_assignees:
            continue

        task = models.Task(
            id=models.generate_uuid(),
            title=payload.title,
            description=payload.description,
            status=payload_status,
            priority=payload.priority,
            team=payload.team,
            project_id=project.id,
            assigned_to_id=assignee_id,
            assigned_at=datetime.utcnow() if assignee_id else None,
            task_group_id=task_group_id,
            created_by_id=current_user.id,
            subtask_approval_required=payload.subtask_approval_required,
            due_at=payload.due_at,
            recurrence_rule=payload.recurrence_rule,
            recurring_task_id=payload.recurring_task_id,
            clarity_rating=payload.clarity_rating,
            attachments=list(payload.attachments or []),
            estimated_hours=payload.estimated_hours,
            tags=list(payload.tags or []),
        )

        if payload_status in COMPLETED_STATUSES and not task.completed_at:
            task.completed_at = datetime.utcnow()

        for subtask_index, subtask_input in enumerate(payload.subtasks):
            subtask_status, subtask_completed = _normalize_subtask_status(
                completed=subtask_input.completed,
                status_value=subtask_input.status,
            )
            subtask_assignee_id = subtask_input.assigned_to_id or assignee_id
            _ensure_subtask_assignee_allowed(db, task, subtask_assignee_id, current_user)
            task.subtasks.append(
                models.Subtask(
                    title=subtask_input.title,
                    completed=subtask_completed,
                    assigned_to_id=subtask_assignee_id,
                    status=subtask_status,
                    sort_order=subtask_input.sort_order if "sort_order" in subtask_input.model_fields_set else subtask_index,
                )
            )

        if dependencies:
            task.dependencies = dependencies

        if task.status in COMPLETED_STATUSES and any(
            subtask.status != models.SubtaskStatusEnum.DONE for subtask in task.subtasks
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complete all subtasks before completing the task")
        task.followers = list(follower_users)

        db.add(task)
        created_tasks.append(task)

    if not created_tasks:
        return []

    db.flush()
    now = datetime.utcnow()
    for task in created_tasks:
        if task.subtasks and all(subtask.status == models.SubtaskStatusEnum.DONE for subtask in task.subtasks):
            subtask_workflow.synchronize_parent_completion(db, task, actor=current_user)
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TASK_CREATED",
                category=models.AuditLogCategoryEnum.TASK,
                actor_id=str(current_user.id),
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="task",
                entity_id=task.id,
                target_user_id=task.assigned_to_id,
                source=models.AuditLogSourceEnum.MANUAL,
                before=None,
                after={
                    "title": task.title,
                    "status": task.status.value,
                    "priority": task.priority.value,
                    "assigned_to_id": task.assigned_to_id,
                    "due_at": task.due_at.isoformat() if task.due_at else None,
                },
                request=request,
            )
        )
        db.add(
            models.AuditEvent(
                actor_id=current_user.id,
                event_type="task.created",
                entity_type="task",
                entity_id=task.id,
                payload={
                    "title": task.title,
                    "assigned_to_id": task.assigned_to_id,
                    "priority": task.priority.value,
                    "status": task.status.value,
                },
                created_at=task.created_at or now,
            )
        )

    task_snapshots = [
        {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "assigned_to_id": task.assigned_to_id,
            "created_by_id": task.created_by_id,
            "team": task.team,
            "project_id": task.project_id,
            "subtask_approval_required": task.subtask_approval_required,
            "task_group_id": task.task_group_id,
            "due_at": task.due_at,
            "recurrence_rule": task.recurrence_rule,
            "recurring_task_id": task.recurring_task_id,
            "clarity_rating": task.clarity_rating,
            "attachments": list(task.attachments or []),
            "estimated_hours": task.estimated_hours,
            "tags": list(task.tags or []),
            "priority": task.priority,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "subtasks": [
                {
                    "id": subtask.id,
                    "title": subtask.title,
                    "completed": subtask.completed,
                    "assigned_to_id": subtask.assigned_to_id,
                    "status": subtask.status,
                    "sort_order": subtask.sort_order,
                }
                for subtask in task.subtasks
            ],
        }
        for task in created_tasks
    ]

    if payload.clarity_rating is not None:
        for task in created_tasks:
            record_clarity_rating(db, task, payload.clarity_rating)

    created_count = len(created_tasks)
    current_user.tasks_created += created_count
    current_user.points += creation_points * created_count
    check_and_unlock_achievements(db, current_user)

    created_ids = [task_snapshot["id"] for task_snapshot in task_snapshots]
    db.commit()

    for task_snapshot in task_snapshots:
        assignee_id = task_snapshot["assigned_to_id"]
        assignee = assignee_cache.get(assignee_id) if assignee_id else None
        if assignee:
            notification_service.create_notification(
                db,
                user_id=assignee.id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.TASK_CREATED,
                message=f"New task created: '{task_snapshot['title']}'.",
                title="Task created",
                body=f"A new task was created: '{task_snapshot['title']}'.",
                entity_type=models.NotificationEntityTypeEnum.TASK,
                entity_id=task_snapshot["id"],
                deep_link=f"/tasks/{task_snapshot['id']}",
                related_task_id=task_snapshot["id"],
            )

        for follower in follower_users:
            if follower.id == current_user.id:
                continue
            notification_service.create_notification(
                db,
                user_id=follower.id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.TASK_UPDATED,
                message=f"You are following task: '{task_snapshot['title']}'.",
                title="Following task",
                body=f"You were added as a follower on '{task_snapshot['title']}'. You can view updates but will not receive task rewards.",
                entity_type=models.NotificationEntityTypeEnum.TASK,
                entity_id=task_snapshot["id"],
                deep_link=f"/tasks/{task_snapshot['id']}",
                related_task_id=task_snapshot["id"],
            )
        created_task = db.get(models.Task, task_snapshot["id"])
        if created_task:
            _notify_task_participants(
                db, task=created_task, current_user=current_user,
                title="Task created", message=f"{current_user.name} created task '{created_task.title}'.",
                notification_type=models.NotificationTypeEnum.TASK_CREATED,
                exclude_ids={*(user.id for user in follower_users), *(filter(None, [assignee_id]))},
            )

    for task_snapshot in task_snapshots:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="created",
                actor_id=current_user.id,
                assigned_to_id=task_snapshot["assigned_to_id"],
                created_by_id=task_snapshot["created_by_id"],
                priority=task_snapshot["priority"].value,
                occurred_at=task_snapshot["created_at"],
            ),
        )
        if task_snapshot["assigned_to_id"]:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="task",
                    event="assigned",
                    actor_id=current_user.id,
                    assigned_to_id=task_snapshot["assigned_to_id"],
                    created_by_id=task_snapshot["created_by_id"],
                    priority=task_snapshot["priority"].value,
                    occurred_at=task_snapshot["created_at"],
                ),
            )
        for _ in task_snapshot["subtasks"]:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="subtask",
                    event="created",
                    actor_id=current_user.id,
                    assigned_to_id=task_snapshot["assigned_to_id"],
                    created_by_id=task_snapshot["created_by_id"],
                    priority=task_snapshot["priority"].value,
                    occurred_at=task_snapshot["created_at"],
                ),
            )

    db.commit()
    _invalidate_task_cache(current_user, action="created", task_ids=created_ids)
    created_records = (
        db.execute(_task_query().where(models.Task.id.in_(created_ids)))
        .unique()
        .scalars()
        .all()
    )
    if len(created_records) != len(created_ids):
        existing_ids = {task.id for task in created_records}
        for task_snapshot in task_snapshots:
            if task_snapshot["id"] in existing_ids:
                continue
            repaired_task = models.Task(
                id=task_snapshot["id"],
                title=task_snapshot["title"],
                description=task_snapshot["description"],
                status=task_snapshot["status"],
                priority=task_snapshot["priority"],
                team=task_snapshot["team"],
                project_id=task_snapshot["project_id"],
                subtask_approval_required=task_snapshot["subtask_approval_required"],
                assigned_to_id=task_snapshot["assigned_to_id"],
                assigned_at=datetime.utcnow() if task_snapshot["assigned_to_id"] else None,
                task_group_id=task_snapshot["task_group_id"],
                created_by_id=task_snapshot["created_by_id"],
                created_at=task_snapshot["created_at"],
                updated_at=task_snapshot["updated_at"],
                due_at=task_snapshot["due_at"],
                recurrence_rule=task_snapshot["recurrence_rule"],
                recurring_task_id=task_snapshot["recurring_task_id"],
                clarity_rating=task_snapshot["clarity_rating"],
                attachments=task_snapshot["attachments"],
                estimated_hours=task_snapshot["estimated_hours"],
                tags=task_snapshot["tags"],
            )
            for subtask_snapshot in task_snapshot["subtasks"]:
                repaired_task.subtasks.append(
                    models.Subtask(
                        id=subtask_snapshot["id"],
                        title=subtask_snapshot["title"],
                        completed=subtask_snapshot["completed"],
                        assigned_to_id=subtask_snapshot["assigned_to_id"],
                        status=subtask_snapshot["status"],
                        sort_order=subtask_snapshot["sort_order"],
                    )
                )
            db.add(repaired_task)
        db.commit()
        created_records = (
            db.execute(_task_query().where(models.Task.id.in_(created_ids)))
            .unique()
            .scalars()
            .all()
        )
    created_map = {task.id: task for task in created_records}
    ordered_records = [created_map[task_id] for task_id in created_ids if task_id in created_map]

    status_title_map = _status_title_map(db)
    serialized_records = _serialize_tasks(ordered_records, status_title_map, viewer=current_user)
    for created_task in serialized_records:
        background_tasks.add_task(
            trigger_n8n_event,
            "task.created",
            created_task,
        )

    return serialized_records


# ---------------------------------------------------------------------------#
# Task Templates
# ---------------------------------------------------------------------------#

def _ensure_admin_or_owner(user: models.User) -> None:
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only managers, admins, or the owner can manage task templates",
        )


def _task_template_query() -> select:
    return (
        select(models.TaskTemplate)
        .options(
            selectinload(models.TaskTemplate.department),
            selectinload(models.TaskTemplate.creator),
        )
        .order_by(models.TaskTemplate.created_at.desc())
    )


@router.get("/task-templates", response_model=List[schemas.TaskTemplateRead])
def list_task_templates(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskTemplateRead]:
    stmt = _task_template_query()
    templates = db.execute(stmt).unique().scalars().all()
    return templates


@router.post("/task-templates", response_model=schemas.TaskTemplateRead, status_code=status.HTTP_201_CREATED)
def create_task_template(
    payload: str = Form(...),
    featured_image: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    import json
    payload_data = json.loads(payload)
    payload_obj = schemas.TaskTemplateCreate(**payload_data)
    _ensure_admin_or_owner(current_user)

    featured_image_path = None
    if featured_image:
        # Validate file size (2MB max)
        if featured_image.file.seek(0, 2) > 2 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image file too large (max 2MB)")
        featured_image.file.seek(0)

        # Validate file type (basic check)
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
        if featured_image.content_type not in allowed_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file type")

        # Save file
        file_extension = os.path.splitext(featured_image.filename)[1]
        filename = f"{uuid4()}{file_extension}"
        file_path = os.path.join("assets", "task_templates", filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(featured_image.file, buffer)

        featured_image_path = file_path

    template = models.TaskTemplate(
        title=payload_obj.title,
        description=payload_obj.description,
        priority=payload_obj.priority,
        team=payload_obj.team,
        subtasks=payload_obj.subtasks,
        attachments=payload_obj.attachments,
        estimated_hours=payload_obj.estimated_hours,
        tags=payload_obj.tags,
        featured_image=featured_image_path,
        department_id=payload_obj.department_id,
        created_by_id=current_user.id,
    )

    db.add(template)
    db.commit()
    db.refresh(template)

    return template


@router.get("/task-templates/{template_id}", response_model=schemas.TaskTemplateRead)
def get_task_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _ensure_admin_or_owner(current_user)
    template = db.execute(_task_template_query().where(models.TaskTemplate.id == template_id)).unique().scalars().first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task template not found")
    return template


@router.patch("/task-templates/{template_id}", response_model=schemas.TaskTemplateRead)
def update_task_template(
    template_id: str,
    payload: str = Form(...),
    featured_image: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    import json
    payload_data = json.loads(payload)
    payload_obj = schemas.TaskTemplateUpdate(**payload_data)
    _ensure_admin_or_owner(current_user)

    template = db.execute(_task_template_query().where(models.TaskTemplate.id == template_id)).unique().scalars().first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task template not found")

    featured_image_path = template.featured_image
    if featured_image:
        # Validate file size (2MB max)
        if featured_image.file.seek(0, 2) > 2 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image file too large (max 2MB)")
        featured_image.file.seek(0)

        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
        if featured_image.content_type not in allowed_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file type")

        # Remove old file if exists
        if template.featured_image and os.path.exists(template.featured_image):
            os.remove(template.featured_image)

        # Save new file
        file_extension = os.path.splitext(featured_image.filename)[1]
        filename = f"{uuid4()}{file_extension}"
        file_path = os.path.join("assets", "task_templates", filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(featured_image.file, buffer)

        featured_image_path = file_path

    if payload_obj.title is not None:
        template.title = payload_obj.title
    if payload_obj.description is not None:
        template.description = payload_obj.description
    if payload_obj.priority is not None:
        template.priority = payload_obj.priority
    if payload_obj.team is not None:
        template.team = payload_obj.team
    if payload_obj.subtasks is not None:
        template.subtasks = payload_obj.subtasks
    if payload_obj.attachments is not None:
        template.attachments = payload_obj.attachments
    if payload_obj.estimated_hours is not None:
        template.estimated_hours = payload_obj.estimated_hours
    if payload_obj.tags is not None:
        template.tags = payload_obj.tags
    if payload_obj.featured_image is not None or featured_image:
        template.featured_image = featured_image_path
    if payload_obj.department_id is not None:
        template.department_id = payload_obj.department_id

    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)

    return template


@router.delete("/task-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    _ensure_admin_or_owner(current_user)

    template = db.execute(_task_template_query().where(models.TaskTemplate.id == template_id)).unique().scalars().first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task template not found")

    # Remove featured image file if exists
    if template.featured_image and os.path.exists(template.featured_image):
        os.remove(template.featured_image)

    db.delete(template)
    db.commit()


@router.post("/task-templates/{template_id}/assign", response_model=List[schemas.TaskRead])
def assign_task_template(
    template_id: str,
    payload: schemas.TaskTemplateAssignRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _ensure_admin_or_owner(current_user)

    template = db.execute(_task_template_query().where(models.TaskTemplate.id == template_id)).unique().scalars().first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task template not found")

    creation_points = get_task_creation_points(db)
    assigned_tasks = []

    if payload.assignment_type == "single":
        if not payload.user_ids or len(payload.user_ids) != 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Single assignment requires exactly one user_id")
        user_id = payload.user_ids[0]
        user = db.execute(select(models.User).where(models.User.id == user_id)).scalars().first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        group_id = str(uuid4())

        task = models.Task(
            title=template.title,
            description=template.description,
            priority=template.priority,
            team=template.team,
            assigned_to_id=user_id,
            assigned_at=datetime.utcnow() if user_id else None,
            task_group_id=group_id,
            created_by_id=current_user.id,
            attachments=template.attachments.copy(),
            estimated_hours=template.estimated_hours,
            tags=template.tags.copy(),
        )

        for subtask_title in template.subtasks:
            task.subtasks.append(models.Subtask(title=subtask_title, completed=False))

        db.add(task)
        current_user.tasks_created += 1
        current_user.points += creation_points
        check_and_unlock_achievements(db, current_user)

        notification_service.create_notification(
            db,
            user_id=user_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.TASK_ASSIGNED,
            message=f"You have been assigned a new task from template: '{task.title}'.",
            related_task_id=task.id,
        )

        assigned_tasks.append(task)

    elif payload.assignment_type == "multiple":
        if not payload.user_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Multiple assignment requires user_ids")

        batch_group_id = str(uuid4())

        for user_id in payload.user_ids:
            user = db.execute(select(models.User).where(models.User.id == user_id)).scalars().first()
            if not user:
                continue  # Skip invalid users

            task = models.Task(
                title=template.title,
                description=template.description,
                priority=template.priority,
                team=template.team,
                assigned_to_id=user_id,
                assigned_at=datetime.utcnow() if user_id else None,
                task_group_id=batch_group_id,
                created_by_id=current_user.id,
                attachments=template.attachments.copy(),
                estimated_hours=template.estimated_hours,
                tags=template.tags.copy(),
            )

            for subtask_title in template.subtasks:
                task.subtasks.append(models.Subtask(title=subtask_title, completed=False))

            db.add(task)
            current_user.tasks_created += 1
            current_user.points += creation_points
            check_and_unlock_achievements(db, current_user)

            notification_service.create_notification(
                db,
                user_id=user_id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.TASK_ASSIGNED,
                message=f"You have been assigned a new task from template: '{task.title}'.",
                related_task_id=task.id,
            )

            assigned_tasks.append(task)

    elif payload.assignment_type == "department":
        if not payload.department_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department assignment requires department_id")

        department = db.execute(select(models.Department).where(models.Department.id == payload.department_id)).scalars().first()
        if not department:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

        active_users = db.execute(
            select(models.User).where(
                models.User.department_id == payload.department_id,
                models.User.status == models.UserStatusEnum.ACTIVE
            )
        ).scalars().all()

        batch_group_id = str(uuid4())

        for user in active_users:
            task = models.Task(
                title=template.title,
                description=template.description,
                priority=template.priority,
                team=template.team,
                assigned_to_id=user.id,
                assigned_at=datetime.utcnow(),
                task_group_id=batch_group_id,
                created_by_id=current_user.id,
                attachments=template.attachments.copy(),
                estimated_hours=template.estimated_hours,
                tags=template.tags.copy(),
            )

            for subtask_title in template.subtasks:
                task.subtasks.append(models.Subtask(title=subtask_title, completed=False))

            db.add(task)
            current_user.tasks_created += 1
            current_user.points += creation_points
            check_and_unlock_achievements(db, current_user)

            notification_service.create_notification(
                db,
                user_id=user.id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.TASK_ASSIGNED,
                message=f"You have been assigned a new task from template: '{task.title}'.",
                related_task_id=task.id,
            )

            assigned_tasks.append(task)

    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignment type")

    for task in assigned_tasks:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="created",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=task.created_at,
            ),
        )
        if task.assigned_to_id:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="task",
                    event="assigned",
                    actor_id=current_user.id,
                    assigned_to_id=task.assigned_to_id,
                    created_by_id=task.created_by_id,
                    priority=task.priority.value,
                    occurred_at=task.created_at,
                ),
            )
        for subtask in task.subtasks:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="subtask",
                    event="created",
                    actor_id=current_user.id,
                    assigned_to_id=task.assigned_to_id,
                    created_by_id=task.created_by_id,
                    priority=task.priority.value,
                    occurred_at=task.created_at,
                ),
            )

    db.commit()
    task_ids = [t.id for t in assigned_tasks]
    _invalidate_task_cache(current_user, action="created", task_ids=task_ids)

    # Fetch full task details for response
    tasks = db.execute(_task_query().where(models.Task.id.in_(task_ids))).unique().scalars().all()

    status_title_map = _status_title_map(db)
    serialized_tasks = _serialize_tasks(tasks, status_title_map, viewer=current_user)
    for task in serialized_tasks:
        background_tasks.add_task(
            trigger_n8n_event,
            "task.created",
            task,
        )

    return serialized_tasks


@router.get("/{task_id}", response_model=schemas.TaskRead)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    status_title_map = _status_title_map(db)
    return _serialize_task(task, status_title_map, viewer=current_user)


@router.get("/{task_id}/group", response_model=List[schemas.TaskRead])
def get_task_group(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.TaskRead]:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)

    stmt = _task_query().where(models.Task.task_group_id == task.task_group_id)
    group_tasks = db.execute(stmt).unique().scalars().all()
    visible_group_tasks: list[models.Task] = []
    for group_task in group_tasks:
        try:
            _ensure_task_access(group_task, current_user)
        except HTTPException:
            continue
        visible_group_tasks.append(group_task)
    status_title_map = _status_title_map(db)
    return _serialize_tasks(visible_group_tasks, status_title_map, viewer=current_user)


@router.patch("/{task_id}", response_model=schemas.TaskRead)
def update_task(
    task_id: str,
    payload: schemas.TaskUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_update_access(task, current_user)

    update_data = payload.model_dump(exclude_unset=True)
    update_fields = sorted(update_data.keys())
    previous_status = task.status
    previous_priority = task.priority
    previous_assignee_id = task.assigned_to_id
    previous_clarity_rating = task.clarity_rating
    previous_due_at = task.due_at
    new_status = update_data.get("status", task.status)
    effective_project = task.project

    should_award_points = previous_status not in COMPLETED_STATUSES and new_status in COMPLETED_STATUSES

    dependencies_ids = update_data.pop("dependencies", None)
    follower_ids = update_data.pop("follower_ids", None)
    subtasks_provided = "subtasks" in update_data
    subtask_workflow_events: list[subtask_workflow.WorkflowDomainEvent] = []
    parent_changed_by_subtasks = False

    if "project_id" in update_data:
        next_project_id = update_data["project_id"]
        if next_project_id:
            effective_project = _fetch_project_for_task(
                db,
                project_id=next_project_id,
                current_user=current_user,
                require_active=True,
                require_write=True,
            )
            task.project_id = effective_project.id
        else:
            if task.project_id and not _is_admin_or_owner(current_user):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only admins or owners can unlink a task from a project",
                )
            task.project_id = None
            effective_project = None

    assignee_notification_target: Optional[models.User] = None
    if "assigned_to_id" in update_data:
        new_assignee_id = update_data["assigned_to_id"]
        if new_assignee_id:
            assignee = db.get(models.User, new_assignee_id)
            if not assignee:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned user not found")
            _ensure_user_in_current_tenant(assignee, current_user, label="Assigned user")
            _ensure_project_assignee_allowed(effective_project, assignee.id)
            task.assigned_to_id = assignee.id
            if assignee.id != previous_assignee_id:
                assignee_notification_target = assignee
                task.assigned_at = datetime.utcnow()
        else:
            task.assigned_to_id = None
            task.assigned_at = None

    if "approver_id" in update_data:
        approver_id = update_data["approver_id"]
        if approver_id:
            approver = db.get(models.User, approver_id)
            if not approver:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approver not found")
            _ensure_user_in_current_tenant(approver, current_user, label="Approver")
            task.approver_id = approver.id
        else:
            task.approver_id = None
    elif effective_project is not None:
        _ensure_project_assignee_allowed(effective_project, task.assigned_to_id)

    shared_updates: dict[str, Any] = {}

    if "title" in update_data:
        task.title = update_data["title"]
        shared_updates["title"] = task.title
    if "description" in update_data:
        task.description = update_data["description"]
        shared_updates["description"] = task.description
    if "status" in update_data:
        task.status = update_data["status"]
    if "priority" in update_data:
        _ensure_priority_allowed(update_data["priority"], current_user)
        task.priority = update_data["priority"]
        shared_updates["priority"] = task.priority
    if "team" in update_data:
        task.team = update_data["team"]
    if "due_at" in update_data:
        task.due_at = update_data["due_at"]
    if "completed_at" in update_data:
        task.completed_at = update_data["completed_at"]
    if "recurrence_rule" in update_data:
        task.recurrence_rule = update_data["recurrence_rule"]
    if "recurring_task_id" in update_data:
        task.recurring_task_id = update_data["recurring_task_id"]
    if "clarity_rating" in update_data:
        task.clarity_rating = update_data["clarity_rating"]
    if "attachments" in update_data:
        task.attachments = list(update_data["attachments"] or [])
    if "estimated_hours" in update_data:
        task.estimated_hours = update_data["estimated_hours"]
    if "tags" in update_data:
        task.tags = list(update_data["tags"] or [])
    if "approval_required" in update_data:
        task.approval_required = bool(update_data["approval_required"])
        if not task.approval_required:
            task.approval_status = models.TaskApprovalStatusEnum.NONE
    if "subtask_approval_required" in update_data:
        _ensure_subtask_workflow_write(task, current_user)
        task.subtask_approval_required = update_data["subtask_approval_required"]

    if dependencies_ids is not None:
        if task_id in dependencies_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task cannot depend on itself")
        if dependencies_ids:
            dependency_stmt = _task_query().where(models.Task.id.in_(dependencies_ids))
            dependencies = db.execute(dependency_stmt).unique().scalars().all()
            found_ids = {dependency.id for dependency in dependencies}
            missing_ids = [dep_id for dep_id in dependencies_ids if dep_id not in found_ids]
            if missing_ids:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Dependencies not found: {', '.join(missing_ids)}",
                )
            task.dependencies = dependencies
        else:
            task.dependencies.clear()

    if follower_ids is not None:
        task.followers = _resolve_task_followers(
            db,
            follower_ids,
            current_user=current_user,
            exclude_ids={current_user.id, *(filter(None, [task.assigned_to_id]))},
        )

    if subtasks_provided:
        existing_subtasks = {sub.id: sub for sub in task.subtasks}
        incoming_subtasks = payload.subtasks or []

        for subtask_input in incoming_subtasks:
            if subtask_input.id and subtask_input.id in existing_subtasks:
                subtask = existing_subtasks.pop(subtask_input.id)
                if subtask.title != subtask_input.title or (
                    "sort_order" in subtask_input.model_fields_set and subtask.sort_order != subtask_input.sort_order
                ):
                    _ensure_subtask_workflow_write(task, current_user)
                subtask.title = subtask_input.title
                if "completed" in subtask_input.model_fields_set or "status" in subtask_input.model_fields_set:
                    next_status = subtask_workflow.status_from_completed(
                        completed=subtask_input.completed,
                        status_value=subtask_input.status,
                        current_status=subtask.status,
                    )
                    workflow_result = subtask_workflow.transition_subtask(
                        db,
                        task,
                        subtask_id=subtask.id,
                        actor=current_user,
                        target_status=next_status,
                        can_override=_can_override_subtask_workflow(task, current_user),
                        synchronize_parent=False,
                    )
                    subtask_workflow_events.extend(workflow_result.domain_events)
                if "assigned_to_id" in subtask_input.model_fields_set and subtask_input.assigned_to_id != subtask.assigned_to_id:
                    previous_subtask_assignee_id = subtask.assigned_to_id
                    _ensure_subtask_workflow_write(task, current_user)
                    _ensure_subtask_assignee_allowed(db, task, subtask_input.assigned_to_id, current_user)
                    subtask.assigned_to_id = subtask_input.assigned_to_id
                    subtask_notifications.enqueue_reassignment_notification(
                        db,
                        task=task,
                        subtask=subtask,
                        previous_assignee_id=previous_subtask_assignee_id,
                        actor_id=current_user.id,
                    )
                    security_audit.append_event(
                        db,
                        actor=current_user,
                        event_type="subtask.reassigned",
                        entity_type="subtask",
                        entity_id=subtask.id,
                        payload={
                            "task_id": task.id,
                            "previous_assignee_id": previous_subtask_assignee_id,
                            "assigned_to_id": subtask.assigned_to_id,
                        },
                    )
                if "sort_order" in subtask_input.model_fields_set:
                    subtask.sort_order = subtask_input.sort_order
            else:
                _ensure_subtask_workflow_write(task, current_user)
                subtask_status, subtask_completed = _normalize_subtask_status(
                    completed=subtask_input.completed,
                    status_value=subtask_input.status,
                )
                _ensure_subtask_assignee_allowed(db, task, subtask_input.assigned_to_id, current_user)
                task.subtasks.append(
                    models.Subtask(
                        id=subtask_input.id,
                        title=subtask_input.title,
                        completed=subtask_completed,
                        assigned_to_id=subtask_input.assigned_to_id,
                        status=subtask_status,
                        sort_order=subtask_input.sort_order,
                    )
                )

        for stale_subtask in existing_subtasks.values():
            _ensure_subtask_workflow_write(task, current_user)
            task.subtasks.remove(stale_subtask)
            db.delete(stale_subtask)
        db.flush()
        parent_changed = subtask_workflow.synchronize_parent_completion(db, task, actor=current_user)
        parent_changed_by_subtasks = parent_changed

    if update_data.get("status") in COMPLETED_STATUSES and any(
        subtask.status != models.SubtaskStatusEnum.DONE for subtask in task.subtasks
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complete all subtasks before completing the task")

    completion_points_awarded = False
    if should_award_points:
        if task.completed_at is None:
            task.completed_at = datetime.utcnow()
        completion_points_awarded = award_task_completion_points(db, task, notify_creator=False)

    if (
        "clarity_rating" in update_data
        and update_data["clarity_rating"] is not None
        and previous_clarity_rating is None
    ):
        record_clarity_rating(db, task, update_data["clarity_rating"])

    if shared_updates and task.task_group_id:
        peer_stmt = (
            select(models.Task)
            .where(
                models.Task.task_group_id == task.task_group_id,
                models.Task.id != task.id,
            )
        )
        peer_tasks = db.execute(peer_stmt).scalars().all()
        for peer in peer_tasks:
            for field, value in shared_updates.items():
                setattr(peer, field, value)

    if assignee_notification_target:
        notification_service.create_notification(
            db,
            user_id=assignee_notification_target.id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.TASK_ASSIGNED,
            message=f"You have been assigned task: '{task.title}'.",
            title="Task assigned",
            body=f"You have been assigned task: '{task.title}'.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link=f"/tasks/{task.id}",
            related_task_id=task.id,
        )

    status_changed = task.status != previous_status
    if status_changed and not parent_changed_by_subtasks:
        task_notifications.notify_status_change(db, task=task, actor=current_user, previous_status=previous_status)

    other_fields_updated = bool(set(update_fields) - {"status"})
    if task.created_by_id and task.created_by_id != current_user.id and not parent_changed_by_subtasks and not status_changed and other_fields_updated:
        notification_service.create_notification(
            db,
            user_id=task.created_by_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.TASK_UPDATED,
            message=f"Task '{task.title}' was updated.",
            title="Task updated",
            body=f"Task '{task.title}' was updated.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link=f"/tasks/{task.id}",
            related_task_id=task.id,
        )

    if other_fields_updated and not parent_changed_by_subtasks and not status_changed:
        _notify_task_participants(
            db,
            task=task,
            current_user=current_user,
            title="Task updated",
            message=f"Task '{task.title}' was updated.",
            exclude_ids={assignee_notification_target.id} if assignee_notification_target else None,
            notification_type=models.NotificationTypeEnum.TASK_UPDATED,
        )

    priority_changed = task.priority != previous_priority
    assignee_changed = task.assigned_to_id != previous_assignee_id
    now = datetime.utcnow()

    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    if status_changed:
        before["status"] = previous_status.value
        after["status"] = task.status.value
    if priority_changed:
        before["priority"] = previous_priority.value
        after["priority"] = task.priority.value
    if assignee_changed:
        before["assigned_to_id"] = previous_assignee_id
        after["assigned_to_id"] = task.assigned_to_id
    if previous_due_at != task.due_at:
        before["due_at"] = previous_due_at.isoformat() if previous_due_at else None
        after["due_at"] = task.due_at.isoformat() if task.due_at else None

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="task",
            event="updated",
            actor_id=current_user.id,
            assigned_to_id=task.assigned_to_id,
            created_by_id=task.created_by_id,
            priority=task.priority.value,
            occurred_at=now,
        ),
    )
    if status_changed:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="status_changed",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )
    if priority_changed:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="priority_changed",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )
    if assignee_changed and task.assigned_to_id:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="assigned",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )
    if status_changed and previous_status in COMPLETED_STATUSES and task.status not in COMPLETED_STATUSES:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="reopened",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )
    if completion_points_awarded:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="completed",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=task.completed_at or now,
            ),
        )
    if task.due_at and task.due_at <= now and task.status not in COMPLETED_STATUSES:
        if not previous_due_at or previous_due_at > now or previous_status in COMPLETED_STATUSES:
            process_badge_event(
                db,
                event=BadgeEvent(
                    entity="task",
                    event="overdue",
                    actor_id=current_user.id,
                    assigned_to_id=task.assigned_to_id,
                    created_by_id=task.created_by_id,
                    priority=task.priority.value,
                    occurred_at=now,
                ),
            )

    if update_fields:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="TASK_UPDATED",
                category=models.AuditLogCategoryEnum.TASK,
                actor_id=str(current_user.id),
                actor_role=current_user.role.value if current_user.role else None,
                entity_type="task",
                entity_id=task.id,
                target_user_id=task.assigned_to_id,
                source=models.AuditLogSourceEnum.MANUAL,
                before=before or None,
                after=after or None,
                metadata={"fields": update_fields},
                request=request,
            )
        )
        db.add(
            models.AuditEvent(
                actor_id=current_user.id,
                event_type="task.updated",
                entity_type="task",
                entity_id=task.id,
                payload={"fields": update_fields},
                created_at=now,
            )
        )

    subtask_notifications.enqueue_workflow_notifications(db, task=task, events=subtask_workflow_events)
    db.commit()
    _invalidate_task_cache(current_user, action="updated", task_id=task_id)
    _publish_subtask_workflow_events(current_user, subtask_workflow_events)
    _schedule_notification_outbox_delivery(background_tasks)

    updated_task = _fetch_task_or_404(db, task_id)
    status_title_map = _status_title_map(db)
    serialized_task = _serialize_task(updated_task, status_title_map, viewer=current_user)

    background_tasks.add_task(
        trigger_n8n_event,
        "task.updated",
        serialized_task,
    )

    if status_changed and task.status in COMPLETED_STATUSES:
        background_tasks.add_task(
            trigger_n8n_event,
            "task.completed",
            {"taskId": updated_task.id},
        )
        task_link_service.handle_task_completion(db, task_id=updated_task.id)

    return serialized_task


@router.post("/{task_id}/complete", response_model=schemas.TaskRead)
def complete_task(
    task_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_update_access(task, current_user)
    if any(subtask.status != models.SubtaskStatusEnum.DONE for subtask in task.subtasks):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complete all subtasks before completing the task")

    previous_status = task.status
    now = datetime.utcnow()
    task.status = models.TaskStatusEnum.DONE
    if task.completed_at is None:
        task.completed_at = now

    if task.approval_required:
        task.approval_status = models.TaskApprovalStatusEnum.PENDING
    else:
        task.approval_status = models.TaskApprovalStatusEnum.APPROVED

    should_award_points = previous_status not in COMPLETED_STATUSES and task.status in COMPLETED_STATUSES
    completion_points_awarded = False
    if should_award_points:
        completion_points_awarded = award_task_completion_points(db, task, notify_creator=False)
    task_notifications.notify_status_change(db, task=task, actor=current_user, previous_status=previous_status)

    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="task.completed",
            entity_type="task",
            entity_id=task.id,
            payload={
                "status": task.status.value,
                "approval_required": task.approval_required,
                "approval_status": task.approval_status.value,
            },
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TASK_COMPLETED",
            category=models.AuditLogCategoryEnum.TASK,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="task",
            entity_id=task.id,
            target_user_id=task.assigned_to_id,
            source=models.AuditLogSourceEnum.MANUAL,
            before={"status": previous_status.value},
            after={"status": task.status.value},
            request=request,
        )
    )

    if task.approval_required and task.approver_id and task.approver_id != current_user.id:
        notification_service.create_notification(
            db,
            user_id=task.approver_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.APPROVAL_REQUESTED,
            message=f"Task '{task.title}' is ready for approval.",
            title="Task approval needed",
            body=f"Task '{task.title}' was completed and requires your approval.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            related_task_id=task.id,
        )

    if completion_points_awarded:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="task",
                event="completed",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=task.completed_at or now,
            ),
        )

    db.commit()
    _invalidate_task_cache(current_user, action="completed", task_id=task_id)

    updated_task = _fetch_task_or_404(db, task_id)
    status_title_map = _status_title_map(db)
    serialized_task = _serialize_task(updated_task, status_title_map, viewer=current_user)

    if completion_points_awarded:
        background_tasks.add_task(
            trigger_n8n_event,
            "task.completed",
            {"taskId": updated_task.id},
        )
        task_link_service.handle_task_completion(db, task_id=updated_task.id)

    return serialized_task


@router.post("/{task_id}/approve", response_model=schemas.TaskRead)
def approve_task(
    task_id: str,
    payload: schemas.TaskApprovalAction,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    if not task.approval_required:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task does not require approval")
    if not task.approver_id or task.approver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to approve this task")

    decision = payload.decision
    if decision == "approved":
        task.approval_status = models.TaskApprovalStatusEnum.APPROVED
    else:
        task.approval_status = models.TaskApprovalStatusEnum.REJECTED

    now = datetime.utcnow()
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="task.approval",
            entity_type="task",
            entity_id=task.id,
            payload={
                "decision": decision,
                "comment": payload.comment,
            },
            created_at=now,
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TASK_APPROVAL_DECISION",
            category=models.AuditLogCategoryEnum.APPROVAL,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="task",
            entity_id=task.id,
            target_user_id=task.created_by_id,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"decision": decision, "comment": payload.comment},
            request=request,
        )
    )

    recipients = {
        task.created_by_id,
        task.assigned_to_id,
    }
    recipients.discard(None)
    recipients.discard(current_user.id)
    for recipient_id in recipients:
        notification_service.create_notification(
            db,
            user_id=recipient_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.APPROVAL_ACTED,
            message=f"Task '{task.title}' approval {decision}.",
            title=f"Task approval {decision}",
            body=f"Task '{task.title}' was {decision}.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            related_task_id=task.id,
        )

    db.commit()
    _invalidate_task_cache(current_user, action="approval", task_id=task_id)

    updated_task = _fetch_task_or_404(db, task_id)
    status_title_map = _status_title_map(db)
    return _serialize_task(updated_task, status_title_map, viewer=current_user)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_update_access(task, current_user)
    status_title_map = _status_title_map(db)
    serialized_task = _serialize_task(task, status_title_map, viewer=current_user)

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="task",
            event="deleted",
            actor_id=current_user.id,
            assigned_to_id=task.assigned_to_id,
            created_by_id=task.created_by_id,
            priority=task.priority.value,
            occurred_at=datetime.utcnow(),
        ),
    )

    if task.created_by_id and task.created_by_id != current_user.id:
        notification_service.create_notification(
            db,
            user_id=task.created_by_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.TASK_DELETED,
            message=f"Task '{task.title}' was deleted.",
            title="Task deleted",
            body=f"Task '{task.title}' was deleted.",
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link="/tasks",
            related_task_id=task.id,
        )
    _notify_task_participants(
        db, task=task, current_user=current_user, title="Task deleted",
        message=f"Task '{task.title}' was deleted.",
        notification_type=models.NotificationTypeEnum.TASK_DELETED, deep_link="/tasks",
    )

    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="task.deleted",
            entity_type="task",
            entity_id=task.id,
            payload={
                "title": task.title,
                "assigned_to_id": task.assigned_to_id,
                "priority": task.priority.value,
                "status": task.status.value,
            },
            created_at=datetime.utcnow(),
        )
    )
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TASK_DELETED",
            category=models.AuditLogCategoryEnum.TASK,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="task",
            entity_id=task.id,
            target_user_id=task.assigned_to_id,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={
                "title": task.title,
                "priority": task.priority.value,
                "status": task.status.value,
            },
            request=request,
        )
    )

    db.delete(task)
    db.commit()
    _invalidate_task_cache(current_user, action="deleted", task_id=task_id)

    background_tasks.add_task(
        trigger_n8n_event,
        "task.deleted",
        {"taskId": task_id, "task": serialized_task},
    )


def _fetch_task_subtask_or_404(task: models.Task, subtask_id: str) -> models.Subtask:
    subtask = next((item for item in task.subtasks if item.id == subtask_id), None)
    if not subtask:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    return subtask


def _subtask_dependency_edges(
    task: models.Task,
    *,
    omit_dependency_id: Optional[str] = None,
) -> list[tuple[str, str]]:
    edges: list[tuple[str, str]] = []
    for subtask in task.subtasks:
        for edge in subtask.dependency_edges:
            if omit_dependency_id and edge.id == omit_dependency_id:
                continue
            edges.append((edge.subtask_id, edge.depends_on_subtask_id))
    return edges


def _would_create_subtask_cycle(
    task: models.Task,
    *,
    subtask_id: str,
    depends_on_subtask_id: str,
    omit_dependency_id: Optional[str] = None,
) -> bool:
    parent_map: dict[str, list[str]] = {}
    for child_id, parent_id in _subtask_dependency_edges(task, omit_dependency_id=omit_dependency_id):
        parent_map.setdefault(child_id, []).append(parent_id)
    parent_map.setdefault(subtask_id, []).append(depends_on_subtask_id)

    stack = list(parent_map.get(depends_on_subtask_id, []))
    visited: set[str] = set()
    while stack:
        current = stack.pop()
        if current == subtask_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        stack.extend(parent_map.get(current, []))
    return False


def _validate_subtask_dependency(
    task: models.Task,
    *,
    subtask_id: str,
    depends_on_subtask_id: str,
    omit_dependency_id: Optional[str] = None,
) -> tuple[models.Subtask, models.Subtask]:
    subtask = _fetch_task_subtask_or_404(task, subtask_id)
    depends_on = _fetch_task_subtask_or_404(task, depends_on_subtask_id)
    if subtask.id == depends_on.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subtask cannot depend on itself")
    if _would_create_subtask_cycle(
        task,
        subtask_id=subtask.id,
        depends_on_subtask_id=depends_on.id,
        omit_dependency_id=omit_dependency_id,
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subtask dependency cycle detected")
    return subtask, depends_on


@router.post(
    "/{task_id}/subtasks/{subtask_id}/dependencies",
    response_model=schemas.SubtaskDependencyRead,
    status_code=status.HTTP_201_CREATED,
)
def create_subtask_dependency(
    task_id: str,
    subtask_id: str,
    payload: schemas.SubtaskDependencyCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.SubtaskDependencyRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    _ensure_subtask_workflow_write(task, current_user)
    locked_subtasks, locked_dependencies = subtask_workflow.lock_workflow_rows(db, task.id)
    subtask_workflow.validate_dependency_mutation(
        subtasks=locked_subtasks,
        dependencies=locked_dependencies,
        subtask_id=subtask_id,
        depends_on_subtask_id=payload.depends_on_subtask_id,
    )
    if any(
        edge.subtask_id == subtask_id and edge.depends_on_subtask_id == payload.depends_on_subtask_id
        for edge in locked_dependencies
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subtask dependency already exists")

    dependency = models.SubtaskDependency(
        task_id=task.id,
        subtask_id=subtask_id,
        depends_on_subtask_id=payload.depends_on_subtask_id,
        dependency_order=payload.dependency_order,
        branch_key=payload.branch_key,
    )
    db.add(dependency)
    db.flush()
    workflow_result = subtask_workflow.activate_ready_subtasks(
        db,
        task,
        actor=current_user,
        locked_rows=(locked_subtasks, [*locked_dependencies, dependency]),
    )
    subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
    db.commit()
    db.refresh(dependency)
    _invalidate_task_cache(current_user, action="subtask_dependency_created", task_id=task_id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    return schemas.SubtaskDependencyRead.model_validate(dependency)


@router.patch(
    "/{task_id}/subtasks/{subtask_id}/dependencies/{dependency_id}",
    response_model=schemas.SubtaskDependencyRead,
)
def update_subtask_dependency(
    task_id: str,
    subtask_id: str,
    dependency_id: str,
    payload: schemas.SubtaskDependencyUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.SubtaskDependencyRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    _ensure_subtask_workflow_write(task, current_user)
    dependency = (
        db.execute(
            select(models.SubtaskDependency)
            .where(models.SubtaskDependency.id == dependency_id)
            .where(models.SubtaskDependency.task_id == task.id)
            .where(models.SubtaskDependency.subtask_id == subtask_id)
        )
        .scalars()
        .first()
    )
    if not dependency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask dependency not found")

    update_data = payload.model_dump(exclude_unset=True)
    next_depends_on = update_data.get("depends_on_subtask_id", dependency.depends_on_subtask_id)
    locked_subtasks, locked_dependencies = subtask_workflow.lock_workflow_rows(db, task.id)
    subtask_workflow.validate_dependency_mutation(
        subtasks=locked_subtasks,
        dependencies=locked_dependencies,
        subtask_id=subtask_id,
        depends_on_subtask_id=next_depends_on,
        omit_dependency_id=dependency.id,
    )
    if any(
        edge.id != dependency.id
        and edge.subtask_id == subtask_id
        and edge.depends_on_subtask_id == next_depends_on
        for edge in locked_dependencies
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subtask dependency already exists")
    if "depends_on_subtask_id" in update_data:
        dependency.depends_on_subtask_id = next_depends_on
    if "dependency_order" in update_data:
        dependency.dependency_order = update_data["dependency_order"]
    if "branch_key" in update_data:
        dependency.branch_key = update_data["branch_key"]

    workflow_result = subtask_workflow.activate_ready_subtasks(
        db,
        task,
        actor=current_user,
        locked_rows=(locked_subtasks, locked_dependencies),
    )
    subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
    db.commit()
    db.refresh(dependency)
    _invalidate_task_cache(current_user, action="subtask_dependency_updated", task_id=task_id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    return schemas.SubtaskDependencyRead.model_validate(dependency)


@router.delete(
    "/{task_id}/subtasks/{subtask_id}/dependencies/{dependency_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_subtask_dependency(
    task_id: str,
    subtask_id: str,
    dependency_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    _ensure_subtask_workflow_write(task, current_user)
    dependency = (
        db.execute(
            select(models.SubtaskDependency)
            .where(models.SubtaskDependency.id == dependency_id)
            .where(models.SubtaskDependency.task_id == task.id)
            .where(models.SubtaskDependency.subtask_id == subtask_id)
        )
        .scalars()
        .first()
    )
    if not dependency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask dependency not found")

    db.delete(dependency)
    db.flush()
    workflow_result = subtask_workflow.activate_ready_subtasks(db, task, actor=current_user, activate_orphans=True)
    subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
    db.commit()
    _invalidate_task_cache(current_user, action="subtask_dependency_deleted", task_id=task_id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    return None


@router.patch("/{task_id}/subtasks/{subtask_id}", response_model=schemas.TaskRead)
def update_subtask(
    task_id: str,
    subtask_id: str,
    payload: schemas.SubtaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)

    subtask = _fetch_task_subtask_or_404(task, subtask_id)

    previous_completed = subtask.completed
    previous_status = subtask.status
    previous_assignee_id = subtask.assigned_to_id
    update_data = payload.model_dump(exclude_unset=True)
    workflow_result = subtask_workflow.WorkflowResult()
    if any(field in update_data for field in ("title", "assigned_to_id", "sort_order")):
        _ensure_subtask_workflow_write(task, current_user)
    if "title" in update_data:
        subtask.title = update_data["title"]
    if "assigned_to_id" in update_data:
        _ensure_subtask_workflow_write(task, current_user)
        _ensure_subtask_assignee_allowed(db, task, update_data["assigned_to_id"], current_user)
        subtask.assigned_to_id = update_data["assigned_to_id"]
        subtask_notifications.enqueue_reassignment_notification(
            db,
            task=task,
            subtask=subtask,
            previous_assignee_id=previous_assignee_id,
            actor_id=current_user.id,
        )
        if previous_assignee_id != subtask.assigned_to_id:
            security_audit.append_event(
                db,
                actor=current_user,
                event_type="subtask.reassigned",
                entity_type="subtask",
                entity_id=subtask.id,
                payload={
                    "task_id": task.id,
                    "previous_assignee_id": previous_assignee_id,
                    "assigned_to_id": subtask.assigned_to_id,
                },
            )
    if "sort_order" in update_data:
        subtask.sort_order = update_data["sort_order"]
    if "completed" in update_data or "status" in update_data:
        next_status = subtask_workflow.status_from_completed(
            completed=update_data.get("completed"),
            status_value=update_data.get("status"),
            current_status=subtask.status,
        )
        workflow_result = subtask_workflow.transition_subtask(
            db,
            task,
            subtask_id=subtask_id,
            actor=current_user,
            target_status=next_status,
            force_start_reason=update_data.get("force_start_reason"),
            can_override=_can_override_subtask_workflow(task, current_user),
        )

    now = datetime.utcnow()
    process_badge_event(
        db,
        event=BadgeEvent(
            entity="subtask",
            event="updated",
            actor_id=current_user.id,
            assigned_to_id=task.assigned_to_id,
            created_by_id=task.created_by_id,
            priority=task.priority.value,
            occurred_at=now,
        ),
    )
    if "completed" in update_data and update_data["completed"] != previous_completed:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="subtask",
                event="completed" if update_data["completed"] else "reopened",
                actor_id=current_user.id,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )
    elif "status" in update_data and subtask.status != previous_status:
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="subtask",
                event="completed" if subtask.status == models.SubtaskStatusEnum.DONE else "updated",
                actor_id=current_user.id,
                assigned_to_id=subtask.assigned_to_id or task.assigned_to_id,
                created_by_id=task.created_by_id,
                priority=task.priority.value,
                occurred_at=now,
            ),
        )

    subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
    db.commit()
    _invalidate_task_cache(current_user, action="subtask_updated", task_id=task_id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    _finish_subtask_parent_completion(db, task_id, workflow_result, background_tasks)

    updated_task = _fetch_task_or_404(db, task_id)
    status_title_map = _status_title_map(db)
    serialized_task = _serialize_task(updated_task, status_title_map, viewer=current_user)
    background_tasks.add_task(
        trigger_n8n_event,
        "task.subtask_updated",
        {
            "taskId": updated_task.id,
            "subtaskId": subtask_id,
            "task": serialized_task,
        },
    )

    return serialized_task


def _can_submit_subtask_completion(task: models.Task, subtask: models.Subtask, user: models.User) -> bool:
    if subtask.assigned_to_id == user.id:
        return True
    if not subtask.assigned_to_id and task.assigned_to_id == user.id:
        return True
    return _can_override_subtask_workflow(task, user)


def _ensure_can_review_subtask_completion(task: models.Task, user: models.User) -> None:
    if not _can_override_subtask_workflow(task, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subtask completion review requires workflow manager access")


def _ensure_completion_attachment_access(task: models.Task, subtask: models.Subtask, user: models.User) -> None:
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return
    if task.project and user.id in _project_member_ids(task.project):
        return
    if task.assigned_to_id == user.id or subtask.assigned_to_id == user.id:
        return
    if not task.project and task.created_by_id == user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Completion attachment access is no longer available")


def _serialize_completion_submission(task, subtask, submission, viewer):
    payload = schemas.CompletionSubmissionRead.model_validate(submission)
    allowed = False
    if viewer is not None:
        try:
            _ensure_completion_attachment_access(task, subtask, viewer)
            allowed = _task_belongs_to_user_tenant(task, viewer)
        except HTTPException as error:
            if error.status_code != 403:
                raise
    attachments = [schemas.CompletionAttachmentRead.model_validate(row) for row in submission.attachments
                   if allowed and row.tenant_id == viewer.tenant_id and row.submission_id == submission.id]
    return payload.model_copy(update={"attachments": attachments})


def _fetch_completion_submission_or_404(
    db: Session,
    *,
    task_id: str,
    subtask_id: str,
    submission_id: str,
) -> models.CompletionSubmission:
    submission = (
        db.execute(
            select(models.CompletionSubmission)
            .options(selectinload(models.CompletionSubmission.attachments))
            .where(models.CompletionSubmission.id == submission_id)
            .where(models.CompletionSubmission.task_id == task_id)
            .where(models.CompletionSubmission.subtask_id == subtask_id)
        )
        .scalars()
        .first()
    )
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Completion submission not found")
    return submission


@router.get(
    "/{task_id}/subtasks/{subtask_id}/completion-submissions",
    response_model=List[schemas.CompletionSubmissionRead],
)
def list_subtask_completion_submissions(
    task_id: str,
    subtask_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.CompletionSubmissionRead]:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    subtask = _fetch_task_subtask_or_404(task, subtask_id)
    submissions = (
        db.execute(
            select(models.CompletionSubmission)
            .options(selectinload(models.CompletionSubmission.attachments))
            .where(models.CompletionSubmission.task_id == task.id)
            .where(models.CompletionSubmission.subtask_id == subtask_id)
            .where(models.CompletionSubmission.tenant_id == current_user.tenant_id)
            .order_by(models.CompletionSubmission.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [_serialize_completion_submission(task, subtask, submission, current_user) for submission in submissions]


@router.post("/{task_id}/subtasks/{subtask_id}/completion-submissions", response_model=schemas.TaskRead)
def submit_subtask_completion(
    task_id: str,
    subtask_id: str,
    background_tasks: BackgroundTasks,
    description: str = Form(...),
    files: Optional[List[UploadFile]] = File(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    subtask_workflow.lock_workflow_rows(db, task.id)
    subtask = _fetch_task_subtask_or_404(task, subtask_id)
    if not _can_submit_subtask_completion(task, subtask, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subtask completion is not allowed")
    if subtask.status in {models.SubtaskStatusEnum.WAITING, models.SubtaskStatusEnum.DONE}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subtask is not actionable")
    if subtask.status == models.SubtaskStatusEnum.IN_REVIEW:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subtask is already awaiting review")

    cleaned_description, word_count = subtask_completion.normalize_description(description)
    approval_required = subtask_completion.approval_required_for(task)
    pending = db.execute(
        select(models.CompletionSubmission.id)
        .where(models.CompletionSubmission.task_id == task.id)
        .where(models.CompletionSubmission.subtask_id == subtask.id)
        .where(models.CompletionSubmission.status == models.CompletionSubmissionStatusEnum.PENDING_REVIEW)
    ).scalar_one_or_none()
    if pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A completion submission is already pending review")

    attempt_number = (
        db.execute(
            select(func.count(models.CompletionSubmission.id))
            .where(models.CompletionSubmission.task_id == task.id)
            .where(models.CompletionSubmission.subtask_id == subtask.id)
        ).scalar_one()
        or 0
    ) + 1
    submission = models.CompletionSubmission(
        id=models.generate_uuid(),
        tenant_id=current_user.tenant_id,
        task_id=task.id,
        subtask_id=subtask.id,
        submitted_by_id=current_user.id,
        description=cleaned_description,
        description_word_count=word_count,
        status=(
            models.CompletionSubmissionStatusEnum.PENDING_REVIEW
            if approval_required
            else models.CompletionSubmissionStatusEnum.COMPLETED
        ),
        approval_required=approval_required,
        attempt_number=attempt_number,
    )
    target_status = models.SubtaskStatusEnum.IN_REVIEW if approval_required else models.SubtaskStatusEnum.DONE
    stored_attachments: list[subtask_completion.StoredCompletionAttachment] = []
    try:
        workflow_result = subtask_workflow.transition_subtask(
            db,
            task,
            subtask_id=subtask.id,
            actor=current_user,
            target_status=target_status,
            can_override=_can_override_subtask_workflow(task, current_user),
        )
        db.add(submission)
        db.flush()

        stored_attachments = subtask_completion.store_attachments(
            tenant_id=current_user.tenant_id,
            submission_id=submission.id,
            uploads=files or [],
        )
        for stored in stored_attachments:
            db.add(
                models.CompletionAttachment(
                    tenant_id=current_user.tenant_id,
                    submission_id=submission.id,
                    original_filename=stored.original_filename,
                    mime_type=stored.mime_type,
                    file_size=stored.file_size,
                    storage_key=stored.storage_key,
                    checksum_sha256=stored.checksum_sha256,
                )
            )
        subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        subtask_completion.delete_stored_attachments(stored_attachments)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A completion submission is already pending review") from exc
    except Exception:
        db.rollback()
        subtask_completion.delete_stored_attachments(stored_attachments)
        raise
    _invalidate_task_cache(current_user, action="subtask_completion_submitted", task_id=task.id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    _finish_subtask_parent_completion(db, task.id, workflow_result, background_tasks)

    updated_task = _fetch_task_or_404(db, task.id)
    status_title_map = _status_title_map(db)
    serialized_task = _serialize_task(updated_task, status_title_map, viewer=current_user)
    background_tasks.add_task(
        trigger_n8n_event,
        "task.subtask_completion_submitted",
        {
            "taskId": updated_task.id,
            "subtaskId": subtask.id,
            "submissionId": submission.id,
            "approvalRequired": approval_required,
        },
    )
    return serialized_task


@router.post(
    "/{task_id}/subtasks/{subtask_id}/completion-submissions/{submission_id}/approve",
    response_model=schemas.TaskRead,
)
def approve_subtask_completion(
    task_id: str,
    subtask_id: str,
    submission_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    _ensure_can_review_subtask_completion(task, current_user)
    with _completion_review_lock(submission_id):
        reviewed_at = datetime.utcnow()
        claimed = db.execute(
            update(models.CompletionSubmission)
            .where(models.CompletionSubmission.id == submission_id)
            .where(models.CompletionSubmission.task_id == task.id)
            .where(models.CompletionSubmission.subtask_id == subtask_id)
            .where(models.CompletionSubmission.status == models.CompletionSubmissionStatusEnum.PENDING_REVIEW)
            .values(
                status=models.CompletionSubmissionStatusEnum.APPROVED,
                reviewed_by_id=current_user.id,
                reviewed_at=reviewed_at,
            )
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completion submission is not pending review")
        try:
            workflow_result = subtask_workflow.transition_subtask(
                db,
                task,
                subtask_id=subtask_id,
                actor=current_user,
                target_status=models.SubtaskStatusEnum.DONE,
                can_override=True,
                completion_reviewed=True,
                completed_by_id=db.get(models.CompletionSubmission, submission_id).submitted_by_id,
            )
            reviewed_subtask = db.get(models.Subtask, subtask_id)
            if reviewed_subtask:
                subtask_notifications.enqueue_review_decision_notification(
                    db,
                    task=task,
                    subtask=reviewed_subtask,
                    submission_id=submission_id,
                    approved=True,
                    actor_id=current_user.id,
                )
            subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
            db.commit()
        except Exception:
            db.rollback()
            raise
    _invalidate_task_cache(current_user, action="subtask_completion_approved", task_id=task.id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)
    _finish_subtask_parent_completion(db, task.id, workflow_result, background_tasks)

    updated_task = _fetch_task_or_404(db, task.id)
    serialized_task = _serialize_task(updated_task, _status_title_map(db), viewer=current_user)
    background_tasks.add_task(
        trigger_n8n_event,
        "task.subtask_completion_approved",
        {"taskId": task.id, "subtaskId": subtask_id, "submissionId": submission_id},
    )
    return serialized_task


@router.post(
    "/{task_id}/subtasks/{subtask_id}/completion-submissions/{submission_id}/reject",
    response_model=schemas.TaskRead,
)
def reject_subtask_completion(
    task_id: str,
    subtask_id: str,
    submission_id: str,
    payload: schemas.CompletionSubmissionReject,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TaskRead:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    _ensure_can_review_subtask_completion(task, current_user)
    with _completion_review_lock(submission_id):
        reviewed_at = datetime.utcnow()
        claimed = db.execute(
            update(models.CompletionSubmission)
            .where(models.CompletionSubmission.id == submission_id)
            .where(models.CompletionSubmission.task_id == task.id)
            .where(models.CompletionSubmission.subtask_id == subtask_id)
            .where(models.CompletionSubmission.status == models.CompletionSubmissionStatusEnum.PENDING_REVIEW)
            .values(
                status=models.CompletionSubmissionStatusEnum.REJECTED,
                reviewed_by_id=current_user.id,
                reviewed_at=reviewed_at,
                review_reason=payload.review_reason,
            )
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completion submission is not pending review")
        try:
            workflow_result = subtask_workflow.transition_subtask(
                db,
                task,
                subtask_id=subtask_id,
                actor=current_user,
                target_status=models.SubtaskStatusEnum.TODO,
                can_override=True,
                completion_reviewed=True,
            )
            reviewed_subtask = db.get(models.Subtask, subtask_id)
            if reviewed_subtask:
                subtask_notifications.enqueue_review_decision_notification(
                    db,
                    task=task,
                    subtask=reviewed_subtask,
                    submission_id=submission_id,
                    approved=False,
                    actor_id=current_user.id,
                )
            subtask_notifications.enqueue_workflow_notifications(db, task=task, events=workflow_result.domain_events)
            db.commit()
        except Exception:
            db.rollback()
            raise
    _invalidate_task_cache(current_user, action="subtask_completion_rejected", task_id=task.id)
    _publish_subtask_workflow_events(current_user, workflow_result.domain_events)
    _schedule_notification_outbox_delivery(background_tasks)

    updated_task = _fetch_task_or_404(db, task.id)
    serialized_task = _serialize_task(updated_task, _status_title_map(db), viewer=current_user)
    background_tasks.add_task(
        trigger_n8n_event,
        "task.subtask_completion_rejected",
        {"taskId": task.id, "subtaskId": subtask_id, "submissionId": submission_id},
    )
    return serialized_task


@router.get(
    "/{task_id}/subtasks/{subtask_id}/completion-submissions/{submission_id}/attachments/{attachment_id}/download",
)
def download_subtask_completion_attachment(
    task_id: str,
    subtask_id: str,
    submission_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> FileResponse:
    task = _fetch_task_or_404(db, task_id)
    _ensure_task_access(task, current_user)
    subtask = _fetch_task_subtask_or_404(task, subtask_id)
    _ensure_completion_attachment_access(task, subtask, current_user)
    submission = _fetch_completion_submission_or_404(db, task_id=task.id, subtask_id=subtask_id, submission_id=submission_id)
    attachment = next((item for item in submission.attachments if item.id == attachment_id), None)
    if (submission.tenant_id != current_user.tenant_id or not attachment
            or attachment.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    path = subtask_completion.resolve_storage_path(attachment.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return FileResponse(
        path,
        media_type=attachment.mime_type,
        filename=attachment.original_filename,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
