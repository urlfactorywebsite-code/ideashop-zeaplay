"""Union effective UTC intervals, never sum browser durations or assume old statuses."""
from collections import defaultdict
from datetime import timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import load_only

from .. import models
from .contracts import TimeMetrics


MAX_ANALYTICS_SESSIONS = 50000


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _union_duration(intervals):
    total = timedelta()
    start = end = None
    for left, right in sorted(intervals):
        if right <= left:
            continue
        if end is None:
            start, end = left, right
        elif left <= end:
            end = max(end, right)
        else:
            total += end - start
            start, end = left, right
    if end is not None:
        total += end - start
    return total


def union_seconds(intervals):
    return _union_duration(intervals) // timedelta(seconds=1)


def metrics(entries, as_of):
    as_of = utc(as_of)
    intervals = []
    by_user = defaultdict(list)
    raw = timedelta()
    active = 0
    for entry in entries:
        left = utc(entry.started_at)
        right = min(utc(entry.stopped_at) if entry.stopped_at else as_of, as_of)
        active += entry.stopped_at is None
        if right <= left:
            continue
        intervals.append((left, right))
        by_user[entry.user_id].append((left, right))
        raw += right - left
    return TimeMetrics(session_count=len(entries), active_session_count=active,
                       raw_session_seconds=raw // timedelta(seconds=1),
                       person_seconds=sum((_union_duration(rows) for rows in by_user.values()), timedelta()) // timedelta(seconds=1),
                       elapsed_seconds=union_seconds(intervals))


def entries_for_task(db, task, tenant_id):
    children = select(models.Subtask.id).where(models.Subtask.task_id == task.id)
    entries = list(db.scalars(select(models.TimeEntry).options(load_only(
        models.TimeEntry.id, models.TimeEntry.user_id, models.TimeEntry.task_id, models.TimeEntry.subtask_id,
        models.TimeEntry.started_at, models.TimeEntry.stopped_at,
    )).where(
        models.TimeEntry.tenant_id == tenant_id,
        or_(models.TimeEntry.task_id == task.id, models.TimeEntry.subtask_id.in_(children)),
    ).order_by(models.TimeEntry.started_at, models.TimeEntry.id).limit(MAX_ANALYTICS_SESSIONS + 1)))
    if len(entries) > MAX_ANALYTICS_SESSIONS:
        raise HTTPException(422, "Task exceeds the synchronous analytics session limit; no partial totals returned")
    return entries
