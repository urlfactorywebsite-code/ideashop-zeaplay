"""Refinement audit regressions; each fixture owns its database/schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from backend.app import models, schemas
from backend.app.lifecycle.report import paused_gaps
from backend.app.services import time_tracking as timers, work_history
from backend.tests.test_task_lifecycle import NOW, api, auth, data, engine  # noqa: F401
from backend.tests.test_active_work import children, role


def test_role_changed_since_authentication_cannot_retain_old_target_privileges(data):
    with data.factory() as db:
        actor = db.get(models.User, data.owner.id)  # owner cached at authentication
        with data.factory() as writer:
            other = writer.get(models.User, data.outsider.id)
            other.tenant_id = actor.tenant_id
            writer.get(models.User, actor.id).role = models.RoleEnum.USER
            task = models.Task(title="Another creator's task", created_by_id=other.id, assigned_to_id=actor.id)
            writer.add(task); writer.flush()
            child = models.Subtask(task_id=task.id, title="Other assignee", assigned_to_id=other.id)
            writer.add(child); writer.commit(); child_id = child.id
        with pytest.raises(HTTPException) as denied:
            timers.start_timer(db, actor, schemas.TimeEntryStart(subtask_id=child_id))
        assert denied.value.status_code == 403
        db.rollback()
        assert db.scalar(select(models.User.role).where(models.User.id == actor.id)) == models.RoleEnum.USER
        assert db.scalar(select(models.TimeEntry.id)) is None


@pytest.mark.parametrize("change", ["inactive", "credentials"])
def test_account_revocation_since_authentication_prevents_timer_mutation(data, change):
    with data.factory() as db:
        actor = db.get(models.User, data.owner.id)
        with data.factory() as writer:
            current = writer.get(models.User, actor.id)
            if change == "inactive": current.status = models.UserStatusEnum.DEACTIVATED
            else: current.credentials_version += 1
            writer.commit()
        with pytest.raises(HTTPException) as denied:
            timers.start_timer(db, actor, schemas.TimeEntryStart(subtask_id=data.child.id))
        assert denied.value.status_code in {401, 403}


@pytest.mark.parametrize("change,expected", [("role", 403), ("inactive", 403), ("credentials", 401)])
def test_principal_change_while_waiting_for_postgres_timer_lock(data, engine, change, expected):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL advisory-lock wait; stale-principal SQLite checks run separately")
    waiting = Event()
    def before_execute(connection, cursor, statement, *args):
        if "pg_advisory_xact_lock" in statement:
            waiting.set()
    def attempt():
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            try:
                timers.start_timer(db, actor, schemas.TimeEntryStart(subtask_id=data.child.id))
            except HTTPException as error:
                return error.status_code
            return 201
    with data.factory() as holder:
        timers._lock_timer_user(holder, data.owner.tenant_id, data.owner.id)
        event.listen(engine, "before_cursor_execute", before_execute)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(attempt)
                try:
                    assert waiting.wait(timeout=15), "Request did not reach the held timer lock"
                    user = holder.get(models.User, data.owner.id)
                    if change == "role":
                        user.role = models.RoleEnum.USER
                        holder.get(models.User, data.outsider.id).tenant_id = user.tenant_id
                        # Personal-task creators retain management by design. Move
                        # creation to another same-tenant user to test lost privilege.
                        holder.get(models.Task, data.task.id).created_by_id = data.outsider.id
                        holder.get(models.Subtask, data.child.id).assigned_to_id = data.outsider.id
                    elif change == "inactive": user.status = models.UserStatusEnum.DEACTIVATED
                    else: user.credentials_version += 1
                finally:
                    holder.commit()  # release the lock even if a test assertion fails
                assert result.result(timeout=20) == expected
        finally:
            event.remove(engine, "before_cursor_execute", before_execute)
    with data.factory() as db:
        assert db.scalar(select(models.TimeEntry.id)) is None


def test_finalized_pause_is_resolved_in_existing_execution_report(data, api, monkeypatch):
    clock = [NOW]
    monkeypatch.setattr(timers, "utc_now", lambda: clock[0])
    with data.factory() as db:
        row = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
        clock[0] += timedelta(seconds=10)
        timers.stop_timer(db, data.owner, entry_id=row.id, reason="paused")
        clock[0] += timedelta(seconds=40)
        timers.stop_timer(db, data.owner, entry_id=row.id)
        assert paused_gaps([row], NOW + timedelta(seconds=60)) == (40, 0)
    response = api.get(f"/api/tasks/{data.task.id}/execution-report", headers=auth(data.owner))
    assert response.status_code == 200, response.text
    child = response.json()["subtasks"][0]
    assert child["linked_paused_seconds"] == 40 and child["unresolved_pause_count"] == 0


def test_empty_active_read_does_not_query_metadata_or_history_totals(data):
    with data.factory() as db:
        queries = []
        def capture(*args): queries.append(args[2])
        event.listen(db.get_bind(), "before_cursor_execute", capture)
        try: result = work_history.read(db, data.owner, active=True)
        finally: event.remove(db.get_bind(), "before_cursor_execute", capture)
        assert result["items"] == [] and result["running_count"] == 0
        assert len(queries) <= 2, queries


def test_history_main_task_total_covers_all_sessions(data):
    with data.factory() as db:
        for start, seconds in [(0, 30), (100, 60)]:
            db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id, task_id=data.task.id,
                started_at=NOW + timedelta(seconds=start), stopped_at=NOW + timedelta(seconds=start + seconds),
                duration_seconds=seconds, status=models.TimeEntryStatusEnum.STOPPED, stop_reason="stopped"))
        db.commit()
        items = work_history.read(db, data.owner)["items"]
        assert len(items) == 2
        assert {row["subtask_total_seconds"] for row in items} == {90}


def test_range_active_time_cannot_exceed_persisted_active_duration(data):
    with data.factory() as db:
        db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id, subtask_id=data.child.id,
            started_at=NOW, stopped_at=NOW + timedelta(seconds=1.9), duration_seconds=1,
            status=models.TimeEntryStatusEnum.STOPPED, stop_reason="stopped"))
        db.commit()
        first = work_history.read(db, data.owner, lower=NOW, upper=NOW + timedelta(seconds=.5))["items"][0]
        second = work_history.read(db, data.owner, lower=NOW + timedelta(seconds=.5), upper=NOW + timedelta(seconds=2))["items"][0]
        assert first["range_active_seconds"] + second["range_active_seconds"] == 1


def test_changed_tenant_target_is_redacted_but_own_timer_can_be_stopped(data):
    foreign_tenant = data.outsider.tenant_id
    with data.factory() as db:
        creator = db.get(models.User, data.outsider.id); creator.tenant_id = data.owner.tenant_id
        task = models.Task(title="Confidential new tenant title", created_by_id=creator.id, assigned_to_id=data.owner.id)
        db.add(task); db.flush()
        child = models.Subtask(task_id=task.id, title="Confidential child", assigned_to_id=data.owner.id)
        db.add(child); db.commit()
        timer = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=child.id))
        creator.tenant_id = foreign_tenant; db.commit()
        result = work_history.read(db, data.owner, active=True)
        assert result["running_count"] == 1 and len(result["items"]) == 1
        assert result["items"][0]["target_accessible"] is False
        assert "Confidential" not in str(result)
        assert work_history.read(db, data.owner, search="Confidential")["items"] == []
        with pytest.raises(HTTPException):
            timers.resume_timer(db, data.owner, timer.id)
        db.rollback()
        timers.stop_timer(db, data.owner, entry_id=timer.id)
        assert work_history.read(db, data.owner, active=True)["running_count"] == 0


def test_revoked_task_visibility_redacts_own_history_without_hiding_controls(data):
    role(data, models.RoleEnum.USER)
    with data.factory() as db:
        creator = db.get(models.User, data.outsider.id)
        creator.tenant_id = data.owner.tenant_id
        task = models.Task(title="Revoked confidential title", created_by_id=creator.id, assigned_to_id=data.owner.id)
        db.add(task); db.flush()
        child = models.Subtask(task_id=task.id, title="Revoked child", assigned_to_id=data.owner.id)
        db.add(child); db.commit()
        timer = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=child.id))
        task.assigned_to_id = creator.id; child.assigned_to_id = creator.id; db.commit()
        result = work_history.read(db, data.owner, active=True)
        assert result["items"][0]["target_accessible"] is False
        assert "Revoked" not in str(result)
        assert work_history.read(db, data.owner, search="Revoked")["items"] == []
        timers.stop_timer(db, data.owner, entry_id=timer.id)


@pytest.mark.parametrize("effective_role,limit", [(models.RoleEnum.USER, 3), (models.RoleEnum.MANAGER, 5)])
def test_simultaneous_starts_and_resumes_share_global_capacity(data, effective_role, limit):
    role(data, effective_role)
    targets = children(data, 12)
    sources = []
    with data.factory() as db:
        for target in targets[:6]:
            row = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=target))
            timers.stop_timer(db, data.owner, entry_id=row.id, reason="paused")
            sources.append(row.id)
    barrier = Barrier(12)
    def attempt(index):
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            barrier.wait(timeout=20)
            try:
                row = (timers.resume_timer(db, actor, sources[index]) if index < 6 else
                       timers.start_timer(db, actor, schemas.TimeEntryStart(subtask_id=targets[index])))
                return row.id
            except HTTPException as error:
                assert error.status_code == 409 and error.detail["code"] == "ACTIVE_TIMER_LIMIT"
                return None
    with ThreadPoolExecutor(max_workers=12) as pool:
        ids = [id for id in pool.map(attempt, range(12)) if id]
    assert len(ids) == len(set(ids)) == limit
    with data.factory() as db:
        assert work_history.read(db, data.owner, active=True)["running_count"] == limit


def test_simultaneous_duplicate_resume_creates_one_continuation(data):
    with data.factory() as db:
        source = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
        timers.stop_timer(db, data.owner, entry_id=source.id, reason="paused")
        source_id = source.id
    barrier = Barrier(8)
    def resume(_):
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            barrier.wait(timeout=20)
            return timers.resume_timer(db, actor, source_id).id
    with ThreadPoolExecutor(max_workers=8) as pool: ids = list(pool.map(resume, range(8)))
    assert len(set(ids)) == 1
    with data.factory() as db:
        assert len(db.scalars(select(models.TimeEntry).where(models.TimeEntry.continued_from_id == source_id)).all()) == 1


def test_simultaneous_task_socket_handshakes_obey_connection_limit(monkeypatch):
    from backend.app.config import get_settings
    from backend.app.ws.tasks import TaskConnectionManager
    monkeypatch.setattr(get_settings(), "websocket_max_connections_per_user", 1)
    class Socket:
        def __init__(self): self.accepted = False; self.closed = None
        async def accept(self):
            await asyncio.sleep(.02)
            self.accepted = True
        async def close(self, code=1008, **kwargs): self.closed = code
    async def run():
        manager = TaskConnectionManager()
        sockets = [Socket() for _ in range(6)]
        await asyncio.gather(*(manager.connect("tenant", "worker", socket) for socket in sockets))
        assert sum(socket.accepted and socket.closed is None for socket in sockets) == 1
        assert sum(socket.closed == 1008 for socket in sockets) == 5
        assert manager.snapshot()["sockets"] == 1
        await manager.close_all()
    asyncio.run(run())


@pytest.mark.parametrize("move", ["source_after_successor", "successor_before_source"])
def test_timestamp_correction_cannot_invert_continuation_order(data, monkeypatch, move):
    clock = [NOW]
    monkeypatch.setattr(timers, "utc_now", lambda: clock[0])
    with data.factory() as db:
        source = timers.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
        clock[0] = NOW + timedelta(seconds=10)
        timers.stop_timer(db, data.owner, entry_id=source.id, reason="paused")
        clock[0] = NOW + timedelta(seconds=20)
        successor = timers.resume_timer(db, data.owner, source.id)
        clock[0] = NOW + timedelta(seconds=30)
        timers.stop_timer(db, data.owner, entry_id=successor.id)
        clock[0] = NOW + timedelta(seconds=100)
        target, start, stop = (source, 50, 60) if move == "source_after_successor" else (successor, -20, -10)
        with pytest.raises(HTTPException) as denied:
            timers.correct_time_entry(db, data.owner, target.id, schemas.TimeEntryCorrection(
                started_at=NOW + timedelta(seconds=start), stopped_at=NOW + timedelta(seconds=stop), reason="Audit correction"))
        assert denied.value.status_code == 409
        db.rollback()
        corrected = timers.correct_time_entry(db, data.owner, source.id, schemas.TimeEntryCorrection(
            started_at=NOW - timedelta(seconds=5), stopped_at=NOW + timedelta(seconds=5), reason="Valid bounded correction"))
        assert corrected.original_duration_seconds == 10
