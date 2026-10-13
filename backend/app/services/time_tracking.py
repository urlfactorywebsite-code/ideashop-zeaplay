from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas


TERMINAL_TASK_STATUSES = {
    models.TaskStatusEnum.DONE,
    models.TaskStatusEnum.DEPLOYED,
    models.TaskStatusEnum.FAILED,
    models.TaskStatusEnum.GRAVEYARD,
}

ACTIONABLE_SUBTASK_STATUSES = {
    models.SubtaskStatusEnum.TODO,
    models.SubtaskStatusEnum.IN_PROGRESS,
    models.SubtaskStatusEnum.BLOCKED,
    models.SubtaskStatusEnum.IN_REVIEW,
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _duration_seconds(started_at: datetime, stopped_at: datetime) -> int:
    started_at = _as_utc(started_at)
    stopped_at = _as_utc(stopped_at)
    return max(0, int((stopped_at - started_at).total_seconds()))


def _task_query() -> select:
    return (
        select(models.Task)
        .options(
            selectinload(models.Task.project).selectinload(models.Project.members),
            selectinload(models.Task.subtasks).selectinload(models.Subtask.assigned_user),
            selectinload(models.Task.followers),
            selectinload(models.Task.assignee),
            selectinload(models.Task.creator),
        )
    )


def _get_task(db: Session, task_id: str) -> models.Task:
    task = db.execute(_task_query().where(models.Task.id == task_id)).unique().scalars().first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _same_tenant(left: object, right: object) -> bool:
    return str(left) == str(right)


def _is_admin_or_owner(user: models.User) -> bool:
    return user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}


def _project_member_ids(project: models.Project) -> set[str]:
    return {member.user_id for member in project.members}


def _project_manager_ids(project: models.Project) -> set[str]:
    return {
        member.user_id
        for member in project.members
        if member.role == models.ProjectMemberRoleEnum.MANAGER
    }


def ensure_task_visible(task: models.Task, user: models.User) -> None:
    if task.project and not _same_tenant(task.project.tenant_id, user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not task.project and task.creator and not _same_tenant(task.creator.tenant_id, user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if _is_admin_or_owner(user):
        return
    if task.project and user.id in _project_member_ids(task.project):
        return
    if task.created_by_id == user.id or task.assigned_to_id == user.id:
        return
    if any(subtask.assigned_to_id == user.id for subtask in task.subtasks):
        return
    if any(follower.id == user.id for follower in task.followers):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for this timer target")


def can_manage_timer_corrections(task: models.Task, user: models.User) -> bool:
    if _is_admin_or_owner(user):
        return True
    if not task.project:
        return user.role == models.RoleEnum.MANAGER or task.created_by_id == user.id
    return user.role == models.RoleEnum.MANAGER and user.id in _project_manager_ids(task.project)


def _target_matches(entry: models.TimeEntry, *, task_id: Optional[str], subtask_id: Optional[str]) -> bool:
    return entry.task_id == task_id and entry.subtask_id == subtask_id


def _active_entry(db: Session, user: models.User) -> Optional[models.TimeEntry]:
    return (
        db.execute(
            select(models.TimeEntry)
            .where(models.TimeEntry.tenant_id == user.tenant_id)
            .where(models.TimeEntry.user_id == user.id)
            .where(models.TimeEntry.stopped_at.is_(None))
            .with_for_update()
        )
        .scalars()
        .first()
    )


def _entry_for_update(db: Session, entry_id: str) -> Optional[models.TimeEntry]:
    return (
        db.execute(
            select(models.TimeEntry)
            .where(models.TimeEntry.id == entry_id)
            .with_for_update()
        )
        .scalars()
        .first()
    )


def get_active_timer(db: Session, user: models.User) -> Optional[models.TimeEntry]:
    return _active_entry(db, user)


def _resolve_target(
    db: Session,
    actor: models.User,
    *,
    task_id: Optional[str],
    subtask_id: Optional[str],
) -> tuple[models.Task, Optional[models.Subtask]]:
    if bool(task_id) == bool(subtask_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Exactly one timer target is required")

    if task_id:
        task = _get_task(db, task_id)
        ensure_task_visible(task, actor)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot start a timer for a terminal task")
        return task, None

    subtask = db.execute(
        select(models.Subtask)
        .options(selectinload(models.Subtask.task).selectinload(models.Task.project).selectinload(models.Project.members))
        .options(selectinload(models.Subtask.task).selectinload(models.Task.followers))
        .options(selectinload(models.Subtask.task).selectinload(models.Task.subtasks))
        .where(models.Subtask.id == subtask_id)
    ).scalars().first()
    if not subtask:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    task = _get_task(db, subtask.task_id)
    ensure_task_visible(task, actor)
    if subtask.status not in ACTIONABLE_SUBTASK_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subtask must be active before time can be tracked",
        )
    if not (_is_admin_or_owner(actor) or actor.id == subtask.assigned_to_id or can_manage_timer_corrections(task, actor)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subtask timer requires assignment or manager access")
    return task, subtask


def _entry_root_task_id(db: Session, entry: models.TimeEntry) -> str:
    if entry.task_id:
        return entry.task_id
    subtask = db.get(models.Subtask, entry.subtask_id)
    if not subtask:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    return subtask.task_id


def _overlapping_entry_exists(
    db: Session,
    *,
    user_id: str,
    tenant_id: object,
    root_task_id: str,
    started_at: datetime,
    stopped_at: datetime,
    exclude_entry_id: Optional[str] = None,
) -> bool:
    task_subtask_ids = [row[0] for row in db.execute(select(models.Subtask.id).where(models.Subtask.task_id == root_task_id)).all()]
    stmt = (
        select(models.TimeEntry.id)
        .where(models.TimeEntry.tenant_id == tenant_id)
        .where(models.TimeEntry.user_id == user_id)
        .where(models.TimeEntry.stopped_at.is_not(None))
        .where(models.TimeEntry.started_at < stopped_at)
        .where(models.TimeEntry.stopped_at > started_at)
        .where(or_(models.TimeEntry.task_id == root_task_id, models.TimeEntry.subtask_id.in_(task_subtask_ids or ["__none__"])))
    )
    if exclude_entry_id:
        stmt = stmt.where(models.TimeEntry.id != exclude_entry_id)
    return db.execute(stmt.limit(1)).scalar_one_or_none() is not None


def start_timer(
    db: Session,
    actor: models.User,
    payload: schemas.TimeEntryStart,
) -> models.TimeEntry:
    task, subtask = _resolve_target(db, actor, task_id=payload.task_id, subtask_id=payload.subtask_id)
    active = _active_entry(db, actor)
    target_task_id = task.id if subtask is None else None
    target_subtask_id = subtask.id if subtask is not None else None
    if active:
        if _target_matches(active, task_id=target_task_id, subtask_id=target_subtask_id):
            return active
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already has an active timer")

    entry = models.TimeEntry(
        tenant_id=actor.tenant_id,
        user_id=actor.id,
        task_id=target_task_id,
        subtask_id=target_subtask_id,
        started_at=_as_utc(utc_now()),
        status=models.TimeEntryStatusEnum.ACTIVE,
        note=payload.note,
    )
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        active = _active_entry(db, actor)
        if active and _target_matches(active, task_id=target_task_id, subtask_id=target_subtask_id):
            return active
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already has an active timer")
    db.refresh(entry)
    return entry


def stop_timer(
    db: Session,
    actor: models.User,
    *,
    entry_id: Optional[str] = None,
) -> Optional[models.TimeEntry]:
    entry = _entry_for_update(db, entry_id) if entry_id else _active_entry(db, actor)
    if not entry:
        if entry_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
        return None
    if entry.tenant_id != actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if entry.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot stop another user's timer")
    if entry.stopped_at is not None:
        return entry
    stopped_at = _as_utc(utc_now())
    entry.stopped_at = stopped_at
    entry.duration_seconds = _duration_seconds(entry.started_at, stopped_at)
    entry.status = models.TimeEntryStatusEnum.STOPPED
    db.commit()
    db.refresh(entry)
    return entry


def resume_timer(db: Session, actor: models.User, entry_id: str) -> models.TimeEntry:
    source = db.get(models.TimeEntry, entry_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if source.tenant_id != actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if source.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot resume another user's timer")
    return start_timer(db, actor, schemas.TimeEntryStart(task_id=source.task_id, subtask_id=source.subtask_id, note=source.note))


def correct_time_entry(
    db: Session,
    actor: models.User,
    entry_id: str,
    payload: schemas.TimeEntryCorrection,
) -> models.TimeEntry:
    entry = db.get(models.TimeEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if entry.tenant_id != actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if entry.stopped_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Stop the timer before correcting it")
    root_task = _get_task(db, _entry_root_task_id(db, entry))
    ensure_task_visible(root_task, actor)
    if not can_manage_timer_corrections(root_task, actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Timer correction requires manager access")
    corrected_started_at = _as_utc(payload.started_at)
    corrected_stopped_at = _as_utc(payload.stopped_at)
    if corrected_stopped_at <= corrected_started_at:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Correction stop time must be after start time")
    if _overlapping_entry_exists(
        db,
        user_id=entry.user_id,
        tenant_id=entry.tenant_id,
        root_task_id=root_task.id,
        started_at=corrected_started_at,
        stopped_at=corrected_stopped_at,
        exclude_entry_id=entry.id,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Corrected timer overlaps existing task work")

    if entry.original_started_at is None:
        entry.original_started_at = entry.started_at
        entry.original_stopped_at = entry.stopped_at
        entry.original_duration_seconds = entry.duration_seconds
    entry.started_at = corrected_started_at
    entry.stopped_at = corrected_stopped_at
    entry.duration_seconds = _duration_seconds(corrected_started_at, corrected_stopped_at)
    entry.status = models.TimeEntryStatusEnum.CORRECTED
    entry.note = payload.note
    entry.correction_reason = payload.reason
    entry.corrected_by_id = actor.id
    entry.corrected_at = utc_now()
    db.add(
        models.AuditEvent(
            actor_id=actor.id,
            event_type="time_entry.corrected",
            entity_type="time_entry",
            entity_id=entry.id,
            payload={
                "reason": payload.reason,
                "original_started_at": entry.original_started_at.isoformat() if entry.original_started_at else None,
                "original_stopped_at": entry.original_stopped_at.isoformat() if entry.original_stopped_at else None,
                "original_duration_seconds": entry.original_duration_seconds,
                "duration_seconds": entry.duration_seconds,
            },
            created_at=utc_now(),
        )
    )
    db.commit()
    db.refresh(entry)
    return entry
