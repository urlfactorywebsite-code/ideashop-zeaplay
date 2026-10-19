from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import exists, or_, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError, ProgrammingError

from .. import models, schemas
from ..database import get_db
from ..auth import oauth2_scheme
from ..dependencies import _decode_access_token, get_current_active_user
from ..lifecycle.analytics import entries_for_task, metrics, utc
from ..lifecycle.contracts import (
    LifecycleEventRead, SubtaskTimeMetrics, TaskAnalyticsRead, TaskJourneyRead, TaskSessionsRead,
)
from ..lifecycle.report import build_report, people, person
from ..lifecycle.report_contracts import CompletionPage, EvidencePage, ExecutionReport, ReportCompletion
from ..lifecycle.report_evidence import completion_evidence, evidence_response, linked_evidence
from ..services.time_tracking import _get_task

router = APIRouter()


def lifecycle_read_db(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme), response: Response = None):
    _decode_access_token(token)
    if response is not None:
        response.headers["Cache-Control"] = "private, no-store"
    # Establish the snapshot before the shared authentication dependency queries users.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        clock = "clock_timestamp()"
    else:
        db.execute(text("BEGIN"))
        clock = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    try:
        as_of = db.scalar(text(f"SELECT {clock} FROM task_lifecycle_coverage WHERE id=1"))
    except (OperationalError, ProgrammingError) as exc:
        code = getattr(exc.orig, "pgcode", None)
        if code == "42P01" or "no such table: task_lifecycle_coverage" in str(exc.orig):
            raise HTTPException(503, "Task lifecycle migration is not installed") from None
        raise
    if as_of is None:
        raise HTTPException(503, "Task lifecycle migration is not installed")
    if isinstance(as_of, str):
        as_of = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    db.info["lifecycle_as_of"] = (datetime.now(timezone.utc) if db.get_bind().dialect.name == "sqlite" else utc(as_of))
    return db


def _authorized(db, task_id, user):
    # Use the task API policy, including department-manager and legacy-task access.
    from .tasks import _ensure_task_access
    task = _get_task(db, task_id, actor=user)
    _ensure_task_access(task, user)
    return task


def _coverage(db, task, user):
    coverage = db.get(models.TaskLifecycleCoverage, 1)
    if coverage is None:
        raise HTTPException(503, "Task lifecycle migration is not installed")
    creation = db.scalar(select(models.TaskLifecycleEvent).where(
        models.TaskLifecycleEvent.tenant_id == user.tenant_id,
        models.TaskLifecycleEvent.task_id == task.id,
        models.TaskLifecycleEvent.event_type == "task.created").order_by(models.TaskLifecycleEvent.id).limit(1))
    started = utc(coverage.started_at)
    now = datetime.now(timezone.utc)
    if creation is None:
        return started, False
    stored_time = creation.details.get("stored_created_at")
    if not isinstance(stored_time, str):
        return started, False
    try:
        original_time = utc(datetime.fromisoformat(stored_time.replace("Z", "+00:00")))
    except ValueError:
        return started, False
    # Compare the application-generated creation time with the application clock;
    # SQLite's trigger clock can have coarser resolution than datetime.now().
    if (not started <= original_time <= now
            or original_time != utc(task.created_at)
            or creation.details.get("creator_id") != task.created_by_id):
        return started, False

    child_created = exists(select(models.TaskLifecycleEvent.id).where(
        models.TaskLifecycleEvent.tenant_id == user.tenant_id,
        models.TaskLifecycleEvent.task_id == task.id,
        models.TaskLifecycleEvent.subtask_id == models.Subtask.id,
        models.TaskLifecycleEvent.event_type == "subtask.created")).correlate(models.Subtask)
    missing_child = exists(select(models.Subtask.id).where(models.Subtask.task_id == task.id, ~child_created))
    session_started = exists(select(models.TaskLifecycleEvent.id).where(
        models.TaskLifecycleEvent.tenant_id == user.tenant_id,
        models.TaskLifecycleEvent.task_id == task.id,
        models.TaskLifecycleEvent.time_entry_id == models.TimeEntry.id,
        models.TaskLifecycleEvent.event_type.in_(["timer.started", "timer.resumed", "timer.restarted"]),
    )).correlate(models.TimeEntry)
    children = select(models.Subtask.id).where(models.Subtask.task_id == task.id)
    missing_session = exists(select(models.TimeEntry.id).where(
        models.TimeEntry.tenant_id == user.tenant_id,
        or_(models.TimeEntry.task_id == task.id, models.TimeEntry.subtask_id.in_(children)),
        or_(models.TimeEntry.started_at < coverage.started_at,
            models.TimeEntry.original_started_at < coverage.started_at,
            models.TimeEntry.started_at > now,
            models.TimeEntry.stopped_at > now, ~session_started),
    ))
    return started, not db.scalar(select(or_(missing_child, missing_session)))


def _event_details(details):
    result = dict(details)
    for key, value in result.items():
        if key.endswith("_at") and isinstance(value, str):
            result[key] = utc(datetime.fromisoformat(value.replace("Z", "+00:00"))).isoformat().replace("+00:00", "Z")
    return result


@router.get("/{task_id}/journey", response_model=TaskJourneyRead)
def task_journey(
    task_id: str,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(lifecycle_read_db),
    current_user: models.User = Depends(get_current_active_user),
):
    task = _authorized(db, task_id, current_user)
    started, complete = _coverage(db, task, current_user)
    events = list(db.scalars(select(models.TaskLifecycleEvent).where(
        models.TaskLifecycleEvent.tenant_id == current_user.tenant_id,
        models.TaskLifecycleEvent.task_id == task.id,
        models.TaskLifecycleEvent.id > after_id,
    ).order_by(models.TaskLifecycleEvent.id).limit(limit + 1)))
    return TaskJourneyRead(task_id=task.id, created_by_id=task.created_by_id, created_at=utc(task.created_at),
        status=task.status, subtasks=[{"id": row.id, "status": row.status} for row in task.subtasks],
        capture_started_at=started, history_complete=complete,
        items=[LifecycleEventRead(id=row.id, task_id=row.task_id, subtask_id=row.subtask_id,
            time_entry_id=row.time_entry_id, event_type=row.event_type, previous_status=row.previous_status,
            new_status=row.new_status, actor_id=row.actor_id, occurred_at=utc(row.occurred_at),
            recorded_at=utc(row.recorded_at), details=_event_details(row.details)) for row in events[:limit]],
        next_after_id=events[limit - 1].id if len(events) > limit else None)


@router.get("/{task_id}/analytics", response_model=TaskAnalyticsRead)
def task_analytics(
    task_id: str,
    db: Session = Depends(lifecycle_read_db),
    current_user: models.User = Depends(get_current_active_user),
):
    task = _authorized(db, task_id, current_user)
    as_of = db.info.get("lifecycle_as_of") or datetime.now(timezone.utc)
    started, complete = _coverage(db, task, current_user)
    entries = entries_for_task(db, task, current_user.tenant_id)
    parent = [row for row in entries if row.task_id is not None]
    children = [row for row in entries if row.subtask_id is not None]
    by_subtask = {}
    for row in children:
        by_subtask.setdefault(row.subtask_id, []).append(row)
    return TaskAnalyticsRead(task_id=task.id, status=task.status, as_of=as_of,
        parent=metrics(parent, as_of), children=metrics(children, as_of), aggregate=metrics(entries, as_of),
        subtasks=[SubtaskTimeMetrics(subtask_id=row.id, status=row.status,
            **metrics(by_subtask.get(row.id, []), as_of).model_dump()) for row in task.subtasks],
        history_complete=complete, capture_started_at=started)


@router.get("/{task_id}/execution-sessions", response_model=TaskSessionsRead)
def execution_sessions(
    task_id: str,
    after_id: str = Query("", max_length=36),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(lifecycle_read_db),
    current_user: models.User = Depends(get_current_active_user),
):
    task = _authorized(db, task_id, current_user)
    children = select(models.Subtask.id).where(models.Subtask.task_id == task.id)
    rows = list(db.scalars(select(models.TimeEntry).where(
        models.TimeEntry.tenant_id == current_user.tenant_id,
        or_(models.TimeEntry.task_id == task.id, models.TimeEntry.subtask_id.in_(children)),
        models.TimeEntry.id > after_id,
    ).order_by(models.TimeEntry.id).limit(limit + 1)))
    return TaskSessionsRead(task_id=task.id, items=[schemas.TimeEntryRead.model_validate(row) for row in rows[:limit]],
                            next_after_id=rows[limit - 1].id if len(rows) > limit else None)


@router.get("/{task_id}/execution-report", response_model=ExecutionReport)
def execution_report(task_id: str, db: Session = Depends(lifecycle_read_db),
                     current_user: models.User = Depends(get_current_active_user)):
    task = _authorized(db, task_id, current_user)
    return build_report(db, task, current_user, db.info["lifecycle_as_of"], _coverage(db, task, current_user))


@router.get("/{task_id}/execution-report/completions", response_model=CompletionPage)
def report_completions(task_id: str, after_id: str = Query("", max_length=36),
                       limit: int = Query(24, ge=1, le=100), db: Session = Depends(lifecycle_read_db),
                       current_user: models.User = Depends(get_current_active_user)):
    task = _authorized(db, task_id, current_user)
    s = models.CompletionSubmission
    statement = select(s).where(s.tenant_id == current_user.tenant_id, s.task_id == task.id,
        s.subtask_id.in_(select(models.Subtask.id).where(models.Subtask.task_id == task.id)))
    if after_id:
        cursor = db.scalar(statement.where(s.id == after_id))
        if cursor is None:
            raise HTTPException(409, "Completion history changed; refresh the report")
        statement = statement.where(or_(s.created_at > cursor.created_at,
            (s.created_at == cursor.created_at) & (s.id > cursor.id)))
    rows = list(db.scalars(statement.order_by(s.created_at, s.id).limit(limit + 1)))
    names = people(db, [value for row in rows[:limit] for value in (row.submitted_by_id, row.reviewed_by_id)], current_user.tenant_id)
    return CompletionPage(items=[ReportCompletion(id=row.id, task_id=row.task_id, subtask_id=row.subtask_id,
        attempt_number=row.attempt_number, description=row.description, status=row.status.value,
        approval_required=row.approval_required, submitted_by=person(row.submitted_by_id, names),
        created_at=utc(row.created_at), reviewed_by=person(row.reviewed_by_id, names),
        reviewed_at=utc(row.reviewed_at) if row.reviewed_at else None, review_reason=row.review_reason)
        for row in rows[:limit]], next_after_id=rows[limit - 1].id if len(rows) > limit else None)


@router.get("/{task_id}/execution-report/evidence", response_model=EvidencePage)
def report_evidence(task_id: str, source: str = Query("completion", pattern="^(completion|linked)$"),
                    after_id: str = Query("", max_length=36), limit: int = Query(24, ge=1, le=100),
                    db: Session = Depends(lifecycle_read_db), current_user: models.User = Depends(get_current_active_user)):
    task = _authorized(db, task_id, current_user)
    loader = completion_evidence if source == "completion" else linked_evidence
    return loader(db, task, current_user, after_id, limit)


@router.get("/{task_id}/execution-report/evidence/{source}/{evidence_id}")
def report_evidence_file(task_id: str, evidence_id: str,
                        source: str = Path(..., pattern="^(completion|media|media_file)$"),
                        preview: bool = False, db: Session = Depends(lifecycle_read_db),
                        current_user: models.User = Depends(get_current_active_user)):
    task = _authorized(db, task_id, current_user)
    return evidence_response(db, task, current_user, source, evidence_id, preview)
