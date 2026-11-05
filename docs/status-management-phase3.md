# Status Management Phase 3 and Phase 2 review verification

Subsequent production-readiness review: see
[current release gate and migration f339a0b1c2d3](status-management-production-readiness.md).
The migration head and verification totals below describe the preceding Phase 3 run.

Verified locally on 2026-11-05 in `F:\Projects\ideashop-zeaplay-v5`.
This checkout is React/Vite/TypeScript plus FastAPI, SQLAlchemy and Alembic.
Existing Phase 1/2 changes and unrelated work were preserved. Nothing was deployed.

## Result and behavior

| Protected identity | Preserved task enum | Canonical behavior |
| --- | --- | --- |
| BATTLE_PLAN | WAITING_FOR_REQUIREMENT | Default for new tasks; no completion award |
| IN_PROGRESS | IN_PROGRESS | Active task; existing deadline and scoring rules |
| ON_HOLD | ON_HOLD | Persisted, authorized pause of eligible deadline aging |
| CONQUERED | DONE | Server completion time and one-time existing completion reward |

The seven additional legacy enum stages remain registered and accessible. Existing
`DEPLOYED` completion behavior is preserved. Labels, colors, icons and order never
select business behavior. Custom statuses default to `ACTIVE`; administrators can
explicitly select `PENDING` or `HOLD`. Their native mappings are respectively
`WAITING_FOR_REQUIREMENT`, `IN_PROGRESS` and `ON_HOLD`. Changing an assigned custom
status's behavior requires reassignment first. Custom `COMPLETED` is rejected.

Transitions from task creation, details/API, Kanban, project-dashboard overrides
and the subtask completion engine share validation. API automations use these same
endpoints. Configuration removal uses the same transition service for reassignment.
Historical import/restore remains a data-restoration operation, not a new reward event.
The project-dashboard override previously bypassed completion validation/rewards;
it now rejects unfinished subtasks and runs canonical completion, approval, badge,
notification, ticket-link and automation handling. Its response shape is preserved.

On Hold stores original deadline, previous native/custom status, actors, reason and
start/end timestamps. Database guards capture native hold entry/exit, including
direct SQL writes, and reject overlapping periods, cross-workspace ledger inserts,
history rewrites/deletes and PostgreSQL truncation. Task deletion closes an open
hold and retains its history. Repeated hold requests do not open another interval.

Effective deadline = original deadline + closed authorized hold seconds + elapsed
open hold time. A task already one hour late stays one hour late during a hold;
its earlier lateness/penalty is not erased. Original deadlines, assignment times and
tracked timer entries are retained. The shared calculation is used by completion
scoring, task/Calendar overdue filters, reporting aggregates and frontend previews.
The existing engine applies late penalties on completion; no recurring daily
penalty scheduler was found or introduced. Hold/pending transitions award no
completion points. Existing task-creation points remain separate and unchanged.

Completion timestamps are server-owned. Attempts to supply `completed_at` to the
live update API receive 422. Native status values and the existing status endpoints
are preserved; additive response fields expose hold summaries, effective deadlines
and explicit behavior. `/api/tasks/{id}/holds` uses existing task-view authorization
and private/no-store caching. Completion points, task-completed counters and badge
completion processing use the permanent award marker and transaction/row locks.
Two retries and reopen/re-complete do not award the task a second time.

An explicit status in a combined status/subtask update takes precedence over parent
auto-completion. Creating a held task with pre-completed children also remains On
Hold. These paths cannot transiently complete the parent and award points. Ordinary
subtask-only completion continues to use the existing parent completion policy.

## Phase 2 review fixes retained

- Counts, cards, column configuration and revision come from one consistent database
  read snapshot; concurrent writes cannot split these into different board states.
- Hidden/archived custom-status tasks remain in explicit outside-column sections;
  unmapped legacy records remain visible and paginated. Removed status filters reset
  with a notice. No task is silently dropped from the response or client grouping.
- Backend-derived edit capabilities control dragging, Edit and the accessible native
  move selector. All moves submit registered internal IDs and undergo backend RBAC.
- Pending moves retain the source card until confirmed/refetched; failures preserve
  the card/draft. Empty columns skip unnecessary task queries. Fifty added empty
  columns add zero task queries; loaded cards are grouped in one pass.
- Long labels wrap; mobile board/table/preview scroll within their containers. Filter
  menus have correct stacking and keyboard navigation. Reordering supports buttons
  and dragging; system lock tooltips support hover, focus and Escape.
- Drafts survive duplicate-label errors and configuration conflicts. Clean editors
  and boards refresh through existing tenant-scoped events/storage/focus/polling.
  No new socket connection was introduced. Battle Board styling is retained.

Phase 3 adds optional/mandatory hold reasons in board, creation and details flows,
lazy read-only hold history, explicit custom behavior controls and a tenant reason
policy. Details uses registered statuses instead of its old hardcoded list, retains
failed edits, and ignores stale mutation responses after an account/task change.
An unavailable current status remains explicitly identified in the details selector,
with recovery into a registered destination; it cannot appear as a different option.
Notification labels are now resolved from the task's tenant registry rather than
the old global Kanban table.

## Migration and rollback

New migration: `f228f9a0b1c2_core_status_business_rules.py`, parent `f117e8f9a0b1`.
`alembic heads` reports `f228f9a0b1c2` as the sole head. Earlier migration/guard
implementations are unchanged; the new version replaces/extends guards explicitly.

It adds task hold summaries/transition version, scope hold-reason policy, explicit
status behavior and `task_hold_intervals`. Backfills preserve task/status IDs, native
enums, original deadlines, creation/assignment timestamps and lifecycle history.
Existing ON_HOLD tasks receive a single open interval beginning at migration cutover,
with a durable `migration:f228f9a0b1c2` marker. No historical pause duration is guessed.

Applied/tested only on disposable SQLite/PostgreSQL schemas. No persistent application,
VPS or production database was migrated. Fresh Phase 2-shaped schemas and schemas
containing legacy held tasks were upgraded on both engines; identity/history/
timestamp preservation, post-upgrade transitions and downgrade refusal were checked.
These are targeted migration fixtures, not certification of every earlier migration
against a production database dump.

Deployment procedure:

1. Stop task writers, workers and external automation writes. Take a full database
   backup including lifecycle/audit/hold data. Verify restoration in an isolated
   database and record the current migration revision. Logical task/CSV exports
   are insufficient for rollback.
2. From `backend`, with the deployment's intended database configuration and
   `VEE_BOOTSTRAP_SCHEMA=false`, run `venv/Scripts/python.exe -m alembic current`
   and `venv/Scripts/python.exe -m alembic heads`. Confirm the expected parent.
   Investigate unversioned/drifted databases; do not stamp over discrepancies.
3. Test the migration on the restored backup, then run
   `venv/Scripts/python.exe -m alembic upgrade f228f9a0b1c2` in the maintenance window.
   The Linux equivalent uses the deployment virtualenv's Python executable.
4. Start matching backend/frontend versions. Verify readiness, all core mappings,
   task/history counts, scoped configuration and an authorized hold/resume/completion
   round trip before resuming writers.

The downgrade deliberately refuses to destroy the hold ledger or effective-deadline
data. Do not put old deadline/scoring code back into write service after holds have
accrued. Prefer a compatible forward fix. For database rollback, stop all writers and
restore the verified full backup through a reviewed maintenance procedure, explicitly
reconciling any post-backup writes. Retaining the additive schema alone does not make
an older application's deadline calculations compatible with Phase 3.

## Verification

| Check | Result |
| --- | --- |
| Core rules + Status Management + Kanban + lifecycle + subtask handoff, SQLite/PostgreSQL | PASS: 158; one SQLite skip for PostgreSQL repeatable-read/read-only behavior |
| Project dashboard and existing gamification regression | PASS: 17 |
| Reporting inventory/index/frontend contract, SQLite/PostgreSQL | PASS: 43; one SQLite skip for PostgreSQL planner evidence |
| Frontend status/deadline/points/Settings/task navigation/journey/subtask/report unit checks | PASS: 59 |
| Settings/preview browser regression, actual components with synthetic HTTP | PASS: 33 checks |
| All Tasks Kanban browser regression, actual components/adapters with synthetic HTTP | PASS: 29 checks |
| Phase 3 reason/history/custom-behavior browser regression | PASS: 22 checks |
| Browser through real JWT/FastAPI/SQL database | PASS: 22 checks |
| Production frontend build | PASS; existing large-chunk and third-party eval warnings |
| Project TypeScript | FAIL baseline: same 116 diagnostics as unchanged HEAD, zero added/removed diagnostics |
| Python syntax, Alembic head and `git diff --check` | PASS |

Totals: **218 backend tests passed, two engine-specific skips; 59 frontend unit
tests; 106 browser checks**, including real HTTP/database end-to-end checks.
The real API browser pass verifies Battle Plan creation, saved labels/order and
reason policy, hold/resume persistence, original deadline retention, exactly-once
completion across two retries, actual foreign-tenant JWT rejection, audit retention
and browser refresh. Its navigation/session shell and all records are synthetic;
task/status requests use actual adapters, auth, routers, transactions and SQL guards.

PostgreSQL Phase 3 tests used a loopback-only disposable PostgreSQL 17 server after
the original disposable Docker endpoint became unresponsive. No Docker daemon or
unrelated container was restarted. The portable server and browser fixture servers
were stopped after verification. This does not certify the running Docker build,
hosted environment, production data or deployment. The original unresponsive
`zeaplay-status-test` container may require cleanup once Docker responds.
Automatic approval review rejected deletion of workspace-local scratch binaries
and databases with the reason "blocked by policy". Those files remain under `.tmp`;
the cleanup was not retried through another mechanism.

Reproduction from repository root, with dependencies already installed:

```powershell
$env:TEMP="$PWD\.tmp\status-review-temp"
$env:TMP=$env:TEMP
$env:VEE_BOOTSTRAP_SCHEMA='false'
# Set ZEAPLAY_RT_POSTGRES_TEST_URL to an explicitly disposable PostgreSQL URL.
# The database name must contain rt3_test. Tests create/drop isolated schemas.
backend/venv/Scripts/python.exe -m pytest backend/tests/test_core_status_business_rules.py backend/tests/test_task_status_management.py backend/tests/test_kanban_customization.py backend/tests/test_task_lifecycle.py backend/tests/test_subtask_handoff_regression.py -q --disable-warnings
backend/venv/Scripts/python.exe -m pytest backend/tests/test_tasks_phase11.py backend/tests/test_gamification_phase12.py -q --disable-warnings
backend/venv/Scripts/python.exe -m pytest backend/tests/test_reporting_inventory.py backend/tests/test_reporting_index.py backend/tests/test_reporting_frontend_contract.py -q --disable-warnings
Set-Location frontend
node --test --test-concurrency=1 --import tsx test/kanban-customization.test.tsx test/core-status-business-rules.test.ts test/gamification-compatibility.test.ts test/task-dates.test.ts test/settings-navigation.test.ts test/project-dashboard-contract.test.ts test/task-navigation.test.ts test/task-journey.test.ts test/subtask-workflow-contract.test.ts test/task-report.test.ts
node --max-old-space-size=1536 node_modules/vite/bin/vite.js build
```

Run the three synthetic `.playwright.js` functions with Vite at `127.0.0.1:6337`
and `VITE_API_BASE_URL=/api`. For the real API browser test, separately run
`backend/venv/Scripts/python.exe frontend/e2e/core-status-live-backend.py` from the
repository root, start Vite with `VITE_API_PROXY_TARGET=http://127.0.0.1:6338`, then
run `core-status-live.playwright.js`. The fixture creates a fresh database each
start under `.tmp/status-live`, binds only to loopback and suppresses external
delivery. Its test-only setup/state endpoints must never be mounted in the app.
Stop fixture servers and remove only their disposable data after testing.

## Files changed for Phase 3

- Persistence/migration/readiness: `backend/app/models.py`, `main.py`,
  `status_business_schema_v3.py`,
  `backend/alembic/versions/f228f9a0b1c2_core_status_business_rules.py`.
- Rules/integration: `backend/app/services/task_transitions.py`, `task_deadlines.py`,
  `task_statuses.py`, `task_access.py`, `task_notifications.py`, `gamification.py`,
  `subtask_workflow.py`, `project_dashboard.py`; `backend/app/reporting/inventory.py`;
  `backend/app/routers/tasks.py`, `projects.py`, `kanban.py`, `task_statuses.py`;
  `backend/app/schemas.py`.
- UI/adapters: `frontend/components/StatusManagement.tsx`, `TaskDetailModal.tsx`,
  `CreateTaskModal.tsx`, `TaskHoldHistory.tsx`; `frontend/pages/KanbanBoard.tsx`,
  `Tasks.tsx`, `CalendarView.tsx`; `frontend/services/mockApi.ts`, `types.ts`,
  `utils/taskDeadlines.ts`, `taskPoints.ts`, `kanbanConfiguration.ts`.
- Verification: `backend/tests/test_core_status_business_rules.py`,
  `test_task_status_management.py`, `test_task_lifecycle.py`, `test_tasks_phase11.py`;
  `frontend/test/core-status-business-rules.test.ts`; `frontend/e2e/settingsNavigationFixture.tsx`,
  `core-status-business-rules.playwright.js`, `core-status-live.playwright.js`,
  `core-status-live-backend.py`; this report and Phase 2 review documentation.
  Phase 1/2 file inventories remain in their existing reports. Screenshot:
  `artifacts/core-status-business-rules-mobile.png`.

## Policy decisions and remaining limits

- No approved automatic reopen points-reversal policy was found. Existing points
  and the permanent award marker are retained; reopening clears the active completion
  timestamp/approval state, and re-completion does not pay again. Administrator approval
  and a deliberate ledger migration are required to introduce reversal/re-award rules.
- Custom Completed mappings remain disabled pending an approved completion-policy
  migration. Conquered and the existing legacy Deployed behavior remain supported.
- Administrators must review any desired credit for holds predating migration cutover;
  the application does not fabricate start dates or reverse previously assessed penalties.
- Existing explicit timer controls and tracked-time history remain unchanged. Automatically
  stopping timers on Hold would require a separate approved timer policy.
- A clean global TypeScript gate remains blocked by the existing 116 diagnostics.
  Full-project release certification and production migration/deployment were not run.
