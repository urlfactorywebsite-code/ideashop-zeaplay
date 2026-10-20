"""Deterministic active-interval accounting and trustworthy activity observations."""
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, select

from backend.app import models as m
from backend.app.reporting.activity import activity_report
from backend.app.reporting.filters import build_filters
from backend.app.reporting import work
from backend.tests.test_task_lifecycle import data, engine, NOW  # noqa: F401


def interval(db, data, start, stop=None, *, user=None, child=False, **kwargs):
    row = m.TimeEntry(
        id=str(uuid4()), tenant_id=data.owner.tenant_id, user_id=(user or data.owner).id,
        task_id=None if child else data.task.id, subtask_id=data.child.id if child else None,
        started_at=start, stopped_at=stop,
        duration_seconds=int((stop - start).total_seconds()) if stop else None,
        status=m.TimeEntryStatusEnum.STOPPED if stop else m.TimeEntryStatusEnum.ACTIVE,
        **kwargs,
    )
    db.add(row)
    db.flush()
    return row


def worker(db, data, name="Worker"):
    row = m.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name=name,
                 email=f"{uuid4()}@example.test", hashed_password="not-a-login-password",
                 role=m.RoleEnum.USER, status=m.UserStatusEnum.ACTIVE)
    db.add(row)
    db.flush()
    return row


def test_concurrent_effort_union_and_group_reconciliation(data):
    with data.factory() as db:
        interval(db, data, NOW, NOW + timedelta(hours=1))
        interval(db, data, NOW, NOW + timedelta(hours=1), child=True)
        interval(db, data, NOW + timedelta(minutes=30), NOW + timedelta(hours=1), child=True)
        filters = build_filters(from_date=NOW.date(), to_date=NOW.date())
        result = work.time_report(db, data.owner, filters, as_of=NOW + timedelta(hours=2))
        assert result["summary"]["recorded_effort_seconds"] == 9000
        assert result["summary"]["unique_working_seconds"] == 3600
        assert result["summary"]["interval_count"] == 3
        assert result["items"][0]["recorded_effort_seconds"] == 9000
        grouped = work.time_report(db, data.owner, filters, group_by="subtask", as_of=NOW + timedelta(hours=2))
        assert {row["id"]: row["recorded_effort_seconds"] for row in grouped["items"]} == {
            None: 3600, data.child.id: 5400,
        }
        assert grouped["summary"] == result["summary"]
        assert sum(row["unique_working_seconds"] for row in grouped["items"]) == 7200


def test_unique_work_is_union_per_person_not_wall_clock_across_staff(data):
    with data.factory() as db:
        colleague = worker(db, data)
        interval(db, data, NOW, NOW + timedelta(hours=1))
        interval(db, data, NOW, NOW + timedelta(hours=1), child=True, user=colleague)
        report = work.time_report(db, data.owner, build_filters(), as_of=NOW + timedelta(hours=2))
        assert report["summary"]["unique_working_seconds"] == 7200
        assert report["summary"]["recorded_effort_seconds"] == 7200


@pytest.mark.parametrize("local_day,expected", [
    (date(2020, 3, 8), 23 * 3600), (date(2020, 11, 1), 25 * 3600),
])
def test_dst_local_day_bounds_and_running_snapshot(data, local_day, expected):
    filters = build_filters(from_date=local_day, to_date=local_day, timezone="America/New_York")
    with data.factory() as db:
        interval(db, data, filters.start_at - timedelta(hours=1))
        snapshot = filters.end_at + timedelta(hours=1)
        report = work.time_report(db, data.owner, filters, group_by="daily", as_of=snapshot)
        assert report["summary"]["recorded_effort_seconds"] == expected
        assert report["summary"]["unique_working_seconds"] == expected
        assert report["items"][0]["recorded_effort_seconds"] == expected
        assert report["items"][0]["unique_working_seconds"] == expected
        assert report["meta"]["as_of"] == snapshot


def test_cross_midnight_pause_resume_and_paginated_active_history(data):
    midnight = NOW.replace(hour=0) + timedelta(days=1)
    filters = build_filters(from_date=NOW.date(), to_date=(NOW + timedelta(days=1)).date())
    with data.factory() as db:
        first = interval(db, data, midnight - timedelta(minutes=30), midnight + timedelta(minutes=10),
                         stop_reason="paused")
        second = interval(db, data, midnight + timedelta(minutes=20), continued_from_id=first.id,
                          start_kind="resumed")
        snapshot = midnight + timedelta(minutes=40)
        daily = work.time_report(db, data.owner, filters, group_by="daily", as_of=snapshot)
        assert [row["recorded_effort_seconds"] for row in daily["items"]] == [1800, 1800]
        assert daily["summary"]["recorded_effort_seconds"] == 3600
        assert daily["summary"]["resumed_interval_count"] == 1
        history = work.sessions_report(db, data.owner, build_filters(page_size=1, page=2), as_of=snapshot)
        assert history["total"] == 2 and len(history["items"]) == 1
        assert history["items"][0]["continued_from_id"] == first.id
        active = work.sessions_report(db, data.owner, filters, active=True, as_of=snapshot)
        assert active["total"] == 1 and active["items"][0]["id"] == second.id
        assert active["items"][0]["state"] == "RUNNING"
        first_page = work.sessions_report(db, data.owner, build_filters(page_size=1), as_of=snapshot)
        assert first_page["items"][0]["state"] == "RESUMED"
        assert first_page["items"][0]["paused_seconds"] == 600
        assert first_page["items"][0]["resumed_at"] == midnight + timedelta(minutes=20)


def test_closed_whole_second_ledger_does_not_restore_discarded_fraction(data):
    with data.factory() as db:
        interval(db, data, NOW, NOW + timedelta(seconds=1.9))
        report = work.time_report(db, data.owner, build_filters(), as_of=NOW + timedelta(seconds=5))
        assert report["summary"]["recorded_effort_seconds"] == 1
        assert report["summary"]["unique_working_seconds"] == 1


def test_employee_time_filter_uses_actual_worker_after_reassignment(data):
    with data.factory() as db:
        colleague = worker(db, data)
        interval(db, data, NOW, NOW + timedelta(hours=1), user=colleague)
        # The colleague was never the current assignee; the ledger remains authoritative.
        filters = build_filters(employee_id=colleague.id, from_date=NOW.date(), to_date=NOW.date())
        report = work.time_report(db, data.owner, filters, as_of=NOW + timedelta(hours=2))
        assert report["summary"]["recorded_effort_seconds"] == 3600
        assert report["items"][0]["id"] == colleague.id
        # The parent was created after 2020; creation filters must not suppress work activity.
        assert work.sessions_report(db, data.owner, filters, as_of=NOW + timedelta(hours=2))["total"] == 1


def test_regular_user_cannot_read_colleague_or_foreign_tenant_time(data):
    with data.factory() as db:
        colleague = worker(db, data)
        interval(db, data, NOW, NOW + timedelta(hours=1), user=colleague)
        interval(db, data, NOW, NOW + timedelta(minutes=30))
        foreign = interval(db, data, NOW, NOW + timedelta(minutes=10), child=True)
        foreign.tenant_id = data.outsider.tenant_id
        actor = db.get(m.User, data.owner.id)
        actor.role = m.RoleEnum.USER
        report = work.time_report(db, actor, build_filters(), as_of=NOW + timedelta(hours=2))
        assert report["summary"]["recorded_effort_seconds"] == 1800
        assert [row["id"] for row in report["items"]] == [actor.id]
        with pytest.raises(HTTPException) as denied:
            work.time_report(db, actor, build_filters(employee_id=colleague.id), as_of=NOW + timedelta(hours=2))
        assert denied.value.status_code == 404


def test_hard_interval_limit_returns_no_partial_total_and_queries_are_bounded(data, monkeypatch):
    with data.factory() as db:
        interval(db, data, NOW, NOW + timedelta(seconds=10))
        interval(db, data, NOW + timedelta(seconds=20), NOW + timedelta(seconds=30))
        monkeypatch.setattr(work, "MAX_REPORT_INTERVALS", 1)
        with pytest.raises(HTTPException) as error:
            work.time_report(db, data.owner, build_filters(), as_of=NOW + timedelta(hours=1))
        assert error.value.status_code == 422 and "no partial" in error.value.detail
        # Even an over-limit summary leaves independently paginated interval history usable.
        assert len(work.sessions_report(db, data.owner, build_filters(page_size=1),
                                       as_of=NOW + timedelta(hours=1))["items"]) == 1


def test_empty_sorting_and_sql_query_count(data):
    with data.factory() as db:
        assert work.time_report(db, data.owner, build_filters(), as_of=NOW)["summary"]["recorded_effort_seconds"] == 0
        for index in range(50):
            interval(db, data, NOW + timedelta(minutes=index), NOW + timedelta(minutes=index + 1))
        statements = []
        def capture(connection, cursor, statement, *args):
            statements.append(statement)
        event.listen(db.get_bind(), "before_cursor_execute", capture)
        try:
            report = work.time_report(db, data.owner, build_filters(sort="unique_working_seconds", direction="desc"),
                                      as_of=NOW + timedelta(hours=2))
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", capture)
        assert report["items"][0]["unique_working_seconds"] == 3000
        assert len(statements) <= 4
        assert any("GROUP BY" in statement for statement in statements)


def test_activity_uses_observed_transitions_without_fabricated_assignment_dates(data):
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        task.created_at = NOW.replace(tzinfo=None)
        task.assigned_at = NOW.replace(tzinfo=None)
        task.status = m.TaskStatusEnum.TODO
        db.flush()
        transitions = [
            ("task.status_changed", "TODO", "IN_PROGRESS", None),
            ("task.status_changed", "IN_PROGRESS", "DONE", None),
            ("task.status_changed", "DONE", "DEPLOYED", None),  # not another completion
            ("task.status_changed", "DEPLOYED", "TODO", None),
            ("subtask.status_changed", "IN_PROGRESS", "DONE", data.child.id),
        ]
        for index, (kind, previous, current, child) in enumerate(transitions):
            db.add(m.TaskLifecycleEvent(tenant_id=data.owner.tenant_id, task_id=data.task.id,
                subtask_id=child, event_type=kind, previous_status=previous, new_status=current,
                occurred_at=NOW + timedelta(minutes=index), recorded_at=NOW, details={}))
        db.flush()
        filters = build_filters(from_date=NOW.date(), to_date=NOW.date(), timezone="Asia/Kolkata")
        result = activity_report(db, data.owner, filters, as_of=NOW + timedelta(hours=1))
        assert result["totals"]["tasks_created"] == 1
        assert result["totals"]["tasks_started"] == 1
        assert result["totals"]["tasks_completed"] == 1
        assert result["totals"]["tasks_reopened"] == 1
        assert result["totals"]["subtasks_completed"] == 1
        assert "tasks_assigned" in result["meta"]["unavailable_metrics"]
        assert result["meta"]["lifecycle_coverage_started_at"] is not None
        assert db.get(m.Task, data.task.id).status == m.TaskStatusEnum.TODO


@pytest.mark.parametrize("grouping,day", [("daily", "2020-10-20"), ("weekly", "2020-10-19"), ("monthly", "2020-10-01")])
def test_activity_timezone_buckets_and_exclusive_end(data, grouping, day):
    start = datetime(2020, 10, 19, 20, tzinfo=timezone.utc)  # next day in Kolkata
    filters = build_filters(from_date=date(2020, 10, 20), to_date=date(2020, 10, 20), timezone="Asia/Kolkata")
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        task.created_at = start.replace(tzinfo=None)
        interval(db, data, start, start + timedelta(hours=1))
        db.add(m.TaskLifecycleEvent(tenant_id=data.owner.tenant_id, task_id=data.task.id,
            event_type="task.status_changed", previous_status="TODO", new_status="IN_PROGRESS",
            occurred_at=filters.end_at, recorded_at=filters.end_at, details={}))
        db.flush()
        report = activity_report(db, data.owner, filters, grouping=grouping, as_of=filters.end_at + timedelta(days=1))
        row = next(row for row in report["items"] if row["date"] == day)
        assert row["tasks_created"] == 1 and row["tasks_started"] == 0
        assert row["work_sessions_started"] == 1
        assert row["recorded_effort_seconds"] == 3600


def test_daily_limit_explicit_and_invalid_groups(data):
    with data.factory() as db:
        filters = build_filters(from_date=date(2019, 1, 1), to_date=date(2020, 12, 31))
        with pytest.raises(HTTPException, match="366"):
            work.time_report(db, data.owner, filters, group_by="daily", as_of=datetime(2021, 1, 1, tzinfo=timezone.utc))
        with pytest.raises(HTTPException, match="grouping"):
            work.time_report(db, data.owner, build_filters(), group_by="not-real")
        with pytest.raises(HTTPException, match="sort"):
            work.time_report(db, data.owner, build_filters(sort="private_note"))


def test_fractional_midnight_splits_reconcile_exactly(data):
    midnight = NOW.replace(hour=0) + timedelta(days=1)
    with data.factory() as db:
        interval(db, data, midnight - timedelta(seconds=.5), midnight + timedelta(seconds=.5))
        result = work.time_report(db, data.owner, build_filters(
            from_date=NOW.date(), to_date=midnight.date()), group_by="daily", as_of=midnight + timedelta(seconds=2))
        assert [row["recorded_effort_seconds"] for row in result["items"]] == [.5, .5]
        assert sum(row["recorded_effort_seconds"] for row in result["items"]) == result["summary"]["recorded_effort_seconds"]
        assert sum(row["unique_working_seconds"] for row in result["items"]) == result["summary"]["unique_working_seconds"]


def test_zero_duration_timer_starts_and_history_are_retained_at_day_boundary(data):
    midnight = NOW.replace(hour=0)
    filters = build_filters(from_date=midnight.date(), to_date=midnight.date())
    with data.factory() as db:
        interval(db, data, midnight, midnight + timedelta(seconds=.3))
        report = work.time_report(db, data.owner, filters, group_by="daily", as_of=NOW)
        assert report["summary"]["recorded_effort_seconds"] == 0
        assert report["summary"]["unique_working_seconds"] == 0
        assert report["summary"]["interval_count"] == 1
        assert report["items"][0]["interval_count"] == 1
        assert work.sessions_report(db, data.owner, filters, as_of=NOW)["total"] == 1
        observed = activity_report(db, data.owner, filters, as_of=NOW)
        assert observed["totals"]["work_sessions_started"] == 1
        assert observed["totals"]["work_intervals_started"] == 1
        previous = build_filters(from_date=(midnight - timedelta(days=1)).date(),
                                 to_date=(midnight - timedelta(days=1)).date())
        assert work.sessions_report(db, data.owner, previous, as_of=NOW)["total"] == 0


def test_manager_archived_project_history_and_unmanaged_peer_isolation(data):
    with data.factory() as db:
        colleague = worker(db, data)
        colleague.status = m.UserStatusEnum.DEACTIVATED
        manager = db.get(m.User, data.owner.id)
        manager.role = m.RoleEnum.MANAGER
        client = m.Client(tenant_id=manager.tenant_id, company_name="Time fixture client",
                          normalized_company_name="time fixture client")
        db.add(client); db.flush()
        managed = m.Project(tenant_id=manager.tenant_id, client_id=client.id, name="Managed archive",
                            normalized_name="managed archive", status=m.ProjectStatusEnum.ARCHIVED)
        unmanaged = m.Project(tenant_id=manager.tenant_id, client_id=client.id, name="Unmanaged",
                              normalized_name="unmanaged")
        db.add_all([managed, unmanaged]); db.flush()
        db.add(m.ProjectMember(tenant_id=manager.tenant_id, project_id=managed.id, user_id=manager.id,
                               role=m.ProjectMemberRoleEnum.MANAGER))
        # The historical worker has no current project membership.
        managed_task = m.Task(title="Retained historical work", project_id=managed.id,
                              created_by_id=manager.id, assigned_to_id=manager.id, status=m.TaskStatusEnum.BLOCKED)
        db.add(managed_task); db.flush()
        db.get(m.Task, data.task.id).project_id = unmanaged.id
        interval(db, data, NOW, NOW + timedelta(hours=2), user=colleague)
        historical = interval(db, data, NOW, NOW + timedelta(hours=1), user=colleague, child=True)
        historical.subtask_id = None
        historical.task_id = managed_task.id
        db.flush()
        result = work.time_report(db, manager, build_filters(), as_of=NOW + timedelta(hours=3))
        assert result["summary"]["recorded_effort_seconds"] == 3600
        assert [row["id"] for row in result["items"]] == [colleague.id]
        filtered = work.time_report(db, manager, build_filters(
            employee_id=colleague.id, project_id=managed.id, status=m.TaskStatusEnum.BLOCKED,
            from_date=NOW.date(), to_date=NOW.date()), group_by="project", as_of=NOW + timedelta(hours=3))
        assert filtered["summary"]["recorded_effort_seconds"] == 3600
        assert filtered["items"][0]["id"] == managed.id
        assert work.sessions_report(db, manager, build_filters(project_id=unmanaged.id),
                                    as_of=NOW + timedelta(hours=3))["total"] == 0


def test_reporting_routes_pagination_validation_and_private_cache_policy(data):
    from backend.app.database import get_db
    from backend.app.dependencies import get_current_active_user
    from backend.app.routers.reports import router
    app = FastAPI()
    app.include_router(router, prefix="/api")
    def session():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_active_user] = lambda: data.owner
    with data.factory() as db:
        for index in range(2):
            interval(db, data, NOW + timedelta(minutes=index), NOW + timedelta(minutes=index + 1))
        db.commit()
    with TestClient(app) as api:
        response = api.get("/api/reports/time", params={"from": str(NOW.date()), "to": str(NOW.date())})
        assert response.status_code == 200, response.text
        assert response.json()["summary"]["recorded_effort_seconds"] == 120
        assert response.headers["Cache-Control"] == "private, no-store"
        history = api.get("/api/reports/time/sessions", params={"page_size": 1, "page": 2})
        assert history.status_code == 200, history.text
        assert history.json()["total"] == 2 and history.json()["total_pages"] == 2
        activity = api.get("/api/reports/activity", params={"from": str(NOW.date()), "to": str(NOW.date()),
                                                           "grouping": "weekly", "page_size": 1})
        assert activity.status_code == 200, activity.text
        assert activity.json()["totals"]["work_intervals_started"] == 2
        assert api.get("/api/reports/time?group_by=payroll").status_code == 422
        assert api.get("/api/reports/activity?grouping=hourly").status_code == 422
        assert api.get("/api/reports/time?from=2020-10-21&to=2020-10-19").status_code == 422
