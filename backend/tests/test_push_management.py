"""Push controls and delivery regressions; network delivery is always mocked."""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from types import SimpleNamespace
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from pywebpush import WebPushException
import pytest
import requests
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from backend.app import models
from backend.app.config import get_settings
from backend.app.database import Base, get_db
from backend.app.routers import notification_preferences, push
from backend.app.services import push_service
from backend.app.tickets import models as ticket_models  # noqa: F401


def encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    return (
        encoded(private.private_numbers().private_value.to_bytes(32, "big")),
        encoded(private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
    )


@pytest.fixture(scope="module", params=["sqlite", "postgresql"])
def engine(request, tmp_path_factory):
    admin = None
    if request.param == "sqlite":
        directory = tmp_path_factory.mktemp("push-management")
        instance = create_engine("sqlite:///" + (directory / "push.db").as_posix(),
                                 connect_args={"check_same_thread": False, "timeout": 30})
    else:
        url = os.environ.get("ZEAPLAY_RT_POSTGRES_TEST_URL")
        if not url:
            pytest.skip("Requires explicit isolated PostgreSQL rt3_test database")
        assert "rt3_test" in (make_url(url).database or ""), "Refusing a non-scratch database"
        schema = "push_management_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        instance = create_engine(url)

        @event.listens_for(instance, "connect")
        def search_path(connection, _):
            with connection.cursor() as cursor:
                cursor.execute(f'SET search_path TO "{schema}", public')
                cursor.execute("SET statement_timeout TO 15000")
            connection.commit()
    computed = models.Task.__table__.c.search_vector.computed
    if request.param == "sqlite":
        models.Task.__table__.c.search_vector.computed = None
    try:
        Base.metadata.create_all(instance)
    finally:
        models.Task.__table__.c.search_vector.computed = computed
    try:
        yield instance
    finally:
        instance.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


@pytest.fixture
def data(engine, monkeypatch):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    tenant = uuid4()
    with factory() as db:
        users = [
            models.User(id=str(uuid4()), tenant_id=tid, name=name, email=f"{uuid4()}@example.com",
                        hashed_password="not-a-real-login", role=role, status=status)
            for name, tid, role, status in (
                ("User", tenant, models.RoleEnum.USER, models.UserStatusEnum.ACTIVE),
                ("Peer", tenant, models.RoleEnum.USER, models.UserStatusEnum.ACTIVE),
                ("Other tenant owner", uuid4(), models.RoleEnum.OWNER, models.UserStatusEnum.ACTIVE),
                ("Inactive", tenant, models.RoleEnum.USER, models.UserStatusEnum.DEACTIVATED),
            )
        ]
        db.add_all(users)
        db.commit()
    app = FastAPI()
    app.include_router(push.router)
    app.include_router(notification_preferences.router)

    def get_test_db():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = get_test_db
    client = TestClient(app)
    settings = get_settings()

    def headers(user=users[0], tenant_id=None):
        return {"Authorization": "Bearer " + jwt.encode({
            "user_id": user.id, "tenant_id": str(tenant_id or user.tenant_id), "token_type": "access",
        }, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)}
    private, public = keypair()
    configuration = {"VAPID_PRIVATE_KEY": private, "VAPID_PUBLIC_KEY": public, "VAPID_SUBJECT": "mailto:push@example.com"}
    monkeypatch.setattr(push_service, "_read_env", configuration.get)
    accepted_calls = []

    def accepted(**kwargs):
        accepted_calls.append(kwargs)
        response = requests.Response()
        response.status_code = 201
        return response
    monkeypatch.setattr(push_service, "webpush", accepted)

    def network_forbidden(*_args, **_kwargs):
        raise AssertionError("This suite must not send real network requests")
    monkeypatch.setattr(requests.Session, "post", network_forbidden)
    _, browser_public = keypair()
    subscription = {
        "endpoint": f"https://fcm.googleapis.com/fcm/send/{uuid4()}",
        "keys": {"p256dh": browser_public, "auth": encoded(os.urandom(16))},
        "device_label": "Test browser",
        "user_agent": "Synthetic audit browser",
    }
    return SimpleNamespace(factory=factory, client=client, headers=headers, user=users[0], peer=users[1],
                           outsider=users[2], inactive=users[3], configuration=configuration,
                           subscription=subscription, calls=accepted_calls)


def register(data, user=None, suffix=""):
    payload = {**data.subscription, "endpoint": data.subscription["endpoint"] + suffix}
    response = data.client.post("/push/subscribe", json=payload, headers=data.headers(user or data.user))
    assert response.status_code == 200, response.text
    return response.json()


def test_subscription_roundtrip_metadata_and_idempotency(data):
    first = register(data)
    second = register(data)
    assert first["id"] == second["id"]
    assert first["created_at"] == second["created_at"]
    assert first["endpoint_hash"] == hashlib.sha256(data.subscription["endpoint"].encode()).hexdigest()
    listed = data.client.get("/push/subscriptions", headers=data.headers()).json()
    assert listed == [second]
    assert not {"endpoint", "p256dh", "auth", "user_id"} & set(listed[0])
    status = data.client.get("/push/status", headers=data.headers()).json()
    assert status == dict(configured=True, public_key_configured=True, private_key_configured=True,
                          subject_configured=True, configuration_valid=True, active_subscription_count=1)
    assert data.configuration["VAPID_PRIVATE_KEY"] not in json.dumps(status)


@pytest.mark.parametrize("foreign", ["peer", "outsider"])
def test_account_ownership_cannot_be_taken_over_or_revoked(data, foreign):
    own = register(data)
    headers = data.headers(getattr(data, foreign))
    assert data.client.post("/push/subscribe", json=data.subscription, headers=headers).status_code == 409
    assert data.client.post("/push/unsubscribe", json={"endpoint": data.subscription["endpoint"]}, headers=headers).status_code == 204
    assert data.client.delete("/push/subscriptions/" + own["id"], headers=headers).status_code == 204
    assert data.client.delete("/push/subscriptions", headers=headers).status_code == 204
    assert data.client.get("/push/subscriptions", headers=headers).json() == []
    assert data.client.post("/push/test", json={"subscription_id": own["id"]}, headers=headers).status_code == 404
    assert len(data.client.get("/push/subscriptions", headers=data.headers()).json()) == 1
    assert not data.calls


def test_revoke_one_all_and_resubscribe_preserves_id(data):
    first, second = register(data), register(data, suffix="-second")
    register(data, user=data.outsider, suffix="-outsider")
    assert data.client.delete("/push/subscriptions/" + first["id"], headers=data.headers()).status_code == 204
    assert data.client.delete("/push/subscriptions/" + first["id"], headers=data.headers()).status_code == 204
    assert [entry["id"] for entry in data.client.get("/push/subscriptions", headers=data.headers()).json()] == [second["id"]]
    assert register(data)["id"] == first["id"]
    assert data.client.delete("/push/subscriptions", headers=data.headers()).status_code == 204
    assert data.client.get("/push/status", headers=data.headers()).json()["active_subscription_count"] == 0
    assert len(data.client.get("/push/subscriptions", headers=data.headers(data.outsider)).json()) == 1
    with data.factory() as db:
        revoked_at = db.get(models.PushSubscription, first["id"]).revoked_at
    assert data.client.post("/push/unsubscribe", json={"endpoint": data.subscription["endpoint"]}, headers=data.headers()).status_code == 204
    with data.factory() as db:
        assert db.get(models.PushSubscription, first["id"]).revoked_at == revoked_at


@pytest.mark.parametrize("method,path", [
    ("get", "/push/status"), ("get", "/push/subscriptions"), ("post", "/push/test"),
    ("delete", "/push/subscriptions"), ("get", "/notification/preferences"),
])
def test_management_requires_current_active_account(data, method, path):
    operation = getattr(data.client, method)
    assert operation(path).status_code == 401
    assert operation(path, headers=data.headers(data.inactive)).status_code == 403
    assert operation(path, headers=data.headers(tenant_id=uuid4())).status_code == 401


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://[::1]/x",
    "https://169.254.169.254/x", "https://localhost/x", "https://fcm.googleapis.com.attacker.test/x",
    "https://fcm.googleapis.com@attacker.test/x", "https://attacker.test@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x", "https://fcm.googleapis.com/x#fragment",
    "https://fcm.googleapis.com\\@127.0.0.1/x", " https://fcm.googleapis.com/x",
])
def test_rejects_non_provider_and_ambiguous_endpoints(data, endpoint):
    assert data.client.post("/push/subscribe", json={**data.subscription, "endpoint": endpoint},
                            headers=data.headers()).status_code == 422
    assert not data.calls


@pytest.mark.parametrize("field,value", [("auth", "AA"), ("p256dh", "AA"), ("auth", "$" * 22), ("p256dh", encoded(b"\x04" + b"\0" * 64))])
def test_rejects_invalid_browser_keys(data, field, value):
    payload = {**data.subscription, "keys": {**data.subscription["keys"], field: value}}
    assert data.client.post("/push/subscribe", json=payload, headers=data.headers()).status_code == 422


@pytest.mark.parametrize("failure", ["missing", "mismatched", "malformed", "invalid_subject"])
def test_vapid_configuration_is_validated_without_secret_disclosure(data, failure):
    if failure == "missing":
        data.configuration.pop("VAPID_PRIVATE_KEY")
    elif failure == "mismatched":
        data.configuration["VAPID_PUBLIC_KEY"] = keypair()[1]
    elif failure == "malformed":
        data.configuration["VAPID_PRIVATE_KEY"] = "malformed-private-material"
    else:
        data.configuration["VAPID_SUBJECT"] = "invalid-subject"
    response = data.client.get("/push/status", headers=data.headers())
    assert response.status_code == 200
    assert not response.json()["configured"]
    assert not response.json()["configuration_valid"]
    assert all(value not in response.text for value in data.configuration.values())
    assert data.client.post("/push/test", headers=data.headers()).status_code == 503
    assert data.client.post("/push/subscribe", json=data.subscription, headers=data.headers()).status_code == 503
    assert not data.calls


def test_regular_user_can_test_own_device_with_honest_acceptance_and_account_binding(data):
    first = register(data)
    register(data, suffix="-second")
    register(data, user=data.outsider, suffix="-outsider")
    response = data.client.post("/push/test", json={"subscription_id": first["id"]}, headers=data.headers())
    assert response.status_code == 200
    assert response.json() == dict(delivered=1, accepted=1, attempted=1, failed=0, revoked=0)
    assert len(data.calls) == 1
    call = data.calls[0]
    payload = json.loads(call["data"])
    assert payload["recipient_user_id"] == data.user.id
    assert payload["recipient_tenant_id"] == str(data.user.tenant_id)
    assert payload["url"].startswith("/#/settings")
    assert call["timeout"] == (3.05, 5)
    assert call["ttl"] == 300


def test_delivery_overrides_recipient_payload_and_skips_inactive_accounts(data):
    register(data)
    with data.factory() as db:
        push_service.save_subscription(db, user_id=data.inactive.id, **{
            key: value for key, value in data.subscription.items() if key not in ("keys", "endpoint")
        }, endpoint=data.subscription["endpoint"] + "-inactive", **data.subscription["keys"])
        db.commit()
        assert push_service.send_push(db, user_ids=[data.user.id, data.inactive.id], payload={
            "recipient_user_id": data.outsider.id, "recipient_tenant_id": str(data.outsider.tenant_id),
        }) == 1
    payload = json.loads(data.calls[0]["data"])
    assert payload["recipient_user_id"] == data.user.id
    assert payload["recipient_tenant_id"] == str(data.user.tenant_id)


@pytest.mark.parametrize("failure", [404, 410, 403, 500, "timeout"])
def test_delivery_errors_are_safe_and_expired_devices_are_revoked(data, monkeypatch, caplog, failure):
    device = register(data)
    sensitive = "sensitive-provider-response-" + data.subscription["endpoint"]

    def fail(**_kwargs):
        if failure == "timeout":
            raise requests.Timeout(sensitive)
        response = requests.Response()
        response.status_code = failure
        response._content = sensitive.encode()
        raise WebPushException(sensitive, response=response)
    monkeypatch.setattr(push_service, "webpush", fail)
    response = data.client.post("/push/test", headers=data.headers())
    assert response.status_code == 200
    assert response.json() == dict(delivered=0, accepted=0, attempted=1, failed=1, revoked=int(failure in (404, 410)))
    assert sensitive not in caplog.text
    assert data.subscription["endpoint"] not in caplog.text
    with data.factory() as db:
        assert (db.get(models.PushSubscription, device["id"]).revoked_at is not None) == (failure in (404, 410))


def test_legacy_private_endpoint_is_never_contacted(data):
    with data.factory() as db:
        device = models.PushSubscription(user_id=data.user.id, endpoint="https://127.0.0.1/private",
                                         **data.subscription["keys"])
        db.add(device)
        db.commit()
        result = push_service.send_push_result(db, user_ids=[data.user.id], payload={})
        assert (result.accepted, result.failed, result.revoked) == (0, 1, 1)
        assert device.revoked_at is not None
    assert not data.calls


def test_push_transport_disables_redirects(monkeypatch):
    seen = []
    monkeypatch.setattr(requests.Session, "post", lambda self, url, **kwargs: seen.append((url, kwargs)))
    with push_service._NoRedirectSession() as transport:
        transport.post("https://fcm.googleapis.com/test", allow_redirects=True, timeout=5)
    assert seen[0][1]["allow_redirects"] is False


def test_preferences_include_chat_reject_duplicates_and_isolate_accounts(data):
    headers = data.headers()
    assert len(data.client.get("/notification/preferences", headers=headers).json()) == 6
    assert data.client.post("/notification/preferences", headers=headers, json={"preferences": [
        {"module": "chat", "push_enabled": False}, {"module": "chat", "push_enabled": True},
    ]}).status_code == 422
    response = data.client.post("/notification/preferences", headers=headers, json={"preferences": [
        {"module": "chat", "push_enabled": False},
    ]})
    assert response.status_code == 200
    assert next(pref for pref in response.json() if pref["module"] == "chat")["push_enabled"] is False
    assert all(pref["push_enabled"] for pref in data.client.get("/notification/preferences", headers=data.headers(data.outsider)).json())


def test_concurrent_registration_is_single_owned_row(data):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: data.client.post("/push/subscribe", json=data.subscription, headers=data.headers()), range(8)))
    assert [response.status_code for response in results] == [200] * 8
    assert len({response.json()["id"] for response in results}) == 1
    with data.factory() as db:
        assert db.scalar(select(func.count()).select_from(models.PushSubscription).where(
            models.PushSubscription.endpoint == data.subscription["endpoint"])) == 1


def test_concurrent_cross_account_registration_never_reassigns(data):
    users = [data.user, data.outsider] * 4
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda user: (user.id, data.client.post("/push/subscribe", json=data.subscription, headers=data.headers(user))), users))
    winners = {user_id for user_id, response in results if response.status_code == 200}
    assert len(winners) == 1
    assert sorted(response.status_code for _, response in results) == [200] * 4 + [409] * 4
    with data.factory() as db:
        row = db.scalar(select(models.PushSubscription).where(models.PushSubscription.endpoint == data.subscription["endpoint"]))
        assert row.user_id in winners


def test_concurrent_preference_updates_have_one_row_per_module(data):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda value: data.client.post("/notification/preferences", headers=data.headers(),
            json={"preferences": [{"module": "tasks", "push_enabled": bool(value % 2)}, {"module": "chat", "push_enabled": False}]}), range(8)))
    assert [response.status_code for response in results] == [200] * 8
    with data.factory() as db:
        rows = db.scalars(select(models.NotificationPreference).where(models.NotificationPreference.user_id == data.user.id)).all()
        assert sorted(row.module for row in rows) == ["chat", "tasks"]
