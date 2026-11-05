"""Recovery checks against disposable PostgreSQL schemas, never the app DB."""
# Imported pytest fixtures are intentionally supplied again as function arguments.
# ruff: noqa: F811
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from backend.scripts import repair_partial_status_schema as recovery
from backend.tests.test_task_status_management import (  # noqa: F401
    client,
    data,
    engine,
    headers,
)


def make_partial(connection, *, held=False):
    assert connection.dialect.name == "postgresql"
    assert connection.scalar(sa.text("SELECT current_schema()")).startswith("lifecycle_")
    if held:
        # Emulate a task held before the new hold-capture feature existed.
        connection.exec_driver_sql("ALTER TABLE tasks DISABLE TRIGGER zea_hold_capture")
        connection.exec_driver_sql("UPDATE tasks SET status='ON_HOLD'")
        connection.exec_driver_sql("ALTER TABLE tasks ENABLE TRIGGER zea_hold_capture")
    for column in recovery.COLUMNS:
        connection.exec_driver_sql(f'ALTER TABLE tasks DROP COLUMN "{column}"')
    assert set(recovery.schema_issues(connection)) == recovery.EXPECTED_ISSUES


def require_postgres(engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("This recovery is PostgreSQL-only")


def test_repair_preserves_old_values_starts_legacy_holds_and_restores_http(client, data, engine):
    require_postgres(engine)
    with engine.begin() as connection:
        make_partial(connection, held=True)
        assert recovery.plan(connection) == "repair_required"
    with engine.begin() as connection:
        result = recovery.repair(connection)
        assert result["existing_records_unchanged"]
        assert result["legacy_holds_started_at_cutover"] == 1
        assert result["integrity"]["errors"] == {}
        assert not sa.inspect(connection).has_table("alembic_version")
        assert connection.scalar(sa.text("SELECT count(*) FROM task_hold_intervals WHERE source='repair:partial_status_v1'")) == 1
        assert connection.scalar(sa.text("SELECT hold_paused_seconds FROM tasks")) == 0
        columns = {table: [c["name"] for c in sa.inspect(connection).get_columns(table)]
                   for table in sa.inspect(connection).get_table_names()}
        before = recovery.fingerprint(connection, columns)
    with engine.begin() as connection:
        assert recovery.repair(connection)["status"] == "already_compatible"
        assert before == recovery.fingerprint(connection, columns)
    for path in ("/api/task-statuses", "/api/tasks/page?page=1&page_size=50&timezone=Asia%2FCalcutta",
                 "/api/tasks/kanban?page=1&page_size=20&timezone=Asia%2FCalcutta"):
        response = client.get(path, headers=headers(data.owner))
        assert response.status_code == 200, response.text


def test_repair_refuses_additional_schema_drift_without_adding_columns(data, engine):
    require_postgres(engine)
    with engine.begin() as connection:
        make_partial(connection)
        connection.exec_driver_sql("ALTER TABLE tasks DISABLE TRIGGER zea_hold_capture")
    with pytest.raises(RuntimeError, match="differs from the reviewed"), engine.begin() as connection:
        recovery.repair(connection)
    with engine.connect() as connection:
        assert "custom_status_id" not in {c["name"] for c in sa.inspect(connection).get_columns("tasks")}


def test_repair_refuses_populated_status_history(data, engine):
    require_postgres(engine)
    with data.factory() as db:
        recovery.task_statuses.scope(db, SimpleNamespace(tenant_id=data.owner.tenant_id))
        db.commit()
    with engine.begin() as connection:
        make_partial(connection)
    with pytest.raises(RuntimeError, match="Existing status/hold records"), engine.begin() as connection:
        recovery.repair(connection)


def test_failed_final_verification_rolls_back_schema_seeding_and_holds(data, engine, monkeypatch):
    require_postgres(engine)
    with engine.begin() as connection:
        make_partial(connection, held=True)
    monkeypatch.setattr(recovery, "audit_data", lambda connection: {"errors": {"injected_failure": 1}})
    with pytest.raises(RuntimeError, match="injected_failure"), engine.begin() as connection:
        recovery.repair(connection)
    with engine.connect() as connection:
        assert recovery.plan(connection) == "repair_required"
        for table in recovery.STATUS_TABLES:
            assert connection.scalar(sa.text(f'SELECT count(*) FROM "{table}"')) == 0


def test_repair_refuses_versioned_database(data, engine):
    require_postgres(engine)
    with engine.begin() as connection:
        make_partial(connection)
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('fff5c6d7e8f9')")
    with pytest.raises(RuntimeError, match="Versioned database"), engine.begin() as connection:
        recovery.repair(connection)


def test_repair_accepts_empty_migration_table_without_stamping(data, engine):
    require_postgres(engine)
    with engine.begin() as connection:
        make_partial(connection)
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
    with engine.begin() as connection:
        assert recovery.repair(connection)["existing_records_unchanged"]
        assert connection.scalar(sa.text("SELECT count(*) FROM alembic_version")) == 0
