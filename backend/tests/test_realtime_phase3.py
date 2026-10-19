import asyncio
from datetime import datetime, timedelta, timezone
from importlib import import_module
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app import models
from backend.app.config import get_settings
from backend.app.realtime import capture, transport
from backend.app.realtime.contracts import Event
from backend.app.realtime.outbox import backlog, enqueue, prune, relay_batch


@pytest.fixture
def engine():
    engine = create_engine("sqlite://")
    models.RealtimeAggregate.__table__.create(engine)
    models.RealtimeOutbox.__table__.create(engine)
    yield engine
    engine.dispose()


def envelope(**updates):
    return Event(tenant_id="tenant-a", resource_type="ticket", resource_id="ticket-a", event_type="ticket.changed", **updates)


def test_envelope_rejects_unknown_versions_extra_fields_and_large_payload(monkeypatch):
    event = envelope()
    assert Event.decode(event.encode()) == event
    with pytest.raises(ValueError):
        Event.decode(event.encode().replace('"event_version":1', '"event_version":2'))
    with pytest.raises(ValueError):
        Event.model_validate({**event.model_dump(), "token": "not-allowed"})
    monkeypatch.setattr(get_settings(), "realtime_max_event_bytes", 20)
    with pytest.raises(ValueError):
        event.encode()


def test_outbox_rollback_and_stable_aggregate_sequence(engine):
    with Session(engine) as db:
        db.execute(text("CREATE TABLE business (id INTEGER PRIMARY KEY)"))
        db.commit()
        db.execute(text("INSERT INTO business VALUES (1)"))
        enqueue(db.connection(), envelope())
        db.rollback()
        assert db.scalar(text("SELECT count(*) FROM business")) == 0
        assert db.query(models.RealtimeOutbox).count() == 0
        for _ in range(3):
            enqueue(db.connection(), envelope())
        db.commit()
        assert db.scalars(select(models.RealtimeOutbox.aggregate_version).order_by(models.RealtimeOutbox.aggregate_version)).all() == [1, 2, 3]


def test_retry_exhaustion_blocks_only_its_aggregate_and_restart_reuses_id(engine):
    with Session(engine) as db:
        first = envelope()
        enqueue(db.connection(), first)
        enqueue(db.connection(), envelope())
        enqueue(db.connection(), Event(tenant_id="tenant-b", resource_type="ticket", resource_id="other", event_type="ticket.changed"))
        db.commit()
        calls = []
        def failing(event, **kwargs):
            calls.append(event.event_id)
            if event.event_id == first.event_id:
                raise ConnectionError("secret provider failure must not be retained")
        assert relay_batch(db, publisher=failing) == 2
        row = db.get(models.RealtimeOutbox, first.event_id)
        assert row.status == "PENDING" and row.attempt_count == 1
        assert row.last_error == "ConnectionError"
        assert row.next_attempt_at > datetime.utcnow()
        row.attempt_count = 11
        row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
        assert relay_batch(db, publisher=failing) == 1
        assert row.status == "DEAD"
        assert calls.count(first.event_id) == 2
        assert relay_batch(db, publisher=failing) == 0


def test_relay_crash_window_duplicate_is_stable_and_pruning_is_bounded(engine):
    with Session(engine) as db:
        event = envelope()
        enqueue(db.connection(), event)
        db.commit()
        delivered = []
        # Simulate a publish that reached Redis followed by a failure before recording completion.
        def uncertain(event, **kwargs):
            delivered.append(event.event_id)
            raise ConnectionError()
        relay_batch(db, publisher=uncertain)
        row = db.get(models.RealtimeOutbox, event.event_id)
        row.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
        relay_batch(db, publisher=lambda event, **kwargs: delivered.append(event.event_id))
        assert delivered == [event.event_id, event.event_id]
        assert backlog(db)["counts"]["PUBLISHED"] == 1
        row.published_at = datetime.utcnow() - timedelta(days=30)
        db.commit()
        assert prune(db, batch_size=1) == 1


def test_outbox_capacity_rolls_back_instead_of_losing_intent(engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "realtime_outbox_max_pending", 1)
    with Session(engine) as db:
        enqueue(db.connection(), envelope())
        with pytest.raises(RuntimeError, match="capacity"):
            enqueue(db.connection(), envelope())
        db.rollback()
        assert db.query(models.RealtimeOutbox).count() == 0


def test_additive_migration_and_guarded_downgrade():
    migration = import_module("backend.alembic.versions.fc4d5e6f7a8b_realtime_outbox")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE existing_users (id INTEGER, points INTEGER)"))
        connection.execute(text("INSERT INTO existing_users VALUES (1, 125)"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.scalar(text("SELECT points FROM existing_users")) == 125
        enqueue(connection, envelope())
        with pytest.raises(RuntimeError, match="Retain"):
            migration.downgrade()
        connection.execute(models.RealtimeOutbox.__table__.delete())
        with pytest.raises(RuntimeError, match="Retain"):
            migration.downgrade()
        connection.execute(models.RealtimeAggregate.__table__.delete())
        migration.downgrade()
        assert connection.scalar(text("SELECT points FROM existing_users")) == 125


def test_bounded_consumer_deduplicates_and_cleans_resources(monkeypatch):
    monkeypatch.setattr(transport, "get_redis_client", lambda: None)
    async def run():
        received = []
        async def handler(event):
            received.append(event.event_id)
        sub = transport.Subscription("ticket", asyncio.get_running_loop(), handler)
        event = envelope()
        sub.offer(event)
        sub.offer(event)
        await sub.queue.join()
        assert received == [event.event_id]
        assert sub.queue.maxsize == get_settings().realtime_queue_size
        await sub.close()
        assert not sub.thread.is_alive()
        assert sub.consumer.done()
    asyncio.run(run())


@pytest.fixture
def business_db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    computed = models.Task.__table__.c.search_vector.computed
    models.Task.__table__.c.search_vector.computed = None
    models.Base.metadata.create_all(engine)
    models.Task.__table__.c.search_vector.computed = computed
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    tenant = uuid4()
    with factory() as db:
        db.add(models.User(id="creator", tenant_id=tenant, name="Creator", email="creator@example.com", hashed_password="test",
                           role=models.RoleEnum.OWNER, status=models.UserStatusEnum.ACTIVE))
        db.commit()
    yield factory, tenant
    engine.dispose()


def test_real_orm_mutation_and_outbox_are_one_transaction(business_db, monkeypatch):
    factory, tenant = business_db
    monkeypatch.setattr(get_settings(), "realtime_outbox_enabled", True)
    monkeypatch.setattr(get_settings(), "realtime_outbox_categories", ["task", "chat", "ticket"])
    with factory() as db:
        task = models.Task(id=str(uuid4()), title="Rollback target", description="", created_by_id="creator", team="General")
        db.add(task)
        db.flush()
        assert db.query(models.RealtimeOutbox).count() == 1
        db.rollback()
        assert db.get(models.Task, task.id) is None
        assert db.query(models.RealtimeOutbox).count() == 0
        task = models.Task(title="Committed target", description="", created_by_id="creator", team="General")
        db.add(task)
        db.commit()
        row = db.query(models.RealtimeOutbox).one()
        assert row.tenant_id == str(tenant) and row.aggregate_id == task.id
        assert row.status == "PENDING"
        assert row.payload["payload"]["task_id"] == task.id


def test_ticket_fallback_publishes_only_after_commit(business_db, monkeypatch):
    from backend.app.tickets.models import Ticket
    factory, tenant = business_db
    delivered = []
    monkeypatch.setattr(capture, "publish", delivered.append)
    with factory() as db:
        db.add(Ticket(tenant_id=tenant, created_by="creator", title="Rolled back", description=""))
        db.flush()
        assert delivered == []
        db.rollback()
        db.add(Ticket(tenant_id=tenant, created_by="creator", title="Committed", description=""))
        db.commit()
        assert len(delivered) == 1
        assert delivered[0].tenant_id == str(tenant)
        assert db.query(models.RealtimeOutbox).count() == 0


def test_ticket_fanout_revalidates_tenant_and_revoked_membership(business_db, monkeypatch):
    from backend.app.tickets.models import Ticket, TicketParticipant, TicketParticipantRoleEnum
    from backend.app.ws import ticket_chat
    factory, tenant = business_db
    monkeypatch.setattr(ticket_chat, "SessionLocal", factory)
    with factory() as db:
        db.add(models.User(id="member", tenant_id=tenant, name="Member", email="member@example.com", hashed_password="test",
                           role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE))
        ticket = Ticket(tenant_id=tenant, created_by="creator", title="Scoped", description="")
        db.add(ticket)
        db.flush()
        participant = TicketParticipant(tenant_id=tenant, ticket_id=ticket.id, user_id="member", role=TicketParticipantRoleEnum.ASSIGNEE)
        db.add(participant)
        db.commit()
        ticket_id, participant_id = ticket.id, participant.id
    class Socket:
        def __init__(self):
            self.events, self.closed = [], []
        async def accept(self):
            pass
        async def send_json(self, event):
            self.events.append(event)
        async def close(self, code):
            self.closed.append(code)
    async def run():
        manager = ticket_chat.TicketConnectionManager()
        socket = Socket()
        await manager.connect(ticket_id, "member", socket)
        wrong = Event(tenant_id=str(uuid4()), resource_type="ticket", resource_id=str(ticket_id), event_type="ticket.changed")
        await manager.dispatch(wrong)
        assert socket.events == []
        event = wrong.model_copy(update={"tenant_id": str(tenant)})
        await manager.dispatch(event)
        assert len(socket.events) == 1
        with factory() as db:
            db.get(TicketParticipant, participant_id).deleted_at = datetime.now(timezone.utc)
            db.commit()
        await manager.dispatch(event)
        assert len(socket.events) == 1
        assert socket.closed == [1008]
        assert manager.snapshot()["sockets"] == 0
    asyncio.run(run())


def test_bulk_task_mutation_captures_tenant_scoped_intent_and_rollback(business_db, monkeypatch):
    factory, tenant = business_db
    monkeypatch.setattr(get_settings(), "realtime_outbox_enabled", True)
    monkeypatch.setattr(get_settings(), "realtime_outbox_categories", ["task"])
    with factory() as db:
        task = models.Task(title="Bulk target", description="", created_by_id="creator", team="General")
        db.add(task)
        db.commit()
        db.execute(delete(models.Task).where(models.Task.id == task.id))
        assert db.query(models.RealtimeOutbox).count() == 2
        db.rollback()
        assert db.get(models.Task, task.id) is not None
        assert db.query(models.RealtimeOutbox).count() == 1
        db.execute(delete(models.Task).where(models.Task.id == task.id))
        db.commit()
        row = db.query(models.RealtimeOutbox).filter(models.RealtimeOutbox.aggregate_id == str(tenant)).one()
        assert row.payload["payload"] == {"type": "task.changed", "tenant_id": str(tenant), "action": "invalidate"}


def test_slow_consumer_is_disconnected_and_released(business_db, monkeypatch):
    from backend.app.tickets.models import Ticket
    from backend.app.ws import ticket_chat
    factory, tenant = business_db
    monkeypatch.setattr(ticket_chat, "SessionLocal", factory)
    monkeypatch.setattr(get_settings(), "realtime_send_timeout", 0.01)
    with factory() as db:
        ticket = Ticket(tenant_id=tenant, created_by="creator", title="Slow target", description="")
        db.add(ticket)
        db.commit()
        ticket_id = ticket.id
    class SlowSocket:
        async def accept(self):
            pass
        async def send_json(self, message):
            await asyncio.sleep(10)
        async def close(self, code):
            assert code == 1013
    async def run():
        manager = ticket_chat.TicketConnectionManager()
        await manager.connect(ticket_id, "creator", SlowSocket())
        await manager.dispatch(Event(tenant_id=str(tenant), resource_type="ticket", resource_id=str(ticket_id), event_type="ticket.changed"))
        assert manager.snapshot()["sockets"] == 0
    asyncio.run(run())


def test_subscriber_overflow_requests_reconciliation_without_unbounded_tasks(monkeypatch):
    monkeypatch.setattr(transport, "get_redis_client", lambda: None)
    monkeypatch.setattr(get_settings(), "realtime_queue_size", 1)
    async def run():
        release = asyncio.Event()
        gaps = []
        async def handler(event):
            await release.wait()
        async def on_gap():
            gaps.append(True)
        sub = transport.Subscription("ticket", asyncio.get_running_loop(), handler, on_gap)
        sub.offer(envelope())
        await asyncio.sleep(0)
        sub.offer(envelope())
        sub.offer(envelope())
        sub.offer(envelope())
        await asyncio.sleep(0)
        assert sub.queue.qsize() == 1
        assert gaps == [True]
        release.set()
        await sub.queue.join()
        await sub.close()
    asyncio.run(run())


def test_chat_reference_intent_preserves_privacy_and_rolls_back_with_edit(business_db, monkeypatch):
    factory, tenant = business_db
    monkeypatch.setattr(get_settings(), "realtime_outbox_enabled", True)
    monkeypatch.setattr(get_settings(), "realtime_outbox_categories", ["chat"])
    with factory() as db:
        conversation = models.ChatConversation(tenant_id=tenant, type=models.ChatConversationTypeEnum.DIRECT, created_by_id="creator")
        db.add(conversation)
        db.flush()
        message = models.ChatMessage(conversation_id=conversation.id, sender_id="creator", content="Private content stays in the message table", client_id="stable-client-id")
        db.add(message)
        db.commit()
        row = db.query(models.RealtimeOutbox).one()
        assert row.event_type == "message:new"
        assert row.aggregate_id == conversation.id
        assert row.payload["payload"] == {"message_id": message.id}
        message.content = "Rolled back edit"
        db.flush()
        assert db.query(models.RealtimeOutbox).count() == 2
        db.rollback()
        assert db.query(models.RealtimeOutbox).count() == 1
        assert db.get(models.ChatMessage, message.id).content == "Private content stays in the message table"


def test_ticket_snapshot_is_authorized_paginated_and_uses_persisted_cursor(business_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.app.database import get_db
    from backend.app.dependencies import get_current_active_user
    from backend.app.tickets.models import Ticket, TicketComment
    from backend.app.ws.ticket_chat import router
    factory, tenant = business_db
    with factory() as db:
        ticket = Ticket(tenant_id=tenant, created_by="creator", title="Snapshot", description="")
        db.add(ticket)
        db.flush()
        db.add_all([TicketComment(tenant_id=tenant, ticket_id=ticket.id, user_id="creator", body=f"Persisted {index}") for index in range(3)])
        db.commit()
        ticket_id = ticket.id
        user = db.get(models.User, "creator")
    app = FastAPI()
    app.include_router(router)
    def dependency():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_current_active_user] = lambda: user
    with TestClient(app) as client:
        path = f"/ws/tickets/{ticket_id}/snapshot"
        response = client.get(path, params={"limit": 1})
        assert response.status_code == 200
        page = response.json()
        assert len(page["comments"]) == 1 and page["has_more"]
        next_page = client.get(path, params={"limit": 1, "before": page["next_cursor"]}).json()
        assert next_page["comments"][0]["id"] != page["comments"][0]["id"]
        assert client.get(path, params={"limit": 201}).status_code == 422
        assert client.get(path, params={"before": str(uuid4())}).status_code == 404
        foreign = models.User(id="foreign", tenant_id=uuid4(), role=models.RoleEnum.OWNER)
        app.dependency_overrides[get_current_active_user] = lambda: foreign
        assert client.get(path).status_code == 404


def test_processing_and_reconciliation_failure_do_not_kill_consumer(monkeypatch):
    monkeypatch.setattr(transport, "get_redis_client", lambda: None)
    async def run():
        processed = []
        async def handler(event):
            if not processed:
                processed.append("failed")
                raise RuntimeError("private contents must not be logged")
            processed.append("recovered")
        async def gap():
            raise RuntimeError("private gap failure")
        before = transport.metrics["reconciliation_errors"]
        sub = transport.Subscription("ticket", asyncio.get_running_loop(), handler, gap)
        sub.offer(envelope())
        sub.offer(envelope())
        await sub.queue.join()
        assert processed == ["failed", "recovered"]
        assert transport.metrics["reconciliation_errors"] == before + 1
        assert not sub.consumer.done()
        await sub.close()
    asyncio.run(run())


def test_supervised_consumer_and_gap_tasks_stop_with_subscription(monkeypatch):
    monkeypatch.setattr(transport, "get_redis_client", lambda: None)
    async def run():
        entered = asyncio.Event()
        async def handler(event):
            pass
        async def gap():
            entered.set()
            await asyncio.Event().wait()
        sub = transport.Subscription("ticket", asyncio.get_running_loop(), handler, gap)
        await asyncio.sleep(0)
        previous = sub.consumer
        previous.cancel()
        await asyncio.gather(previous, return_exceptions=True)
        await entered.wait()
        assert sub.consumer is not previous and not sub.consumer.done()
        pending_gap = sub.gap_task
        sub.request_reconciliation()
        assert sub.gap_task is pending_gap
        await sub.close()
        assert sub.consumer.done() and pending_gap.cancelled()
        assert not sub.thread.is_alive()
    asyncio.run(run())


def test_chat_old_socket_cannot_survive_tenant_change(business_db, monkeypatch):
    from backend.app.ws import chat
    factory, tenant = business_db
    monkeypatch.setattr(chat, "SessionLocal", factory)
    monkeypatch.setattr(chat, "publish_chat_event", lambda *args: None)
    class Socket:
        def __init__(self):
            self.messages, self.closed = [], []
        async def accept(self):
            pass
        async def send_json(self, message):
            self.messages.append(message)
        async def close(self, code):
            self.closed.append(code)
    async def run():
        manager = chat.ChatConnectionManager()
        socket = Socket()
        with factory() as db:
            await manager.connect(socket, db.get(models.User, "creator"))
            user = db.get(models.User, "creator")
            user.tenant_id = uuid4()
            db.commit()
        socket.messages.clear()
        await manager.broadcast_tenant(str(tenant), "presence:changed", {"tenant_id": str(tenant)})
        assert socket.messages == [] and socket.closed == [1008]
        assert manager.snapshot()["sockets"] == 0
        assert not manager._presence
    asyncio.run(run())


def test_concurrent_subscriber_startup_shares_one_redis_pool(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    import time
    from backend.app import cache
    created, closed = [], []
    client = SimpleNamespace(close=lambda: closed.append(True))
    def from_url(*args, **kwargs):
        time.sleep(0.02)
        created.append(client)
        return client
    monkeypatch.setattr(cache, "_REDIS_CLIENT", None)
    monkeypatch.setattr(cache, "redis", SimpleNamespace(Redis=SimpleNamespace(from_url=from_url)))
    monkeypatch.setattr(get_settings(), "redis_url", "redis://isolated.invalid")
    with ThreadPoolExecutor(max_workers=3) as executor:
        clients = list(executor.map(lambda _: cache.get_redis_client(), range(3)))
    assert clients == [client, client, client] and len(created) == 1
    cache.close_redis_client()
    assert closed == [True] and cache._REDIS_CLIENT is None


@pytest.mark.parametrize("category", ["chat", "task", "ticket"])
def test_gap_cleanup_does_not_drop_newly_connected_sockets(business_db, monkeypatch, category):
    from backend.app.ws import chat, tasks, ticket_chat
    factory, tenant = business_db
    module = {"chat": chat, "task": tasks, "ticket": ticket_chat}[category]
    monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(chat, "publish_chat_event", lambda *args: None)
    async def run():
        closing, release = asyncio.Event(), asyncio.Event()
        class Socket:
            def __init__(self, slow=False):
                self.slow = slow
            async def accept(self):
                pass
            async def send_json(self, message):
                pass
            async def close(self, code):
                if self.slow:
                    closing.set()
                    await release.wait()
        manager = {"chat": chat.ChatConnectionManager, "task": tasks.TaskConnectionManager,
                   "ticket": ticket_chat.TicketConnectionManager}[category]()
        async def connect(socket):
            if category == "chat":
                with factory() as db:
                    await manager.connect(socket, db.get(models.User, "creator"))
            else:
                await manager.connect(str(tenant), "creator", socket)
        await connect(Socket(slow=True))
        cleanup = asyncio.create_task(manager.close_all())
        await closing.wait()
        await connect(Socket())
        assert manager.snapshot()["sockets"] == 1
        release.set()
        await cleanup
        assert manager.snapshot()["sockets"] == 1
        await manager.close_all()
        assert manager.snapshot()["sockets"] == 0
    asyncio.run(run())
