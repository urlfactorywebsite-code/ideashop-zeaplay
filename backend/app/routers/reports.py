"""Authorized reporting endpoints sharing one filter contract and read snapshot."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_current_active_user
from ..reporting import activity, inventory, work
from ..reporting.exports import export_response
from ..reporting.filters import ReportFilters, report_filters
from ..reporting.scope import validate_filters


router = APIRouter(prefix="/reports", tags=["reports"])


def reporting_db(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        as_of = db.scalar(text("SELECT transaction_timestamp()"))
    else:
        db.execute(text("BEGIN"))
        as_of = datetime.now(timezone.utc)
    as_of = as_of.replace(tzinfo=timezone.utc) if as_of.tzinfo is None else as_of.astimezone(timezone.utc)
    db.info["reporting_as_of"] = as_of
    return db


def context(db: Session = Depends(reporting_db),
            user: models.User = Depends(get_current_active_user),
            filters: ReportFilters = Depends(report_filters)):
    validate_filters(db, user, filters)
    return db, user, filters, db.info["reporting_as_of"]


@router.get("/options")
def report_options(employee_search: str = Query("", max_length=120),
                   project_search: str = Query("", max_length=120),
                   options_page: int = Query(1, ge=1, le=1000000),
                   ctx=Depends(context)):
    return inventory.options(*ctx, employee_search=employee_search, project_search=project_search,
                             options_page=options_page)


@router.get("/overview")
def report_overview(ctx=Depends(context)):
    return inventory.overview(*ctx)


@router.get("/employees")
def report_employees(ctx=Depends(context)):
    return inventory.employees(*ctx)


@router.get("/employees/{report_employee_id}")
def report_employee(report_employee_id: str, ctx=Depends(context)):
    return inventory.employee_detail(*ctx, report_employee_id)


@router.get("/tasks")
def report_tasks(ctx=Depends(context)):
    return inventory.tasks(*ctx)


@router.get("/statuses")
def report_statuses(ctx=Depends(context)):
    return inventory.statuses(*ctx)


@router.get("/projects")
def report_projects(ctx=Depends(context)):
    return inventory.projects(*ctx)


@router.get("/projects/{report_project_id}")
def report_project(report_project_id: str, ctx=Depends(context)):
    return inventory.project_detail(*ctx, report_project_id)


@router.get("/activity")
def report_activity(grouping: str = Query("daily", pattern="^(daily|weekly|monthly)$"), ctx=Depends(context)):
    db, user, filters, as_of = ctx
    return activity.activity_report(db, user, filters, grouping=grouping, as_of=as_of)


@router.get("/time")
def report_time(group_by: str = Query("employee", pattern="^(employee|task|subtask|project|daily)$"), ctx=Depends(context)):
    db, user, filters, as_of = ctx
    return work.time_report(db, user, filters, group_by=group_by, as_of=as_of)


@router.get("/time/sessions")
def report_time_sessions(active: bool = False, ctx=Depends(context)):
    db, user, filters, as_of = ctx
    return work.sessions_report(db, user, filters, active=active, as_of=as_of)


@router.get("/export")
def report_export(report: str = Query("tasks", pattern="^(tasks|employees|projects|statuses|activity|time)$"),
                  format: str = Query("csv", pattern="^(csv|xlsx)$"),
                  group_by: str = Query("employee", pattern="^(employee|task|subtask|project|daily)$"),
                  grouping: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
                  ctx=Depends(context)):
    return export_response(*ctx, report=report, format=format, group_by=group_by, grouping=grouping)
