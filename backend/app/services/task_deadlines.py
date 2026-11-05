"""One hold-aware deadline calculation for scoring, reports and task APIs."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, and_, func
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement


def naive_utc(value):
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def effective_deadline(task, as_of=None):
    if task.due_at is None:
        return None
    now = naive_utc(as_of or datetime.now(timezone.utc))
    paused = max(0, task.hold_paused_seconds or 0)
    if task.hold_started_at is not None:
        paused += max(0, (now - naive_utc(task.hold_started_at)).total_seconds())
    return naive_utc(task.due_at) + timedelta(seconds=paused)


def is_overdue(task, as_of=None):
    from .gamification import COMPLETED_STATUSES
    now = naive_utc(as_of or datetime.now(timezone.utc))
    deadline = effective_deadline(task, now)
    return deadline is not None and task.status not in COMPLETED_STATUSES and deadline < now


class deadline_expression(FunctionElement):
    type = DateTime()
    inherit_cache = True


@compiles(deadline_expression, 'postgresql')
def _postgres(element, compiler, **kwargs):
    due, closed, started, now = [compiler.process(value, **kwargs) for value in element.clauses]
    return f"({due} + ({closed} + CASE WHEN {started} IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM ({now} - {started}))) ELSE 0 END) * INTERVAL '1 second')"


@compiles(deadline_expression, 'sqlite')
def _sqlite(element, compiler, **kwargs):
    due, closed, started, now = [compiler.process(value, **kwargs) for value in element.clauses]
    return f"(CASE WHEN {closed}=0 AND {started} IS NULL THEN {due} ELSE strftime('%Y-%m-%d %H:%M:%f000', {due}, '+' || ({closed} + CASE WHEN {started} IS NOT NULL THEN max(0, (julianday({now})-julianday({started}))*86400.0) ELSE 0 END) || ' seconds') END)"


def effective_deadline_sql(columns, as_of):
    # Reports use Task projections as well as the mapped class. Projections must
    # retain the hold summaries; callers lacking them retain legacy semantics.
    if not hasattr(columns, 'hold_paused_seconds'):
        return columns.due_at
    return deadline_expression(columns.due_at, func.coalesce(columns.hold_paused_seconds, 0), columns.hold_started_at, naive_utc(as_of))


def overdue_sql(columns, as_of, completed):
    return and_(columns.due_at.is_not(None), effective_deadline_sql(columns, as_of) < naive_utc(as_of), ~columns.status.in_(completed))
