"""Notification isolation, committed live invalidation, and comment privacy."""
import asyncio
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import FastAPI, HTTPException
import httpx
from jose import jwt
import pytest
from sqlalchemy import select
import uvicorn

from backend.app import models
from backend.app.dependencies import settings
from backend.app.database import get_db
from backend.app.routers import comments, notifications
from backend.app.services import notification_stream as stream
from backend.app.services import notification_dispatcher as dispatcher
from backend.tests.test_push_dispatch import engine, fixture, notify


def token_for(user, **overrides):
    claims = dict(sub=user.id, user_id=user.id, tenant_id=str(user.tenant_id), token_type="access",
                  credentials_version=user.credentials_version,
                  exp=datetime.now(timezone.utc) + timedelta(minutes=5))
    claims.update(overrides)
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def snapshot(fixture, token=None):
    return stream.notification_snapshot(fixture.factory.kw["bind"],
        token=token or token_for(fixture.recipient),
        user_id=fixture.recipient.id, tenant_id=fixture.recipient.tenant_id)


def test_committed_create_read_delete_invalidate_only_recipient(fixture):
    baseline = snapshot(fixture)
    assert baseline[0] == 0
    with fixture.factory() as db:
        notify(db, fixture)
        assert snapshot(fixture) == baseline
        db.rollback()
    assert snapshot(fixture) == baseline
    with fixture.factory() as db:
        notice = notify(db, fixture)
        db.commit()
    created = snapshot(fixture)
    assert created[0] == 1 and created[2] == 1
    with fixture.factory() as db:
        notify(db, fixture, user_id=fixture.actor.id)
        db.commit()
    assert snapshot(fixture) == created
    with fixture.factory() as db:
        db.get(models.Notification, notice.id).is_read = True
        db.commit()
    read = snapshot(fixture)
    assert read != created and read[2] == 0
    with fixture.factory() as db:
        db.delete(db.get(models.Notification, notice.id))
        db.commit()
    assert snapshot(fixture)[0] == 0


@pytest.mark.parametrize("case", ["expired", "wrong-user", "wrong-tenant", "deactivated", "credentials", "moved"])
def test_stream_revalidates_active_session_on_every_snapshot(fixture, case):
    token = token_for(fixture.recipient)
    if case == "expired":
        token = token_for(fixture.recipient, exp=datetime.now(timezone.utc) - timedelta(seconds=1))
    elif case == "wrong-user":
        token = token_for(fixture.actor)
    elif case == "wrong-tenant":
        token = token_for(fixture.recipient, tenant_id=str(uuid4()))
    else:
        with fixture.factory() as db:
            recipient = db.get(models.User, fixture.recipient.id)
            if case == "deactivated":
                recipient.status = models.UserStatusEnum.DEACTIVATED
            elif case == "credentials":
                recipient.credentials_version += 1
            else:
                recipient.tenant_id = uuid4()
            db.commit()
    with pytest.raises(HTTPException) as error:
        snapshot(fixture, token)
    assert error.value.status_code == 401


def test_stream_initial_event_commit_event_and_clean_disconnect(fixture, monkeypatch):
    class Request:
        disconnected = False
        async def is_disconnected(self):
            return self.disconnected
    request = Request()
    monkeypatch.setattr(stream, "POLL_SECONDS", 0)

    async def scenario():
        events = stream.notification_events(request, fixture.factory.kw["bind"],
            token=token_for(fixture.recipient), user_id=fixture.recipient.id,
            tenant_id=fixture.recipient.tenant_id)
        first = await anext(events)
        assert "event: notifications.changed\n" in first
        assert fixture.recipient.id not in first
        with fixture.factory() as db:
            notify(db, fixture)
            db.commit()
        assert await anext(events) == first
        request.disconnected = True
        with pytest.raises(StopAsyncIteration):
            await anext(events)
    asyncio.run(scenario())


@pytest.mark.parametrize("role", list(models.RoleEnum))
def test_task_notifications_match_actual_read_access(fixture, role):
    with fixture.factory() as db:
        unrelated = models.User(id=str(uuid4()), tenant_id=fixture.actor.tenant_id,
            name="Unrelated", email=f"{uuid4()}@example.test", hashed_password="synthetic",
            role=role, status=models.UserStatusEnum.ACTIVE)
        db.add(unrelated)
        db.flush()
        result = notify(db, fixture, user_id=unrelated.id)
        assert (result is not None) == (role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER})
        # Subtask assignment grants access to its parent and notification.
        db.add(models.Subtask(task_id=fixture.task.id, title="Assigned work", assigned_to_id=unrelated.id))
        db.flush()
        db.expire(db.get(models.Task, fixture.task.id), ["subtasks"])
        assert notify(db, fixture, user_id=unrelated.id) is not None


def test_mentions_cannot_copy_task_content_to_unrelated_user_chat(fixture):
    with fixture.factory() as db:
        recipient = db.get(models.User, fixture.recipient.id)
        recipient.role = models.RoleEnum.USER
        task = db.get(models.Task, fixture.task.id)
        task.assigned_to_id = fixture.actor.id
        db.flush()
        comment = models.Comment(task_id=task.id, user_id=fixture.actor.id,
                                 content="@Recipient private task content")
        db.add(comment)
        db.flush()
        comments._bridge_comment_mentions_to_chat(db, task=task, comment=comment,
                                                  actor=db.get(models.User, fixture.actor.id))
        assert list(db.scalars(select(models.ChatMessage))) == []
        assert list(db.scalars(select(models.ChatConversation))) == []
        with pytest.raises(HTTPException):
            comments._ensure_comment_access(task, db.get(models.User, fixture.foreign.id))


def test_rewards_preference_mutes_push_but_preserves_history(fixture):
    with fixture.factory() as db:
        db.add(models.NotificationPreference(user_id=fixture.recipient.id, module="rewards", push_enabled=False))
        notice = notify(db, fixture, notification_type=models.NotificationTypeEnum.ACHIEVEMENT_UNLOCKED)
        db.commit()
        assert db.get(models.Notification, notice.id)
    assert not fixture.sent


def test_automation_events_wait_for_outer_commit_and_ignore_duplicates(fixture, monkeypatch):
    forwarded = []
    monkeypatch.setattr(dispatcher, "trigger_n8n_event", lambda name, body: forwarded.append((name, body)))
    with fixture.factory() as db:
        notify(db, fixture, dedupe_key="rolled-back")
        db.rollback()
        assert forwarded == []
        with db.begin_nested():
            notice = notify(db, fixture, dedupe_key="committed")
        assert forwarded == []
        db.commit()
        assert len(forwarded) == 1
        assert forwarded[0][0] == "notification.created"
        assert forwarded[0][1]["id"] == notice.id
        assert isinstance(forwarded[0][1]["created_at"], str)
        notify(db, fixture, dedupe_key="committed")
        db.commit()
        assert len(forwarded) == 1


def test_push_failure_does_not_suppress_committed_automation(fixture, monkeypatch):
    forwarded = []
    monkeypatch.setattr(dispatcher, "trigger_n8n_event", lambda *args: forwarded.append(args))
    def unavailable(*args, **kwargs):
        raise RuntimeError("provider unavailable")
    monkeypatch.setattr(dispatcher.push_service, "send_push", unavailable)
    with fixture.factory() as db:
        notify(db, fixture)
        db.commit()
    assert len(forwarded) == 1


@pytest.mark.parametrize("role", list(models.RoleEnum))
def test_real_http_stream_updates_without_refresh_and_requires_auth(fixture, role):
    with fixture.factory() as db:
        db.get(models.User, fixture.recipient.id).role = role
        db.commit()
    app = FastAPI()
    app.include_router(notifications.router, prefix="/api")
    def database():
        with fixture.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(.01)
        assert server.started
        with httpx.Client(base_url=origin, timeout=5, trust_env=False) as client:
            assert client.get("/api/notifications/stream").status_code == 401
            headers = {"Authorization": "Bearer " + token_for(fixture.recipient)}
            with client.stream("GET", "/api/notifications/stream", headers=headers) as response:
                assert response.status_code == 200
                assert response.headers["x-accel-buffering"] == "no"
                lines = response.iter_lines()
                def next_event():
                    for line in lines:
                        if line.startswith("data: "):
                            return line
                    raise AssertionError("Stream ended before invalidation")
                assert next_event() == 'data: {"type":"notifications.changed"}'
                started = time.monotonic()
                with fixture.factory() as db:
                    notice = notify(db, fixture)
                    db.commit()
                assert next_event() == 'data: {"type":"notifications.changed"}'
                assert time.monotonic() - started < 4
                history = client.get("/api/notifications", headers=headers).json()
                assert [row["id"] for row in history] == [notice.id]
                foreign_headers = {"Authorization": "Bearer " + token_for(fixture.foreign)}
                assert client.get("/api/notifications", headers=foreign_headers).json() == []
                assert client.post(f"/api/notifications/{notice.id}/read", headers=foreign_headers).status_code == 404
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()
        assert not thread.is_alive()
