"""Regression for seeded-task updates on an older PostgreSQL notification enum."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import literal, select, text

from backend.app import models
from backend.app.auth import create_access_token
from backend.app.database import get_db
from backend.app.routers import tasks
from backend.app.services.notification_schema import ensure_notification_enum_values, notification_enum_gaps
from backend.app.services import audit_logger, notification_dispatcher
from backend.tests.test_task_lifecycle import data, engine


def legacy_enums(engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL enum compatibility regression")
    with engine.begin() as connection:
        for column in (models.Notification.__table__.c.type, models.Notification.__table__.c.entity_type):
            enum = column.type
            labels = [value for value in enum.enums
                      if not value.startswith(("SUBTASK_", "PROJECT_", "CLIENT_"))
                      and value not in {"MENTION", "subtask", "project", "client"}]
            labels.append("LEGACY_CUSTOM")
            serialized = ",".join(str(literal(value).compile(dialect=connection.dialect, compile_kwargs={"literal_binds": True})) for value in labels)
            connection.exec_driver_sql(f"CREATE TYPE {enum.name}_legacy AS ENUM ({serialized})")
            connection.exec_driver_sql(f"ALTER TABLE notifications ALTER COLUMN {column.name} TYPE {enum.name}_legacy USING {column.name}::text::{enum.name}_legacy")
            connection.exec_driver_sql(f"DROP TYPE {enum.name}")
            connection.exec_driver_sql(f"ALTER TYPE {enum.name}_legacy RENAME TO {enum.name}")


def test_legacy_subtask_reassignment_rolls_back_then_succeeds_after_repair(data, engine, monkeypatch):
    legacy_enums(engine)
    with data.factory() as db:
        db.get(models.User, data.owner.id).email = f"{uuid4()}@example.com"
        worker = models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name="Synthetic worker",
                             email=f"{uuid4()}@example.com", hashed_password="not-a-login", role=models.RoleEnum.USER,
                             status=models.UserStatusEnum.ACTIVE)
        db.add(worker)
        db.commit()
        worker_id = worker.id
    app = FastAPI()
    app.include_router(tasks.router, prefix="/api")
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(tasks, "_schedule_notification_outbox_delivery", lambda *_args: None)
    monkeypatch.setattr(tasks, "_invalidate_task_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tasks, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(audit_logger, "log_event", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher.push_service, "send_push", lambda *_args, **_kwargs: 0)
    token = create_access_token(data.owner.id, extra_claims={"tenant_id": str(data.owner.tenant_id)})
    headers = {"Authorization": "Bearer " + token}
    url = f"/api/tasks/{data.task.id}/subtasks/{data.child.id}"
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.patch(url, json={"assigned_to_id": worker_id}, headers=headers).status_code == 500
        with data.factory() as db:
            assert db.get(models.Subtask, data.child.id).assigned_to_id == data.owner.id
            assert not db.scalars(select(models.Notification)).all()
        with engine.begin() as connection:
            added = ensure_notification_enum_values(connection)
        assert "SUBTASK_REASSIGNED" in added["notificationtypeenum"]
        assert set(added["notification_entity_type_enum"]) == {"subtask", "project", "client"}
        assert {"PROJECT_CREATED", "PROJECT_UPDATED", "CLIENT_CREATED", "CLIENT_UPDATED"} <= set(added["notificationtypeenum"])
        with TestClient(app) as strict_client:
            response = strict_client.patch(url, json={"assigned_to_id": worker_id}, headers=headers)
        assert response.status_code == 200, response.text
        forbidden = client.patch(url, json={"assigned_to_id": data.outsider.id}, headers=headers)
        assert forbidden.status_code in {400, 403, 404}
    with data.factory() as db:
        assert db.get(models.Subtask, data.child.id).assigned_to_id == worker_id
        notification = db.scalar(select(models.Notification))
        assert notification.type == models.NotificationTypeEnum.SUBTASK_REASSIGNED
        assert notification.entity_type == models.NotificationEntityTypeEnum.SUBTASK
        assert notification.entity_id == data.child.id and notification.tenant_id == data.owner.tenant_id
        assert db.get(models.User, data.owner.id).points == 125
    with engine.begin() as connection:
        assert ensure_notification_enum_values(connection) == {}
        assert connection.scalar(text("SELECT 'LEGACY_CUSTOM'::notificationtypeenum::text")) == "LEGACY_CUSTOM"


def test_concurrent_enum_bootstrap_is_additive_and_idempotent(engine):
    legacy_enums(engine)
    def repair(_):
        with engine.begin() as connection:
            return sum(map(len, ensure_notification_enum_values(connection).values()))
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(repair, range(2))) == [0, 14]
    with engine.connect() as connection:
        assert notification_enum_gaps(connection) == {}


def test_current_metadata_needs_no_enum_repair(engine):
    with engine.begin() as connection:
        assert ensure_notification_enum_values(connection) == {}


def test_project_client_migration_is_additive_and_repeatable(engine, monkeypatch):
    from importlib import import_module
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    legacy_enums(engine)
    migration = import_module("backend.alembic.versions.ff9c0d1e2f3a_project_client_notifications")
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        for _ in range(2):
            migration.upgrade()
        missing = notification_enum_gaps(connection)
        assert not any(value.startswith(("PROJECT_", "CLIENT_")) for value in missing["notificationtypeenum"])
        assert set(missing["notification_entity_type_enum"]) == {"subtask"}
        assert connection.scalar(text("SELECT 'LEGACY_CUSTOM'::notificationtypeenum::text")) == "LEGACY_CUSTOM"


def test_notification_bootstrap_commits_before_seed():
    from pathlib import Path
    source = (Path(__file__).parents[1] / "app/main.py").read_text()
    initialize = source.split("def initialize_schema() -> None:", 1)[1]
    assert initialize.index("ensure_notification_table_schema()") < initialize.index("seed_database()")
