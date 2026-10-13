import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app import models
from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import Base, get_db
from backend.app.routers.clients import router as clients_router
from backend.app.routers.contacts import client_contacts_router, router as contacts_router
from backend.app.routers.media import router as media_router
from backend.app.routers.notifications import router as notifications_router
from backend.app.routers.projects import router as projects_router
from backend.app.routers.tasks import router as tasks_router
from backend.app.routers.time_entries import router as time_entries_router
from backend.app.services import audit_logger, security_audit


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

models.Task.__table__.c.search_vector.computed = None
Base.metadata.create_all(bind=engine)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI()
app.include_router(clients_router, prefix="/api")
app.include_router(contacts_router, prefix="/api")
app.include_router(client_contacts_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(time_entries_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(media_router, prefix="/api")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_function():
    db = TestingSessionLocal()
    try:
        for model in [
            models.AuditEvent,
            models.NotificationOutbox,
            models.Notification,
            models.TimeEntry,
            models.CompletionAttachment,
            models.CompletionSubmission,
            models.SubtaskWorkflowEvent,
            models.SubtaskDependency,
            models.Subtask,
            models.Task,
            models.MediaItem,
            models.MediaFile,
            models.ProjectMember,
            models.Project,
            models.ClientContact,
            models.Contact,
            models.Client,
            models.User,
        ]:
            db.query(model).delete()
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


def _create_user(role: models.RoleEnum, tenant_id: uuid.UUID | None = None) -> tuple[models.User, str]:
    tenant = tenant_id or uuid.uuid4()
    user = models.User(
        id=str(uuid.uuid4()),
        tenant_id=tenant,
        name=f"{role.value}-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        hashed_password=hash_password("password123"),
        role=role,
        status=models.UserStatusEnum.ACTIVE,
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_phase13_security_headers_and_request_size_limit():
    from backend.app import main as main_module

    api_client = TestClient(main_module.app)
    response = api_client.get("/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"

    previous_limit = main_module.settings.max_request_body_mb
    main_module.settings.max_request_body_mb = 1
    try:
        too_large = api_client.post(
            "/api/clients",
            data="x" * (1024 * 1024 + 1),
            headers={"Content-Length": str(1024 * 1024 + 1), "Content-Type": "application/json"},
        )
        assert too_large.status_code == 413
        assert too_large.json()["detail"] == "Request body too large"
        assert too_large.headers["X-Content-Type-Options"] == "nosniff"
        assert too_large.headers["X-Frame-Options"] == "DENY"
    finally:
        main_module.settings.max_request_body_mb = previous_limit


def test_phase13_audit_redacts_sensitive_metadata(monkeypatch):
    captured = []
    monkeypatch.setattr(audit_logger, "queue_log", lambda payload: captured.append(payload))

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="SECURITY_REDACTION_TEST",
            category=models.AuditLogCategoryEnum.SECURITY,
            before={"password": "plain", "safe": "visible"},
            after={"nested": {"api_key": "secret", "name": "kept"}},
            metadata={"access_token": "abc", "details": [{"refresh_secret": "hidden", "id": "ok"}]},
        )
    )

    assert captured
    payload = captured[0]
    assert payload["before"]["password"] == security_audit.REDACTED_VALUE
    assert payload["before"]["safe"] == "visible"
    assert payload["after"]["nested"]["api_key"] == security_audit.REDACTED_VALUE
    assert payload["after"]["nested"]["name"] == "kept"
    assert payload["metadata_payload"]["access_token"] == security_audit.REDACTED_VALUE
    assert payload["metadata_payload"]["details"][0]["refresh_secret"] == security_audit.REDACTED_VALUE


def test_phase13_multiple_manager_permission_matrix_and_tenant_boundaries():
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager_a, manager_a_token = _create_user(models.RoleEnum.MANAGER, tenant)
    manager_b, manager_b_token = _create_user(models.RoleEnum.MANAGER, tenant)
    outsider_manager, outsider_token = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    _, other_tenant_token = _create_user(models.RoleEnum.OWNER, uuid.uuid4())

    owner_headers = _auth(owner_token)
    client_response = client.post("/api/clients", json={"company_name": "Security Client"}, headers=owner_headers)
    assert client_response.status_code == 201, client_response.text
    client_id = client_response.json()["id"]

    project_response = client.post(
        "/api/projects",
        json={
            "name": "Security Matrix",
            "client_id": client_id,
            "manager_ids": [manager_a.id, manager_b.id],
            "member_ids": [member.id],
        },
        headers=owner_headers,
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["id"]

    manager_b_update = client.patch(
        f"/api/projects/{project_id}",
        json={"description": "second manager update"},
        headers=_auth(manager_b_token),
    )
    assert manager_b_update.status_code == 200, manager_b_update.text

    outsider_update = client.patch(
        f"/api/projects/{project_id}",
        json={"description": "not my project"},
        headers=_auth(outsider_token),
    )
    assert outsider_update.status_code == 404

    member_membership_change = client.put(
        f"/api/projects/{project_id}/members",
        json={"manager_ids": [manager_a.id], "member_ids": [member.id]},
        headers=_auth(member_token),
    )
    assert member_membership_change.status_code == 403

    cross_tenant_get = client.get(f"/api/projects/{project_id}", headers=_auth(other_tenant_token))
    assert cross_tenant_get.status_code == 404


def test_phase13_lifecycle_mutations_emit_append_only_audit_events():
    tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = _create_user(models.RoleEnum.MANAGER, tenant)
    member, _ = _create_user(models.RoleEnum.USER, tenant)
    headers = _auth(owner_token)

    client_response = client.post("/api/clients", json={"company_name": "Audit Client"}, headers=headers)
    assert client_response.status_code == 201, client_response.text
    client_id = client_response.json()["id"]
    updated_client = client.patch(f"/api/clients/{client_id}", json={"country": "India"}, headers=headers)
    assert updated_client.status_code == 200, updated_client.text

    contact_response = client.post(
        "/api/contacts",
        json={
            "first_name": "Audit",
            "last_name": "Contact",
            "email": "audit-contact@example.com",
            "client_links": [{"client_id": client_id, "is_primary": True}],
        },
        headers=headers,
    )
    assert contact_response.status_code == 201, contact_response.text
    contact_id = contact_response.json()["id"]
    remove_link = client.delete(f"/api/contacts/{contact_id}/clients/{client_id}", headers=headers)
    assert remove_link.status_code == 204, remove_link.text

    project_response = client.post(
        "/api/projects",
        json={
            "name": "Audit Project",
            "client_id": client_id,
            "manager_ids": [manager.id],
            "member_ids": [member.id],
        },
        headers=headers,
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["id"]
    replace_members = client.put(
        f"/api/projects/{project_id}/members",
        json={"manager_ids": [manager.id], "member_ids": [member.id, owner.id]},
        headers=headers,
    )
    assert replace_members.status_code == 200, replace_members.text

    db = TestingSessionLocal()
    try:
        events = db.query(models.AuditEvent).order_by(models.AuditEvent.created_at.asc()).all()
        event_types = {event.event_type for event in events}
        assert {
            "client.created",
            "client.updated",
            "contact.created",
            "contact.client_link.added",
            "contact.client_link.removed",
            "project.created",
            "project.members_replaced",
        }.issubset(event_types)
        assert all("password" not in str(event.payload).lower() for event in events)
        assert all("token" not in str(event.payload).lower() for event in events)
    finally:
        db.close()


def test_phase13_adversarial_legacy_task_idor_and_group_bola_are_tenant_scoped():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    owner_a, _ = _create_user(models.RoleEnum.OWNER, tenant_a)
    owner_b, owner_b_token = _create_user(models.RoleEnum.OWNER, tenant_b)
    shared_group_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    try:
        foreign_task = models.Task(
            title="Foreign legacy task",
            description="Historical projectless task from another tenant",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="General",
            task_group_id=shared_group_id,
            created_by_id=owner_a.id,
        )
        own_task = models.Task(
            title="Own grouped task",
            description="Tenant-local task sharing a group id",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="General",
            task_group_id=shared_group_id,
            created_by_id=owner_b.id,
        )
        db.add_all([foreign_task, own_task])
        db.commit()
        foreign_task_id = foreign_task.id
        own_task_id = own_task.id
    finally:
        db.close()

    headers = _auth(owner_b_token)
    direct = client.get(f"/api/tasks/{foreign_task_id}", headers=headers)
    assert direct.status_code == 404

    listed = client.get("/api/tasks", headers=headers)
    assert listed.status_code == 200, listed.text
    listed_ids = {item["id"] for item in listed.json()}
    assert own_task_id in listed_ids
    assert foreign_task_id not in listed_ids

    grouped = client.get(f"/api/tasks/{own_task_id}/group", headers=headers)
    assert grouped.status_code == 200, grouped.text
    grouped_ids = {item["id"] for item in grouped.json()}
    assert own_task_id in grouped_ids
    assert foreign_task_id not in grouped_ids


def test_phase13_adversarial_timer_impersonation_hides_cross_tenant_entries():
    tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()
    owner, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    peer, peer_token = _create_user(models.RoleEnum.USER, tenant)
    _, foreign_token = _create_user(models.RoleEnum.OWNER, other_tenant)

    db = TestingSessionLocal()
    try:
        task = models.Task(
            title="Timer owner task",
            description="Timer target",
            status=models.TaskStatusEnum.TODO,
            priority=models.TaskPriorityEnum.MEDIUM,
            team="General",
            created_by_id=owner.id,
        )
        db.add(task)
        db.flush()
        entry = models.TimeEntry(
            tenant_id=tenant,
            user_id=owner.id,
            task_id=task.id,
            started_at=datetime.now(timezone.utc),
            status=models.TimeEntryStatusEnum.ACTIVE,
        )
        db.add(entry)
        db.commit()
        entry_id = entry.id
    finally:
        db.close()

    same_tenant_peer = client.post(f"/api/time-entries/{entry_id}/stop", headers=_auth(peer_token))
    assert same_tenant_peer.status_code == 403

    foreign_owner = client.post(f"/api/time-entries/{entry_id}/stop", headers=_auth(foreign_token))
    assert foreign_owner.status_code == 404

    owner_stop = client.post(f"/api/time-entries/{entry_id}/stop", headers=_auth(owner_token))
    assert owner_stop.status_code == 200, owner_stop.text


def test_phase13_adversarial_media_library_is_tenant_scoped_and_provider_status_is_protected():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    owner_a, _ = _create_user(models.RoleEnum.OWNER, tenant_a)
    owner_b, owner_b_token = _create_user(models.RoleEnum.OWNER, tenant_b)
    user_b, user_b_token = _create_user(models.RoleEnum.USER, tenant_b)

    db = TestingSessionLocal()
    try:
        item = models.MediaItem(
            owner_id=owner_a.id,
            filename="foreign.png",
            ext="png",
            mime_type="image/png",
            size_bytes=8,
            category=models.MediaCategoryEnum.IMAGE,
            storage_provider=models.StorageProviderEnum.LOCAL,
            storage_path="uploads/foreign.png",
            public_url="/uploads/foreign.png",
            checksum_sha256="abc",
        )
        media_file = models.MediaFile(
            user_id=owner_a.id,
            media_type=models.MediaFileTypeEnum.IMAGE,
            bucket="bucket",
            object_key="tenant-a/foreign.png",
            original_filename="foreign.png",
            content_type="image/png",
            size_bytes=8,
            status=models.MediaFileStatusEnum.CONFIRMED,
        )
        db.add_all([item, media_file])
        db.commit()
        item_id = item.id
        media_file_id = media_file.id
    finally:
        db.close()

    owner_b_headers = _auth(owner_b_token)
    listed = client.get("/api/media", headers=owner_b_headers)
    assert listed.status_code == 200, listed.text
    assert item_id not in {entry["id"] for entry in listed.json()["items"]}

    foreign_get = client.get(f"/api/media/{item_id}", headers=owner_b_headers)
    assert foreign_get.status_code == 404

    foreign_delete = client.delete(f"/api/media/{media_file_id}", headers=owner_b_headers)
    assert foreign_delete.status_code == 404

    anonymous_provider_probe = client.post("/api/media/external/connect", json={"provider": "local"})
    assert anonymous_provider_probe.status_code == 401

    non_admin_probe = client.post(
        "/api/media/external/connect",
        json={"provider": "local"},
        headers=_auth(user_b_token),
    )
    assert non_admin_probe.status_code == 403


def test_phase13_adversarial_notification_idor_and_bulk_audit_are_recipient_scoped():
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    user_a, _ = _create_user(models.RoleEnum.USER, tenant_a)
    user_b, user_b_token = _create_user(models.RoleEnum.USER, tenant_b)

    db = TestingSessionLocal()
    try:
        foreign_notification = models.Notification(
            tenant_id=tenant_a,
            user_id=user_a.id,
            type=models.NotificationTypeEnum.TASK_UPDATED,
            title="Foreign",
            body="Foreign tenant notification",
            message="Foreign tenant notification",
        )
        own_notification = models.Notification(
            tenant_id=tenant_b,
            user_id=user_b.id,
            type=models.NotificationTypeEnum.TASK_UPDATED,
            title="Own",
            body="Own notification",
            message="Own notification",
        )
        db.add_all([foreign_notification, own_notification])
        db.commit()
        foreign_id = foreign_notification.id
        own_id = own_notification.id
    finally:
        db.close()

    headers = _auth(user_b_token)
    read_foreign = client.post(f"/api/notifications/{foreign_id}/read", headers=headers)
    assert read_foreign.status_code == 404
    delete_foreign = client.delete(f"/api/notifications/{foreign_id}", headers=headers)
    assert delete_foreign.status_code == 404

    bulk = client.post("/api/notifications/read", json=[foreign_id, own_id], headers=headers)
    assert bulk.status_code == 204, bulk.text

    db = TestingSessionLocal()
    try:
        refreshed_foreign = db.get(models.Notification, foreign_id)
        refreshed_own = db.get(models.Notification, own_id)
        assert refreshed_foreign is not None and refreshed_foreign.is_read is False
        assert refreshed_own is not None and refreshed_own.is_read is True
        audit = (
            db.query(models.AuditEvent)
            .filter(models.AuditEvent.event_type == "notifications.read")
            .order_by(models.AuditEvent.created_at.desc())
            .first()
        )
        assert audit is not None
        assert audit.payload["notification_ids"] == [own_id]
    finally:
        db.close()
