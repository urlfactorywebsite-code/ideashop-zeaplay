"""Reporting uses isolated deterministic data; shared/local deployment DBs are never touched."""
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from backend.app import models as m
from backend.app.database import get_db
from backend.app.reporting.filters import build_filters
from backend.app.reporting import inventory
from backend.app.routers.reports import router
from backend.tests.test_task_lifecycle import engine, auth  # isolated SQLite/PostgreSQL fixtures


UTC = timezone.utc
STAMP = datetime(2026, 10, 20, 12, tzinfo=UTC)


@pytest.fixture
def dataset(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    tenant = uuid4()
    other_tenant = uuid4()
    with factory() as db:
        def user(name, role=m.RoleEnum.USER, tid=tenant, **kw):
            row = m.User(id=str(uuid4()), tenant_id=tid, name=name, email=f"{uuid4()}@example.test",
                         hashed_password="fixture-only", role=role, **kw)
            db.add(row)
            return row
        owner = user("Owner", m.RoleEnum.OWNER)
        manager = user("Manager", m.RoleEnum.MANAGER)
        alice = user("Alice")
        bob = user("Bob", status=m.UserStatusEnum.DEACTIVATED)
        zero = user("Zero")
        outsider = user("Foreign", m.RoleEnum.OWNER, other_tenant)
        db.flush()
        client = m.Client(tenant_id=tenant, company_name="Client", normalized_company_name="client")
        other_client = m.Client(tenant_id=other_tenant, company_name="Secret", normalized_company_name="secret")
        db.add_all([client, other_client])
        db.flush()
        project = m.Project(tenant_id=tenant, client_id=client.id, name="Archive", normalized_name="archive",
                            status=m.ProjectStatusEnum.ARCHIVED)
        hidden = m.Project(tenant_id=tenant, client_id=client.id, name="Other project", normalized_name="other project")
        foreign = m.Project(tenant_id=other_tenant, client_id=other_client.id, name="Foreign project", normalized_name="foreign project")
        db.add_all([project, hidden, foreign])
        db.flush()
        for person, role in [(manager, m.ProjectMemberRoleEnum.MANAGER), (alice, m.ProjectMemberRoleEnum.MEMBER),
                             (bob, m.ProjectMemberRoleEnum.MEMBER)]:
            db.add(m.ProjectMember(tenant_id=tenant, project_id=project.id, user_id=person.id, role=role))
        group = str(uuid4())
        def task(title, person=None, status=m.TaskStatusEnum.TODO, proj=project, creator=owner, **kw):
            row = m.Task(id=str(uuid4()), title=title, assigned_to_id=person.id if person else None,
                         assigned_at=datetime(2026, 10, 19) if person else None,
                         created_by_id=creator.id, project_id=proj.id if proj else None, status=status,
                         created_at=datetime(2026, 10, 19, 12), due_at=datetime(2026, 10, 18), **kw)
            db.add(row)
            return row
        first = task("Shared", alice, m.TaskStatusEnum.DONE, task_group_id=group,
                     completed_at=datetime(2026, 10, 19, 14))
        second = task("Shared", bob, m.TaskStatusEnum.BLOCKED, task_group_id=group)
        free = task("Unassigned")
        running = task("Progress", alice, m.TaskStatusEnum.IN_PROGRESS)
        private = task("Private", zero, proj=hidden)
        excluded = task("Other tenant task", outsider, proj=foreign, creator=outsider)
        db.flush()
        db.add_all([
            m.Subtask(task_id=first.id, title="Complete child", assigned_to_id=alice.id,
                      status=m.SubtaskStatusEnum.DONE, completed=True),
            m.Subtask(task_id=first.id, title="Still pending", assigned_to_id=alice.id,
                      status=m.SubtaskStatusEnum.TODO),
            m.Subtask(task_id=second.id, title="Bob child", assigned_to_id=bob.id),
        ])
        db.commit()
    return SimpleNamespace(**locals())


@pytest.fixture
def client(dataset):
    app = FastAPI()
    app.include_router(router, prefix="/api")
    def db():
        with dataset.factory() as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as result:
        yield result


def request(client, user, path, **params):
    response = client.get("/api/reports/" + path, headers=auth(user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_unique_task_and_assignment_group_totals_reconcile(dataset, client):
    body = request(client, dataset.owner, "overview", project_id=dataset.project.id)
    metrics = body["metrics"]
    assert metrics["total_tasks"] == 4
    assert metrics["assigned_tasks"] == 3 and metrics["unassigned_tasks"] == 1
    assert metrics["unique_task_groups"] == 3
    assert metrics["completed_tasks"] == 1 and metrics["blocked_tasks"] == 1
    assert metrics["pending_tasks"] == 1 and metrics["in_progress_tasks"] == 1
    assert metrics["overdue_tasks"] == 3
    assert metrics["completion_percentage"] == 25
    assert sum(row["count"] for row in body["status_distribution"]) == metrics["total_tasks"]
    assert body["meta"]["date_semantics"] == "task.created_at"


def test_employees_include_zero_and_inactive_and_child_joins_do_not_multiply(dataset, client):
    body = request(client, dataset.owner, "employees", project_id=dataset.project.id)
    people = {row["name"]: row for row in body["items"]}
    assert people["Alice"]["assigned_parent_tasks"] == 2
    assert people["Alice"]["assigned_subtasks"] == 2
    assert people["Alice"]["completed_parent_tasks"] == 1
    assert people["Alice"]["project_count"] == 1
    assert people["Bob"]["status"] == "DEACTIVATED"
    assert people["Zero"]["assigned_parent_tasks"] == 0
    assert "Foreign" not in people


def test_all_combined_filters_and_pagination(dataset, client):
    params = {"from": "2026-10-19", "to": "2026-10-19", "timezone": "UTC",
              "employee_id": dataset.alice.id, "project_id": dataset.project.id,
              "status": "DONE", "search": "Shared", "page_size": 1}
    tasks = request(client, dataset.owner, "tasks", **params)
    assert tasks["total"] == 1 and tasks["items"][0]["id"] == dataset.first.id
    assert tasks["items"][0]["total_subtasks"] == 2
    assert tasks["items"][0]["completed_subtasks"] == 1
    assert tasks["items"][0]["status"] == "DONE"  # deliberately incomplete child does not overwrite parent
    assert request(client, dataset.owner, "overview", **params)["metrics"]["total_tasks"] == 1
    assert request(client, dataset.owner, "tasks", **{**params, "page": 2})["items"] == []
    with dataset.factory() as db:
        assert db.get(m.Task, dataset.first.id).status == m.TaskStatusEnum.DONE


def test_archive_preserved_and_not_inferred_complete(dataset, client):
    result = request(client, dataset.owner, "projects", project_id=dataset.project.id)
    item = result["items"][0]
    assert item["status"] == "ARCHIVED"
    assert item["total_tasks"] == 4 and item["completed_tasks"] == 1
    assert item["total_subtasks"] == 3 and item["completed_subtasks"] == 1
    assert item["managers"] == [{"id": dataset.manager.id, "name": "Manager"}]


def test_manager_and_regular_scope_and_filter_injection(dataset, client):
    assert request(client, dataset.manager, "overview")["metrics"]["total_tasks"] == 4
    assert request(client, dataset.alice, "overview")["metrics"]["total_tasks"] == 2
    assert [row["id"] for row in request(client, dataset.alice, "options")["employees"]] == [dataset.alice.id]
    for user, params in [(dataset.manager, {"project_id": dataset.hidden.id}),
                         (dataset.alice, {"employee_id": dataset.bob.id}),
                         (dataset.owner, {"project_id": dataset.foreign.id}),
                         (dataset.owner, {"employee_id": dataset.outsider.id})]:
        response = client.get("/api/reports/overview", params=params, headers=auth(user))
        assert response.status_code == 404
    assert client.get("/api/reports/overview").status_code == 401
    assert client.get("/api/reports/overview", headers=auth(dataset.bob)).status_code == 403


def test_date_boundaries_are_half_open_and_dst_aware(dataset, client):
    with dataset.factory() as db:
        db.get(m.Task, dataset.first.id).created_at = datetime(2026, 10, 18, 18, 30)
        db.get(m.Task, dataset.second.id).created_at = datetime(2026, 10, 19, 18, 30)
        db.commit()
    body = request(client, dataset.owner, "tasks", **{"from": "2026-10-19", "to": "2026-10-19",
                                                      "timezone": "Asia/Kolkata", "search": "Shared"})
    assert [row["id"] for row in body["items"]] == [dataset.first.id]
    spring = build_filters(from_date=date(2026, 3, 8), to_date=date(2026, 3, 8), timezone="America/New_York")
    fall = build_filters(from_date=date(2026, 11, 1), to_date=date(2026, 11, 1), timezone="America/New_York")
    assert spring.end_at - spring.start_at == timedelta(hours=23)
    assert fall.end_at - fall.start_at == timedelta(hours=25)


@pytest.mark.parametrize("params", [
    {"from": "2026-10-20", "to": "2026-10-19"}, {"timezone": "Bad/Zone"},
    {"status": "COMPLETED"}, {"page_size": 101}, {"sort": "password"}, {"direction": "bad"},
    {"from": "0001-01-01", "timezone": "Asia/Kolkata"},
])
def test_invalid_filter_input_rejected(dataset, client, params):
    response = client.get("/api/reports/tasks", headers=auth(dataset.owner), params=params)
    assert response.status_code == 422


def test_stable_sort_empty_results_and_details(dataset, client):
    params = {"sort": "title", "direction": "desc", "page_size": 1}
    first = request(client, dataset.owner, "tasks", **params)
    second = request(client, dataset.owner, "tasks", **params, page=2)
    assert first["items"][0]["id"] != second["items"][0]["id"]
    empty = request(client, dataset.owner, "overview", search="does-not-exist")
    assert empty["metrics"]["total_tasks"] == 0 and empty["metrics"]["completion_percentage"] == 0
    employee = request(client, dataset.owner, f"employees/{dataset.alice.id}")
    assert employee["tasks"]["total"] == 2 and employee["subtasks"]["total"] == 2
    project = request(client, dataset.owner, f"projects/{dataset.project.id}")
    assert project["tasks"]["total"] == 4
    assert request(client, dataset.owner, "options", employee_search="Bob")["employees"][0]["id"] == dataset.bob.id


def test_queries_are_bounded_and_no_n_plus_one(dataset, engine):
    with dataset.factory() as db:
        db.add_all([m.Task(title=f"Bulk {index}", project_id=dataset.project.id, created_by_id=dataset.owner.id,
                          assigned_to_id=dataset.alice.id, created_at=datetime(2026, 10, 19))
                    for index in range(1000)])
        db.commit()
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        with dataset.factory() as db:
            result = inventory.employees(db, dataset.owner, build_filters(page_size=2), STAMP)
            tasks = inventory.tasks(db, dataset.owner, build_filters(page_size=2), STAMP)
            assert result["total"] == 5
            assert tasks["total"] == 1005 and len(tasks["items"]) == 2
        assert len(statements) <= 4
        assert any("GROUP BY" in sql for sql in statements)
        assert any("LIMIT" in sql for sql in statements)
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def test_own_child_does_not_grant_manager_access_to_other_workers(dataset, client):
    with dataset.factory() as db:
        db.add_all([
            m.Subtask(task_id=dataset.private.id, title="Manager work", assigned_to_id=dataset.manager.id),
            m.Subtask(task_id=dataset.private.id, title="Private peer work", assigned_to_id=dataset.zero.id),
        ])
        db.commit()
    result = request(client, dataset.manager, "tasks", project_id=dataset.hidden.id)
    assert result["total"] == 1
    row = result["items"][0]
    assert row["total_subtasks"] == 1
    assert row["assignment_redacted"] is True
    assert row["assigned_to_id"] is None and row["assignee_name"] == "Restricted employee"
    employees = request(client, dataset.manager, "options")["employees"]
    assert dataset.zero.id not in {row["id"] for row in employees}
    assert client.get(f"/api/reports/employees/{dataset.zero.id}",
                      headers=auth(dataset.manager)).status_code == 404


def test_manager_retains_inactive_historical_worker_in_managed_project(dataset, client):
    with dataset.factory() as db:
        former = m.User(tenant_id=dataset.owner.tenant_id, name="Former member",
                        email=f"{uuid4()}@example.test", hashed_password="fixture-only",
                        role=m.RoleEnum.USER, status=m.UserStatusEnum.DEACTIVATED)
        db.add(former)
        db.flush()
        db.add(m.TimeEntry(tenant_id=dataset.owner.tenant_id, user_id=former.id, task_id=dataset.first.id,
                          started_at=datetime(2026, 10, 19, 10, tzinfo=UTC),
                          stopped_at=datetime(2026, 10, 19, 11, tzinfo=UTC),
                          duration_seconds=3600, status=m.TimeEntryStatusEnum.STOPPED))
        db.commit()
    options = request(client, dataset.manager, "options")["employees"]
    assert former.id in {row["id"] for row in options}
    assert request(client, dataset.manager, f"employees/{former.id}")["employee"]["assigned_parent_tasks"] == 0


def test_project_membership_is_not_task_ownership(dataset, client):
    with dataset.factory() as db:
        db.add(m.ProjectMember(tenant_id=dataset.owner.tenant_id, project_id=dataset.hidden.id,
                               user_id=dataset.alice.id, role=m.ProjectMemberRoleEnum.MEMBER))
        db.commit()
    project = request(client, dataset.alice, f"projects/{dataset.hidden.id}")["project"]
    assert project["total_tasks"] == 0 and project["member_count"] == 1
    assert project["members"] == [{"id": dataset.alice.id, "name": "Alice"}]
    assert request(client, dataset.alice, "overview")["metrics"]["total_tasks"] == 2


def test_members_are_bounded_with_explicit_full_counts(dataset, client):
    with dataset.factory() as db:
        for index in range(30):
            user = m.User(tenant_id=dataset.owner.tenant_id, name=f"Member {index:02}",
                          email=f"{uuid4()}@example.test", hashed_password="fixture-only")
            db.add(user)
            db.flush()
            db.add(m.ProjectMember(tenant_id=dataset.owner.tenant_id, project_id=dataset.project.id,
                                   user_id=user.id, role=m.ProjectMemberRoleEnum.MEMBER))
        db.commit()
    project = request(client, dataset.owner, f"projects/{dataset.project.id}")["project"]
    assert project["member_count"] == 33 and len(project["members"]) == 25
    assert project["manager_count"] == 1 and project["members_truncated"] is True
