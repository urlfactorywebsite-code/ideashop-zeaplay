import asyncio
import sys
import threading
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
import pytest
from starlette.datastructures import Headers
from starlette.websockets import WebSocketDisconnect

from backend.app import models
from backend.app.config import get_settings
from backend.app.realtime import capture, relay, transport
from backend.app.realtime.outbox import enqueue, relay_batch
from backend.app.tickets.models import Ticket
from backend.app.ws import chat, security, tasks
from backend.tests.test_realtime_phase3 import business_db, engine, envelope


def origin_socket(scope):
    return SimpleNamespace(headers=Headers(raw=scope["headers"]))


@pytest.mark.parametrize("origin", [
    "null", "", "https://trusted.example/path", "https://trusted.example/", "https://trusted.example?",
    "https://trusted.example#", "https://name@trusted.example", "https://trusted.example:bad",
    "https://trusted.example:", "https://[broken", "https://trusted.example,https://evil.example",
    " https://trusted.example", "https://trusted.example\n", "ftp://trusted.example",
    "https://trusted.example\\evil", "https://evil.example",
])
def test_malformed_websocket_origin_fails_closed(monkeypatch, origin):
    monkeypatch.setattr(get_settings(), "websocket_trusted_origins", ["https://trusted.example"])
    socket = origin_socket({"type": "websocket", "headers": [(b"origin", origin.encode())]})
    assert security.validate_websocket_origin(socket) is False


def test_origin_duplicate_headers_wildcard_and_missing_policy(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_trusted_origins", ["https://trusted.example"])
    header = (b"origin", b"https://trusted.example")
    assert not security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": [header, header]}))
    assert security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": [header]}))
    monkeypatch.setattr(settings, "websocket_require_origin", True)
    assert not security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": []}))
    monkeypatch.setattr(settings, "websocket_require_origin", False)
    assert security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": []}))
    monkeypatch.setattr(settings, "websocket_trusted_origins", ["*"])
    monkeypatch.setattr(settings, "environment", "production")
    assert not security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": [header]}))


@pytest.mark.parametrize("origin", ["https://TRUSTED.example:443", "http://localhost:6300", "https://[::1]:443"])
def test_valid_origins_normalize_without_weakening_identity(monkeypatch, origin):
    monkeypatch.setattr(get_settings(), "websocket_trusted_origins", ["https://trusted.example", "http://localhost:6300", "https://[::1]"])
    assert security.validate_websocket_origin(origin_socket({"type": "websocket", "headers": [(b"origin", origin.encode())]}))


@pytest.mark.parametrize("mutation", ["disabled", "moved", "credentials"])
@pytest.mark.parametrize("action", ["presence:heartbeat", "message:send", "typing:start"])
def test_chat_revoked_user_cannot_mutate_over_existing_socket(business_db, monkeypatch, mutation, action):
    factory, tenant = business_db
    monkeypatch.setattr(chat, "SessionLocal", factory)
    monkeypatch.setattr(chat, "manager", chat.ChatConnectionManager())
    monkeypatch.setattr(chat, "publish_chat_event", lambda *args: None)
    monkeypatch.setattr(get_settings(), "websocket_require_origin", False)
    monkeypatch.setattr(get_settings(), "websocket_require_ticket", False)
    token = jwt.encode({"sub": "creator", "tenant_id": str(tenant), "token_type": "access"}, get_settings().jwt_secret_key, algorithm=get_settings().jwt_algorithm)
    app = FastAPI()
    app.include_router(chat.router)
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/chat?token={token}") as socket:
            socket.receive_json()
            with factory() as db:
                user = db.get(models.User, "creator")
                if mutation == "disabled":
                    user.status = models.UserStatusEnum.DEACTIVATED
                elif mutation == "moved":
                    user.tenant_id = uuid4()
                else:
                    user.credentials_version += 1
                db.commit()
            socket.send_json({"type": action, "payload": {"content": "Must not persist"}})
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008
    with factory() as db:
        assert db.query(models.ChatMessage).count() == 0
    assert chat.manager.snapshot()["sockets"] == 0


def test_task_pong_revalidates_disabled_user(business_db, monkeypatch):
    factory, tenant = business_db
    monkeypatch.setattr(tasks, "SessionLocal", factory)
    monkeypatch.setattr(tasks, "manager", tasks.TaskConnectionManager())
    monkeypatch.setattr(get_settings(), "websocket_require_origin", False)
    monkeypatch.setattr(get_settings(), "websocket_require_ticket", False)
    token = jwt.encode({"sub": "creator", "tenant_id": str(tenant), "token_type": "access"}, get_settings().jwt_secret_key, algorithm=get_settings().jwt_algorithm)
    app = FastAPI()
    app.include_router(tasks.router)
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/tasks?token={token}") as socket:
            assert socket.receive_json()["type"] == "realtime:ready"
            with factory() as db:
                db.get(models.User, "creator").status = models.UserStatusEnum.DEACTIVATED
                db.commit()
            socket.send_json({"type": "pong"})
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008


def test_public_space_socket_join_persists_authorized_membership(business_db, monkeypatch):
    factory, tenant = business_db
    monkeypatch.setattr(chat, "SessionLocal", factory)
    monkeypatch.setattr(chat, "manager", chat.ChatConnectionManager())
    monkeypatch.setattr(chat, "publish_chat_event", lambda *args: None)
    monkeypatch.setattr(get_settings(), "websocket_require_origin", False)
    monkeypatch.setattr(get_settings(), "websocket_require_ticket", False)
    with factory() as db:
        conversation = models.ChatConversation(tenant_id=tenant, type=models.ChatConversationTypeEnum.SPACE,
                                               is_private=False, created_by_id="creator")
        db.add(conversation)
        db.commit()
        conversation_id = conversation.id
    token = jwt.encode({"sub": "creator", "tenant_id": str(tenant), "token_type": "access"}, get_settings().jwt_secret_key, algorithm=get_settings().jwt_algorithm)
    app = FastAPI()
    app.include_router(chat.router)
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/chat?token={token}") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat:join", "payload": {"conversation_id": conversation_id}})
            assert socket.receive_json()["type"] == "chat:joined"
            with factory() as db:
                assert db.query(models.ChatParticipant).filter_by(conversation_id=conversation_id, user_id="creator").count() == 1


def test_savepoint_rollback_retains_outer_postcommit_intent(business_db, monkeypatch):
    factory, tenant = business_db
    delivered = []
    monkeypatch.setattr(capture, "publish", delivered.append)
    with factory() as db:
        outer = Ticket(tenant_id=tenant, created_by="creator", title="Outer committed", description="")
        db.add(outer)
        db.flush()
        outer_id = str(outer.id)
        savepoint = db.begin_nested()
        db.add(Ticket(tenant_id=tenant, created_by="creator", title="Rolled back", description=""))
        db.flush()
        with db.begin_nested():
            db.add(Ticket(tenant_id=tenant, created_by="creator", title="Nested then rolled back", description=""))
        savepoint.rollback()
        db.commit()
        assert [event.resource_id for event in delivered] == [outer_id]
        assert db.query(Ticket).count() == 1


def test_postcommit_delivery_failure_cannot_fail_committed_write(business_db, monkeypatch, caplog):
    factory, tenant = business_db
    def unavailable(event):
        raise RuntimeError("private failure contents")
    monkeypatch.setattr(capture, "publish", unavailable)
    with factory() as db:
        db.add(Ticket(tenant_id=tenant, created_by="creator", title="Committed despite fanout error", description=""))
        db.commit()
        assert db.query(Ticket).count() == 1
    assert "private failure contents" not in caplog.text


def test_relay_rejects_corrupt_envelope_identity(engine):
    from sqlalchemy.orm import Session
    with Session(engine) as db:
        event = envelope()
        enqueue(db.connection(), event)
        db.commit()
        row = db.get(models.RealtimeOutbox, event.event_id)
        row.payload = {**row.payload, "tenant_id": "forged-tenant"}
        db.commit()
        assert relay_batch(db, publisher=lambda *args, **kwargs: pytest.fail("Published corrupt identity")) == 1
        assert row.attempt_count == 1 and row.last_error == "ValueError"


def test_relay_does_not_sleep_between_available_heads(monkeypatch):
    calls, waits, prunes = [], [], []
    class Stop:
        stopped = False
        def is_set(self):
            return self.stopped
        def set(self):
            self.stopped = True
        def wait(self, delay):
            waits.append(delay)
            self.set()
    class Session:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
    def process(db):
        calls.append(True)
        return 1 if len(calls) == 1 else 0
    monkeypatch.setattr(sys, "argv", ["relay"])
    monkeypatch.setattr(get_settings(), "realtime_outbox_enabled", True)
    monkeypatch.setattr(relay.threading, "Event", Stop)
    monkeypatch.setattr(relay.signal, "signal", lambda *args: None)
    monkeypatch.setattr(relay, "SessionLocal", Session)
    monkeypatch.setattr(relay, "relay_batch", process)
    monkeypatch.setattr(relay, "prune", lambda db: prunes.append(True))
    relay.main()
    assert len(calls) == 2 and waits == [1] and prunes == [True]


def test_local_thread_handoff_is_bounded_before_event_loop_consumes(monkeypatch):
    monkeypatch.setattr(transport, "get_redis_client", lambda: None)
    monkeypatch.setattr(get_settings(), "realtime_queue_size", 4)
    async def run():
        gaps = []
        async def handler(event):
            pass
        async def gap():
            gaps.append(True)
        sub = transport.Subscription("ticket", asyncio.get_running_loop(), handler, gap)
        thread = threading.Thread(target=lambda: [sub.submit(envelope()) for _ in range(1000)])
        thread.start()
        thread.join()
        assert sub.handoff_pending == 4 and sub.handoff_overflow
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await sub.queue.join()
        assert sub.handoff_pending == 0 and gaps == [True]
        await sub.close()
    asyncio.run(run())
