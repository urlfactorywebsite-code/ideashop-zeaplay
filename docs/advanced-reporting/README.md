# Advanced Reporting & Analytics

This extends Zea.Play's existing Reports route, authenticated Axios client, FastAPI routers, SQLAlchemy models, task relationships, lifecycle history and time-entry ledger. It does not create a separate reporting database or change task workflow.

## Using Reports

1. Open **Reports** from the existing desktop sidebar or mobile navigation.
2. Choose a date preset or inclusive custom dates, employee, project, and persisted parent-task status. Employee/project selectors support server search and pagination. Archived projects and inactive historical employees remain identifiable.
3. Select **Apply filters**. The URL, cards, charts, tables, details and exports use that applied context. **Reset** restores this month's defaults. **Refresh** reloads current data.
4. Switch between Overview, Employees, Tasks & assignments, Task statuses, Projects, Date-wise activity, and Time tracking. Sort supported table columns and use server pagination. Chart buttons drill down to the corresponding employee, project or exact status.
5. Open an employee/project row for its detail, related tasks, subtask progress and recorded work. Task links open the existing task view, including the existing status journey/execution report where permitted.
6. Time tracking can group by employee, task, subtask, project or local day. Session history shows active intervals, explicit pause/resume links and a running-only filter.
7. Choose CSV or Excel and export. The file includes **all filtered rows**, independently of the displayed page, with generation timestamp, period, timezone, filters and metric definitions.

## Metric rules

| Report | Date meaning | Counting rule |
| --- | --- | --- |
| Overview, employees, assignments, statuses, projects | Current inventory filtered by parent `Task.created_at` | Distinct persisted task IDs; child joins never multiply task totals |
| Date-wise activity | Corresponding creation, observed status-transition or timer-start timestamp | Creation counts tasks; transitions may count the same task more than once |
| Time | Effective active intervals intersecting the selected period | Clip to `[start, end)` and one server snapshot |

The frontend uses the user's configured IANA timezone, falling back to UTC. The backend validates it and converts each local midnight separately to UTC, including daylight-saving changes.

This schema stores multi-assignee work as **separate task records sharing a task-group ID**. Those records may have different statuses. Task totals count each persisted task once; the separate group count is not a status denominator. Employee workload counts actual parent/subtask assignments, never project membership.

Parent status always comes from persisted `Task.status`. Completed means `DONE` or `DEPLOYED`; in progress groups `IN_PROGRESS`, `BUG_FIXING`, `IN_REVIEW`; pending groups `WAITING_FOR_REQUIREMENT`, `TODO`, `ON_HOLD`. Exact status distributions retain all eleven stored statuses. Overdue excludes `DONE`, `DEPLOYED`, `FAILED`, and `GRAVEYARD`. Subtask completion is independently `Subtask.status == DONE`.

Recorded task effort adds active timer intervals. Unique working time unions overlaps **per employee** before summing employees. Three timers of 60, 60 and 30 minutes overlapping within one hour produce 150 minutes of effort and 60 minutes of unique time. Neither is an attendance or payroll measure. Unique time grouped by different tasks/projects is not additive; the overall summary computes its own union.

## Access

Owner/admin sees authorized tenant-wide data. Managers see managed projects, permitted standalone department work and their own assignments; the manager role alone does not unlock other projects. Regular users see their own assignments and authorized own work. Selectors, details, aggregates and exports enforce the same backend tenant/role predicates. Peers' assignment identities can be redacted while retaining an authorized parent task's status.

## Historical and scale limits

- `assigned_at` retains the latest current assignment; immutable reassignment events are unavailable. No assignment history series is invented.
- Historical completion/start/reopen metrics begin with installed lifecycle capture. Earlier missing events are not assumed to be zero historical activity. Missing capture infrastructure returns HTTP 503.
- Inventory is current state, not a reconstruction of old ownership/status. Deleted or currently inaccessible targets are excluded; current timer corrections affect historical totals.
- Archived projects stay in scope and are never automatically considered complete.
- Synchronous time unions reject more than 50,000 contributing intervals. Daily activity/time windows support at most 366 local days. Narrow the period when requested.
- Exports reject more than 20,000 rows before returning a file. CSV is written in batches and XLSX uses a write-only workbook; output spools to disk above 2 MiB. No background export worker was introduced.
- Each API request/export has its own database snapshot and timestamp. A newly generated export can reflect edits made after the displayed report loaded.
- Overview charts show the top ten employees/projects; detailed tables and exports provide the complete filtered population. Project/member name previews are bounded and expose complete authorized counts.

## Implementation and evidence

- [Architecture and database aggregation](architecture.md)
- [API contract](api.md)
- [Activity/time source-of-truth audit](time-audit.md)
- [Frontend audit](frontend-audit.md)
- [Frontend validation](frontend-validation.md)
- [Validation and acceptance evidence](validation.md)
- [Deployment and verification](deployment.md)

Backend additions are `app/reporting/{filters,scope,inventory,activity,work,exports}.py`, `app/routers/reports.py`, router registration in `app/main.py`, export/timezone dependencies, and the lifecycle-period index migration. Tests are `test_reporting_inventory.py`, `test_advanced_reporting_time.py`, `test_reporting_exports.py`, `test_reporting_index.py`, and `test_reporting_frontend_contract.py`.

Frontend additions/changes are listed in the frontend validation document. Unrelated pre-existing task/notification edits were preserved. No deployed application database or production service was changed by reporting validation.
