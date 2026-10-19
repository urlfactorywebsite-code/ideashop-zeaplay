"""Only synthetic users in the lifecycle suite's isolated SQLite/PostgreSQL schemas."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from importlib import import_module
import os
from pathlib import Path
import subprocess
import sys
from threading import Lock
from urllib.parse import parse_qs, urlsplit

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
import pytest
from sqlalchemy import select, text

from backend.app import email_utils, models
from backend.app.auth import create_access_token, create_refresh_token, hash_password, verify_password
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.routers.auth import router as auth_router
from backend.app.routers.users import router as user_router
from backend.app.routers import users as users_module
from backend.app.services import audit_logger, notification_outbox, password_recovery as recovery
from backend.tests.test_task_lifecycle import data, engine

OLD = "Synthetic-original-2026!"
NEW = "Synthetic-replacement-2026!"


class Limits:
    def __init__(self):
        self.values = {}
        self.lock = Lock()
    def eval(self, script, count, key, window):
        with self.lock:
            self.values[key] = self.values.get(key, 0) + 1
            return self.values[key]


@pytest.fixture
def api(data, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "password_reset_url", "http://localhost:6300/#/reset-password")
    monkeypatch.setattr(settings, "cors_allow_origins", ["http://localhost:6300"])
    limits = Limits()
    monkeypatch.setattr(recovery.cache, "get_redis_client", lambda: limits)
    monkeypatch.setattr(audit_logger, "log_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(users_module, "trigger_n8n_event", lambda *_args, **_kwargs: None)
    messages = []
    monkeypatch.setattr(email_utils, "_send_email_with_config", lambda **kwargs: messages.append(kwargs["body"]))
    with data.factory() as db:
        owner = db.get(models.User, data.owner.id)
        owner.email = "recovery-owner@example.com"
        owner.hashed_password = hash_password(OLD)
        db.add(models.SmtpConfig(id=1, host="smtp.example.test", port=1025, username="sender@example.com", password="synthetic"))
        db.commit()
    app = FastAPI()
    app.include_router(auth_router, prefix="/api")
    app.include_router(user_router, prefix="/api")
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        client.messages = messages
        client.limits = limits
        yield client


def headers(user):
    return {"Authorization": "Bearer " + create_access_token(user.id, extra_claims={"tenant_id": str(user.tenant_id)})}


def request_link(api, data):
    response = api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"})
    assert response.status_code == 202, response.text
    with data.factory() as db:
        row = db.scalar(select(models.NotificationOutbox).where(models.NotificationOutbox.event_type == recovery.EVENT))
        assert row and not row.payload["body"]
        assert notification_outbox._attempt_email_delivery(db, row.id) == 1
    link = next(line for line in api.messages[-1].splitlines() if line.startswith("http"))
    return parse_qs(urlsplit(link).fragment.partition("?")[2])["token"][0]


def test_email_only_encrypted_delivery_reset_and_session_revocation(data, api):
    access = headers(data.owner)
    refresh = create_refresh_token(data.owner.id, extra_claims={"tenant_id": str(data.owner.tenant_id)})
    token = request_link(api, data)
    with data.factory() as db:
        row = db.scalar(select(models.NotificationOutbox).where(models.NotificationOutbox.event_type == recovery.EVENT))
        assert row.status == models.NotificationOutboxStatusEnum.SENT
        assert "encrypted_recovery" not in row.payload and token not in str(row.payload)
    result = api.post("/api/auth/reset-password", json={"token": token, "new_password": NEW})
    assert result.status_code == 204, result.text
    assert api.get("/api/auth/me", headers=access).status_code == 401
    assert api.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    assert api.post("/api/auth/login", json={"email": "recovery-owner@example.com", "password": OLD}).status_code == 401
    login = api.post("/api/auth/login", json={"email": "recovery-owner@example.com", "password": NEW})
    assert login.status_code == 200, login.text
    assert api.get("/api/auth/me", headers={"Authorization": "Bearer " + login.json()["token"]["access_token"]}).status_code == 200
    assert api.post("/api/auth/reset-password", json={"token": token, "new_password": OLD}).status_code == 400
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        assert user.points == 125 and user.credentials_version == 1
        event = db.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == "user.credentials_changed"))
        assert event and NEW not in str(event.payload) and token not in str(event.payload)


def test_invalid_expired_foreign_and_access_tokens_do_not_change_credentials(data, api):
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        _, token = recovery.create_link(user, recovery.reset_url())
    claims = jwt.get_unverified_claims(token)
    expired = jwt.encode({**claims, "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}, recovery._key("signing"), algorithm="HS256")
    foreign = jwt.encode({**claims, "tenant_id": str(data.outsider.tenant_id)}, recovery._key("signing"), algorithm="HS256")
    for invalid in ("bad", expired, foreign, headers(data.owner)["Authorization"][7:]):
        assert api.post("/api/auth/reset-password", json={"token": invalid, "new_password": NEW}).status_code == 400
    with data.factory() as db:
        assert verify_password(OLD, db.get(models.User, data.owner.id).hashed_password)


def test_unknown_and_inactive_accounts_are_indistinguishable(data, api):
    known = api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"})
    unknown = api.post("/api/auth/forgot-password", json={"email": "missing@example.com"})
    with data.factory() as db:
        db.get(models.User, data.owner.id).status = models.UserStatusEnum.DEACTIVATED
        db.commit()
    inactive = api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"})
    assert known.status_code == unknown.status_code == inactive.status_code == 202
    assert known.json() == unknown.json() == inactive.json()
    assert not api.messages


def test_rate_limit_and_unavailable_configuration_fail_honestly(data, api, monkeypatch):
    for _ in range(3):
        assert api.post("/api/auth/forgot-password", json={"email": "missing@example.com"}).status_code == 202
    assert api.post("/api/auth/forgot-password", json={"email": "missing@example.com"}).status_code == 429
    monkeypatch.setattr(recovery.cache, "get_redis_client", lambda: None)
    assert api.post("/api/auth/forgot-password", json={"email": "other@example.com"}).status_code == 503


def test_configuration_errors_do_not_disclose_account_existence(data, api, monkeypatch):
    monkeypatch.setattr(get_settings(), "password_reset_url", "https://untrusted.example.com/#/reset-password")
    known = api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"})
    unknown = api.post("/api/auth/forgot-password", json={"email": "missing@example.com"})
    assert known.status_code == unknown.status_code == 503 and known.json() == unknown.json()


def test_production_recovery_refuses_plaintext_smtp(data, api, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "jwt_secret_key", "synthetic-production-test-key-not-a-secret")
    monkeypatch.setattr(settings, "password_reset_url", "https://recovery.example.test/#/reset-password")
    monkeypatch.setattr(settings, "cors_allow_origins", ["https://recovery.example.test"])
    with data.factory() as db:
        db.get(models.SmtpConfig, 1).encryption = "none"
        db.commit()
    for email in ("recovery-owner@example.com", "missing@example.com"):
        assert api.post("/api/auth/forgot-password", json={"email": email}).status_code == 503


@pytest.mark.parametrize("encryption", ["tls", "ssl"])
def test_smtp_encryption_verifies_certificates_and_has_timeout(monkeypatch, encryption):
    import ssl
    from types import SimpleNamespace
    observed = {}
    class SMTP:
        def __init__(self, *_args, **kwargs):
            observed.update(kwargs)
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            pass
        def ehlo(self):
            pass
        def starttls(self, **kwargs):
            observed.update(kwargs)
        def login(self, *_args):
            pass
        def send_message(self, _message):
            pass
    monkeypatch.setattr(email_utils.smtplib, "SMTP", SMTP)
    monkeypatch.setattr(email_utils.smtplib, "SMTP_SSL", SMTP)
    config = SimpleNamespace(host="smtp.example.test", port=1025, username="sender@example.com", password="synthetic", encryption=encryption)
    email_utils._send_email_with_config(smtp_config=config, to_address="synthetic@example.com", subject="Test", body="Synthetic")
    assert observed["timeout"] == 15
    assert observed["context"].check_hostname and observed["context"].verify_mode == ssl.CERT_REQUIRED


def test_provider_cannot_echo_recovery_content_into_audit_logs(data, api, monkeypatch):
    assert api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"}).status_code == 202
    audits = []
    monkeypatch.setattr(audit_logger, "log_event", audits.append)
    def fail(**kwargs):
        raise email_utils.EmailDeliveryError(kwargs["body"])
    monkeypatch.setattr(email_utils, "_send_email_with_config", fail)
    with data.factory() as db:
        row = db.scalar(select(models.NotificationOutbox).where(models.NotificationOutbox.event_type == recovery.EVENT))
        notification_outbox._attempt_email_delivery(db, row.id)
        assert "eyJ" not in row.last_error
    assert audits and all("eyJ" not in str(event) and "reset-password?" not in str(event) for event in audits)


@pytest.mark.parametrize("route", ["admin", "profile", "self"])
def test_password_changes_invalidate_issued_links_and_preserve_actor_audit(data, api, route):
    with data.factory() as db:
        _, token = recovery.create_link(db.get(models.User, data.owner.id), recovery.reset_url())
    path, method, body = {
        "admin": (f"/api/users/{data.owner.id}/reset-password", "post", {"new_password": NEW}),
        "profile": (f"/api/users/{data.owner.id}", "patch", {"password": NEW}),
        "self": ("/api/users/me/change-password", "post", {"old_password": OLD, "new_password": NEW}),
    }[route]
    response = getattr(api, method)(path, json=body, headers=headers(data.owner))
    assert response.status_code in {200, 204}, response.text
    assert api.post("/api/auth/reset-password", json={"token": token, "new_password": OLD}).status_code == 400
    with data.factory() as db:
        assert db.get(models.User, data.owner.id).credentials_version == 1
        event = db.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == "user.credentials_changed"))
        assert event.actor_id == data.owner.id


def test_distributed_rate_limits_use_real_redis_without_exposing_identities(data, api, monkeypatch):
    url = os.environ.get("ZEAPLAY_RT_REDIS_TEST_URL")
    if not url:
        pytest.skip("Requires explicitly isolated test Redis")
    import redis
    from types import SimpleNamespace
    from uuid import uuid4
    client = redis.Redis.from_url(url, socket_timeout=2)
    prefix = "recovery-test-" + uuid4().hex
    monkeypatch.setattr(get_settings(), "cache_prefix", prefix)
    monkeypatch.setattr(recovery.cache, "get_redis_client", lambda: client)
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    try:
        for _ in range(3):
            recovery.rate_limit(request, "synthetic@example.com")
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as failure:
            recovery.rate_limit(request, "synthetic@example.com")
        assert failure.value.status_code == 429
        keys = list(client.scan_iter(match=prefix + ":recovery:*"))
        assert len(keys) == 2 and all(b"example" not in key and client.ttl(key) > 0 for key in keys)
    finally:
        keys = list(client.scan_iter(match=prefix + ":recovery:*"))
        if keys:
            client.delete(*keys)
        client.close()


@pytest.mark.parametrize("role", [models.RoleEnum.OWNER, models.RoleEnum.ADMIN, models.RoleEnum.MANAGER])
def test_admin_reset_and_profile_password_update_are_tenant_scoped(data, api, role):
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = role
        before = db.get(models.User, data.outsider.id).hashed_password
        db.commit()
    url = f"/api/users/{data.outsider.id}"
    assert api.post(url + "/reset-password", json={"new_password": NEW}, headers=headers(data.owner)).status_code == 404
    assert api.patch(url, json={"password": NEW}, headers=headers(data.owner)).status_code == 404
    with data.factory() as db:
        assert db.get(models.User, data.outsider.id).hashed_password == before


def test_simultaneous_redemption_only_changes_password_once(data, api):
    token = request_link(api, data)
    def redeem(_):
        return api.post("/api/auth/reset-password", json={"token": token, "new_password": NEW}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(redeem, range(2)))
    assert results.count(204) == 1 and set(results) <= {204, 400, 409}
    with data.factory() as db:
        assert db.get(models.User, data.owner.id).credentials_version == 1


def test_audit_failure_rolls_back_password_version_and_queued_email(data, api, monkeypatch):
    with data.factory() as db:
        _, token = recovery.create_link(db.get(models.User, data.owner.id), recovery.reset_url())
        before = db.scalar(select(models.NotificationOutbox.id))
    def fail(*_args, **_kwargs):
        raise RuntimeError("Synthetic audit failure")
    monkeypatch.setattr(recovery.security_audit, "append_event", fail)
    with pytest.raises(RuntimeError, match="Synthetic audit failure"):
        api.post("/api/auth/reset-password", json={"token": token, "new_password": NEW})
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        assert user.credentials_version == 0 and verify_password(OLD, user.hashed_password)
        assert db.scalar(select(models.NotificationOutbox.id)) == before
        assert recovery.token_user(db, token).id == user.id


def test_failed_email_retries_but_expired_link_does_not_send(data, api, monkeypatch):
    assert api.post("/api/auth/forgot-password", json={"email": "recovery-owner@example.com"}).status_code == 202
    with data.factory() as db:
        row = db.scalar(select(models.NotificationOutbox).where(models.NotificationOutbox.event_type == recovery.EVENT))
        assert "eyJ" not in str(row.payload) and row.payload.get("encrypted_recovery")
        def fail(**kwargs):
            raise email_utils.EmailDeliveryError("secret token must not escape")
        monkeypatch.setattr(email_utils, "_send_email_with_config", fail)
        notification_outbox._attempt_email_delivery(db, row.id)
        db.refresh(row)
        assert row.status == models.NotificationOutboxStatusEnum.FAILED and row.next_attempt_at
        assert "secret" not in row.last_error and row.attempts == 1
        db.get(models.User, data.owner.id).status = models.UserStatusEnum.DEACTIVATED
        db.commit()
        notification_outbox._attempt_email_delivery(db, row.id)
        db.refresh(row)
        assert row.next_attempt_at is None and "encrypted_recovery" not in row.payload


@pytest.mark.parametrize("password", ["short", "x" * 73, "\u20ac" * 25])
def test_password_policy_is_enforced_on_each_route(data, api, password):
    assert api.post(f"/api/users/{data.owner.id}/reset-password", headers=headers(data.owner), json={"new_password": password}).status_code == 422
    assert api.post("/api/users/me/change-password", headers=headers(data.owner), json={"old_password": OLD, "new_password": password}).status_code == 422
    assert api.post("/api/auth/reset-password", json={"token": "bad", "new_password": password}).status_code == 422


def test_version_migration_preserves_users_and_refuses_erasing_revocation(data, engine, monkeypatch):
    revision = import_module("backend.alembic.versions.fe6f7a8b9c0d_password_credentials_version")
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE users DROP COLUMN credentials_version")
        before = connection.execute(text("SELECT id,points,hashed_password,updated_at FROM users ORDER BY id")).all()
        monkeypatch.setattr(revision, "op", Operations(MigrationContext.configure(connection)))
        revision.upgrade()
        assert connection.execute(text("SELECT id,points,hashed_password,updated_at FROM users ORDER BY id")).all() == before
        revision.downgrade()
        revision.upgrade()
        connection.execute(text("UPDATE users SET credentials_version=1 WHERE id=:id"), {"id": data.owner.id})
        with pytest.raises(RuntimeError, match="revocations exist"):
            revision.downgrade()


def test_alembic_cli_preserves_existing_data_and_guards_revocation_rollback(data, engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("Alembic CLI check requires the explicitly isolated PostgreSQL schema")
    with engine.begin() as connection:
        schema = connection.scalar(text("SELECT current_schema()"))
        assert schema.startswith("lifecycle_") and schema[10:].isalnum()
        connection.exec_driver_sql("ALTER TABLE users DROP COLUMN credentials_version")
        before = connection.execute(text("SELECT id,points,hashed_password,updated_at FROM users ORDER BY id")).all()
    url = engine.url.update_query_dict({"options": f"-csearch_path={schema},public"})
    environment = {**os.environ, "VEE_BOOTSTRAP_SCHEMA": "false", "VEE_DATABASE_URL": url.render_as_string(hide_password=False)}
    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=Path(__file__).resolve().parents[1],
                              env=environment, capture_output=True, text=True, timeout=60)
    # Stamping is permitted only on this synthetic, owned schema, never the application database.
    assert alembic("stamp", "fd5e6f7a8b9c").returncode == 0
    upgraded = alembic("upgrade", "fe6f7a8b9c0d")
    assert upgraded.returncode == 0, upgraded.stderr
    with engine.begin() as connection:
        assert connection.execute(text("SELECT id,points,hashed_password,updated_at FROM users ORDER BY id")).all() == before
        assert connection.scalar(text("SELECT max(credentials_version) FROM users")) == 0
        connection.execute(text("UPDATE users SET credentials_version=1 WHERE id=:id"), {"id": data.owner.id})
    rejected = alembic("downgrade", "fd5e6f7a8b9c")
    assert rejected.returncode != 0 and "revocations exist" in rejected.stderr
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "fe6f7a8b9c0d"
