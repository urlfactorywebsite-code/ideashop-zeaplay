# Activity and time reporting audit

Inspected on 2026-10-20 before implementing the reporting services.

## Trusted records and their meaning

- `Task.created_at` is the stored UTC creation time (legacy column is timezone-naive). It is appropriate for task creation activity.
- Parent status comes only from `Task.status`. A subtask reaching `DONE` does not imply a parent completed.
- `TaskLifecycleEvent` captures persisted status changes with database triggers, including ORM, direct SQL and bulk updates. Its `occurred_at` records the actual observed transition. `TaskLifecycleCoverage.started_at` states when capture began. No transitions before coverage can be reconstructed.
- Parent completion means entering `DONE` or `DEPLOYED` from outside that set, matching `gamification.COMPLETED_STATUSES`. Moving between those completed states is not a second completion. Reopening means leaving that set. Subtask completion means entering `DONE`.
- `Task.assigned_at` is the date of the latest current assignment. Reassignment overwrites it; unassignment clears it. No immutable assignment event is captured by the lifecycle trigger. Consequently reporting can show current assignment dates in inventory, but cannot truthfully show a historical "tasks assigned" event series. It must advertise this limitation instead of substituting creation dates.
- `TimeEntry` targets exactly one parent task or subtask. The root task for a child entry is `Subtask.task_id`; its project is `Task.project_id`. `user_id` identifies the worker and is independent of the current assignee.
- Every time entry is one active interval. `continued_from_id` and `start_kind` distinguish resumed/restarted intervals; `stop_reason` records pause/stop. Pauses create a gap between intervals and never contribute active effort.
- Closed intervals persist whole `duration_seconds`. Corrections replace effective start/stop/duration and preserve original values. Reporting follows `services/work_history.py`: the accounted end is the earlier of `stopped_at` and `started_at + duration_seconds`, avoiding restoration of discarded fractions. Open intervals end at one report snapshot time.
- Regular-user and manager concurrent timer limits are already implemented as 3 and 5. Summing those simultaneous entries measures recorded effort; the union per employee measures unique working time. Neither metric is attendance/payroll.

## Security and historical boundaries

- Time entries have their own `tenant_id`; tasks derive tenant from their project, or creator for personal work. Both scopes must hold, and employee identity must still belong to the tenant.
- Reports use the shared reporting authorization and filter predicates. Regular users see only their own work intervals; managers see authorized task/project scope only. Current assignment filters do not replace the interval's actual worker filter.
- Archived projects remain eligible; archiving never changes completion classification.
- Deleted/inaccessible tasks cannot safely regain visibility just because immutable historical events survive. Their lifecycle records are excluded from aggregate reports requiring current authorized task scope.

## Query and implementation plan

1. Date activity uses SQL grouping by local daily/weekly/monthly buckets. PostgreSQL uses `timezone` and `date_trunc`; SQLite uses a deterministic timezone bucket function for the test/development engine.
2. Creation activity filters `created_at`; lifecycle activity filters `occurred_at`; timer starts filter `started_at`. No activity report applies task-creation bounds to work that happened later.
3. Time rows intersect the half-open UTC period and clip to its boundaries and a shared `as_of`. SQL aggregates recorded effort and counts. Bounded projection of interval endpoints is used only for exact per-worker unions.
4. Time grouping supports employee, parent task, subtask, project and local date. Per-group unique time must never be summed across tasks/projects to claim an organization total; overall unique time is calculated independently by employee.
5. Session history exposes paginated interval rows with pause/resume linkage, and active history filters running intervals. It avoids private notes, correction reasons and sensitive user fields.
6. Synchronous interval union is capped at 50,000 contributing intervals and rejects an over-limit request rather than returning partial totals. Narrowing the period is the available recovery.

## Implemented API contracts

- `GET /api/reports/activity?grouping=daily|weekly|monthly`: paginated `items`, full chart `series`, totals, local bucket dates and lifecycle coverage. Sorting accepts `date` or an available metric. There is no fabricated assignment-event column.
- `GET /api/reports/time?group_by=employee|task|subtask|project|daily`: SQL recorded-effort/count totals and per-employee unions, with independent overall union in `summary`. Daily reports allow at most 366 local days.
- `GET /api/reports/time/sessions?active=true`: optional running-only filter over a paginated interval history. Each interval includes target identity, effective start/stop, clipped effort, continuation ID, explicit pause/stop reason and linked resume timestamp. `interval_count` is deliberately not labeled as a count of logical resumed-session chains. Activity separately counts roots as `work_sessions_started`.
- All responses share filter metadata, one report snapshot, page/page-size/total-page values and `Cache-Control: private, no-store` at the router. Missing lifecycle tables/coverage return a clear HTTP 503 instead of presenting transition zeros.

Closed-entry accounting respects its stored integer duration. Clipping can split that whole duration into fractional seconds across midnight; aggregate duration values preserve microseconds so daily results reconcile with the summary. Time is represented as numeric seconds, never formatted strings.

Employee and project inventory tables also provide sortable `recorded_effort_seconds` through a grouped SQL join. This measures the actual worker's interval effort on the selected inventory tasks, so task creation bounds still select the inventory population while interval time is clipped to the same report period and snapshot. The separate Time report intentionally does not apply task creation bounds. Responses and exports explain this distinction in `recorded_effort_semantics`.

## Index review and limitations

Existing time indexes cover `(tenant_id, user_id, started_at)`, `(task_id, started_at)`, `(subtask_id, started_at)` and unique running targets. Lifecycle indexes cover tenant/task/id and subtask/id, but date-wide activity benefits from a reviewed `(tenant_id, occurred_at)` index. Task creation and assignment indexes should be reviewed alongside the shared inventory query plan.

Pre-capture transitions, deleted targets, assignment history and employee attendance cannot be recovered from current state. The response carries lifecycle coverage and unavailable-metric explanations. Current effective corrections affect historical time totals; this is an accounting report of the current ledger, not a reconstruction of what an old report displayed.

## Focused verification

- Local Windows/Python, isolated SQLite fixtures: 18 reporting tests passed. Coverage includes concurrent intervals, independent employee unions, 23/25-hour DST days, cross-midnight fractional clipping, active snapshot, explicit pauses/resumes, worker-based history after reassignment, inactive former project workers, archived projects, manager project boundaries, tenant/own-user isolation, caps, pagination, sorting, query count and API validation.
- Existing workflow/timer compatibility selection: 6 tests passed for persisted-status capture, all parent/subtask status serialization, legacy overlap/per-worker accounting, execution-report parent/child overlap, valid pauses and fractional interval math.
- Expanded inventory/export SQLite run: 34 tests passed. Additional cases validate real CSV/XLSX round trips, fractional daily durations, actual-worker effort in inventory, stable sort/filter/snapshot across export batches, formula/control/invalid-XML character handling, unauthorized downloads and rejection before partial files. Downloads include effective sorting, period, timezone, UTC generation time and metric definitions.
- PostgreSQL and broader integration results are recorded by the main reporting verification run; these SQLite results alone are not PostgreSQL or deployed-production proof.
