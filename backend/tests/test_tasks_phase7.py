import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.app import models
from backend.app.routers import tasks as tasks_module
from backend.tests.test_tasks_phase5 import (
    TestingSessionLocal,
    _create_client_and_project,
    _create_user,
    _noop_notification,
    _task_payload,
    client,
)
from backend.tests.test_tasks_phase6 import _token_for_existing_user


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


@pytest.fixture(autouse=True)
def disable_external_task_side_effects(monkeypatch):
    monkeypatch.setattr(tasks_module.notification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(tasks_module.subtask_notifications, "enqueue_workflow_notifications", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)


def _workflow_task() -> tuple[uuid.UUID, str, models.User, models.User, dict]:
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    payload = _task_payload(project.id, [])
    payload["subtasks"] = [
        {"title": "Predecessor", "completed": False, "sort_order": 0},
        {
            "title": "Successor",
            "completed": False,
            "status": models.SubtaskStatusEnum.WAITING.value,
            "assigned_to_id": member.id,
            "sort_order": 1,
        },
        {"title": "Parallel independent", "completed": False, "sort_order": 2},
    ]
    created = client.post(
        "/api/tasks",
        json=payload,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert created.status_code == 201, created.text
    task = created.json()[0]
    predecessor_id, successor_id, _ = [item["id"] for item in task["subtasks"]]
    dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{successor_id}/dependencies",
        json={"depends_on_subtask_id": predecessor_id},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert dependency.status_code == 201, dependency.text
    return tenant, owner_token, manager, member, task


def _subtask(task: dict, title: str) -> dict:
    return next(item for item in task["subtasks"] if item["title"] == title)


def _workflow_event_count(*, subtask_id: str, event_type: str) -> int:
    db = TestingSessionLocal()
    try:
        return (
            db.query(models.SubtaskWorkflowEvent)
            .filter(
                models.SubtaskWorkflowEvent.subtask_id == subtask_id,
                models.SubtaskWorkflowEvent.event_type == event_type,
            )
            .count()
        )
    finally:
        db.close()


def test_completion_activates_waiting_successor_once_and_preserves_parallel_work():
    _, owner_token, _, _, task = _workflow_task()
    headers = {"Authorization": f"Bearer {owner_token}"}
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")
    independent = _subtask(task, "Parallel independent")

    completed = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    body = completed.json()
    assert _subtask(body, "Successor")["status"] == models.SubtaskStatusEnum.TODO.value
    assert _subtask(body, "Parallel independent")["status"] == models.SubtaskStatusEnum.TODO.value

    duplicate = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert duplicate.status_code == 200, duplicate.text

    db = TestingSessionLocal()
    try:
        activation_count = (
            db.query(models.SubtaskWorkflowEvent)
            .filter(
                models.SubtaskWorkflowEvent.subtask_id == successor["id"],
                models.SubtaskWorkflowEvent.event_type == "SUBTASK_ACTIVATED",
            )
            .count()
        )
        assert activation_count == 1
        assert (
            db.query(models.SubtaskWorkflowEvent)
            .filter(models.SubtaskWorkflowEvent.subtask_id == independent["id"])
            .count()
            == 0
        )
    finally:
        db.close()


def test_simultaneous_completion_requests_do_not_duplicate_activation_history():
    _, owner_token, _, _, task = _workflow_task()
    headers = {"Authorization": f"Bearer {owner_token}"}
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")

    def complete_once():
        return client.patch(
            f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
            json={"status": models.SubtaskStatusEnum.DONE.value},
            headers=headers,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: complete_once(), range(2)))

    assert {response.status_code for response in responses} == {200}
    detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert _subtask(detail.json(), "Successor")["status"] == models.SubtaskStatusEnum.TODO.value
    assert _workflow_event_count(
        subtask_id=successor["id"],
        event_type="SUBTASK_ACTIVATED",
    ) == 1


def test_invalid_direct_waiting_completion_rolls_back_without_history():
    _, owner_token, _, _, task = _workflow_task()
    successor = _subtask(task, "Successor")
    response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 409

    detail = client.get(f"/api/tasks/{task['id']}", headers={"Authorization": f"Bearer {owner_token}"})
    assert detail.status_code == 200, detail.text
    assert _subtask(detail.json(), "Successor")["status"] == models.SubtaskStatusEnum.WAITING.value

    db = TestingSessionLocal()
    try:
        assert (
            db.query(models.SubtaskWorkflowEvent)
            .filter(models.SubtaskWorkflowEvent.subtask_id == successor["id"])
            .count()
            == 0
        )
    finally:
        db.close()


def test_partial_activation_failure_rolls_back_status_and_history(monkeypatch):
    _, owner_token, _, _, task = _workflow_task()
    headers = {"Authorization": f"Bearer {owner_token}"}
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")
    original_record_event = tasks_module.subtask_workflow._record_workflow_event

    def fail_activation(*args, **kwargs):
        if kwargs.get("event_type") == "SUBTASK_ACTIVATED":
            raise RuntimeError("simulated activation persistence failure")
        return original_record_event(*args, **kwargs)

    monkeypatch.setattr(tasks_module.subtask_workflow, "_record_workflow_event", fail_activation)
    with pytest.raises(RuntimeError):
        client.patch(
            f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
            json={"status": models.SubtaskStatusEnum.DONE.value},
            headers=headers,
        )

    detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert _subtask(detail.json(), "Predecessor")["status"] == models.SubtaskStatusEnum.TODO.value
    assert _subtask(detail.json(), "Successor")["status"] == models.SubtaskStatusEnum.WAITING.value
    assert _workflow_event_count(
        subtask_id=successor["id"],
        event_type="SUBTASK_ACTIVATED",
    ) == 0


def test_parallel_successors_all_activate_and_multi_predecessor_waits_until_ready():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    headers = {"Authorization": f"Bearer {owner_token}"}
    payload = _task_payload(project.id, [])
    payload["subtasks"] = [
        {"title": "A", "completed": False},
        {"title": "B", "completed": False},
        {"title": "C", "completed": False, "status": models.SubtaskStatusEnum.WAITING.value},
        {"title": "D", "completed": False, "status": models.SubtaskStatusEnum.WAITING.value},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    subtask_ids = {item["title"]: item["id"] for item in task["subtasks"]}
    for child, parent in [("C", "A"), ("D", "A"), ("D", "B")]:
        response = client.post(
            f"/api/tasks/{task['id']}/subtasks/{subtask_ids[child]}/dependencies",
            json={"depends_on_subtask_id": subtask_ids[parent]},
            headers=headers,
        )
        assert response.status_code == 201, response.text

    first_completion = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_ids['A']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert first_completion.status_code == 200, first_completion.text
    assert _subtask(first_completion.json(), "C")["status"] == models.SubtaskStatusEnum.TODO.value
    assert _subtask(first_completion.json(), "D")["status"] == models.SubtaskStatusEnum.WAITING.value

    second_completion = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_ids['B']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert second_completion.status_code == 200, second_completion.text
    assert _subtask(second_completion.json(), "D")["status"] == models.SubtaskStatusEnum.TODO.value


def test_assigned_user_force_start_requires_reason_and_records_blocked_predecessors():
    tenant, _, _, member, task = _workflow_task()
    successor = _subtask(task, "Successor")
    member_headers = {"Authorization": f"Bearer {_token_for_existing_user(member.id, tenant)}"}

    missing_reason = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={"status": models.SubtaskStatusEnum.IN_PROGRESS.value},
        headers=member_headers,
    )
    assert missing_reason.status_code == 422

    force_started = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={
            "status": models.SubtaskStatusEnum.IN_PROGRESS.value,
            "force_start_reason": "Customer escalation requires early work",
        },
        headers=member_headers,
    )
    assert force_started.status_code == 200, force_started.text
    assert _subtask(force_started.json(), "Successor")["status"] == models.SubtaskStatusEnum.IN_PROGRESS.value

    db = TestingSessionLocal()
    try:
        event = (
            db.query(models.SubtaskWorkflowEvent)
            .filter(
                models.SubtaskWorkflowEvent.subtask_id == successor["id"],
                models.SubtaskWorkflowEvent.event_type == "SUBTASK_FORCE_STARTED",
            )
            .one()
        )
        assert event.actor_id == member.id
        assert event.reason == "Customer escalation requires early work"
        assert event.blocked_predecessor_ids == [_subtask(task, "Predecessor")["id"]]
    finally:
        db.close()


def test_non_assignee_member_cannot_force_start_as_override():
    tenant, _, _, _, task = _workflow_task()
    other_member, _ = _create_user(models.RoleEnum.USER, tenant)
    db = TestingSessionLocal()
    try:
        db.add(
            models.ProjectMember(
                tenant_id=tenant,
                project_id=task["project_id"],
                user_id=other_member.id,
                role=models.ProjectMemberRoleEnum.MEMBER,
            )
        )
        db.commit()
    finally:
        db.close()

    successor = _subtask(task, "Successor")
    response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={
            "status": models.SubtaskStatusEnum.IN_PROGRESS.value,
            "force_start_reason": "Trying to start someone else's blocked work",
        },
        headers={"Authorization": f"Bearer {_token_for_existing_user(other_member.id, tenant)}"},
    )
    assert response.status_code == 403
    assert _workflow_event_count(
        subtask_id=successor["id"],
        event_type="SUBTASK_FORCE_STARTED",
    ) == 0


def test_project_manager_can_override_force_start_with_reason():
    _, _, manager, _, task = _workflow_task()
    successor = _subtask(task, "Successor")
    manager_headers = {"Authorization": f"Bearer {_token_for_existing_user(manager.id, uuid.UUID(str(manager.tenant_id)))}"}

    response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={
            "status": models.SubtaskStatusEnum.IN_PROGRESS.value,
            "force_start_reason": "Manager override to unblock parallel discovery",
        },
        headers=manager_headers,
    )
    assert response.status_code == 200, response.text
    assert _subtask(response.json(), "Successor")["status"] == models.SubtaskStatusEnum.IN_PROGRESS.value


def test_reopen_marks_downstream_done_work_as_in_review_without_deleting_dependencies():
    _, owner_token, _, _, task = _workflow_task()
    headers = {"Authorization": f"Bearer {owner_token}"}
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")

    activated = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert activated.status_code == 200, activated.text
    completed_successor = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert completed_successor.status_code == 200, completed_successor.text

    reopened = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.TODO.value},
        headers=headers,
    )
    assert reopened.status_code == 200, reopened.text
    successor_after_reopen = _subtask(reopened.json(), "Successor")
    assert successor_after_reopen["status"] == models.SubtaskStatusEnum.IN_REVIEW.value
    assert successor_after_reopen["completed"] is False
    assert successor_after_reopen["dependency_ids"] == [predecessor["id"]]

    db = TestingSessionLocal()
    try:
        assert (
            db.query(models.SubtaskWorkflowEvent)
            .filter(
                models.SubtaskWorkflowEvent.subtask_id == successor["id"],
                models.SubtaskWorkflowEvent.event_type == "SUBTASK_DOWNSTREAM_REVIEW_REQUIRED",
            )
            .count()
            == 1
        )
    finally:
        db.close()


def test_dependency_reassignment_cycle_mutation_is_rejected_without_history_loss():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    headers = {"Authorization": f"Bearer {owner_token}"}
    payload = _task_payload(project.id, [])
    payload["subtasks"] = [
        {"title": "A", "completed": False},
        {"title": "B", "completed": False, "status": models.SubtaskStatusEnum.WAITING.value},
        {"title": "C", "completed": False, "status": models.SubtaskStatusEnum.WAITING.value},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    ids = {item["title"]: item["id"] for item in task["subtasks"]}
    b_depends_a = client.post(
        f"/api/tasks/{task['id']}/subtasks/{ids['B']}/dependencies",
        json={"depends_on_subtask_id": ids["A"]},
        headers=headers,
    )
    assert b_depends_a.status_code == 201, b_depends_a.text
    c_depends_b = client.post(
        f"/api/tasks/{task['id']}/subtasks/{ids['C']}/dependencies",
        json={"depends_on_subtask_id": ids["B"]},
        headers=headers,
    )
    assert c_depends_b.status_code == 201, c_depends_b.text

    cycle = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{ids['B']}/dependencies/{b_depends_a.json()['id']}",
        json={"depends_on_subtask_id": ids["C"]},
        headers=headers,
    )
    assert cycle.status_code == 400

    detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    subtask_b = _subtask(detail.json(), "B")
    assert subtask_b["dependency_ids"] == [ids["A"]]
    assert _workflow_event_count(
        subtask_id=ids["B"],
        event_type="SUBTASK_ACTIVATED",
    ) == 0
