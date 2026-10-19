"""Phase 3 uses isolated SQLite/PostgreSQL and synthetic private files only."""
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest

from sqlalchemy import event, text

from backend.app import models
from backend.app.lifecycle.report import paused_gaps
from backend.app.lifecycle import report_evidence
from backend.tests.test_task_lifecycle import NOW, api, auth, data, engine


def submission(db, data, **overrides):
    values = dict(tenant_id=data.owner.tenant_id, task_id=data.task.id, subtask_id=data.child.id,
        submitted_by_id=data.owner.id, description="Completed work with verified acceptance criteria",
        description_word_count=7, status=models.CompletionSubmissionStatusEnum.COMPLETED,
        approval_required=False, attempt_number=1)
    values.update(overrides)
    row = models.CompletionSubmission(**values)
    db.add(row)
    db.flush()
    return row


def proof(db, data, parent, **overrides):
    values = dict(tenant_id=data.owner.tenant_id, submission_id=parent.id, original_filename="proof.pdf",
        mime_type="application/pdf", file_size=24, storage_key=f"{uuid4()}.pdf", checksum_sha256="a" * 64)
    values.update(overrides)
    row = models.CompletionAttachment(**values)
    db.add(row)
    db.commit()
    return row


def base(data):
    return f"/api/tasks/{data.task.id}/execution-report"


def test_report_reopened_completions_and_unknown_subtask_creator(api, data):
    with data.factory() as db:
        for status in ["IN_PROGRESS", "DONE", "TODO", "DONE", "BLOCKED"]:
            db.execute(text("UPDATE tasks SET status=:s WHERE id=:id"), {"s": status, "id": data.task.id})
        db.commit()
    response = api.get(base(data), headers=auth(data.owner))
    assert response.status_code == 200, response.text
    report = response.json()
    task = report["task"]
    assert task["completion_count"] == 2 and task["reopened_count"] == 2
    assert task["final_completed_at"] is None and task["last_completed_at"].endswith("Z")
    assert task["creator"] == {"id": data.owner.id, "name": "Owner"}
    assert report["subtasks"][0]["created_at"] is not None
    assert report["subtasks"][0]["creator"]["id"] == data.owner.id
    assert api.get(base(data), headers=auth(data.outsider)).status_code == 404
    assert api.get(base(data)).status_code == 401


def test_no_fabricated_legacy_creation_completion_or_pause(data, api):
    with data.factory() as db:
        child = models.Subtask(task_id=data.task.id, title="Unknown creator")
        db.add(child)
        db.commit()  # no actor context: never infer parent creator
        child_id = child.id
    result = api.get(base(data), headers=auth(data.owner)).json()
    row = next(row for row in result["subtasks"] if row["id"] == child_id)
    assert row["creator"] is None and row["first_started_at"] is None
    assert row["final_completed_at"] is None and row["completion_count"] == 0
    assert row["linked_paused_seconds"] == 0


def test_pauses_require_valid_continuations_and_do_not_round_each_person():
    def row(identifier, user, start, stop, **kw):
        return SimpleNamespace(id=identifier, user_id=user, task_id="task", subtask_id=None,
            started_at=NOW + timedelta(seconds=start), stopped_at=NOW + timedelta(seconds=stop) if stop is not None else None,
            stop_reason=kw.get("stop_reason"), start_kind=kw.get("start_kind", "started"), continued_from_id=kw.get("continued_from_id"))
    entries = [row("a", "u", 0, 1, stop_reason="paused"), row("b", "u", 1.6, 2, start_kind="resumed", continued_from_id="a"),
               row("c", "v", 0, 1, stop_reason="paused"), row("d", "v", 1.6, 2, start_kind="resumed", continued_from_id="c"),
               row("e", "u", 3, 4, stop_reason="paused")]
    assert paused_gaps(entries, NOW + timedelta(seconds=5)) == (1, 1)
    entries[1].user_id = "foreign"
    assert paused_gaps(entries, NOW + timedelta(seconds=5)) == (0, 2)
    assert paused_gaps(entries, NOW) == (0, 3)


def test_overlapping_parent_child_work_union_not_sum(data, api):
    with data.factory() as db:
        for target in ({"task_id": data.task.id}, {"subtask_id": data.child.id}):
            db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.owner.id, **target,
                started_at=NOW, stopped_at=NOW + timedelta(seconds=120), duration_seconds=120,
                status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
    result = api.get(base(data), headers=auth(data.owner)).json()
    assert result["direct"]["person_seconds"] == result["children"]["person_seconds"] == 120
    assert result["aggregate"]["person_seconds"] == 120
    assert result["aggregate"]["raw_session_seconds"] == 240


def test_evidence_missing_secure_preview_download_and_foreign_rows(data, api, tmp_path, monkeypatch):
    monkeypatch.setattr(report_evidence.subtask_completion, "_private_root", lambda: tmp_path)
    with data.factory() as db:
        parent = submission(db, data)
        attachment = proof(db, data, parent)
        foreign = proof(db, data, parent, tenant_id=data.outsider.tenant_id)
    url = base(data) + "/evidence"
    listing = api.get(url, headers=auth(data.owner)).json()["items"]
    assert len(listing) == 1 and listing[0]["availability"] == "missing"
    file_url = f"{url}/completion/{attachment.id}"
    assert api.get(file_url, headers=auth(data.owner)).status_code == 404
    path = tmp_path / attachment.storage_key
    path.write_bytes(b"%PDF-1.7\nsynthetic proof\n")
    listing = api.get(url, headers=auth(data.owner)).json()["items"]
    assert listing[0]["uploaded_by"]["name"] == "Owner" and listing[0]["can_preview"]
    response = api.get(file_url, headers=auth(data.owner))
    assert response.status_code == 200 and "no-store" in response.headers["cache-control"]
    assert "attachment" in response.headers["content-disposition"]
    assert api.get(file_url + "?preview=true", headers=auth(data.owner)).status_code == 200
    path.write_bytes(b"<html>forged pdf</html>")
    assert api.get(file_url + "?preview=true", headers=auth(data.owner)).status_code == 415
    assert api.get(file_url, headers=auth(data.outsider)).status_code == 404
    assert api.get(f"{url}/completion/{foreign.id}", headers=auth(data.owner)).status_code == 404
    old_url = f"/api/tasks/{data.task.id}/subtasks/{data.child.id}/completion-submissions/{parent.id}/attachments/{foreign.id}/download"
    assert api.get(old_url, headers=auth(data.owner)).status_code == 404
    assert "storage_key" not in listing[0]


def test_task_reader_does_not_automatically_gain_file_access(data, api, tmp_path, monkeypatch):
    monkeypatch.setattr(report_evidence.subtask_completion, "_private_root", lambda: tmp_path)
    with data.factory() as db:
        reader = models.User(name="Follower", email=f"{uuid4()}@example.test", tenant_id=data.owner.tenant_id,
            hashed_password="test-only", role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
        task = db.get(models.Task, data.task.id)
        task.followers.append(reader)
        db.add(reader)
        db.flush()
        parent = submission(db, data)
        attachment = proof(db, data, parent)
    assert api.get(base(data), headers=auth(reader)).status_code == 200
    assert api.get(base(data) + "/evidence", headers=auth(reader)).json()["items"] == []
    assert api.get(base(data) + f"/evidence/completion/{attachment.id}", headers=auth(reader)).status_code == 404


def test_completion_attempts_pagination_and_no_duplicate_items(data, api):
    with data.factory() as db:
        for number in range(4):
            submission(db, data, id=str(4 - number), created_at=NOW + timedelta(minutes=number),
                       attempt_number=number + 1, status=models.CompletionSubmissionStatusEnum.REJECTED,
                       reviewed_by_id=data.owner.id, reviewed_at=NOW, review_reason="Needs clearer proof")
        db.commit()
    url = base(data) + "/completions"
    first = api.get(url + "?limit=2", headers=auth(data.owner)).json()
    second = api.get(url + "?limit=2&after_id=" + first["next_after_id"], headers=auth(data.owner)).json()
    assert len({item["id"] for item in first["items"] + second["items"]}) == 4
    assert second["next_after_id"] is None
    assert [row["attempt_number"] for row in first["items"] + second["items"]] == [1, 2, 3, 4]
    assert all(item["reviewed_by"]["name"] == "Owner" for item in first["items"])
    assert api.get(url + "?limit=501", headers=auth(data.owner)).status_code == 422
    assert api.get(url + "?after_id=foreign-cursor", headers=auth(data.owner)).status_code == 409


def test_legacy_links_are_not_fetched_or_echoed_and_revoked_files_are_denied(data, api, tmp_path, monkeypatch):
    monkeypatch.setattr(report_evidence.media_service.settings, "media_root", str(tmp_path))
    path = tmp_path / "uploads" / "known.pdf"
    path.parent.mkdir()
    path.write_bytes(b"%PDF-1.7\nknown file")
    with data.factory() as db:
        item = models.MediaItem(owner_id=data.owner.id, filename="known.pdf", ext="pdf", mime_type="application/pdf",
            size_bytes=path.stat().st_size, category=models.MediaCategoryEnum.DOCUMENT, storage_provider=models.StorageProviderEnum.LOCAL,
            storage_path="uploads/known.pdf", public_url="/media/known.pdf", checksum_sha256="b" * 64)
        db.add(item)
        db.flush()
        task = db.get(models.Task, data.task.id)
        task.attachments = [item.public_url, "https://secret:password@example.test/file", "media:not-permitted"]
        db.commit()
        item_id = item.id
    url = base(data) + "/evidence"
    result = api.get(url + "?source=linked&limit=2", headers=auth(data.owner))
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["items"][0]["source"] == "media" and payload["items"][1]["availability"] == "unverified"
    assert "secret" not in result.text and "password" not in result.text and payload["next_after_id"] == "2"
    file_url = f"{url}/media/{item_id}"
    assert api.get(file_url, headers=auth(data.owner)).status_code == 200
    with data.factory() as db:
        db.get(models.Task, data.task.id).attachments = []
        db.commit()
    assert api.get(file_url, headers=auth(data.owner)).status_code == 404
    assert api.get(url + "?source=linked&after_id=-1", headers=auth(data.owner)).status_code == 422


def test_query_count_is_bounded_with_many_subtasks(data, api, engine):
    queries = []
    def capture(_connection, _cursor, statement, *_args):
        queries.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        baseline = api.get(base(data), headers=auth(data.owner))
        assert baseline.status_code == 200, baseline.text
        baseline_count = len(queries)
        with data.factory() as db:
            db.add_all(models.Subtask(task_id=data.task.id, title=f"Child {i}") for i in range(75))
            db.commit()
        queries.clear()
        response = api.get(base(data), headers=auth(data.owner))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    assert len(response.json()["subtasks"]) == 76
    assert len(queries) <= 24, f"Unexpected query growth: {len(queries)}"
    assert len(queries) <= baseline_count + 1
    print(f"QUERY_COUNT {engine.dialect.name}: 1 child={baseline_count}; 76 children={len(queries)}")


def test_cloud_reads_are_bounded_private_and_provider_errors_are_redacted(monkeypatch):
    adapter = SimpleNamespace(is_configured=True, service_role_key="synthetic-secret", anon_key=None,
                              url="https://storage.example.test", bucket="evidence")
    row = SimpleNamespace(storage_provider=models.StorageProviderEnum.SUPABASE, storage_path="uploads/proof.pdf")
    monkeypatch.setattr(report_evidence.media_service, "get_adapter", lambda _: adapter)
    actual_client = httpx.Client
    seen = []
    def response(request):
        seen.append(request)
        return httpx.Response(200, content=b"%PDF-1.7\nprivate")
    monkeypatch.setattr(httpx, "Client", lambda **kw: actual_client(transport=httpx.MockTransport(response), **kw))
    assert report_evidence._remote_bytes("media", row) == b"%PDF-1.7\nprivate"
    assert seen[0].headers["authorization"] == "Bearer synthetic-secret"
    assert "synthetic-secret" not in str(seen[0].url)
    monkeypatch.setattr(report_evidence, "MAX_READ_BYTES", 2)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        report_evidence._remote_bytes("media", row)
    assert error.value.status_code == 413


def test_evidence_traversal_deleted_media_and_size_limit(data, api, tmp_path, monkeypatch):
    monkeypatch.setattr(report_evidence.subtask_completion, "_private_root", lambda: tmp_path)
    with data.factory() as db:
        parent = submission(db, data)
        attachment = proof(db, data, parent, storage_key="../outside.pdf")
    assert api.get(base(data) + f"/evidence/completion/{attachment.id}", headers=auth(data.owner)).status_code == 404
    with data.factory() as db:
        row = db.get(models.CompletionAttachment, attachment.id)
        row.storage_key = "large.pdf"
        row.file_size = report_evidence.MAX_READ_BYTES + 1
        db.commit()
    (tmp_path / "large.pdf").write_bytes(b"%PDF-1.7\n")
    assert api.get(base(data) + f"/evidence/completion/{attachment.id}", headers=auth(data.owner)).status_code == 413
    with data.factory() as db:
        row = models.MediaItem(owner_id=data.owner.id, filename="deleted.png", ext="png", mime_type="image/png",
            size_bytes=123, category=models.MediaCategoryEnum.IMAGE, storage_provider=models.StorageProviderEnum.LOCAL,
            storage_path="deleted.png", public_url="/media/deleted.png", checksum_sha256="c" * 64, deleted_at=NOW)
        db.add(row)
        db.flush()
        db.get(models.Task, data.task.id).attachments = [row.public_url]
        db.commit()
        identifier = row.id
    listing = api.get(base(data) + "/evidence?source=linked", headers=auth(data.owner)).json()["items"]
    assert listing[0]["availability"] == "deleted" and not listing[0]["can_download"]
    assert api.get(base(data) + f"/evidence/media/{identifier}", headers=auth(data.owner)).status_code == 404


def test_report_uses_repeatable_snapshot_during_concurrent_completion(data, api, engine, monkeypatch):
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL repeatable-read concurrency; SQLite totals covered separately")
    from backend.app.routers import task_lifecycle
    ready, committed = Event(), Event()
    original = task_lifecycle.build_report
    def delayed(*args, **kwargs):
        ready.set()
        assert committed.wait(8)
        return original(*args, **kwargs)
    monkeypatch.setattr(task_lifecycle, "build_report", delayed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: api.get(base(data), headers=auth(data.owner)))
        try:
            assert ready.wait(8)
            with data.factory() as db:
                db.execute(text("UPDATE tasks SET status='DONE' WHERE id=:id"), {"id": data.task.id})
                db.commit()
        finally:
            committed.set()
        response = future.result(timeout=10)
    assert response.status_code == 200, response.text
    assert response.json()["task"]["status"] == "TODO"
    assert response.json()["task"]["completion_count"] == 0
    latest = api.get(base(data), headers=auth(data.owner)).json()
    assert latest["task"]["status"] == "DONE" and latest["task"]["completion_count"] == 1
    with data.factory() as db:
        assert db.get(models.User, data.owner.id).points == 125


def test_final_completion_uses_ledger_order_not_clock_order(data, api):
    with data.factory() as db:
        db.execute(text("UPDATE tasks SET status='DONE' WHERE id=:id"), {"id": data.task.id})
        db.flush()
        for previous, state, at in [("DONE", "TODO", NOW + timedelta(seconds=30)), ("TODO", "DONE", NOW)]:
            db.add(models.TaskLifecycleEvent(tenant_id=data.owner.tenant_id, task_id=data.task.id,
                event_type="task.status_changed", previous_status=previous, new_status=state,
                occurred_at=at, recorded_at=at, details={}))
            db.flush()
        db.commit()
    row = api.get(base(data), headers=auth(data.owner)).json()["task"]
    assert row["final_completed_at"].startswith("2020-10-19T10:00:00")
    assert row["final_completion_source"] == "captured_event"


def test_multiple_project_managers_and_file_permission_revocation(data, api, tmp_path, monkeypatch):
    monkeypatch.setattr(report_evidence.subtask_completion, "_private_root", lambda: tmp_path)
    with data.factory() as db:
        managers = [models.User(name=f"Manager {i}", tenant_id=data.owner.tenant_id,
            email=f"{uuid4()}@example.test", role=models.RoleEnum.MANAGER, hashed_password="test-only",
            status=models.UserStatusEnum.ACTIVE) for i in range(2)]
        db.add_all(managers)
        company = models.Client(tenant_id=data.owner.tenant_id, company_name="Evidence client", normalized_company_name="evidence client")
        db.add(company)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=company.id, name="Execution", normalized_name="execution")
        db.add(project)
        db.flush()
        db.add_all(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id, user_id=user.id,
                                       role=models.ProjectMemberRoleEnum.MANAGER) for user in managers)
        db.get(models.Task, data.task.id).project_id = project.id
        parent = submission(db, data)
        attachment = proof(db, data, parent)
        (tmp_path / attachment.storage_key).write_bytes(b"%PDF-1.7\nprivate")
    url = base(data) + f"/evidence/completion/{attachment.id}"
    for manager in managers:
        assert api.get(base(data), headers=auth(manager)).status_code == 200
        assert api.get(url, headers=auth(manager)).status_code == 200
    with data.factory() as db:
        # Preserve read access via following, but remove project-based file access.
        from sqlalchemy import delete
        db.execute(delete(models.ProjectMember).where(models.ProjectMember.user_id == managers[0].id))
        task = db.get(models.Task, data.task.id)
        task.followers.append(db.get(models.User, managers[0].id))
        db.commit()
    assert api.get(base(data), headers=auth(managers[0])).status_code == 200
    assert api.get(url, headers=auth(managers[0])).status_code == 404
    assert api.get(url, headers=auth(managers[1])).status_code == 200


def test_malformed_legacy_attachment_values_remain_unverified(data, api):
    with data.factory() as db:
        db.get(models.Task, data.task.id).attachments = [None, {"url": "https://private.example.test"}, 12]
        db.commit()
    result = api.get(base(data) + "/evidence?source=linked", headers=auth(data.owner))
    assert result.status_code == 200, result.text
    assert len(result.json()["items"]) == 3
    assert all(row["availability"] == "unverified" and not row["can_download"] for row in result.json()["items"])
    assert "private.example.test" not in result.text


def test_true_legacy_rows_have_no_invented_subtask_dates_or_creator(data, api, engine):
    # Disable capture only inside the disposable test schema before inserting legacy rows.
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.exec_driver_sql("ALTER TABLE subtasks DISABLE TRIGGER zea_lifecycle_subtasks")
        else:
            connection.exec_driver_sql("DROP TRIGGER zea_lifecycle_subtasks_insert")
    with data.factory() as db:
        child = models.Subtask(task_id=data.task.id, title="Pre-capture completed child", completed=True,
                               status=models.SubtaskStatusEnum.DONE)
        db.add(child)
        db.commit()
        identifier = child.id
    result = api.get(base(data), headers=auth(data.owner)).json()
    row = next(row for row in result["subtasks"] if row["id"] == identifier)
    assert not result["history_complete"]
    assert row["creation_source"] == "not_recorded" and row["created_at"] is None and row["creator"] is None
    assert row["final_completed_at"] is None and row["completion_count"] == 0


def test_minio_signed_references_resolve_without_leaking_urls_or_bypassing_tenant(data, api, monkeypatch):
    from io import BytesIO
    from backend.app.storage import minio
    monkeypatch.setattr(report_evidence.media_service.settings, "minio_endpoint", "https://storage.example.test")
    monkeypatch.setattr(report_evidence.media_service.settings, "minio_public_base", "https://storage.example.test")
    read = []
    def get_object(**kwargs):
        read.append(kwargs)
        return {"Body": BytesIO(b"%PDF-1.7\nsynthetic evidence")}
    monkeypatch.setattr(minio, "get_minio_client", lambda: SimpleNamespace(get_object=get_object))
    with data.factory() as db:
        rows = [models.MediaFile(user_id=owner.id, media_type=models.MediaFileTypeEnum.DOCUMENT,
            bucket="evidence", object_key=f"{owner.id}/proof.pdf", original_filename="proof.pdf",
            content_type="application/pdf", size_bytes=24, status=models.MediaFileStatusEnum.CONFIRMED)
            for owner in (data.owner, data.outsider)]
        db.add_all(rows)
        db.flush()
        refs = [f"https://storage.example.test/{row.bucket}/{row.object_key}?X-Amz-Credential=synthetic-secret" for row in rows]
        db.get(models.Task, data.task.id).attachments = refs
        db.commit()
    listing = api.get(base(data) + "/evidence?source=linked", headers=auth(data.owner))
    assert listing.status_code == 200, listing.text
    assert listing.json()["items"][0]["source"] == "media_file"
    assert listing.json()["items"][1]["source"] == "unverified"
    assert "synthetic-secret" not in listing.text and not read
    url = base(data) + f"/evidence/media_file/{rows[0].id}"
    assert api.get(url + "?preview=true", headers=auth(data.owner)).status_code == 200
    assert len(read) == 1
    assert api.get(base(data) + f"/evidence/media_file/{rows[1].id}", headers=auth(data.owner)).status_code == 404
    assert report_evidence.minio_reference("https://storage.example.test.attacker.test/evidence/file") is None
    assert report_evidence.minio_reference("https://storage.example.test/evidence/%2e%2e/secret") is None


def test_provider_exception_details_do_not_escape_the_report(data, api, monkeypatch):
    with data.factory() as db:
        item = models.MediaItem(owner_id=data.owner.id, filename="remote.pdf", ext="pdf", mime_type="application/pdf",
            size_bytes=123, category=models.MediaCategoryEnum.DOCUMENT, storage_provider=models.StorageProviderEnum.GDRIVE,
            storage_path="uploads/opaque.pdf", public_url="https://drive.example.test/file", checksum_sha256="d" * 64)
        db.add(item)
        db.flush()
        db.get(models.Task, data.task.id).attachments = [item.public_url]
        db.commit()
        identifier = item.id
    def fail(*_args):
        raise RuntimeError("provider secret_token=do-not-expose")
    monkeypatch.setattr(report_evidence, "_remote_bytes", fail)
    response = api.get(base(data) + f"/evidence/media/{identifier}", headers=auth(data.owner))
    assert response.status_code == 503 and "secret_token" not in response.text


def test_drive_reads_use_registered_keys_and_bounded_chunks(monkeypatch):
    from fastapi import HTTPException
    from googleapiclient import http
    seen = []
    class Download:
        def __init__(self, buffer, request, chunksize):
            self.buffer = buffer
            seen.append((request, chunksize))
        def next_chunk(self, num_retries):
            self.buffer.write(b"%PDF-1.7\nsynthetic")
            return None, True
    monkeypatch.setattr(http, "MediaIoBaseDownload", Download)
    files = SimpleNamespace(get_media=lambda **kwargs: kwargs)
    adapter = SimpleNamespace(is_configured=True, _get_file_id=lambda key: "registered-id" if key == "uploads/proof.pdf" else None,
                              service=SimpleNamespace(files=lambda: files))
    monkeypatch.setattr(report_evidence.media_service, "get_adapter", lambda _: adapter)
    row = SimpleNamespace(storage_provider=models.StorageProviderEnum.GDRIVE, storage_path="uploads/proof.pdf")
    assert report_evidence._remote_bytes("media", row).startswith(b"%PDF-")
    assert seen[0] == ({"fileId": "registered-id"}, 1024 * 1024)
    monkeypatch.setattr(report_evidence, "MAX_READ_BYTES", 2)
    with pytest.raises(HTTPException) as error:
        report_evidence._remote_bytes("media", row)
    assert error.value.status_code == 413
