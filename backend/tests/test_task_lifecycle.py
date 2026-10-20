"""Lifecycle contracts on SQLite and an explicitly isolated PostgreSQL database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from importlib import import_module
from types import SimpleNamespace
import os
import sys
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
import pytest
from sqlalchemy import create_engine, event, inspect, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session, sessionmaker

from backend.app import models, schemas
from backend.app.config import get_settings
from backend.app.database import Base, get_db
from backend.app.lifecycle.analytics import metrics, union_seconds
from backend.app.lifecycle.context import bind_actor
from backend.app.routers.tasks import router as task_router
from backend.app.routers.time_entries import router as timer_router
from backend.app.services import subtask_workflow, time_tracking
from backend.app.tickets import models as ticket_models  # noqa: F401


UTC = timezone.utc
NOW = datetime(2020, 10, 19, 10, tzinfo=UTC)


@pytest.fixture(params=["sqlite", "postgresql"])
def engine(request, tmp_path):
    admin = None
    if request.param == "sqlite":
        engine = create_engine("sqlite:///" + (tmp_path / "lifecycle.db").as_posix(),
                               connect_args={"check_same_thread": False, "timeout": 30})
        @event.listens_for(engine, "connect")
        def sqlite_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
    else:
        url = os.environ.get("ZEAPLAY_RT_POSTGRES_TEST_URL")
        if not url:
            pytest.skip("Requires an explicit isolated PostgreSQL rt3_test database")
        assert "rt3_test" in (make_url(url).database or ""), "Refusing non-scratch database"
        schema = "lifecycle_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url)
        @event.listens_for(engine, "connect")
        def search_path(connection, _):
            cursor = connection.cursor()
            cursor.execute(f'SET search_path TO "{schema}", public')
            cursor.execute("SET statement_timeout TO 10000")
            cursor.close()
            connection.commit()
    try:
        # SQLite cannot implement the production PostgreSQL full-text computed column.
        computed = models.Task.__table__.c.search_vector.computed
        if request.param == "sqlite":
            models.Task.__table__.c.search_vector.computed = None
        try:
            Base.metadata.create_all(engine)
        finally:
            models.Task.__table__.c.search_vector.computed = computed
        yield engine
    finally:
        engine.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.fixture
def data(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        owner = models.User(id=str(uuid4()), tenant_id=uuid4(), name="Owner", email=f"{uuid4()}@example.test",
                            hashed_password="not-a-login-password", role=models.RoleEnum.OWNER,
                            status=models.UserStatusEnum.ACTIVE, points=125)
        outsider = models.User(id=str(uuid4()), tenant_id=uuid4(), name="Other owner", email=f"{uuid4()}@example.test",
                               hashed_password="not-a-login-password", role=models.RoleEnum.OWNER,
                               status=models.UserStatusEnum.ACTIVE)
        db.add_all([owner, outsider])
        db.commit()
        bind_actor(db, owner)
        task = models.Task(id=str(uuid4()), title="Lifecycle test", created_by_id=owner.id, assigned_to_id=owner.id)
        db.add(task)
        db.flush()
        child = models.Subtask(id=str(uuid4()), task_id=task.id, title="Child", assigned_to_id=owner.id)
        db.add(child)
        db.commit()
    return SimpleNamespace(factory=factory, owner=owner, outsider=outsider, task=task, child=child)


def history(db, task_id, event_type=None):
    statement = select(models.TaskLifecycleEvent).where(models.TaskLifecycleEvent.task_id == task_id)
    if event_type:
        statement = statement.where(models.TaskLifecycleEvent.event_type == event_type)
    return list(db.scalars(statement.order_by(models.TaskLifecycleEvent.id)))


def test_every_persisted_status_change_bulk_sql_reopen_and_rollback(data):
    with data.factory() as db:
        bind_actor(db, data.owner)
        for state in ("IN_PROGRESS", "DONE", "TODO", "DONE", "DONE"):
            db.execute(text("UPDATE tasks SET status=:status WHERE id=:id"), {"status": state, "id": data.task.id})
        db.commit()
        events = history(db, data.task.id, "task.status_changed")
        assert [(row.previous_status, row.new_status) for row in events] == [
            ("TODO", "IN_PROGRESS"), ("IN_PROGRESS", "DONE"), ("DONE", "TODO"), ("TODO", "DONE")]
        assert {row.actor_id for row in events} == {data.owner.id}
        db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.BLOCKED))
        db.rollback()
        assert len(history(db, data.task.id, "task.status_changed")) == 4
        assert db.get(models.User, data.owner.id).points == 125
    # No actor is fabricated for background jobs or attributed from a reused pooled connection.
    with data.factory() as db:
        db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.TODO))
        db.commit()
        assert history(db, data.task.id)[-1].actor_id is None


def test_history_is_append_only_and_survives_business_deletion(data):
    with data.factory() as db:
        for sql in ("DELETE FROM task_lifecycle_events", "UPDATE task_lifecycle_events SET actor_id=NULL",
                    "DELETE FROM task_lifecycle_coverage"):
            with pytest.raises(DatabaseError, match="append-only"):
                db.execute(text(sql))
            db.rollback()
        db.execute(text("DELETE FROM tasks WHERE id=:id"), {"id": data.task.id})
        db.commit()
        assert {row.event_type for row in history(db, data.task.id)} >= {"task.created", "task.deleted", "subtask.deleted"}


def test_dependency_activation_intermediate_stages_and_reopen_are_captured(data):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        successor = models.Subtask(task_id=task.id, title="Successor", status=models.SubtaskStatusEnum.WAITING)
        db.add(successor)
        db.flush()
        db.add(models.SubtaskDependency(task_id=task.id, subtask_id=successor.id, depends_on_subtask_id=data.child.id))
        db.commit()
        subtask_workflow.transition_subtask(db, task, actor=data.owner, subtask_id=data.child.id,
                                           target_status=models.SubtaskStatusEnum.DONE)
        subtask_workflow.transition_subtask(db, task, actor=data.owner, subtask_id=successor.id,
                                           target_status=models.SubtaskStatusEnum.IN_PROGRESS)
        db.commit()
        subtask_workflow.transition_subtask(db, task, actor=data.owner, subtask_id=data.child.id,
                                           target_status=models.SubtaskStatusEnum.TODO)
        db.commit()
        events = [row for row in history(db, task.id, "subtask.status_changed") if row.subtask_id == successor.id]
        assert [(row.previous_status, row.new_status) for row in events] == [
            ("WAITING", "TODO"), ("TODO", "IN_PROGRESS"), ("IN_PROGRESS", "IN_REVIEW")]
        assert all(row.actor_id == data.owner.id for row in events)
        predecessor_done = next(row for row in history(db, task.id, "subtask.status_changed")
                                if row.subtask_id == data.child.id and row.new_status == "DONE")
        assert predecessor_done.id < events[0].id


def test_timer_pause_resume_restart_retries_corrections_and_audit(data, monkeypatch):
    clock = [NOW]
    monkeypatch.setattr(time_tracking, "utc_now", lambda: clock[0])
    with data.factory() as db:
        first = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        clock[0] += timedelta(seconds=90)
        time_tracking.stop_timer(db, data.owner, entry_id=first.id, reason="paused")
        resumed = time_tracking.resume_timer(db, data.owner, first.id)
        assert time_tracking.resume_timer(db, data.owner, first.id).id == resumed.id
        clock[0] += timedelta(seconds=30)
        restarted = time_tracking.resume_timer(db, data.owner, resumed.id, restart=True)
        assert restarted.id != resumed.id
        assert time_tracking.resume_timer(db, data.owner, resumed.id, restart=True).id == restarted.id
        clock[0] += timedelta(seconds=10)
        time_tracking.stop_timer(db, data.owner, entry_id=restarted.id)
        for offset in (5, 10):
            time_tracking.correct_time_entry(db, data.owner, first.id, schemas.TimeEntryCorrection(
                started_at=NOW - timedelta(seconds=offset), stopped_at=NOW + timedelta(seconds=80), reason="Correct server timestamps"))
        events = history(db, data.task.id)
        kinds = [row.event_type for row in events if row.time_entry_id]
        assert kinds == ["timer.started", "timer.paused", "timer.resumed", "timer.stopped",
                         "timer.restarted", "timer.stopped", "timer.corrected", "timer.corrected"]
        corrections = [row for row in events if row.event_type == "timer.corrected"]
        assert corrections[0].details["new_started_at"] != corrections[1].details["new_started_at"]
        assert corrections[1].details["old_started_at"] == corrections[0].details["new_started_at"]
        assert db.get(models.TimeEntry, first.id).original_duration_seconds == 90


def test_concurrent_start_stop_and_resume_emit_one_effective_event(data):
    def start():
        with data.factory() as db:
            return time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id)).id
    with ThreadPoolExecutor(max_workers=2) as executor:
        ids = list(executor.map(lambda _: start(), range(2)))
    assert ids[0] == ids[1]
    def stop():
        with data.factory() as db:
            return time_tracking.stop_timer(db, data.owner, entry_id=ids[0]).id
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert set(executor.map(lambda _: stop(), range(2))) == {ids[0]}
    def resume():
        with data.factory() as db:
            return time_tracking.resume_timer(db, data.owner, ids[0]).id
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert len(set(executor.map(lambda _: resume(), range(2)))) == 1
    with data.factory() as db:
        events = history(db, data.task.id)
        for kind in ("timer.started", "timer.stopped", "timer.resumed"):
            assert sum(row.event_type == kind for row in events) == 1


@pytest.fixture
def api(data):
    app = FastAPI()
    app.include_router(task_router, prefix="/api")
    app.include_router(timer_router, prefix="/api")
    def db():
        with data.factory() as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as client:
        yield client


def auth(user):
    settings = get_settings()
    token = jwt.encode({"user_id": user.id, "tenant_id": str(user.tenant_id), "token_type": "access"},
                       settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return {"Authorization": "Bearer " + token}


def test_api_authorization_pagination_and_utc_contract(api, data):
    for path in ("journey", "analytics", "execution-sessions"):
        url = f"/api/tasks/{data.task.id}/{path}"
        assert api.get(url).status_code == 401
        assert api.get(url, headers=auth(data.outsider)).status_code == 404
        response = api.get(url, headers=auth(data.owner))
        assert response.status_code == 200, response.text
        if path != "execution-sessions":
            assert response.json()["history_complete"] is True
    response = api.get(f"/api/tasks/{data.task.id}/journey?limit=1", headers=auth(data.owner))
    body = response.json()
    assert body["created_by_id"] == data.owner.id
    assert body["created_at"].endswith("Z")
    assert len(body["items"]) == 1 and body["next_after_id"]
    second = api.get(f"/api/tasks/{data.task.id}/journey?after_id={body['next_after_id']}", headers=auth(data.owner)).json()
    assert second["items"][0]["id"] > body["items"][0]["id"]
    assert api.get(f"/api/tasks/{data.task.id}/journey?limit=501", headers=auth(data.owner)).status_code == 422


def test_api_analytics_deduplicates_legacy_overlaps_and_preserves_distinct_workers(api, data):
    with data.factory() as db:
        for target, start, stop, user_id in (
            ({"task_id": data.task.id}, 0, 120, data.owner.id),
            ({"subtask_id": data.child.id}, 60, 180, data.owner.id),
        ):
            db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=user_id, **target,
                started_at=NOW + timedelta(seconds=start), stopped_at=NOW + timedelta(seconds=stop),
                duration_seconds=stop-start, status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
    body = api.get(f"/api/tasks/{data.task.id}/analytics", headers=auth(data.owner)).json()
    assert body["parent"]["person_seconds"] == 120
    assert body["children"]["person_seconds"] == 120
    assert body["aggregate"]["person_seconds"] == 180
    assert body["aggregate"]["raw_session_seconds"] == 240


def test_same_tenant_unrelated_user_cannot_read_journey_or_analytics(api, data):
    with data.factory() as db:
        user = db.get(models.User, data.outsider.id)
        user.tenant_id = data.owner.tenant_id
        user.role = models.RoleEnum.USER
        db.commit()
    for path in ("journey", "analytics", "execution-sessions"):
        assert api.get(f"/api/tasks/{data.task.id}/{path}", headers=auth(user)).status_code == 403


def test_timer_restart_failure_rolls_back_stop_and_event_history(data, monkeypatch):
    with data.factory() as db:
        entry = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        original = time_tracking.start_timer
        def fail(*args, **kwargs):
            raise RuntimeError("Synthetic transaction failure")
        monkeypatch.setattr(time_tracking, "start_timer", fail)
        with pytest.raises(RuntimeError, match="Synthetic"):
            time_tracking.resume_timer(db, data.owner, entry.id, restart=True)
        db.rollback()
        monkeypatch.setattr(time_tracking, "start_timer", original)
        assert db.get(models.TimeEntry, entry.id).stopped_at is None
        assert not history(db, data.task.id, "timer.stopped")


def test_multiple_uncommitted_subtask_transitions_have_individual_history(data):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        for state in (models.SubtaskStatusEnum.IN_PROGRESS, models.SubtaskStatusEnum.IN_REVIEW):
            subtask_workflow.transition_subtask(db, task, actor=data.owner, subtask_id=data.child.id, target_status=state)
        db.commit()
        assert [row.new_status for row in history(db, task.id, "subtask.status_changed")] == ["IN_PROGRESS", "IN_REVIEW"]


def test_concurrent_parent_completion_writes_and_retries_have_one_transition(data):
    def complete():
        with data.factory() as db:
            bind_actor(db, data.owner)
            db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.DONE))
            db.commit()
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda _: complete(), range(2)))
    with data.factory() as db:
        assert len(history(db, data.task.id, "task.status_changed")) == 1


def test_timer_stop_preserves_transactional_realtime_invalidation(data, monkeypatch):
    monkeypatch.setattr(get_settings(), "realtime_outbox_enabled", True)
    monkeypatch.setattr(get_settings(), "realtime_outbox_categories", ["task"])
    with data.factory() as db:
        entry = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        before = db.query(models.RealtimeOutbox).count()
        time_tracking.stop_timer(db, data.owner, entry_id=entry.id, commit=False)
        assert db.query(models.RealtimeOutbox).count() == before + 1
        db.rollback()
        assert db.query(models.RealtimeOutbox).count() == before
        assert db.get(models.TimeEntry, entry.id).stopped_at is None
        time_tracking.stop_timer(db, data.owner, entry_id=entry.id)
        time_tracking.stop_timer(db, data.owner, entry_id=entry.id)
        assert db.query(models.RealtimeOutbox).count() == before + 2
        assert db.query(models.RealtimeOutbox).filter_by(event_type="timer.changed").count() == 2


def test_postgres_analytics_snapshot_is_repeatable_and_read_only(data, engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL repeatable-read/read-only behavior; SQLite snapshots are tested through the APIs")
    from backend.app.routers.task_lifecycle import lifecycle_read_db
    with data.factory() as reader:
        lifecycle_read_db(reader, token=auth(data.owner)["Authorization"][7:])
        with data.factory() as writer:
            writer.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.DONE))
            writer.commit()
        assert reader.get(models.Task, data.task.id).status == models.TaskStatusEnum.TODO
        with pytest.raises(DatabaseError, match="read-only"):
            reader.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.BLOCKED))
        reader.rollback()


def test_simultaneous_restart_has_one_continuation_and_one_close(data):
    with data.factory() as db:
        entry_id = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id)).id
    def restart():
        with data.factory() as db:
            return time_tracking.resume_timer(db, data.owner, entry_id, restart=True).id
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert len(set(executor.map(lambda _: restart(), range(2)))) == 1
    with data.factory() as db:
        events = history(db, data.task.id)
        assert sum(row.event_type == "timer.restarted" for row in events) == 1
        assert sum(row.event_type == "timer.stopped" for row in events) == 1


def test_all_existing_task_and_subtask_statuses_serialize_without_new_rules(api, data):
    assert len(models.TaskStatusEnum) == 11
    assert len(models.SubtaskStatusEnum) == 6
    for state in models.TaskStatusEnum:
        with data.factory() as db:
            db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=state))
            db.commit()
        response = api.get(f"/api/tasks/{data.task.id}/journey", headers=auth(data.owner))
        assert response.json()["status"] == state.value
    for state in models.SubtaskStatusEnum:
        with data.factory() as db:
            db.execute(update(models.Subtask).where(models.Subtask.id == data.child.id).values(status=state))
            db.commit()
        response = api.get(f"/api/tasks/{data.task.id}/journey", headers=auth(data.owner))
        assert response.json()["subtasks"][0]["status"] == state.value


def test_session_api_survives_new_request_and_returns_linked_sessions(api, data):
    headers = auth(data.owner)
    started = api.post("/api/time-entries/start", headers=headers, json={"task_id": data.task.id}).json()
    active = api.get("/api/time-entries/active", headers=headers)
    assert active.json()["active"]["id"] == started["id"]
    api.post(f"/api/time-entries/{started['id']}/pause", headers=headers)
    resumed = api.post(f"/api/time-entries/{started['id']}/resume", headers=headers).json()
    first = api.get(f"/api/tasks/{data.task.id}/execution-sessions?limit=1", headers=headers).json()
    assert len(first["items"]) == 1 and first["next_after_id"]
    assert first["items"][0]["started_at"].endswith("Z")
    second = api.get(f"/api/tasks/{data.task.id}/execution-sessions?after_id={first['next_after_id']}", headers=headers).json()
    all_ids = {first["items"][0]["id"], second["items"][0]["id"]}
    assert all_ids == {started["id"], resumed["id"]}


def test_new_pause_restart_api_keeps_permissions(api, data):
    response = api.post("/api/time-entries/start", headers=auth(data.owner), json={"subtask_id": data.child.id})
    assert response.status_code == 201, response.text
    entry = response.json()["id"]
    assert api.post(f"/api/time-entries/{entry}/pause", headers=auth(data.outsider)).status_code == 404
    assert api.post(f"/api/time-entries/{entry}/pause", headers=auth(data.owner)).status_code == 200
    response = api.post(f"/api/time-entries/{entry}/restart", headers=auth(data.owner))
    assert response.status_code == 201, response.text
    assert response.json()["continued_from_id"] == entry


def test_interval_math_cross_midnight_offsets_active_and_fractional_precision():
    def row(user, start, stop):
        return SimpleNamespace(user_id=user, started_at=start, stopped_at=stop)
    zero = datetime(2026, 10, 18, 23, 59, 30, tzinfo=UTC)
    result = metrics([
        row("a", zero, zero + timedelta(seconds=60)),
        row("a", (zero + timedelta(seconds=30)).astimezone(timezone(timedelta(hours=5, minutes=30))), None),
        row("b", zero, zero + timedelta(seconds=60)),
    ], zero + timedelta(seconds=90))
    assert result.person_seconds == 150 and result.elapsed_seconds == 90
    assert result.raw_session_seconds == 180 and result.active_session_count == 1
    assert union_seconds([(zero, zero + timedelta(seconds=.6)),
                          (zero + timedelta(seconds=1), zero + timedelta(seconds=1.6))]) == 1
    assert union_seconds([]) == 0
    fractional = metrics([row("a", zero, zero + timedelta(seconds=.6)),
                          row("b", zero + timedelta(seconds=1), zero + timedelta(seconds=1.6))],
                         zero + timedelta(seconds=2))
    assert fractional.person_seconds == fractional.elapsed_seconds == 1


def test_migration_preserves_legacy_values_and_refuses_destructive_downgrade(engine, monkeypatch):
    # Exercise the real revision over populated pre-revision tables in the isolated schema.
    sys.path.insert(0, os.path.abspath("backend"))
    migration = import_module("backend.alembic.versions.fd5e6f7a8b9c_task_lifecycle_history")
    from backend.app.lifecycle.schema_v1 import uninstall
    with engine.begin() as connection:
        uninstall(connection)
        models.TaskLifecycleEvent.__table__.drop(connection)
        models.TaskLifecycleCoverage.__table__.drop(connection)
        connection.exec_driver_sql("DROP INDEX uq_time_entries_continued_from_id")
        for column in ("continued_from_id", "start_kind", "stop_reason"):
            connection.exec_driver_sql(f"ALTER TABLE time_entries DROP COLUMN {column}")
    factory = sessionmaker(bind=engine)
    with factory() as db:
        user = models.User(id=str(uuid4()), tenant_id=uuid4(), name="Legacy", email=f"{uuid4()}@example.test",
                           hashed_password="not-a-password", points=555)
        db.add(user)
        db.flush()
        task = models.Task(id=str(uuid4()), title="Legacy task", created_by_id=user.id,
                           created_at=datetime(2020, 1, 1), status=models.TaskStatusEnum.DONE)
        db.add(task)
        db.flush()
        child = models.Subtask(id=str(uuid4()), task_id=task.id, title="Legacy completed", completed=True,
                               status=models.SubtaskStatusEnum.DONE)
        db.add(child)
        db.flush()
        entry_id = str(uuid4())
        db.execute(models.TimeEntry.__table__.insert().values(id=entry_id, tenant_id=user.tenant_id,
            user_id=user.id, subtask_id=child.id, started_at=NOW, stopped_at=NOW + timedelta(seconds=60),
            duration_seconds=60, status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
        task_id, child_id, user_id = task.id, child.id, user.id
    with engine.begin() as connection:
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        assert connection.scalar(text("SELECT count(*) FROM task_lifecycle_events")) == 0
        assert connection.scalar(text("SELECT points FROM users WHERE id=:id"), {"id": user_id}) == 555
        assert connection.scalar(text("SELECT status FROM tasks WHERE id=:id"), {"id": task_id}) == "DONE"
        assert connection.scalar(text("SELECT completed FROM subtasks WHERE id=:id"), {"id": child_id})
        assert connection.scalar(text("SELECT duration_seconds FROM time_entries WHERE id=:id"), {"id": entry_id}) == 60
        # Empty-history downgrade and re-upgrade are safe; no business rows are dropped.
        migration.downgrade()
        migration.upgrade()
        connection.execute(text("UPDATE tasks SET status='TODO' WHERE id=:id"), {"id": task_id})
        assert connection.scalar(text("SELECT count(*) FROM task_lifecycle_events")) == 1
        with pytest.raises(RuntimeError, match="retain schema"):
            migration.downgrade()
        index = {item["name"] for item in inspect(connection).get_indexes("task_lifecycle_events")}
        assert "ix_task_lifecycle_tenant_task_id" in index
    from backend.app.routers.task_lifecycle import task_journey
    with factory() as db:
        journey = task_journey(task_id=task_id, after_id=0, limit=100, db=db, current_user=db.get(models.User, user_id))
        assert journey.history_complete is False
        assert journey.created_at == datetime(2020, 1, 1, tzinfo=UTC)
        assert len(journey.items) == 1 and journey.items[0].previous_status == "DONE"
