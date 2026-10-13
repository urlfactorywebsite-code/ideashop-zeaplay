import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event

from backend.app import models
from backend.app.routers import tasks as tasks_module
from backend.app.services import project_dashboard
from backend.tests.test_tasks_phase5 import (
    TestingSessionLocal,
    _create_client_and_project,
    _create_user,
    engine,
    _noop_notification,
    _task_payload,
    client,
)


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(models.NotificationOutbox).delete()
        db.query(models.TaskTransferRequest).delete()
        db.query(models.Notification).delete()
        db.query(models.AuditLog).delete()
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


@pytest.fixture(autouse=True)
def disable_external_side_effects(monkeypatch):
    monkeypatch.setattr(tasks_module.notification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "_schedule_notification_outbox_delivery", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module.audit_logger, "log_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(project_dashboard.audit_logger, "log_event", lambda *args, **kwargs: None)


def _create_project_task(owner_token: str, project_id: str, member_id: str, manager_id: str) -> dict:
    payload = _task_payload(project_id, [member_id])
    payload["title"] = "Dashboard rollup task"
    payload["subtask_approval_required"] = True
    payload["subtasks"] = [
        {
            "title": "Design approved",
            "completed": True,
            "assigned_to_id": member_id,
            "status": models.SubtaskStatusEnum.DONE.value,
            "sort_order": 0,
        },
        {
            "title": "Build waiting",
            "completed": False,
            "assigned_to_id": member_id,
            "status": models.SubtaskStatusEnum.WAITING.value,
            "sort_order": 1,
        },
        {
            "title": "QA active",
            "completed": False,
            "assigned_to_id": manager_id,
            "status": models.SubtaskStatusEnum.IN_PROGRESS.value,
            "sort_order": 2,
        },
    ]
    response = client.post("/api/tasks", json=payload, headers={"Authorization": f"Bearer {owner_token}"})
    assert response.status_code == 201, response.text
    return response.json()[0]


def test_project_task_dashboard_rolls_up_dependencies_timers_and_status_contract():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    task = _create_project_task(owner_token, project.id, member.id, manager.id)
    design, build, qa = task["subtasks"]

    db = TestingSessionLocal()
    try:
        db.add(
            models.SubtaskDependency(
                task_id=task["id"],
                subtask_id=build["id"],
                depends_on_subtask_id=design["id"],
                dependency_order=0,
                branch_key="sequential-build",
            )
        )
        db.add(
            models.TimeEntry(
                tenant_id=tenant,
                user_id=manager.id,
                task_id=task["id"],
                started_at=datetime.utcnow() - timedelta(hours=2),
                stopped_at=datetime.utcnow() - timedelta(hours=1),
                duration_seconds=3600,
            )
        )
        db.add(
            models.TimeEntry(
                tenant_id=tenant,
                user_id=member.id,
                subtask_id=qa["id"],
                started_at=datetime.utcnow() - timedelta(minutes=30),
                stopped_at=None,
                duration_seconds=None,
            )
        )
        db.add(
            models.SubtaskWorkflowEvent(
                event_key=f"force:{qa['id']}",
                task_id=task["id"],
                subtask_id=qa["id"],
                event_type="SUBTASK_FORCE_STARTED",
                from_status=models.SubtaskStatusEnum.WAITING,
                to_status=models.SubtaskStatusEnum.IN_PROGRESS,
                actor_id=manager.id,
                reason="Customer escalation",
                blocked_predecessor_ids=[build["id"]],
            )
        )
        db.add(
            models.CompletionSubmission(
                tenant_id=tenant,
                task_id=task["id"],
                subtask_id=build["id"],
                submitted_by_id=member.id,
                description="Work proof awaiting manager review",
                description_word_count=5,
                status=models.CompletionSubmissionStatusEnum.PENDING_REVIEW,
                approval_required=True,
                attempt_number=1,
            )
        )
        db.commit()
    finally:
        db.close()

    assert len(models.TaskStatusEnum) == 11
    assert models.TaskStatusEnum.BUG_FIXING.value == "BUG_FIXING"
    assert models.TaskStatusEnum.DEPLOYED.value == "DEPLOYED"
    assert {status.value for status in models.SubtaskStatusEnum} == {
        "WAITING",
        "TODO",
        "IN_PROGRESS",
        "BLOCKED",
        "IN_REVIEW",
        "DONE",
    }

    response = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project"]["id"] == project.id
    assert body["summary"]["task_total"] == 1
    assert body["summary"]["subtask_total"] == 3
    assert body["summary"]["completed_subtasks"] == 1
    assert body["summary"]["progress_percent"] == 33
    assert body["summary"]["total_tracked_seconds"] == 3600
    assert body["summary"]["active_timer_count"] == 1
    assert body["summary"]["status_counts"]["TODO"] == 1
    assert body["summary"]["subtask_status_counts"]["WAITING"] == 1
    assert body["status_policy"].startswith("Task.status is the manual parent-task status")

    dashboard_task = body["items"][0]
    assert dashboard_task["status"] == "TODO"
    assert dashboard_task["derived_status"] == "IN_PROGRESS"
    assert dashboard_task["status_source"] == "subtask_rollup"
    assert dashboard_task["progress_percent"] == 33
    assert dashboard_task["total_tracked_seconds"] == 3600

    subtasks = {item["title"]: item for item in dashboard_task["subtasks"]}
    assert subtasks["Build waiting"]["dependency_ids"] == [design["id"]]
    assert subtasks["Build waiting"]["branch_key"] == "sequential-build"
    assert subtasks["Build waiting"]["dependency_state"] == "WAITING"
    assert subtasks["Build waiting"]["latest_submission_status"] == "PENDING_REVIEW"
    assert subtasks["Build waiting"]["completion_approval_required"] is True
    assert subtasks["QA active"]["force_started"] is True
    assert subtasks["QA active"]["active_timer_user_ids"] == [member.id]
    assert subtasks["Design approved"]["dependent_ids"] == [build["id"]]


def test_project_task_dashboard_uses_status_not_stale_legacy_completed_flag_for_progress():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    db = TestingSessionLocal()
    try:
        task = models.Task(
            title="Legacy completed flag task",
            description="Old subtask data",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="Delivery",
            created_by_id=owner.id,
            assigned_to_id=member.id,
            project_id=project.id,
        )
        task.subtasks.append(
            models.Subtask(
                title="Legacy done",
                completed=True,
                assigned_to_id=member.id,
                status=models.SubtaskStatusEnum.TODO,
                sort_order=0,
            )
        )
        db.add(task)
        db.commit()
        task_id = task.id
    finally:
        db.close()

    response = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert response.status_code == 200, response.text
    dashboard_task = response.json()["items"][0]
    assert dashboard_task["id"] == task_id
    assert dashboard_task["status"] == "TODO"
    assert dashboard_task["derived_status"] == "TODO"
    assert dashboard_task["completed_subtasks"] == 0
    assert dashboard_task["progress_percent"] == 0
    assert dashboard_task["subtasks"][0]["completed"] is True

    db = TestingSessionLocal()
    try:
        persisted = db.get(models.Task, task_id)
        assert persisted.status == models.TaskStatusEnum.TODO
        assert persisted.completed_at is None
    finally:
        db.close()


def test_project_task_dashboard_mixed_dependencies_reopen_missing_assignee_and_archived_project():
    tenant = uuid.uuid4()
    owner, _ = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
        status=models.ProjectStatusEnum.ARCHIVED,
    )
    db = TestingSessionLocal()
    try:
        task = models.Task(
            title="Archived mixed dependency task",
            description="Historical archived project task",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.HIGH,
            team="Delivery",
            created_by_id=owner.id,
            assigned_to_id=member.id,
            project_id=project.id,
        )
        task.subtasks.extend(
            [
                models.Subtask(
                    title="A done",
                    completed=True,
                    assigned_to_id=member.id,
                    status=models.SubtaskStatusEnum.DONE,
                    sort_order=0,
                ),
                models.Subtask(
                    title="B reopened review",
                    completed=False,
                    assigned_to_id=None,
                    status=models.SubtaskStatusEnum.IN_REVIEW,
                    sort_order=1,
                ),
                models.Subtask(
                    title="C sequential waiting",
                    completed=False,
                    assigned_to_id=member.id,
                    status=models.SubtaskStatusEnum.WAITING,
                    sort_order=2,
                ),
                models.Subtask(
                    title="D parallel active",
                    completed=False,
                    assigned_to_id=manager.id,
                    status=models.SubtaskStatusEnum.IN_PROGRESS,
                    sort_order=3,
                ),
            ]
        )
        db.add(task)
        db.flush()
        by_title = {subtask.title: subtask for subtask in task.subtasks}
        db.add(
            models.SubtaskDependency(
                task_id=task.id,
                subtask_id=by_title["B reopened review"].id,
                depends_on_subtask_id=by_title["A done"].id,
                dependency_order=0,
                branch_key="sequential",
            )
        )
        db.add(
            models.SubtaskDependency(
                task_id=task.id,
                subtask_id=by_title["C sequential waiting"].id,
                depends_on_subtask_id=by_title["B reopened review"].id,
                dependency_order=1,
                branch_key="sequential",
            )
        )
        db.add(
            models.SubtaskWorkflowEvent(
                event_key=f"review:{by_title['C sequential waiting'].id}",
                task_id=task.id,
                subtask_id=by_title["C sequential waiting"].id,
                event_type="SUBTASK_REVIEW_REQUIRED",
                from_status=models.SubtaskStatusEnum.TODO,
                to_status=models.SubtaskStatusEnum.IN_REVIEW,
                actor_id=manager.id,
                blocked_predecessor_ids=[by_title["B reopened review"].id],
            )
        )
        db.commit()
        task_id = task.id
    finally:
        db.close()

    response = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project"]["status"] == models.ProjectStatusEnum.ARCHIVED.value
    assert body["summary"]["progress_percent"] == 25
    assert body["summary"]["completed_subtasks"] == 1

    dashboard_task = body["items"][0]
    assert dashboard_task["id"] == task_id
    assert dashboard_task["derived_status"] == models.TaskStatusEnum.IN_REVIEW.value
    assert dashboard_task["progress_percent"] == 25
    subtasks = {item["title"]: item for item in dashboard_task["subtasks"]}
    assert subtasks["B reopened review"]["assigned_to_id"] is None
    assert subtasks["B reopened review"]["assigned_user_name"] is None
    assert subtasks["C sequential waiting"]["dependency_ids"] == [subtasks["B reopened review"]["id"]]
    assert subtasks["C sequential waiting"]["dependency_state"] == "WAITING"
    assert subtasks["D parallel active"]["dependency_ids"] == []
    assert subtasks["D parallel active"]["dependency_state"] == "READY"


def test_project_task_status_override_is_authorized_audited_and_does_not_award_xp(monkeypatch):
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, manager_token = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    task = _create_project_task(owner_token, project.id, member.id, manager.id)
    captured = []
    monkeypatch.setattr(project_dashboard.audit_logger, "log_event", lambda entry: captured.append(entry))

    forbidden = client.patch(
        f"/api/projects/{project.id}/tasks/{task['id']}/status",
        json={"status": models.TaskStatusEnum.DEPLOYED.value, "reason": "Release verified"},
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert forbidden.status_code == 403

    db = TestingSessionLocal()
    try:
        points_before = db.get(models.User, member.id).points
    finally:
        db.close()

    response = client.patch(
        f"/api/projects/{project.id}/tasks/{task['id']}/status",
        json={"status": models.TaskStatusEnum.DEPLOYED.value, "reason": "Release verified"},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "DEPLOYED"
    assert body["derived_status"] == "DEPLOYED"
    assert body["status_source"] == "manual_override"

    db = TestingSessionLocal()
    try:
        refreshed_task = db.get(models.Task, task["id"])
        refreshed_member = db.get(models.User, member.id)
        assert refreshed_task.status == models.TaskStatusEnum.DEPLOYED
        assert refreshed_task.completed_at is None
        assert refreshed_member.points == points_before
    finally:
        db.close()

    assert captured
    assert captured[-1].action == "PROJECT_TASK_STATUS_OVERRIDE"
    assert captured[-1].old_value == models.TaskStatusEnum.TODO.value
    assert captured[-1].new_value == models.TaskStatusEnum.DEPLOYED.value
    assert captured[-1].metadata["xp_awarded"] is False


def test_manual_done_override_does_not_create_premature_derived_done_or_xp(monkeypatch):
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, manager_token = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    task = _create_project_task(owner_token, project.id, member.id, manager.id)
    monkeypatch.setattr(project_dashboard.audit_logger, "log_event", lambda _entry: None)

    db = TestingSessionLocal()
    try:
        points_before = db.get(models.User, member.id).points
    finally:
        db.close()

    response = client.patch(
        f"/api/projects/{project.id}/tasks/{task['id']}/status",
        json={"status": models.TaskStatusEnum.DONE.value, "reason": "Manager parent status override"},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == models.TaskStatusEnum.DONE.value
    assert body["derived_status"] != models.TaskStatusEnum.DONE.value
    assert body["progress_percent"] < 100

    db = TestingSessionLocal()
    try:
        refreshed_task = db.get(models.Task, task["id"])
        refreshed_member = db.get(models.User, member.id)
        assert refreshed_task.status == models.TaskStatusEnum.DONE
        assert refreshed_task.completed_at is None
        assert refreshed_member.points == points_before
    finally:
        db.close()


def test_project_task_dashboard_filters_and_tenant_visibility():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    outsider, outsider_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    task = _create_project_task(owner_token, project.id, member.id, manager.id)

    db = TestingSessionLocal()
    try:
        db_task = db.get(models.Task, task["id"])
        db_task.status = models.TaskStatusEnum.BUG_FIXING
        db_task.priority = models.TaskPriorityEnum.URGENT
        db.commit()
    finally:
        db.close()

    denied = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert denied.status_code == 404

    filtered = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        params={
            "status": models.TaskStatusEnum.BUG_FIXING.value,
            "priority": models.TaskPriorityEnum.URGENT.value,
            "member_id": member.id,
            "q": "dashboard",
            "page": 1,
            "page_size": 1,
        },
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert filtered.status_code == 200, filtered.text
    body = filtered.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 1
    assert body["items"][0]["id"] == task["id"]

    invalid_status = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        params={"status": "SHIPPED"},
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert invalid_status.status_code == 422


def test_project_task_dashboard_includes_all_backend_status_values_in_counts():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    db = TestingSessionLocal()
    try:
        for task_status in models.TaskStatusEnum:
            db.add(
                models.Task(
                    title=f"Status {task_status.value}",
                    description="Status compatibility check",
                    status=task_status,
                    priority=models.TaskPriorityEnum.MEDIUM,
                    team="Delivery",
                    created_by_id=owner.id,
                    assigned_to_id=member.id,
                    project_id=project.id,
                )
            )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        params={"page_size": 100},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["task_total"] == len(models.TaskStatusEnum)
    assert set(body["summary"]["status_counts"]) == {status.value for status in models.TaskStatusEnum}
    assert set(body["summary"]["derived_status_counts"]) == {status.value for status in models.TaskStatusEnum}
    assert body["summary"]["status_counts"]["BUG_FIXING"] == 1
    assert body["summary"]["status_counts"]["DEPLOYED"] == 1
    assert {item["status"] for item in body["items"]} == {status.value for status in models.TaskStatusEnum}


def test_project_task_dashboard_large_lists_are_paginated_and_query_bounded():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    db = TestingSessionLocal()
    try:
        for index in range(80):
            task = models.Task(
                title=f"Bulk task {index:03d}",
                description="Large dashboard query test",
                status=models.TaskStatusEnum.TODO,
                priority=models.TaskPriorityEnum.MEDIUM,
                team="Delivery",
                created_by_id=owner.id,
                assigned_to_id=member.id,
                project_id=project.id,
            )
            task.subtasks.extend(
                [
                    models.Subtask(
                        title=f"Bulk {index:03d} done",
                        completed=True,
                        assigned_to_id=member.id,
                        status=models.SubtaskStatusEnum.DONE,
                        sort_order=0,
                    ),
                    models.Subtask(
                        title=f"Bulk {index:03d} waiting",
                        completed=False,
                        assigned_to_id=None,
                        status=models.SubtaskStatusEnum.WAITING,
                        sort_order=1,
                    ),
                ]
            )
            db.add(task)
        db.commit()
    finally:
        db.close()

    selects: list[str] = []

    def capture_selects(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(engine, "before_cursor_execute", capture_selects)
    try:
        response = client.get(
            f"/api/projects/{project.id}/task-dashboard",
            params={"page": 2, "page_size": 25},
            headers={"Authorization": f"Bearer {owner_token}"},
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_selects)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 80
    assert body["total_pages"] == 4
    assert len(body["items"]) == 25
    assert body["summary"]["subtask_total"] == 160
    assert body["summary"]["progress_percent"] == 50
    assert len(selects) <= 45


def test_project_task_dashboard_timer_totals_and_active_users_are_consistent():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    db = TestingSessionLocal()
    try:
        task = models.Task(
            title="Timer dashboard task",
            description="Timer consistency check",
            status=models.TaskStatusEnum.IN_PROGRESS,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="Delivery",
            created_by_id=owner.id,
            assigned_to_id=member.id,
            project_id=project.id,
        )
        subtask = models.Subtask(
            title="Timed subtask",
            completed=False,
            assigned_to_id=manager.id,
            status=models.SubtaskStatusEnum.IN_PROGRESS,
            sort_order=0,
        )
        task.subtasks.append(subtask)
        db.add(task)
        db.flush()
        db.add_all(
            [
                models.TimeEntry(
                    tenant_id=tenant,
                    user_id=member.id,
                    task_id=task.id,
                    started_at=datetime.utcnow() - timedelta(hours=4),
                    stopped_at=datetime.utcnow() - timedelta(hours=3),
                    duration_seconds=3600,
                ),
                models.TimeEntry(
                    tenant_id=tenant,
                    user_id=manager.id,
                    subtask_id=subtask.id,
                    started_at=datetime.utcnow() - timedelta(hours=2),
                    stopped_at=datetime.utcnow() - timedelta(hours=1, minutes=30),
                    duration_seconds=1800,
                ),
                models.TimeEntry(
                    tenant_id=tenant,
                    user_id=member.id,
                    task_id=task.id,
                    started_at=datetime.utcnow() - timedelta(minutes=10),
                    stopped_at=None,
                    duration_seconds=None,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/projects/{project.id}/task-dashboard",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["total_tracked_seconds"] == 5400
    assert body["summary"]["active_timer_count"] == 1
    item = body["items"][0]
    assert item["total_tracked_seconds"] == 5400
    assert item["active_timer_user_ids"] == [member.id]
    assert item["subtasks"][0]["total_tracked_seconds"] == 1800
    assert item["subtasks"][0]["active_timer_user_ids"] == []
