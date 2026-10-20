# Reporting API contract

All endpoints are authenticated `GET` routes under `/api/reports` (also registered under `/reports` for existing API conventions). They use the application's bearer token, active-user validation and tenant identity. Clients must not supply a tenant override.

## Shared parameters

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | Optional ISO dates; inclusive user-facing dates; validated start <= end |
| `timezone` | Valid IANA name; defaults to configured user timezone or UTC |
| `employee_id` | Actual employee relation; unauthorized/foreign ID returns 404 |
| `project_id` | Authorized project including archived projects; unauthorized ID returns 404 |
| `status` | Exact persisted `TaskStatusEnum` value |
| `search` | Literal case-insensitive task-title search, max 200 characters |
| `page`, `page_size` | 1-based page; default 25, maximum 100 rows |
| `sort`, `direction` | Endpoint allowlisted field, `asc` or `desc`; stable ID tie-break |

Inventory employee filtering includes parents assigned to that employee **or containing their assigned subtasks**. Employee workload columns count only actual direct parent/child assignments. Time filtering uses the actual worker independently of current task ownership, subject to current target authorization.

List response:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 25,
  "total_pages": 0,
  "meta": {
    "as_of": "2026-10-20T12:00:00Z",
    "timezone": "Asia/Kolkata",
    "from": "2026-10-01",
    "to": "2026-10-20",
    "start_at": "2026-09-30T18:30:00Z",
    "end_at": "2026-10-20T18:30:00Z",
    "date_semantics": "task.created_at",
    "counting_unit": "persisted task.id",
    "filters": {"employee_id": null, "project_id": null, "status": null, "search": ""},
    "limitations": []
  }
}
```

## Endpoints

| Route | Response and purpose |
| --- | --- |
| `/options` | Authorized employee/project selections, totals, all exact statuses, timezone and metadata. Separate `employee_search`, `project_search`; `options_page` pages 100 selections at a time |
| `/overview` | `metrics`, `status_distribution`, top-ten `employee_workload`, top-ten `project_completion`, `meta` |
| `/employees` | Paged identity, active/inactive status, assigned parent/subtask counts, exact grouped parent-status counts, overdue, completion percentage, associated project count, active/completed assignments and recorded effort |
| `/employees/{id}` | `employee`, paged `tasks`, paged `subtasks`, authorized membership `projects` with total/truncation, `meta` |
| `/tasks` | Paged task/assignment rows: ID/group, title, status, project/archive, authorized assignee, creation/latest assignment/due/current stored completion dates, subtask progress, overdue |
| `/statuses` | Paged exact status, count, percentage, associated project/employee counts, overdue |
| `/projects` | Paged project/client/status/dates, complete authorized member/manager counts plus bounded name previews, task and subtask aggregates, completion percentage and recorded effort |
| `/projects/{id}` | `project`, paged `tasks`, paged `employees`, exact `statuses`, `meta` |
| `/activity` | Paged `items`, full bounded chart `series`, `totals`, `grouping`, lifecycle coverage and limitations. `grouping=daily|weekly|monthly` |
| `/time` | Paged grouped rows and independent `summary`; `group_by=employee|task|subtask|project|daily` |
| `/time/sessions` | Paged effective intervals with target/worker, UTC start/stop, clipped effort, pause/resume linkage and state. `active=true` selects running intervals |
| `/export` | CSV or XLSX binary download; `report=tasks|employees|projects|statuses|activity|time`, `format=csv|xlsx`; same grouping and filters |

Overview metrics: `total_tasks`, `assigned_tasks`, `unassigned_tasks`, `completed_tasks`, `in_progress_tasks`, `pending_tasks`, `blocked_tasks`, `overdue_tasks`, `completion_percentage`, `total_projects`, `employees_with_assigned_work`, `unique_task_groups`, `assignment_count`. Projects in scope includes authorized zero-matching-task projects, as stated in response metadata.

Activity metrics: `tasks_created`, `tasks_started`, `tasks_completed`, `tasks_reopened`, `subtasks_completed`, `work_sessions_started`, `work_intervals_started`, `recorded_effort_seconds`, `unique_working_seconds`. `tasks_assigned` is explicitly unavailable; current `assigned_at` does not provide immutable assignment events.

Time metrics: `recorded_effort_seconds`, `unique_working_seconds`, `interval_count`, `running_interval_count`, `paused_interval_count`, `resumed_interval_count`. Durations are numeric seconds, preserving fractional clipping. Daily rows supply date/name, effort, union and interval count; they do not fabricate unavailable pause/running grouping fields.

## Sorts and errors

Tasks support title/created_at/assigned_at/due_at/status. Employees and projects support name and exposed SQL aggregate fields. Statuses support status/count. Activity supports date or any returned metric. Time supports name, effort, unique time, interval counts (daily also date). Session history supports started_at/employee_name/task_title/recorded_effort_seconds.

401 means missing/invalid credentials; 403 means inactive actor; 404 conceals unauthorized filter/detail identifiers; 422 means invalid dates, timezone, status, sorting, pagination or a documented synchronous size limit; 503 means required lifecycle capture infrastructure is unavailable. Reports and exports send `Cache-Control: private, no-store`. Text exports protect formula-leading data and omit private notes, credentials, attachment storage paths and correction reasons.

PostgreSQL requests establish a read-only repeatable-read transaction before authentication and aggregation. The transaction time consistently clips running intervals and overdue calculations within that request. The query does not update workflow, parent status, assignments, timers, history, archive state or rewards.
