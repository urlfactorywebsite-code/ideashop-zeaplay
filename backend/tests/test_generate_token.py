import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app import models


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_generate_token.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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


def _register_owner() -> None:
    payload = {
        "name": "Docs Owner",
        "email": "docs-owner@example.com",
        "password": "supersecret",
        "role": "owner",
        "status": "ACTIVE",
        "department_id": None,
        "employer_id": str(uuid.uuid4()),
    }
    response = client.post("/auth/register", json=payload)
    assert response.status_code == 201, response.text


def _login_owner() -> str:
    response = client.post(
        "/auth/login",
        json={"email": "docs-owner@example.com", "password": "supersecret"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    return data["token"]["access_token"]


def test_generate_token_allows_access():
    _register_owner()
    admin_access_token = _login_owner()

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
