"""The reporting migration adds one reversible index, never rewrites event rows."""
from importlib import import_module
import json
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
import pytest

from backend.tests.test_task_lifecycle import engine  # explicitly isolated database fixture


def test_reporting_period_index_roundtrip(engine):
    migration = import_module("backend.alembic.versions.ffa0d1e2f3a4_reporting_period_index")
    with engine.connect() as connection:
        before = connection.scalar(text("SELECT COUNT(*) FROM task_lifecycle_events"))
        connection.commit()
        context = MigrationContext.configure(connection)
        with context.begin_transaction():
            with Operations.context(context):
                migration.upgrade()
        indexes = {item["name"]: item for item in inspect(connection).get_indexes("task_lifecycle_events")}
        assert indexes[migration.INDEX]["column_names"] == ["tenant_id", "occurred_at", "task_id"]
        assert connection.scalar(text("SELECT COUNT(*) FROM task_lifecycle_events")) == before
        connection.commit()
        with context.begin_transaction():
            with Operations.context(context):
                migration.downgrade()
        assert migration.INDEX not in {item["name"] for item in inspect(connection).get_indexes("task_lifecycle_events")}
        assert connection.scalar(text("SELECT COUNT(*) FROM task_lifecycle_events")) == before


def test_postgres_event_period_plan_uses_reporting_index(engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL planner evidence; SQLite query-shape probe is separate")
    migration = import_module("backend.alembic.versions.ffa0d1e2f3a4_reporting_period_index")
    tenant_id = uuid4()
    params = {"tenant": tenant_id, "start": "2022-01-01T00:00:00Z", "end": "2022-01-03T00:00:00Z"}
    query = ("SELECT count(*) FROM task_lifecycle_events WHERE tenant_id=:tenant "
             "AND occurred_at >= CAST(:start AS timestamptz) AND occurred_at < CAST(:end AS timestamptz)")
    with engine.connect() as connection:
        connection.execute(text("""
            INSERT INTO task_lifecycle_events
                (tenant_id,task_id,event_type,occurred_at,recorded_at,details)
            SELECT CAST(:tenant AS uuid), 'synthetic-' || n, 'task.status_changed',
                timestamptz '2020-01-01T00:00:00Z' + (n / 100) * interval '1 day',
                timestamptz '2020-01-01T00:00:00Z' + (n / 100) * interval '1 day', '{}'::json
            FROM generate_series(0, 99999) AS n
        """), {"tenant": tenant_id})
        connection.execute(text("ANALYZE task_lifecycle_events"))
        connection.commit()
        before_total = connection.scalar(text(query), params)
        before = connection.scalar(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query), params)
        connection.commit()
        context = MigrationContext.configure(connection)
        with context.begin_transaction():
            with Operations.context(context):
                migration.upgrade()
        connection.execute(text("ANALYZE task_lifecycle_events"))
        after_total = connection.scalar(text(query), params)
        after = connection.scalar(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query), params)
        assert before_total == after_total == 200
        assert migration.INDEX in json.dumps(after)
        print("REPORTING_POSTGRES_INDEX_PLAN " + json.dumps({
            "synthetic_events": 100000, "matched_rows": after_total,
            "before": before, "after": after,
        }))
