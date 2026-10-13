import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app import models
from backend.app.models import RoleEnum, User, UserStatusEnum
from backend.app.tickets.models import Ticket, TicketParticipant, TicketParticipantRoleEnum, TicketPriorityEnum, TicketStatusEnum


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_ticket_api.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


models.Task.__table__.c.search_vector.computed = None
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

client = TestClient(app)


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def override_app_db():
    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous_overrides)


def _make_token(user_id: str, tenant_id: uuid.UUID, roles: list[str]) -> str:
    settings = get_settings()
    payload = {
        "user_id": str(user_id),
        "tenant_id": str(tenant_id),
        "roles": roles,
        "token_type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _create_user(db, user_id: str, email: str, tenant_id: uuid.UUID) -> User:
    user = User(
        id=str(user_id),
        tenant_id=tenant_id,
        name=email.split("@")[0],
        email=email,
        hashed_password=hash_password("password123"),
        role=RoleEnum.USER,
        status=UserStatusEnum.ACTIVE,
        department_id=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_ticket(db, tenant_id: uuid.UUID, created_by: str, owner_id: str) -> Ticket:
    now = datetime.utcnow()
    ticket = Ticket(
        tenant_id=tenant_id,
        created_by=str(created_by),
        owner_id=str(owner_id),
        title="Tenant Ticket",
        description="Isolation test",
        status=TicketStatusEnum.OPEN,
        priority=TicketPriorityEnum.MEDIUM,
        created_at=now,
        updated_at=now,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def test_ticket_tenant_isolation():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())

    db = TestingSessionLocal()
    _create_user(db, user_a, "tenant-a@example.com", tenant_a)
    _create_user(db, user_b, "tenant-b@example.com", tenant_b)
    ticket = _create_ticket(db, tenant_a, created_by=user_a, owner_id=user_a)
    db.close()

    token_a = _make_token(user_a, tenant_a, roles=["user"])
    token_b = _make_token(user_b, tenant_b, roles=["user"])

    list_a = client.get("/api/tickets", headers={"Authorization": f"Bearer {token_a}"})
    assert list_a.status_code == 200, list_a.text
    assert len(list_a.json()["data"]) == 1

    list_b = client.get("/api/tickets", headers={"Authorization": f"Bearer {token_b}"})
    assert list_b.status_code == 200, list_b.text
    assert list_b.json()["data"] == []

    get_b = client.get(f"/api/tickets/{ticket.id}", headers={"Authorization": f"Bearer {token_b}"})
    assert get_b.status_code == 404


def test_ticket_permissions_close_reopen_delete():
    tenant_id = uuid.uuid4()
    owner_id = str(uuid.uuid4())
    assignee_id = str(uuid.uuid4())
    other_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    _create_user(db, owner_id, "owner@example.com", tenant_id)
    _create_user(db, assignee_id, "assignee@example.com", tenant_id)
    _create_user(db, other_id, "other@example.com", tenant_id)
    _create_user(db, admin_id, "admin@example.com", tenant_id)
    ticket = _create_ticket(db, tenant_id, created_by=owner_id, owner_id=owner_id)
    ticket.assigned_user_id = assignee_id
    db.add(
        TicketParticipant(
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            user_id=str(assignee_id),
            role=TicketParticipantRoleEnum.ASSIGNEE,
            added_by=str(owner_id),
            created_at=datetime.utcnow(),
        )
    )
    db.commit()
    db.close()

    owner_token = _make_token(owner_id, tenant_id, roles=["user"])
    assignee_token = _make_token(assignee_id, tenant_id, roles=["user"])
    other_token = _make_token(other_id, tenant_id, roles=["user"])
    admin_token = _make_token(admin_id, tenant_id, roles=["admin"])

    forbidden_close = client.post(
        f"/api/tickets/{ticket.id}/close",
        json={"resolution_type": "ISSUE_RESOLVED"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert forbidden_close.status_code == 403

    close_ok = client.post(
        f"/api/tickets/{ticket.id}/close",
        json={"resolution_type": "ISSUE_RESOLVED"},
        headers={"Authorization": f"Bearer {assignee_token}"},
    )
    assert close_ok.status_code == 200
    assert close_ok.json()["status"] == "CLOSED"

    reopen_forbidden = client.post(
        f"/api/tickets/{ticket.id}/reopen",
        headers={"Authorization": f"Bearer {assignee_token}"},
    )
    assert reopen_forbidden.status_code == 403

    reopen_ok = client.post(
        f"/api/tickets/{ticket.id}/reopen",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert reopen_ok.status_code == 200
    assert reopen_ok.json()["status"] == "OPEN"

    delete_forbidden = client.delete(
        f"/api/tickets/{ticket.id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert delete_forbidden.status_code == 403

    delete_ok = client.delete(
        f"/api/tickets/{ticket.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert delete_ok.status_code == 204
