"""Audit-only probes. Failures document current tenant exposure; synthetic data only."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import models
from backend.app.database import get_db
from backend.app.auth import create_access_token
from backend.app.routers import auth, data_admin, logs
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401


def client(data):
    with data.factory() as db:
        for user in (data.owner, data.outsider):
            db.get(models.User, user.id).email = user.id + "@example.com"
        db.commit()
    app = FastAPI()
    app.include_router(data_admin.router, prefix="/api")
    app.include_router(logs.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    token = create_access_token(data.owner.id, extra_claims={"tenant_id": str(data.owner.tenant_id)})
    return TestClient(app, headers={"Authorization": "Bearer " + token})


def test_audit_probe_owner_backup_is_tenant_scoped(data):
    response = client(data).get("/api/admin/data/export?scope=users")
    assert response.status_code == 200
    exposed = any(row["id"] == data.outsider.id for row in response.json()["users"])
    assert not exposed, "Owner backup exposes another tenant's user record, including password hash"


def test_audit_probe_owner_audit_log_is_tenant_scoped(data):
    with data.factory() as db:
        entry = models.AuditLog(actor_id=data.outsider.id, action="SYNTHETIC_FOREIGN_TENANT",
                                category=models.AuditLogCategoryEnum.USER,
                                source=models.AuditLogSourceEnum.MANUAL)
        db.add(entry)
        db.commit()
        foreign_id = entry.id
    response = client(data).get("/api/logs/audit")
    assert response.status_code == 200
    exposed = any(row["id"] == foreign_id for row in response.json()["items"])
    assert not exposed, "Owner audit log endpoint exposes another tenant's audit event"


def test_audit_probe_public_registration_cannot_grant_existing_tenant_owner(data, monkeypatch):
    monkeypatch.setattr(auth.audit_logger, "log_event", lambda *_: None)
    api = client(data)
    api.headers.pop("Authorization")
    response = api.post("/api/auth/register", json={
        "name": "Synthetic registration probe", "email": "audit-registration@example.com",
        "password": "Synthetic-audit-password!", "role": "owner", "status": "ACTIVE",
        "employer_id": str(data.owner.tenant_id), "department_id": None,
    })
    escalated = response.status_code == 201 and response.json()["user"]["role"] == "owner"
    assert not escalated, "Unauthenticated registration grants owner access in an existing tenant"
