"""Run only against an explicitly named scratch database, never the app's configured DB."""
from concurrent.futures import ThreadPoolExecutor
import os
import threading
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.models import RealtimeAggregate, RealtimeOutbox
from backend.app.realtime.contracts import Event
from backend.app.realtime.outbox import enqueue, relay_batch

URL = os.environ.get("ZEAPLAY_RT_POSTGRES_TEST_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires ZEAPLAY_RT_POSTGRES_TEST_URL naming a database containing rt3_test")


def test_postgresql_rollback_and_two_relays_skip_locked_preserve_aggregate_order():
    assert "rt3_test" in (make_url(URL).database or ""), "Refusing non-scratch PostgreSQL database"
    schema = "rt3_" + uuid4().hex
    admin = create_engine(URL)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(URL)
    @event.listens_for(engine, "connect")
    def search_path(connection, _):
        cursor = connection.cursor()
        cursor.execute(f'SET search_path TO "{schema}"')
        cursor.close()
        connection.commit()
    try:
        RealtimeAggregate.__table__.create(engine)
        RealtimeOutbox.__table__.create(engine)
        def message():
            return Event(tenant_id="tenant", resource_type="task", resource_id="task", event_type="task.changed")
        with Session(engine) as db:
            db.execute(text("CREATE TABLE business (id integer primary key)"))
            db.commit()
            db.execute(text("INSERT INTO business VALUES (1)"))
            enqueue(db.connection(), message())
            db.rollback()
            assert db.scalar(text("SELECT count(*) FROM business")) == 0
            assert db.query(RealtimeOutbox).count() == 0
            enqueue(db.connection(), message())
            enqueue(db.connection(), message())
            db.commit()
        entered, release = threading.Event(), threading.Event()
        delivered = []
        def slow_publish(event, **kwargs):
            delivered.append(event.aggregate_version)
            entered.set()
            assert release.wait(5)
        def first_relay():
            with Session(engine) as db:
                return relay_batch(db, publisher=slow_publish)
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(first_relay)
            try:
                assert entered.wait(5)
                with Session(engine) as db:
                    assert relay_batch(db, publisher=lambda *args, **kwargs: pytest.fail("Skipped aggregate ordering")) == 0
            finally:
                release.set()
            assert future.result(timeout=5) == 1
        with Session(engine) as db:
            assert relay_batch(db, publisher=lambda event, **kwargs: delivered.append(event.aggregate_version)) == 1
        assert delivered == [1, 2]
    finally:
        engine.dispose()
        with admin.begin() as connection:
            # Only the random schema created above in the explicitly named scratch database is removed.
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
