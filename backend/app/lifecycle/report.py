"""Aggregate retained executions without inferring legacy dates or rewriting history."""
from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import load_only

from .. import models
from .analytics import MAX_ANALYTICS_SESSIONS, _union_duration, metrics, utc
from .report_contracts import ExecutionEntity, ExecutionReport, ReportPerson


def people(db, ids, tenant_id):
    ids = {value for value in ids if value}
    return dict(db.execute(select(models.User.id, models.User.name).where(
        models.User.tenant_id == tenant_id, models.User.id.in_(ids))).all()) if ids else {}


def person(identifier, names):
    return ReportPerson(id=identifier, name=names.get(identifier)) if identifier else None


def paused_gaps(entries, as_of):
    """Only an explicit, valid continuation proves when a pause ended."""
    by_id = {row.id: row for row in entries}
    continued = {}
    for row in entries:
        source = by_id.get(row.continued_from_id)
        if (source and source.user_id == row.user_id and source.task_id == row.task_id
                and source.subtask_id == row.subtask_id and row.start_kind in {"resumed", "restarted"}):
            continued[source.id] = row
    intervals = defaultdict(list)
    unresolved = 0
    for row in entries:
        if row.stop_reason != "paused":
            continue
        successor = continued.get(row.id)
        if (not row.stopped_at or not successor or utc(successor.started_at) < utc(row.stopped_at)
                or utc(successor.started_at) > as_of):
            unresolved += 1
            continue
        intervals[row.user_id].append((utc(row.stopped_at), utc(successor.started_at)))
    # Pauses are person-time, not user idle time; different people may pause in parallel.
    return sum((_union_duration(value) for value in intervals.values()), timedelta()) // timedelta(seconds=1), unresolved


def build_report(db, task, user, as_of, coverage):
    from fastapi import HTTPException
    from ..services.gamification import COMPLETED_STATUSES
    db.refresh(task, attribute_names=["title", "completed_at"])
    events = models.TaskLifecycleEvent
    condition = (events.tenant_id == user.tenant_id, events.task_id == task.id)
    grouped = list(db.execute(select(events.subtask_id, events.event_type, func.count()).where(*condition)
                              .group_by(events.subtask_id, events.event_type)))
    counts = defaultdict(Counter)
    for child, kind, count in grouped:
        counts[child][kind] = count
    completed_statuses = [status.value for status in COMPLETED_STATUSES]
    main = events.subtask_id.is_(None)
    child = events.subtask_id.is_not(None)
    current_complete = or_(main & events.new_status.in_(completed_statuses), child & (events.new_status == "DONE"))
    previous_complete = or_(main & events.previous_status.in_(completed_statuses), child & (events.previous_status == "DONE"))
    entered_completion = current_complete & (events.previous_status.is_(None) | ~previous_complete)
    reopened = previous_complete & ~current_complete
    bounds = list(db.execute(select(events.subtask_id,
        func.min(case((events.new_status == "IN_PROGRESS", events.id))),
        func.max(case((entered_completion, events.id))),
        func.sum(case((entered_completion, 1), else_=0)),
        func.sum(case((reopened, 1), else_=0)),
        func.max(case((reopened, events.id))),
    ).where(*condition, events.event_type.in_(["task.status_changed", "subtask.status_changed"]))
      .group_by(events.subtask_id)))
    stage_bounds = {row[0]: row[1:] for row in bounds}
    bound_ids = {identifier for row in bounds for identifier in row[1:3] if identifier is not None}
    bound_times = dict(db.execute(select(events.id, events.occurred_at).where(*condition, events.id.in_(bound_ids))).all()) if bound_ids else {}
    first_ids = select(func.min(events.id)).where(*condition, events.event_type == "subtask.created").group_by(events.subtask_id)
    creations = {row.subtask_id: row for row in db.scalars(select(events).where(events.id.in_(first_ids)))}
    children = list(db.scalars(select(models.Subtask).options(load_only(models.Subtask.id, models.Subtask.title,
        models.Subtask.status, models.Subtask.assigned_to_id)).where(models.Subtask.task_id == task.id)
        .order_by(models.Subtask.sort_order, models.Subtask.id)))
    child_map = {row.id: row for row in children}
    child_ids = select(models.Subtask.id).where(models.Subtask.task_id == task.id)
    entries = list(db.scalars(select(models.TimeEntry).options(load_only(
        models.TimeEntry.id, models.TimeEntry.user_id, models.TimeEntry.task_id, models.TimeEntry.subtask_id,
        models.TimeEntry.started_at, models.TimeEntry.stopped_at, models.TimeEntry.continued_from_id,
        models.TimeEntry.start_kind, models.TimeEntry.stop_reason,
    )).where(models.TimeEntry.tenant_id == user.tenant_id,
             (models.TimeEntry.task_id == task.id) | models.TimeEntry.subtask_id.in_(child_ids)).limit(MAX_ANALYTICS_SESSIONS + 1)))
    if len(entries) > MAX_ANALYTICS_SESSIONS:
        raise HTTPException(422, "Task exceeds the synchronous analytics session limit; no partial totals returned")
    buckets = defaultdict(list)
    for row in entries:
        buckets[row.subtask_id].append(row)
    names = people(db, [task.created_by_id, task.assigned_to_id,
                        *(row.assigned_to_id for row in children), *(row.actor_id for row in creations.values())], user.tenant_id)

    def entity(identifier):
        main = identifier is None
        child = child_map.get(identifier)
        creation = creations.get(identifier)
        first, last, completed, reopened, last_reopen = stage_bounds.get(identifier, (None, None, 0, 0, None))
        completion_in_cycle = last is not None and (last_reopen is None or last > last_reopen)
        first, last = bound_times.get(first), bound_times.get(last)
        rows = buckets[identifier]
        starts = [utc(row.started_at) for row in rows if utc(row.started_at) <= as_of]
        first_session = min(starts) if starts else None
        first_candidates = [utc(value) for value in (first, first_session) if value and utc(value) <= as_of]
        state = task.status.value if main else child.status.value if child else None
        stored_completion = task.completed_at if main else None
        last = utc(last) if last else None
        final = last if completion_in_cycle else (utc(stored_completion) if stored_completion and not last_reopen else None)
        if state not in completed_statuses or (final and final > as_of):
            final = None
        pause_seconds, unresolved = paused_gaps(rows, as_of)
        return ExecutionEntity(id=task.id if main else identifier, title=task.title if main else child.title if child else None,
            status=state, creator=person(task.created_by_id if main else creation.actor_id if creation else None, names),
            assignee=person(task.assigned_to_id if main else child.assigned_to_id if child else None, names),
            created_at=utc(task.created_at) if main else utc(creation.occurred_at) if creation else None,
            creation_source="task_record" if main else "captured_event" if creation else "not_recorded",
            first_started_at=min(first_candidates) if first_candidates else None, first_session_started_at=first_session,
            last_completed_at=last, final_completed_at=final, completion_count=completed or 0, reopened_count=reopened or 0,
            final_completion_source="captured_event" if final and last else "task_record" if final else "not_recorded",
            event_counts=dict(counts[identifier]), time=metrics(rows, as_of), linked_paused_seconds=pause_seconds,
            unresolved_pause_count=unresolved, deleted=not main and child is None)

    parent = buckets[None]
    child_entries = [row for row in entries if row.subtask_id]
    started, complete = coverage
    return ExecutionReport(task_id=task.id, as_of=as_of, history_complete=complete, capture_started_at=started,
        deleted_session_count=sum(value["timer.deleted"] for value in counts.values()), task=entity(None),
        subtasks=[entity(identifier) for identifier in [*child_map, *sorted({key for key in counts if key} - set(child_map))]],
        direct=metrics(parent, as_of), children=metrics(child_entries, as_of), aggregate=metrics(entries, as_of))
