import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.main import app
from backend.app.database import Base, get_db
from backend.app.dependencies import get_current_active_user
from backend.app.models import (
    Client,
    ClientStatusEnum,
    Project,
    ProjectMember,
    ProjectMemberRoleEnum,
    ProjectStatusEnum,
    RoleEnum,
    Task,
    TaskPriorityEnum,
    TaskStatusEnum,
    User,
    UserStatusEnum,
)
from backend.app.routers import tasks as tasks_router


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_tasks.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Task.__table__.c.search_vector.computed = None
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

TEST_TENANT_ID = uuid.uuid4()


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def test_user():
    db = TestingSessionLocal()
    user = User(
        id=str(uuid.uuid4()),
        tenant_id=TEST_TENANT_ID,
        name="Test User",
        email="testuser@example.com",
        hashed_password="hashed",
        role=RoleEnum.ADMIN,
        status=UserStatusEnum.ACTIVE,
        points=0,
        tasks_created=0,
        tasks_completed=0,
        clarity_scores=[],
        claimed_reward_ids=[],
        unlocked_achievement_ids=[],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user
    db.query(Task).delete()
    db.query(User).delete()
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def client(test_user):
    def override_current_active_user():
        return test_user

    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_current_active_user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous_overrides)


def seed_tasks(db, owner_id: str, count: int) -> None:
    for i in range(count):
        db.add(
            Task(
                title=f"Task {i}",
                description="seeded",
                status=TaskStatusEnum.TODO,
                priority=TaskPriorityEnum.MEDIUM,
                team="Team A",
                created_by_id=owner_id,
            )
        )
    db.commit()


def create_project(db, owner_id: str) -> str:
    suffix = str(uuid.uuid4())
    client = Client(
        tenant_id=TEST_TENANT_ID,
        company_name=f"Task List Client {suffix}",
        normalized_company_name=f"task-list-client-{suffix}",
        status=ClientStatusEnum.ACTIVE,
        created_by_id=owner_id,
        updated_by_id=owner_id,
    )
    db.add(client)
    db.flush()
    project = Project(
        tenant_id=TEST_TENANT_ID,
        client_id=client.id,
        name=f"Task List Project {suffix}",
        normalized_name=f"task-list-project-{suffix}",
        status=ProjectStatusEnum.ACTIVE,
        created_by_id=owner_id,
        updated_by_id=owner_id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectMember(
            tenant_id=TEST_TENANT_ID,
            project_id=project.id,
            user_id=owner_id,
            role=ProjectMemberRoleEnum.MANAGER,
            created_by_id=owner_id,
            updated_by_id=owner_id,
        )
    )
    db.commit()
    return project.id


def test_list_tasks_pagination(client, test_user):
    db = TestingSessionLocal()
    db.query(Task).delete()
    db.commit()
    seed_tasks(db, test_user.id, 3)
    db.close()

    response = client.get("/tasks/page", params={"page": 1, "page_size": 2})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert data["total_pages"] == 2
    assert len(data["items"]) == 2


def test_list_tasks_search(client, test_user):
    db = TestingSessionLocal()
    db.query(Task).delete()
    db.commit()
    db.add(
        Task(
            title="Alpha Search",
            description="needle",
            status=TaskStatusEnum.TODO,
            priority=TaskPriorityEnum.MEDIUM,
            team="Search",
            created_by_id=test_user.id,
        )
    )
    db.add(
        Task(
            title="Beta Task",
            description="haystack",
            status=TaskStatusEnum.TODO,
            priority=TaskPriorityEnum.MEDIUM,
            team="Search",
            created_by_id=test_user.id,
        )
    )
    db.commit()
    db.close()

    response = client.get("/tasks/page", params={"page": 1, "page_size": 10, "search": "Alpha"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "Alpha Search"


def test_task_list_cache_hit(client, test_user, monkeypatch):
    db = TestingSessionLocal()
    db.query(Task).delete()
    db.commit()
    seed_tasks(db, test_user.id, 1)
    db.close()

    cache_store: dict[str, object] = {}
    calls = {"get": 0, "set": 0}

    def fake_get(key: str):
        calls["get"] += 1
        return cache_store.get(key)

    def fake_set(key: str, value: object, ttl_seconds: int):
        calls["set"] += 1
        cache_store[key] = value

    monkeypatch.setattr(tasks_router, "get_cached_json", fake_get)
    monkeypatch.setattr(tasks_router, "set_cached_json", fake_set)

    first = client.get("/tasks/page", params={"page": 1, "page_size": 10})
    assert first.status_code == 200
    second = client.get("/tasks/page", params={"page": 1, "page_size": 10})
    assert second.status_code == 200
    assert calls["set"] == 1
    assert calls["get"] >= 2


def test_publish_event_on_create(client, test_user, monkeypatch):
    events: list[dict] = []

    def fake_publish(payload: dict):
        events.append(payload)

    monkeypatch.setattr(tasks_router.task_events, "publish_task_event", fake_publish)
    db = TestingSessionLocal()
    project_id = create_project(db, test_user.id)
    db.close()

    payload = {
        "title": "Webhook Task",
        "description": "created via test",
        "status": TaskStatusEnum.TODO.value,
        "priority": TaskPriorityEnum.MEDIUM.value,
        "team": "Team A",
        "project_id": project_id,
    }
    response = client.post("/tasks", json=payload)
    assert response.status_code == 201
    assert any(event.get("action") == "created" for event in events)
