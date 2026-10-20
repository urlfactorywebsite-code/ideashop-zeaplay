"""SQL inventory aggregation; parent status is always the stored Task.status."""
from dataclasses import replace
from datetime import datetime, timezone
from enum import Enum
from math import ceil

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select, union

from .. import models as m
from .scope import (
    admin, authorized_projects, authorized_users, filtered_tasks,
    validate_filters, visible_subtasks,
)


COMPLETED = (m.TaskStatusEnum.DONE, m.TaskStatusEnum.DEPLOYED)
IN_PROGRESS = (m.TaskStatusEnum.IN_PROGRESS, m.TaskStatusEnum.BUG_FIXING, m.TaskStatusEnum.IN_REVIEW)
PENDING = (m.TaskStatusEnum.TODO, m.TaskStatusEnum.WAITING_FOR_REQUIREMENT, m.TaskStatusEnum.ON_HOLD)
TERMINAL = (*COMPLETED, m.TaskStatusEnum.FAILED, m.TaskStatusEnum.GRAVEYARD)


def now():
    return datetime.now(timezone.utc)


def value(item):
    if isinstance(item, Enum):
        return item.value
    if isinstance(item, datetime):
        return item.replace(tzinfo=timezone.utc) if item.tzinfo is None else item.astimezone(timezone.utc)
    return item


def mapped(row):
    return {key: value(item) for key, item in dict(row).items()}


def task_population(user, filters):
    return filtered_tasks(user, filters).with_only_columns(
        m.Task.id, m.Task.title, m.Task.status, m.Task.task_group_id, m.Task.project_id,
        m.Task.assigned_to_id, m.Task.created_at, m.Task.assigned_at, m.Task.due_at,
        m.Task.completed_at,
    ).subquery("report_tasks")


def overdue(columns, as_of):
    return and_(columns.due_at.is_not(None), columns.due_at < as_of.replace(tzinfo=None),
                ~columns.status.in_(TERMINAL))


def count_if(predicate):
    return func.coalesce(func.sum(case((predicate, 1), else_=0)), 0)


def task_aggregates(columns, as_of, *, employee=False):
    suffix = "_parent_tasks" if employee else "_tasks"
    return [
        func.count(columns.id).label("assigned_parent_tasks" if employee else "total_tasks"),
        count_if(columns.status.in_(COMPLETED)).label("completed" + suffix),
        count_if(columns.status.in_(IN_PROGRESS)).label("in_progress" + suffix),
        count_if(columns.status.in_(PENDING)).label("pending" + suffix),
        count_if(columns.status == m.TaskStatusEnum.BLOCKED).label("blocked" + suffix),
        count_if(overdue(columns, as_of)).label("overdue" + suffix),
    ]


def percent(complete, total):
    return round(100 * complete / total, 2) if total else 0.0


def page_query(db, stmt, filters, sorts, default, tie):
    key = filters.sort or default
    if key not in sorts:
        raise HTTPException(422, f"Unsupported sort field: {key}")
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    order = sorts[key].desc() if filters.direction == "desc" else sorts[key].asc()
    rows = db.execute(stmt.order_by(order, tie.asc())
                      .offset((filters.page - 1) * filters.page_size).limit(filters.page_size)).mappings().all()
    return rows, total


def page_payload(items, total, filters, as_of):
    return {"items": items, "total": total, "page": filters.page, "page_size": filters.page_size,
            "total_pages": ceil(total / filters.page_size), "meta": filters.meta(as_of)}


def effort_totals(db, user, filters, as_of, population, *, group_by):
    """Database effort sums for the exact inventory population, attributed to its worker."""
    from .work import interval_query
    intervals = interval_query(db, user, filters, as_of).subquery("inventory_work_intervals")
    key = intervals.c.user_id if group_by == "employee" else intervals.c.project_id
    return select(key.label("key_id"),
                  func.sum(intervals.c.recorded_effort_seconds).label("recorded_effort_seconds"))\
        .where(intervals.c.task_id.in_(select(population.c.id))).group_by(key).subquery("inventory_effort")


def effort_payload(items, total, filters, as_of):
    result = page_payload(items, total, filters, as_of)
    result["meta"]["recorded_effort_semantics"] = (
        "Active interval effort of the actual worker on the filtered inventory tasks; tasks are selected by creation date, "
        "and intervals are clipped to the same report period and snapshot. Concurrent effort is additive, not attendance."
    )
    return result


def options(db, user, filters, as_of, *, employee_search="", project_search="", options_page=1):
    users = authorized_users(user).with_only_columns(m.User.id, m.User.name, m.User.email, m.User.status)
    projects = authorized_projects(user).with_only_columns(m.Project.id, m.Project.name, m.Project.status)
    if employee_search:
        users = users.where(or_(m.User.name.icontains(employee_search, autoescape=True),
                               m.User.email.icontains(employee_search, autoescape=True)))
    if project_search:
        projects = projects.where(m.Project.name.icontains(project_search, autoescape=True))
    user_total = db.scalar(select(func.count()).select_from(users.subquery()))
    project_total = db.scalar(select(func.count()).select_from(projects.subquery()))
    offset = (options_page - 1) * 100
    employees = [mapped(row) for row in db.execute(users.order_by(m.User.name, m.User.id).offset(offset).limit(100)).mappings()]
    project_rows = [mapped(row) for row in db.execute(projects.order_by(m.Project.name, m.Project.id).offset(offset).limit(100)).mappings()]
    # A selected row must remain recognizable when outside the first search page.
    if filters.employee_id and not any(row["id"] == filters.employee_id for row in employees):
        row = db.execute(users.where(m.User.id == filters.employee_id)).mappings().first()
        if row:
            employees.append(mapped(row))
    if filters.project_id and not any(row["id"] == filters.project_id for row in project_rows):
        row = db.execute(projects.where(m.Project.id == filters.project_id)).mappings().first()
        if row:
            project_rows.append(mapped(row))
    return {"employees": employees, "projects": project_rows,
            "employees_total": user_total, "projects_total": project_total,
            "options_page": options_page, "options_page_size": 100,
            "statuses": [status.value for status in m.TaskStatusEnum],
            "timezone": filters.timezone, "meta": filters.meta(as_of)}


def status_rows(db, user, filters, as_of):
    tasks = task_population(user, filters)
    c = tasks.c
    rows = db.execute(select(c.status.label("status"), func.count(c.id).label("count"),
                             func.count(func.distinct(c.project_id)).label("project_count"),
                             func.count(func.distinct(c.assigned_to_id)).label("employee_count"),
                             count_if(overdue(c, as_of)).label("overdue_tasks"))
                      .group_by(c.status)).mappings().all()
    by_status = {row["status"]: mapped(row) for row in rows}
    total = sum(row["count"] for row in rows)
    return [dict(by_status.get(status, {"status": status.value, "count": 0, "project_count": 0,
                                       "employee_count": 0, "overdue_tasks": 0}),
                 percentage=percent(by_status.get(status, {}).get("count", 0), total))
            for status in m.TaskStatusEnum]


def statuses(db, user, filters, as_of):
    rows = status_rows(db, user, filters, as_of)
    sort = filters.sort or "status"
    if sort not in {"status", "count"}:
        raise HTTPException(422, f"Unsupported sort field: {sort}")
    rows.sort(key=lambda row: (row[sort], row["status"]), reverse=filters.direction == "desc")
    offset = (filters.page - 1) * filters.page_size
    return page_payload(rows[offset:offset + filters.page_size], len(rows), filters, as_of)


def employees(db, user, filters, as_of):
    tasks = task_population(user, filters)
    c = tasks.c
    parent = select(c.assigned_to_id.label("employee_id"), *task_aggregates(c, as_of, employee=True),
                    count_if(~c.status.in_(TERMINAL)).label("active_assignments")).group_by(c.assigned_to_id).subquery()
    child_scope = visible_subtasks(user, filters, select(c.id)).with_only_columns(
        m.Subtask.id, m.Subtask.task_id, m.Subtask.assigned_to_id).subquery()
    child = select(child_scope.c.assigned_to_id.label("employee_id"),
                   func.count(child_scope.c.id).label("assigned_subtasks")).group_by(child_scope.c.assigned_to_id).subquery()
    links = union(
        select(c.assigned_to_id.label("employee_id"), c.project_id),
        select(child_scope.c.assigned_to_id.label("employee_id"), c.project_id)
        .join(tasks, c.id == child_scope.c.task_id),
    ).subquery()
    projects = select(links.c.employee_id, func.count(func.distinct(links.c.project_id)).label("project_count"))\
        .group_by(links.c.employee_id).subquery()
    effort = effort_totals(db, user, filters, as_of, tasks, group_by="employee")
    recorded_effort = func.coalesce(effort.c.recorded_effort_seconds, 0).label("recorded_effort_seconds")
    names = ["assigned_parent_tasks", "completed_parent_tasks", "in_progress_parent_tasks", "pending_parent_tasks",
             "blocked_parent_tasks", "overdue_parent_tasks", "active_assignments"]
    counts = {key: func.coalesce(parent.c[key], 0).label(key) for key in names}
    stmt = authorized_users(user).with_only_columns(
        m.User.id.label("employee_id"), m.User.name, m.User.email, m.User.status,
        *counts.values(), func.coalesce(child.c.assigned_subtasks, 0).label("assigned_subtasks"),
        func.coalesce(projects.c.project_count, 0).label("project_count"),
        recorded_effort,
    ).outerjoin(parent, parent.c.employee_id == m.User.id)\
        .outerjoin(child, child.c.employee_id == m.User.id)\
        .outerjoin(projects, projects.c.employee_id == m.User.id)\
        .outerjoin(effort, effort.c.key_id == m.User.id)
    if filters.employee_id:
        stmt = stmt.where(m.User.id == filters.employee_id)
    sorts = {"name": m.User.name, **counts, "assigned_subtasks": func.coalesce(child.c.assigned_subtasks, 0),
             "recorded_effort_seconds": recorded_effort}
    rows, total = page_query(db, stmt, filters, sorts, "name", m.User.id)
    items = []
    for row in rows:
        item = mapped(row)
        item["completed_assignments"] = item["completed_parent_tasks"]
        item["completion_percentage"] = percent(item["completed_parent_tasks"], item["assigned_parent_tasks"])
        item["recorded_effort_seconds"] = round(float(item["recorded_effort_seconds"]), 6)
        items.append(item)
    return effort_payload(items, total, filters, as_of)


def tasks(db, user, filters, as_of):
    population = task_population(user, filters)
    c = population.c
    children = visible_subtasks(user, filters, select(c.id)).with_only_columns(
        m.Subtask.task_id, func.count(m.Subtask.id).label("total_subtasks"),
        count_if(m.Subtask.status == m.SubtaskStatusEnum.DONE).label("completed_subtasks"),
    ).group_by(m.Subtask.task_id).subquery()
    permitted_users = authorized_users(user).with_only_columns(m.User.id).subquery()
    stmt = select(
        *c, m.Project.name.label("project_name"), m.Project.status.label("project_status"),
        m.User.name.label("assignee_name"),
        func.coalesce(children.c.total_subtasks, 0).label("total_subtasks"),
        func.coalesce(children.c.completed_subtasks, 0).label("completed_subtasks"),
        overdue(c, as_of).label("overdue"),
    ).select_from(population)\
        .outerjoin(m.Project, and_(m.Project.id == c.project_id, m.Project.tenant_id == user.tenant_id))\
        .outerjoin(m.User, and_(m.User.id == c.assigned_to_id, m.User.id.in_(select(permitted_users.c.id))))\
        .outerjoin(children, children.c.task_id == c.id)
    sorts = {key: c[key] for key in ("title", "created_at", "assigned_at", "due_at", "status")}
    rows, total = page_query(db, stmt, filters, sorts, "created_at", c.id)
    items = []
    for row in rows:
        item = mapped(row)
        # A legacy completion timestamp may survive reopening. Never label it as current completion.
        if item["status"] not in {status.value for status in COMPLETED}:
            item["completed_at"] = None
        item["assignment_redacted"] = item["assigned_to_id"] is not None and item["assignee_name"] is None
        if item["assignment_redacted"]:
            item["assigned_to_id"] = None
            item["assignee_name"] = "Restricted employee"
        items.append(item)
    return page_payload(items, total, filters, as_of)


def projects(db, user, filters, as_of):
    population = task_population(user, filters)
    c = population.c
    task_counts = select(c.project_id, *task_aggregates(c, as_of)).group_by(c.project_id).subquery()
    child_scope = visible_subtasks(user, filters, select(c.id)).with_only_columns(
        m.Subtask.id, m.Subtask.task_id, m.Subtask.status).subquery()
    child_counts = select(c.project_id, func.count(child_scope.c.id).label("total_subtasks"),
                          count_if(child_scope.c.status == m.SubtaskStatusEnum.DONE).label("completed_subtasks"))\
        .select_from(child_scope).join(population, c.id == child_scope.c.task_id).group_by(c.project_id).subquery()
    names = ("total_tasks", "completed_tasks", "in_progress_tasks", "pending_tasks", "blocked_tasks", "overdue_tasks")
    counts = {key: func.coalesce(task_counts.c[key], 0).label(key) for key in names}
    effort = effort_totals(db, user, filters, as_of, population, group_by="project")
    recorded_effort = func.coalesce(effort.c.recorded_effort_seconds, 0).label("recorded_effort_seconds")
    stmt = authorized_projects(user).with_only_columns(
        m.Project.id.label("project_id"), m.Project.name, m.Project.status, m.Project.start_date, m.Project.end_date,
        m.Client.company_name.label("client_name"), *counts.values(),
        func.coalesce(child_counts.c.total_subtasks, 0).label("total_subtasks"),
        func.coalesce(child_counts.c.completed_subtasks, 0).label("completed_subtasks"),
        recorded_effort,
    ).join(m.Client, and_(m.Client.id == m.Project.client_id, m.Client.tenant_id == user.tenant_id))\
        .outerjoin(task_counts, task_counts.c.project_id == m.Project.id)\
        .outerjoin(child_counts, child_counts.c.project_id == m.Project.id)\
        .outerjoin(effort, effort.c.key_id == m.Project.id)
    if filters.project_id:
        stmt = stmt.where(m.Project.id == filters.project_id)
    rows, total = page_query(db, stmt, filters, {"name": m.Project.name, **counts,
                                               "recorded_effort_seconds": recorded_effort}, "name", m.Project.id)
    ids = [row["project_id"] for row in rows]
    allowed_users = authorized_users(user).with_only_columns(m.User.id)
    member_projection = (select(m.ProjectMember.project_id, m.ProjectMember.user_id.label("id"),
                                m.ProjectMember.role, m.User.name,
                                func.count().over(partition_by=m.ProjectMember.project_id).label("member_count"),
                                func.sum(case((m.ProjectMember.role == m.ProjectMemberRoleEnum.MANAGER, 1), else_=0))
                                .over(partition_by=m.ProjectMember.project_id).label("manager_count"),
                                func.row_number().over(partition_by=m.ProjectMember.project_id,
                                    order_by=(m.ProjectMember.role, m.User.name, m.User.id)).label("member_rank"))
                         .join(m.User, m.User.id == m.ProjectMember.user_id)
                         .where(m.ProjectMember.tenant_id == user.tenant_id,
                                m.ProjectMember.project_id.in_(ids),
                                m.User.tenant_id == user.tenant_id, m.User.id.in_(allowed_users))
                         .subquery())
    members = db.execute(select(member_projection).where(member_projection.c.member_rank <= 25)
                         .order_by(member_projection.c.project_id, member_projection.c.member_rank)).mappings().all() if ids else []
    by_project = {}
    for member in members:
        by_project.setdefault(member["project_id"], []).append(mapped(member))
    items = []
    for row in rows:
        item = mapped(row)
        membership = by_project.get(item["project_id"], [])
        item["managers"] = [{"id": entry["id"], "name": entry["name"]} for entry in membership
                            if entry["role"] == m.ProjectMemberRoleEnum.MANAGER.value]
        item["members"] = [{"id": entry["id"], "name": entry["name"]} for entry in membership]
        item["member_count"] = membership[0]["member_count"] if membership else 0
        item["manager_count"] = membership[0]["manager_count"] if membership else 0
        item["members_truncated"] = item["member_count"] > 25
        item["completion_percentage"] = percent(item["completed_tasks"], item["total_tasks"])
        item["recorded_effort_seconds"] = round(float(item["recorded_effort_seconds"]), 6)
        items.append(item)
    return effort_payload(items, total, filters, as_of)


def overview(db, user, filters, as_of):
    population = task_population(user, filters)
    c = population.c
    metrics = mapped(db.execute(select(
        *task_aggregates(c, as_of),
        count_if(c.assigned_to_id.is_not(None)).label("assigned_tasks"),
        count_if(c.assigned_to_id.is_(None)).label("unassigned_tasks"),
        func.count(func.distinct(c.task_group_id)).label("unique_task_groups"),
        func.count(func.distinct(c.assigned_to_id)).label("employees_with_assigned_work"),
    )).mappings().one())
    project_scope = authorized_projects(user).with_only_columns(m.Project.id)
    if filters.project_id:
        project_scope = project_scope.where(m.Project.id == filters.project_id)
    metrics["total_projects"] = db.scalar(select(func.count()).select_from(project_scope.subquery()))
    metrics["assignment_count"] = metrics["assigned_tasks"]
    metrics["completion_percentage"] = percent(metrics["completed_tasks"], metrics["total_tasks"])
    employee_chart = employees(db, user, replace(filters, page=1, page_size=10,
                                                sort="assigned_parent_tasks", direction="desc"), as_of)["items"]
    project_chart = projects(db, user, replace(filters, page=1, page_size=10,
                                              sort="total_tasks", direction="desc"), as_of)["items"]
    meta = filters.meta(as_of)
    meta["chart_limit"] = 10
    meta["project_count_semantics"] = "Authorized projects, including projects with zero matching tasks"
    return {"metrics": metrics, "status_distribution": status_rows(db, user, filters, as_of),
            "employee_workload": employee_chart, "project_completion": project_chart, "meta": meta}


def employee_detail(db, user, filters, as_of, employee_id):
    filters = replace(filters, employee_id=employee_id)
    validate_filters(db, user, filters)
    employee_page = employees(db, user, replace(filters, page=1, page_size=1, sort="name"), as_of)
    employee = employee_page["items"][0]
    clean_filters = replace(filters, sort="")
    task_page = tasks(db, user, clean_filters, as_of)
    task_ids = filtered_tasks(user, filters).with_only_columns(m.Task.id)
    stmt = visible_subtasks(user, filters, task_ids).with_only_columns(
        m.Subtask.id, m.Subtask.title, m.Subtask.task_id, m.Subtask.status,
        m.Subtask.assigned_to_id, m.Task.title.label("task_title"), m.Task.project_id,
    ).join(m.Task, m.Task.id == m.Subtask.task_id)
    rows, total = page_query(db, stmt, clean_filters, {"title": m.Subtask.title}, "title", m.Subtask.id)
    # Show current project membership as a relationship, independently of task ownership.
    project_ids = authorized_projects(user).with_only_columns(m.Project.id)
    membership_query = (select(m.Project.id, m.Project.name, m.Project.status)
        .join(m.ProjectMember, m.ProjectMember.project_id == m.Project.id)
        .where(m.Project.tenant_id == user.tenant_id, m.Project.id.in_(project_ids),
               m.ProjectMember.tenant_id == user.tenant_id, m.ProjectMember.user_id == employee_id))
    if filters.project_id:
        membership_query = membership_query.where(m.Project.id == filters.project_id)
    memberships_total = db.scalar(select(func.count()).select_from(membership_query.subquery()))
    memberships = db.execute(membership_query.order_by(m.Project.name, m.Project.id).limit(100)).mappings().all()
    return {"employee": employee, "tasks": task_page,
            "subtasks": page_payload([mapped(row) for row in rows], total, clean_filters, as_of),
            "projects": [mapped(row) for row in memberships], "projects_total": memberships_total,
            "projects_truncated": memberships_total > 100, "meta": filters.meta(as_of)}


def project_detail(db, user, filters, as_of, project_id):
    filters = replace(filters, project_id=project_id)
    validate_filters(db, user, filters)
    project_page = projects(db, user, replace(filters, page=1, page_size=1, sort="name"), as_of)
    if not project_page["items"]:
        raise HTTPException(404, "Project not found")
    clean_filters = replace(filters, sort="")
    return {"project": project_page["items"][0],
            "tasks": tasks(db, user, clean_filters, as_of),
            "employees": employees(db, user, clean_filters, as_of),
            "statuses": status_rows(db, user, filters, as_of), "meta": filters.meta(as_of)}
