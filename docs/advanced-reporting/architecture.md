# Advanced Reporting: existing architecture and implementation

## Phase 1 findings

The running application is the existing FastAPI/SQLAlchemy backend and React frontend. The Reports page currently aggregates fetched tasks in the browser (`frontend/pages/Reports.tsx`) and exports CSV. It has no tenant reporting aggregation API. The old reporting Alembic revisions create employee-day/hourly reporting tables, but those tables are not part of the currently registered application reporting routes or ORM. They must not be treated as task, assignment, or timer sources of truth.

Existing useful capabilities include project task dashboards (`backend/app/services/project_dashboard.py`), task lifecycle history, per-task execution reports (`backend/app/routers/task_lifecycle.py`), active-work history, and interval-union time metrics (`backend/app/lifecycle/analytics.py`). The project dashboard's derived status is separate from the persisted parent status. Reporting must read `Task.status` directly and must never invoke a workflow mutation.

### Relationships and counting

* `User.tenant_id` is the authenticated tenant boundary. Users have ACTIVE/DEACTIVATED status and an optional IANA timezone.
* `Project` belongs to a tenant and client. `ProjectMember` links users with MANAGER/MEMBER project roles and a unique tenant/project/user key. Project membership is not a task assignment.
* `Task.project_id` is nullable; `Task` has no mapped tenant column. Project tasks inherit their project's tenant; standalone legacy tasks inherit their creator's tenant. Reuse `services/task_access.py`.
* A parent task has one `assigned_to_id`. Multi-assignee creation creates separate task records sharing `task_group_id` (`routers/tasks.py`, `create_task`). These records can have different persisted statuses, subtasks, and completion dates.
* `Subtask` belongs to one task, has one optional assignee, and stores its own workflow status. `completed` is a compatibility flag; workflow `status == DONE` is the reporting completion rule.
* `TimeEntry` has tenant/user and exactly one task OR subtask target. Each active interval is a separate row. Pauses stop rows; resumes create linked rows through `continued_from_id`.

The canonical inventory unit is a distinct persisted `Task.id`, counted once even when joined to many children. A separate distinct `task_group_id` metric identifies grouped multi-assignee work. Group counts cannot be substituted into status totals: grouping different persisted statuses would invent a parent status. Employee reports count distinct task IDs actually assigned to that employee and distinct subtasks actually assigned to them. No ownership is inferred from project membership.

### Status and date truth

Persisted parent statuses are WAITING_FOR_REQUIREMENT, TODO, IN_PROGRESS, BUG_FIXING, IN_REVIEW, BLOCKED, ON_HOLD, DONE, DEPLOYED, FAILED, GRAVEYARD. Subtasks use WAITING, TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, DONE. Completion uses DONE/DEPLOYED, matching existing gamification. The reporting pending category is WAITING_FOR_REQUIREMENT/TODO/ON_HOLD; work in progress is IN_PROGRESS/BUG_FIXING/IN_REVIEW. Overdue means a past due timestamp and a nonterminal status; DONE/DEPLOYED/FAILED/GRAVEYARD are excluded. Status distribution retains every exact persisted status.

Inventory date filters apply to `Task.created_at`, independently of current status. `assigned_at` describes the latest stored assignment, not full assignment history. It is set and replaced by assignment/transfer paths. `completed_at` is stored but can be edited and may remain stale after some existing update paths; it must not be used to manufacture a historical completion series. No subtask created/assigned/completed timestamp columns exist.

The immutable lifecycle tables and database triggers capture task/subtask creation, deletion and status transitions, plus timer changes. `TaskLifecycleCoverage.started_at` records installation coverage. Historical started/completed/reopened events are reliable only for captured transitions; no retroactive events may be inferred from `updated_at`. Existing v1 triggers do not capture assignment transitions. Full assignment-event reporting therefore remains unavailable. Stored `assigned_at` can be displayed explicitly as latest assignment metadata.

Legacy task/project dates are naive UTC; timer/lifecycle columns are timezone-aware UTC. Report dates are interpreted in the requested validated IANA timezone, defaulting to the user's configured timezone or UTC. The user-facing final date is inclusive; internal bounds are local midnight on the first day and local midnight after the final day, converted separately to UTC. This preserves daylight-saving changes and uses `[start, end)` comparisons.

### Access and archive behavior

Authentication validates token tenant against the current user's tenant and rejects inactive actors. Admin/owner report scope is tenant-wide. Manager reporting is limited to projects where they hold MANAGER membership, their own assigned work, and established standalone department work. A manager role alone never grants access to every project. Regular-user reporting is limited to their own parent/subtask assignments and their own timer work. Reporting filter selectors and exports must apply the same server-side predicates.

Project metadata remains visible through an existing project membership; this can produce a project row with zero own tasks. Membership never grants task inventory ownership. When a person owns a subtask under someone else's parent task, only their visible child workload is returned. Unauthorized assignee identity is replaced with an explicit restricted-employee marker rather than falsely describing the parent as unassigned. Managers can retain former/inactive worker identities through actual assignment or timer relationships inside managed projects.

Projects and clients retain rows when archived. Historical reporting includes authorized archived projects, clearly marked ARCHIVED; archival never implies completion. Inactive employees retain their identities and assignments and are included when authorized. Hard deletion and reassignment can remove current relationship evidence; historical inventory is not an as-at reconstruction of deleted records.

### Existing performance constraints and plan

The old Reports page fetches task and user records and performs browser aggregation; project dashboards eagerly load related records. Neither is an organization-scale aggregation source. Per-task analytics intentionally cap materialized sessions at 50,000 and use interval union, not browser durations.

New reporting inventory queries should build one tenant/RBAC-filtered task subquery and use SQL COUNT, conditional SUM, grouped queries, and independent preaggregated child relations. Pagination and sorting occur in SQL; page enrichment uses batched queries. Charts have explicit bounded top-N datasets. Time calculations require clipped intervals and per-user union; PostgreSQL window functions can calculate union islands without fetching full tables.

Existing useful indexes include tasks.project_id/task_group_id, subtasks(task_id,status)/assigned_to_id, project memberships by tenant/project/user, time_entries(tenant_id,user_id,started_at), task/subtask timer-start indexes, and lifecycle(tenant_id,task_id,id). Some legacy index migrations refer to a tasks.tenant_id column absent from the mapped Task model. Do not run those blindly. Inspect deployed schema and plans before applying reporting-specific indexes; no schema bootstrap or production migration is authorized merely by reading this document.

The reproducible in-memory probe in `checks/index_probe.py` used 100,000 synthetic tasks and 100,000 lifecycle events. For an event-period query, the existing tenant/task/id index still required a full scan. A tenant/occurred_at/task_id index produced a covering range scan with identical 100-event totals (single probe: 5.7 ms versus 0.031 ms). Migration `ffa0d1e2f3a4` adds only this event index, concurrently on PostgreSQL. A proposed project/creation task index showed no measured improvement over the existing creation index and was deliberately omitted. These measurements are SQLite query-shape evidence, not PostgreSQL/production throughput certification. No deployed database was changed by the probe.

The isolated PostgreSQL 16 probe subsequently inserted 100,000 synthetic lifecycle events and compared `EXPLAIN (ANALYZE, BUFFERS)` before/after the migration. The same 200 matching events changed from a sequential scan (99,800 rows rejected, 1,539 shared-buffer hits, 6.317 ms) to an index-only range scan (8 shared-buffer hits, 0.075 ms). Raw evidence is `checks/index-probe-postgres.json`. This demonstrates the intended PostgreSQL access path in a disposable fixture, not production throughput guarantees. The migration's upgrade and downgrade also pass isolated row-preservation checks.

## API and aggregation design

Read-only `/reports` endpoints extend the existing router architecture and are also mounted under `/api/reports`. Filters are `from`, `to`, `timezone`, `employee_id`, `project_id`, `status`, `search`, `page`, `page_size`, `sort`, and `direction`. Page size is bounded. API responses include a report snapshot, date semantics, normalized period, applied filters, and known historical/counting limitations.

Inventory endpoints are options, overview, employees and employee detail, tasks/assignments, status summary, projects and project detail. Activity/time endpoints use their own event/interval timestamps with the same selected employee/project/status context, rather than restricting those events to tasks created in the period. SQL aggregations count persisted task IDs, and separate subtasks/group counts prevent accidental multiplication.

`GET /reports/overview` returns `metrics`, `status_distribution`, `employee_workload`, `project_completion`, and `meta`. Employee/project charts are the top 10 by current filtered task count, explicitly disclosed in metadata. Project count is the number of authorized projects in the selected project scope, including zero-work projects.

List endpoints return `{items, total, page, page_size, total_pages, meta}`. Task rows include their separate task group ID, persisted status, project/archive status, assignment metadata, dates, child counts, and overdue flag. Employee rows include exact parent/subtask assignment counts, state categories, completion percentage, and distinct associated task-project count. Project rows include independent parent and child counts, client/status/date fields, and authorized member previews.

Options provide searchable, paginated employee/project results, including inactive and archived entries. Project member previews are bounded to 25 names, with full `member_count`, `manager_count`, and `members_truncated`. Employee-detail membership previews are bounded to 100 with `projects_total` and `projects_truncated`. These preview bounds do not truncate task or membership aggregate counts.

Every response is computed in one read-only repeatable-read transaction on PostgreSQL with a single snapshot time. Separate HTTP requests take separate snapshots; no cross-request historical state reconstruction is claimed. The `Cache-Control: private, no-store` response prevents shared report caches. No credentials, profile notes, phone numbers, or timer notes are returned.

Validation should cover zero-work employees, multiple-assignee grouped task records, all statuses, archived projects, inactive employees, unassigned work, tenant and manager boundaries, timezone/DST windows, overlapping timers, cross-midnight clipping, deterministic pagination/sorting, and CSV/XLSX consistency and formula safety. New reporting must not update tasks, timers, history, rewards, or archive state.
