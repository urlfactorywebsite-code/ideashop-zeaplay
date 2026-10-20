"""Active work API, locking and interval math on isolated SQLite/PostgreSQL fixtures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text, event

from backend.app import models, schemas
from backend.app.services import subtask_workflow, time_tracking as timers, work_history
from backend.app.work_timer_schema import upgrade, downgrade
from backend.tests.test_task_lifecycle import engine, data, api, auth, NOW  # noqa: F401


def children(data, count):
    with data.factory() as db:
        ids = []
        for number in range(count):
            child = models.Subtask(id=str(uuid4()), task_id=data.task.id, title=f"Work {number}", assigned_to_id=data.owner.id)
            db.add(child); ids.append(child.id)
        db.commit()
        return ids


def role(data, value):
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = value
        db.commit()
    data.owner.role = value


@pytest.mark.parametrize("effective_role,limit", [(models.RoleEnum.USER, 3), (models.RoleEnum.MANAGER, 5)])
def test_limits_duplicate_pause_resume_and_demotion(data, effective_role, limit):
    ids = children(data, 7)
    role(data, effective_role)
    with data.factory() as db:
        entries = [timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=id)) for id in ids[:limit]]
        assert timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=ids[0])).id == entries[0].id
        with pytest.raises(HTTPException) as caught:
            timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=ids[limit]))
        assert caught.value.status_code == 409
        assert caught.value.detail["limit"] == limit
        db.rollback()
        timers.stop_timer(db, data.owner, entry_id=entries[0].id, reason="paused")
        timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=ids[limit]))
        with pytest.raises(HTTPException, match="409"):
            timers.resume_timer(db, data.owner, entries[0].id)
        db.rollback()
        snapshot = work_history.read(db, data.owner, active=True)
        assert snapshot["running_count"] == limit
        assert len([row for row in snapshot["items"] if row["status"] == "PAUSED"]) == 1
    if limit == 5:
        role(data, models.RoleEnum.USER)
        with data.factory() as db:
            assert work_history.read(db, data.owner, active=True)["running_count"] == 5
            with pytest.raises(HTTPException) as caught:
                timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=ids[6]))
            assert caught.value.detail["limit"] == 3


def test_simultaneous_distinct_starts_cannot_exceed_capacity(data):
    ids = children(data, 10)
    role(data, models.RoleEnum.USER)
    def start(id):
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            try:
                return timers.start_timer(db, actor, schemas.TimeEntryStart(subtask_id=id)).id
            except HTTPException as error:
                assert error.status_code == 409
                return None
    with ThreadPoolExecutor(max_workers=10) as pool:
        started = list(pool.map(start, ids))
    assert len([id for id in started if id]) == 3
    with data.factory() as db:
        assert len(db.scalars(select(models.TimeEntry).where(models.TimeEntry.stopped_at.is_(None))).all()) == 3


def test_interval_history_midnight_ranges_and_paused_stop(data, monkeypatch):
    clock = [NOW.replace(hour=23, minute=59)]
    monkeypatch.setattr(timers, "utc_now", lambda: clock[0])
    role(data, models.RoleEnum.USER)
    with data.factory() as db:
        a = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
        clock[0] += timedelta(seconds=120)
        timers.stop_timer(db, data.owner, entry_id=a.id, reason="paused")
        clock[0] += timedelta(seconds=40)
        b = timers.resume_timer(db, data.owner, a.id)
        clock[0] += timedelta(seconds=80)
        timers.stop_timer(db, data.owner, entry_id=b.id, reason="paused")
        clock[0] += timedelta(seconds=20)
        timers.stop_timer(db, data.owner, entry_id=b.id)
        session = work_history.read(db, data.owner, session_id=a.id)["items"][0]
        assert session["id"] == a.id and session["entry_id"] == b.id
        assert session["status"] == "STOPPED"
        assert session["active_seconds"] == 200 and session["paused_seconds"] == 60
        assert [row["paused_seconds"] for row in session["intervals"]] == [40, 20]
        assert [item["event"] for item in session["timeline"]] == ["Started", "Paused", "Resumed", "Paused", "Stopped"]
        midnight = NOW.replace(hour=0, minute=0) + timedelta(days=1)
        yesterday = work_history.read(db, data.owner, lower=midnight-timedelta(days=1), upper=midnight)["items"][0]
        today = work_history.read(db, data.owner, lower=midnight, upper=midnight+timedelta(days=1))["items"][0]
        assert yesterday["range_active_seconds"] == 60
        assert today["range_active_seconds"] == 140
        assert today["range_paused_seconds"] == 60
        assert not work_history.read(db, data.owner, active=True)["items"]
        with pytest.raises(HTTPException, match="409"):
            timers.resume_timer(db, data.owner, b.id)


def test_refresh_long_running_and_overlapping_session_time(data, monkeypatch):
    clock = [NOW]
    monkeypatch.setattr(timers, "utc_now", lambda: clock[0])
    ids = children(data, 2)
    with data.factory() as db:
        for id in ids:
            timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=id))
    clock[0] += timedelta(hours=49)
    with data.factory() as db:
        snapshot = work_history.read(db, data.owner, active=True)
        assert sum(row["active_seconds"] for row in snapshot["items"]) == 98 * 3600
        assert all(row["running_since"] == NOW for row in snapshot["items"])


def test_waiting_force_start_terminal_parent_and_assignment(data):
    with data.factory() as db:
        child = db.get(models.Subtask, data.child.id)
        child.status = models.SubtaskStatusEnum.WAITING
        predecessor = models.Subtask(id=str(uuid4()), task_id=data.task.id, title="Predecessor")
        db.add(predecessor); db.flush()
        db.add(models.SubtaskDependency(task_id=data.task.id, depends_on_subtask_id=predecessor.id, subtask_id=child.id))
        db.commit()
        with pytest.raises(HTTPException, match="409"):
            timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=child.id))
        db.rollback()
        with pytest.raises(HTTPException, match="422"):
            subtask_workflow.transition_subtask(db, db.get(models.Task, data.task.id), subtask_id=child.id,
                actor=data.owner, target_status=models.SubtaskStatusEnum.IN_PROGRESS, force_start_reason="", can_override=True)
        db.rollback()
        subtask_workflow.transition_subtask(db, db.get(models.Task, data.task.id), subtask_id=child.id,
            actor=data.owner, target_status=models.SubtaskStatusEnum.IN_PROGRESS, force_start_reason="Urgent escalation", can_override=True)
        db.commit()
        first = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=child.id))
        timers.stop_timer(db, data.owner, entry_id=first.id)
        db.get(models.Task, data.task.id).status = models.TaskStatusEnum.DONE; db.commit()
        with pytest.raises(HTTPException, match="409"):
            timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=child.id))


def test_api_auth_ownership_search_pagination_and_utc(api, data):
    ids = children(data, 3)
    with data.factory() as db:
        entries = [timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=id)) for id in ids]
    base = "/api/time-entries"
    started = api.post(f"{base}/start", json={"subtask_id": ids[0]}, headers=auth(data.owner)).json()
    assert started["session"]["id"] == entries[0].id
    assert started["limit"] == 5 and started["running_count"] == 3
    paused = api.post(f"{base}/{entries[0].id}/pause", headers=auth(data.owner)).json()
    assert paused["session"]["status"] == "PAUSED"
    resumed = api.post(f"{base}/{entries[0].id}/resume", headers=auth(data.owner)).json()
    assert resumed["session"]["id"] == entries[0].id and resumed["id"] != entries[0].id
    stopped = api.post(f"{base}/{resumed['id']}/stop", headers=auth(data.owner)).json()
    assert stopped["session"]["status"] == "STOPPED"
    for path in ("work/active", "work/history", f"work/{entries[0].id}/history"):
        assert api.get(f"{base}/{path}").status_code == 401
        body = api.get(f"{base}/{path}", headers=auth(data.owner))
        assert body.status_code == 200, body.text
        assert body.json()["server_time"].endswith(("Z", "+00:00"))
    assert api.get(f"{base}/work/{entries[0].id}/history", headers=auth(data.outsider)).status_code == 404
    for action in ("pause", "resume", "stop"):
        assert api.post(f"{base}/{entries[0].id}/{action}", headers=auth(data.outsider)).status_code == 404
    body = api.get(f"{base}/work/history?limit=1&search=Work", headers=auth(data.owner)).json()
    assert len(body["items"]) == 1 and body["next_offset"] == 1
    body = api.get(f"{base}/work/history?search=nothing-matches", headers=auth(data.owner)).json()
    assert body["items"] == []
    # Same-tenant users still cannot control private sessions.
    with data.factory() as db:
        other = db.get(models.User, data.outsider.id); other.tenant_id = data.owner.tenant_id; db.commit()
        data.outsider.tenant_id = data.owner.tenant_id
    assert api.post(f"{base}/{entries[0].id}/pause", headers=auth(data.outsider)).status_code == 403
    assert api.get(f"{base}/work/active", headers=auth(data.outsider)).json()["items"] == []


def test_migration_idempotency_constraints_and_rollback_guard(engine, data):
    with engine.begin() as connection:
        connection.execute(text("DROP INDEX uq_time_entries_running_task"))
        connection.execute(text("DROP INDEX uq_time_entries_running_subtask"))
        connection.execute(text("ALTER TABLE time_entries DROP COLUMN finalized_at"))
        connection.execute(text("CREATE UNIQUE INDEX uq_time_entries_one_active_per_user ON time_entries (tenant_id, user_id) WHERE stopped_at IS NULL"))
        upgrade(connection); upgrade(connection)
    ids = children(data, 2)
    with data.factory() as db:
        for id in ids: timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=id))
    with pytest.raises(RuntimeError, match="Multiple running"):
        with engine.begin() as connection: downgrade(connection)
    with data.factory() as db:
        assert len(work_history.read(db, data.owner, active=True)["items"]) == 2


def test_private_timer_invalidation_only_reaches_own_valid_sockets(data, monkeypatch):
    from backend.app.ws import tasks
    monkeypatch.setattr(tasks, "SessionLocal", data.factory)
    class Socket:
        def __init__(self): self.messages = []; self.scope = {"credentials_version": 0}
        async def accept(self): pass
        async def send_json(self, message): self.messages.append(message)
        async def close(self, code): pass
    async def check():
        manager = tasks.TaskConnectionManager()
        a, b, stranger = Socket(), Socket(), Socket()
        tenant = str(data.owner.tenant_id)
        await manager.connect(tenant, data.owner.id, a)
        await manager.connect(tenant, data.owner.id, b)
        await manager.connect(tenant, data.outsider.id, stranger)
        await manager.broadcast(tenant, {"type": "timer.changed", "user_id": data.owner.id, "tenant_id": tenant})
        assert len(a.messages) == len(b.messages) == 1
        assert stranger.messages == []
        assert set(a.messages[0]) == {"type", "user_id", "tenant_id"}
        with data.factory() as db:
            db.get(models.User, data.owner.id).credentials_version += 1; db.commit()
        await manager.broadcast(tenant, {"type": "timer.changed", "user_id": data.owner.id, "tenant_id": tenant})
        assert len(a.messages) == 1
        assert manager.snapshot()["sockets"] == 1  # unrelated socket remains untouched
        await manager.close_all()
    asyncio.run(check())


@pytest.mark.parametrize("effective_role,setting,configured", [
    (models.RoleEnum.ADMIN, "active_timer_admin_limit", 7),
    (models.RoleEnum.OWNER, "active_timer_owner_limit", 8),
])
def test_privileged_limits_are_explicit_and_configurable(data, monkeypatch, effective_role, setting, configured):
    from backend.app.config import get_settings
    role(data, effective_role)
    monkeypatch.setattr(get_settings(), setting, configured)
    with data.factory() as db:
        assert work_history.read(db, data.owner, active=True)["limit"] == configured


def test_history_metadata_queries_do_not_grow_per_session(data):
    with data.factory() as db:
        db.add_all([models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id,
            subtask_id=data.child.id, started_at=NOW + timedelta(minutes=i),
            stopped_at=NOW + timedelta(minutes=i + 1), duration_seconds=60,
            status=models.TimeEntryStatusEnum.STOPPED, stop_reason="stopped") for i in range(20)])
        db.commit()
        queries = []
        bind = db.get_bind()
        def capture(*args): queries.append(args[2])
        event.listen(bind, "before_cursor_execute", capture)
        try:
            snapshot = work_history.read(db, data.owner, limit=30)
        finally:
            event.remove(bind, "before_cursor_execute", capture)
        assert len(snapshot["items"]) == 20
        assert all(row["subtask_total_seconds"] == 1200 for row in snapshot["items"])
        assert len(queries) <= 10  # batched metadata/totals, not one lookup per session


def test_timer_event_transaction_rollback_and_real_redis_relay(data, monkeypatch):
    import os
    if not os.environ.get("ZEAPLAY_WORK_TEST_REDIS_URL"):
        pytest.skip("Requires an explicitly isolated Redis URL")
    from backend.app.config import get_settings
    from backend.app.realtime import transport
    from backend.app.realtime.outbox import relay_batch
    from backend.app.realtime.contracts import Event
    import redis
    client = redis.Redis.from_url(os.environ["ZEAPLAY_WORK_TEST_REDIS_URL"])
    monkeypatch.setattr(transport, "get_redis_client", lambda: client)
    settings = get_settings()
    monkeypatch.setattr(settings, "realtime_outbox_enabled", True)
    monkeypatch.setattr(settings, "realtime_outbox_categories", ["task"])
    subscription = client.pubsub(); subscription.subscribe(transport.channel("task"))
    subscription.get_message(timeout=2)
    try:
        with data.factory() as db:
            entry = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
            before = db.query(models.RealtimeOutbox).count()
            timers.stop_timer(db, data.owner, entry_id=entry.id, commit=False)
            db.rollback()
            assert db.query(models.RealtimeOutbox).count() == before
            assert relay_batch(db) >= 1
            while relay_batch(db): pass
        delivered = []
        for _ in range(8):
            message = subscription.get_message(timeout=.5)
            if message and message["type"] == "message": delivered.append(Event.decode(message["data"]))
        own = [event for event in delivered if event.event_type == "timer.changed"]
        assert len(own) == 1 and own[0].payload["user_id"] == data.owner.id
        assert own[0].aggregate_version >= 1
    finally:
        subscription.close(); client.close()
