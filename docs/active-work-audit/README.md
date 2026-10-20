# Global Timer refinement audit — 2026-10-20

The existing timer implementation was retained and refined. No application database migration, production deployment, application-container restart, commit, or staging operation was performed. All database races used disposable SQLite files or random schemas in the separate `zeaplay_rt3_test` PostgreSQL database. Real transport verification used the audit project's Redis instance.

**Release status: NOT production-ready.** Critical timer concurrency, authorization and integrity checks have passing evidence below. Repository-wide TypeScript errors and unavailable linting remain release gates, together with deployment-specific verification and the retention/scalability limitations described below.

## Defects fixed

| Verified defect | Change and evidence |
| --- | --- |
| A principal cached before the timer lock could retain an old privileged role or revoked account/credentials. | Reload and validate the principal after acquiring the timer lock; recheck correction permissions after waiting. No role is written by a timer action. SQLite/PostgreSQL stale-principal tests and real PostgreSQL lock-wait tests cover demotion, deactivation and credential revocation. |
| Concurrent task-WebSocket handshakes could exceed the per-user socket cap. | Capacity check, bounded acceptance and registration are atomic. Six simultaneous handshakes with a configured cap of one leave exactly one registered/live connection; the other five close with policy code 1008. Rejection uses the existing accept-then-close helper. |
| Own work disappeared when the parent target moved outside the tenant, while the capacity count still included it. | Preserve an owned session with redacted target metadata and `target_accessible=false`. Pause/stop remain available; target opening/resume are disabled. The mutation service still enforces current target access. |
| History metadata/search did not enforce current task visibility; a title search could reveal a match after access changed. | Apply the existing timer visibility policy as a batched SQL predicate to both metadata and search. Cross-tenant and same-tenant revoked-access tests verify redaction, no title match, and ability to stop one's own timer. |
| Main-task all-time totals reflected only one session. | Aggregate all retained owned intervals by task/subtask target. Two task sessions of 30 and 60 seconds now both report the total of 90. |
| Range totals could exceed persisted active time by restoring discarded fractional seconds. | Closed-interval range calculations use the accounted prefix ending at `start + duration_seconds`, capped by the recorded stop. Adjacent ranges total exactly the ledger's stored whole seconds. Original timestamps are retained. |
| Finalizing a paused session left its pause unresolved in the existing execution report. | Use the recorded `finalized_at` as a proven pause end and batch-load it with other report fields. A 40-second final pause is resolved as 40 seconds with zero unresolved pauses. |
| Timestamp corrections could move an interval across its predecessor/successor, making continuation history run backward. | Reject corrections before the previous stop or after the next start. Valid bounded corrections still work and retain original values and correction audit. Existing inverted historical records are not rewritten. |
| Continuous invalidations could repeatedly discard GET responses and keep refresh/actions busy indefinitely. | Apply serialized matching responses, cap each refresh promise at two reads, and coalesce further invalidations with a tracked timeout. Private notices with a different payload user ID are ignored. Event-flood browser verification confirms progress and a maximum of one active GET per tab. |
| Background history refresh removed expanded details and keyboard focus. | Retain rows during same-scope refresh, clearing them on identity/filter changes or access errors. Browser assertions verify the expanded details node survives refresh. |
| An empty Active Work read performed unnecessary metadata and totals queries. | Return after the root query; the empty active case now executes one query instead of seven. Filtered empty history still obtains the independent running count. Capacity checks now use SQL `COUNT` rather than materializing running IDs. |

The original failure logs are retained in [reproductions.txt](checks/reproductions.txt), [correction-reproduction.txt](checks/correction-reproduction.txt), and [history-security-reproduction.txt](checks/history-security-reproduction.txt). They record failures before the corresponding fixes. Older intermediate run logs remain available and are not presented as final passes.

## Verification

The machine-readable final record is [checks/results.json](checks/results.json). Frontend component browser tests mock HTTP/WebSocket responses; database races and the Linux runtime test use real services and are reported separately.

| Check | Evidence/result |
| --- | --- |
| Timer refinement plus existing Active Work matrix | **PASS: 55 tests**, SQLite and PostgreSQL; [final-refinement.txt](checks/final-refinement.txt). |
| Principal changes during a real held PostgreSQL timer lock | **PASS: 3 tests**, with 3 SQLite-only skips; [lock-wait-authorization.txt](checks/lock-wait-authorization.txt). |
| Final broad task/workflow/lifecycle/report/realtime/security suite | **PASS: 246 tests, 5 engine-specific skips**, 390.54 seconds; [backend-final.txt](checks/backend-final.txt). The three added PostgreSQL lock-wait cases above are supplemental to this run. |
| Frontend automated tests | **PASS: 85 tests**; [frontend-tests.txt](checks/frontend-tests.txt). |
| Active Work browser integration | **PASS: 15 scenarios**, zero browser exceptions, maximum one in-flight active GET per tab, no sockets after unmount; [browser.json](checks/browser.json). |
| Existing task journey, details, status timeline and execution report browser suite | **PASS: 39 scenarios**; [browser-results.json](checks/journey/browser-results.json). |
| Rebuilt Linux backend, real PostgreSQL/Redis/WebSockets | **PASS:** 7 competing starts produce 3 running timers; 2 authenticated sockets receive updates; pause/resume/history pass; [linux-runtime.txt](checks/linux-runtime.txt). |
| Production frontend build | **PASS**, 20.23 seconds; [build.txt](checks/build.txt). Existing large-chunk/minification warnings remain. |
| TypeScript (`npx tsc --noEmit`) | **FAIL:** 130 diagnostics outside the audit's timer UI files; [typescript.txt](checks/typescript.txt). The prior implementation report also recorded 130; this audit does not repair unrelated features. |
| Lint (`npm run lint`) | **UNAVAILABLE:** the frontend has no lint script/configuration; [lint.txt](checks/lint.txt). No lint pass is claimed. |

The broad intermediate run found two test-harness issues: its socket assertion counted the existing accept-then-close rejection helper as a live connection, and the old midnight test consumed successive fake clock values for read-only response projections. The final socket assertion checks registered/live connections and close codes. The midnight test now advances a stable server clock per action, with chronological dates, and still asserts 20 minutes across midnight and 30 days of resumed work. Missing `webhook_subscriptions` messages in those legacy test fixtures are captured warning logs, not successful delivery evidence.

### Concurrency and integrity results

- For each of USER and MANAGER, 12 barrier-synchronized requests (6 new starts and 6 resumes) yield exactly **3** and **5** successes respectively. Remaining requests receive `409 ACTIVE_TIMER_LIMIT`. Both database engines pass.
- Eight simultaneous resumes of one paused interval produce exactly one continuation on both engines. Existing duplicate-start/stop retry tests, partial running-target uniqueness, and continuation uniqueness remain intact.
- Demotion from MANAGER to USER retains the five existing sessions, exposes the current limit of three, and blocks further starts/resumes until capacity is available. It does not silently discard recorded work. Existing pause/stop permissions remain ownership scoped.
- PostgreSQL lock-wait tests show a demoted actor cannot retain owner target privileges, an inactive account receives 403, and a revoked credential receives 401. All three attempts create zero time entries.
- Existing transaction rollback, outbox/Redis delivery, repeatable-read snapshots, overlapping-session reporting, dependency/WAITING/force-start and task lifecycle tests remain in the final suite. Engine-specific skips are listed in the logs.

### Security findings

The stale-principal, socket-cap, and history-visibility issues above were fixed. Tests cover unauthenticated requests, same-tenant impersonation, cross-tenant IDs, manager permissions, socket origin validation, revoked credentials/accounts, private user-scoped timer invalidations, and response identity matching. Timer events carry invalidations rather than private interval payloads. Force-start continues through the existing authorized workflow and requires its existing reason; timer start does not bypass dependencies.

Owned interval IDs/timing remain visible after target access changes so the owner can stop work. Foreign target names, statuses and project metadata are redacted. Current task visibility follows the existing policy, including personal-task creator management; this audit does not redefine that RBAC contract. Tenant reassignment of a **user** requires resolving running work before the move; the service fails closed on running entries from a previous tenant.

### Performance and timing findings

- PostgreSQL serializes writes per user with the existing transaction advisory lock, which releases on commit/rollback. Different users use different keys. SQLite serializes writers at database level. Simultaneous same-user races pass; this is not a production load/latency benchmark.
- Existing tenant/user/start, task/subtask/start, unique continuation, and partial unique running-target indexes are retained. No schema/index migration was added. Existing migration idempotency and guarded downgrade tests are included in Active Work coverage.
- Metadata and totals remain batched. A 20-session history stays within the existing ten-query test bound. Empty active reads now need one query; capacity uses `COUNT`; report finalization is eager-loaded to avoid per-interval lookups.
- Recursive session discovery still traverses a user's retained interval history before pagination. Large histories and concurrent handshake bursts need representative staging measurements. WebSocket acceptance holds the registry lock for a bounded timeout; overload behavior is tested, fleet-scale handshake latency is not.
- Server UTC timestamps and persisted durations remain authoritative. The display advances with a monotonic browser clock and reconciles on reconnect, refresh, focus/visibility/online recovery, and the existing 30-second visible-page interval. It does not send a request per second. Network-delay compensation is an estimate; disconnected displays are provisional until reconciliation. Server clock synchronization remains an operational prerequisite.
- Active Work sums concurrent session time: two 49-hour sessions report 98 session-hours. Existing task execution reports retain their documented union-per-person/clock metrics, so their totals may differ intentionally. Closed intervals retain the existing whole-second ledger precision; discarded fractions are not recreated by range queries. No precision migration was performed.

### UI and regression findings

The browser suite covers keyboard opening/Escape/focus restoration, empty state, independent controls, capacity error, offline recovery, page refresh, reconnect, revoked/mismatched identity clearing, history details preservation, reduced motion, 390px mobile and 320px horizontal-overflow checks. [Desktop](checks/desktop.png) and [mobile](checks/mobile.png) captures are retained. The existing task/report suite additionally covers timeline ordering, reopen/completion metrics, evidence permissions, mobile report layout, and logout cleanup. This is automated Chrome coverage, not a physical-device, screen-reader, Safari or Firefox certification.

## Files changed by this audit

Production code:

- `backend/app/services/time_tracking.py` — fresh principal validation, count query, correction ordering.
- `backend/app/services/work_history.py` — early return, target totals, accounted range precision, visibility/redaction/search.
- `backend/app/lifecycle/report.py` — finalized pause calculation and eager-loaded field.
- `backend/app/work_schemas.py`, `frontend/types/activeWork.ts` — target accessibility field.
- `backend/app/ws/tasks.py` — atomic per-user handshake capacity.
- `frontend/hooks/useActiveWork.tsx` — bounded serialized reconciliation and notice scoping.
- `frontend/components/ActiveWork.tsx` — current-access controls and same-scope history refresh.

Verification/documentation: `backend/tests/test_timer_refinement.py` (new), `backend/tests/test_tasks_phase8.py` (clock fixture), `frontend/e2e/active-work.mjs` (extra scenarios/output override), `docs/active-work/README.md` (current reconciliation behavior/link), and this audit directory including the read-only [preflight.sql](preflight.sql). Unrelated workspace edits, including `frontend/hooks/usePushNotifications.ts`, were preserved and are excluded from this audit's change list.

## Remaining limitations and release gates

1. Resolve repository-wide TypeScript failures and establish a passing lint command before release certification. A Vite build does not perform these checks.
2. This is local Windows and rebuilt Linux-container verification. No VPS/proxy/production deployment, real browser/device diversity, load target, or external notification delivery was verified.
3. Existing hard deletion cascades retained time entries; immutable lifecycle observations survive, but the work-history panel does not reconstruct deleted intervals. If user-visible history after hard deletion is required, archival policy remains a release prerequisite.
4. Large retained histories still use recursive discovery. Very large active/paused sets and history pages retain existing response/pagination limits. No new historical cleanup, denormalized session ledger, or broad performance rewrite was introduced.
5. Previously corrupt/inverted continuation records need review. New corrections are guarded, but this audit does not rewrite legacy history or manufacture missing dates. Concurrent session totals and union report metrics must be interpreted according to their stated definitions.

## Deployment and rollback

1. Review/stage only the audit paths above; preserve unrelated work. Record known-good backend/frontend image digests and schema revision. Back up the database and prove restore in an isolated environment.
2. On the restored staging database, inspect `alembic current`, `alembic heads`, and history. Run [preflight.sql](preflight.sql) with read-only credentials and the correct application schema in `search_path`. Review any anomalous counts and validate index definitions/validity. Over-capacity demoted users are a review item, not justification to delete sessions.
3. This refinement adds **no migration**. An already-installed Global Active Work database at `ff8b9c0d1e2f` needs only matching application releases. For a deployment still at reviewed parent `ff7a8b9c0d1e`, follow the [original migration procedure](../active-work/README.md#database-migration-and-rollback): stop writers during the transactional/index upgrade and never stamp or blindly apply an unrelated migration chain. Keep production schema bootstrap disabled.
4. Build backend/frontend from the reviewed source; use the existing shared Redis/outbox relay configuration and WebSocket auth/origin/proxy settings. Deploy matching images through the existing release procedure. A backend restart disconnects sockets but does not stop persisted timers; clients reconcile after reconnect.
5. In staging and then the deployment, verify USER fourth start denied, MANAGER sixth denied, mixed start/resume races, duplicate retries, same/cross-tenant denial, revoked socket credentials, two separate authenticated clients, role demotion, WAITING/force-start, refresh/disconnect recovery, history/ranges and the existing report. Require all critical checks plus type/lint/build gates before claiming production readiness.
6. To roll back **this refinement**, redeploy the recorded previous compatible Global Active Work backend/frontend image pair. Retain `ff8b9c0d1e2f` and all interval/finalization data; no schema downgrade is needed. This restores the earlier known defects, so prefer a forward fix for security issues. Reconcile clients and recheck the critical gates after rollback.
7. Rolling back the **original multi-timer feature** is a separate operation: stop writers; its downgrade to `ff7a8b9c0d1e` refuses multiple running timers per user or any finalized history. Never delete finalized history to force rollback or deploy single-timer code over multiple running sessions. Retain the schema and apply a forward fix when the downgrade guard refuses.

Reproduction uses `ops/testing/compose.realtime.yml` with project `zeaplay-timer-audit`, PostgreSQL 56415 and Redis 56379. Explicit scratch URLs and the file-based global SQLite workaround are recorded in [reproduce.ps1](reproduce.ps1). The disposable containers/network and loopback Vite process were stopped after verification. The application Compose stack was left running; its database was not migrated. The local audit backend image remains available.
