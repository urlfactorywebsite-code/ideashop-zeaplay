from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import os
import threading
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.models import RealtimeAggregate, RealtimeOutbox
from backend.app.realtime.contracts import Event
from backend.app.realtime.outbox import enqueue, relay_batch


URL = os.environ.get("ZEAPLAY_RT_POSTGRES_TEST_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires explicit isolated PostgreSQL rt3_test database")


@pytest.fixture
def postgres_engine():
    assert "rt3_test" in (make_url(URL).database or ""), "Refusing non-scratch PostgreSQL database"
    schema = "rt3_refinement_" + uuid4().hex
    admin = create_engine(URL)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(URL)
    @event.listens_for(engine, "connect")
    def configure(connection, _):
        cursor = connection.cursor()
        cursor.execute(f'SET search_path TO "{schema}"')
        cursor.execute("SET statement_timeout TO 5000")
        cursor.close()
        connection.commit()
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_postgresql_migration_preserves_existing_rows_and_refuses_history_loss(postgres_engine, monkeypatch):
    migration = import_module("backend.alembic.versions.fc4d5e6f7a8b_realtime_outbox")
    with postgres_engine.begin() as connection:
        connection.execute(text("CREATE TABLE legacy_balances (id integer primary key, points integer)"))
        connection.execute(text("INSERT INTO legacy_balances VALUES (1, 125)"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        indexes = {row["name"]: row for row in inspect(connection).get_indexes("realtime_outbox")}
        assert indexes["ix_realtime_outbox_due"]["column_names"] == ["status", "next_attempt_at", "created_at"]
        assert indexes["uq_realtime_outbox_version"]["unique"]
        enqueue(connection, Event(tenant_id="tenant", resource_type="task", resource_id="task", event_type="task.changed"))
        with pytest.raises(RuntimeError, match="Retain"):
            migration.downgrade()
        connection.execute(RealtimeOutbox.__table__.delete())
        with pytest.raises(RuntimeError, match="Retain"):
            migration.downgrade()
        connection.execute(RealtimeAggregate.__table__.delete())
        migration.downgrade()
        assert connection.scalar(text("SELECT points FROM legacy_balances WHERE id=1")) == 125


def test_delayed_postgresql_transaction_is_invisible_and_rollback_releases_order(postgres_engine):
    RealtimeAggregate.__table__.create(postgres_engine)
    RealtimeOutbox.__table__.create(postgres_engine)
    with postgres_engine.begin() as connection:
        connection.execute(text("CREATE TABLE business (id integer primary key)"))
    def envelope():
        return Event(tenant_id="tenant", resource_type="task", resource_id="same-task", event_type="task.changed")
    started = threading.Event()
    second_event = envelope()
    def concurrent_write():
        with Session(postgres_engine) as db:
            db.execute(text("INSERT INTO business VALUES (2)"))
            started.set()
            enqueue(db.connection(), second_event)
            db.commit()
    with ThreadPoolExecutor(max_workers=1) as executor, Session(postgres_engine) as first:
        first.execute(text("INSERT INTO business VALUES (1)"))
        enqueue(first.connection(), envelope())
        future = executor.submit(concurrent_write)
        try:
            assert started.wait(5)
            with Session(postgres_engine) as observer:
                assert observer.scalar(text("SELECT count(*) FROM business")) == 0
                assert relay_batch(observer, publisher=lambda *args, **kwargs: pytest.fail("Published uncommitted state")) == 0
            assert not future.done()
        finally:
            first.rollback()
        future.result(timeout=6)
    with Session(postgres_engine) as db:
        assert db.scalar(text("SELECT id FROM business")) == 2
        row = db.query(RealtimeOutbox).one()
        assert row.event_id == second_event.event_id and row.aggregate_version == 1
