# Phase 2: Kanban Board Customization

Implemented in the existing React/Vite frontend and FastAPI/SQLAlchemy/Alembic backend. Configuration remains under **Settings → Sidebar Management → Status Management**. Phase 1 changes and unrelated application behavior are preserved.

## Behavior and compatibility

- The production Battle Board renders only tenant-registered statuses in saved order. Its placeholder “Add Stage” column is removed. All eleven existing built-in statuses, including the four required core statuses, remain visible and protected; no existing enum is removed.
- Labels, colors, icons and ordering are presentation settings. The mappings `BATTLE_PLAN → WAITING_FOR_REQUIREMENT` and `CONQUERED → DONE` and every existing task identifier remain unchanged. Existing status APIs remain supported.
- Active, visible custom statuses become board columns. Hidden/archived statuses with matching tasks appear in a separate retained-quests list with counts and paginated cards. Editable cards can be dragged into a visible column. Unknown historical status references are listed explicitly with title, task ID and raw status; they require reviewed administrative mapping rather than a guessed transition.
- The existing server search, permission filters, date filters, cards, pagination, responsive behavior and board panning remain. Column headers show full filtered counts, rather than only the loaded page size. Loading, empty, refresh, failure/retry and failed-move rollback states are visible.
- `GET /tasks/kanban` adds `configuration_revision`, immutable column `status_id`, `is_system`, `outside_columns`, `unmapped_count` and `unmapped_items`; existing column fields remain. Unknown enum values are read through raw projections so they cannot crash this board or configuration counts.
- `PATCH /tasks/{task_id}/kanban-status` accepts only `{ "status_id": "<registered status primary key>" }`. The backend resolves it within the authenticated tenant, rejects hidden/inactive custom destinations, locks the scope/task, and delegates to the existing task-update workflow. Completion approval, subtasks, rewards, lifecycle history and automation behavior continue through that workflow. Legacy enum/custom-status update APIs are unchanged.
- Tenant-scoped configuration revision plus cache-format version separates old cached board responses. Saves invalidate task queries and announce the tenant through an in-tab event and a cross-tab storage event. Active boards also revalidate every 30 seconds; existing shared realtime infrastructure is retained. The status editor remounts on account/tenant/role changes.

## Editor and preview

The customization section provides editable labels, colors/icons, native drag ordering, accessible Move Left/Move Right buttons, custom visibility, Reset to default arrangement, Save, Cancel and reload of unsaved changes. System visibility controls are locked. Reset stages presentation defaults only; identities, internal names, descriptions, activation and task references are preserved until an explicit save.

Desktop and compact-width previews update from the same local draft before saving. They share the production column frame, RPG palette and card surface. Preview titles, assignees and counts are synthetic; no production tasks are fetched for it. Focus rings, keyboard-scrollable regions, live reorder announcements, lock explanations and unsaved navigation/tab-unload warnings are provided. The system tooltip opts into Escape dismissal for hover as well as focus; other existing tooltips retain their behavior.

Configuration updates retain Phase 1 owner/admin authorization, navigation policy enforcement, strict input validation, Unicode duplicate detection, optimistic revisions, transactions and append-only audit snapshots. Referenced custom-status removal still requires explicit reassignment and confirmation.

## Migration and rollback

New revision: **`f117e8f9a0b1`**, parent **`f006d7e8f9a0`**. The frozen Phase 1 migration is unchanged.

The forward migration changes only previously hidden built-in status configurations to visible. It records one `system_visibility_backfill` audit per affected status with actor `migration:f117e8f9a0b1`, increments each affected tenant revision once, then installs PostgreSQL/SQLite guards against hidden system statuses. Task rows, enum values, custom associations, lifecycle history and points are untouched. Reapplying the backfill does not duplicate audits or increment revisions again.

Rollout procedure:

1. Stop application writers for the migration window. Take a full database backup with the installation's existing connection settings; validate it and restore it to a separate database first. Retain the previous application image.
2. Check `alembic current` and `alembic heads` in the backend environment. Resolve drift or an unversioned database explicitly; do not stamp it to bypass inspection.
3. From the reviewed Phase 1 parent, run `alembic upgrade f117e8f9a0b1`. Install the matching backend before the new frontend, which uses the new move endpoint.
4. Check readiness, all protected mappings/visibility, tenant-scoped counts, a custom move and a completion-policy rejection. Refresh the board to verify saved labels/order and retained hidden tasks.

Application rollback can retain the additive schema and visible arrangement. `alembic downgrade f006d7e8f9a0` removes only the Phase 2 visibility guards; it intentionally retains backfilled visibility, revisions and audit records. It does not revert task data. A full database restoration requires stopped writers and the verified backup, accounting for post-backup writes. The guarded Phase 1 downgrade still refuses destructive deletion of statuses/history.

**Migrations executed here:** disposable SQLite and isolated PostgreSQL 17 schemas only, including forward backfill, repeat upgrade, SQL enforcement and downgrade. No persistent application database or deployed service was migrated or restarted.

## Files changed for Phase 2

- Persistence/API: `backend/app/kanban_schema_v2.py`, `models.py`, `schemas.py`, `services/task_statuses.py`, `routers/tasks.py`, `backend/alembic/versions/f117e8f9a0b1_kanban_system_visibility.py`.
- UI/shared presentation: `frontend/components/StatusManagement.tsx`, `KanbanPreview.tsx`, `KanbanColumnFrame.tsx`, `ui/Tooltip.tsx`, `frontend/pages/SidebarManagement.tsx`, `KanbanBoard.tsx`, `frontend/utils/kanbanAppearance.ts`, `kanbanConfiguration.ts`.
- API adapter/types: `frontend/services/mockApi.ts`, `frontend/types.ts`.
- Tests/fixtures: `backend/tests/test_kanban_customization.py`, `frontend/test/kanban-customization.test.tsx`, `frontend/e2e/status-management.playwright.js`, `kanban-customization.playwright.js`, `settingsNavigationFixture.tsx` (opt-in use of real board API adapters; default fixture behavior retained).
- Documentation: this file. Screenshots: `artifacts/kanban-preview-desktop.png`, `kanban-preview-compact.png`, `kanban-customization-desktop.png`, `kanban-customization-mobile.png`.

## Verification — 2026-11-05

| Check | Result |
| --- | --- |
| Existing status + new Kanban + lifecycle integration regression, SQLite and PostgreSQL | PASS: 94 passed, 1 intentional SQLite skip for PostgreSQL repeatable-read semantics |
| Final Phase 2 suite, including additional concurrent hide/move and ordinary-user RBAC cases | PASS: 16 passed on both engines; 12 overlap the regression run, 4 are additional cases |
| Frontend customization, journey, Settings and task navigation unit checks | PASS: 36 |
| Settings browser checks with actual components/synthetic HTTP | PASS: 27, including hover/focus Escape dismissal and unsaved navigation/tab warnings |
| Production All Tasks browser checks with actual components/API adapters/synthetic HTTP | PASS: 18 |
| Production frontend build | PASS; existing bundle-size/eval warnings remain |
| TypeScript compared with unchanged HEAD source | 116 diagnostics in each; no added or removed diagnostics (bounded sequential rerun completed) |
| Python compile and `git diff --check` | PASS |

The backend cases cover persisted styling/order, immutable destination IDs, stale/foreign/hidden destinations, RBAC, tenant-filtered tasks and counts, search/pagination, completion guards, reward idempotency, unchanged task/history data, unknown legacy enum records, direct SQL guards, migration audits/idempotence/rollback and concurrent visibility/task moves. Existing status tests additionally cover duplicate values, configuration conflicts, reassignment/removal, canonical reporting/overdue categories and automation payloads.

Reproduction (PowerShell, repository root; dependencies already installed):

```powershell
$env:TEMP="$PWD\.tmp\status-review-temp"
$env:TMP=$env:TEMP
$env:VEE_BOOTSTRAP_SCHEMA='false'
# Set ZEAPLAY_RT_POSTGRES_TEST_URL to a disposable PostgreSQL database URL.
# Its database name must contain rt3_test; tests create/drop isolated schemas.
backend/venv/Scripts/python.exe -m pytest backend/tests/test_task_status_management.py backend/tests/test_kanban_customization.py backend/tests/test_task_lifecycle.py -q --disable-warnings
Set-Location frontend
node --test --test-concurrency=1 --import tsx test/kanban-customization.test.tsx test/task-journey.test.ts test/settings-navigation.test.ts test/task-navigation.test.ts
node --max-old-space-size=1536 node_modules/vite/bin/vite.js build
```

For browser checks, start Vite on `127.0.0.1:6337` with `VITE_API_BASE_URL=/api`, then run the two `.playwright.js` functions through the Playwright runner. API routes are intercepted with synthetic fixtures; backend authorization is verified separately with real JWT/API/database tests. Screenshots do not certify deployed asset availability.

Remaining limits: the unrelated baseline TypeScript errors prevent a clean project-wide type-check claim. Unknown/corrupt legacy identities are surfaced for reviewed mapping, not automatically rewritten. Persistent migration/deployment and full-project release certification remain outside this local verification. Parallel repeat checks hit the machine's Windows paging limit; lower heap limits also proved insufficient for the full type check/build. Successful checks use bounded sequential execution (1024 MB for TypeScript, 1536 MB for the build).

## Follow-up review and refinements — 2026-11-05

Fixed defects found in the Phase 2 review:

- A filter selecting a subsequently deleted status could leave an apparently empty board. It now resets with an explicit notice and pagination guidance; reassigned tasks remain available.
- Status filters previously left unrelated column counts beside empty cards. The view now narrows to the selected status. Unmapped records remain visible and fully paginated, even when a status filter is selected.
- Separate count/column queries could disagree during concurrent writes. Board reads now use one PostgreSQL repeatable-read or SQLite explicit read snapshot, including configuration revision. A deterministic test commits a move and configuration edit between count and card reads and verifies no duplicate/missing card.
- Kanban cards omitted edit capabilities and could advertise unauthorized dragging. Board responses now include backend-derived `can_edit`; read-only cards expose View only. Server task authorization remains authoritative. Cache format version 3 includes current role and department to prevent reuse after a permission change.
- Empty statuses unnecessarily fetched tasks individually. Fifty additional empty columns now add zero task queries. Client grouping uses a single pass over loaded cards.
- Optimistic task mutation could disagree with counts or overwrite concurrent refetches. Moves now keep the source card visible with a pending indicator until the server snapshot refreshes, then announce the destination and retained filter/pagination scope. Successful moves invalidate all task views.
- Added an accessible keyboard/touch move selector using the same immutable-ID endpoint as dragging. Native pointer dragging is verified in addition to synthetic drag events. View/Edit/Move clicks no longer bubble into duplicate card actions.
- Filter menus could appear beneath transformed board columns. Their control panel now has the correct stacking order. Filter listboxes support focus, arrows, Home/End, Enter and Escape.
- Unbroken 80-character labels now wrap without covering counts; preview width controls wrap at 320px. Existing Battle Board palette, column/card surfaces and animations remain.
- Clean status editors refresh from scoped configuration notices/focus/polling. Dirty editors warn about concurrent revisions while retaining their draft; explicit reset loads the new version. Duplicate-label errors also retain the draft.

Additional verification: the expanded Kanban integration suite passed 24 cases on SQLite/PostgreSQL; frontend unit regression passed 37; actual-component browser checks passed 29 board cases and 33 Settings cases, including empty/long/duplicate labels, inactive statuses, native dragging, hidden-task recovery, concurrent edits, tenant notices, pagination, 320px previews and keyboard controls. Production build passed; TypeScript retained exactly the same 116 baseline diagnostics. The subsequent combined regression was interrupted when the disposable PostgreSQL endpoint stopped responding, and is not counted as a completed pass. No new database migration is required for these refinements. Phase 3 business-rule work follows these refinements and has a separate migration/report.

The subsequent Phase 3 verification recovered PostgreSQL coverage with a separate
disposable loopback server. The completed combined regression passed 158 tests
with one engine-specific skip, including all expanded Phase 2 cases. See
[Phase 3 verification](status-management-phase3.md) for final test totals, the new
business-rule migration, real API browser checks and rollback/policy limitations.
