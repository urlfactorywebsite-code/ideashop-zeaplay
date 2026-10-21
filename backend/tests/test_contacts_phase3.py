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
    AuditEvent,
    AvatarAsset,
    Client,
    ClientContact,
    Contact,
    Department,
    NavigationPolicy,
    RoleEnum,
    User,
    UserStatusEnum,
)
from backend.app.routers.clients import router as clients_router
from backend.app.routers.contacts import client_contacts_router
from backend.app.routers.contacts import router as contacts_router

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
Contact.__table__.create(bind=engine, checkfirst=True)
ClientContact.__table__.create(bind=engine, checkfirst=True)
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
app.include_router(contacts_router)
app.include_router(client_contacts_router)
app.include_router(clients_router, prefix="/api")
app.include_router(contacts_router, prefix="/api")
app.include_router(client_contacts_router, prefix="/api")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(AuditEvent).delete()
        db.query(ClientContact).delete()
        db.query(Contact).delete()
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


def _create_client(headers: dict[str, str], name: str) -> str:
    response = client.post("/api/clients", json={"company_name": name, "country": "India"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_contact_create_link_primary_list_and_update():
    _, token = _create_user(RoleEnum.MANAGER)
    headers = {"Authorization": f"Bearer {token}"}
    client_a = _create_client(headers, "Acme India")
    client_b = _create_client(headers, "Beta India")
    client_c = _create_client(headers, "Cobalt India")

    created = client.post(
        "/api/contacts",
        json={
            "first_name": " Priya ",
            "last_name": " Shah ",
            "email": "Priya@example.com",
            "phone": "+91 98765 43210",
            "title": "Finance",
            "client_links": [
                {"client_id": client_a, "is_primary": True},
                {"client_id": client_b, "is_primary": False},
                {"client_id": client_c, "is_primary": False},
            ],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["display_name"] == "Priya Shah"
    assert {item["company_name"] for item in body["clients"]} == {"Acme India", "Beta India", "Cobalt India"}
    assert next(item for item in body["clients"] if item["is_primary"])["id"] == client_a

    client_contacts = client.get(f"/api/clients/{client_a}/contacts", headers=headers)
    assert client_contacts.status_code == 200, client_contacts.text
    assert client_contacts.json()["total"] == 1

    updated = client.patch(
        f"/api/contacts/{body['id']}",
        json={"phone": "+91 90000 00000", "client_links": [{"client_id": client_b, "is_primary": True}]},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    updated_body = updated.json()
    assert updated_body["phone"] == "+91 90000 00000"
    assert [item["id"] for item in updated_body["clients"]] == [client_b]
    assert updated_body["clients"][0]["is_primary"] is True


def test_one_client_many_contacts_duplicate_link_and_primary_enforcement():
    _, token = _create_user(RoleEnum.ADMIN)
    headers = {"Authorization": f"Bearer {token}"}
    client_id = _create_client(headers, "Many Contacts Client")
    contact_ids: list[str] = []
    for index, name in enumerate(["Asha", "Bala", "Charu"]):
        created = client.post(
            "/api/contacts",
            json={
                "first_name": name,
                "email": f"{name}@example.com",
                "client_links": [{"client_id": client_id, "is_primary": index == 0}],
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        contact_ids.append(created.json()["id"])

    duplicate_link = client.post(
        f"/api/contacts/{contact_ids[1]}/clients/{client_id}",
        json={"is_primary": False},
        headers=headers,
    )
    assert duplicate_link.status_code == 200, duplicate_link.text
    db = TestingSessionLocal()
    try:
        link_count = db.execute(
            select(func.count()).select_from(ClientContact).where(
                ClientContact.client_id == client_id,
                ClientContact.contact_id == contact_ids[1],
            )
        ).scalar_one()
        assert link_count == 1
    finally:
        db.close()

    second_primary = client.post(
        f"/api/clients/{client_id}/contacts/{contact_ids[1]}",
        json={"is_primary": True},
        headers=headers,
    )
    assert second_primary.status_code == 200, second_primary.text
    many = client.get(f"/api/clients/{client_id}/contacts", headers=headers)
    assert many.status_code == 200, many.text
    body = many.json()
    assert body["total"] == 3
    primary_contacts = [
        item["id"]
        for item in body["items"]
        if any(linked["id"] == client_id and linked["is_primary"] for linked in item["clients"])
    ]
    assert primary_contacts == [contact_ids[1]]


def test_database_rejects_cross_tenant_junction_and_concurrent_primary_conflict():
    tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()
    actor, token = _create_user(RoleEnum.OWNER, tenant)
    headers = {"Authorization": f"Bearer {token}"}
    client_id = _create_client(headers, "Constraint Client")
    first = client.post("/api/contacts", json={"first_name": "Primary One", "email": "one@example.com"}, headers=headers)
    second = client.post("/api/contacts", json={"first_name": "Primary Two", "email": "two@example.com"}, headers=headers)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    first_id = first.json()["id"]
    second_id = second.json()["id"]

    db = TestingSessionLocal()
    try:
        db.add(
            ClientContact(
                tenant_id=other_tenant,
                client_id=client_id,
                contact_id=first_id,
                is_primary=False,
                created_by_id=actor.id,
                updated_by_id=actor.id,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        db.add(
            ClientContact(
                tenant_id=tenant,
                client_id=client_id,
                contact_id=first_id,
                is_primary=True,
                created_by_id=actor.id,
                updated_by_id=actor.id,
            )
        )
        db.commit()
        db.add(
            ClientContact(
                tenant_id=tenant,
                client_id=client_id,
                contact_id=second_id,
                is_primary=True,
                created_by_id=actor.id,
                updated_by_id=actor.id,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_shared_contact_survives_unlink_and_client_archive():
    _, token = _create_user(RoleEnum.ADMIN)
    headers = {"Authorization": f"Bearer {token}"}
    client_a = _create_client(headers, "Northwind")
    client_b = _create_client(headers, "Contoso")
    created = client.post(
        "/api/contacts",
        json={
            "first_name": "Sam",
            "email": "sam@example.com",
            "client_links": [{"client_id": client_a}, {"client_id": client_b}],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    contact_id = created.json()["id"]

    removed = client.delete(f"/api/contacts/{contact_id}/clients/{client_a}", headers=headers)
    assert removed.status_code == 204

    detail = client.get(f"/api/contacts/{contact_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert [item["id"] for item in detail.json()["clients"]] == [client_b]

    archived_client = client.post(f"/api/clients/{client_b}/archive", json={"reason": "Dormant"}, headers=headers)
    assert archived_client.status_code == 200, archived_client.text
    contact_after_archive = client.get(f"/api/contacts/{contact_id}", headers=headers)
    assert contact_after_archive.status_code == 200
    assert contact_after_archive.json()["status"] == "ACTIVE"
    assert contact_after_archive.json()["clients"][0]["status"] == "ARCHIVED"


def test_contact_tenant_boundaries_and_permissions():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    _, admin_a = _create_user(RoleEnum.ADMIN, tenant_a)
    _, admin_b = _create_user(RoleEnum.ADMIN, tenant_b)
    _, user_a = _create_user(RoleEnum.USER, tenant_a)
    headers_a = {"Authorization": f"Bearer {admin_a}"}
    headers_b = {"Authorization": f"Bearer {admin_b}"}
    client_a = _create_client(headers_a, "Tenant A Client")
    client_b = _create_client(headers_b, "Tenant B Client")

    created = client.post(
        "/api/contacts",
        json={"first_name": "Tenant", "email": "tenant@example.com", "client_links": [{"client_id": client_a}]},
        headers=headers_a,
    )
    assert created.status_code == 201, created.text
    contact_id = created.json()["id"]

    assert client.get(f"/api/contacts/{contact_id}", headers=headers_b).status_code == 404
    cross_link = client.post(f"/api/contacts/{contact_id}/clients/{client_b}", json={}, headers=headers_a)
    assert cross_link.status_code == 404

    forbidden = client.post(
        "/api/contacts",
        json={"first_name": "Readonly", "email": "readonly@example.com"},
        headers={"Authorization": f"Bearer {user_a}"},
    )
    assert forbidden.status_code == 403
    forbidden_archive = client.post(
        f"/api/contacts/{contact_id}/archive",
        json={},
        headers={"Authorization": f"Bearer {user_a}"},
    )
    assert forbidden_archive.status_code == 403


def test_contact_validation_duplicates_pagination_and_archive_recreate():
    _, token = _create_user(RoleEnum.OWNER)
    headers = {"Authorization": f"Bearer {token}"}

    invalid = client.post(
        "/api/contacts",
        json={"first_name": "", "email": "not-email", "phone": "12"},
        headers=headers,
    )
    assert invalid.status_code == 422

    first = client.post(
        "/api/contacts",
        json={"first_name": "Asha", "last_name": "Rao", "email": "asha@example.com", "phone": "+91 98765 43210"},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    duplicate_email = client.post(
        "/api/contacts",
        json={"first_name": "Other", "email": "ASHA@example.com"},
        headers=headers,
    )
    assert duplicate_email.status_code == 409

    duplicate_phone = client.post(
        "/api/contacts",
        json={"first_name": "Asha", "last_name": "Rao", "phone": "+91 98765 43210"},
        headers=headers,
    )
    assert duplicate_phone.status_code == 409

    for name in ["Bala", "Charu", "Dev"]:
        response = client.post("/api/contacts", json={"first_name": name, "email": f"{name}@example.com"}, headers=headers)
        assert response.status_code == 201, response.text

    listed = client.get("/api/contacts?page=1&page_size=2&sort_by=display_name&sort_order=asc", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 4
    assert listed.json()["total_pages"] == 2
    assert [item["display_name"] for item in listed.json()["items"]] == ["Asha Rao", "Bala"]

    searched = client.get("/api/contacts?q=charu", headers=headers)
    assert searched.status_code == 200
    assert searched.json()["total"] == 1

    archived = client.post(f"/api/contacts/{first.json()['id']}/archive", json={"reason": "Left"}, headers=headers)
    assert archived.status_code == 200
    assert archived.json()["status"] == "ARCHIVED"

    recreated = client.post(
        "/api/contacts",
        json={"first_name": "Asha", "last_name": "Rao", "email": "asha@example.com"},
        headers=headers,
    )
    assert recreated.status_code == 201, recreated.text
