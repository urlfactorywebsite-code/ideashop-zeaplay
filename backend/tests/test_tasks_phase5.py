import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app import models
from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import Base, get_db
from backend.app.routers.clients import router as clients_router
from backend.app.routers.projects import router as projects_router
from backend.app.routers import tasks as tasks_module
from backend.app.routers.tasks import router as tasks_router
from backend.app.services.points_table import get_task_creation_points
from backend.app.tickets import models as ticket_models  # noqa: F401


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

models.Task.__table__.c.search_vector.computed = None
Base.metadata.create_all(bind=engine)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI()
app.include_router(clients_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
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


def _noop_notification(db, **kwargs):
    notification = models.Notification(
        user_id=kwargs["user_id"],
        type=kwargs["notification_type"],
        message=kwargs["message"],
        title=kwargs.get("title"),
        body=kwargs.get("body"),
        entity_type=kwargs.get("entity_type"),
        entity_id=kwargs.get("entity_id"),
        related_task_id=kwargs.get("related_task_id"),
    )
    db.add(notification)
    db.flush()
    return notification


@pytest.fixture(autouse=True)
def disable_external_task_side_effects(monkeypatch):
    monkeypatch.setattr(tasks_module.notification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)


def _token(user_id: str, tenant_id: uuid.UUID) -> str:
    settings = get_settings()
    return jwt.encode(
        {"user_id": user_id, "tenant_id": str(tenant_id), "token_type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _create_user(role: models.RoleEnum, tenant_id: uuid.UUID | None = None) -> tuple[models.User, str]:
    tenant = tenant_id or uuid.uuid4()
    user = models.User(
        id=str(uuid.uuid4()),
        tenant_id=tenant,
        name=f"{role.value}-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        hashed_password=hash_password("password123"),
        role=role,
        status=models.UserStatusEnum.ACTIVE,
        points=0,
        tasks_created=0,
        tasks_completed=0,
        clarity_scores=[],
        claimed_reward_ids=[],
        unlocked_achievement_ids=[],
    )
    db = TestingSessionLocal()
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user, _token(user.id, tenant)


def _create_client_and_project(
    *,
    tenant_id: uuid.UUID,
    manager_ids: list[str],
    member_ids: list[str],
    status: models.ProjectStatusEnum = models.ProjectStatusEnum.ACTIVE,
) -> models.Project:
    db = TestingSessionLocal()
    client_row = models.Client(
        tenant_id=tenant_id,
        company_name=f"Client {uuid.uuid4()}",
        normalized_company_name=f"client-{uuid.uuid4()}",
        country="India",
    )
    db.add(client_row)
    db.flush()
    project = models.Project(
        tenant_id=tenant_id,
        client_id=client_row.id,
        name=f"Project {uuid.uuid4()}",
        normalized_name=f"project-{uuid.uuid4()}",
        status=status,
    )
    db.add(project)
    db.flush()
    for user_id in manager_ids:
        db.add(
            models.ProjectMember(
                tenant_id=tenant_id,
                project_id=project.id,
                user_id=user_id,
                role=models.ProjectMemberRoleEnum.MANAGER,
            )
        )
    for user_id in member_ids:
        db.add(
            models.ProjectMember(
                tenant_id=tenant_id,
                project_id=project.id,
                user_id=user_id,
                role=models.ProjectMemberRoleEnum.MEMBER,
            )
        )
    db.commit()
    db.refresh(project)
    db.close()
    return project


def _task_payload(project_id: str | None, assignee_ids: list[str] | None = None) -> dict:
    return {
        "title": "Project task",
        "description": "Created under a project",
        "status": models.TaskStatusEnum.TODO.value,
        "priority": models.TaskPriorityEnum.MEDIUM.value,
        "team": "Delivery",
        "project_id": project_id,
        "assigned_to_ids": assignee_ids or [],
        "due_at": None,
        "recurrence_rule": models.RecurrenceRuleEnum.NONE.value,
        "subtasks": [],
        "attachments": [],
        "estimated_hours": None,
        "tags": [],
    }


def test_normal_task_creation_requires_project_and_preserves_legacy_null_project_tasks():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    headers = {"Authorization": f"Bearer {owner_token}"}

    missing_project = client.post("/api/tasks", json=_task_payload(None), headers=headers)
    assert missing_project.status_code == 422

    db = TestingSessionLocal()
    legacy = models.Task(
        title="Legacy task",
        description="Historical task without project",
        status=models.TaskStatusEnum.TODO,
        priority=models.TaskPriorityEnum.MEDIUM,
        team="General",
        created_by_id=owner.id,
        project_id=None,
    )
    db.add(legacy)
    db.commit()
    legacy_id = legacy.id
    db.close()

    response = client.get(f"/api/tasks/{legacy_id}", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_id"] is None
    assert body["project"] is None

    edited = client.patch(
        f"/api/tasks/{legacy_id}",
        json={"title": "Legacy task edited", "status": models.TaskStatusEnum.IN_PROGRESS.value},
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["project_id"] is None
    assert edited.json()["title"] == "Legacy task edited"


def test_invalid_and_unauthorized_project_ids_are_rejected_for_normal_task_creation():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    user, user_token = _create_user(models.RoleEnum.USER, tenant)
    visible_member, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[visible_member.id],
    )

    missing = client.post(
        "/api/tasks",
        json=_task_payload(str(uuid.uuid4())),
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert missing.status_code == 404

    hidden_from_user = client.post(
        "/api/tasks",
        json=_task_payload(project.id, []),
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert hidden_from_user.status_code == 404


def test_project_task_creation_filters_and_project_assignee_membership():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member_a, _ = _create_user(models.RoleEnum.USER, tenant)
    member_b, _ = _create_user(models.RoleEnum.USER, tenant)
    outsider, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member_a.id, member_b.id],
    )
    headers = {"Authorization": f"Bearer {owner_token}"}

    rejected = client.post("/api/tasks", json=_task_payload(project.id, [outsider.id]), headers=headers)
    assert rejected.status_code == 422
    assert "project member" in rejected.text

    created = client.post("/api/tasks", json=_task_payload(project.id, [member_a.id, member_b.id]), headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert len(body) == 2
    assert {task["project_id"] for task in body} == {project.id}
    assert {task["project"]["id"] for task in body} == {project.id}

    filtered = client.get("/api/tasks/page", params={"project_id": project.id}, headers=headers)
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] == 2


def test_cross_tenant_and_archived_projects_cannot_be_used_for_new_tasks():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    archived = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
        status=models.ProjectStatusEnum.ARCHIVED,
    )
    other_tenant = uuid.uuid4()
    other_manager, _ = _create_user(models.RoleEnum.MANAGER, other_tenant)
    other_project = _create_client_and_project(
        tenant_id=other_tenant,
        manager_ids=[other_manager.id],
        member_ids=[],
    )
    headers = {"Authorization": f"Bearer {owner_token}"}

    archived_response = client.post("/api/tasks", json=_task_payload(archived.id, [member.id]), headers=headers)
    assert archived_response.status_code == 404

    tenant_response = client.post("/api/tasks", json=_task_payload(other_project.id, []), headers=headers)
    assert tenant_response.status_code == 404


def test_archived_project_tasks_remain_readable_but_archived_projects_cannot_receive_edits():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    active_project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    archived_project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
        status=models.ProjectStatusEnum.ARCHIVED,
    )
    headers = {"Authorization": f"Bearer {owner_token}"}

    db = TestingSessionLocal()
    historical = models.Task(
        title="Historical archived project task",
        description="Created before the project was archived",
        status=models.TaskStatusEnum.TODO,
        priority=models.TaskPriorityEnum.MEDIUM,
        team="General",
        created_by_id=owner.id,
        assigned_to_id=member.id,
        project_id=archived_project.id,
    )
    db.add(historical)
    db.commit()
    historical_id = historical.id
    db.close()

    readable = client.get(f"/api/tasks/{historical_id}", headers=headers)
    assert readable.status_code == 200, readable.text
    assert readable.json()["project_id"] == archived_project.id

    created = client.post("/api/tasks", json=_task_payload(active_project.id, [member.id]), headers=headers)
    assert created.status_code == 201, created.text
    task_id = created.json()[0]["id"]

    reassigned_to_archived = client.patch(
        f"/api/tasks/{task_id}",
        json={"project_id": archived_project.id},
        headers=headers,
    )
    assert reassigned_to_archived.status_code == 404


def test_all_backend_task_statuses_and_recurring_metadata_are_supported_with_project_tasks():
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

    assert len(models.TaskStatusEnum) == 11
    created_ids: list[str] = []
    for task_status in models.TaskStatusEnum:
        payload = _task_payload(project.id, [])
        payload["title"] = f"Status {task_status.value}"
        payload["status"] = task_status.value
        payload["recurrence_rule"] = models.RecurrenceRuleEnum.WEEKLY.value
        response = client.post("/api/tasks", json=payload, headers=headers)
        assert response.status_code == 201, response.text
        body = response.json()
        assert len(body) == 1
        assert body[0]["status"] == task_status.value
        assert body[0]["project_id"] == project.id
        assert body[0]["recurrence_rule"] == models.RecurrenceRuleEnum.WEEKLY.value
        created_ids.append(body[0]["id"])

    db = TestingSessionLocal()
    try:
        persisted = db.query(models.Task).filter(models.Task.id.in_(created_ids)).all()
        assert len(persisted) == 11
        assert {task.project_id for task in persisted} == {project.id}
        assert {task.recurrence_rule for task in persisted} == {models.RecurrenceRuleEnum.WEEKLY}
    finally:
        db.close()


def test_project_task_creation_xp_matches_existing_task_creation_points():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member_a, _ = _create_user(models.RoleEnum.USER, tenant)
    member_b, _ = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member_a.id, member_b.id],
    )

    db = TestingSessionLocal()
    try:
        expected_creation_points = get_task_creation_points(db)
    finally:
        db.close()

    response = client.post(
        "/api/tasks",
        json=_task_payload(project.id, [member_a.id, member_b.id]),
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 201, response.text
    assert len(response.json()) == 2

    db = TestingSessionLocal()
    try:
        refreshed_owner = db.get(models.User, owner.id)
        assert refreshed_owner.tasks_created == 2
        assert refreshed_owner.points == expected_creation_points * 2
    finally:
        db.close()


def test_project_reassignment_and_transfer_respect_project_membership_policy():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, manager_token = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    non_member, _ = _create_user(models.RoleEnum.USER, tenant)
    project_a = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    project_b = _create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    created = client.post("/api/tasks", json=_task_payload(project_a.id, [member.id]), headers=owner_headers)
    assert created.status_code == 201, created.text
    task_id = created.json()[0]["id"]

    user_reassign = client.patch(
        f"/api/tasks/{task_id}",
        json={"project_id": project_b.id},
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert user_reassign.status_code == 403

    bad_assignee = client.patch(
        f"/api/tasks/{task_id}",
        json={"assigned_to_id": non_member.id},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert bad_assignee.status_code == 422

    transfer = client.post(
        "/api/tasks/transfer",
        json={
            "from_user_id": member.id,
            "to_user_id": non_member.id,
            "statuses": [models.TaskStatusEnum.TODO.value],
        },
        headers=owner_headers,
    )
    assert transfer.status_code == 422

    ok_reassign = client.patch(
        f"/api/tasks/{task_id}",
        json={"project_id": project_b.id},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert ok_reassign.status_code == 200, ok_reassign.text
    assert ok_reassign.json()["project_id"] == project_b.id
