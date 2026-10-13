import uuid

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
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)


def test_subtask_status_assignment_and_legacy_completed_compatibility():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member_a, _ = _create_user(models.RoleEnum.USER, tenant)
    member_b, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member_a.id, member_b.id],
    )
    payload = _task_payload(project.id, [])
    payload["subtasks"] = [
        {
            "title": "Legacy completed subtask",
            "completed": True,
            "assigned_to_id": member_a.id,
            "sort_order": 0,
        },
        {
            "title": "Waiting preassigned subtask",
            "completed": False,
            "status": models.SubtaskStatusEnum.WAITING.value,
            "assigned_to_id": member_b.id,
            "sort_order": 1,
        },
    ]

    response = client.post("/api/tasks", json=payload, headers={"Authorization": f"Bearer {owner_token}"})
    assert response.status_code == 201, response.text
    task = response.json()[0]
    assert task["subtasks"][0]["status"] == models.SubtaskStatusEnum.DONE.value
    assert task["subtasks"][0]["completed"] is True
    assert task["subtasks"][0]["assigned_to_id"] == member_a.id
    assert task["subtasks"][1]["status"] == models.SubtaskStatusEnum.WAITING.value
    assert task["subtasks"][1]["completed"] is False
    assert task["subtasks"][1]["dependency_state"] == "WAITING"

    visible_to_subtask_assignee = client.get(
        f"/api/tasks/{task['id']}",
        headers={"Authorization": f"Bearer {_create_user(models.RoleEnum.USER, tenant)[1]}"},
    )
    assert visible_to_subtask_assignee.status_code == 403

    member_visible = client.get(
        f"/api/tasks/{task['id']}",
        headers={"Authorization": f"Bearer {_token_for_existing_user(member_b.id, tenant)}"},
    )
    assert member_visible.status_code == 200, member_visible.text


def _token_for_existing_user(user_id: str, tenant_id: uuid.UUID) -> str:
    from backend.tests.test_tasks_phase5 import _token

    return _token(user_id, tenant_id)


def test_legacy_completed_flags_and_null_assignees_serialize_consistently():
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
        {"title": "Old completed flag", "completed": True},
        {"title": "Old unfinished flag", "completed": False},
    ]

    response = client.post(
        "/api/tasks",
        json=payload,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 201, response.text
    subtasks = {item["title"]: item for item in response.json()[0]["subtasks"]}
    completed = subtasks["Old completed flag"]
    unfinished = subtasks["Old unfinished flag"]
    assert completed["status"] == models.SubtaskStatusEnum.DONE.value
    assert completed["completed"] is True
    assert completed["assigned_to_id"] is None
    assert completed["assigned_user"] is None
    assert unfinished["status"] == models.SubtaskStatusEnum.TODO.value
    assert unfinished["completed"] is False
    assert unfinished["assigned_to_id"] is None
    assert unfinished["dependency_state"] == "READY"


def test_new_subtasks_default_to_parent_task_assignee_when_unassigned():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    payload = _task_payload(project.id, [member.id])
    payload["subtasks"] = [
        {"title": "Auto-assigned child work", "completed": False, "sort_order": 0},
    ]

    response = client.post(
        "/api/tasks",
        json=payload,
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert response.status_code == 201, response.text
    task = response.json()[0]
    assert task["assigned_to_id"] == member.id
    assert task["subtasks"][0]["assigned_to_id"] == member.id


def test_subtask_assignment_rejects_cross_tenant_and_non_project_members():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    non_member, _ = _create_user(models.RoleEnum.USER, tenant)
    other_user, _ = _create_user(models.RoleEnum.USER, uuid.uuid4())
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    payload = _task_payload(project.id, [])
    payload["subtasks"] = [{"title": "Needs assignment", "completed": False}]
    headers = {"Authorization": f"Bearer {owner_token}"}
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    subtask_id = task["subtasks"][0]["id"]

    non_member_response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_id}",
        json={"assigned_to_id": non_member.id},
        headers=headers,
    )
    assert non_member_response.status_code == 422

    other_tenant_response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_id}",
        json={"assigned_to_id": other_user.id},
        headers=headers,
    )
    assert other_tenant_response.status_code == 404


def test_subtask_dependencies_reject_self_duplicates_cross_parent_and_cycles():
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
        {"title": "A", "completed": False, "sort_order": 0},
        {"title": "B", "completed": False, "sort_order": 1},
        {"title": "C", "completed": False, "sort_order": 2},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    subtask_a, subtask_b, subtask_c = [item["id"] for item in task["subtasks"]]

    self_response = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_a}/dependencies",
        json={"depends_on_subtask_id": subtask_a},
        headers=headers,
    )
    assert self_response.status_code == 400

    dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_a, "dependency_order": 0, "branch_key": "main"},
        headers=headers,
    )
    assert dependency.status_code == 201, dependency.text
    assert dependency.json()["depends_on_subtask_id"] == subtask_a

    duplicate = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_a},
        headers=headers,
    )
    assert duplicate.status_code == 409

    chained = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_c}/dependencies",
        json={"depends_on_subtask_id": subtask_b, "dependency_order": 1},
        headers=headers,
    )
    assert chained.status_code == 201, chained.text

    cycle = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_a}/dependencies",
        json={"depends_on_subtask_id": subtask_c},
        headers=headers,
    )
    assert cycle.status_code == 400

    other_payload = _task_payload(project.id, [])
    other_payload["subtasks"] = [{"title": "Other", "completed": False}]
    other = client.post("/api/tasks", json=other_payload, headers=headers)
    assert other.status_code == 201, other.text
    other_subtask_id = other.json()[0]["subtasks"][0]["id"]
    cross_parent = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_a}/dependencies",
        json={"depends_on_subtask_id": other_subtask_id},
        headers=headers,
    )
    assert cross_parent.status_code == 404


def test_subtask_dependency_reassignment_revalidates_dag():
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
        {"title": "C", "completed": False},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    task = created.json()[0]
    subtask_a, subtask_b, subtask_c = [item["id"] for item in task["subtasks"]]

    dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_a},
        headers=headers,
    )
    dependency_id = dependency.json()["id"]
    reassigned = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies/{dependency_id}",
        json={"depends_on_subtask_id": subtask_c, "dependency_order": 2, "branch_key": "parallel"},
        headers=headers,
    )
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["depends_on_subtask_id"] == subtask_c
    assert reassigned.json()["dependency_order"] == 2
    assert reassigned.json()["branch_key"] == "parallel"


def test_parallel_dependency_branches_reorder_and_removal():
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
        {"title": "Foundation", "completed": False},
        {"title": "Design branch", "completed": False},
        {"title": "API branch", "completed": False},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    foundation_id, design_id, api_id = [item["id"] for item in task["subtasks"]]

    design_dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{foundation_id}/dependencies",
        json={"depends_on_subtask_id": design_id, "dependency_order": 1, "branch_key": "design"},
        headers=headers,
    )
    assert design_dependency.status_code == 201, design_dependency.text
    api_dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{foundation_id}/dependencies",
        json={"depends_on_subtask_id": api_id, "dependency_order": 0, "branch_key": "api"},
        headers=headers,
    )
    assert api_dependency.status_code == 201, api_dependency.text

    reordered = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{foundation_id}/dependencies/{design_dependency.json()['id']}",
        json={"dependency_order": 3},
        headers=headers,
    )
    assert reordered.status_code == 200, reordered.text
    assert reordered.json()["dependency_order"] == 3

    detail = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    foundation = next(item for item in detail.json()["subtasks"] if item["id"] == foundation_id)
    assert foundation["dependency_state"] == "WAITING"
    assert [edge["branch_key"] for edge in foundation["dependencies"]] == ["api", "design"]

    removed = client.delete(
        f"/api/tasks/{task['id']}/subtasks/{foundation_id}/dependencies/{api_dependency.json()['id']}",
        headers=headers,
    )
    assert removed.status_code == 204, removed.text

    after_delete = client.get(f"/api/tasks/{task['id']}", headers=headers)
    assert after_delete.status_code == 200, after_delete.text
    foundation_after_delete = next(item for item in after_delete.json()["subtasks"] if item["id"] == foundation_id)
    assert foundation_after_delete["dependency_ids"] == [design_id]
    assert foundation_after_delete["dependencies"][0]["branch_key"] == "design"


def test_dependency_reassignment_rejects_duplicate_edge():
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
        {"title": "C", "completed": False},
    ]
    created = client.post("/api/tasks", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()[0]
    subtask_a, subtask_b, subtask_c = [item["id"] for item in task["subtasks"]]
    first = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_a},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    second = client.post(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_c},
        headers=headers,
    )
    assert second.status_code == 201, second.text

    duplicate = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{subtask_b}/dependencies/{first.json()['id']}",
        json={"depends_on_subtask_id": subtask_c},
        headers=headers,
    )
    assert duplicate.status_code == 409


def test_cross_tenant_dependency_mutations_are_denied():
    tenant_a = uuid.uuid4()
    _, tenant_a_owner_token = _create_user(models.RoleEnum.OWNER, tenant_a)
    tenant_b = uuid.uuid4()
    _, tenant_b_owner_token = _create_user(models.RoleEnum.OWNER, tenant_b)
    manager_b, _ = _create_user(models.RoleEnum.MANAGER, tenant_b)
    member_b, _ = _create_user(models.RoleEnum.USER, tenant_b)
    project_b = _create_client_and_project(
        tenant_id=tenant_b,
        manager_ids=[manager_b.id],
        member_ids=[member_b.id],
    )
    payload = _task_payload(project_b.id, [])
    payload["subtasks"] = [
        {"title": "Tenant B A", "completed": False},
        {"title": "Tenant B B", "completed": False},
    ]
    created = client.post(
        "/api/tasks",
        json=payload,
        headers={"Authorization": f"Bearer {tenant_b_owner_token}"},
    )
    assert created.status_code == 201, created.text
    task_b = created.json()[0]
    subtask_a, subtask_b = [item["id"] for item in task_b["subtasks"]]

    denied = client.post(
        f"/api/tasks/{task_b['id']}/subtasks/{subtask_b}/dependencies",
        json={"depends_on_subtask_id": subtask_a},
        headers={"Authorization": f"Bearer {tenant_a_owner_token}"},
    )
    assert denied.status_code == 404
