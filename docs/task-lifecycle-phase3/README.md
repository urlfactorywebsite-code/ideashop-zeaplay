# Phase 3: Task Completion Evidence and Final Execution Report

Verified locally on 2026-10-19 in `F:\Projects\ideashop-zeaplay-v5`.

**PHASE 3 COMPLETE for local implementation and relevant automated validation. GO for isolated staging validation; NO-GO for unconditional production release.** No production deployment, application-container restart, production data migration, balance reset or historical backfill was performed. Pre-existing unrelated working-tree changes were preserved.

## Delivered

The existing Task Status Journey dialog now has keyboard-accessible Journey / Execution report tabs. The existing status editor and all eleven task statuses remain unchanged. The report is lazy-loaded and contains:

- Main-task and subtask creators, assignees, creation times, first observed work, first retained session, latest historical completion and final completion when currently complete.
- Recorded status transitions, previous completions and reopen history; existing timer-session details, corrections, actors and exact UTC timestamps are reused.
- Separate direct work, child work, combined person-time, elapsed work, lifetime, overlap exclusions, session counts, captured start/resume/restart/stop/pause counts and provable pause intervals.
- Submission attempts, review decisions and reasons, including rejected and previous approved attempts.
- Authorized evidence metadata, private image/PDF previews and downloads; explicit missing/deleted/unverified/provider-check states.
- Paginated completion attempts and evidence, existing event/session pagination, and only 25 initially rendered subtask detail rows. Closed subtask histories remain unmounted.

## Read API Contracts

All routes use the existing `/api` prefix, bearer authentication, active-user checks and task authorization. The new routes are GET-only. Routes set `Cache-Control: private, no-store`; the existing application security middleware normalizes this to `no-store`.

| Route | Contract |
| --- | --- |
| `/api/tasks/{task_id}/execution-report` | `ExecutionReport`: server `as_of`, coverage, main/subtask `ExecutionEntity` values, direct/children/aggregate `TimeMetrics`, deleted-session count. |
| `/api/tasks/{task_id}/execution-report/completions` | `CompletionPage`: `items`, `next_after_id`; `limit=24`, maximum 100. Chronological `(created_at,id)` keyset paging, using the last item ID as the cursor. A missing/foreign cursor returns 409. |
| `/api/tasks/{task_id}/execution-report/evidence` | `EvidencePage`: `source=completion` or `linked`, `after_id`, `limit=24`, maximum 100. Completion-file IDs are stable cursors; linked references use a bounded positional cursor. |
| `/api/tasks/{task_id}/execution-report/evidence/{source}/{evidence_id}` | Authenticated bytes; source is `completion`, `media` or `media_file`. `preview=true` only allows content-checked PNG/JPEG/GIF/WebP/PDF. Default is an octet-stream attachment download. |

Python contracts are in `backend/app/lifecycle/report_contracts.py`; matching TypeScript contracts are in `frontend/types/taskReport.ts`. Existing journey, analytics, execution-session and completion APIs remain available. The old completion-download endpoint additionally rejects inconsistent submission/attachment tenants and returns private-cache headers.

Foreign tasks return 404; same-tenant task access follows the existing role/project/follower/assignee policy. Inaccessible evidence returns 404 without metadata or storage keys. Unsupported or forged previews return 415, oversized reads 413, malformed query inputs 422, missing lifecycle migration 503, unavailable providers a generic 503. Authentication errors retain existing auth contracts.

## Accuracy and Compatibility

- Reuse `TaskLifecycleEvent`, coverage, `TimeEntry`, `CompletionSubmission`, `CompletionAttachment`, `MediaItem` and `MediaFile`. No competing timer, evidence store, event bus or notification mechanism was introduced.
- Summary reads use the Phase 1 PostgreSQL repeatable-read, read-only snapshot. SQLite uses the established explicit snapshot. A concurrent-completion test proves the report cannot combine the old task state with the new completion count within one response.
- Combined person-time unions effective retained intervals per user across main-task and subtask work. Parallel users contribute independently; elapsed work unions intervals across all users. Direct plus child totals are not necessarily additive when legacy overlaps exist. No browser-supplied durations are accepted.
- Paused duration requires an explicit same-user, same-target resumed/restarted continuation after a `paused` stop. Unknown endings, future continuations and invalid links are unresolved, not guessed as idle time. Rounding occurs after union/summing, not per person/session.
- Final completion follows the latest captured DONE in ledger order, not the maximum wall-clock timestamp. Reopened tasks have no current final-completion timestamp. Main tasks may fall back to their existing `completed_at`, explicitly identified as a stored task timestamp. A task inserted already DONE is not assigned an invented transition/completion count. Lifetime for a completed task with no recorded final completion is unknown, not creation-to-now.
- Subtasks have no legacy creator/creation columns. Only captured `subtask.created` events provide those facts; missing actors and pre-capture dates remain unknown. Deleted subtasks retain ledger observations but no fabricated title/assignee. Deleted sessions are excluded from retained totals and disclosed.
- Status/event order follows the existing ledger IDs; exact recorded timestamps remain visible even if clocks moved backward. Submission attempts page chronologically and sort with microsecond precision in the UI. Partial pages are explicitly labeled.
- Summary metrics are server snapshots labeled with `as_of`; running session displays reuse the Phase 2 synchronized monotonic clock and its 60-second stale-estimate cap. A conflicting report/journey status snapshot fails visibly until refreshed.
- No task mutation, approval transition, XP write, reward write or notification is performed by the report. Existing realtime notices invalidate the existing journey fetcher; the report adds no socket or polling interval. Previously loaded page windows are re-read on refresh, and stale requests are aborted/version-checked on scope changes.

## Evidence Boundaries

Completion evidence uses the existing private completion directory and opaque keys. Both submission and attachment tenant IDs are checked in SQL. The existing stricter completion-file access policy is reused, rather than granting files to every task follower/department manager. Changing project membership revokes file access even when task read access remains through following.

Legacy task attachments are plain JSON links, not trustworthy upload records. The report only resolves exact registered MediaItem IDs/URLs, canonical `media:{id}` or `/api/media/{id}` references, and registered MinIO MediaFile IDs or bucket/object keys on explicitly configured storage origins. MinIO query signatures are never returned. Cross-tenant, arbitrary, malformed or unmatched links become metadata-free unverified placeholders; the server never fetches them. Removing a task association or deleting media disables subsequent file actions.

Media Library rules are preserved: MediaItem ownership/admin-like access, and MediaFile owner/admin/department-manager access, plus task access. Supabase and Drive reads use existing configuration/credentials; MinIO uses the existing SDK. Object reads are capped at 50 MiB, with bounded streaming/chunk reads. Provider error text, credentials, storage keys and signed URLs do not enter API error responses. Provider availability is not guessed during listing.

Preview requests recheck authorization, MIME and content signatures. Only validated image/PDF Blobs reach the UI; HTML, SVG and Office documents are download-only. Object URLs are revoked on close, refresh, scope changes and unmount; pending file requests and download timers are cleaned up. Revocation cannot retract bytes already downloaded. The PDF preview uses the browser's native viewer, not a third-party viewer/upload service. Chromium's PDF implementation runs in sandboxed child processes; an HTML iframe sandbox instead blocks the viewer, as verified visually during development. See [Chromium PDF implementation notes](https://chromium.googlesource.com/chromium/src/+/424dad332fb68af3adbabe1b4b87df461bb37dd9/pdf/). PDF screenshots verify actual rendered document content, not merely an open iframe. Browser PDF support/CSP still needs deployment smoke testing.

If a completion blob is deleted but its row remains, its metadata is shown as missing. Deleted Media Library rows are shown as deleted. If both row and blob were already hard-deleted, neither uploader nor filename can be reconstructed; the report does not invent them. No malware scanner was added; downloaded documents remain untrusted files.

## Validation Scorecard

| Check | Result / Evidence |
| --- | --- |
| New report/evidence tests | **PASS: 34 passed, 1 skipped**, SQLite and isolated PostgreSQL 15. `checks/backend-report.xml` and `.txt`. The skip is the PostgreSQL-specific snapshot case under SQLite; its PostgreSQL instance passed. |
| Phase 1 lifecycle/independent-review regressions | **PASS: 86 passed, 4 skipped**, including migration preservation/guarded downgrade, actor capture, UTC/timezone, timer races and read snapshots. Skips are PostgreSQL-only checks under SQLite; PostgreSQL variants passed. `checks/backend-lifecycle-regression.xml` and `.txt`. |
| Task Manager / XP / security regressions | **PASS: 87 passed**, task phases 5-11, gamification phase 12 and security phase 13. Disposable file-backed SQLite fixture, not the application DB. `checks/backend-regression.xml` and `.txt`. |
| Frontend node tests | **PASS: 68 passed**, `checks/frontend-tests.txt`. Includes ordering, microseconds, filename safety, unknown completion boundaries and pause provenance. |
| Chrome component/interaction tests | **PASS: 36 passed**, `checks/browser-results.json`. Synthetic intercepted APIs, real React components; no production calls. Includes existing status editing, tenant switching, stale responses, access revocation, retries, previews/downloads, cleanup, 250 children, dark/light, keyboard, reduced motion, and 320/375/768/1440 px layouts. |
| Vite production build | **PASS**, `checks/frontend-build.txt`. Report chunk 16.64 kB / 4.99 kB gzip at validation. Existing Lottie `eval` and >500 kB application-chunk warnings remain. |
| Global TypeScript validation | **FAIL, pre-existing baseline:** 131 errors, exactly the same normalized diagnostics as `../task-lifecycle-phase2/checks/review-typescript.txt`; zero new diagnostics. `checks/typescript.txt`. These are not suppressed or repaired outside scope. |
| Lint | **NOT CONFIGURED** in frontend package scripts; no linter was installed or invented. |
| Query growth | **PASS:** 1 to 76 children: SQLite 18 -> 18 statements; PostgreSQL 19 -> 19 statements, including auth/snapshot/relationship reads. `checks/query-counts.txt`. No N+1 growth observed; no latency/load benchmark is claimed. |
| Live cloud providers / deployed Docker end-to-end | **NOT VERIFIED:** provider reads use mocks for Supabase/Drive/MinIO. No production credentials were requested; existing application images were not rebuilt or restarted. |

Relevant backend total: **207 passed, 5 platform-specific skips** across the three non-overlapping suites above. These are relevant regression suites, not a claim that every repository test was executed. Existing SQLAlchemy/Pydantic/naive-UTC/FastAPI deprecation warnings are preserved in the artifacts.

Issues caught and corrected during implementation included test waits for lazily opened details and short-lived refresh indicators, a test-only ORM weak-reference lifetime, blocked native-PDF resources in the test harness, PDF iframe sandbox incompatibility, incorrect maximum-clock ordering for final completion, sub-millisecond attempt ordering, unknown legacy completion boundaries, and potential stale cross-snapshot report states. Final artifacts show rerun results, not the earlier failures.

## Database and Deployment

**No Phase 3 schema migration is necessary.** No columns, constraints, indexes, enums, balances or historical business rows were changed by this phase. The existing Phase 1 revision `fd5e6f7a8b9c_task_lifecycle_history.py` and earlier Task Manager tables remain prerequisites. The existing migration tests ran on synthetic isolated data, not a production backup. No new production-backup restoration or balance reconciliation claim is made here.

Before approving production:

1. Verify the deployed revision chain and Phase 1 capture/continuation schema on a restored, isolated backup. Retain existing backup, private completion files and cloud-object manifests; do not reset users/tasks/rewards.
2. Reconcile the 131 existing TypeScript failures through the established release gate or an explicitly approved exception. Review build/deprecation warnings separately.
3. Validate local private-volume mounts and permissions across application workers. Only `media_root/uploads` is mounted publicly by the current backend; never expose `media_root/private` through the VPS proxy, object gateway or a broader static mount.
4. Smoke-test each configured provider with isolated authorized/unauthorized users, deleted objects and membership revocation. Existing Drive storage adapter is service-account based; OAuth-only setup is not implemented by that adapter and may return storage-unavailable. This phase does not redesign provider login.
5. Review existing public Media Library URLs/buckets/Drive shares. This report does not publish new URLs, but cannot revoke previously public legacy objects. Private reporting must not be mistaken for a historical storage-privacy migration.
6. Confirm native PDF/image Blob rendering under actual browser/CSP policies; documents always retain an authenticated download alternative. Use supported, updated browsers and existing upload-security controls.
7. Profile representative large histories and tenant media catalogs. Synchronous reports reject more than 50,000 retained sessions with 422 rather than returning truncated totals. Legacy exact-URL matching and completion-history sorts may need additional indexes after production-like EXPLAIN analysis; no throughput/latency guarantees were measured here.
8. Deploy backend read APIs before the new frontend through the existing approved release process. Verify task editor, journey, report, live timer refresh and file authorization. A frontend-only rollout against an older backend returns a visible unavailable-report state, not fake data. No deployment was executed here.

Rollback is application-only: restore the previous approved frontend build first; retain or restore the previous approved backend image. The additive GET routes may safely remain. Preserve private files, existing lifecycle capture and all completion history; do not downgrade/drop the Phase 1 history schema once populated. This Phase 3 change requires no data rollback and has no destructive down migration.

## Changed-File Inventory

Backend:

- `backend/app/lifecycle/report.py` (new): batch aggregates, retained time accounting, observed creation/completion provenance.
- `backend/app/lifecycle/report_contracts.py` (new): typed nullable report DTOs.
- `backend/app/lifecycle/report_evidence.py` (new): permission-aware metadata and private storage reads.
- `backend/app/routers/task_lifecycle.py`: four additive GET routes and private-cache headers.
- `backend/app/routers/tasks.py`: narrowly harden the existing completion-download tenant checks/cache headers/file check.
- `backend/tests/test_task_execution_report.py` (new): security, compatibility, paging, query growth, providers and concurrency tests.

Frontend:

- `frontend/components/TaskExecutionReport.tsx` (new): report, evidence gallery and authenticated previews/downloads.
- `frontend/hooks/useTaskReport.ts` (new): cancellable paginated report loading and snapshot validation.
- `frontend/types/taskReport.ts` (new): API contracts.
- `frontend/utils/taskReport.ts` (new): stable attempt ordering, pause-link validation and safe display helpers.
- `frontend/test/task-report.test.ts` (new): focused regression tests.
- `frontend/components/TaskJourneyModal.tsx`: tabs and reuse of existing transition/session rendering; explicit linked pauses.
- `frontend/components/TaskJourneyModal.css`: scoped report layout, gallery and preview styles using existing theme tokens.
- `frontend/services/mockApi.ts`: four authenticated read methods, no new mutations.
- `frontend/e2e/task-journey.mjs`: extend existing safe browser harness with report cases and configurable artifact directory.

Documentation: this report plus generated `checks/` JUnit/text/JSON/screenshot artifacts. No dependency manifests, deployment configuration, ORM models, migration revisions, XP services or task-transition services were changed in this phase.

## Reproduction

Run from the repository root, with Python and Node dependencies already installed. Use only the disposable Compose project below, never application database URLs. Remove that test project after the commands complete.

```powershell
docker compose -p zeaplay-execution-report-phase3 -f ops/testing/compose.realtime.yml up -d postgres
$env:VEE_BOOTSTRAP_SCHEMA='false'
$env:VEE_DATABASE_URL='sqlite:///'+($env:TEMP -replace '\\','/')+'/zeaplay-report-test-global.db'
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_task_execution_report.py backend/tests/test_task_lifecycle.py backend/tests/test_task_lifecycle_review.py -q -r s
backend/venv/Scripts/python.exe -m pytest backend/tests/test_tasks_phase5.py backend/tests/test_tasks_phase6.py backend/tests/test_tasks_phase7.py backend/tests/test_tasks_phase8.py backend/tests/test_tasks_phase9.py backend/tests/test_tasks_phase10.py backend/tests/test_tasks_phase11.py backend/tests/test_gamification_phase12.py backend/tests/test_security_phase13.py -q
docker compose -p zeaplay-execution-report-phase3 -f ops/testing/compose.realtime.yml down
```

Run frontend commands from `frontend`: `npm test`, `npx tsc --noEmit --pretty false`, `npm run build`. TypeScript is expected to report the documented existing failures. The browser harness requires an existing Chrome/Playwright installation and loopback Vite server, without adding a dependency:

```powershell
# From repository root; start the frontend loopback dev server on 6302 separately if not already running.
$env:ZEAPLAY_PLAYWRIGHT_MODULE='F:\Projects\Zeaplay-V2\node_modules\@playwright\test\index.mjs'
$env:ZEAPLAY_JOURNEY_OUTPUT='../../docs/task-lifecycle-phase3/checks/'
node frontend/e2e/task-journey.mjs
```

The existing loopback frontend server at `http://127.0.0.1:6302` was used for browser validation and left running. The browser harness intercepts all business API traffic; opening the normal application still requires the matching backend release.
