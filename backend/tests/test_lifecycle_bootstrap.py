"""Bootstrap regression checks against isolated databases, never the app database."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from backend.app.lifecycle.bootstrap import COLUMNS, ensure_execution_columns, main


@pytest.fixture(params=["sqlite", "postgresql"])
def database(request, tmp_path):
    admin = None
    if request.param == "sqlite":
        engine = create_engine("sqlite:///" + (tmp_path / "bootstrap.db").as_posix())
    else:
        url = os.environ.get("ZEAPLAY_RT_POSTGRES_TEST_URL")
        if not url:
            pytest.skip("Requires explicitly isolated PostgreSQL rt3_test database")
        assert "rt3_test" in (make_url(url).database or "")
        schema = "bootstrap_test_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url)
        @event.listens_for(engine, "connect")
        def search_path(connection, _):
            with connection.cursor() as cursor:
                cursor.execute(f'SET search_path TO "{schema}", public')
            connection.commit()
    try:
        yield engine
    finally:
        engine.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.mark.parametrize("partial", [False, True])
def test_existing_timer_rows_and_history_survive_idempotent_bootstrap(database, partial):
    with database.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE time_entries (id VARCHAR(36) PRIMARY KEY, duration_seconds INTEGER, note TEXT)")
        connection.exec_driver_sql("INSERT INTO time_entries VALUES ('legacy', 123, 'Retain original record')")
        connection.exec_driver_sql("CREATE TABLE task_lifecycle_coverage (id INTEGER PRIMARY KEY, started_at VARCHAR(40))")
        connection.exec_driver_sql("INSERT INTO task_lifecycle_coverage VALUES (1, '2026-01-01T00:00:00Z')")
        if partial:
            connection.exec_driver_sql("ALTER TABLE time_entries ADD COLUMN continued_from_id VARCHAR(36)")
        added = ensure_execution_columns(connection)
        assert set(added) == set(COLUMNS) - ({"continued_from_id"} if partial else set())
        assert ensure_execution_columns(connection) == []
        assert tuple(connection.execute(text("SELECT duration_seconds,note,continued_from_id,start_kind,stop_reason FROM time_entries")).one()) == (123, "Retain original record", None, None, None)
        assert connection.scalar(text("SELECT started_at FROM task_lifecycle_coverage")) == "2026-01-01T00:00:00Z"
        columns = {row["name"]: row for row in inspect(connection).get_columns("time_entries")}
        assert all(columns[name]["nullable"] for name in COLUMNS)
    with pytest.raises(IntegrityError), database.begin() as connection:
        connection.exec_driver_sql("UPDATE time_entries SET continued_from_id='source'")
        connection.exec_driver_sql("INSERT INTO time_entries (id,continued_from_id) VALUES ('duplicate','source')")


def test_fresh_database_is_left_to_metadata_creation(database):
    with database.begin() as connection:
        assert ensure_execution_columns(connection) == []
        assert not inspect(connection).has_table("time_entries")


def test_repair_cli_refuses_production_before_connecting(monkeypatch):
    from backend.app import config
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(environment="production"))
    with pytest.raises(SystemExit) as result:
        main(["--repair"])
    assert result.value.code == 2


def test_failed_bootstrap_rolls_back_columns_and_index(database):
    with database.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE time_entries (id VARCHAR(36) PRIMARY KEY)")
    with pytest.raises(RuntimeError), database.begin() as connection:
        ensure_execution_columns(connection)
        raise RuntimeError("Simulated startup failure")
    with database.connect() as connection:
        assert {row["name"] for row in inspect(connection).get_columns("time_entries")} == {"id"}
        assert inspect(connection).get_indexes("time_entries") == []


def test_simultaneous_bootstraps_only_add_columns_once(database):
    with database.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE time_entries (id VARCHAR(36) PRIMARY KEY)")
    def bootstrap(_):
        with database.begin() as connection:
            return ensure_execution_columns(connection)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(bootstrap, range(2)))
    assert sorted(map(len, results)) == [0, 3]


def test_startup_repairs_existing_timers_before_metadata_and_seed():
    source = (Path(__file__).parents[1] / "app/main.py").read_text()
    initialize = source.split("def initialize_schema() -> None:", 1)[1].split('@app.on_event("startup")', 1)[0]
    assert initialize.index("ensure_execution_columns(connection)") < initialize.index("Base.metadata.create_all") < initialize.index("seed_database()")
