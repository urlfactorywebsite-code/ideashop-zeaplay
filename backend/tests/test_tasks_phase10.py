import uuid
from cryptography.fernet import Fernet
from backend.app.config import get_settings
from backend.app.services import smtp_security
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import email_utils, models
from backend.app.database import get_db
from backend.app.routers import notifications as notifications_router
from backend.app.routers import tasks as tasks_module
from backend.app.services import audit_logger, notification_dispatcher, notification_outbox
from backend.app.services import subtask_notifications
from backend.app.services.subtask_workflow import WorkflowDomainEvent
from backend.tests.test_tasks_phase5 import (
    TestingSessionLocal,
    _create_user,
    client,
    override_get_db,
)
from backend.tests.test_tasks_phase6 import _token_for_existing_user
from backend.tests.test_tasks_phase7 import _subtask, _workflow_task


notification_app = FastAPI()
notification_app.include_router(notifications_router.router, prefix="/api")
notification_app.dependency_overrides[get_db] = override_get_db
notification_client = TestClient(notification_app)


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(models.NotificationOutbox).delete()
        db.query(models.TaskTransferRequest).delete()
        db.query(models.Notification).delete()
        db.query(models.AuditEvent).delete()
        db.query(models.TimeEntry).delete()
        db.query(models.CompletionAttachment).delete()
        db.query(models.CompletionSubmission).delete()
        db.query(models.SubtaskWorkflowEvent).delete()
        db.query(models.SubtaskDependency).delete()
        db.query(models.Subtask).delete()
        db.query(models.Task).delete()
        db.query(models.ProjectMember).delete()
        db.query(models.Project).delete()
        db.query(models.Client).delete()
        db.query(models.User).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def disable_external_side_effects(monkeypatch):
    monkeypatch.setattr(get_settings(), "smtp_secret_keys", [Fernet.generate_key().decode()])
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "_schedule_notification_outbox_delivery", lambda *args, **kwargs: None)


def test_subtask_activation_creates_deduped_in_app_and_email_outbox_records():
    _, owner_token, _, member, task = _workflow_task()
    headers = {"Authorization": f"Bearer {owner_token}"}
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")

    completed = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert completed.status_code == 200, completed.text

    duplicate = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    )
    assert duplicate.status_code == 200, duplicate.text

    db = TestingSessionLocal()
    try:
        notifications = db.query(models.Notification).filter(
            models.Notification.user_id == member.id,
            models.Notification.type == models.NotificationTypeEnum.SUBTASK_ACTIVATED,
        ).all()
        assert len(notifications) == 1
        assert notifications[0].tenant_id is not None
        assert notifications[0].related_task_id == task["id"]
        assert notifications[0].entity_id == successor["id"]

        outbox = db.query(models.NotificationOutbox).filter(
            models.NotificationOutbox.recipient_user_id == member.id,
            models.NotificationOutbox.event_type == "SUBTASK_ACTIVATED",
        ).all()
        assert len(outbox) == 1
        assert outbox[0].status == models.NotificationOutboxStatusEnum.PENDING
        assert outbox[0].payload["to_address"] == member.email
        assert "Client" not in outbox[0].payload["subject"]
    finally:
        db.close()


def test_email_retry_failure_does_not_undo_completed_workflow(monkeypatch):
    _, owner_token, _, member, task = _workflow_task()
    predecessor = _subtask(task, "Predecessor")
    response = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 200, response.text

    attempts = {"count": 0}

    def flaky_send(**kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise email_utils.EmailDeliveryError('temporary_failure', retryable=True)

    monkeypatch.setattr(email_utils, "send_notification_email", flaky_send)

    with TestingSessionLocal() as db:
        assert notification_outbox._run_due_notification_outbox(db, limit=10) == 1
        failed = db.query(models.NotificationOutbox).filter_by(recipient_user_id=member.id).one()
        assert failed.status == models.NotificationOutboxStatusEnum.FAILED
        assert failed.attempts == 1
        assert failed.next_attempt_at is not None
        assert "password" not in failed.last_error.lower()
        assert "secret" not in failed.last_error.lower()
        assert "token" not in failed.last_error.lower()
        db.get(models.Task, task["id"])
        assert db.get(models.Subtask, predecessor["id"]).status == models.SubtaskStatusEnum.DONE

        failed.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
        assert notification_outbox._run_due_notification_outbox(db, limit=10) == 1
        sent = db.get(models.NotificationOutbox, failed.id)
        assert sent.status == models.NotificationOutboxStatusEnum.SENT
        assert sent.attempts == 2


def test_delayed_worker_execution_and_duplicate_delivery_are_safe(monkeypatch):
    _, owner_token, _, member, task = _workflow_task()
    predecessor = _subtask(task, "Predecessor")
    completed = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert completed.status_code == 200, completed.text

    deliveries: list[str] = []

    def record_send(**kwargs):
        deliveries.append(kwargs["to_address"])

    monkeypatch.setattr(email_utils, "send_notification_email", record_send)

    with TestingSessionLocal() as db:
        pending = db.query(models.NotificationOutbox).filter_by(recipient_user_id=member.id).one()
        assert pending.status == models.NotificationOutboxStatusEnum.PENDING
        assert deliveries == []

        assert notification_outbox._run_due_notification_outbox(db, limit=10) == 1
        assert notification_outbox._run_due_notification_outbox(db, limit=10) == 0
        sent = db.get(models.NotificationOutbox, pending.id)
        assert sent.status == models.NotificationOutboxStatusEnum.SENT
        assert sent.attempts == 1
        assert deliveries == [member.email]


def test_stale_sending_rows_are_held_without_blind_resend(monkeypatch):
    _, owner_token, _, member, task = _workflow_task()
    predecessor = _subtask(task, "Predecessor")
    completed = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert completed.status_code == 200, completed.text

    deliveries: list[str] = []
    monkeypatch.setattr(email_utils, "send_notification_email", lambda **kwargs: deliveries.append(kwargs["to_address"]))

    with TestingSessionLocal() as db:
        outbox = db.query(models.NotificationOutbox).filter_by(recipient_user_id=member.id).one()
        outbox.status = models.NotificationOutboxStatusEnum.SENDING
        outbox.updated_at = datetime.utcnow() - timedelta(seconds=notification_outbox.STALE_SENDING_SECONDS + 1)
        db.commit()

        assert notification_outbox._run_due_notification_outbox(db, limit=10) == 0
        recovered = db.get(models.NotificationOutbox, outbox.id)
        assert recovered.delivery_state == 'uncertain'
        assert recovered.next_attempt_at is None
        assert deliveries == []


def test_email_failure_audit_redacts_provider_error_and_recipient(monkeypatch):
    smtp_tenant = uuid.uuid4()
    captured: list[audit_logger.AuditLogInput] = []
    monkeypatch.setattr(audit_logger, "log_event", lambda entry: captured.append(entry))

    def failing_send(**kwargs):
        raise email_utils.EmailDeliveryError("SMTP password secret token leaked from provider")

    monkeypatch.setattr(email_utils, "_send_email_with_config", failing_send)

    with TestingSessionLocal() as db:
        db.add(
            models.SmtpConfig(
                id=1,
                tenant_id=smtp_tenant, notification_types=["task_updates"], is_enabled=True,
                host="smtp.example.test",
                port=587,
                username="mailer@example.test",
                password=smtp_security.encrypt_secret("configured-synthetic"),
                encryption="tls",
            )
        )
        db.commit()

        with pytest.raises(email_utils.EmailDeliveryError):
            email_utils.send_notification_email(
                db=db,
                notification_type="SUBTASK_ACTIVATED", tenant_id=smtp_tenant,
                to_address="person@example.com",
                subject="Sensitive project subject",
                body="Sensitive client details",
            )

    assert captured
    entry = captured[-1]
    assert entry.action == "EMAIL_FAILED"
    assert "password" not in (entry.reason or "").lower()
    assert "secret" not in (entry.reason or "").lower()
    assert "token" not in (entry.reason or "").lower()
    assert entry.metadata == {
        "notification_type": "SUBTASK_ACTIVATED",
        "to_domain": "example.com",
        "provider": "smtp",
    }


def test_inactive_and_cross_tenant_recipients_are_not_notified():
    tenant, owner_token, _, member, task = _workflow_task()
    predecessor = _subtask(task, "Predecessor")

    db = TestingSessionLocal()
    try:
        notification_count_before_deactivation = db.query(models.Notification).filter_by(user_id=member.id).count()
        db_member = db.get(models.User, member.id)
        db_member.status = models.UserStatusEnum.DEACTIVATED
        db.commit()
    finally:
        db.close()

    completed = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert completed.status_code == 200, completed.text

    db = TestingSessionLocal()
    try:
        assert db.query(models.Notification).filter_by(user_id=member.id).count() == notification_count_before_deactivation
        assert db.query(models.NotificationOutbox).filter_by(recipient_user_id=member.id).count() == 0

        other_tenant_user, _ = _create_user(models.RoleEnum.USER, uuid.uuid4())
        db_task = db.get(models.Task, task["id"])
        successor = db.query(models.Subtask).filter_by(title="Successor").one()
        successor.assigned_to_id = other_tenant_user.id
        db.commit()
        subtask_notifications.enqueue_workflow_notifications(
            db,
            task=db_task,
            events=[
                WorkflowDomainEvent(
                    event_type="SUBTASK_ACTIVATED",
                    task_id=task["id"],
                    subtask_id=successor.id,
                    from_status=models.SubtaskStatusEnum.WAITING.value,
                    to_status=models.SubtaskStatusEnum.TODO.value,
                )
            ],
        )
        db.commit()
        assert db.query(models.Notification).filter_by(user_id=other_tenant_user.id).count() == 0
        assert db.query(models.NotificationOutbox).filter_by(recipient_user_id=other_tenant_user.id).count() == 0
        assert str(other_tenant_user.tenant_id) != str(tenant)
    finally:
        db.close()


def test_replayed_successor_activation_deduplicates_notifications():
    _, _, _, member, task = _workflow_task()
    successor = _subtask(task, "Successor")
    event = WorkflowDomainEvent(
        event_type="SUBTASK_ACTIVATED",
        task_id=task["id"],
        subtask_id=successor["id"],
        from_status=models.SubtaskStatusEnum.WAITING.value,
        to_status=models.SubtaskStatusEnum.TODO.value,
    )

    def emit_once():
        with TestingSessionLocal() as db:
            db_task = db.get(models.Task, task["id"])
            subtask_notifications.enqueue_workflow_notifications(db, task=db_task, events=[event])
            db.commit()

    emit_once()
    emit_once()

    db = TestingSessionLocal()
    try:
        assert db.query(models.Notification).filter(
            models.Notification.user_id == member.id,
            models.Notification.entity_id == successor["id"],
            models.Notification.type == models.NotificationTypeEnum.SUBTASK_ACTIVATED,
        ).count() == 1
        assert db.query(models.NotificationOutbox).filter(
            models.NotificationOutbox.recipient_user_id == member.id,
            models.NotificationOutbox.event_type == "SUBTASK_ACTIVATED",
        ).count() == 1
    finally:
        db.close()


def test_reopened_work_notifies_downstream_assignee_and_links_to_authorized_task():
    _, owner_token, _, member, task = _workflow_task()
    predecessor = _subtask(task, "Predecessor")
    successor = _subtask(task, "Successor")
    headers = {"Authorization": f"Bearer {owner_token}"}

    assert client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    ).status_code == 200
    assert client.patch(
        f"/api/tasks/{task['id']}/subtasks/{successor['id']}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=headers,
    ).status_code == 200
    reopened = client.patch(
        f"/api/tasks/{task['id']}/subtasks/{predecessor['id']}",
        json={"status": models.SubtaskStatusEnum.TODO.value},
        headers=headers,
    )
    assert reopened.status_code == 200, reopened.text

    db = TestingSessionLocal()
    try:
        notification = db.query(models.Notification).filter(
            models.Notification.user_id == member.id,
            models.Notification.entity_id == successor["id"],
            models.Notification.type == models.NotificationTypeEnum.SUBTASK_REVIEW_REQUIRED,
        ).one()
        assert notification.deep_link == f"/tasks/{task['id']}"
        assert notification.related_task_id == task["id"]
    finally:
        db.close()

    authorized_navigation = client.get(
        f"/api/tasks/{task['id']}",
        headers={"Authorization": f"Bearer {_token_for_existing_user(member.id, member.tenant_id)}"},
    )
    assert authorized_navigation.status_code == 200, authorized_navigation.text


def test_notification_apis_are_recipient_and_tenant_scoped():
    tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()
    user, token = _create_user(models.RoleEnum.USER, tenant)
    other_user, other_token = _create_user(models.RoleEnum.USER, other_tenant)
    db = TestingSessionLocal()
    try:
        db.add(
            models.Notification(
                tenant_id=tenant,
                user_id=user.id,
                type=models.NotificationTypeEnum.SUBTASK_ACTIVATED,
                message="Your subtask is ready.",
                related_task_id=str(uuid.uuid4()),
            )
        )
        db.add(
            models.Notification(
                tenant_id=other_tenant,
                user_id=other_user.id,
                type=models.NotificationTypeEnum.SUBTASK_ACTIVATED,
                message="Other tenant notification.",
                related_task_id=str(uuid.uuid4()),
            )
        )
        db.commit()
    finally:
        db.close()

    headers = {"Authorization": f"Bearer {token}"}
    listed = notification_client.get("/api/notifications", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [item["message"] for item in listed.json()] == ["Your subtask is ready."]

    count = notification_client.get("/api/notifications/unread-count", headers=headers)
    assert count.status_code == 200
    assert count.json()["unread_count"] == 1

    notification_id = listed.json()[0]["id"]
    marked = notification_client.post(f"/api/notifications/{notification_id}/read", headers=headers)
    assert marked.status_code == 204
    count = notification_client.get("/api/notifications/unread-count", headers=headers)
    assert count.json()["unread_count"] == 0

    denied = notification_client.post(
        f"/api/notifications/{notification_id}/read",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert denied.status_code == 404
