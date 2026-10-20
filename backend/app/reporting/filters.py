"""Shared report filters and explicit local-date/UTC boundary semantics."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as utc_timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, HTTPException, Query

from .. import models
from ..dependencies import get_current_active_user


@dataclass(frozen=True)
class ReportFilters:
    from_date: date | None = None
    to_date: date | None = None
    timezone: str = "UTC"
    start_at: datetime | None = None
    end_at: datetime | None = None
    employee_id: str | None = None
    project_id: str | None = None
    status: models.TaskStatusEnum | None = None
    search: str = ""
    page: int = 1
    page_size: int = 25
    sort: str = ""
    direction: str = "asc"

    def meta(self, as_of: datetime, date_semantics: str = "task.created_at") -> dict:
        return {
            "as_of": as_of, "timezone": self.timezone,
            "from": self.from_date, "to": self.to_date,
            "start_at": self.start_at, "end_at": self.end_at,
            "date_semantics": date_semantics,
            "counting_unit": "persisted task.id",
            "employee_filter_semantics": "Parent tasks assigned to the employee or containing their assigned subtasks; employee workload counts each actual assignment separately.",
            "filters": {"employee_id": self.employee_id, "project_id": self.project_id,
                        "status": self.status.value if self.status else None, "search": self.search},
            "limitations": [
                "Multi-assignee work uses separate persisted task records; task groups are reported separately.",
                "Inventory is current state filtered by task creation date, not historical state at that date.",
                "Assignment dates are the latest stored assignment; complete reassignment history is unavailable.",
            ],
        }


def build_filters(*, from_date=None, to_date=None, timezone="UTC", **kwargs):
    try:
        zone = ZoneInfo(timezone)
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(422, "Invalid IANA reporting timezone") from None
    if from_date and to_date and from_date > to_date:
        raise HTTPException(422, "The start date must not be after the end date")
    if to_date and to_date >= date.max:
        raise HTTPException(422, "The report end date is out of range")
    try:
        start = datetime.combine(from_date, time.min, zone).astimezone(utc_timezone.utc) if from_date else None
        end = datetime.combine(to_date + timedelta(days=1), time.min, zone).astimezone(utc_timezone.utc) if to_date else None
    except (OverflowError, ValueError):
        raise HTTPException(422, "The report date is outside the supported timezone range") from None
    return ReportFilters(from_date=from_date, to_date=to_date, timezone=timezone,
                         start_at=start, end_at=end, **kwargs)


def report_filters(
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    timezone: str | None = Query(None, max_length=64),
    employee_id: str | None = Query(None, max_length=36),
    project_id: str | None = Query(None, max_length=36),
    status: models.TaskStatusEnum | None = None,
    search: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=100),
    sort: str = Query("", max_length=40),
    direction: Literal["asc", "desc"] = "asc",
    user: models.User = Depends(get_current_active_user),
) -> ReportFilters:
    return build_filters(from_date=from_date, to_date=to_date,
                         timezone=timezone or user.timezone or "UTC",
                         employee_id=employee_id, project_id=project_id, status=status,
                         search=search.strip(), page=page, page_size=page_size,
                         sort=sort, direction=direction)
