"""Scoped time accounting over the existing effective active-interval ledger."""
from collections import defaultdict
from dataclasses import replace
from datetime import datetime, time, timedelta, timezone
from math import ceil
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import DateTime, and_, case, func, literal, literal_column, or_, select, type_coerce, union_all

from .. import models as m
from ..lifecycle.analytics import _union_duration, utc
from .scope import admin, authorized_users, filtered_tasks, managed_project_ids, validate_filters


MAX_REPORT_INTERVALS = 50000
MAX_DAILY_DAYS = 366


def _parse(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return utc(value)


def _sqlite_functions(db):
    if db.get_bind().dialect.name != "sqlite":
        return
    raw = db.connection().connection.driver_connection
    raw.create_function("report_seconds", 2, lambda end, start:
                        max(0.0, (_parse(end) - _parse(start)).total_seconds()), deterministic=True)
    raw.create_function("report_add_seconds", 2, lambda start, seconds:
                        (_parse(start) + timedelta(seconds=seconds or 0)).replace(tzinfo=None)
                        .isoformat(sep=" ", timespec="microseconds"), deterministic=True)


def _minimum(left, right):
    return case((left < right, left), else_=right)


def _maximum(left, right):
    return case((left > right, left), else_=right)


def _seconds(db, end, start):
    if db.get_bind().dialect.name == "postgresql":
        return case((end > start, func.extract("epoch", end - start)), else_=0)
    return func.report_seconds(end, start)


def interval_query(db, user, filters, as_of):
    """Only authorized workers and targets, independent of current assignment dates."""
    _sqlite_functions(db)
    task_ids = filtered_tasks(user, replace(filters, employee_id=None), inventory_dates=False).with_only_columns(m.Task.id)
    entry = m.TimeEntry
    upper = min(utc(filters.end_at), as_of) if filters.end_at else as_of
    start = entry.started_at
    if db.get_bind().dialect.name == "postgresql":
        accounted_stop = entry.started_at + entry.duration_seconds * literal_column("INTERVAL '1 second'")
    else:
        accounted_stop = type_coerce(func.report_add_seconds(entry.started_at, entry.duration_seconds), DateTime())
    stop = case((entry.stopped_at.is_(None), literal(as_of)),
                else_=_minimum(entry.stopped_at, accounted_stop))
    right = _minimum(stop, literal(upper))
    left = _maximum(start, literal(filters.start_at)) if filters.start_at else start
    # A timer stopped within its first accounted second is still a real interval
    # and session-start event. Select that point inside the half-open period.
    zero_in_period = and_(stop == start, start >= filters.start_at) if filters.start_at else stop == start
    stmt = select(
        entry.id, entry.user_id, m.User.name.label("employee_name"),
        m.Task.id.label("task_id"), m.Task.title.label("task_title"), m.Task.status.label("task_status"),
        entry.subtask_id, m.Subtask.title.label("subtask_title"),
        m.Task.project_id, m.Project.name.label("project_name"),
        entry.started_at, entry.stopped_at, entry.duration_seconds, entry.continued_from_id,
        entry.start_kind, entry.stop_reason, entry.finalized_at,
        left.label("clip_start"), right.label("clip_end"),
        _seconds(db, right, left).label("recorded_effort_seconds"),
    ).select_from(entry).outerjoin(m.Subtask, m.Subtask.id == entry.subtask_id).join(
        m.Task, m.Task.id == func.coalesce(entry.task_id, m.Subtask.task_id)
    ).join(m.User, m.User.id == entry.user_id).outerjoin(
        m.Project, m.Project.id == m.Task.project_id
    ).where(
        entry.tenant_id == user.tenant_id, m.User.tenant_id == user.tenant_id,
        m.Task.id.in_(task_ids), entry.user_id.in_(authorized_users(user).with_only_columns(m.User.id)),
        start < upper, or_(right > left, zero_in_period),
    )
    if filters.employee_id:
        stmt = stmt.where(entry.user_id == filters.employee_id)
    if not admin(user):
        if user.role == m.RoleEnum.MANAGER:
            management = [m.Task.project_id.in_(managed_project_ids(user))]
            if user.department_id:
                management.append(and_(m.Task.project_id.is_(None), m.User.department_id == user.department_id))
            stmt = stmt.where(or_(entry.user_id == user.id, *management))
        else:
            stmt = stmt.where(entry.user_id == user.id)
    return stmt


def _bounded_intervals(db, source):
    rows = db.execute(select(source.c.user_id, source.c.task_id, source.c.subtask_id,
                             source.c.project_id, source.c.clip_start, source.c.clip_end)
                      .limit(MAX_REPORT_INTERVALS + 1)).all()
    if len(rows) > MAX_REPORT_INTERVALS:
        raise HTTPException(422, "Time report exceeds 50,000 active intervals. Narrow the date range; no partial totals returned.")
    return rows


def _unique_seconds(rows):
    by_user = defaultdict(list)
    for row in rows:
        by_user[row.user_id].append((utc(row.clip_start), utc(row.clip_end)))
    return round(sum((_union_duration(intervals) for intervals in by_user.values()), timedelta()).total_seconds(), 6)


def _aggregate_columns(source):
    return [
        func.sum(source.c.recorded_effort_seconds).label("recorded_effort_seconds"),
        func.count().label("interval_count"),
        func.sum(case((source.c.stopped_at.is_(None), 1), else_=0)).label("running_interval_count"),
        func.sum(case((source.c.start_kind == "resumed", 1), else_=0)).label("resumed_interval_count"),
        func.sum(case((source.c.stop_reason == "paused", 1), else_=0)).label("paused_interval_count"),
    ]


def _numbers(row):
    return {key: round(float(value or 0), 6) if key.endswith("_seconds") else int(value or 0)
            for key, value in row.items()}


def _meta(filters, as_of):
    meta = filters.meta(as_of, date_semantics="effective active intervals intersecting [start_at, end_at), clipped to as_of")
    meta["counting_unit"] = "active TimeEntry interval; resume creates another interval"
    meta["limitations"] = [
        "Recorded effort sums concurrent timers; unique working time unions overlaps per employee. Neither is attendance or payroll.",
        "Per-task/project unique time is not additive across groups; the summary independently unions all filtered work per employee.",
        "Historical corrections use the current effective ledger. Deleted or inaccessible targets are excluded.",
    ]
    return meta


def _daily_windows(filters, as_of, rows):
    zone = ZoneInfo(filters.timezone)
    first = filters.from_date or (min(utc(row.clip_start) for row in rows).astimezone(zone).date() if rows else as_of.astimezone(zone).date())
    last = filters.to_date or (max(utc(row.clip_end) for row in rows).astimezone(zone).date() if rows else first)
    last = min(last, as_of.astimezone(zone).date())
    days = (last - first).days + 1
    if days > MAX_DAILY_DAYS:
        raise HTTPException(422, "Daily time reports support at most 366 local days. Narrow the date range; no partial totals returned.")
    result = []
    for offset in range(max(0, days)):
        day = first + timedelta(days=offset)
        left = datetime.combine(day, time.min, zone).astimezone(timezone.utc)
        right = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
        result.append((day.isoformat(), left, right))
    return result


def daily_time(db, source, filters, as_of, rows):
    """SQL sum per local day; only interval union uses the bounded endpoint projection."""
    windows = _daily_windows(filters, as_of, rows)
    if not windows:
        return []
    calendar = union_all(*(select(literal(day).label("day"),
                                  literal(left).label("day_start"), literal(right).label("day_end"))
                           for day, left, right in windows)).subquery("report_days")
    left = _maximum(source.c.clip_start, calendar.c.day_start)
    right = _minimum(source.c.clip_end, calendar.c.day_end)
    aggregates = {
        day: (round(float(seconds or 0), 6), count)
        for day, seconds, count in db.execute(
            select(calendar.c.day, func.sum(_seconds(db, right, left)), func.count())
            .select_from(source).join(calendar, and_(
                source.c.clip_start < calendar.c.day_end, or_(
                    source.c.clip_end > calendar.c.day_start,
                    and_(source.c.clip_end == source.c.clip_start, source.c.clip_start >= calendar.c.day_start))))
            .group_by(calendar.c.day))
    }
    unique = defaultdict(lambda: defaultdict(list))
    zone = ZoneInfo(filters.timezone)
    first_day = datetime.fromisoformat(windows[0][0]).date()
    for row in rows:
        start, end = utc(row.clip_start), utc(row.clip_end)
        first_index = max(0, (start.astimezone(zone).date() - first_day).days)
        last_index = min(len(windows) - 1, (end.astimezone(zone).date() - first_day).days)
        for day, left, right in windows[first_index:last_index + 1]:
            if start < right and end > left:
                unique[day][row.user_id].append((max(start, left), min(end, right)))
    return [{
        "id": day, "name": day, "date": day,
        "recorded_effort_seconds": aggregates.get(day, (0, 0))[0],
        "unique_working_seconds": round(sum(
            (_union_duration(spans) for spans in unique[day].values()), timedelta()).total_seconds(), 6),
        "interval_count": aggregates.get(day, (0, 0))[1],
    } for day, _, _ in windows]


def time_report(db, user, filters, *, group_by="employee", as_of=None):
    validate_filters(db, user, filters)
    as_of = utc(as_of or datetime.now(timezone.utc))
    if group_by not in {"employee", "task", "subtask", "project", "daily"}:
        raise HTTPException(422, "Invalid time grouping")
    source = interval_query(db, user, filters, as_of).subquery("report_intervals")
    rows = _bounded_intervals(db, source)
    summary = _numbers(db.execute(select(*_aggregate_columns(source))).mappings().one())
    summary["unique_working_seconds"] = _unique_seconds(rows)
    if group_by == "daily":
        items = daily_time(db, source, filters, as_of, rows)
        sort = filters.sort or "name"
        if sort not in {"name", "date", "recorded_effort_seconds", "unique_working_seconds", "interval_count"}:
            raise HTTPException(422, "Invalid time sort field")
        items.sort(key=lambda row: (row[sort], row["id"]), reverse=filters.direction == "desc")
        total = len(items)
        items = items[(filters.page - 1) * filters.page_size:filters.page * filters.page_size]
    else:
        identifier, name = {
            "employee": (source.c.user_id, source.c.employee_name),
            "task": (source.c.task_id, source.c.task_title),
            "subtask": (source.c.subtask_id, func.coalesce(source.c.subtask_title, "Direct parent task work")),
            "project": (source.c.project_id, func.coalesce(source.c.project_name, "Personal work")),
        }[group_by]
        grouped = select(identifier.label("id"), name.label("name"), *_aggregate_columns(source)).group_by(identifier, name).subquery()
        total = db.scalar(select(func.count()).select_from(grouped)) or 0
        unions = defaultdict(lambda: defaultdict(list))
        row_key = {"employee": "user_id", "task": "task_id", "subtask": "subtask_id", "project": "project_id"}[group_by]
        for row in rows:
            unions[getattr(row, row_key)][row.user_id].append((utc(row.clip_start), utc(row.clip_end)))
        unique = {key: round(sum((_union_duration(spans) for spans in users.values()), timedelta()).total_seconds(), 6)
                  for key, users in unions.items()}
        sort = filters.sort or "name"
        if sort not in {"name", "recorded_effort_seconds", "unique_working_seconds", "interval_count",
                        "running_interval_count", "paused_interval_count", "resumed_interval_count"}:
            raise HTTPException(422, "Invalid time sort field")
        offset = (filters.page - 1) * filters.page_size
        if sort == "unique_working_seconds":
            # Ranking the already-computed union values avoids a 50,000-arm SQL CASE.
            ordered = sorted(unique, key=lambda key: (unique[key], key or ""),
                             reverse=filters.direction == "desc")[offset:offset + filters.page_size]
            ids = [key for key in ordered if key is not None]
            query = select(grouped).where(or_(grouped.c.id.in_(ids),
                                             grouped.c.id.is_(None) if None in ordered else literal(False)))
        else:
            ordering = grouped.c[sort]
            query = select(grouped).order_by(
                ordering.desc() if filters.direction == "desc" else ordering.asc(), grouped.c.id
            ).offset(offset).limit(filters.page_size)
        items = []
        for row in db.execute(query).mappings():
            item = dict(row)
            item["unique_working_seconds"] = unique.get(item["id"], 0)
            for key in set(item) - {"id", "name"}:
                item[key] = round(float(item[key] or 0), 6) if key.endswith("_seconds") else int(item[key] or 0)
            items.append(item)
        if sort == "unique_working_seconds":
            position = {key: index for index, key in enumerate(ordered)}
            items.sort(key=lambda item: position[item["id"]])
    return {"items": items, "total": total, "page": filters.page, "page_size": filters.page_size,
            "total_pages": ceil(total / filters.page_size),
            "group_by": group_by, "summary": summary, "meta": _meta(filters, as_of)}


def sessions_report(db, user, filters, *, active=False, as_of=None):
    validate_filters(db, user, filters)
    as_of = utc(as_of or datetime.now(timezone.utc))
    query = interval_query(db, user, filters, as_of)
    if active:
        query = query.where(m.TimeEntry.stopped_at.is_(None))
    source = query.subquery("session_report")
    sort = filters.sort or "started_at"
    if sort not in {"started_at", "employee_name", "task_title", "recorded_effort_seconds"}:
        raise HTTPException(422, "Invalid session sort field")
    column = source.c[sort]
    rows = db.execute(select(source).order_by(
        column.desc() if filters.direction == "desc" else column.asc(), source.c.id)
        .offset((filters.page - 1) * filters.page_size).limit(filters.page_size)).mappings().all()
    successors = {row.continued_from_id: row for row in db.execute(select(
        m.TimeEntry.continued_from_id, m.TimeEntry.user_id, m.TimeEntry.task_id, m.TimeEntry.subtask_id,
        m.TimeEntry.started_at).where(
            m.TimeEntry.tenant_id == user.tenant_id,
            m.TimeEntry.continued_from_id.in_([row["id"] for row in rows]),
            m.TimeEntry.start_kind.in_(["resumed", "restarted"]),
            m.TimeEntry.started_at <= as_of,
        ))} if rows else {}
    items = []
    for row in rows:
        item = dict(row)
        for key, value in item.items():
            if isinstance(value, datetime):
                item[key] = utc(value)
        successor = successors.get(item["id"])
        if successor and (successor.user_id != item["user_id"] or successor.subtask_id != item["subtask_id"]
                          or (successor.task_id and successor.task_id != item["task_id"])):
            successor = None
        item["resumed_at"] = utc(successor.started_at) if successor else None
        item["pause_end_at"] = item["resumed_at"] or item["finalized_at"] if item["stop_reason"] == "paused" else None
        item["paused_seconds"] = (max(0, int((min(item["pause_end_at"] or as_of, as_of) - item["stopped_at"]).total_seconds()))
                                  if item["stop_reason"] == "paused" and item["stopped_at"] else 0)
        item["recorded_effort_seconds"] = round(float(item["recorded_effort_seconds"] or 0), 6)
        item["state"] = ("RUNNING" if item["stopped_at"] is None else
                         "RESUMED" if successor else
                         "PAUSED" if item["stop_reason"] == "paused" and item["finalized_at"] is None else "STOPPED")
        items.append(item)
    total = db.scalar(select(func.count()).select_from(source)) or 0
    return {"items": items, "total": total, "total_pages": ceil(total / filters.page_size),
            "page": filters.page, "page_size": filters.page_size, "active_only": active,
            "meta": _meta(filters, as_of)}
