import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import models
from backend.app.database import get_db
from backend.app.routers.clients import router as clients_router
from backend.app.routers.projects import router as projects_router
from backend.app.routers.tasks import router as tasks_router
from backend.app.routers.time_entries import router as time_entries_router
from backend.app.services import time_tracking
from backend.tests.test_tasks_phase5 import (
    TestingSessionLocal,
    _create_client_and_project,
    _create_user,
    _task_payload,
    override_get_db,
)
from backend.tests.test_tasks_phase6 import _token_for_existing_user


app = FastAPI()
app.include_router(clients_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(time_entries_router, prefix="/api")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(models.TaskTransferRequest).delete()
        db.query(models.Notification).delete()
        db.query(models.AuditEvent).delete()
        db.query(models.TimeEntry).delete()
        db.query(models.CompletionAttachment).delete()
        db.query(models.CompletionSubmission).delete()
        db.query(models.SubtaskWorkflowEvent).delete()
        db.query(models.SubtaskDependency).delete()
        db.query(models.Subtask).delete()
        db.query(models.Task).delete()
        db.query(models.ProjectMember).delete()
        db.query(models.Project).delete()
        db.query(models.Client).delete()
        db.query(models.User).delete()
        db.commit()
    finally:
        db.close()


def _timer_task(*, with_waiting_subtask: bool = True):
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(tenant_id=tenant, manager_ids=[manager.id], member_ids=[member.id])
    payload = _task_payload(project.id, [member.id])
    payload["subtasks"] = [
        {
            "title": "Active subtask",
            "completed": False,
            "status": models.SubtaskStatusEnum.TODO.value,
            "assigned_to_id": member.id,
        }
    ]
    if with_waiting_subtask:
        payload["subtasks"].append(
            {
                "title": "Waiting subtask",
                "completed": False,
                "status": models.SubtaskStatusEnum.WAITING.value,
                "assigned_to_id": member.id,
            }
        )
    created = client.post("/api/tasks", json=payload, headers={"Authorization": f"Bearer {owner_token}"})
    assert created.status_code == 201, created.text
    return tenant, owner_token, manager, member, member_token, created.json()[0]


def _subtask(task: dict, title: str) -> dict:
    return next(item for item in task["subtasks"] if item["title"] == title)


def test_task_timer_start_stop_active_and_duplicate_requests_are_idempotent():
    _, _, _, _, member_token, task = _timer_task()
    headers = {"Authorization": f"Bearer {member_token}"}
    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert started.status_code == 201, started.text
    duplicate_start = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert duplicate_start.status_code == 201, duplicate_start.text
    assert duplicate_start.json()["id"] == started.json()["id"]

    active = client.get("/api/time-entries/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["active"]["id"] == started.json()["id"]

    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=headers)
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["stopped_at"] is not None
    assert stopped.json()["duration_seconds"] >= 0
    duplicate_stop = client.post(f"/api/time-entries/{started.json()['id']}/stop", headers=headers)
    assert duplicate_stop.status_code == 200, duplicate_stop.text
    assert duplicate_stop.json()["duration_seconds"] == stopped.json()["duration_seconds"]


def test_double_click_start_and_stop_retries_are_idempotent_under_concurrency():
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}

    def start_once():
        with TestClient(app) as tab_client:
            return tab_client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as executor:
        start_responses = list(executor.map(lambda _: start_once(), range(2)))

    assert {response.status_code for response in start_responses} == {201}
    started_ids = {response.json()["id"] for response in start_responses}
    assert len(started_ids) == 1
    entry_id = next(iter(started_ids))

    first_stop = client.post("/api/time-entries/stop", json={"entry_id": entry_id}, headers=headers)
    retry_stop = client.post("/api/time-entries/stop", json={"entry_id": entry_id}, headers=headers)
    assert first_stop.status_code == 200, first_stop.text
    assert retry_stop.status_code == 200, retry_stop.text
    assert retry_stop.json()["id"] == first_stop.json()["id"]
    assert retry_stop.json()["duration_seconds"] == first_stop.json()["duration_seconds"]


def test_stop_without_start_returns_no_active_timer():
    _, _, _, _, member_token, _ = _timer_task(with_waiting_subtask=False)
    response = client.post("/api/time-entries/stop", json={}, headers={"Authorization": f"Bearer {member_token}"})
    assert response.status_code == 200, response.text
    assert response.json() is None


def test_start_rejects_invalid_targets_and_allows_independent_timers():
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}
    subtask_id = _subtask(task, "Active subtask")["id"]

    missing_target = client.post("/api/time-entries/start", json={}, headers=headers)
    assert missing_target.status_code == 422
    double_target = client.post(
        "/api/time-entries/start",
        json={"task_id": task["id"], "subtask_id": subtask_id},
        headers=headers,
    )
    assert double_target.status_code == 422

    active = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert active.status_code == 201, active.text
    second_target = client.post("/api/time-entries/start", json={"subtask_id": subtask_id}, headers=headers)
    assert second_target.status_code == 201, second_target.text
    snapshot = client.get("/api/time-entries/work/active", headers=headers).json()
    assert snapshot["running_count"] == 2


def test_legacy_projectless_task_timer_enforces_creator_tenant_boundary():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    creator, creator_token = _create_user(models.RoleEnum.OWNER, tenant_a)
    _, foreign_admin_token = _create_user(models.RoleEnum.ADMIN, tenant_b)

    db = TestingSessionLocal()
    try:
        task = models.Task(
            title="Legacy projectless task",
            description="Historical task with NULL project_id",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="General",
            created_by_id=creator.id,
        )
        db.add(task)
        db.commit()
        task_id = task.id
    finally:
        db.close()

    denied = client.post(
        "/api/time-entries/start",
        json={"task_id": task_id},
        headers={"Authorization": f"Bearer {foreign_admin_token}"},
    )
    assert denied.status_code == 404

    allowed = client.post(
        "/api/time-entries/start",
        json={"task_id": task_id},
        headers={"Authorization": f"Bearer {creator_token}"},
    )
    assert allowed.status_code == 201, allowed.text


def test_independent_targets_run_concurrently_and_duplicate_target_is_constrained():
    _, _, _, _, member_token, task = _timer_task()
    headers = {"Authorization": f"Bearer {member_token}"}
    active_subtask = _subtask(task, "Active subtask")
    first = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert first.status_code == 201, first.text
    second = client.post("/api/time-entries/start", json={"subtask_id": active_subtask["id"]}, headers=headers)
    assert second.status_code == 201, second.text

    db = TestingSessionLocal()
    try:
        db.add(
            models.TimeEntry(
                tenant_id=uuid.UUID(first.json()["tenant_id"]),
                user_id=first.json()["user_id"],
                task_id=task["id"],
                started_at=time_tracking.utc_now(),
                status=models.TimeEntryStatusEnum.ACTIVE,
            )
        )
        with pytest.raises(Exception):
            db.commit()
    finally:
        db.rollback()
        db.close()


def test_subtask_timer_respects_workflow_activation_and_authorization():
    tenant, _, _, member, member_token, task = _timer_task()
    waiting_subtask = _subtask(task, "Waiting subtask")
    active_subtask = _subtask(task, "Active subtask")
    headers = {"Authorization": f"Bearer {member_token}"}
    waiting = client.post("/api/time-entries/start", json={"subtask_id": waiting_subtask["id"]}, headers=headers)
    assert waiting.status_code == 409

    outsider, outsider_token = _create_user(models.RoleEnum.USER, tenant)
    db = TestingSessionLocal()
    try:
        db.add(
            models.ProjectMember(
                tenant_id=tenant,
                project_id=task["project_id"],
                user_id=outsider.id,
                role=models.ProjectMemberRoleEnum.MEMBER,
            )
        )
        db.commit()
    finally:
        db.close()
    unauthorized = client.post(
        "/api/time-entries/start",
        json={"subtask_id": active_subtask["id"]},
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert unauthorized.status_code == 403


def test_resume_uses_server_timestamps_and_refresh_preserves_active_timer():
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}
    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert started.status_code == 201, started.text
    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=headers)
    assert stopped.status_code == 200, stopped.text
    resumed = client.post(f"/api/time-entries/{started.json()['id']}/resume", headers=headers)
    assert resumed.status_code == 201, resumed.text
    assert resumed.json()["id"] != started.json()["id"]
    active = client.get("/api/time-entries/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["active"]["id"] == resumed.json()["id"]


def test_active_timer_survives_browser_refresh_and_server_restart_style_client_recreation():
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}
    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert started.status_code == 201, started.text

    fresh_client = TestClient(app)
    active = fresh_client.get("/api/time-entries/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["active"]["id"] == started.json()["id"]


def test_midnight_crossing_and_long_running_sessions_use_server_utc(monkeypatch):
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}
    # Response projections also read the server clock. Advance simulated time per
    # action, independent of how many read-only projections that action performs.
    clock = [datetime(2026, 9, 1, 23, 50, tzinfo=timezone.utc)]
    monkeypatch.setattr(time_tracking, "utc_now", lambda: clock[0])

    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=headers)
    assert started.status_code == 201, started.text
    clock[0] = datetime(2026, 9, 2, 0, 10, tzinfo=timezone.utc)
    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=headers)
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["duration_seconds"] == 20 * 60

    clock[0] = datetime(2026, 9, 3, 8, 0, tzinfo=timezone.utc)
    resumed = client.post(f"/api/time-entries/{started.json()['id']}/resume", headers=headers)
    assert resumed.status_code == 201, resumed.text
    clock[0] += timedelta(days=30)
    long_stop = client.post("/api/time-entries/stop", json={"entry_id": resumed.json()["id"]}, headers=headers)
    assert long_stop.status_code == 200, long_stop.text
    assert long_stop.json()["duration_seconds"] == 30 * 24 * 60 * 60


def test_manual_correction_preserves_original_values_and_writes_audit():
    _, owner_token, _, member, member_token, task = _timer_task(with_waiting_subtask=False)
    member_headers = {"Authorization": f"Bearer {member_token}"}
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=member_headers)
    assert started.status_code == 201, started.text
    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=member_headers)
    assert stopped.status_code == 200, stopped.text

    correction_start = time_tracking.utc_now() - timedelta(hours=2)
    correction_stop = correction_start + timedelta(minutes=45)
    corrected = client.patch(
        f"/api/time-entries/{started.json()['id']}/correction",
        json={
            "started_at": correction_start.isoformat(),
            "stopped_at": correction_stop.isoformat(),
            "reason": "Corrected from timesheet",
            "note": "Manual adjustment",
        },
        headers=owner_headers,
    )
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["duration_seconds"] == 2700
    assert body["original_started_at"] == stopped.json()["started_at"]
    assert body["original_duration_seconds"] == stopped.json()["duration_seconds"]
    assert body["corrected_by_id"] != member.id

    db = TestingSessionLocal()
    try:
        assert db.query(models.AuditEvent).filter(models.AuditEvent.event_type == "time_entry.corrected").count() == 1
    finally:
        db.close()


def test_unauthorized_correction_is_rejected_and_browser_timezones_normalize_to_utc():
    _, owner_token, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    member_headers = {"Authorization": f"Bearer {member_token}"}
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    started = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=member_headers)
    assert started.status_code == 201, started.text
    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=member_headers)
    assert stopped.status_code == 200, stopped.text

    timezone_payload = {
        "started_at": datetime(2026, 10, 13, 9, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))).isoformat(),
        "stopped_at": datetime(2026, 10, 13, 10, 30, tzinfo=timezone(timedelta(hours=5, minutes=30))).isoformat(),
        "reason": "Browser timezone correction",
    }
    denied = client.patch(
        f"/api/time-entries/{started.json()['id']}/correction",
        json=timezone_payload,
        headers=member_headers,
    )
    assert denied.status_code == 403

    corrected = client.patch(
        f"/api/time-entries/{started.json()['id']}/correction",
        json=timezone_payload,
        headers=owner_headers,
    )
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["duration_seconds"] == 90 * 60
    assert body["started_at"].startswith("2026-10-13T03:30:00")
    assert body["stopped_at"].startswith("2026-10-13T05:00:00")


def test_manual_correction_rejects_overlapping_parent_and_subtask_work():
    _, owner_token, _, member, member_token, task = _timer_task(with_waiting_subtask=False)
    member_headers = {"Authorization": f"Bearer {member_token}"}
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    subtask_id = _subtask(task, "Active subtask")["id"]

    parent = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=member_headers)
    assert parent.status_code == 201, parent.text
    parent_stop = client.post("/api/time-entries/stop", json={"entry_id": parent.json()["id"]}, headers=member_headers)
    assert parent_stop.status_code == 200, parent_stop.text
    subtask = client.post("/api/time-entries/start", json={"subtask_id": subtask_id}, headers=member_headers)
    assert subtask.status_code == 201, subtask.text
    subtask_stop = client.post("/api/time-entries/stop", json={"entry_id": subtask.json()["id"]}, headers=member_headers)
    assert subtask_stop.status_code == 200, subtask_stop.text

    first_start = time_tracking.utc_now() - timedelta(hours=3)
    first_stop = first_start + timedelta(hours=1)
    corrected_parent = client.patch(
        f"/api/time-entries/{parent.json()['id']}/correction",
        json={"started_at": first_start.isoformat(), "stopped_at": first_stop.isoformat(), "reason": "Set baseline"},
        headers=owner_headers,
    )
    assert corrected_parent.status_code == 200, corrected_parent.text
    overlap = client.patch(
        f"/api/time-entries/{subtask.json()['id']}/correction",
        json={
            "started_at": (first_start + timedelta(minutes=15)).isoformat(),
            "stopped_at": (first_start + timedelta(minutes=45)).isoformat(),
            "reason": "Should not overlap parent task work",
        },
        headers=owner_headers,
    )
    assert overlap.status_code == 409


def test_non_overlapping_parent_and_subtask_totals_are_deterministic_without_double_counting():
    _, owner_token, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    member_headers = {"Authorization": f"Bearer {member_token}"}
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    subtask_id = _subtask(task, "Active subtask")["id"]

    parent = client.post("/api/time-entries/start", json={"task_id": task["id"]}, headers=member_headers)
    assert parent.status_code == 201, parent.text
    parent_stop = client.post("/api/time-entries/stop", json={"entry_id": parent.json()["id"]}, headers=member_headers)
    assert parent_stop.status_code == 200, parent_stop.text
    subtask = client.post("/api/time-entries/start", json={"subtask_id": subtask_id}, headers=member_headers)
    assert subtask.status_code == 201, subtask.text
    subtask_stop = client.post("/api/time-entries/stop", json={"entry_id": subtask.json()["id"]}, headers=member_headers)
    assert subtask_stop.status_code == 200, subtask_stop.text

    baseline = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    parent_correction = client.patch(
        f"/api/time-entries/{parent.json()['id']}/correction",
        json={
            "started_at": baseline.isoformat(),
            "stopped_at": (baseline + timedelta(hours=1)).isoformat(),
            "reason": "Normalize parent session",
        },
        headers=owner_headers,
    )
    assert parent_correction.status_code == 200, parent_correction.text
    subtask_correction = client.patch(
        f"/api/time-entries/{subtask.json()['id']}/correction",
        json={
            "started_at": (baseline + timedelta(hours=1)).isoformat(),
            "stopped_at": (baseline + timedelta(hours=1, minutes=30)).isoformat(),
            "reason": "Normalize subtask session",
        },
        headers=owner_headers,
    )
    assert subtask_correction.status_code == 200, subtask_correction.text

    detail = client.get(f"/api/tasks/{task['id']}", headers=member_headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["total_tracked_seconds"] == 90 * 60
    assert _subtask(body, "Active subtask")["total_tracked_seconds"] == 30 * 60


def test_task_serialization_includes_task_and_subtask_totals():
    _, _, _, _, member_token, task = _timer_task(with_waiting_subtask=False)
    headers = {"Authorization": f"Bearer {member_token}"}
    subtask_id = _subtask(task, "Active subtask")["id"]
    started = client.post("/api/time-entries/start", json={"subtask_id": subtask_id}, headers=headers)
    assert started.status_code == 201, started.text
    stopped = client.post("/api/time-entries/stop", json={"entry_id": started.json()["id"]}, headers=headers)
    assert stopped.status_code == 200, stopped.text
    detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["total_tracked_seconds"] == stopped.json()["duration_seconds"]
    assert _subtask(body, "Active subtask")["total_tracked_seconds"] == stopped.json()["duration_seconds"]
