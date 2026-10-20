import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.models import (
    AvatarAsset,
    AuditEvent,
    Client,
    Department,
    Project,
    ProjectMember,
    ProjectMemberRoleEnum,
    Reward,
    RewardClaim,
    RoleEnum,
    User,
    UserStatusEnum,
)
from backend.app.routers.clients import router as clients_router
from backend.app.routers.projects import router as projects_router
from backend.app.routers.users import router as users_router
from backend.app.services import entity_notifications


@pytest.fixture(autouse=True)
def isolate_notification_delivery(monkeypatch):
    # This older fixture builds only the project schema. Full transaction,
    # recipient and delivery integration runs in test_entity_notifications.
    monkeypatch.setattr(entity_notifications, "create_notification", lambda *_args, **_kwargs: None)


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Department.__table__.create(bind=engine, checkfirst=True)
User.__table__.create(bind=engine, checkfirst=True)
AvatarAsset.__table__.create(bind=engine, checkfirst=True)
Client.__table__.create(bind=engine, checkfirst=True)
Project.__table__.create(bind=engine, checkfirst=True)
ProjectMember.__table__.create(bind=engine, checkfirst=True)
AuditEvent.__table__.create(bind=engine, checkfirst=True)
Reward.__table__.create(bind=engine, checkfirst=True)
RewardClaim.__table__.create(bind=engine, checkfirst=True)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI()
app.include_router(clients_router)
app.include_router(projects_router)
app.include_router(users_router)
app.include_router(clients_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(AuditEvent).delete()
        db.query(ProjectMember).delete()
        db.query(Project).delete()
        db.query(Client).delete()
        db.query(User).delete()
        db.commit()
    finally:
        db.close()


def _token(user_id: str, tenant_id: uuid.UUID) -> str:
    settings = get_settings()
    return jwt.encode(
        {"user_id": user_id, "tenant_id": str(tenant_id), "token_type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _create_user(role: RoleEnum, tenant_id: uuid.UUID | None = None) -> tuple[User, str]:
    tenant = tenant_id or uuid.uuid4()
    user = User(
        id=str(uuid.uuid4()),
        tenant_id=tenant,
        name=f"{role.value}-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        hashed_password=hash_password("password123"),
        role=role,
        status=UserStatusEnum.ACTIVE,
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


def _create_client(headers: dict[str, str], name: str = "Project Client") -> str:
    response = client.post("/api/clients", json={"company_name": name, "country": "India"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_owner_creates_project_with_multiple_managers_and_members():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(RoleEnum.OWNER, tenant)
    manager_a, _ = _create_user(RoleEnum.MANAGER, tenant)
    manager_b, _ = _create_user(RoleEnum.MANAGER, tenant)
    member_a, _ = _create_user(RoleEnum.USER, tenant)
    member_b, _ = _create_user(RoleEnum.USER, tenant)
    headers = {"Authorization": f"Bearer {owner_token}"}
    client_id = _create_client(headers)

    created = client.post(
        "/api/projects",
        json={
            "name": "Enterprise Rollout",
            "client_id": client_id,
            "description": "Initial implementation",
            "manager_ids": [manager_a.id, manager_b.id],
            "member_ids": [member_a.id, member_b.id],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["client"]["id"] == client_id
    assert body["task_count"] == 0
    assert {item["user_id"] for item in body["members"] if item["role"] == "MANAGER"} == {manager_a.id, manager_b.id}
    assert {item["user_id"] for item in body["members"] if item["role"] == "MEMBER"} == {member_a.id, member_b.id}

    listed = client.get("/api/projects", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1


def test_project_permissions_and_membership_filtered_reads():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(RoleEnum.OWNER, tenant)
    manager, manager_token = _create_user(RoleEnum.MANAGER, tenant)
    member_manager, member_manager_token = _create_user(RoleEnum.MANAGER, tenant)
    other_manager, other_manager_token = _create_user(RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(RoleEnum.USER, tenant)
    outsider, outsider_token = _create_user(RoleEnum.USER, tenant)
    headers = {"Authorization": f"Bearer {owner_token}"}
    client_id = _create_client(headers)
    project = client.post(
        "/api/projects",
        json={
            "name": "Scoped Project",
            "client_id": client_id,
            "manager_ids": [manager.id],
            "member_ids": [member.id, member_manager.id],
        },
        headers=headers,
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]

    member_list = client.get("/api/projects", headers={"Authorization": f"Bearer {member_token}"})
    assert member_list.status_code == 200
    assert [item["id"] for item in member_list.json()["items"]] == [project_id]
    outsider_list = client.get("/api/projects", headers={"Authorization": f"Bearer {outsider_token}"})
    assert outsider_list.status_code == 200
    assert outsider_list.json()["items"] == []

    manager_update = client.patch(
        f"/api/projects/{project_id}",
        json={"description": "Manager update"},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert manager_update.status_code == 200, manager_update.text
    assert manager_update.json()["description"] == "Manager update"

    forbidden_update = client.patch(
        f"/api/projects/{project_id}",
        json={"description": "Wrong manager"},
        headers={"Authorization": f"Bearer {other_manager_token}"},
    )
    assert forbidden_update.status_code == 404

    forbidden_user_mutation = client.patch(
        f"/api/projects/{project_id}",
        json={"description": "Member update"},
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert forbidden_user_mutation.status_code == 403

    forbidden_manager_member_mutation = client.put(
        f"/api/projects/{project_id}/members",
        json={"manager_ids": [member_manager.id], "member_ids": [member.id]},
        headers={"Authorization": f"Bearer {member_manager_token}"},
    )
    assert forbidden_manager_member_mutation.status_code == 403

    updated_members = client.put(
        f"/api/projects/{project_id}/members",
        json={"manager_ids": [manager.id, other_manager.id], "member_ids": [member.id]},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert updated_members.status_code == 200, updated_members.text
    assert {item["user_id"] for item in updated_members.json()["members"] if item["role"] == "MANAGER"} == {
        manager.id,
        other_manager.id,
    }


def test_project_manager_requirement_duplicates_and_archive_preserve_memberships():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(RoleEnum.OWNER, tenant)
    manager, _ = _create_user(RoleEnum.MANAGER, tenant)
    member, _ = _create_user(RoleEnum.USER, tenant)
    headers = {"Authorization": f"Bearer {owner_token}"}
    client_id = _create_client(headers)

    no_manager = client.post(
        "/api/projects",
        json={"name": "No Manager", "client_id": client_id, "member_ids": [member.id]},
        headers=headers,
    )
    assert no_manager.status_code == 422

    created = client.post(
        "/api/projects",
        json={
            "name": "Duplicate Safe",
            "client_id": client_id,
            "manager_ids": [manager.id, manager.id],
            "member_ids": [member.id, member.id, manager.id],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]
    assert len(created.json()["members"]) == 2

    db = TestingSessionLocal()
    try:
        db.add(
            ProjectMember(
                tenant_id=tenant,
                project_id=project_id,
                user_id=member.id,
                role=ProjectMemberRoleEnum.MEMBER,
                created_by_id=manager.id,
                updated_by_id=manager.id,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()

    remove_last_manager = client.put(
        f"/api/projects/{project_id}/members",
        json={"manager_ids": [], "member_ids": [member.id]},
        headers=headers,
    )
    assert remove_last_manager.status_code == 422

    archived = client.post(f"/api/projects/{project_id}/archive", json={"reason": "Finished"}, headers=headers)
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "ARCHIVED"
    assert len(archived.json()["members"]) == 2
    assert "Archive reason: Finished" in archived.json()["description"]

    db = TestingSessionLocal()
    try:
        count = db.execute(
            select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == project_id)
        ).scalar_one()
        assert count == 2
    finally:
        db.close()


def test_archived_clients_cannot_be_assigned_but_existing_projects_remain_visible():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(RoleEnum.OWNER, tenant)
    manager, _ = _create_user(RoleEnum.MANAGER, tenant)
    headers = {"Authorization": f"Bearer {owner_token}"}
    active_client = _create_client(headers, "Active Client")
    archived_client = _create_client(headers, "Archived Client")

    project = client.post(
        "/api/projects",
        json={"name": "Visible History", "client_id": active_client, "manager_ids": [manager.id]},
        headers=headers,
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]

    archived = client.post(f"/api/clients/{archived_client}/archive", json={"reason": "Dormant"}, headers=headers)
    assert archived.status_code == 200, archived.text

    create_for_archived = client.post(
        "/api/projects",
        json={"name": "Bad Assignment", "client_id": archived_client, "manager_ids": [manager.id]},
        headers=headers,
    )
    assert create_for_archived.status_code == 404

    update_to_archived = client.patch(
        f"/api/projects/{project_id}",
        json={"client_id": archived_client},
        headers=headers,
    )
    assert update_to_archived.status_code == 404

    detail = client.get(f"/api/projects/{project_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["client"]["id"] == active_client


def test_project_tenant_boundaries_and_database_composite_fks():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    owner_a, token_a = _create_user(RoleEnum.OWNER, tenant_a)
    manager_a, _ = _create_user(RoleEnum.MANAGER, tenant_a)
    manager_b, token_b = _create_user(RoleEnum.MANAGER, tenant_b)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    client_a = _create_client(headers_a, "Tenant A Client")
    client_b = _create_client(headers_b, "Tenant B Client")

    cross_client = client.post(
        "/api/projects",
        json={"name": "Wrong Client", "client_id": client_b, "manager_ids": [manager_a.id]},
        headers=headers_a,
    )
    assert cross_client.status_code == 404

    cross_user = client.post(
        "/api/projects",
        json={"name": "Wrong User", "client_id": client_a, "manager_ids": [manager_b.id]},
        headers=headers_a,
    )
    assert cross_user.status_code == 404

    project = client.post(
        "/api/projects",
        json={"name": "Tenant Safe", "client_id": client_a, "manager_ids": [manager_a.id]},
        headers=headers_a,
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]
    assert client.get(f"/api/projects/{project_id}", headers=headers_b).status_code == 404

    db = TestingSessionLocal()
    try:
        db.add(
            ProjectMember(
                tenant_id=tenant_b,
                project_id=project_id,
                user_id=manager_a.id,
                role=ProjectMemberRoleEnum.MANAGER,
                created_by_id=owner_a.id,
                updated_by_id=owner_a.id,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_project_list_uses_bounded_queries_with_many_team_members():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(RoleEnum.OWNER, tenant)
    manager_a, _ = _create_user(RoleEnum.MANAGER, tenant)
    manager_b, _ = _create_user(RoleEnum.MANAGER, tenant)
    members = [_create_user(RoleEnum.USER, tenant)[0] for _ in range(60)]
    headers = {"Authorization": f"Bearer {owner_token}"}
    client_id = _create_client(headers, "Scale Client")

    for index in range(5):
        created = client.post(
            "/api/projects",
            json={
                "name": f"Scale Project {index}",
                "client_id": client_id,
                "manager_ids": [manager_a.id, manager_b.id],
                "member_ids": [member.id for member in members],
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        assert len(created.json()["members"]) == 62

    statements: list[str] = []

    def capture_selects(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_selects)
    try:
        listed = client.get("/api/projects?page_size=5", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", capture_selects)

    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 5
    assert all(len(item["members"]) == 62 for item in listed.json()["items"])
    assert len(statements) <= 7


def test_project_user_selector_reads_only_current_tenant_users():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    owner_a, token_a = _create_user(RoleEnum.OWNER, tenant_a)
    manager_a, _ = _create_user(RoleEnum.MANAGER, tenant_a)
    _create_user(RoleEnum.MANAGER, tenant_b)

    response = client.get("/api/users", headers={"Authorization": f"Bearer {token_a}"})
    assert response.status_code == 200, response.text
    assert {item["id"] for item in response.json()} == {owner_a.id, manager_a.id}
