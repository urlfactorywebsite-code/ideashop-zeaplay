# Global Active Work timers

Implemented in `F:\Projects\ideashop-zeaplay-v5`. This is the existing React/Vite and FastAPI application. No deployment or application-database migration was performed.

The [2026-10-20 refinement audit](../active-work-audit/README.md) records subsequent fixes, fresh verification, and current release gates. The original evidence below remains available.

## Architecture audit

| Area | Existing implementation | Integration |
| --- | --- | --- |
| Authenticated shell | `frontend/components/Layout.tsx`, `Header.tsx` | One provider and header entry on every authenticated page; desktop side panel and mobile drawer. |
| Tasks/subtasks | `backend/app/models.py`; `routers/tasks.py` | Existing entities, assignments and status transitions retained. |
| Time ledger | `TimeEntry`, `services/time_tracking.py`, `routers/time_entries.py` | Existing rows remain active intervals. Existing `continued_from_id` chains form sessions. No competing time ledger. |
| History | Immutable `TaskLifecycleEvent` observations and existing correction audit | Existing timer/status triggers remain unchanged. Finalizing an already-paused session adds an explicit `timer.stopped` observation. |
| Workflow | `services/subtask_workflow.py` | WAITING cannot start a timer. Explicit force-start submits the reason through the existing subtask update route, then requests a timer. Existing assignee/manager authorization, sequential/parallel dependencies, preassignment and notifications remain authoritative. |
| Permissions | `RoleEnum`, tenant/task visibility and project-manager membership | Global authenticated role determines capacity. Existing target access and manager correction permissions remain unchanged. |
| Locking | Existing per-user PostgreSQL transaction advisory lock; SQLite writer lock | Capacity, duplicate-target checks and resume validation occur inside this lock on all existing start/resume routes. |
| Realtime | `/api/ws/tasks`, shared Redis event transport and optional transactional outbox | One layout-owned socket replaces the task-page-owned socket. `timer.changed` is a user-scoped invalidation, with no work-session payload. |
| Client state | Existing API/auth interceptors, React state and task invalidation notices | One provider supplies header and detail controls. GET reconciliation is serialized; pending invalidations discard stale responses. Identity changes remount the private subtree. |
| Migrations | Existing Alembic chain, plus development metadata bootstrap | Additive timer migration follows the checkout's existing SMTP migration. Production must reconcile its actual revision first. |

## Behavior and policy

- USER: 3 running timers. MANAGER: 5 running timers.
- ADMIN: `VEE_ACTIVE_TIMER_ADMIN_LIMIT`, default 5. OWNER: `VEE_ACTIVE_TIMER_OWNER_LIMIT`, default 5. These settings do not grant additional task permissions.
- Existing main-task timers also use a running slot, so legacy routes cannot bypass the limit.
- Limits apply across tasks, projects, tabs and devices for the authenticated user. Paused sessions use no slots. Demotion preserves running sessions but blocks starts/resumes until below the new limit.
- Each subtask runs independently. Starting an already-running target is idempotent. Starting a paused target resumes its existing session. A stable session ID is the first interval's server-generated ID; `entry_id` identifies its current interval.
- Pause closes an interval; resume creates the next existing-style continuation interval. Stop finalizes the session. Stopping while paused records `finalized_at` without rewriting the pause boundary or adding active time.
- Existing legacy restart/resume semantics for explicitly stopped entries remain available through the existing API. The new UI only offers Resume for paused sessions.
- No timer action completes a task/subtask. Normal starts do not change workflow status. Explicit force-start changes status through the existing workflow endpoint before tracking time.
- Refresh, navigation, browser close and disconnection do not stop server-side sessions. Offline control attempts are rejected locally; no offline writes are queued.
- Durations use server timestamps and persisted interval durations. One monotonic client clock renders between authoritative updates. Durations exceed 24 hours correctly. The sum of concurrently running session durations is labeled **Total Session Time**.
- History uses the user's saved timezone, falling back to the browser timezone. UTC remains authoritative. Presets and custom ranges use timezone-aware local day boundaries, including daylight saving changes.
- A session intersecting a range appears once. Full session active/paused durations and active duration clipped to `[from_at, to_at)` are separate fields. Overlapping sessions are intentionally summed separately. Subtask totals include all of the current user's retained sessions on that subtask.
- Ordinary history has no timestamp editor. Existing authorized correction API, original timestamps, correction reason, actor and audit events are retained. Its existing prohibition on overlapping corrected entries remains in force.

## API contracts

All paths below are prefixed with `/api/time-entries`. Authentication and live account/tenant validation use the existing dependencies.

| Method/path | Contract |
| --- | --- |
| `GET /work/active` | Running and paused session projections, server time, authoritative capacity/count. Running sessions sort first. Up to 500 current sessions; an explicit overflow notice points to paginated history. |
| `POST /start` | Existing `{task_id}` or `{subtask_id}`, exactly one; optional note. Server owns timestamps. |
| `POST /{entry_id}/pause` | Close only this user's selected interval. |
| `POST /{entry_id}/resume` | Validate target/workflow and capacity, then create an idempotent continuation. |
| `POST /{entry_id}/stop` | Stop only this selected interval/session, including paused-session finalization. |
| `POST /stop` | Existing compatibility route. Omitted ID is rejected with 409 if multiple timers run, preventing an arbitrary timer from being stopped. |
| `GET /work/history` | `from_at`, `to_at` as ISO timestamps; escaped task/subtask `search`; `offset`; `limit` 1–100, default 30. |
| `GET /work/{session_id}/history` | Full retained intervals and timeline for an owned stable session ID. |
| `GET /active`, correction/restart routes | Existing contracts remain available. |

List reads return `{user_id, tenant_id, items, server_time, limit, running_count, next_offset}`. Each session includes its stable ID, current interval ID, RUNNING/PAUSED/STOPPED state, project/task/subtask identity and titles, workflow status, UTC start/final-stop/running-since timestamps, active/paused/range durations, own subtask total, intervals and timestamped timeline. Pydantic schemas are in `backend/app/work_schemas.py`.

Mutations preserve all legacy `TimeEntryRead` fields and additionally return `{session, server_time, limit, running_count}`. The nested session supplies the stable session ID and aggregate duration/state. A continuation still returns the new interval ID in legacy `id`.

Capacity failure is HTTP 409:

```json
{"detail":{"code":"ACTIVE_TIMER_LIMIT","limit":3,"running_count":3,"open_active_work":true,"message":"You have reached your active timer limit (3/3). Pause or stop one of your running subtasks to start another."}}
```

Other failures use the existing 401/403/404/409/422 conventions. Cross-tenant sessions are 404; another user's same-tenant control attempt is 403. Invalid states and stale continuation actions cannot modify newer intervals. Active/history reads use `Cache-Control: private, no-store` and one read-only repeatable snapshot on PostgreSQL.

## Realtime, ordering and resource use

Timer changes enqueue a transaction-owned event when the existing task outbox is enabled; otherwise they use the existing after-commit local/Redis transport. The existing relay is required when outbox mode is enabled. Events contain user identity and invalidation only. The task WebSocket filters recipients by tenant **and** authenticated user, and rechecks account credentials before sending. Existing task invalidations still contain no private work-session records.

Clients never apply timer state from events. They reconcile through authenticated GETs and serialize those requests. Each matching response is applied; intervening invalidations request a further read. Refresh promises perform at most two reads, with additional bursts coalesced into a tracked follow-up timeout, so continuous events cannot starve rendering or timer controls. Existing outbox aggregate versions and event IDs remain available for transport ordering/deduplication.

One task WebSocket and one display clock serve the layout. The task page consumes its existing local notices. Reconcile on socket ready/reconnect, online/focus/visibility recovery and every 30 seconds while visible. No per-second network requests or broadcasts. Cleanup removes all listeners, sockets, timeouts and intervals. Private state and in-flight generations reset on identity/tenant changes. Responses must match the current user and tenant. A 401/403 active-work read clears private timer state.

The read model uses the existing tenant/user/start, continuation and target indexes; metadata loads in batches and completed subtask totals aggregate in SQL. Recursive chain reads scale with a user's retained history. Very large histories should be measured on representative production data before release; an indexed session-root projection would be a future optimization, not another time ledger.

## Database migration and rollback

Revision: `ff8b9c0d1e2f`, parent `ff7a8b9c0d1e` (the SMTP revision already present in this working checkout).

Changes:

1. Add nullable `time_entries.finalized_at` (UTC-aware timestamp on PostgreSQL).
2. Create partial unique indexes `uq_time_entries_running_task` and `uq_time_entries_running_subtask` on tenant/user/target for `stopped_at IS NULL`.
3. Drop `uq_time_entries_one_active_per_user` only after replacement indexes are created.

Existing rows, timestamps, FK behavior, continuation uniqueness, lifecycle triggers and coverage dates remain unchanged. The existing development bootstrap invokes the same idempotent additive upgrade before querying timers. Production uses Alembic with schema bootstrap disabled.

Safe production procedure:

1. Back up the database and verify restore in isolation. Record the currently deployed source/image and migration revision. Reconcile unrelated working-tree changes before packaging a release.
2. From `backend`, run `alembic current`, `alembic heads`, and inspect `alembic history`. This checkout includes other uncommitted work. **Do not stamp an existing database or blindly apply unrelated revisions.** If the deployment has not adopted this migration chain, first reconcile its schema using the repository's existing deployment procedure.
3. With the database at reviewed parent `ff7a8b9c0d1e`, pause application writers and run `alembic upgrade ff8b9c0d1e2f`. The operation takes a PostgreSQL table lock or SQLite writer lock and is transactional; schedule a maintenance window for large tables.
4. Verify `finalized_at`, both new unique indexes and absence of the old single-user index. Deploy matching backend/frontend images together, configure the privileged limits and shared Redis transport, and retain the existing outbox relay configuration if enabled.
5. Validate USER 3/4, MANAGER 5/6, duplicate requests, WAITING/force-start, two-device updates, refresh and history in that deployed environment. Local tests are not VPS deployment proof.

Rollback: pause writers first. `alembic downgrade ff7a8b9c0d1e` refuses if multiple running timers remain for any tenant/user, or if any finalized-history timestamp exists. It restores the single-user unique index before removing the new indexes and retains the nullable column to avoid SQLite table/trigger rebuild loss. After new finalized history exists, retain schema and apply a forward application fix; do not erase history to force a downgrade. Do not deploy old single-timer code while multiple timers run.

Existing hard deletion still follows the application's established cascading time-entry deletion policy. Immutable lifecycle observations survive business deletion, as before. This history panel displays retained time-entry sessions; it does not reconstruct removed sessions or invent missing historical titles/timestamps. If the deployment requires user-visible history after hard deletion, archival policy is a release prerequisite.

## Files changed for Active Work

- Backend: `config.py`, `models.py`, `schemas.py`, `main.py`, `work_schemas.py`, `work_timer_schema.py`, `services/time_tracking.py`, `services/work_history.py`, `routers/time_entries.py`, `realtime/contracts.py`, `ws/tasks.py`, and Alembic `ff8b9c0d1e2f_global_active_work.py`.
- Frontend: `components/ActiveWork.tsx`, `ActiveWork.css`, `Header.tsx`, `Layout.tsx`, `TaskDetailModal.tsx`, `hooks/useActiveWork.tsx`, `pages/Tasks.tsx`, `types/activeWork.ts`, `utils/activeWork.ts`, `services/mockApi.ts`.
- Tests: `backend/tests/test_active_work.py`, timer expectations in `test_task_lifecycle.py` and `test_tasks_phase8.py`; `frontend/test/active-work.test.ts`, `time-tracking-contract.test.ts`; `e2e/active-work.mjs`, `activeWorkFixture.tsx`; compatibility updates to the task-journey fixture/harness; `ops/testing/active_work_runtime.py`.
- Configuration/docs: two privileged limit settings in `.env.production.example`; this report and `checks/` evidence. Unrelated pre-existing dirty work was preserved; no commit/staging/reset was performed.

## Verification and release gate

See `checks/` for the exact logs and desktop/mobile captures. Final counts are recorded in `checks/results.json` after validation. Frontend node tests and the Active Work browser integration exercise real components; its API/WebSocket responses are mocked. Database race tests use isolated SQLite/PostgreSQL; the rebuilt Linux runtime smoke uses real PostgreSQL, Redis and two authenticated WebSockets.

Known release gates: repository-wide TypeScript errors, missing frontend lint configuration, inherited hard-delete retention policy if post-deletion visible history is required, and deployment-specific validation. No production database, public deployment, proxy or physical-device test was performed.

Verified checks:

| Check | Result |
| --- | --- |
| Broad task/workflow/security/lifecycle/report regressions | **PASS: 227 passed, 5 database-specific skips** |
| Active Work SQLite/PostgreSQL matrix | **PASS: 26 passed** |
| Final role/history/API changes | **PASS: 14 passed**, 12 unrelated cases deselected |
| Existing migration/bootstrap/readiness suites with isolated PostgreSQL | **PASS: 28 passed, 2 skips** (SQLite-specific skip and older backup harness requiring its own named project) |
| Frontend Node tests | **PASS: 85 passed** |
| Active Work browser integration | **PASS: 11 scenarios**, including scope mismatch, revoked access, offline recovery and actual provider unmount cleanup |
| Existing journey/report browser regressions | **PASS: 39 scenarios** |
| Rebuilt Linux backend runtime | **PASS:** seven competing starts, three running slots, two real authenticated WebSockets, pause/resume/history |
| Production frontend build | **PASS**, existing large-chunk/minification warnings remain |
| Repository-wide TypeScript | **FAIL:** 130 existing errors; no diagnostics in the new Active Work files |
| Frontend lint | **UNAVAILABLE:** no `lint` script/configuration in this checkout |

The initial broad run exposed obsolete single-timer assertions and an over-specific relay-batch expectation; those tests were updated and the subsequent broad run passed. One intermediate Windows Python 3.14 run using a shared in-memory global SQLite connection hit a native access violation in the existing audit worker. The passing final broad run uses a separate file-based disposable global database. Runtime verification also passed in the rebuilt Linux image. These environment results are kept distinct from production certification.

Reproduce on Windows from the repository root (all services/data below are disposable):

```powershell
docker compose -p zeaplay-active-work-tests -f ops/testing/compose.realtime.yml up -d postgres redis
$env:VEE_BOOTSTRAP_SCHEMA='false'
$workScratchGlobal=Join-Path $env:TEMP ('zeaplay-work-global-'+[guid]::NewGuid().ToString('N')+'.db')
$env:VEE_DATABASE_URL='sqlite:///'+$workScratchGlobal.Replace([char]92,[char]47)
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
$env:ZEAPLAY_WORK_TEST_REDIS_URL='redis://127.0.0.1:56379/15'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_active_work.py backend/tests/test_task_lifecycle.py -q -r s
# Run frontend commands from frontend: npm test; npx tsc --noEmit; npm run build
# Start a loopback Vite server on 6302 for the browser harness.
$env:ZEAPLAY_PLAYWRIGHT_MODULE='<existing Playwright installation>/index.mjs'
node frontend/e2e/active-work.mjs
docker compose -p zeaplay-active-work-tests -f ops/testing/compose.realtime.yml down
```

The real-runtime smoke is `ops/testing/active_work_runtime.py`; mount only that script into the rebuilt backend image, attach it to this disposable Compose network, and pass the explicit isolated PostgreSQL URL plus `VEE_REDIS_URL=redis://redis:6379/15`. It asserts the database name contains `rt3_test`, owns a random schema and drops that schema in `finally`. Do not substitute an application database URL. `checks/linux-runtime.txt` records the executed smoke result.

The disposable `zeaplay-active-work-tests` containers/network and the loopback Vite test server were stopped after verification. The local backend test image remains available. Application Compose services were not started or migrated.
