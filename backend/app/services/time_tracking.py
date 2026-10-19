from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only, selectinload

from .. import models, schemas
from ..lifecycle.context import bind_actor
from .task_access import task_belongs_to_user_tenant, task_tenant_predicate


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
            load_only(models.Task.id, models.Task.created_by_id, models.Task.assigned_to_id,
                      models.Task.project_id, models.Task.status, models.Task.created_at),
            selectinload(models.Task.project).selectinload(models.Project.members),
            selectinload(models.Task.subtasks).load_only(
                models.Subtask.id, models.Subtask.task_id, models.Subtask.status, models.Subtask.assigned_to_id),
            selectinload(models.Task.followers).load_only(models.User.id),
            selectinload(models.Task.assignee).load_only(models.User.id, models.User.department_id),
            selectinload(models.Task.creator).load_only(models.User.id, models.User.tenant_id),
        )
    )


def _get_task(db: Session, task_id: str, *, actor: models.User, lock: bool = False) -> models.Task:
    query = _task_query().where(models.Task.id == task_id, task_tenant_predicate(actor))
    if lock:
        db.flush()
        query = query.with_for_update(read=True, of=models.Task).execution_options(populate_existing=True)
    task = db.execute(query).unique().scalars().first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


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
    if not task_belongs_to_user_tenant(task, user):
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


def _entry_for_update(db: Session, entry_id: str, tenant_id) -> Optional[models.TimeEntry]:
    return (
        db.execute(
            select(models.TimeEntry)
            .where(models.TimeEntry.id == entry_id, models.TimeEntry.tenant_id == tenant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        .scalars()
        .first()
    )


def get_active_timer(db: Session, user: models.User) -> Optional[models.TimeEntry]:
    return _active_entry(db, user)


def _lock_timer_user(db: Session, tenant_id, user_id: str) -> None:
    # A timer-only lock avoids inversion with task completion's task -> XP-user locks.
    if db.get_bind().dialect.name == "sqlite":
        # SQLite has no row locks. Acquire its writer lock without changing user metadata.
        db.execute(text("UPDATE users SET id=id WHERE id=:id"), {"id": user_id})
    else:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                   {"key": f"zeaplay:timer:{user_id}"})
    found = db.scalar(select(models.User.id).where(
        models.User.id == user_id, models.User.tenant_id == tenant_id))
    if found is None:
        raise HTTPException(status_code=404, detail="Timer user not found")
    other_tenant_timer = db.scalar(select(models.TimeEntry.id).where(
        models.TimeEntry.user_id == user_id, models.TimeEntry.tenant_id != tenant_id,
        models.TimeEntry.stopped_at.is_(None)).limit(1))
    if other_tenant_timer is not None:
        raise HTTPException(status_code=409, detail="A timer from a previous tenant must be resolved before tracking work")


def _continuation(db: Session, actor: models.User, source_id: str, *, task_id, subtask_id) -> Optional[models.TimeEntry]:
    entry = db.scalar(select(models.TimeEntry).where(
        models.TimeEntry.continued_from_id == source_id,
        models.TimeEntry.tenant_id == actor.tenant_id, models.TimeEntry.user_id == actor.id))
    if entry and not _target_matches(entry, task_id=task_id, subtask_id=subtask_id):
        raise HTTPException(status_code=409, detail="Invalid timer continuation")
    return entry


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
        task = _get_task(db, task_id, actor=actor, lock=True)
        ensure_task_visible(task, actor)
        if task.status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot start a timer for a terminal task")
        return task, None

    root_id = db.scalar(select(models.Subtask.task_id).join(models.Task, models.Task.id == models.Subtask.task_id)
        .where(models.Subtask.id == subtask_id, task_tenant_predicate(actor)))
    if root_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    task = _get_task(db, root_id, actor=actor, lock=True)
    subtask = db.scalar(select(models.Subtask).where(
        models.Subtask.id == subtask_id, models.Subtask.task_id == task.id)
        .with_for_update(read=True).execution_options(populate_existing=True))
    if subtask is None:
        raise HTTPException(status_code=404, detail="Subtask not found")
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
    task_id = db.scalar(select(models.Subtask.task_id).where(models.Subtask.id == entry.subtask_id))
    if task_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    return task_id


def _overlapping_entry_exists(
    db: Session,
    *,
    user_id: str,
    tenant_id: object,
    started_at: datetime,
    stopped_at: datetime,
    exclude_entry_id: Optional[str] = None,
) -> bool:
    stmt = (
        select(models.TimeEntry.id)
        .where(models.TimeEntry.tenant_id == tenant_id)
        .where(models.TimeEntry.user_id == user_id)
        .where(models.TimeEntry.started_at < stopped_at)
        .where(or_(models.TimeEntry.stopped_at.is_(None), models.TimeEntry.stopped_at > started_at))
    )
    if exclude_entry_id:
        stmt = stmt.where(models.TimeEntry.id != exclude_entry_id)
    return db.execute(stmt.limit(1)).scalar_one_or_none() is not None


def start_timer(
    db: Session,
    actor: models.User,
    payload: schemas.TimeEntryStart,
    *,
    continued_from_id: Optional[str] = None,
    start_kind: Optional[str] = None,
) -> models.TimeEntry:
    bind_actor(db, actor)
    _lock_timer_user(db, actor.tenant_id, actor.id)
    task, subtask = _resolve_target(db, actor, task_id=payload.task_id, subtask_id=payload.subtask_id)
    if continued_from_id:
        previous = _continuation(db, actor, continued_from_id, task_id=payload.task_id, subtask_id=payload.subtask_id)
        if previous:
            return previous
    active = _active_entry(db, actor)
    target_task_id = task.id if subtask is None else None
    target_subtask_id = subtask.id if subtask is not None else None
    if active:
        if not continued_from_id and _target_matches(active, task_id=target_task_id, subtask_id=target_subtask_id):
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
        continued_from_id=continued_from_id,
        start_kind=start_kind,
    )
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if continued_from_id:
            previous = _continuation(db, actor, continued_from_id, task_id=payload.task_id, subtask_id=payload.subtask_id)
            if previous:
                return previous
        active = _active_entry(db, actor)
        if not continued_from_id and active and _target_matches(active, task_id=target_task_id, subtask_id=target_subtask_id):
            return active
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already has an active timer")
    db.refresh(entry)
    return entry


def stop_timer(
    db: Session,
    actor: models.User,
    *,
    entry_id: Optional[str] = None,
    reason: str = "stopped",
    commit: bool = True,
) -> Optional[models.TimeEntry]:
    bind_actor(db, actor)
    _lock_timer_user(db, actor.tenant_id, actor.id)
    entry = _entry_for_update(db, entry_id, actor.tenant_id) if entry_id else _active_entry(db, actor)
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
    # Conditional write also makes concurrent SQLite/retry stops a single event.
    result = db.execute(update(models.TimeEntry).where(models.TimeEntry.id == entry.id)
        .where(models.TimeEntry.stopped_at.is_(None)).values(
            stopped_at=stopped_at,
            duration_seconds=_duration_seconds(entry.started_at, stopped_at),
            status=models.TimeEntryStatusEnum.STOPPED, stop_reason=reason,
        ).execution_options(synchronize_session=False))
    db.refresh(entry)
    # A conditional Core write bypasses after_flush; retain the existing task outbox contract.
    from ..realtime.contracts import durable_enabled
    if result.rowcount and durable_enabled("task"):
        from ..realtime.capture import describe
        from ..realtime.outbox import enqueue
        envelope = describe(db, entry, db.connection())
        if envelope:
            enqueue(db.connection(), envelope)
    if commit:
        db.commit()
    db.refresh(entry)
    return entry


def resume_timer(db: Session, actor: models.User, entry_id: str, *, restart: bool = False) -> models.TimeEntry:
    bind_actor(db, actor)
    _lock_timer_user(db, actor.tenant_id, actor.id)
    source = db.scalar(select(models.TimeEntry).where(models.TimeEntry.id == entry_id, models.TimeEntry.tenant_id == actor.tenant_id))
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if source.tenant_id != actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if source.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot resume another user's timer")
    _resolve_target(db, actor, task_id=source.task_id, subtask_id=source.subtask_id)
    source = _entry_for_update(db, entry_id, actor.tenant_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Time entry not found")
    previous = _continuation(db, actor, source.id, task_id=source.task_id, subtask_id=source.subtask_id)
    if previous:
        return previous
    if source.stopped_at is None:
        if not restart:
            return source
        stop_timer(db, actor, entry_id=source.id, reason="restarted", commit=False)
    return start_timer(db, actor,
        schemas.TimeEntryStart(task_id=source.task_id, subtask_id=source.subtask_id, note=source.note),
        continued_from_id=source.id, start_kind="restarted" if restart else "resumed")


def correct_time_entry(
    db: Session,
    actor: models.User,
    entry_id: str,
    payload: schemas.TimeEntryCorrection,
) -> models.TimeEntry:
    bind_actor(db, actor)
    entry = db.scalar(select(models.TimeEntry).where(models.TimeEntry.id == entry_id, models.TimeEntry.tenant_id == actor.tenant_id))
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    if entry.tenant_id != actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time entry not found")
    root_task = _get_task(db, _entry_root_task_id(db, entry), actor=actor)
    ensure_task_visible(root_task, actor)
    if not can_manage_timer_corrections(root_task, actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Timer correction requires manager access")
    _lock_timer_user(db, entry.tenant_id, entry.user_id)
    entry = _entry_for_update(db, entry_id, actor.tenant_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Time entry not found")
    if entry.stopped_at is None:
        raise HTTPException(status_code=409, detail="Stop the timer before correcting it")
    corrected_started_at = _as_utc(payload.started_at)
    corrected_stopped_at = _as_utc(payload.stopped_at)
    if corrected_stopped_at <= corrected_started_at:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Correction stop time must be after start time")
    if _overlapping_entry_exists(
        db,
        user_id=entry.user_id,
        tenant_id=entry.tenant_id,
        started_at=corrected_started_at,
        stopped_at=corrected_stopped_at,
        exclude_entry_id=entry.id,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Corrected timer overlaps existing task work")
    if corrected_stopped_at > _as_utc(utc_now()):
        raise HTTPException(status_code=422, detail="Correction cannot record work in the future")

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
