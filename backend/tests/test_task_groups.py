"""Opt-in logical-task retrieval without changing assignment APIs or rewards."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI, Header
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from backend.app import models
from backend.app.database import get_db
from backend.app.dependencies import get_current_active_user
from backend.app.routers import tasks
from backend.app.services import notification_dispatcher
from backend.tests.test_task_lifecycle import engine as isolated_engine  # noqa: F401


@pytest.fixture
def grouped(isolated_engine, monkeypatch):  # noqa: F811
    engine = isolated_engine
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    for name in ("get_cached_json", "set_cached_json", "_invalidate_task_cache", "trigger_n8n_event"):
        monkeypatch.setattr(tasks, name, lambda *_a, **_kw: None)
    monkeypatch.setattr(tasks.audit_logger, "log_event", lambda *_a, **_kw: None)
    monkeypatch.setattr(tasks, "_schedule_notification_outbox_delivery", lambda *_a: None)
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *_a: None)
    monkeypatch.setattr(notification_dispatcher, "push_if_enabled", lambda *_a, **_kw: 0)
    tenant, other_tenant = uuid4(), uuid4()
    def user(name, tenant_id=tenant, role=models.RoleEnum.USER):
        return models.User(id=str(uuid4()), tenant_id=tenant_id, name=name,
                           email=f"{uuid4()}@example.com", hashed_password="synthetic",
                           role=role, status=models.UserStatusEnum.ACTIVE)
    owner = user("Owner", role=models.RoleEnum.OWNER)
    outsider = user("Outsider", tenant_id=other_tenant, role=models.RoleEnum.OWNER)
    members = [user(f"Member {index}") for index in range(8)]
    with factory() as db:
        db.add_all([owner, outsider, *members])
        customer = models.Client(tenant_id=tenant, company_name="Grouping customer",
                                 normalized_company_name=str(uuid4()), country="India")
        db.add(customer); db.flush()
        projects = [models.Project(tenant_id=tenant, client_id=customer.id, name=f"Project {index}",
                                   normalized_name=str(uuid4()), status=models.ProjectStatusEnum.ACTIVE)
                    for index in range(2)]
        db.add_all(projects); db.flush()
        db.add_all([models.ProjectMember(tenant_id=tenant, project_id=projects[0].id,
                                        user_id=member.id, role=models.ProjectMemberRoleEnum.MEMBER)
                    for member in members])
        group_id = str(uuid4())
        rows = [models.Task(id=str(uuid4()), title="Shared mission", task_group_id=group_id,
                            project_id=projects[0].id, created_by_id=owner.id, assigned_to_id=member.id,
                            status=models.TaskStatusEnum.DONE if index < 2 else models.TaskStatusEnum.IN_PROGRESS,
                            priority=models.TaskPriorityEnum.LOW, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=index))
                for index, member in enumerate(members)]
        # Same title is explicitly unrelated; a legacy ID collision in another project stays separate.
        unrelated = models.Task(id=str(uuid4()), title="Shared mission", project_id=projects[0].id,
                                created_by_id=owner.id, assigned_to_id=owner.id)
        collision = models.Task(id=str(uuid4()), title="Other project", task_group_id=group_id,
                                project_id=projects[1].id, created_by_id=owner.id, assigned_to_id=owner.id)
        foreign = models.Task(id=str(uuid4()), title="Foreign private", task_group_id=group_id,
                              created_by_id=outsider.id, assigned_to_id=outsider.id)
        private = [models.Task(id=str(uuid4()), title="Private group", task_group_id="private-group",
                               created_by_id=owner.id, assigned_to_id=member.id) for member in members]
        db.add_all([*rows, unrelated, collision, foreign, *private]); db.commit()
    def session():
        with factory() as db:
            yield db
    def actor(db=Depends(get_db), x_actor: str | None = Header(None)):  # noqa: B008
        return db.get(models.User, x_actor or owner.id)
    app = FastAPI(); app.include_router(tasks.router, prefix="/api")
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_active_user] = actor
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, factory=factory, engine=engine, owner=owner, outsider=outsider,
                              members=members, rows=rows, unrelated=unrelated, collision=collision,
                              foreign=foreign, private=private, projects=projects, group_id=group_id)


def page(data, **params):
    response = data.client.get("/api/tasks/page", params={"grouped": True, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_eight_assignments_are_one_logical_task_without_merging_titles_or_scopes(grouped):
    data = grouped
    result = page(data, project_id=data.projects[0].id)
    assert result["total"] == 2
    assert sum(result["status_counts"].values()) == 2
    group = next(item for item in result["items"] if item["task_group_id"] == data.group_id)
    assert {item["id"] for item in group["group_assignments"]} == {row.id for row in data.rows}
    assert len({item["assigned_member"]["id"] for item in group["group_assignments"]}) == 8
    assert set(group["group_assignments"][0]["assigned_member"]) == {"id", "name", "avatar_url"}
    legacy = data.client.get("/api/tasks/page", params={"project_id": data.projects[0].id}).json()
    assert legacy["total"] == 9
    assert all(item["group_assignments"] is None for item in legacy["items"])
    kanban = data.client.get("/api/tasks/kanban", params={"project_id": data.projects[0].id})
    assert kanban.status_code == 200, kanban.text
    columns = kanban.json()["columns"]
    assert sum(column["count"] for column in columns) == 9
    assert {item["id"] for column in columns for item in column["items"]} == {row.id for row in data.rows} | {data.unrelated.id}
    detail = data.client.get(f"/api/tasks/{data.rows[0].id}/group")
    assert {row["id"] for row in detail.json()} == {row.id for row in data.rows}


def test_filters_match_visible_members_before_logical_pagination_and_preserve_details(grouped):
    data = grouped
    result = page(data, project_id=data.projects[0].id, assignee_id=data.members[0].id, status="DONE", search="Shared")
    assert result["total"] == 1
    assert result["items"][0]["id"] == data.rows[0].id
    assert len(result["items"][0]["group_assignments"]) == 8
    assert result["status_counts"] == {"DONE": 1}
    first = page(data, page_size=1, sort_by="title", sort_order="asc")
    second = page(data, page=2, page_size=1, sort_by="title", sort_order="asc")
    assert first["total"] == 4 and first["has_more"]
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert page(data, search="absent")["total"] == 0
    assert page(data, page=100)["items"] == []
    seen = []
    cursor = None
    for _ in range(5):
        result = page(data, page_size=1, sort_by="created_at", cursor=cursor)
        seen.extend(item["id"] for item in result["items"])
        cursor = result["next_cursor"]
        if not result["has_more"]:
            break
    assert len(seen) == 4 and len(set(seen)) == 4
    assert data.client.get("/api/tasks/page", params={"grouped": True, "cursor": "invalid"}).status_code == 422


def test_tenant_and_assignment_visibility_do_not_leak_group_members(grouped):
    data = grouped
    response = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.outsider.id})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["group_assignments"][0]["id"] == data.foreign.id
    response = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.members[0].id})
    assert response.status_code == 200
    private = next(item for item in response.json()["items"] if item["task_group_id"] == "private-group")
    assert [member["id"] for member in private["group_assignments"]] == [data.private[0].id]
    assert data.client.get(f"/api/tasks/{data.rows[0].id}/group", headers={"x-actor": data.outsider.id}).status_code == 404


def test_member_loading_is_batched_and_read_does_not_change_business_data(grouped):
    data = grouped
    with data.factory() as db:
        before = [(row.id, row.status, row.assigned_to_id, row.task_group_id, row.completed_at)
                  for row in db.scalars(select(models.Task).order_by(models.Task.id))]
        points_before = [(row.id, row.points, row.tasks_completed) for row in db.scalars(select(models.User).order_by(models.User.id))]
        history_before = list(db.scalars(select(models.TaskLifecycleEvent.id)))
    queries = []
    def query(_conn, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)
    event.listen(data.engine, "before_cursor_execute", query)
    try:
        result = page(data)
    finally:
        event.remove(data.engine, "before_cursor_execute", query)
    assert len(result["items"]) == 4
    assert len(queries) <= 12, "Group member reads must not issue per-assignment queries"
    with data.factory() as db:
        assert before == [(row.id, row.status, row.assigned_to_id, row.task_group_id, row.completed_at)
                          for row in db.scalars(select(models.Task).order_by(models.Task.id))]
        assert points_before == [(row.id, row.points, row.tasks_completed) for row in db.scalars(select(models.User).order_by(models.User.id))]
        assert history_before == list(db.scalars(select(models.TaskLifecycleEvent.id)))


def test_group_creation_and_reassignment_reject_foreign_or_duplicate_assignments(grouped):
    data = grouped
    base = {"title": "Shared mission", "project_id": data.projects[0].id, "priority": "LOW", "status": "TODO"}
    # Another tenant's group ID cannot be reused even by an owner.
    response = data.client.post("/api/tasks", json={**base, "task_group_id": data.group_id, "assigned_to_ids": [data.owner.id]})
    assert response.status_code in {404, 422}, response.text
    response = data.client.patch(f"/api/tasks/{data.rows[0].id}", json={"assigned_to_id": data.members[1].id})
    assert response.status_code == 409, response.text
    response = data.client.patch(f"/api/tasks/{data.private[0].id}", headers={"x-actor": data.members[0].id}, json={"title": "Unauthorized shared edit"})
    assert response.status_code == 403, response.text
    with data.factory() as db:
        assert {row.title for row in db.scalars(select(models.Task).where(models.Task.task_group_id == "private-group"))} == {"Private group"}
    response = data.client.post("/api/tasks", json={**base, "assigned_to_ids": [data.members[0].id] * 3})
    assert response.status_code == 201, response.text
    assert len(response.json()) == 1


def test_concurrent_group_additions_keep_one_assignment_and_one_creation_reward(grouped):
    data = grouped
    if data.engine.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL")
    # Create an otherwise empty, project-scoped group to avoid the intentionally corrupt collision fixture.
    base = {"title": "Concurrent mission", "project_id": data.projects[0].id, "priority": "LOW", "status": "TODO",
            "task_group_id": str(uuid4()), "assigned_to_ids": [data.members[0].id]}
    assert data.client.post("/api/tasks", json=base).status_code == 201
    payload = {**base, "assigned_to_ids": [data.members[1].id]}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: data.client.post("/api/tasks", json=payload), range(2)))
    assert [response.status_code for response in results] == [201, 201]
    assert sorted(len(response.json()) for response in results) == [0, 1]
    with data.factory() as db:
        assert len(list(db.scalars(select(models.Task).where(models.Task.task_group_id == base["task_group_id"])))) == 2


def test_create_eight_move_one_and_keep_grouped_summary_synchronized(grouped):
    data = grouped
    response = data.client.post("/api/tasks", json={"title": "Eight-person acceptance task",
        "project_id": data.projects[0].id, "priority": "LOW", "status": "TODO",
        "assigned_to_ids": [member.id for member in data.members]})
    assert response.status_code == 201, response.text
    created = response.json()
    assert len(created) == 8 and len({task["task_group_id"] for task in created}) == 1
    first = created[0]
    with data.factory() as db:
        destination = db.scalar(select(models.TaskStatus).where(models.TaskStatus.tenant_id == data.owner.tenant_id,
                                                                models.TaskStatus.legacy_status == "IN_PROGRESS"))
        points = {user.id: user.points for user in db.scalars(select(models.User))}
    response = data.client.patch(f"/api/tasks/{first['id']}/kanban-status", json={"status_id": destination.id})
    assert response.status_code == 200, response.text
    result = page(data, search="Eight-person")
    assert result["total"] == 1 and len(result["items"][0]["group_assignments"]) == 8
    assert sum(member["status"] == "IN_PROGRESS" for member in result["items"][0]["group_assignments"]) == 1
    kanban = data.client.get("/api/tasks/kanban", params={"search": "Eight-person"}).json()
    assert sum(column["count"] for column in kanban["columns"]) == 8
    assert sum(member["status"] == "IN_PROGRESS" for column in kanban["columns"] for member in column["items"]) == 1
    with data.factory() as db:
        assert points == {user.id: user.points for user in db.scalars(select(models.User))}
    response = data.client.delete(f"/api/tasks/{first['id']}")
    assert response.status_code in {200, 204}, response.text
    result = page(data, search="Eight-person")
    assert result["total"] == 1 and len(result["items"][0]["group_assignments"]) == 7


def test_template_multi_assignment_deduplicates_and_validates_tenant(grouped):
    data = grouped
    with data.factory() as db:
        template = models.TaskTemplate(title="Template mission", created_by_id=data.owner.id)
        db.add(template); db.commit()
    response = data.client.post(f"/api/tasks/task-templates/{template.id}/assign", json={
        "assignment_type": "multiple", "user_ids": [data.members[0].id] * 3})
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    response = data.client.post(f"/api/tasks/task-templates/{template.id}/assign", json={
        "assignment_type": "multiple", "user_ids": [data.outsider.id]})
    assert response.status_code == 404, response.text


def test_transfer_paths_cannot_duplicate_group_assignments_or_cross_tenants(grouped):
    data = grouped
    response = data.client.post(f"/api/tasks/{data.rows[0].id}/transfer-requests", json={"to_user_id": data.members[1].id})
    assert response.status_code == 409, response.text
    response = data.client.post("/api/tasks/transfer", json={"from_user_id": data.members[0].id,
                                                          "to_user_id": data.members[1].id, "statuses": ["DONE"]})
    assert response.status_code == 409, response.text
    with data.factory() as db:
        pending = models.TaskTransferRequest(task_id=data.rows[0].id, from_user_id=data.members[0].id,
                                            to_user_id=data.members[1].id, requested_by_id=data.members[0].id)
        foreign = models.TaskTransferRequest(task_id=data.foreign.id, from_user_id=data.outsider.id,
                                            to_user_id=data.outsider.id, requested_by_id=data.outsider.id)
        db.add_all([pending, foreign]); db.commit()
    response = data.client.post(f"/api/tasks/transfer-requests/{pending.id}/approve", json={"decision": "approved"})
    assert response.status_code == 409, response.text
    response = data.client.post(f"/api/tasks/transfer-requests/{foreign.id}/approve", json={"decision": "rejected"})
    assert response.status_code == 404, response.text
    with data.factory() as db:
        assert db.get(models.TaskTransferRequest, pending.id).status == models.TaskTransferStatusEnum.PENDING
        assert db.get(models.Task, data.rows[0].id).assigned_to_id == data.members[0].id
    response = data.client.post(f"/api/tasks/{data.rows[0].id}/transfer-requests", json={"to_user_id": data.owner.id})
    assert response.status_code == 422, response.text
    with data.factory() as db:
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=data.projects[0].id,
                                    user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MEMBER))
        db.commit()
    response = data.client.post(f"/api/tasks/{data.rows[0].id}/transfer-requests", json={"to_user_id": data.owner.id})
    assert response.status_code == 200, response.text
    with data.factory() as db:
        assert db.get(models.Task, data.rows[0].id).assigned_to_id == data.owner.id
    response = data.client.post("/api/tasks", json={"title": "Invalid group", "project_id": data.projects[0].id,
                                                  "task_group_id": "x" * 37})
    assert response.status_code == 422


def test_concurrent_reassignments_to_the_same_member_do_not_create_duplicates(grouped):
    data = grouped
    if data.engine.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL")
    # Make owner a permitted target without granting other members extra task visibility.
    with data.factory() as db:
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=data.projects[0].id,
                                    user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MEMBER))
        db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda task: data.client.patch(f"/api/tasks/{task.id}", json={"assigned_to_id": data.owner.id}), data.rows[:2]))
    assert sorted(response.status_code for response in results) == [200, 409]
    with data.factory() as db:
        assert len(list(db.scalars(select(models.Task).where(models.Task.task_group_id == data.group_id,
            models.Task.project_id == data.projects[0].id, models.Task.assigned_to_id == data.owner.id)))) == 1


def test_legacy_missing_group_id_cannot_alias_an_explicit_group_id(grouped):
    data = grouped
    with data.factory() as db:
        standalone = models.Task(id=str(uuid4()), title="Duplicate title", task_group_id="",
            project_id=data.projects[0].id, created_by_id=data.owner.id, assigned_to_id=data.owner.id)
        explicit = models.Task(id=str(uuid4()), title="Duplicate title", task_group_id=standalone.id,
            project_id=data.projects[0].id, created_by_id=data.owner.id, assigned_to_id=data.members[0].id)
        db.add_all([standalone, explicit]); db.commit()
    result = page(data, search="Duplicate title")
    assert result["total"] == 2
    assert {item["id"] for item in result["items"]} == {standalone.id, explicit.id}
    assert all(len(item["group_assignments"]) == 1 for item in result["items"])
    for task in (standalone, explicit):
        detail = data.client.get(f"/api/tasks/{task.id}/group")
        assert detail.status_code == 200, detail.text
        assert [item["id"] for item in detail.json()] == [task.id]


def test_duplicate_titles_across_projects_and_tenants_never_merge(grouped):
    data = grouped
    with data.factory() as db:
        db.get(models.Task, data.collision.id).title = "Shared mission"
        customer = models.Client(tenant_id=data.outsider.tenant_id, company_name="Foreign customer",
            normalized_company_name=str(uuid4()), country="India")
        db.add(customer); db.flush()
        project = models.Project(tenant_id=data.outsider.tenant_id, client_id=customer.id,
            name="Foreign project", normalized_name=str(uuid4()))
        db.add(project); db.flush()
        foreign = models.Task(title="Shared mission", task_group_id=data.group_id,
            project_id=project.id, created_by_id=data.outsider.id, assigned_to_id=data.outsider.id)
        db.add(foreign); db.commit()
    result = page(data, search="Shared mission")
    assert result["total"] == 3
    assert len({item["project_id"] for item in result["items"]}) == 2
    for item in result["items"]:
        assert all(member["project_id"] == item["project_id"] for member in item["group_assignments"])
        assert foreign.id not in {member["id"] for member in item["group_assignments"]}
    for role in models.RoleEnum:
        with data.factory() as db:
            db.get(models.User, data.outsider.id).role = role; db.commit()
        response = data.client.get("/api/tasks/page", params={"grouped": True, "search": "Shared mission"},
            headers={"x-actor": data.outsider.id})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        assert [item["id"] for item in response.json()["items"][0]["group_assignments"]] == [foreign.id]


def test_project_move_cannot_merge_existing_distinct_groups(grouped):
    data = grouped
    response = data.client.patch(f"/api/tasks/{data.rows[0].id}", json={"project_id": data.projects[1].id})
    assert response.status_code == 409, response.text
    with data.factory() as db:
        assert db.get(models.Task, data.rows[0].id).project_id == data.projects[0].id
        assert db.get(models.Task, data.collision.id).title == "Other project"


def test_group_pagination_sorting_and_null_cursor_matrix(grouped):
    data = grouped
    with data.factory() as db:
        for index, task in enumerate(db.scalars(select(models.Task).where(models.Task.created_by_id == data.owner.id).order_by(models.Task.id))):
            task.priority = list(models.TaskPriorityEnum)[index % 4]
            task.due_at = None if index % 3 == 0 else datetime(2026, 2, 1, 12, index, tzinfo=timezone.utc)
            task.updated_at = datetime(2026, 3, 1, 12, index, tzinfo=timezone.utc)
        db.commit()
        names = {user.id: user.name for user in db.scalars(select(models.User))}
    def sort_value(item, field):
        if field == "priority":
            return ["LOW", "MEDIUM", "HIGH", "URGENT"].index(item["priority"])
        if field == "status":
            return [status.value for status in models.TaskStatusEnum].index(item["status"])
        if field == "assignee":
            return names.get(item["assigned_to_id"])
        if field == "title":
            return item["title"]
        value = item[{"created_at": "created_at", "lastUpdated": "updated_at", "dueAt": "due_at"}[field]]
        return datetime.fromisoformat(value).replace(tzinfo=None) if value else None
    def expected_order(items, field, order):
        present = [item for item in items if sort_value(item, field) is not None]
        absent = [item for item in items if sort_value(item, field) is None]
        reverse = order == "desc"
        return sorted(present, key=lambda item: (sort_value(item, field), item["id"]), reverse=reverse) + sorted(
            absent, key=lambda item: item["id"], reverse=reverse)
    for sort_by in ("title", "priority", "status", "assignee", "created_at", "lastUpdated", "dueAt"):
        for order in ("asc", "desc"):
            full = page(data, sort_by=sort_by, sort_order=order, page_size=200)
            assert full["total"] == 4
            expected = [item["id"] for item in full["items"]]
            assert expected == [item["id"] for item in expected_order(full["items"], sort_by, order)]
            for item in full["items"]:
                assert item["id"] == expected_order(item["group_assignments"], sort_by, order)[0]["id"]
            actual = []
            for number in (1, 2):
                result = page(data, sort_by=sort_by, sort_order=order, page_size=2, page=number)
                actual.extend(item["id"] for item in result["items"])
                assert result["total_pages"] == 2
                assert sum(result["status_counts"].values()) == 4
            assert actual == expected, (sort_by, order)
            if sort_by in {"created_at", "lastUpdated", "dueAt"}:
                actual, cursor = [], None
                for _ in range(5):
                    result = page(data, sort_by=sort_by, sort_order=order, page_size=1, cursor=cursor)
                    actual.extend(item["id"] for item in result["items"])
                    if not result["has_more"]:
                        break
                    cursor = result["next_cursor"]
                assert actual == expected, (sort_by, order, actual, expected)
    for sort_by in ("created_at", "lastUpdated"):
        assert data.client.get("/api/tasks/page", params={"grouped": True, "sort_by": sort_by, "cursor": "|id"}).status_code == 422
    # Every member has a null deadline: cursor pagination must still visit each group exactly once.
    with data.factory() as db:
        for task in db.scalars(select(models.Task)):
            task.due_at = None
        db.commit()
    for order in ("asc", "desc"):
        ids, cursor = [], None
        for _ in range(5):
            result = page(data, sort_by="dueAt", sort_order=order, page_size=1, cursor=cursor)
            ids.extend(item["id"] for item in result["items"])
            if not result["has_more"]:
                break
            cursor = result["next_cursor"]
        assert len(ids) == len(set(ids)) == 4


def test_visibility_revocation_during_member_loading_never_returns_stale_representative(grouped, monkeypatch):
    data = grouped
    original = tasks._apply_task_visibility
    calls = 0
    def visibility(statement, user):
        nonlocal calls
        calls += 1
        statement = original(statement, user)
        if calls == 2:
            statement = statement.where(models.Task.id != data.rows[0].id)
        return statement
    monkeypatch.setattr(tasks, "_apply_task_visibility", visibility)
    response = data.client.get("/api/tasks/page", params={"grouped": True, "project_id": data.projects[0].id,
        "assignee_id": data.members[0].id, "status": "DONE"})
    assert response.status_code == 409, response.text
    assert "visibility changed" in response.json()["detail"]


def test_grouped_requests_do_not_reuse_stale_authorization_payloads(grouped, monkeypatch):
    data = grouped
    payloads = {}
    monkeypatch.setattr(tasks, "get_cached_json", payloads.get)
    monkeypatch.setattr(tasks, "set_cached_json", lambda key, value, **_: payloads.__setitem__(key, value))
    assert page(data)["total"] == 4
    plain = data.client.get("/api/tasks/page").json()
    assert plain["total"] == 18
    outsider = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.outsider.id}).json()
    assert outsider["total"] == 1
    member = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.members[0].id}).json()
    assert member["total"] == 3
    assert page(data, assignee_id=data.members[0].id)["total"] == 2
    assert len(payloads) == 1  # Only the unchanged assignment API uses the backend payload cache.
    owner_payload = page(data)
    monkeypatch.setattr(tasks, "get_cached_json", lambda _: owner_payload)
    foreign_response = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.outsider.id})
    assert foreign_response.status_code == 200
    assert foreign_response.json()["total"] == 1
    assert foreign_response.json()["items"][0]["id"] == data.foreign.id
    # A same-account permission downgrade must not retain an owner's task population.
    with data.factory() as db:
        member = db.get(models.User, data.members[0].id)
        member.role = models.RoleEnum.OWNER
        db.commit()
    elevated = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.members[0].id}).json()
    assert elevated["total"] == 4
    monkeypatch.setattr(tasks, "get_cached_json", lambda _: elevated)
    with data.factory() as db:
        member = db.get(models.User, data.members[0].id)
        member.role = models.RoleEnum.USER
        memberships = db.scalars(select(models.ProjectMember).where(models.ProjectMember.user_id == member.id)).all()
        for membership in memberships:
            db.delete(membership)
        db.commit()
    restricted = data.client.get("/api/tasks/page", params={"grouped": True}, headers={"x-actor": data.members[0].id}).json()
    assert restricted["total"] == 2
    assert all(len(item["group_assignments"]) == 1 for item in restricted["items"])


def test_group_read_preserves_all_historical_rows_and_hidden_status_assignments(grouped):
    data = grouped
    from backend.app.services import task_statuses
    with data.factory() as db:
        task_statuses.scope(db, data.owner)
        custom = models.TaskStatus(tenant_id=data.owner.tenant_id, code="CUSTOM_RETAINED",
            system_name="Retained stage", normalized_name="retained stage", display_label="Retained stage",
            normalized_label="retained stage", is_system=False, is_active=True, kanban_visible=False)
        db.add(custom); db.flush()
        row = db.get(models.Task, data.rows[2].id)
        row.custom_status_id = custom.id
        row.attachments = ["historical-proof.pdf"]
        row.tags = ["historical"]
        db.add(models.Comment(task_id=row.id, user_id=data.members[2].id, content="Historic member-specific comment"))
        db.add(models.TimeEntry(tenant_id=data.owner.tenant_id, user_id=data.members[2].id, task_id=row.id,
            started_at=datetime(2026, 1, 1, tzinfo=timezone.utc), stopped_at=None, duration_seconds=None,
            status=models.TimeEntryStatusEnum.ACTIVE))
        db.commit()
        # Custom statuses with references cannot be archived; optional legacy stages
        # may be deactivated while preserving their historical task assignments.
        db.get(models.Task, data.rows[3].id).status = models.TaskStatusEnum.BUG_FIXING
        db.commit()
        legacy = db.scalar(select(models.TaskStatus).where(models.TaskStatus.tenant_id == data.owner.tenant_id,
                                                          models.TaskStatus.legacy_status == "BUG_FIXING"))
        legacy.is_active = False
        db.commit()
    tables = (models.Task, models.Subtask, models.Comment, models.TimeEntry, models.TaskLifecycleEvent,
              models.TaskHoldInterval, models.Notification, models.AuditEvent)
    def snapshot():
        with data.factory() as db:
            return {model.__tablename__: [dict(row) for row in db.execute(select(model.__table__).order_by(model.__table__.c.id)).mappings()]
                    for model in tables}
    before = snapshot()
    for _ in range(3):
        result = page(data, project_id=data.projects[0].id)
        members = [member for item in result["items"] for member in item["group_assignments"]]
        retained = next(member for member in members if member["id"] == data.rows[2].id)
        assert retained["custom_status_id"] == custom.id
        assert retained["attachments"] == ["historical-proof.pdf"]
        inactive = next(member for member in members if member["id"] == data.rows[3].id)
        assert inactive["status"] == "BUG_FIXING"
    assert before == snapshot()


def test_completion_rewards_and_events_are_per_assignment_and_idempotent_with_group_reads(grouped):
    data = grouped
    response = data.client.post("/api/tasks", json={"title": "Protected group rewards", "priority": "LOW",
        "status": "TODO", "project_id": data.projects[0].id, "assigned_to_ids": [member.id for member in data.members]})
    assert response.status_code == 201, response.text
    created = response.json()
    first = created[0]
    with data.factory() as db:
        destinations = {row.legacy_status: row.id for row in db.scalars(select(models.TaskStatus).where(
            models.TaskStatus.tenant_id == data.owner.tenant_id))}
        before_points = {row.id: row.points for row in db.scalars(select(models.User))}
    def move(value):
        result = data.client.patch(f"/api/tasks/{first['id']}/kanban-status", json={"status_id": destinations[value]})
        assert result.status_code == 200, result.text
    move("IN_PROGRESS"); move("DONE")
    with data.factory() as db:
        after_points = {row.id: row.points for row in db.scalars(select(models.User))}
        winner = first["assigned_to_id"]
        assert after_points[winner] > before_points[winner]
        assert all(value == after_points[user_id] for user_id, value in before_points.items() if user_id != winner)
        before_notices = sorted(db.scalars(select(models.Notification.id)))
        before_events = list(db.scalars(select(models.TaskLifecycleEvent.id)))
    move("DONE")
    assert page(data, search="Protected group rewards")["total"] == 1
    with data.factory() as db:
        assert before_notices == sorted(db.scalars(select(models.Notification.id)))
        assert before_events == list(db.scalars(select(models.TaskLifecycleEvent.id)))
    move("IN_PROGRESS"); move("DONE")
    with data.factory() as db:
        assert after_points == {row.id: row.points for row in db.scalars(select(models.User))}
        assert all(db.get(models.Task, row["id"]).status == models.TaskStatusEnum.TODO for row in created[1:])
        events = list(db.scalars(select(models.TaskLifecycleEvent).where(models.TaskLifecycleEvent.task_id == first["id"]).order_by(models.TaskLifecycleEvent.id)))
        assert [row.new_status for row in events if row.event_type == "task.status_changed"] == ["IN_PROGRESS", "DONE", "IN_PROGRESS", "DONE"]


def test_group_member_query_count_stays_bounded_as_page_grows(grouped):
    data = grouped
    with data.factory() as db:
        for index in range(60):
            group_id = str(uuid4())
            db.add_all([models.Task(title=f"Scale group {index}", task_group_id=group_id,
                project_id=data.projects[0].id, created_by_id=data.owner.id, assigned_to_id=member.id,
                created_at=datetime(2030, 1, 1, tzinfo=timezone.utc)) for member in data.members])
        db.commit()
    def measured(size):
        queries = []
        def query(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith("SELECT"):
                queries.append(statement)
        event.listen(data.engine, "before_cursor_execute", query)
        try:
            response = page(data, page_size=size)
        finally:
            event.remove(data.engine, "before_cursor_execute", query)
        assert response["total"] == 64
        assert len(response["items"]) == size
        assert sum(len(task["group_assignments"]) for task in response["items"]) == size * 8
        return len(queries)
    assert measured(5) == measured(40) <= 12


def test_custom_assignment_moves_notify_specific_labels_without_changing_peers(grouped):
    data = grouped
    with data.factory() as db:
        tasks.status_service.scope(db, data.owner)
        stages = [models.TaskStatus(tenant_id=data.owner.tenant_id, code=f"CUSTOM_REVIEW_{index}",
            system_name=f"Review {index}", normalized_name=f"review {index}", display_label=f"Review {index}",
            normalized_label=f"review {index}", is_system=False) for index in range(2)]
        db.add_all(stages); db.commit()
    selected = data.rows[2]
    for stage in stages:
        response = data.client.patch(f"/api/tasks/{selected.id}", json={"custom_status_id": stage.id})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "IN_PROGRESS"
    with data.factory() as db:
        notices = list(db.scalars(select(models.Notification).where(models.Notification.related_task_id == selected.id)))
        assert any("from Review 0 to Review 1." in notice.message for notice in notices)
        notice_ids = {notice.id for notice in notices}
        assert all(db.get(models.Task, row.id).custom_status_id is None for row in data.rows if row.id != selected.id)
    response = data.client.patch(f"/api/tasks/{selected.id}", json={"custom_status_id": stages[-1].id})
    assert response.status_code == 200, response.text
    with data.factory() as db:
        assert notice_ids == set(db.scalars(select(models.Notification.id).where(models.Notification.related_task_id == selected.id)))


def test_grouped_filters_combine_exact_tags_dates_priority_team_and_quick_scope(grouped):
    data = grouped
    tag = "raid_100%"
    with data.factory() as db:
        matching = db.get(models.Task, data.rows[0].id)
        matching.team = "Guild filter"
        matching.tags = ["first", tag, "last"]
        matching.due_at = datetime(2026, 1, 2, 23, 59, 59, 999999, tzinfo=timezone.utc)
        near = db.get(models.Task, data.rows[1].id)
        near.team = "Guild filter"
        near.tags = [tag + "-other"]
        near.due_at = matching.due_at
        db.commit()
    params = {"project_id": data.projects[0].id, "search": "Shared", "team": "Guild filter",
              "priority": "LOW", "status": "DONE", "tag": tag,
              "due_date": "2026-01-02", "created_date": "2026-01-01", "timezone": "UTC",
              "quick_filter": "createdByMe"}
    result = page(data, **params)
    assert result["total"] == 1
    assert result["items"][0]["id"] == data.rows[0].id
    assert len(result["items"][0]["group_assignments"]) == 8
    plain = data.client.get("/api/tasks/page", params=params)
    assert plain.status_code == 200, plain.text
    assert [item["id"] for item in plain.json()["items"]] == [data.rows[0].id]
    kanban = data.client.get("/api/tasks/kanban", params=params)
    assert kanban.status_code == 200, kanban.text
    assert sum(column["count"] for column in kanban.json()["columns"]) == 1
    assert [item["id"] for column in kanban.json()["columns"] for item in column["items"]] == [data.rows[0].id]
    params["quick_filter"] = "myTasks"
    response = data.client.get("/api/tasks/page", params={"grouped": True, **params}, headers={"x-actor": data.members[0].id})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert page(data, **{**params, "tag": "100%"})["total"] == 0
