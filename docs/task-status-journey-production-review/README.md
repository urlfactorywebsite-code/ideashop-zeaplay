# Task Status Journey: Production Review

Reviewed locally on 2026-10-19 in `F:\Projects\ideashop-zeaplay-v5`. Scope: lifecycle/session APIs (Phase 1), Journey UI (Phase 2), execution report/evidence (Phase 3). **NO-GO for production; GO for isolated staging validation.** No production access, migration, deployment, application-container restart or stress test was performed. Unrelated dirty work was retained. This report supersedes earlier local readiness statements, not their historical test artifacts.

## Findings Corrected

| Severity | Confirmed defect | Correction and evidence |
| --- | --- | --- |
| High | Legacy task/submission DTOs disclosed attachment filenames/metadata to task readers who could not download those files | Existing download policy now also gates nested attachment metadata; inconsistent tenant/task/subtask rows are excluded. Responses preserve their DTO shape. A versioned legacy-list cache fingerprint cannot reuse pre-hardening responses. SQLite/PostgreSQL regressions cover follower, owner, foreign metadata and old cache keys. |
| High | A local MediaItem storage key could alias the private completion store | Report MediaItem reads are confined to the canonical resolved `media_root/uploads` namespace. Private completion keys use the separate existing resolver. Traversal/symlink ancestry checks remain in place. No files were moved. |
| High, deployment | Production Compose has no persistent backend media mount; recreating it can lose private completion evidence | Added an **opt-in** bind-mount override refusing absent paths. Existing data must first be copied and verified. No empty volume was mounted over current files. Build context now excludes `.env*`, private media and common credential/key files. |
| Medium | DONE -> reopen -> DEPLOYED reused an old completion date, and reports ignored DEPLOYED as an effective completion | Share the existing backend DONE/DEPLOYED completion policy. Count entries into the completed set, not DONE -> DEPLOYED promotion. Reopen -> DEPLOYED uses the newly captured cycle; previous completions remain in history. No old dates were invented or rewritten. |
| Medium | Journey/report clients accepted individually mis-targeted records in otherwise correctly targeted envelopes | Validate event task, session tenant/exact target, report child IDs, and fresh task/current child-state agreement. Invalid or conflicting snapshots are cleared and can be retried. API authorization remains authoritative. |
| Medium | Fresh task details queried once per distinct subtask assignee | Batch UserRead's reward/department/avatar dependencies without changing XP arithmetic. PostgreSQL queries: **17 -> 29 before**, **19 -> 19 after**, comparing 1 vs 13 distinct assignees. SQLite: 16 -> 28 before, 18 -> 18 after. |
| Low | Selected-tab text had insufficient light-theme contrast | Use the primary text token; retain accent border/underline. Browser assertion checks text contrast >= 4.5:1. |

The N+1 failure is retained in `checks/query-before.txt`; final results are in `query-after.txt` and `report-security.txt`. Initial report-suite failures came from review fixtures using reserved `.test` email addresses and a nonexistent INACTIVE enum; fixtures were corrected to valid email addresses and DEACTIVATED, without weakening application validation.

## Validation Matrix

| Area | Result | Actual evidence |
| --- | --- | --- |
| Tenant, active-user and role/project authorization | PASS, local | Expired/deactivated/foreign credentials, unrelated same-tenant readers, legacy tasks and multiple project managers tested; underlying task permission policy reused. |
| Correct main-task/subtask evidence association | PASS, local | Wrong task, sibling subtask, foreign rows and private-store aliases rejected; listed evidence retains actual task/subtask/submission IDs. |
| Preview/download security and metadata | PASS, local | Per-action authorization; no arbitrary URL fetching; missing/deleted/revoked states, signature/type/size checks, safe disposition, private/no-store and generic provider failures tested. Provider calls are mocked. |
| Lifecycle completeness and reopen history | PASS, local | ORM, raw/bulk SQL, intermediate transitions, deletion, repeated completion/reopen, rollback and append-only guards. Capture start is explicit; unknown historical actors/dates/reasons stay unknown. |
| Timers, UTC and concurrency | PASS, local | Concurrent start/stop/resume/restart/correction, savepoint attribution, non-UTC PostgreSQL sessions, midnight/offset/fractional intervals, refresh/new request recovery and overlapping parent/child work. |
| Snapshot consistency and query growth | PASS, local | PostgreSQL repeatable-read/read-only snapshots; state mismatch rejection. Report queries stay 18 SQLite / 19 PostgreSQL with 1 vs 76 children. Task-detail distinct-assignee growth fixed as above. |
| Realtime fanout/recovery | PASS, targeted integration | Two independent Uvicorn processes, shared isolated PostgreSQL and Redis; chat/task/ticket fanout, tenant/dedupe rejection and targeted Redis subscriber recovery. 5 passed; 3 broader restart/device cases not selected. |
| Journey/report UI and existing status editing | PASS, mocked-API browser | 39 Chrome checks: all task/subtask enum values, active glow, repeats/reopens, stale responses, timers, refresh coalescing, permission changes, malicious payloads, status PATCH, image and native PDF rendering, object URL cleanup. |
| Responsive/accessibility | PASS, automated scope | 320/375/768/1440 screenshots, long names, 250 children, light/dark themes, keyboard dialog/tab/focus/Escape interactions, reduced-motion and contrast checks. Not a full screen-reader certification. |
| Lifecycle migration and backup restoration | PASS, synthetic only | Real CLI fc -> fd upgrade, unchanged legacy rows/balances and all old timer fields, no invented events, empty downgrade/re-upgrade and populated-history refusal. Actual pg_dump/pg_restore, 8 identical table snapshots. |
| Production-like full migration chain and actual backup restore | NOT VERIFIED | No production backup supplied. Base-to-head, actual legacy schema drift, migration lock duration and volume recovery must be rehearsed on an approved restored backup. |
| Frontend unit tests / production bundle | PASS | 69 tests; Vite build exit 0. Existing Lottie eval and >500 kB chunk warnings remain. |
| Global TypeScript | **FAIL, pre-existing** | Exit 2, 131 diagnostics; normalized path/error-message multiset exactly matches Phase 2 baseline. No new diagnostics. Includes AvatarCropModal, Ballpit, seedData and timer test fixture errors. A Vite build does not typecheck. |
| Lint | NOT CONFIGURED | No frontend lint script or repository lint configuration for this feature; no lint pass claimed. |
| Linux production image / live providers / full product E2E | NOT VERIFIED | Backend tests used Windows Python 3.14, PostgreSQL 15 and Redis 7; Dockerfile targets Python 3.11. Browser business APIs were intercepted. No live Supabase/Drive/MinIO or production HTTPS/WSS proof. |

### Executed Results

| Checks / files | Passed | Skipped | Artifact |
| --- | ---: | ---: | --- |
| `test_task_lifecycle.py`, `test_task_lifecycle_review.py` | 86 | 4 | `checks/lifecycle.txt`, `.xml` |
| `test_task_execution_report.py`, final readiness/cache/completion-cycle tests, migration/restore test | 51 | 2 | `checks/report-security.txt`, `.xml`; final restore counter/timer check in `checks/migration-final.txt`, `.xml` |
| Tasks Phases 5-11, gamification Phase 12, security Phase 13 | 87 | 0 | `checks/task-regressions.txt`, `.xml` |
| Targeted two-process realtime | 5 | 0 | `checks/realtime-processes.txt`, `.xml` (3 deselected) |
| Deployment safeguards + existing proxy config tests | 5 | 0 | `checks/deployment-config.txt`, `.xml` |
| **Relevant backend total, excluding duplicate diagnostic reruns** | **234** | **6** | All selected checks passed |
| Frontend Node tests | 69 | 0 | `checks/frontend-tests.txt` |
| Chrome interaction/component scenarios | 39 | 0 | `checks/browser-results.json` + PNGs |

The six skips are SQLite counterparts of PostgreSQL-specific snapshot/timezone/lock/backup tests; the PostgreSQL versions actually ran. These are relevant suites, **not the entire backend/product suite**. Existing SQLAlchemy, Pydantic, datetime.utcnow and FastAPI lifecycle deprecations remain visible in logs. No failures were suppressed. The initial backup-test log incorrectly printed a hardcoded nine tables; its actual comparison covered eight. The counter is now derived from the compared table set, and the final rerun confirms eight (users, rewards, reward_claims, tasks, subtasks, time_entries, task_lifecycle_events, task_lifecycle_coverage).

Python compilation, scoped `git diff --check` and Bash syntax validation of six runbook command blocks passed. Git emitted LF/CRLF working-copy warnings. Disposable PostgreSQL/Redis test services were removed; application containers were not restarted. The pre-existing loopback Vite server at `http://127.0.0.1:6302` remains running. `checks/final-validation.json` records the final result without treating typecheck or unexecuted production gates as passes.

## Verified Architecture and Semantics

- Existing FastAPI, SQLAlchemy/Alembic, PostgreSQL, native task WebSocket/Redis invalidation, React/Vite and Headless UI remain. No dependency, identity system, timer store or event bus was introduced by this review.
- Task tenant comes from its project, or creator for legacy NULL-project tasks. Orphan tasks without tenant provenance fail closed. Task read permission is not equivalent to evidence-file permission. Active role and tenant are read from the current user, not trusted from arbitrary client fields.
- Database triggers record every persisted task/subtask status change and execution-entry mutation in the same transaction, including bulk/raw SQL. Authenticated session context attributes application writes; external SQL/system writes can correctly have unknown actor. Trigger observation time is not claimed as an exact historical work-start time.
- All eleven TaskStatus values and six separate SubtaskStatus values remain. There are no new workflow/XP mutations from the read APIs. Historical NULL projects, completion flags, balances, reward prices/claims and existing status-edit controls are preserved.
- Main-task completion means entry from outside into the existing DONE/DEPLOYED set; promotion within that set is not a new completion cycle. Subtask completion remains DONE only. Captured reopens clear final completion until another effective completion. Historical stored `completed_at` is only a fallback when no captured reopen contradicts it.
- Timestamps serialize in UTC; legacy naive application timestamps retain the existing UTC interpretation. IDs preserve recorded transition order, not universal cross-transaction commit order. Unknown historical timestamps are not backfilled.
- `person_seconds` unions intervals **per person across both parent and children**; `elapsed_seconds` unions all wall-clock intervals; raw totals deliberately expose overlap. Direct + child person-time may exceed combined person-time for legacy overlaps. Different people's simultaneous work remains distinct. Fractions are combined before flooring. Future intervals do not create work.
- Only explicit same-person/same-target continuation links prove pause intervals. Unresolved pauses and deleted retained sessions are disclosed, not guessed. First observed active stage, first retained timer and final completion are separate facts.
- API responses use repeatable-read/read-only snapshots on PostgreSQL. Separate HTTP responses can straddle a transition; the client rejects conflicting current statuses rather than presenting false consistency.
- Journey uses the existing task-page realtime bridge, not a new socket; events coalesce, focus/online/visible 30-second polling recovers misses. Outside pages owning the task socket, recovery is polling-based. Raw SQL trigger capture alone does not publish Redis events. Live clock uses server time + monotonic client elapsed time, capped at 60 seconds before stale recovery.
- New report files are served via authenticated bytes, not signed/public URLs embedded in metadata. Completion storage remains private. Legacy task URL strings are resolved only to registered, tenant-authorized media records; unresolved strings are not fetched or echoed.

## Migration/API Inventory

No new revision was required for these review fixes. Required existing revision: **`fd5e6f7a8b9c`**, parent **`fc4d5e6f7a8b`**, sole current head. It adds nullable `time_entries.continued_from_id/start_kind/stop_reason`, a partial unique continuation index, immutable `task_lifecycle_events` and singleton coverage, task/child/entry indexes and capture triggers. There is no historical backfill, balance update or destructive business-table recreation. Trigger history intentionally has no cascading business FKs, so audit observations survive business deletion. Frozen `schema_v1.py` was not rewritten during this review.

Existing Phase 1 GETs: `/api/tasks/{id}/journey`, `/analytics`, `/execution-sessions`. Existing timer mutations remain under `/api/time-entries`, including `/pause` and `/restart`; API implementation is `backend/app/routers/time_entries.py` (consult OpenAPI for exact request bodies).

Phase 3 GETs: `/api/tasks/{id}/execution-report`, `/execution-report/completions`, `/execution-report/evidence?source=completion|linked`, `/execution-report/evidence/{completion|media|media_file}/{evidence_id}?preview=true|false`. Read contracts remain unchanged. Journey/session pages max 500; report file/attempt pages max 100. Completion attempts use `(created_at,id)` keysets. Historical event IDs are cursors, not durable client change-feed guarantees.

## Source Inventory

Reviewed Phase 1: `backend/alembic/versions/fd5e6f7a8b9c_task_lifecycle_history.py`; `backend/app/lifecycle/{__init__,schema_v1,context,analytics,contracts}.py`; lifecycle ORM/schema additions in `models.py`, `schemas.py`; `database.py`, `dependencies.py`; `routers/{task_lifecycle,tasks,time_entries,data_admin}.py`; `services/{time_tracking,subtask_workflow,task_events,task_access}.py`; corresponding lifecycle tests and Phase 1 docs. Permission/realtime boundaries were cross-checked in existing auth, completion/storage services, task WebSocket/Redis delivery, Compose and Nginx source.

Reviewed Phases 2/3: `backend/app/lifecycle/{report,report_contracts,report_evidence}.py`; `frontend/components/{TaskDetailModal,TaskJourneyModal,TaskExecutionReport}.tsx`, `TaskJourneyModal.css`; `hooks/{useTaskJourney,useTaskReport,useTaskWebSocket}.ts`; `services/{mockApi,taskRealtimeEvents}.ts`; `types.ts`, `types/{taskLifecycle,taskReport}.ts`; `utils/{taskJourney,taskReport}.ts`; journey/report unit tests and `e2e/task-journey.mjs`; prior phase reports/checks. No unrelated UI redesign was attempted.

### Files Modified by This Review

Backend: `backend/.dockerignore`; `backend/app/lifecycle/report.py`; `backend/app/lifecycle/report_evidence.py`; `backend/app/routers/task_lifecycle.py`; `backend/app/routers/tasks.py`; `backend/tests/test_task_execution_report.py`; new `backend/tests/test_task_journey_{readiness,migrations,deployment}.py`.

Frontend: `frontend/components/TaskJourneyModal.css`; `frontend/hooks/useTaskJourney.ts`; `frontend/hooks/useTaskReport.ts`; `frontend/utils/taskJourney.ts`; `frontend/test/task-journey.test.ts`; `frontend/e2e/task-journey.mjs`.

Operations/docs: new `ops/deploy/task-journey-{media,images}.compose.yml`; this folder's `README.md`, `runbook.md`, `checks/typescript-comparison.json` and generated validation logs/XML/JSON/screenshots. Other dirty files predate this review. No production env file, task/XP service behavior, dependency manifest or database revision was changed by this review.

## Remaining Release Gates and Operational Risks

1. **Blocker:** resolve or explicitly disposition the 131 pre-existing type errors; run the approved commit on Linux/Python 3.11 with production dependency versions, full CI and real browser/backend integration. The current dirty working tree is not an immutable release artifact.
2. **Blocker:** restore an approved production backup into an isolated environment; compare complete user/reward/task records and real media before/after migration. This review's synthetic restore is not production-data reconciliation. Test all earlier pending migrations separately; never stamp an unknown live schema.
3. **Blocker:** adopt and verify persistent private media, backup both database and media consistently, and rehearse recovery. No automatic container replacement before copying ephemeral media. Do not bake backups/evidence/credentials into image layers. Existing images might already contain them; assess registry access and rotate exposed secrets separately.
4. **Blocker for enabled providers:** test each configured storage provider with real staging credentials, private bucket/ACLs, missing files, timeout and revocation. Google Drive one-click OAuth is not implemented by this feature. Existing Media Library public upload URLs/Drive anyone ACLs are outside the report's private byte endpoint and are **not retroactively made private**; inspect and revoke public evidence access before release. No antivirus/CDR guarantee is made.
5. Large tasks: analytics caps at 50,000 retained sessions and returns 422 rather than partial totals. Capture history and child-state summaries still grow with history/task size. Report rows are rendered in batches but summaries are not fully server-paginated. Query-count measurements are not a capacity or latency benchmark.
6. Provider bytes are bounded to 50 MiB per request (completion uploads retain their existing 10 MiB limit). Concurrent remote reads can hold database snapshots/connections and sizeable buffers; cap concurrency, verify SDK timeouts and monitor pool/wall-clock time in staging. Load/stress testing was not run.
7. Newly authorized endpoints recheck access per request, not continuously during a file transfer or repeatable snapshot. Previously downloaded bytes cannot be revoked. The old full task list still uses its bounded cache TTL; unrelated membership/role changes may leave prior list data until invalidation/expiry. Fresh Journey/report/download actions do not trust this cache.
8. Append-only triggers stop ordinary UPDATE/DELETE/TRUNCATE, not a database owner or compromised superuser. Use a separate migration owner, least-privilege runtime role, restricted Redis/network access, HTTPS/WSS and clock synchronization. Do not grant runtime trigger disabling/DDL or expose database/Redis publicly.
9. Monitor capture-write errors, migration revision/trigger presence, session-limit errors, private-file 404/413/415/503 rates, query/pool time, outbox lag and disk growth. `/health` is not migration proof; `/ready` checks database/Redis but not all lifecycle triggers. Audit deletion/retention needs an explicit compliant policy, not TRUNCATE.

Deployment, exact local reproduction commands, recovery and rollback boundaries are in [runbook.md](runbook.md). **Production remains NO-GO until the outstanding gates are evidenced and approved.**
