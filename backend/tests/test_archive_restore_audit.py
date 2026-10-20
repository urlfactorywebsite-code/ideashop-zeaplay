"""Regression audit: stale updates, audit UTC, real row waits and rich history."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event
import hashlib
import time
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy import event, select, text, update

from backend.app import models, schemas
from backend.app.services import clients, projects
from backend.tests.test_task_lifecycle import api, auth, data, engine  # noqa: F401
from backend.tests.test_archive_restore import records, retained, transition  # noqa: F401


def test_stale_update_cannot_desynchronize_client_name_and_normalization(data, records):
    with data.factory() as reader:
        cached = clients.get_client(reader, tenant_id=data.owner.tenant_id, client_id=records.client)
        assert cached.company_name == "Restore Client"
        with data.factory() as writer:
            clients.update_client(writer, tenant_id=data.owner.tenant_id, client_id=records.client,
                actor=writer.get(models.User, data.owner.id), payload=schemas.ClientUpdate(company_name="Renamed Company"))
        clients.update_client(reader, tenant_id=data.owner.tenant_id, client_id=records.client,
            actor=reader.get(models.User, data.owner.id), payload=schemas.ClientUpdate(notes="New note"))
    with data.factory() as db:
        current = db.get(models.Client, records.client)
        assert current.company_name == "Renamed Company"
        assert current.normalized_company_name == "renamed company"


@pytest.mark.parametrize("operation", ["update", "members"])
def test_cached_project_membership_cannot_authorize_revoked_manager(data, records, operation):
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = models.RoleEnum.MANAGER
        db.commit()
    with data.factory() as reader:
        actor = reader.get(models.User, data.owner.id)
        project = projects.get_project(reader, tenant_id=actor.tenant_id, project_id=records.project, actor=actor)
        assert project.members[0].role == models.ProjectMemberRoleEnum.MANAGER
        with data.factory() as writer:
            writer.execute(update(models.ProjectMember).where(models.ProjectMember.project_id == project.id)
                           .values(role=models.ProjectMemberRoleEnum.MEMBER))
            writer.commit()
        with pytest.raises(HTTPException) as denied:
            if operation == "update":
                projects.update_project(reader, tenant_id=actor.tenant_id, project_id=project.id, actor=actor,
                    payload=schemas.ProjectUpdate(description="Unauthorized edit"))
            else:
                projects.replace_project_members(reader, tenant_id=actor.tenant_id, project_id=project.id, actor=actor,
                    payload=schemas.ProjectMembershipInput(manager_ids=[actor.id], member_ids=[]))
        assert denied.value.status_code == 403


@pytest.mark.parametrize("kind", ["client", "project"])
@pytest.mark.parametrize("action", ["archive", "restore"])
def test_archive_audit_timestamp_is_utc_with_non_utc_postgres_session(data, records, engine, kind, action):
    if engine.dialect.name != "postgresql": pytest.skip("PostgreSQL session timezone")
    service = clients if kind == "client" else projects
    with data.factory() as db:
        actor = db.get(models.User, data.owner.id)
        kwargs = {"tenant_id": actor.tenant_id, f"{kind}_id": getattr(records, kind), "actor": actor}
        payload = schemas.ClientArchive() if kind == "client" else schemas.ProjectArchive()
        if action == "restore": getattr(service, f"archive_{kind}")(db, payload=payload, **kwargs)
        db.execute(text("SET LOCAL TIME ZONE 'Asia/Kolkata'"))
        before = datetime.now(timezone.utc)
        if action == "archive": kwargs["payload"] = payload
        getattr(service, f"{action}_{kind}")(db, **kwargs)
        name = f"{kind}.archived" if action == "archive" else f"{kind}.restored"
        at = db.scalar(select(models.AuditEvent.created_at).where(models.AuditEvent.event_type == name))
        assert abs((at.astimezone(timezone.utc) - before).total_seconds()) < 10


@pytest.mark.parametrize("operation", ["create", "update"])
def test_client_archived_while_project_write_waits_is_revalidated(data, records, engine, operation):
    if engine.dialect.name != "postgresql": pytest.skip("PostgreSQL row/FK lock wait")
    with data.factory() as db:
        customer = models.Client(tenant_id=data.owner.tenant_id, company_name="Contended Client", normalized_company_name="contended client")
        db.add(customer); db.commit(); client_id = customer.id
    started = Event(); worker_pid = []
    def write():
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            worker_pid.append(db.connection().connection.driver_connection.get_backend_pid())
            started.set()
            try:
                if operation == "create":
                    projects.create_project(db, tenant_id=actor.tenant_id, actor=actor,
                        payload=schemas.ProjectCreate(name="Concurrent project", client_id=client_id, manager_ids=[actor.id]))
                else:
                    projects.update_project(db, tenant_id=actor.tenant_id, project_id=records.project, actor=actor,
                        payload=schemas.ProjectUpdate(client_id=client_id))
                return 200
            except HTTPException as error: return error.status_code
    with data.factory() as holder:
        customer = holder.scalar(select(models.Client).where(models.Client.id == client_id).with_for_update())
        with ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(write)
            try:
                assert started.wait(timeout=15)
                # Both versions wait: the old one at the FK write, the fixed one
                # at client validation. Release only once the DB proves a wait.
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        row = observer.execute(text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"), {"pid": worker_pid[0]}).first()
                        if row and row[0] == "Lock": break
                        time.sleep(.02)
                    else: pytest.fail("Project writer did not reach the held database lock")
                customer.status = models.ClientStatusEnum.ARCHIVED
            finally: holder.commit()
            assert result.result(timeout=20) == 404
    with data.factory() as db:
        assert not db.scalars(select(models.Project).where(models.Project.client_id == client_id)).all()


@pytest.mark.parametrize("kind", ["client", "project"])
def test_restore_preserves_nonempty_attachment_and_work_history(data, api, records, tmp_path, kind):
    content = b"Synthetic preserved attachment\n"
    blob = tmp_path / "evidence.txt"; blob.write_bytes(content)
    with data.factory() as db:
        submission = models.CompletionSubmission(tenant_id=data.owner.tenant_id, task_id=data.task.id,
            subtask_id=data.child.id, submitted_by_id=data.owner.id, description="Completed evidence",
            description_word_count=2, status=models.CompletionSubmissionStatusEnum.APPROVED,
            approval_required=False, attempt_number=1)
        db.add(submission); db.flush()
        db.add(models.CompletionAttachment(tenant_id=data.owner.tenant_id, submission_id=submission.id,
            original_filename="evidence.txt", mime_type="text/plain", file_size=len(content),
            storage_key=f"synthetic/{uuid4()}.txt", checksum_sha256=hashlib.sha256(content).hexdigest()))
        db.commit()
        before = retained(db)
        submission_before = db.execute(select(models.CompletionSubmission.__table__)).all()
        assert len(before["completion_attachments"]) == 1
    assert transition(api, data, records, kind, "archive").status_code == 200
    assert transition(api, data, records, kind, "restore").status_code == 200
    with data.factory() as db:
        assert retained(db) == before
        assert db.execute(select(models.CompletionSubmission.__table__)).all() == submission_before
    assert blob.read_bytes() == content


@pytest.mark.parametrize("operation", ["create", "update", "restore"])
def test_demotion_during_client_dependency_wait_prevents_project_write(data, records, engine, operation):
    if engine.dialect.name != "postgresql": pytest.skip("PostgreSQL dependency lock wait")
    if operation == "restore":
        with data.factory() as db:
            projects.archive_project(db, tenant_id=data.owner.tenant_id, project_id=records.project,
                actor=db.get(models.User, data.owner.id), payload=schemas.ProjectArchive())
    started = Event(); worker_pid = []
    def attempt():
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            worker_pid.append(db.connection().connection.driver_connection.get_backend_pid()); started.set()
            kwargs = {"tenant_id": actor.tenant_id, "actor": actor}
            try:
                if operation == "create":
                    projects.create_project(db, payload=schemas.ProjectCreate(name="Forbidden new project",
                        client_id=records.client, manager_ids=[actor.id]), **kwargs)
                elif operation == "update":
                    projects.update_project(db, project_id=records.project,
                        payload=schemas.ProjectUpdate(client_id=records.client, description="Forbidden update"), **kwargs)
                else: projects.restore_project(db, project_id=records.project, **kwargs)
                return 200
            except HTTPException as error: return error.status_code
    with data.factory() as holder:
        holder.scalar(select(models.Client).where(models.Client.id == records.client).with_for_update())
        with ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(attempt)
            try:
                assert started.wait(timeout=15)
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        row = observer.execute(text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"), {"pid": worker_pid[0]}).first()
                        if row and row[0] == "Lock": break
                        time.sleep(.02)
                    else: pytest.fail("Project request did not wait for the dependency lock")
                holder.get(models.User, data.owner.id).role = models.RoleEnum.USER
            finally: holder.commit()
            assert result.result(timeout=20) == 403


def test_client_validation_serializes_project_create_before_later_archive(data, records, monkeypatch):
    validated, release, archive_started, archived = Event(), Event(), Event(), Event()
    commits = []
    original = projects._get_active_client
    def pause_after_validation(*args, **kwargs):
        client = original(*args, **kwargs)
        validated.set()
        assert release.wait(timeout=15)
        return client
    monkeypatch.setattr(projects, "_get_active_client", pause_after_validation)
    def committed(session):
        op = session.info.get("restore_audit_operation")
        if op:
            commits.append(op)
            if op == "archive": archived.set()
    event.listen(data.factory.class_, "after_commit", committed)
    def create():
        with data.factory() as db:
            db.info["restore_audit_operation"] = "create"
            return projects.create_project(db, tenant_id=data.owner.tenant_id, actor=db.get(models.User, data.owner.id),
                payload=schemas.ProjectCreate(name="Serialized create", client_id=records.client, manager_ids=[data.owner.id])).id
    def archive():
        with data.factory() as db:
            actor = db.get(models.User, data.owner.id)
            db.info["restore_audit_operation"] = "archive"
            archive_started.set()
            clients.archive_client(db, tenant_id=actor.tenant_id, client_id=records.client,
                actor=actor, payload=schemas.ClientArchive())
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            creating = pool.submit(create)
            try:
                assert validated.wait(timeout=15)
                archiving = pool.submit(archive)
                assert archive_started.wait(timeout=10)
                archived.wait(timeout=1)
            finally: release.set()
            creating.result(timeout=20); archiving.result(timeout=20)
        assert commits == ["create", "archive"]
    finally: event.remove(data.factory.class_, "after_commit", committed)
