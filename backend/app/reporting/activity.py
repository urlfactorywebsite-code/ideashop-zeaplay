"""Date-wise observations; never substitute current state for historical events."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, case, func, inspect, or_, select

from .. import models as m
from ..lifecycle.analytics import utc
from .scope import filtered_tasks, validate_filters, visible_subtasks
from .work import _bounded_intervals, daily_time, interval_query


METRICS = ("tasks_created", "tasks_started", "tasks_completed", "tasks_reopened", "subtasks_completed",
           "work_sessions_started", "work_intervals_started", "recorded_effort_seconds", "unique_working_seconds")


def _bucket_key(value, zone, grouping):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    day = utc(value).astimezone(ZoneInfo(zone)).date()
    if grouping == "weekly":
        day -= timedelta(days=day.weekday())
    elif grouping == "monthly":
        day = day.replace(day=1)
    return day.isoformat()


def bucket_expression(db, column, zone, grouping, *, naive_utc=False):
    if db.get_bind().dialect.name == "postgresql":
        timestamp = func.timezone("UTC", column) if naive_utc else column
        return func.to_char(func.date_trunc(
            {"daily": "day", "weekly": "week", "monthly": "month"}[grouping],
            func.timezone(zone, timestamp)), "YYYY-MM-DD")
    db.connection().connection.driver_connection.create_function("report_bucket", 3, _bucket_key, deterministic=True)
    return func.report_bucket(column, zone, grouping)


def _event_range(column, filters, as_of, *, naive=False):
    upper = min(filters.end_at, as_of) if filters.end_at else as_of
    if naive:
        upper = utc(upper).replace(tzinfo=None)
    clauses = [column < upper]
    if filters.start_at:
        clauses.append(column >= (utc(filters.start_at).replace(tzinfo=None) if naive else filters.start_at))
    return clauses


def activity_report(db, user, filters, *, grouping="daily", as_of=None):
    validate_filters(db, user, filters)
    if grouping not in {"daily", "weekly", "monthly"}:
        raise HTTPException(422, "Invalid activity grouping")
    as_of = utc(as_of or datetime.now(timezone.utc))
    inspector = inspect(db.connection())
    if not all(inspector.has_table(table) for table in ("task_lifecycle_events", "task_lifecycle_coverage")):
        raise HTTPException(503, "Lifecycle history is not installed; apply the existing lifecycle migrations before reporting activity.")
    coverage = db.scalar(select(func.min(m.TaskLifecycleCoverage.started_at)))
    if coverage is None:
        raise HTTPException(503, "Lifecycle capture coverage is unavailable; activity cannot report trustworthy transition counts.")
    tasks = filtered_tasks(user, filters, inventory_dates=False).with_only_columns(
        m.Task.id, m.Task.created_at).subquery("activity_tasks")
    event = m.TaskLifecycleEvent
    buckets = defaultdict(lambda: dict.fromkeys(METRICS, 0))
    created_bucket = bucket_expression(db, tasks.c.created_at, filters.timezone, grouping, naive_utc=True)
    for day, count in db.execute(select(created_bucket, func.count()).select_from(tasks)
                                .where(*_event_range(tasks.c.created_at, filters, as_of, naive=True))
                                .group_by(created_bucket)):
        buckets[day]["tasks_created"] = count

    parent = and_(event.event_type == "task.status_changed", event.subtask_id.is_(None))
    child_ids = visible_subtasks(user, filters, select(tasks.c.id)).with_only_columns(m.Subtask.id)
    child = and_(event.event_type == "subtask.status_changed", event.subtask_id.in_(child_ids))
    completed = ["DONE", "DEPLOYED"]
    was_complete = event.previous_status.in_(completed)
    is_complete = event.new_status.in_(completed)
    not_previously_complete = or_(event.previous_status.is_(None), ~was_complete)
    metrics = {
        "tasks_started": and_(parent, event.new_status == "IN_PROGRESS"),
        "tasks_completed": and_(parent, is_complete, not_previously_complete),
        "tasks_reopened": and_(parent, was_complete, ~is_complete),
        "subtasks_completed": and_(child, event.new_status == "DONE",
                                   or_(event.previous_status.is_(None), event.previous_status != "DONE")),
    }
    event_bucket = bucket_expression(db, event.occurred_at, filters.timezone, grouping)
    for row in db.execute(select(event_bucket.label("date"), *[
            func.sum(case((condition, 1), else_=0)).label(name) for name, condition in metrics.items()
        ]).where(event.tenant_id == user.tenant_id, event.task_id.in_(select(tasks.c.id)),
                 or_(parent, child), *_event_range(event.occurred_at, filters, as_of))
        .group_by(event_bucket)).mappings():
        for name in metrics:
            buckets[row["date"]][name] = int(row[name] or 0)

    source = interval_query(db, user, filters, as_of).subquery("activity_intervals")
    start_bucket = bucket_expression(db, source.c.started_at, filters.timezone, grouping)
    for day, starts, roots in db.execute(select(
            start_bucket, func.count(),
            func.sum(case((source.c.continued_from_id.is_(None), 1), else_=0))
        ).where(*_event_range(source.c.started_at, filters, as_of)).group_by(start_bucket)):
        buckets[day]["work_intervals_started"] = starts
        buckets[day]["work_sessions_started"] = int(roots or 0)
    # Database daily sums are small aggregate results; only exact interval union
    # loads a bounded projection of endpoints. Disjoint local days are additive.
    intervals = _bounded_intervals(db, source)
    for day in daily_time(db, source, filters, as_of, intervals):
        key = _bucket_key(datetime.fromisoformat(day["date"]).replace(tzinfo=ZoneInfo(filters.timezone)),
                          filters.timezone, grouping)
        buckets[key]["recorded_effort_seconds"] += day["recorded_effort_seconds"]
        buckets[key]["unique_working_seconds"] += day["unique_working_seconds"]
    items = [{"date": day, **values} for day, values in sorted(buckets.items())]
    meta = filters.meta(as_of, date_semantics="each event timestamp; time is clipped to local-date UTC boundaries")
    meta["counting_unit"] = "persisted task IDs for creation; observed transitions for lifecycle events; timer roots/active intervals for work"
    meta["lifecycle_coverage_started_at"] = utc(coverage) if coverage else None
    meta["unavailable_metrics"] = {
        "tasks_assigned": "Task.assigned_at retains only the latest current assignment; immutable assignment history is unavailable."
    }
    meta["limitations"] = [
        "Status events are observed transitions, not unique-task totals. Repeated starts/completions are counted separately.",
        "Lifecycle events before coverage began are unknown; zero observed events does not prove no historical activity.",
        "Parent and subtask completion are distinct. Parent completed statuses are DONE and DEPLOYED.",
        "Employee filtering scopes current assigned task/subtask activity; work metrics filter the actual worker.",
        "Deleted or inaccessible targets are excluded. Current effective timer corrections affect historical time totals.",
        "Work session starts count timer roots; resumed intervals contribute to work_intervals_started.",
    ]
    totals = {name: round(sum(item[name] for item in items), 6) if name.endswith("_seconds")
              else sum(item[name] for item in items) for name in METRICS}
    sort = filters.sort or "date"
    if sort not in {"date", *totals.keys()}:
        raise HTTPException(422, "Invalid activity sort field")
    sorted_items = sorted(items, key=lambda item: (item[sort], item["date"]), reverse=filters.direction == "desc")
    return {"items": sorted_items[(filters.page - 1) * filters.page_size:filters.page * filters.page_size],
            "series": items, "total": len(items), "page": filters.page, "page_size": filters.page_size,
            "total_pages": ceil(len(items) / filters.page_size),
            "grouping": grouping, "totals": totals, "meta": meta}
