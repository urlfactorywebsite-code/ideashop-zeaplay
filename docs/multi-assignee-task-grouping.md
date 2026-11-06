# Multi-assignee grouping: Grid and List

Implemented in the existing React/Vite frontend and FastAPI/SQLAlchemy backend. The production database is PostgreSQL; automated API tests also exercise SQLite.

## Behavior and identity

Multi-assignee creation already creates independent `tasks` rows sharing the indexed `task_group_id`. Grid/List now request one logical row/card for those assignments. Kanban continues using its existing per-assignment endpoint, IDs, permissions and protected transition service; its production component and API implementation were not changed.

Each logical card shows title, project, priority, up to six member avatars plus `+N`, authorized assigned-member count, completion progress and an aggregate XP estimate. Expand **View assignments** to open any visible assignment in the existing task detail modal. Progress is the proportion of visible assignments in DONE/DEPLOYED; XP remains a display estimate using the existing points configuration, not an additional reward. Mixed member statuses are explicitly identified. Individual assignment histories, comments, timers, subtasks and rewards remain attached to their original task IDs.

Group identity includes the existing group ID and project. Standalone legacy groups additionally include their creator. Missing/empty legacy group IDs fall back to the individual task ID in a distinct identity namespace, so an explicit group ID cannot alias a legacy standalone task. No records are grouped by title, merged, deleted, or automatically inferred from historical similarities. Existing ambiguous or duplicate historical assignments remain intact.

## API and permissions

`GET /api/tasks/page?grouped=true` opts into grouped retrieval. Default `/tasks/page`, `/tasks`, Kanban, calendar, reporting and automation consumers retain assignment semantics.

The existing page envelope is retained. A representative item adds:

- `group_assignments`: authorized assignment items with their original IDs/status IDs and existing task fields.
- Each member item adds `assigned_member: {id, name, avatar_url}`. It does not expose a full user profile, email, reward claims or balances.

Tenant and existing project/task visibility are applied before grouping and again before expanding members. Filters/search match any authorized assignment, then the result expands all authorized members of that logical task. This keeps a matching task's member details available without revealing hidden assignments. Counts/progress describe the visible subset only.

Sorting chooses the first matching assignment by the requested sort and task-ID tie breaker. Each group is paginated once, before member loading. `total`, `total_pages` and status counts use logical rows. A mixed group's single status bucket is the representative matching assignment's internal status; it does not overwrite any member status or create a stored overall status. The UI additionally displays mixed-status and completion information. Existing reporting assignment totals remain unchanged.

Offset pagination and supported datetime cursors are retained, including null deadlines. Grouped client entries are separated from assignment responses and scoped to tenant, user, role and department. Prefetch requests forward the same grouped flag as foreground requests. Grouped backend responses bypass shared payload caching and re-evaluate current permissions and counts on every HTTP request; role downgrades or project membership revocations cannot reuse a privileged payload. Visibility changes during member loading return an explicit 409 requiring refresh, rather than returning an unauthorized stale representative. Existing task-change invalidation is retained. Member/project/avatar loading is batched: the same bounded SELECT count (at most twelve) retrieves five or forty eight-member groups from the scale fixture.

Adding to an existing group requires update permission for its records and the same project. Creation deduplicates member IDs, validates group identifiers, and rejects foreign/private groups. Assignment edits, transfers and transfer approvals serialize using the same tenant workflow lock as creation and reject existing group/member duplicates with 409. Transfer destinations retain project membership validation. Transfer approval and notifications respect tenant boundaries. Template assignment deduplicates member IDs and validates template/member ownership. Project changes that would merge distinct groups with an existing destination group identifier return 409 without changing either group.

Group selection retains individual assignment IDs. The existing bulk-delete operation still issues individual authorized deletes; its displayed count is an assignment count. It is not an atomic group deletion. Individual deletion leaves the remaining assignments in the logical task. Successful bulk deletions are reconciled even if another assignment is forbidden; failed IDs stay selected and show the server error. Removing a representative promotes a surviving member, and deleting the final assignment removes the logical card. Empty groups never fall back to deleted records.

## Exact files affected by this feature

- `backend/app/routers/tasks.py`
- `backend/app/schemas.py` (task schemas only; pre-existing notification edits preserved)
- `backend/app/services/task_groups.py` (new)
- `backend/app/services/task_notifications.py` (status retry/custom-label notification fix)
- `backend/tests/test_task_groups.py` (new)
- `backend/tests/test_task_status_notifications.py` (configured-label and retry regressions)
- `frontend/types.ts`
- `frontend/services/mockApi.ts` (task mapping/page opt-in; notification edits preserved)
- `frontend/hooks/useTaskCache.ts`
- `frontend/hooks/useTaskList.ts`
- `frontend/hooks/useTaskPrefetch.ts`
- `frontend/pages/Tasks.tsx`
- `frontend/components/TaskGroupMembers.tsx` (new)
- `frontend/utils/taskGroups.ts` (new)
- `frontend/test/task-groups.test.tsx` (new)
- `frontend/e2e/taskNavigationFixture.tsx` (synthetic opt-in fixture mode)
- `frontend/e2e/task-groups.playwright.js` (new)
- `frontend/e2e/task-groups.mjs` (new, executable test runner)
- `docs/multi-assignee-task-grouping.md` (this document)

Existing uncommitted notification feature files were preserved and are not part of this feature's file list.

## Migration and rollback

**No database migration, backfill or SQL update is required or applied.** The existing `tasks.task_group_id` column and its index are reused. No uniqueness constraint is added over historical rows: existing duplicates are retained, while supported assignment mutations validate new duplicates under the workflow lock. No scoring or history schema is changed.

Deploy the backend before the frontend using the deployment's existing Compose configuration and environment. Rebuild/restart only those services; do not invoke an unrelated database repair/update helper for this feature. Confirm API readiness, then verify one eight-member task appears once in Grid/List and eight times in Kanban. Check member-specific details, search/filter totals, a single Kanban move and a second tenant/account.

Rollback the frontend first, then restore the previous backend image/revision using the existing release procedure. No database rollback is necessary. All task IDs and their relationships remain usable by the old application. Do not delete data, reset volumes, or infer historical groups during rollback.

## Phase 1 review (2026-11-06)

Functional review and regression coverage pass: 122 distinct backend cases, 54 frontend units and 114 browser checks passed; two SQLite-only row-lock concurrency cases were skipped and their PostgreSQL variants passed. Repository-wide lint/type gates retain existing diagnostics, so a completely clean release gate is not claimed. No UI restyling was performed.

Fixes from this review:

1. Distinguish legacy standalone fallback IDs from explicit group IDs, preventing accidental identity collisions.
2. Forward grouped retrieval during next-page prefetch; scope client caches by tenant/account/role/department.
3. Re-evaluate grouped API permissions instead of replaying backend payloads after membership/role changes; reject visibility changes during loading.
4. Reject project moves that would merge distinct existing groups.
5. Preserve surviving member IDs after representative deletion; reconcile partial deletion failures and prevent empty groups from resurrecting deleted tasks.
6. Stop duplicate member notifications on repeated unchanged Kanban status moves. Custom-to-custom transitions using the same native behavior now name the correct old/new labels.
7. Replace substring/LIKE tag filtering with exact JSON array membership: PostgreSQL uses JSONB containment; SQLite uses json_each. Combined date/priority/team/quick filters and tag literals containing percent/underscore characters work in grouped, legacy assignment and Kanban APIs.
8. Correct partial status-count typing on the Tasks page, removing its two TypeScript diagnostics. Update notification regression expectations to configured labels while still asserting unchanged native status identity.

| Check | Result |
| --- | --- |
| Full grouping API suite on SQLite/PostgreSQL, including identity, all seven sorts in both directions, null/non-null cursors, cache authorization, filters, concurrency, historical snapshots, XP and scaled member loading | PASS: 40 passed, 2 SQLite-only concurrency skips; PostgreSQL variants passed |
| Notification/badge cases in the combined backend run | PASS: 20 passed |
| Existing status management, legacy migration, reporting, subtask handoff and timer regressions | PASS: 58 passed |
| Existing assignment task-list suite in an isolated working directory | PASS: 4 passed |
| Frontend grouping, Kanban, navigation, scoring, dates, journey, report and subtask contracts | PASS: 54 passed |
| Grouping/prefetch/partial-delete/individual Kanban drag browser checks | PASS: 23 passed |
| Existing status-label/status-management/Kanban browser suites | PASS: 91 passed |
| Production Vite build | PASS; existing large-chunk warning remains |
| New Python helpers/tests and lint on added feature lines | PASS: zero findings |
| Ruff across reviewed Python files | FAIL inherited: 1,106 findings versus 1,120 on HEAD; zero new diagnostic signatures |
| TypeScript | FAIL inherited: 114 diagnostics versus 116 before review; zero new diagnostics |
| Git whitespace check | PASS |

Backend commands use `backend/venv/Scripts/python -m pytest`, `VEE_BOOTSTRAP_SCHEMA=false`, the repository on `PYTHONPATH`, and an explicitly isolated `ZEAPLAY_RT_POSTGRES_TEST_URL` with the `postgresql+psycopg` driver and a disposable database whose name contains `rt3_test`.

The complete grouping suite is `backend/tests/test_task_groups.py`. The combined run also includes `test_task_status_notifications.py` and `test_task_creation_badges.py`. Compatibility checks use `test_task_status_management.py` and the reporting reconciliation/query-bound, multi-member handoff, and timer pause/resume/concurrent start-stop cases in `test_reporting_inventory.py`, `test_subtask_handoff_regression.py` and `test_task_lifecycle.py`. The legacy `test_task_list.py` suite runs from a fresh scratch directory with an empty `assets/` folder, because it creates/drops a relative `test_tasks.db`.

Frontend units run from `frontend/` with `node --test --import tsx` and: `test/task-groups.test.tsx`, `test/kanban-customization.test.tsx`, `test/task-navigation.test.ts`, `test/core-status-business-rules.test.ts`, `test/task-report.test.ts`, `test/task-journey.test.ts`, `test/task-dates.test.ts`, `test/subtask-workflow-contract.test.ts`. There is no configured frontend lint script; TypeScript and the existing build/unit/browser tooling were used.

For browser acceptance, start Vite on loopback port 6337, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.js`, optionally set `ZEAPLAY_CHROMIUM_EXECUTABLE`, and run `node frontend/e2e/task-groups.mjs`. Results/failure images go under the system temporary directory's `zeaplay-task-groups` folder.

Review evidence is retained locally in `.tmp/task-group-review-*`: backend results, compatibility results, lint/type comparisons and build output. Repeated focused runs after fixes validate exact tags, sort direction/representative choice and authorization-cache behavior, without counting retries as additional distinct cases.

No live application database was modified or migrated. Tests use disposable SQLite files and a scratch PostgreSQL database. No deployment or Git publication was performed.

Remaining risks/limits: inherited lint/type findings block an entirely green repository release gate; validation is isolated/synthetic rather than a production load certification. Multi-request pagination reflects live changes rather than a frozen snapshot. Existing client cache/refresh lifecycle applies to already fetched data; every grouped backend request enforces current visibility. Bulk deletion retains its existing per-assignment, non-atomic contract. Writes bypassing supported APIs must preserve assignment uniqueness. Ambiguous historical relationships are retained for a separate reviewed decision, and cross-project group merges are deliberately rejected.


## Group Quest presentation (2026-11-06)

Grid and List now reuse ZeaPlay's Battle Board stage backgrounds, theme tokens, Lucide icons, canonical Avatar component/profile frames, status/priority badges and existing points calculations. Grid presents one Group Quest card; List keeps a compact two-column desktop row and stacks on smaller screens. Both expose the original assignment IDs, member counts, completed assignment counts, a named native progress bar, XP estimates and every member's details. Mixed status identities are labeled "Mixed statuses" instead of displaying a representative member's status as the party status. Mixed Conquered/Deployed assignments that are all complete show "Party complete".

Avatar stacks show up to six members, or four on compact viewports/narrow cards, with the matching +N overflow. Focusable member-name tooltips support Escape, wrap long names and stay within the viewport. Progress/status/rewards have text labels; new effects respect reduced motion. Canonical avatar frames remain intact, including readable initials in the colorful theme. Styling is scoped to the grouped task experience and responds to the existing dark, light and colorful themes.

Quest details replace the old Crew chips with an Assigned Members / Quest Party section. Every permission-filtered assignment has its avatar/name, configured status label, independent XP estimate and View/Manage assignment action. Selecting a member opens that original assignment in the existing detail editor; the current assignment action focuses its status control. It reuses existing authorization, hold reasons, completion checks, timer/actions and server mutations. Confirmed updates immediately replace the affected party entry and refresh the group and task list. Rejected updates retain the confirmed status. Switching members warns about unsaved status/core/comment drafts. Headless UI, already used by ZeaPlay's journey dialogs, provides dialog semantics/focus handling; the existing shared-task log remains a separate nested dialog.

Party loading, empty and retryable error states are explicit. Fresh group requests bypass the legacy client cache; response sequence and mounted/account/assignment guards prevent stale responses from replacing newer party data. The new optional client-only `getTaskGroup(id, { fresh, signal })` options preserve existing consumers and the HTTP route/response. Another tenant/account's realtime event is ignored by the Tasks page and the party reader. Background list refreshes do not clear unsaved detail drafts. Group data is retrieved in one request rather than one request per member; existing directory/avatar resource reuse is retained.

Kanban columns, per-assignee cards, task movement, filters and drag/drop source code were not changed by this presentation phase. Its existing immutable status-ID mutation path remains in use. No package/dependency, scoring formula, database schema or task/history relationship was changed.

### Files changed by the presentation phase

- `frontend/components/TaskGroupMembers.tsx`
- `frontend/components/QuestParty.tsx` (new)
- `frontend/components/TaskDetailModal.tsx`
- `frontend/components/ui/Tooltip.tsx` (opt-in viewport constraint; existing placement remains the default)
- `frontend/pages/Tasks.tsx`
- `frontend/index.css`
- `frontend/services/mockApi.ts` (backward-compatible fresh group option)
- `frontend/test/task-groups.test.tsx`
- `frontend/e2e/taskNavigationFixture.tsx` (opt-in synthetic party scenarios)
- `frontend/e2e/task-groups.playwright.js`
- `docs/multi-assignee-task-grouping.md`

Other uncommitted Phase 1 grouping and notification files were preserved.

### Verification

| Check | Result |
| --- | --- |
| Grouping, Kanban, navigation, protected scoring, dates, journey/report and subtask frontend units | PASS: 58 tests |
| Actual Grid/List/detail components with synthetic data, real page/group API mapping and Chromium interactions | PASS: 55 browser checks |
| Existing status labels, status management and Kanban browser suites | PASS: 91 checks (17 + 45 + 29) |
| Responsive desktop/tablet/mobile layouts, dark/light/colorful styling, avatar contrast, keyboard tooltip/focus, long labels and reduced motion | PASS in the grouped browser suite; screenshots visually reviewed |
| Independent member mutation, rejected mutation, permission visibility, stale cache, out-of-order responses, foreign-session notices, unsaved drafts, nested log, pagination/selection and original Kanban assignment-ID drag | PASS in the grouped browser suite |
| Production Vite build | PASS; existing large-chunk warning remains |
| TypeScript `tsc --noEmit --pretty false` | FAIL inherited: 114 diagnostics, zero new diagnostic signatures versus the Phase 1 review baseline |
| Frontend lint | NOT CONFIGURED: no lint script/toolchain is defined in package.json |
| Git whitespace check | PASS |
| Backend suites | NOT RERUN for this frontend-only phase; previous Phase 1 results remain recorded above |
| Live deployment/production-load validation | NOT RUN |

Unit and browser commands are the same as the preceding review section. The browser suite now additionally covers the party/detail/appearance scenarios. Build command: `node node_modules/vite/bin/vite.js build` from `frontend/`. Local logs are `.tmp/group-quest-units.txt`, `group-quest-browser.txt`, `group-quest-status-regressions.txt`, `group-quest-tsc.txt`, `group-quest-tsc-comparison.json` and `group-quest-build.txt`; browser results also go to the runner's temporary results folder. Synthetic appearance screenshots are `.tmp/group-quest-{grid,list,mobile,light,colorful,party-member}.png`.

### Deployment and rollback

No database migration, Python schema helper, SQL update or backfill is needed or applied. The Phase 1 grouped-task backend must already be deployed. Rebuild/deploy only the frontend using the existing deployment configuration. Smoke-test an eight-member quest once in Grid, once in List and as eight independently movable Kanban assignments, then open a party member and confirm an authorized status update and a read-only account. Roll back this phase by restoring the prior frontend image/revision; task IDs, records and histories need no rollback.

These checks are local and synthetic, not a production certification. Existing repository-wide TypeScript errors and bundle-size warnings remain. XP shown by the UI is explicitly an estimate from the existing configuration; authoritative awards remain server-owned. Shared task log/history and Kanban data continue to use the existing backend authorization and business-rule paths.
