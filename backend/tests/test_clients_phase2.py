import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.models import (
    AuditEvent,
    Client,
    NavigationPolicy,
    RoleEnum,
    User,
    UserStatusEnum,
)
from backend.app.routers.clients import router as clients_router
from backend.app.services import clients as client_service

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

User.__table__.create(bind=engine, checkfirst=True)
Client.__table__.create(bind=engine, checkfirst=True)
AuditEvent.__table__.create(bind=engine, checkfirst=True)
NavigationPolicy.__table__.create(bind=engine, checkfirst=True)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI()
app.include_router(clients_router)
app.include_router(clients_router, prefix="/api")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_client_tables():
    db = TestingSessionLocal()
    try:
        db.query(AuditEvent).delete()
        db.query(Client).delete()
        db.query(User).delete()
        db.commit()
    finally:
        db.close()


def _token(user_id: str, tenant_id: uuid.UUID) -> str:
    settings = get_settings()
    payload = {
        "user_id": user_id,
        "tenant_id": str(tenant_id),
        "token_type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


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


def test_owner_can_create_list_update_and_archive_client():
    _, token = _create_user(RoleEnum.OWNER)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "company_name": "Acme India Pvt Ltd",
        "gst_number": "29ABCDE1234F1Z5",
        "phone": "+91 98765 43210",
        "country": "India",
        "postal_code": "560001",
        "address_line1": "MG Road",
    }

    created = client.post("/api/clients", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    created_body = created.json()
    assert created_body["company_name"] == "Acme India Pvt Ltd"
    assert created_body["status"] == "ACTIVE"

    duplicate = client.post("/api/clients", json={**payload, "phone": "+91 90000 00000"}, headers=headers)
    assert duplicate.status_code == 409

    listed = client.get("/api/clients", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1

    updated = client.patch(
        f"/api/clients/{created_body['id']}",
        json={"phone": "+91 99999 88888", "postal_code": "560 002"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["phone"] == "+91 99999 88888"

    archived = client.post(
        f"/api/clients/{created_body['id']}/archive",
        json={"reason": "Merged into another account"},
        headers=headers,
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "ARCHIVED"
    assert archived.json()["archived_at"]
    assert "Archive reason: Merged into another account" in archived.json()["notes"]

    replacement = client.post("/api/clients", json=payload, headers=headers)
    assert replacement.status_code == 201, replacement.text


def test_clients_are_tenant_isolated():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    _, token_a = _create_user(RoleEnum.ADMIN, tenant_a)
    _, token_b = _create_user(RoleEnum.ADMIN, tenant_b)

    created = client.post(
        "/api/clients",
        json={"company_name": "Tenant A Client", "country": "India"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert created.status_code == 201, created.text
    client_id = created.json()["id"]

    list_b = client.get("/api/clients", headers={"Authorization": f"Bearer {token_b}"})
    assert list_b.status_code == 200, list_b.text
    assert all(item["id"] != client_id for item in list_b.json()["items"])

    get_b = client.get(f"/api/clients/{client_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert get_b.status_code == 404

    update_b = client.patch(
        f"/api/clients/{client_id}",
        json={"phone": "+91 99999 99999"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert update_b.status_code == 404

    archive_b = client.post(
        f"/api/clients/{client_id}/archive",
        json={"reason": "wrong tenant"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert archive_b.status_code == 404


def test_client_write_permissions_and_validation():
    _, user_token = _create_user(RoleEnum.USER)
    _, manager_token = _create_user(RoleEnum.MANAGER)

    forbidden = client.post(
        "/api/clients",
        json={"company_name": "Readonly Client"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden.status_code == 403

    forbidden_update = client.patch(
        "/api/clients/not-a-real-client",
        json={"phone": "+91 90000 00000"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden_update.status_code == 403

    forbidden_archive = client.post(
        "/api/clients/not-a-real-client/archive",
        json={},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert forbidden_archive.status_code == 403

    invalid = client.post(
        "/api/clients",
        json={"company_name": "X", "gst_number": "bad", "phone": "12", "country": "1"},
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert invalid.status_code == 422
    invalid_body = invalid.json()
    assert isinstance(invalid_body["detail"], list)
    assert any("GST number" in item["msg"] for item in invalid_body["detail"])

    unauthenticated = client.post("/api/clients", json={"company_name": "No Token Client"})
    assert unauthenticated.status_code == 401


def test_client_pagination_search_sorting_and_status_filter():
    _, token = _create_user(RoleEnum.MANAGER)
    headers = {"Authorization": f"Bearer {token}"}
    names = ["Zeta Labs", "Alpha Studio", "Beta Works", "Delta Trade"]
    created_ids: dict[str, str] = {}
    for index, name in enumerate(names):
        response = client.post(
            "/api/clients",
            json={
                "company_name": name,
                "gst_number": f"29ABCDE1234F{index}Z{index}",
                "phone": f"+91 90000 0000{index}",
                "country": "India" if index % 2 == 0 else "Singapore",
                "city": "Bengaluru" if index % 2 == 0 else "Singapore",
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
        created_ids[name] = response.json()["id"]

    archived = client.post(f"/api/clients/{created_ids['Delta Trade']}/archive", json={}, headers=headers)
    assert archived.status_code == 200, archived.text

    first_page = client.get(
        "/api/clients?page=1&page_size=2&sort_by=company_name&sort_order=asc&status=ACTIVE",
        headers=headers,
    )
    assert first_page.status_code == 200, first_page.text
    first_body = first_page.json()
    assert first_body["page"] == 1
    assert first_body["page_size"] == 2
    assert first_body["total"] == 3
    assert first_body["total_pages"] == 2
    assert [item["company_name"] for item in first_body["items"]] == ["Alpha Studio", "Beta Works"]

    search = client.get("/api/clients?q=singapore&status=", headers=headers)
    assert search.status_code == 200, search.text
    assert {item["company_name"] for item in search.json()["items"]} == {"Alpha Studio", "Delta Trade"}

    invalid_sort = client.get("/api/clients?sort_by=unsupported", headers=headers)
    assert invalid_sort.status_code == 422

    invalid_status = client.get("/api/clients?status=deleted", headers=headers)
    assert invalid_status.status_code == 422
    assert invalid_status.json()["detail"] == "Status must be ACTIVE or ARCHIVED"


def test_duplicate_active_clients_are_rejected_by_name_and_gst():
    _, token = _create_user(RoleEnum.ADMIN)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "company_name": "Duplicate Safe Co",
        "gst_number": "29ABCDE1234F1Z5",
        "phone": "+91 98765 43210",
        "country": "India",
    }
    first = client.post("/api/clients", json=payload, headers=headers)
    assert first.status_code == 201, first.text

    same_name = client.post(
        "/api/clients",
        json={**payload, "gst_number": "29ABCDE1234F2Z5"},
        headers=headers,
    )
    assert same_name.status_code == 409
    assert same_name.json()["detail"] == "An active client with this company name already exists"

    same_gst = client.post(
        "/api/clients",
        json={**payload, "company_name": "Different Legal Name"},
        headers=headers,
    )
    assert same_gst.status_code == 409
    assert same_gst.json()["detail"] == "An active client with this GST number already exists"


def test_database_unique_indexes_cover_create_and_update_races(monkeypatch: pytest.MonkeyPatch):
    _, token = _create_user(RoleEnum.OWNER)
    headers = {"Authorization": f"Bearer {token}"}

    first = client.post(
        "/api/clients",
        json={"company_name": "Race Proof One", "gst_number": "29ABCDE1234F1Z5"},
        headers=headers,
    )
    assert first.status_code == 201, first.text

    monkeypatch.setattr(client_service, "_ensure_no_active_duplicate", lambda *args, **kwargs: None)

    duplicate_create = client.post(
        "/api/clients",
        json={"company_name": "Race Proof One", "gst_number": "29ABCDE1234F2Z5"},
        headers=headers,
    )
    assert duplicate_create.status_code == 409
    assert "already exists" in duplicate_create.json()["detail"]

    second = client.post(
        "/api/clients",
        json={"company_name": "Race Proof Two", "gst_number": "29ABCDE1234F3Z5"},
        headers=headers,
    )
    assert second.status_code == 201, second.text

    duplicate_update = client.patch(
        f"/api/clients/{second.json()['id']}",
        json={"company_name": "Race Proof One"},
        headers=headers,
    )
    assert duplicate_update.status_code == 409
    assert "already exists" in duplicate_update.json()["detail"]
