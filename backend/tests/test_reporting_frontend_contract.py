"""Exercise the real isolated reporting API against the fields/sorts used by its UI."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from uuid import uuid4

import pytest

from backend.app import models as m
from backend.tests.test_reporting_inventory import dataset, client, engine, auth, request  # noqa: F401


ROOT = Path(__file__).resolve().parents[2]
PAGE_SOURCE = (ROOT / "frontend/pages/Reports.tsx").read_text(encoding="utf-8")
TABLES = {
    name: [(field, sortable == "true") for field, sortable in re.findall(
        r"c\('([^']+)',\s*'[^']*'(?:,\s*(true|false))?", block)]
    for name, block in re.findall(r"  (\w+): \[\n(.*?)\n  \],", PAGE_SOURCE, re.S)
}
SESSION_FIELDS = [(field, sortable == "true") for field, sortable in re.findall(
    r"c\('([^']+)',\s*'[^']*'(?:,\s*(true|false))?",
    PAGE_SOURCE.split("const SESSION_COLUMNS: Column[] = [", 1)[1].split("];", 1)[0])]
DAILY_OMITTED = {"running_interval_count", "paused_interval_count", "resumed_interval_count"}
PARAMS = {"from": "2026-10-19", "to": "2026-10-20", "timezone": "UTC"}


@pytest.fixture
def populated(dataset):
    with dataset.factory() as db:
        child = db.query(m.Subtask).filter(m.Subtask.task_id == dataset.first.id).first()
        for target, start, stop in [
            (None, datetime(2026, 10, 19, 10, tzinfo=timezone.utc), datetime(2026, 10, 19, 11, tzinfo=timezone.utc)),
            (child.id, datetime(2026, 10, 19, 10, tzinfo=timezone.utc), datetime(2026, 10, 19, 11, tzinfo=timezone.utc)),
        ]:
            db.add(m.TimeEntry(id=str(uuid4()), tenant_id=dataset.owner.tenant_id, user_id=dataset.alice.id,
                               task_id=None if target else dataset.first.id, subtask_id=target,
                               started_at=start, stopped_at=stop, duration_seconds=3600,
                               status=m.TimeEntryStatusEnum.STOPPED))
        db.add(m.TaskLifecycleEvent(tenant_id=dataset.owner.tenant_id, task_id=dataset.first.id,
                                    event_type="task.status_changed", previous_status="TODO", new_status="DONE",
                                    occurred_at=datetime(2026, 10, 19, 14, tzinfo=timezone.utc),
                                    recorded_at=datetime(2026, 10, 19, 14, tzinfo=timezone.utc), details={}))
        # A manager sees a parent because they own a child; its parent assignment remains restricted.
        db.add(m.Subtask(task_id=dataset.private.id, title="Manager child", assigned_to_id=dataset.manager.id))
        db.commit()
    return dataset


def test_real_api_fields_sorting_and_export_contracts(populated, client):
    assert set(TABLES) == {"employees", "tasks", "statuses", "projects", "activity", "time"}
    params = {**PARAMS, "project_id": populated.project.id}
    captured = {"params": params, "responses": {}, "tested_requests": []}
    for section, columns in TABLES.items():
        variants = ([{"group_by": group} for group in ("employee", "task", "subtask", "project", "daily")]
                    if section == "time" else
                    [{"grouping": group} for group in ("daily", "weekly", "monthly")]
                    if section == "activity" else [{}])
        for variant in variants:
            query = {**params, **variant}
            body = request(client, populated.owner, section, **query)
            assert body["items"], section
            assert set(("items", "total", "page", "page_size", "total_pages", "meta")) <= body.keys()
            visible = [(key, sortable) for key, sortable in columns
                       if not (variant.get("group_by") == "daily" and key in DAILY_OMITTED)]
            for row in body["items"]:
                assert {key for key, _ in visible} <= row.keys(), (section, variant, row.keys())
            for key, sortable in visible:
                if not sortable:
                    continue
                for direction in ("asc", "desc"):
                    sorted_query = {**query, "sort": key, "direction": direction}
                    request(client, populated.owner, section, **sorted_query)
                    download = client.get("/api/reports/export", headers=auth(populated.owner),
                                          params={**sorted_query, "report": section, "format": "csv"})
                    assert download.status_code == 200, (section, variant, key, download.text)
                    captured["tested_requests"].append({"section": section, **sorted_query})
            captured["responses"][section + ":" + json.dumps(variant, sort_keys=True)] = body
    for key, sortable in SESSION_FIELDS:
        if sortable:
            body = request(client, populated.owner, "time/sessions", **params, sort=key, direction="desc")
            assert {field for field, _ in SESSION_FIELDS} <= body["items"][0].keys()
    employee = request(client, populated.owner, f"employees/{populated.alice.id}", **params)
    project = request(client, populated.owner, f"projects/{populated.project.id}", **params)
    assert {"projects", "projects_total", "projects_truncated", "tasks", "subtasks", "employee"} <= employee.keys()
    assert {"member_count", "manager_count", "members_truncated"} <= project["project"].keys()
    child = employee["subtasks"]["items"][0]
    assert {"id", "task_id", "title", "task_title", "status"} <= child.keys()
    assert child["task_id"] in {row["id"] for row in employee["tasks"]["items"]}
    assert "created_at" not in child  # Existing subtask model has no creation timestamp.
    own_child = request(client, populated.manager, f"employees/{populated.manager.id}", **PARAMS)
    assert own_child["employee"]["assigned_parent_tasks"] == 0
    assert own_child["tasks"]["total"] == 1
    assert own_child["tasks"]["items"][0]["assignee_name"] == "Restricted employee"
    captured["responses"]["employee_detail"] = employee
    captured["responses"]["project_detail"] = project
    captured["responses"]["own_child_detail"] = own_child
    captured["responses"]["overview"] = request(client, populated.owner, "overview", **params)
    captured["responses"]["options"] = request(client, populated.owner, "options", **params)
    output = os.environ.get("ZEAPLAY_REPORTING_CONTRACT_OUT")
    if output:
        target = Path(output).resolve()
        expected = (ROOT / "docs/advanced-reporting/checks").resolve()
        assert target.parent == expected, "Contract evidence must remain in the reporting checks directory"
        target.write_text(json.dumps(captured, indent=2), encoding="utf-8")
