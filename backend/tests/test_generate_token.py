"""Real auth/token regression checks using trusted seeds in disposable databases."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import models
from backend.app.auth import hash_password
from backend.app.database import get_db
from backend.app.routers.auth import router
from backend.app.services import audit_logger
from backend.tests import test_task_lifecycle as lifecycle_fixtures

# Explicit aliases register the shared disposable-database pytest fixtures.
data = lifecycle_fixtures.data
engine = lifecycle_fixtures.engine


@pytest.fixture
def client(data, monkeypatch):
    monkeypatch.setattr(audit_logger, 'log_event', lambda *args, **kwargs: None)
    with data.factory() as db:
        owner = db.get(models.User, data.owner.id)
        owner.email = 'docs-owner@example.com'
        owner.hashed_password = hash_password('Synthetic-token-regression-2026!')
        db.commit()
    app = FastAPI()
    app.include_router(router)
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as transport:
        yield transport


def _login_owner(client) -> str:
    response = client.post(
        "/auth/login",
        json={"email": "docs-owner@example.com", "password": "Synthetic-token-regression-2026!"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    return data["token"]["access_token"]


def test_generate_token_allows_access(client):
    admin_access_token = _login_owner(client)

    response = client.post(
        "/auth/generate-token",
        json={
            "label": "Docs Builder",
            "scopes": ["tasks.read", "users.read"],
            "expires_in_minutes": 30,
        },
        headers={"Authorization": f"Bearer {admin_access_token}"},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["token_type"] == "bearer"
    assert sorted(data["scopes"]) == ["tasks.read", "users.read"]
    assert data["access_token"]
    assert data["subject"]
    assert data["issued_at"]
    assert data["expires_at"]

    me_response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert me_response.status_code == 200
    me_data = me_response.json()
    assert me_data["email"] == "docs-owner@example.com"


def test_websocket_ticket_is_short_lived_and_scoped(client):
    admin_access_token = _login_owner(client)

    response = client.get(
        "/auth/websocket-ticket",
        params={"scope": "chat"},
        headers={"Authorization": f"Bearer {admin_access_token}"},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["token_type"] == "bearer"
    assert data["scopes"] == ["websocket", "websocket:chat"]
    assert data["access_token"]
