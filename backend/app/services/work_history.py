"""Session projections over the existing TimeEntry continuation/interval ledger.

Session IDs are the first interval's server ID. No second time ledger is maintained.
Date ranges select intersecting sessions; durations are clipped to [from, to).
"""
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import aliased

from .. import models
from . import time_tracking as timers
from .task_access import task_tenant_predicate


def chains(user):
    entry = models.TimeEntry
    parent = aliased(entry)
    scope = (entry.tenant_id == user.tenant_id, entry.user_id == user.id)
    roots = select(entry.id.label("root_id"), entry.id.label("entry_id")).where(*scope,
        ~exists(select(parent.id).where(parent.id == entry.continued_from_id,
            parent.tenant_id == user.tenant_id, parent.user_id == user.id))).cte("timer_chain", recursive=True)
    return roots.union_all(select(roots.c.root_id, entry.id).join(roots, entry.continued_from_id == roots.c.entry_id).where(*scope))


def _seconds(start, end):
    return max(0, (timers._as_utc(end) - timers._as_utc(start)).total_seconds())


def _clipped(start, end, lower, upper):
    start, end = timers._as_utc(start), timers._as_utc(end)
    return _seconds(max(start, lower) if lower else start, min(end, upper) if upper else end)


def read(db, user, *, active=False, session_id=None, lower=None, upper=None, search="", offset=0, limit=30):
    now = timers._as_utc(timers.utc_now())
    lower = timers._as_utc(lower) if lower else None
    upper = timers._as_utc(upper) if upper else None
    if lower and upper and lower >= upper:
        raise HTTPException(status_code=422, detail="Range end must be after range start")
    chain = chains(user)
    entry = models.TimeEntry
    child = aliased(entry)
    root = aliased(entry)
    leaf = ~exists(select(child.id).where(child.continued_from_id == entry.id,
        child.tenant_id == user.tenant_id, child.user_id == user.id))
    query = select(chain.c.root_id).join(entry, entry.id == chain.c.entry_id).join(root, root.id == chain.c.root_id).where(leaf)
    if active:
        query = query.where(or_(entry.stopped_at.is_(None),
            (entry.stop_reason == "paused") & entry.finalized_at.is_(None)))
    if session_id:
        query = query.where(root.id == session_id)
    if lower:
        query = query.where(or_(entry.stopped_at.is_(None),
            (entry.stop_reason == "paused") & entry.finalized_at.is_(None),
            func.coalesce(entry.finalized_at, entry.stopped_at) > lower))
    if upper:
        query = query.where(root.started_at < upper)
    if search:
        task = models.Task
        sub = models.Subtask
        query = query.outerjoin(sub, sub.id == root.subtask_id).join(task, task.id == func.coalesce(root.task_id, sub.task_id))
        term = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(or_(task.title.ilike(term, escape="\\"), sub.title.ilike(term, escape="\\")))
    ordering = (entry.stopped_at.is_(None).desc(), root.started_at.desc(), root.id) if active else (root.started_at.desc(), root.id)
    ids = list(db.scalars(query.order_by(*ordering).offset(offset).limit(limit + 1)))
    more = len(ids) > limit
    ids = ids[:limit]
    rows = db.execute(select(chain.c.root_id, entry).join(entry, entry.id == chain.c.entry_id)
                      .where(chain.c.root_id.in_(ids)).order_by(entry.started_at, entry.id)).all() if ids else []
    groups = defaultdict(list)
    for root_id, interval in rows:
        groups[root_id].append(interval)
    # Batch load display metadata; never return another user's interval data.
    subs = {s.id: s for s in db.scalars(select(models.Subtask).where(models.Subtask.id.in_({r.subtask_id for _, r in rows if r.subtask_id})))}
    task_ids = {r.task_id or subs[r.subtask_id].task_id for _, r in rows}
    tasks = {t.id: t for t in db.scalars(select(models.Task).where(models.Task.id.in_(task_ids), task_tenant_predicate(user)))}
    projects = {p.id: p for p in db.scalars(select(models.Project).where(models.Project.id.in_({t.project_id for t in tasks.values() if t.project_id})))}
    # All-time subtask totals include all sessions, summing concurrent session time.
    totals = defaultdict(float)
    targets = {r.subtask_id for _, r in rows if r.subtask_id}
    # Completed intervals aggregate in SQL; only currently running intervals need wall-time calculation.
    for target, seconds in db.execute(select(entry.subtask_id, func.sum(entry.duration_seconds)).where(
            entry.tenant_id == user.tenant_id, entry.user_id == user.id, entry.subtask_id.in_(targets))
            .group_by(entry.subtask_id)):
        totals[target] += seconds or 0
    for target, started in db.execute(select(entry.subtask_id, entry.started_at).where(
            entry.tenant_id == user.tenant_id, entry.user_id == user.id, entry.subtask_id.in_(targets), entry.stopped_at.is_(None))):
        totals[target] += _seconds(started, now)
    items = []
    for root_id in ids:
        intervals = groups[root_id]
        # Continuation order is authoritative even if historical corrections changed timestamps.
        by_parent = {r.continued_from_id: r for r in intervals}
        ordered = [next(r for r in intervals if r.id == root_id)]
        while ordered[-1].id in by_parent:
            ordered.append(by_parent[ordered[-1].id])
        first, last = ordered[0], ordered[-1]
        state = "RUNNING" if last.stopped_at is None else "PAUSED" if last.stop_reason == "paused" and last.finalized_at is None else "STOPPED"
        final_stop = (last.finalized_at or last.stopped_at) if state == "STOPPED" else None
        active_seconds = range_seconds = paused_seconds = range_paused = 0.0
        timeline, spans = [], []
        for index, interval in enumerate(ordered):
            end = interval.stopped_at or now
            seconds = interval.duration_seconds if interval.stopped_at else _seconds(interval.started_at, end)
            active_seconds += seconds or 0
            range_seconds += _clipped(interval.started_at, end, lower, upper)
            spans.append({"id": interval.id, "started_at": timers._as_utc(interval.started_at),
                          "ended_at": timers._as_utc(interval.stopped_at) if interval.stopped_at else None,
                          "active_seconds": seconds, "corrected": interval.corrected_at is not None,
                          "paused_seconds": 0, "paused_until": None})
            timeline.append({"event": "Started" if index == 0 else "Resumed", "at": timers._as_utc(interval.started_at)})
            if interval.stopped_at:
                timeline.append({"event": "Paused" if interval.stop_reason == "paused" else "Stopped", "at": timers._as_utc(interval.stopped_at)})
                gap_end = ordered[index + 1].started_at if index + 1 < len(ordered) else (last.finalized_at or now)
                if interval.stop_reason == "paused":
                    paused_seconds += _seconds(interval.stopped_at, gap_end)
                    range_paused += _clipped(interval.stopped_at, gap_end, lower, upper)
                    spans[-1]["paused_seconds"] = _seconds(interval.stopped_at, gap_end)
                    spans[-1]["paused_until"] = timers._as_utc(gap_end)
        if last.finalized_at and last.stop_reason == "paused":
            timeline.append({"event": "Stopped", "at": timers._as_utc(last.finalized_at)})
        sub = subs.get(first.subtask_id)
        task = tasks.get(first.task_id or (sub.task_id if sub else None))
        if task is None:
            continue
        project = projects.get(task.project_id)
        items.append({"id": root_id, "entry_id": last.id, "status": state,
            "task_id": task.id, "subtask_id": first.subtask_id, "project_name": project.name if project else "Personal work",
            "task_title": task.title, "subtask_title": sub.title if sub else None,
            "subtask_status": sub.status.value if sub else task.status.value,
            "started_at": timers._as_utc(first.started_at), "stopped_at": timers._as_utc(final_stop) if final_stop else None,
            "running_since": timers._as_utc(last.started_at) if state == "RUNNING" else None,
            "active_seconds": active_seconds, "paused_seconds": paused_seconds,
            "range_active_seconds": range_seconds, "range_paused_seconds": range_paused,
            "subtask_total_seconds": totals[first.subtask_id] if first.subtask_id else active_seconds,
            "intervals": spans, "timeline": timeline})
    if session_id and not items:
        raise HTTPException(status_code=404, detail="Work session not found")
    running_count = db.scalar(select(func.count()).select_from(entry).where(entry.tenant_id == user.tenant_id,
        entry.user_id == user.id, entry.stopped_at.is_(None)))
    return {"items": items, "user_id": user.id, "tenant_id": str(user.tenant_id),
            "server_time": now, "limit": timers.timer_limit(user),
            "running_count": running_count, "next_offset": offset + limit if more else None}
