"""Production review regressions. Only explicitly isolated test databases/files."""
from uuid import uuid4
from sqlalchemy import event, text

from backend.app import models
from backend.tests.test_task_lifecycle import NOW, api, auth, data, engine
from backend.tests.test_task_execution_report import proof, submission


def report_url(data):
    return f"/api/tasks/{data.task.id}/execution-report"


def test_reopened_then_deployed_uses_current_cycle_without_duplicate_completion(data, api):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        task.completed_at = NOW.replace(tzinfo=None)
        for status in ("DONE", "TODO", "DEPLOYED"):
            db.execute(text("UPDATE tasks SET status=:status WHERE id=:id"), {"status": status, "id": task.id})
        db.commit()
        deployed = db.scalar(text("SELECT occurred_at FROM task_lifecycle_events WHERE task_id=:id AND new_status='DEPLOYED'"), {"id": task.id})
    row = api.get(report_url(data), headers=auth(data.owner)).json()["task"]
    assert row["status"] == "DEPLOYED" and row["last_completed_at"] is not None
    from datetime import datetime
    from backend.app.lifecycle.analytics import utc
    if isinstance(deployed, str):
        deployed = datetime.fromisoformat(deployed.replace("Z", "+00:00"))
    assert datetime.fromisoformat(row["final_completed_at"].replace("Z", "+00:00")) == utc(deployed)
    assert row["completion_count"] == 2 and row["reopened_count"] == 1
    assert row["final_completion_source"] == "captured_event"
    with data.factory() as db:
        db.execute(text("UPDATE tasks SET status='DONE' WHERE id=:id"), {"id": data.task.id})
        db.commit()
    row = api.get(report_url(data), headers=auth(data.owner)).json()["task"]
    assert datetime.fromisoformat(row["final_completed_at"].replace("Z", "+00:00")) == utc(deployed)
    assert row["completion_count"] == 2


def test_done_to_deployed_is_one_completion_cycle_and_reopen_clears_final(data, api):
    with data.factory() as db:
        for status in ("DONE", "DEPLOYED", "TODO"):
            db.execute(text("UPDATE tasks SET status=:status WHERE id=:id"), {"status": status, "id": data.task.id})
        db.commit()
    row = api.get(report_url(data), headers=auth(data.owner)).json()["task"]
    assert row["completion_count"] == 1 and row["reopened_count"] == 1
    assert row["last_completed_at"] is not None and row["final_completed_at"] is None


def test_metadata_policy_matches_downloads_on_legacy_and_new_routes(data, api):
    with data.factory() as db:
        db.get(models.User, data.owner.id).email = f"{uuid4()}@example.com"
        reader = models.User(id=str(uuid4()), name="Follower", tenant_id=data.owner.tenant_id,
            email=f"{uuid4()}@example.com", hashed_password="not-a-password", role=models.RoleEnum.USER,
            status=models.UserStatusEnum.ACTIVE)
        task = db.get(models.Task, data.task.id)
        task.followers.append(reader)
        db.add(reader)
        db.flush()
        parent = submission(db, data)
        attachment = proof(db, data, parent)
        proof(db, data, parent, tenant_id=data.outsider.tenant_id, original_filename="foreign-secret.pdf")
        submission(db, data, tenant_id=data.outsider.tenant_id, description="Foreign tenant submission must remain inaccessible")
        db.commit()
    legacy = f"/api/tasks/{data.task.id}/subtasks/{data.child.id}/completion-submissions"
    follower = api.get(legacy, headers=auth(reader))
    assert follower.status_code == 200, follower.text
    assert len(follower.json()) == 1 and follower.json()[0]["attachments"] == []
    owner = api.get(legacy, headers=auth(data.owner))
    assert owner.status_code == 200, owner.text
    assert len(owner.json()) == 1 and [item["id"] for item in owner.json()[0]["attachments"]] == [attachment.id]
    detail = api.get(f"/api/tasks/{data.task.id}", headers=auth(reader))
    assert detail.status_code == 200, detail.text
    assert "foreign-secret" not in detail.text and "proof.pdf" not in detail.text
    assert detail.json()["subtasks"][0]["completion_submissions"][0]["attachments"] == []
    authorized = api.get(f"/api/tasks/{data.task.id}", headers=auth(data.owner))
    assert authorized.status_code == 200, authorized.text
    assert "proof.pdf" in authorized.text and "foreign-secret" not in authorized.text
    assert api.get(report_url(data) + "/evidence", headers=auth(reader)).json()["items"] == []


def test_evidence_cannot_be_read_through_another_task_or_subtask(data, api, tmp_path, monkeypatch):
    from backend.app.services import subtask_completion
    monkeypatch.setattr(subtask_completion, "_private_root", lambda: tmp_path)
    with data.factory() as db:
        parent = submission(db, data)
        attachment = proof(db, data, parent)
        (tmp_path / attachment.storage_key).write_bytes(b"%PDF-1.7\nprivate evidence")
        other = models.Task(title="Other authorized task", created_by_id=data.owner.id)
        db.add(other)
        db.flush()
        other_child = models.Subtask(task_id=other.id, title="Other child")
        sibling = models.Subtask(task_id=data.task.id, title="Sibling")
        db.add_all([other_child, sibling])
        db.commit()
    suffix = f"/evidence/completion/{attachment.id}"
    assert api.get(report_url(data) + suffix, headers=auth(data.owner)).status_code == 200
    assert api.get(f"/api/tasks/{other.id}/execution-report" + suffix, headers=auth(data.owner)).status_code == 404
    url = f"/api/tasks/{data.task.id}/subtasks/{sibling.id}/completion-submissions/{parent.id}/attachments/{attachment.id}/download"
    assert api.get(url, headers=auth(data.owner)).status_code == 404
    item = api.get(report_url(data) + "/evidence", headers=auth(data.owner)).json()["items"][0]
    assert item["task_id"] == data.task.id and item["subtask_id"] == data.child.id and item["submission_id"] == parent.id


def test_media_library_reference_cannot_alias_private_completion_store(data, api, tmp_path, monkeypatch):
    from backend.app.lifecycle import report_evidence
    monkeypatch.setattr(report_evidence.media_service.settings, "media_root", str(tmp_path))
    private = tmp_path / "private" / "completion-evidence"
    private.mkdir(parents=True)
    (private / "hidden.pdf").write_bytes(b"%PDF-1.7\nprivate")
    with data.factory() as db:
        item = models.MediaItem(owner_id=data.owner.id, filename="alias.pdf", ext="pdf", mime_type="application/pdf",
            size_bytes=12, category=models.MediaCategoryEnum.DOCUMENT, storage_provider=models.StorageProviderEnum.LOCAL,
            storage_path="private/completion-evidence/hidden.pdf", public_url="/uploads/alias.pdf", checksum_sha256="a" * 64)
        db.add(item)
        db.flush()
        db.get(models.Task, data.task.id).attachments = [item.public_url]
        db.commit()
    response = api.get(report_url(data) + f"/evidence/media/{item.id}", headers=auth(data.owner))
    assert response.status_code == 404


def test_expired_inactive_and_foreign_credentials_are_rejected_by_all_journey_reads(data, api):
    from backend.app.config import get_settings
    from jose import jwt
    token = jwt.decode(auth(data.owner)["Authorization"][7:], get_settings().jwt_secret_key,
                       algorithms=[get_settings().jwt_algorithm])
    token["exp"] = 1
    expired = {"Authorization": "Bearer " + jwt.encode(token, get_settings().jwt_secret_key, algorithm=get_settings().jwt_algorithm)}
    urls = [f"/api/tasks/{data.task.id}/{suffix}" for suffix in (
        "journey", "analytics", "execution-sessions", "execution-report", "execution-report/completions", "execution-report/evidence")]
    for url in urls:
        assert api.get(url, headers=expired).status_code == 401
        assert api.get(url, headers=auth(data.outsider)).status_code == 404
    with data.factory() as db:
        db.get(models.User, data.owner.id).status = models.UserStatusEnum.DEACTIVATED
        db.commit()
    for url in urls:
        assert api.get(url, headers=auth(data.owner)).status_code == 403


def test_task_detail_queries_do_not_grow_with_distinct_subtask_assignees(data, api, engine):
    with data.factory() as db:
        db.get(models.User, data.owner.id).email = f"{uuid4()}@example.com"
        db.commit()
    queries = []
    def count(_connection, _cursor, statement, *_args):
        queries.append(statement)
    event.listen(engine, "before_cursor_execute", count)
    try:
        baseline = api.get(f"/api/tasks/{data.task.id}", headers=auth(data.owner))
        assert baseline.status_code == 200, baseline.text
        initial = len(queries)
        with data.factory() as db:
            for index in range(12):
                user = models.User(name=f"Synthetic assignee {index}", email=f"{uuid4()}@example.com", tenant_id=data.owner.tenant_id,
                    hashed_password="not-a-password", role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
                db.add(user)
                db.flush()
                db.add(models.Subtask(task_id=data.task.id, title=f"Work {index}", assigned_to_id=user.id))
            db.commit()
        queries.clear()
        result = api.get(f"/api/tasks/{data.task.id}", headers=auth(data.owner))
        assert result.status_code == 200, result.text
        print(f"TASK_DETAIL_QUERIES {engine.dialect.name}: 1 assignee={initial}; 13 assignees={len(queries)}")
        assert len(queries) <= initial + 3
    finally:
        event.remove(engine, "before_cursor_execute", count)


def test_legacy_list_does_not_reuse_pre_hardening_metadata_cache(data, api, monkeypatch):
    from backend.app.cache import build_cache_key
    from backend.app.routers import tasks
    old = build_cache_key(resource="tasks:list", tenant_id=str(data.owner.tenant_id),
                         user_id=data.owner.id, path="/api/tasks", params=[])
    seen = []
    def cached(key):
        seen.append(key)
        return [] if key == old else None
    monkeypatch.setattr(tasks, "get_cached_json", cached)
    monkeypatch.setattr(tasks, "set_cached_json", lambda *_args, **_kwargs: None)
    with data.factory() as db:
        db.get(models.User, data.owner.id).email = f"{uuid4()}@example.com"
        db.commit()
    result = api.get("/api/tasks", headers=auth(data.owner))
    assert result.status_code == 200, result.text
    assert data.task.id in {row["id"] for row in result.json()}
    assert seen and old not in seen
