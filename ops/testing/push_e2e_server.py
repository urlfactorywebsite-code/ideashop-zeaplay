"""Synthetic push E2E API; never import from the application's entry point.

The real routers/authentication/storage run against a private scratch schema.
Only outbound provider transport is replaced; this does not prove OS delivery.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import base64
import json
import os
from pathlib import Path
from threading import Lock
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI, HTTPException
from jose import jwt
import requests
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app import models
from app.config import get_settings
from app.database import Base, get_db
from app.dependencies import get_current_active_user
from app.routers.auth import router as auth_router
from app.routers.push import router as push_router
from app.routers.notification_preferences import router as preferences_router
from app.routers.departments import router as departments_router
from app.services import push_service
from app.tickets import models as ticket_models  # noqa: F401


url = os.environ["ZEAPLAY_RT_POSTGRES_TEST_URL"]
assert "rt3_test" in (make_url(url).database or ""), "Scratch database required"
scratch = Path(os.environ["ZEAPLAY_E2E_OUTPUT"])
assert scratch.is_dir(), "Caller-owned temporary output directory required"
schema = "push_browser_" + uuid4().hex
admin = create_engine(url)
engine = create_engine(url)
factory = sessionmaker(bind=engine, expire_on_commit=False)
actors = {}
acceptances = []
acceptance_lock = Lock()


def encoded(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    return (
        encoded(private.private_numbers().private_value.to_bytes(32, "big")),
        encoded(private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
    )


private_key, public_key = keypair()
configuration = {
    "VAPID_PUBLIC_KEY": public_key, "VAPID_PRIVATE_KEY": private_key,
    "VAPID_SUBJECT": "mailto:synthetic-push@example.com",
}
push_service._read_env = configuration.get


def synthetic_acceptance(**kwargs):
    """Record only sanitized recipient metadata; never contact a push provider."""
    payload = json.loads(kwargs["data"])
    with acceptance_lock:
        acceptances.append({
            "recipient_user_id": payload.get("recipient_user_id"),
            "recipient_tenant_id": payload.get("recipient_tenant_id"),
            "event_type": payload.get("event_type"),
            "url": payload.get("url"),
        })
    response = requests.Response()
    response.status_code = 201
    return response


push_service.webpush = synthetic_acceptance


@event.listens_for(engine, "connect")
def scope(connection, _):
    with connection.cursor() as cursor:
        cursor.execute(f'SET search_path TO "{schema}", public')
        cursor.execute("SET statement_timeout TO 15000")
    connection.commit()


def database():
    with factory() as db:
        yield db


@asynccontextmanager
async def lifespan(app):
    with admin.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        Base.metadata.create_all(engine)
        tenant = uuid4()
        _, browser_public = keypair()
        browser_keys = {"p256dh": browser_public, "auth": encoded(os.urandom(16))}
        with factory() as db:
            for name, role, status in (
                ("owner", models.RoleEnum.OWNER, models.UserStatusEnum.ACTIVE),
                ("user", models.RoleEnum.USER, models.UserStatusEnum.ACTIVE),
                ("foreign", models.RoleEnum.OWNER, models.UserStatusEnum.ACTIVE),
                ("inactive", models.RoleEnum.USER, models.UserStatusEnum.DEACTIVATED),
            ):
                user = models.User(
                    tenant_id=uuid4() if name == "foreign" else tenant,
                    name=f"Synthetic push {name}", email=f"{uuid4()}@example.com",
                    hashed_password="synthetic-unusable-password", role=role, status=status,
                )
                db.add(user)
                db.flush()
                actors[name] = user.id
            devices = {}
            for name in ("user", "foreign"):
                device = push_service.save_subscription(
                    db, user_id=actors[name], endpoint=f"https://fcm.googleapis.com/fcm/send/{uuid4()}",
                    **browser_keys, device_label="Audit phone", user_agent="Synthetic phone",
                )
                devices[name + "_phone"] = device.id
            db.commit()
            settings = get_settings()
            credentials, users = {}, {}
            for name, identifier in actors.items():
                user = db.get(models.User, identifier)
                users[name] = {"id": user.id, "tenant_id": str(user.tenant_id), "name": user.name, "role": user.role.value}
                credentials[name] = jwt.encode({
                    "user_id": user.id, "tenant_id": str(user.tenant_id), "token_type": "access",
                    "credentials_version": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=2),
                }, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
            (scratch / "ready.json").write_text(json.dumps({
                "tokens": credentials, "users": users, "subscription_ids": devices,
                "browser_keys": browser_keys, "public_key": public_key, "schema": schema,
            }), encoding="utf-8")
        yield
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
        (scratch / "ready.json").unlink(missing_ok=True)


app = FastAPI(lifespan=lifespan)
for router in (auth_router, push_router, preferences_router, departments_router):
    app.include_router(router, prefix="/api")
app.dependency_overrides[get_db] = database


@app.get("/__audit__/snapshot")
def snapshot(user=Depends(get_current_active_user)):
    if user.id != actors.get("owner"):
        raise HTTPException(403)
    with factory() as db:
        subscriptions = [{
            "id": row.id, "user_id": row.user_id, "revoked": row.revoked_at is not None,
            "endpoint_hash": push_service.subscription_metadata(row)["endpoint_hash"],
        } for row in db.scalars(select(models.PushSubscription).order_by(models.PushSubscription.id))]
        preferences = [{
            "user_id": row.user_id, "module": row.module, "push_enabled": row.push_enabled,
        } for row in db.scalars(select(models.NotificationPreference).order_by(
            models.NotificationPreference.user_id, models.NotificationPreference.module))]
    with acceptance_lock:
        captured = list(acceptances)
    return {
        "subscriptions": subscriptions, "preferences": preferences, "provider_acceptances": captured,
        "delivery_transport": "synthetic_provider_201",
    }
