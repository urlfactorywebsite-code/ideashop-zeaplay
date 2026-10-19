"""Independent regression cases for lifecycle review; isolated services only."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from threading import Event
import os
import subprocess
import sys
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
import pytest
from sqlalchemy import event, select, text, update

from backend.app import models, schemas
from backend.app.lifecycle.context import bind_actor
from backend.app.services import subtask_workflow, time_tracking
from backend.tests.test_task_lifecycle import (
    NOW, api, auth, data, engine, history,
)


def _stopped(db, data, *, offset=0):
    entry = models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id,
        task_id=data.task.id, started_at=NOW + timedelta(hours=offset),
        stopped_at=NOW + timedelta(hours=offset, minutes=10), duration_seconds=600,
        status=models.TimeEntryStatusEnum.STOPPED)
    db.add(entry)
    db.commit()
    return entry.id


def test_resume_conflict_does_not_claim_an_unlinked_active_session(data):
    with data.factory() as db:
        source = _stopped(db, data)
        other = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        with pytest.raises(HTTPException) as error:
            time_tracking.resume_timer(db, data.owner, source)
        assert error.value.status_code == 409
        assert time_tracking.get_active_timer(db, data.owner).id == other.id
        assert not history(db, data.task.id, "timer.resumed")


def test_continuation_lookup_cannot_expose_another_tenant_entry(data):
    with data.factory() as db:
        source = _stopped(db, data)
        foreign_task = models.Task(title="Foreign", created_by_id=data.outsider.id)
        db.add(foreign_task)
        db.flush()
        foreign = models.TimeEntry(tenant_id=data.outsider.tenant_id, user_id=data.outsider.id,
            task_id=foreign_task.id, continued_from_id=source, started_at=NOW,
            stopped_at=NOW + timedelta(seconds=1), duration_seconds=1,
            status=models.TimeEntryStatusEnum.STOPPED)
        db.add(foreign)
        db.commit()
        with pytest.raises(HTTPException) as error:
            time_tracking.resume_timer(db, data.owner, source)
        assert error.value.status_code == 409


def test_continuation_cannot_switch_targets_even_for_the_same_owner(data):
    with data.factory() as db:
        source = _stopped(db, data)
        other_task = models.Task(title="Other target", created_by_id=data.owner.id)
        db.add(other_task)
        db.flush()
        db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id,
            task_id=other_task.id, continued_from_id=source, started_at=NOW,
            stopped_at=NOW + timedelta(seconds=1), duration_seconds=1,
            status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
        with pytest.raises(HTTPException) as error:
            time_tracking.resume_timer(db, data.owner, source)
        assert error.value.status_code == 409


def test_parallel_corrections_cannot_both_pass_overlap_validation(data, monkeypatch):
    with data.factory() as db:
        first = _stopped(db, data)
        second = _stopped(db, data, offset=1)
    checked, release = Event(), Event()
    original = time_tracking._overlapping_entry_exists
    def delayed_check(*args, **kwargs):
        result = original(*args, **kwargs)
        if kwargs["exclude_entry_id"] == first:
            checked.set()
            assert release.wait(8)
        return result
    monkeypatch.setattr(time_tracking, "_overlapping_entry_exists", delayed_check)
    target = NOW - timedelta(days=1)
    def correct(entry_id):
        with data.factory() as db:
            try:
                time_tracking.correct_time_entry(db, data.owner, entry_id, schemas.TimeEntryCorrection(
                    started_at=target, stopped_at=target + timedelta(minutes=30), reason="Concurrent correction"))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        left = executor.submit(correct, first)
        try:
            assert checked.wait(8)
            right = executor.submit(correct, second)
            # Give the second transaction a chance to reach the overlap check.
            Event().wait(.25)
        finally:
            release.set()
        assert sorted([left.result(timeout=10), right.result(timeout=10)]) == [200, 409]


def test_correction_checks_running_sessions_as_well_as_stopped_entries(data, monkeypatch):
    monkeypatch.setattr(time_tracking, "utc_now", lambda: NOW + timedelta(hours=2))
    with data.factory() as db:
        source = _stopped(db, data)
        time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(subtask_id=data.child.id))
        with pytest.raises(HTTPException) as error:
            time_tracking.correct_time_entry(db, data.owner, source, schemas.TimeEntryCorrection(
                started_at=NOW + timedelta(hours=1), stopped_at=NOW + timedelta(hours=3),
                reason="Must not overlap running work"))
        assert error.value.status_code == 409


def test_corrections_cannot_overlap_another_task_or_create_future_work(data):
    with data.factory() as db:
        source = _stopped(db, data)
        other = models.Task(title="Separate project work", created_by_id=data.owner.id)
        db.add(other)
        db.flush()
        db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id, task_id=other.id,
            started_at=NOW + timedelta(hours=2), stopped_at=NOW + timedelta(hours=3),
            duration_seconds=3600, status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
        with pytest.raises(HTTPException) as error:
            time_tracking.correct_time_entry(db, data.owner, source, schemas.TimeEntryCorrection(
                started_at=NOW + timedelta(hours=2), stopped_at=NOW + timedelta(hours=3), reason="Overlapping task"))
        assert error.value.status_code == 409
        db.rollback()
        future = datetime.now(timezone.utc) + timedelta(days=1)
        with pytest.raises(HTTPException) as error:
            time_tracking.correct_time_entry(db, data.owner, source, schemas.TimeEntryCorrection(
                started_at=future, stopped_at=future + timedelta(hours=1), reason="Future work rejected"))
        assert error.value.status_code == 422


def test_rebinding_actor_after_savepoint_rollback_keeps_attribution(data):
    with data.factory() as db:
        db.execute(text("SELECT 1"))
        with db.begin_nested() as savepoint:
            bind_actor(db, data.owner)
            db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.BLOCKED))
            savepoint.rollback()
        bind_actor(db, data.owner)
        db.execute(update(models.Task).where(models.Task.id == data.task.id).values(status=models.TaskStatusEnum.IN_PROGRESS))
        db.commit()
        assert history(db, data.task.id)[-1].actor_id == data.owner.id


def test_actor_is_restored_for_plain_orm_flush_after_savepoint_failure(data):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        with pytest.raises(RuntimeError):
            with db.begin_nested():
                bind_actor(db, data.owner)
                task.status = models.TaskStatusEnum.BLOCKED
                db.flush()
                raise RuntimeError("Synthetic savepoint rollback")
        task.status = models.TaskStatusEnum.IN_PROGRESS
        db.commit()
        events = history(db, data.task.id, "task.status_changed")
        assert [(item.new_status, item.actor_id) for item in events] == [("IN_PROGRESS", data.owner.id)]


def test_completeness_is_not_recreated_by_editing_stored_creation_metadata(api, data):
    headers = auth(data.owner)
    assert api.get(f"/api/tasks/{data.task.id}/journey", headers=headers).json()["history_complete"] is True
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        task.created_at = datetime(2099, 1, 1)
        db.commit()
    assert api.get(f"/api/tasks/{data.task.id}/journey", headers=headers).json()["history_complete"] is False


def test_imported_old_execution_does_not_claim_a_complete_journey(api, data):
    with data.factory() as db:
        _stopped(db, data)
    for path in ("journey", "analytics"):
        response = api.get(f"/api/tasks/{data.task.id}/{path}", headers=auth(data.owner))
        assert response.status_code == 200
        assert response.json()["history_complete"] is False


def test_existing_timer_responses_are_unambiguously_utc(api, data):
    response = api.post("/api/time-entries/start", headers=auth(data.owner), json={"task_id": data.task.id})
    assert response.status_code == 201, response.text
    assert response.json()["started_at"].endswith("Z")


def test_timer_rejects_an_orphan_without_tenant_provenance(data):
    orphan = models.Task(id="orphan", title="Unresolved", created_by_id="missing-user")
    orphan.creator = None
    orphan.project = None
    with pytest.raises(HTTPException) as error:
        time_tracking.ensure_task_visible(orphan, data.owner)
    assert error.value.status_code == 404


def test_privileged_tenant_transfer_cannot_leave_two_active_timers(data):
    with data.factory() as db:
        time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        moved = db.get(models.User, data.owner.id)
        moved.tenant_id = uuid4()
        db.commit()
        with pytest.raises(HTTPException) as error:
            time_tracking.start_timer(db, moved, schemas.TimeEntryStart(task_id=data.task.id))
        assert error.value.status_code == 409
        assert db.query(models.TimeEntry).filter(models.TimeEntry.stopped_at.is_(None)).count() == 1


def test_timer_locking_does_not_change_user_balances_or_profile_timestamps(data):
    with data.factory() as db:
        original = db.get(models.User, data.owner.id)
        snapshot = original.points, original.tasks_created, original.updated_at
        entry = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        assert abs((entry.created_at - entry.started_at).total_seconds()) < 5
        time_tracking.stop_timer(db, data.owner, entry_id=entry.id)
        db.refresh(original)
        assert (original.points, original.tasks_created, original.updated_at) == snapshot


def _user(tenant, role=models.RoleEnum.USER):
    return models.User(id=str(uuid4()), tenant_id=tenant, name="Synthetic member", email=f"{uuid4()}@example.test",
        hashed_password="not-a-login-password", role=role, status=models.UserStatusEnum.ACTIVE)


def test_reads_have_bounded_queries_and_do_not_load_each_assignee(api, data, engine, request):
    def statements_for(path):
        statements = []
        def capture(connection, cursor, statement, params, context, many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)
        event.listen(engine, "before_cursor_execute", capture)
        try:
            response = api.get(f"/api/tasks/{data.task.id}/{path}", headers=auth(data.owner))
            assert response.status_code == 200, response.text
            return statements
        finally:
            event.remove(engine, "before_cursor_execute", capture)
    small = {path: statements_for(path) for path in ("journey", "analytics", "execution-sessions")}
    with data.factory() as db:
        for _ in range(40):
            member = _user(data.owner.tenant_id)
            db.add(member)
            db.flush()
            db.add(models.Subtask(task_id=data.task.id, title="Assigned child", assigned_to_id=member.id))
        db.commit()
    for path, baseline in small.items():
        large = statements_for(path)
        assert len(large) == len(baseline)
        assert len(large) <= 12
        request.node.user_properties.append((f"{path}_selects", f"1 child={len(baseline)}, 41 children={len(large)}"))
        # Only the authenticated user query should hydrate credential fields.
        assert sum("hashed_password" in sql for sql in large) == 1


def test_project_and_legacy_role_policy_is_preserved_for_all_read_apis(api, data):
    with data.factory() as db:
        manager1 = _user(data.owner.tenant_id, models.RoleEnum.MANAGER)
        manager2 = _user(data.owner.tenant_id, models.RoleEnum.MANAGER)
        member = _user(data.owner.tenant_id)
        unrelated_manager = _user(data.owner.tenant_id, models.RoleEnum.MANAGER)
        admin = _user(data.owner.tenant_id, models.RoleEnum.ADMIN)
        db.add_all([manager1, manager2, member, unrelated_manager, admin])
        company = models.Client(tenant_id=data.owner.tenant_id, company_name="Review company", normalized_company_name="review-company")
        db.add(company)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=company.id, name="Review", normalized_name="review")
        db.add(project)
        db.flush()
        for user, role in ((manager1, models.ProjectMemberRoleEnum.MANAGER),
                           (manager2, models.ProjectMemberRoleEnum.MANAGER),
                           (member, models.ProjectMemberRoleEnum.MEMBER)):
            db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id, user_id=user.id, role=role))
        db.get(models.Task, data.task.id).project_id = project.id
        db.commit()
    for user, expected in ((data.owner, 200), (admin, 200), (manager1, 200), (manager2, 200),
                           (member, 200), (unrelated_manager, 403), (data.outsider, 404)):
        for path in ("journey", "analytics", "execution-sessions"):
            response = api.get(f"/api/tasks/{data.task.id}/{path}", headers=auth(user))
            assert response.status_code == expected, response.text


def test_invalid_auth_is_rejected_before_any_snapshot_queries(api, data, engine):
    statements = []
    def capture(*args):
        statements.append(args[2])
    event.listen(engine, "before_cursor_execute", capture)
    try:
        for headers in ({}, {"Authorization": "Bearer invalid"}):
            assert api.get(f"/api/tasks/{data.task.id}/journey", headers=headers).status_code == 401
        assert statements == []
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def test_unauthorized_correction_does_not_disclose_whether_entry_is_active(api, data):
    started = api.post("/api/time-entries/start", headers=auth(data.owner), json={"task_id": data.task.id}).json()
    with data.factory() as db:
        stranger = db.get(models.User, data.outsider.id)
        stranger.tenant_id = data.owner.tenant_id
        stranger.role = models.RoleEnum.USER
        db.commit()
    response = api.patch(f"/api/time-entries/{started['id']}/correction", headers=auth(stranger), json={
        "started_at": NOW.isoformat(), "stopped_at": (NOW + timedelta(seconds=60)).isoformat(),
        "reason": "Not an authorized correction"})
    assert response.status_code == 403, response.text


def test_legacy_creator_read_and_correction_permissions_and_server_owned_session(api, data):
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = models.RoleEnum.USER
        db.commit()
    headers = auth(data.owner)
    for path in ("journey", "analytics", "execution-sessions"):
        assert api.get(f"/api/tasks/{data.task.id}/{path}", headers=headers).status_code == 200
    created = api.post("/api/time-entries/start", headers=headers, json={
        "task_id": data.task.id, "user_id": data.outsider.id,
        "tenant_id": str(data.outsider.tenant_id), "continued_from_id": "forged-link"})
    assert created.status_code == 201, created.text
    entry = created.json()
    assert entry["user_id"] == data.owner.id and entry["tenant_id"] == str(data.owner.tenant_id)
    assert entry["continued_from_id"] is None
    assert api.post(f"/api/time-entries/{entry['id']}/stop", headers=headers).status_code == 200
    correction = api.patch(f"/api/time-entries/{entry['id']}/correction", headers=headers, json={
        "started_at": NOW.isoformat(), "stopped_at": (NOW + timedelta(seconds=60)).isoformat(),
        "reason": "Existing legacy creator permission"})
    assert correction.status_code == 200, correction.text


def test_analytics_reports_immediately_started_work_as_active(api, data):
    headers = auth(data.owner)
    started = api.post("/api/time-entries/start", headers=headers, json={"task_id": data.task.id})
    assert started.status_code == 201, started.text
    response = api.get(f"/api/tasks/{data.task.id}/analytics", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["aggregate"]["active_session_count"] == 1


def test_legacy_future_rows_are_not_repaired_or_counted_as_work(api, data):
    future = datetime(2099, 1, 1, tzinfo=timezone.utc)
    with data.factory() as db:
        row = models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id,
            task_id=data.task.id, started_at=future, status=models.TimeEntryStatusEnum.ACTIVE)
        db.add(row)
        db.commit()
    body = api.get(f"/api/tasks/{data.task.id}/analytics", headers=auth(data.owner)).json()
    assert body["aggregate"]["person_seconds"] == body["aggregate"]["elapsed_seconds"] == 0
    assert body["aggregate"]["active_session_count"] == 1
    assert body["history_complete"] is False
    with data.factory() as db:
        assert time_tracking._as_utc(db.get(models.TimeEntry, row.id).started_at) == future


def test_postgres_session_timezone_cannot_shift_observed_event_timestamps(data, engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL session timezone is not a SQLite feature")
    with data.factory() as db:
        db.execute(text("SET LOCAL TIME ZONE 'Asia/Kolkata'"))
        entry = time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=data.task.id))
        assert abs((entry.created_at - entry.started_at).total_seconds()) < 5
        db.execute(text("SET LOCAL TIME ZONE 'Asia/Kolkata'"))
        time_tracking.stop_timer(db, data.owner, entry_id=entry.id)
        item = history(db, data.task.id, "timer.started")[-1]
        actual = datetime.fromisoformat(item.details["new_started_at"].replace("Z", "+00:00"))
        assert actual == entry.started_at.astimezone(timezone.utc)
        assert abs((item.occurred_at - actual).total_seconds()) < 5


def test_workflow_event_storage_is_utc_in_non_utc_database_sessions(data, engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL session timezone is not a SQLite feature")
    with data.factory() as db:
        db.execute(text("SET LOCAL TIME ZONE 'Asia/Kolkata'"))
        task = db.get(models.Task, data.task.id)
        subtask_workflow.transition_subtask(db, task, actor=data.owner, subtask_id=data.child.id,
            target_status=models.SubtaskStatusEnum.IN_PROGRESS)
        db.commit()
        workflow = db.scalar(select(models.SubtaskWorkflowEvent).where(models.SubtaskWorkflowEvent.task_id == task.id))
        observation = history(db, task.id, "subtask.status_changed")[-1]
        assert abs((workflow.created_at - observation.occurred_at).total_seconds()) < 5


@pytest.mark.parametrize("target", ["task", "subtask"])
def test_start_rechecks_status_after_a_concurrent_transition(data, engine, target):
    payload = schemas.TimeEntryStart(**{f"{target}_id": data.task.id if target == "task" else data.child.id})
    def start():
        with data.factory() as db:
            try:
                time_tracking.start_timer(db, data.owner, payload)
                return 201
            except HTTPException as error:
                return error.status_code
    with data.factory() as transition, ThreadPoolExecutor(max_workers=1) as executor:
        model = models.Task if target == "task" else models.Subtask
        transition.execute(update(model).where(model.id == (data.task.id if target == "task" else data.child.id))
            .values(status=models.TaskStatusEnum.DONE if target == "task" else models.SubtaskStatusEnum.WAITING))
        future = executor.submit(start)
        try:
            Event().wait(.25)
            assert not future.done(), "Start bypassed the in-flight workflow transition"
        finally:
            transition.commit()
        assert future.result(timeout=10) == 409


def test_alembic_upgrade_can_be_reviewed_as_offline_postgresql_sql():
    backend = Path(__file__).resolve().parents[1]
    environment = {**os.environ, "VEE_BOOTSTRAP_SCHEMA": "false",
                   "VEE_DATABASE_URL": "postgresql+psycopg2://rt_test@127.0.0.1/zeaplay_rt3_test"}
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "fc4d5e6f7a8b:fd5e6f7a8b9c", "--sql"],
        cwd=backend, env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert "CREATE TRIGGER zea_lifecycle_tasks" in result.stdout


def test_empty_history_downgrade_serializes_against_new_writes(engine, monkeypatch):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL table-lock race; SQLite uses a database writer lock")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    migration = import_module("backend.alembic.versions.fd5e6f7a8b9c_task_lifecycle_history")
    with engine.begin() as db:
        # Use real model defaults, without inserting a task/history yet.
        db.execute(models.User.__table__.insert().values(id="writer", tenant_id=uuid4(),
            name="Writer", email="writer@example.test", hashed_password="not-a-password"))
    counted, release, writing = Event(), Event(), Event()
    def after_count(connection, cursor, statement, params, context, many):
        if statement.strip() == "SELECT 1 FROM task_lifecycle_events LIMIT 1":
            counted.set()
            assert release.wait(8)
    event.listen(engine, "after_cursor_execute", after_count)
    def downgrade():
        with engine.begin() as connection:
            monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
            migration.downgrade()
    def write():
        with engine.begin() as connection:
            writing.set()
            connection.execute(models.Task.__table__.insert().values(id="during-downgrade", title="Concurrent", created_by_id="writer"))
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            left = executor.submit(downgrade)
            try:
                assert counted.wait(8)
                right = executor.submit(write)
                assert writing.wait(8)
                Event().wait(.25)
                assert not right.done(), "Writer committed history after the guard checked zero rows"
            finally:
                release.set()
            left.result(timeout=10)
            right.result(timeout=10)
    finally:
        event.remove(engine, "after_cursor_execute", after_count)
