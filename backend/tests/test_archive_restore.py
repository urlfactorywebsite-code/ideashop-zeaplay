"""Restore authorization, preservation and real database concurrency contracts."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from backend.app import models, schemas
from backend.app.routers.clients import router as client_router
from backend.app.routers.projects import router as project_router
from backend.app.services import clients, projects
from backend.tests.test_task_lifecycle import NOW, api, auth, data, engine  # noqa: F401


@pytest.fixture
def records(data, api):
    api.app.include_router(client_router, prefix="/api")
    api.app.include_router(project_router, prefix="/api")
    with data.factory() as db:
        customer = models.Client(tenant_id=data.owner.tenant_id, company_name="Restore Client",
            normalized_company_name="restore client", gst_number="29ABCDE1234F1Z5", notes="Retained notes",
            address_line1="Original address", created_by_id=data.owner.id)
        db.add(customer); db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=customer.id, name="Restore Project",
            normalized_name="restore project", description="Retained project", created_by_id=data.owner.id)
        db.add(project); db.flush()
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id,
            user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MANAGER))
        db.get(models.Task, data.task.id).project_id = project.id
        child = db.get(models.Subtask, data.child.id)
        child.status = models.SubtaskStatusEnum.DONE
        other = models.Subtask(task_id=data.task.id, title="Dependent retained work", assigned_to_id=data.owner.id)
        db.add(other); db.flush()
        db.add(models.SubtaskDependency(task_id=data.task.id, subtask_id=other.id, depends_on_subtask_id=child.id))
        db.add(models.Comment(task_id=data.task.id, user_id=data.owner.id, content="Keep this comment"))
        db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id, subtask_id=child.id,
            started_at=NOW, stopped_at=NOW + timedelta(seconds=30), duration_seconds=30,
            status=models.TimeEntryStatusEnum.STOPPED, stop_reason="paused"))
        contact = models.Contact(tenant_id=data.owner.tenant_id, first_name="Keep", display_name="Keep Contact",
            normalized_name="keep contact", notes="Contact notes")
        db.add(contact); db.flush()
        db.add(models.ClientContact(tenant_id=data.owner.tenant_id, client_id=customer.id, contact_id=contact.id, is_primary=True))
        db.commit()
        return SimpleNamespace(client=customer.id, project=project.id)


def retained(db):
    names = (models.ProjectMember, models.Task, models.Subtask, models.SubtaskDependency,
        models.Comment, models.TimeEntry, models.Contact, models.ClientContact,
        models.CompletionAttachment, models.TaskLifecycleEvent, models.TaskLifecycleCoverage)
    return {model.__tablename__: db.execute(select(model.__table__).order_by(*model.__table__.primary_key.columns)).all()
            for model in names}


def transition(api, data, records, kind, action):
    return api.post(f"/api/{kind}s/{getattr(records, kind)}/{action}", headers=auth(data.owner))


@pytest.mark.parametrize("kind", ["client", "project"])
def test_archive_find_restore_preserves_business_records_and_is_idempotent(data, api, records, kind):
    model = models.Client if kind == "client" else models.Project
    def metadata(db):
        row = dict(db.execute(select(model.__table__).where(model.id == getattr(records, kind))).mappings().one())
        return {key: value for key, value in row.items() if key not in
            {"status", "archived_at", "archived_by_id", "updated_at", "updated_by_id"}}
    with data.factory() as db:
        original = retained(db)
        original_metadata = metadata(db)
    archived = transition(api, data, records, kind, "archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "ARCHIVED"
    listed = api.get(f"/api/{kind}s?status=ARCHIVED&q=Restore&page_size=1", headers=auth(data.owner)).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == getattr(records, kind)
    restored = transition(api, data, records, kind, "restore")
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["id"] == getattr(records, kind) and body["status"] == "ACTIVE"
    assert body["archived_at"] is None and body["archived_by_id"] is None
    assert transition(api, data, records, kind, "restore").json() == body
    assert api.get(f"/api/{kind}s?status=ARCHIVED", headers=auth(data.owner)).json()["total"] == 0
    assert api.get(f"/api/{kind}s?status=ACTIVE", headers=auth(data.owner)).json()["total"] == 1
    with data.factory() as db:
        assert retained(db) == original
        assert metadata(db) == original_metadata
        events = db.scalars(select(models.AuditEvent).where(models.AuditEvent.entity_id == body["id"])
                            .order_by(models.AuditEvent.created_at)).all()
        assert [row.event_type for row in events] == [f"{kind}.archived", f"{kind}.restored"]
        assert all(row.actor_id == data.owner.id and row.created_at and row.payload["tenant_id"] == str(data.owner.tenant_id) for row in events)
        assert events[1].payload["previous_state"]["archived_at"] == archived.json()["archived_at"]
        assert events[1].payload["previous_state"]["status"] == "ARCHIVED"
        assert events[1].payload["new_state"]["status"] == "ACTIVE"


def test_client_restore_does_not_cascade_and_project_requires_active_client(data, api, records):
    assert transition(api, data, records, "project", "archive").status_code == 200
    assert transition(api, data, records, "client", "archive").status_code == 200
    denied = transition(api, data, records, "project", "restore")
    assert denied.status_code == 409 and "linked client" in denied.json()["detail"]
    assert transition(api, data, records, "client", "restore").status_code == 200
    with data.factory() as db:
        assert db.get(models.Project, records.project).status == models.ProjectStatusEnum.ARCHIVED
        assert len(db.scalars(select(models.ClientContact)).all()) == 1
    assert transition(api, data, records, "project", "restore").status_code == 200


@pytest.mark.parametrize("role,expected", [(models.RoleEnum.OWNER, 200), (models.RoleEnum.ADMIN, 200),
    (models.RoleEnum.MANAGER, 200), (models.RoleEnum.USER, 403)])
def test_restore_management_roles_and_tenant_boundary(data, api, records, role, expected):
    for kind in ("client", "project"):
        assert transition(api, data, records, kind, "archive").status_code == 200
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = role; db.commit()
    for kind in ("client", "project"):
        url = f"/api/{kind}s/{getattr(records, kind)}/restore"
        assert api.post(url).status_code == 401
        assert api.post(url, headers=auth(data.outsider)).status_code == 404
        assert api.post(url, headers=auth(data.owner)).status_code == expected


def test_unassigned_manager_cannot_restore_project_even_if_readable(data, api, records):
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = models.RoleEnum.MANAGER
        db.scalar(select(models.ProjectMember)).role = models.ProjectMemberRoleEnum.MEMBER
        db.commit()
    response = transition(api, data, records, "project", "restore")
    assert response.status_code == 403


def test_restore_requires_active_manager_without_reassigning_anyone(data, api, records):
    transition(api, data, records, "project", "archive")
    with data.factory() as db:
        # Keep owner authorization, but remove the sole manager membership.
        member = db.scalar(select(models.ProjectMember)); member.role = models.ProjectMemberRoleEnum.MEMBER
        db.commit(); before = retained(db)
    response = transition(api, data, records, "project", "restore")
    assert response.status_code == 409 and "active project manager" in response.json()["detail"]
    with data.factory() as db: assert retained(db) == before


@pytest.mark.parametrize("collision", ["name", "gst"])
def test_restoring_conflicting_client_rolls_back_without_losing_archive(data, api, records, collision):
    transition(api, data, records, "client", "archive")
    with data.factory() as db:
        original = db.get(models.Client, records.client)
        db.add(models.Client(tenant_id=original.tenant_id, company_name="Restore Client" if collision == "name" else "Other",
            normalized_company_name=original.normalized_company_name if collision == "name" else "other",
            gst_number=original.gst_number if collision == "gst" else None))
        db.commit()
    response = transition(api, data, records, "client", "restore")
    assert response.status_code == 409
    with data.factory() as db:
        assert db.get(models.Client, records.client).status == models.ClientStatusEnum.ARCHIVED
        assert not db.scalars(select(models.AuditEvent).where(models.AuditEvent.event_type == "client.restored")).all()


def test_simultaneous_restores_of_conflicting_clients_allow_one_active_record(data, api, records):
    transition(api, data, records, "client", "archive")
    with data.factory() as db:
        second = models.Client(tenant_id=data.owner.tenant_id, company_name="Restore Client",
            normalized_company_name="restore client", status=models.ClientStatusEnum.ARCHIVED)
        db.add(second); db.commit(); ids = [records.client, second.id]
    barrier = Barrier(2)
    def attempt(identifier):
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            barrier.wait(timeout=15)
            try:
                clients.restore_client(db, tenant_id=actor.tenant_id, client_id=identifier, actor=actor)
                return 200
            except HTTPException as error:
                assert error.status_code == 409
                return 409
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, ids)) == [200, 409]
    with data.factory() as db:
        assert len(db.scalars(select(models.Client).where(models.Client.status == models.ClientStatusEnum.ACTIVE)).all()) == 1
        assert len(db.scalars(select(models.AuditEvent).where(models.AuditEvent.event_type == "client.restored")).all()) == 1


@pytest.mark.parametrize("kind", ["client", "project"])
@pytest.mark.parametrize("action", ["archive", "restore"])
def test_six_concurrent_transitions_create_one_event(data, api, records, kind, action):
    if action == "restore": transition(api, data, records, kind, "archive")
    barrier = Barrier(6)
    service = clients if kind == "client" else projects
    def attempt(_):
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            barrier.wait(timeout=20)
            kwargs = {"tenant_id": actor.tenant_id, f"{kind}_id": getattr(records, kind), "actor": actor}
            if action == "archive": kwargs["payload"] = schemas.ClientArchive() if kind == "client" else schemas.ProjectArchive()
            row = getattr(service, f"{action}_{kind}")(db, **kwargs)
            return row.id, row.status.value
    with ThreadPoolExecutor(max_workers=6) as pool: results = list(pool.map(attempt, range(6)))
    assert set(results) == {(getattr(records, kind), "ACTIVE" if action == "restore" else "ARCHIVED")}
    with data.factory() as db:
        event_type = f"{kind}.archived" if action == "archive" else f"{kind}.restored"
        events = db.scalars(select(models.AuditEvent).where(models.AuditEvent.event_type == event_type)).all()
        assert len(events) == 1


@pytest.mark.parametrize("kind", ["client", "project"])
def test_audit_failure_rolls_back_restore_with_original_history(data, api, records, monkeypatch, kind):
    transition(api, data, records, kind, "archive")
    from backend.app.services import archive_state
    def fail(*args, **kwargs): raise RuntimeError("synthetic audit failure")
    monkeypatch.setattr(archive_state, "audit_transition", fail)
    with pytest.raises(RuntimeError, match="synthetic audit"):
        transition(api, data, records, kind, "restore")
    with data.factory() as db:
        model = models.Client if kind == "client" else models.Project
        assert db.get(model, getattr(records, kind)).status.value == "ARCHIVED"
        assert len(db.scalars(select(models.AuditEvent)).all()) == 1


def test_postgres_client_archive_wins_before_project_restore_dependency_check(data, engine, api, records):
    if engine.dialect.name != "postgresql": pytest.skip("PostgreSQL shared client row lock")
    transition(api, data, records, "project", "archive")
    waiting = Event()
    def query(connection, cursor, statement, *args):
        if "FOR SHARE" in statement: waiting.set()
    def restore():
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            try:
                projects.restore_project(db, tenant_id=actor.tenant_id, project_id=records.project, actor=actor)
                return 200
            except HTTPException as error: return error.status_code
    with data.factory() as holder:
        customer = holder.scalar(select(models.Client).where(models.Client.id == records.client).with_for_update())
        event.listen(engine, "before_cursor_execute", query)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                attempt = pool.submit(restore)
                try:
                    assert waiting.wait(timeout=15)
                    customer.status = models.ClientStatusEnum.ARCHIVED
                finally: holder.commit()
                assert attempt.result(timeout=20) == 409
        finally: event.remove(engine, "before_cursor_execute", query)
