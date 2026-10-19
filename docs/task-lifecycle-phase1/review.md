# Independent Phase 1 Verification

Reviewed 2026-10-19 against the current working tree. Scope is Task Lifecycle
Phase 1 only. Existing unrelated realtime/frontend changes were preserved.

## Findings Corrected

| Priority | Confirmed defect | Correction |
| --- | --- | --- |
| High | Concurrent start could accept TODO while an in-flight transaction was making the parent DONE or child WAITING | Share-lock and refresh the target before validating status; lock parent before child/session |
| High | Two corrections could both pass overlap checks and commit overlapping work | Timer-only transaction advisory lock per user on PostgreSQL; SQLite writer serialization; refreshed entry values |
| High | Empty-history downgrade could drop an audit row committed after its guard checked | Lock business/history writers before the constant-time existence check; populated history still refuses downgrade |
| Medium | Resume could claim an unrelated active session as a continuation, breaking retry linkage | Require a real linked continuation or reject the conflict with 409 |
| Medium | Malformed persisted continuation pointers could return another tenant/user/target's row | Tenant/user-filtered lookup and target validation; malformed uniqueness conflicts fail closed. Forging this pointer through the normal request schema was not possible |
| Medium | Corrections ignored active intervals and work on other tasks, and accepted future work | Validate all targets for the same user, including running entries; future corrections return 422 |
| Medium | Creation metadata edits and imported old sessions could leave `history_complete=true` | Compare immutable insertion metadata and require creation evidence for current children/sessions; flag pre-capture/future intervals incomplete |
| Medium | Actor attribution could disappear after PostgreSQL savepoint rollback | Invalidate the cached binding and restore it before the next statement/flush, outside the closed savepoint context |
| Medium | Existing workflow event timestamps shifted by 19,800 seconds under a non-UTC DB session | Write aware UTC values for new workflow events and timer metadata; normalize timer API timestamps to UTC. No old timestamps were rewritten |
| Medium | Corrupt legacy tasks without tenant provenance could pass the timer owner/admin guard | Fail closed; share the existing task tenant predicate/object check and filter before loading or locking foreign rows |
| Low | Existing timer responses returned ambiguous naive timestamps on SQLite | `TimeEntryRead` consistently emits explicit UTC, retaining the existing JSON fields |
| Low | Full assignee records, redundant target hydration, duplicate response normalization, and invalid-token DB work | Remove unnecessary hydration/normalization and reject invalid bearer credentials before snapshot queries |
| Low | Alembic offline upgrade rendering failed on `MockConnection` | Add an execution adapter preserving the v1 SQL; online-only downgrade has a clear error |

Role checks now precede correction state errors, so unauthorized callers do not
learn whether a session is running. Privileged tenant transfer with a stale active
timer fails closed instead of starting another timer. The normal timer schema still
ignores client attempts to override session user, tenant or continuation metadata.

## Architecture And Compatibility

- PostgreSQL/SQLAlchemy and existing `time_entries` remain authoritative. No new
  timer model, queue, infrastructure dependency, identity system or migration head.
- Database triggers remain the centralized capture point for ORM, bulk and direct
  SQL mutations. Actual previous/new persisted status is recorded atomically; a
  rollback removes the observation. Same-state writes do not manufacture transitions.
- Existing subtask transition rules, approval behavior, all 11 parent statuses and
  six child statuses are unchanged. Frontend enums still match, including BUG_FIXING
  and DEPLOYED. Analytics never derive/write task status or XP.
- Existing task authorization policy is reused. SQL and object-level tenant checks
  moved unchanged to `services/task_access.py`; router helper aliases remain for
  compatibility. Two project managers, ordinary members, owner/admin, unrelated
  managers and other tenants are tested. Legacy creator correction rights remain.
- New UTC defaults affect future writes only. Ambiguous old naive datetimes retain
  the application's existing UTC convention; no historical corrections or events
  are invented. A missing actor remains NULL, not an inferred assignee/creator.
- Parent/child totals union effective intervals per user, then sum users without
  per-session rounding loss. Elapsed time unions all users. Corrections do not add
  original durations to effective durations. Open-row counts remain visible even
  when a legacy invalid/future start contributes zero elapsed time.
- The existing database active-timer index is `(tenant_id,user_id)`. Global per-user
  serialization and stale-tenant checks protect the application paths; privileged
  SQL/older writers do not gain a new global cross-tenant DB constraint.
- New conflicts/validation errors retain the API's 409/422 conventions. Intentional
  tightening: resume cannot substitute an unrelated active timer; corrections cannot
  overlap other/running work or record future work. Timestamp strings now identify
  UTC explicitly. No request fields or existing routes were removed.

## Validation Matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Lifecycle, explicit timer actions, corrected accounting, concurrency and rollback | PASS | Original 37 cases plus 53 independent review cases on SQLite/PostgreSQL |
| Tenant and role matrix; malformed links; impersonation; legacy creator | PASS | Review cases and existing security/task suites |
| Atomic capture, reopen, intermediate activation, status enums and actor cleanup | PASS | Lifecycle/workflow tests, including nested rollback |
| Additive upgrade, legacy rows/balances, empty downgrade/re-upgrade, populated-history refusal | PASS | Real revision in isolated SQLite and PostgreSQL schemas |
| Downgrade/writer race and offline PostgreSQL upgrade SQL | PASS | Dedicated concurrent test and Alembic subprocess rendering |
| Existing tasks, approvals/evidence, notification retries, XP/rewards and selected realtime behavior | PASS | Existing 158-test regression selection |
| Compilation, one Alembic head, scoped whitespace checks | PASS | `compileall`, `alembic heads`, `git diff --check` |
| Full frontend build/browser E2E, production-backup restore, live deployment | NOT RUN | Not claimed by this backend review |

Final evidence:

- Windows Python 3.14: **244 passed, 4 skipped, 0 failed/errors** in 240.27 seconds,
  with 3,349 visible warnings ([JUnit](checks/review-final.xml)). Selection contains
  90 lifecycle/review cases and 158 existing regression cases on the final source.
- Linux Python 3.11.17: **86 passed, 4 skipped, 0 failed/errors** in 179.01 seconds,
  with four visible warnings ([JUnit](checks/review-linux.xml)). Current source was
  mounted read-only in an isolated validation container with disposable SQLite
  and PostgreSQL 15. This run covers lifecycle/review cases, not the 158 regressions.
- Four PostgreSQL-only checks are explicitly skipped for SQLite, rather than
  returning early and inflating pass counts. Their PostgreSQL counterparts execute
  against the isolated service. The status-transition race executes on both databases.
- Existing deprecation warnings remain visible. No test failures were suppressed. No backend lint/static typecheck
  configuration was found; compilation is not represented as a linter/typecheck.

The Windows selection was `test_task_lifecycle.py`, `test_task_lifecycle_review.py`,
`test_tasks_phase5.py` through `test_tasks_phase11.py`, `test_gamification_phase12.py`,
`test_security_phase13.py`, `test_realtime_phase3.py`, `test_realtime_refinement.py`,
`test_realtime_postgres.py`, `test_realtime_postgres_refinement.py`, and
`test_realtime_observability.py` under `backend/tests`, run with
`-q --tb=short --junitxml=docs/task-lifecycle-phase1/checks/review-final.xml`.
Use the isolated environment setup in [validation.md](validation.md#isolation-and-reproduction),
adding `test_task_lifecycle_review.py` for the independent cases. No application
database URL or production credentials are needed for these tests.

The review used Compose project `zeaplay-lifecycle-review`, test PostgreSQL bound
only to localhost:56415 with tmpfs storage, and a separate read-only-source Linux
validation container. Both owned containers and their network were removed after
the final runs. The five pre-existing application containers remained running;
none was rebuilt, restarted or migrated by this review.

Development failures are retained, not counted as final passes:

- [Initial adversarial cases](checks/review-before.xml): 17 failed, 4 passed.
- [Status race reproducer](checks/review-transition-before.xml): 2 PostgreSQL failures.
- [Non-UTC workflow reproducer](checks/review-utc-before.xml): one PostgreSQL failure.
- An additional savepoint reproducer failed before correction. The first attempted
  restore incorrectly issued SQL inside a closed context; tests caught it and the
  final deferred restore fixes it. A coarse SQLite-clock completeness false negative
  was also caught and corrected without altering stored timestamps.

## Query Measurements

Total SELECT statements for one request, recorded in final JUnit properties:

| API | SQLite: 1 / 41 children | PostgreSQL: 1 / 41 children |
| --- | --- | --- |
| Journey | 11 / 11 | 12 / 12 |
| Analytics | 11 / 11 | 12 / 12 |
| Sessions | 8 / 8 | 9 / 9 |

Each added child had a distinct assignee. No per-assignee hydration or N+1 query
growth was observed at this size. Only authentication loaded credential columns.
These are query-count measurements, not throughput/latency benchmarks. SQLAlchemy
may add batching queries for much larger collections; no production capacity claim.

## Files Changed In This Review

- `backend/app/services/time_tracking.py`, new `services/task_access.py`.
- `backend/app/routers/task_lifecycle.py`, `routers/tasks.py`.
- `backend/app/lifecycle/analytics.py`, `context.py`, `schema_v1.py`.
- `backend/app/models.py`, `schemas.py`, `services/subtask_workflow.py`.
- `backend/alembic/versions/fd5e6f7a8b9c_task_lifecycle_history.py`.
- `backend/tests/test_task_lifecycle.py`, new `test_task_lifecycle_review.py`.
- This report, README/validation cross-references and generated review check artifacts.

No deployed schema/data was modified. The revision remains `fd5e6f7a8b9c`, following
`fc4d5e6f7a8b`; the trigger SQL and schema are unchanged by this refinement. No
backfill, XP balance update, reward reset, or destructive production operation ran.

## Remaining Gates And Risks

- Rehearse migration and restore against an actual production-like backup; verify
  runtime grants, NTP, lock timeouts and schema version before release. No such
  backup or live production environment was accessed in this review.
- Close timers before privileged identity/tenant moves. Legacy tasks derive tenancy
  from projects or creators, so arbitrary creator tenant reassignment needs a
  controlled data migration, not an ordinary profile edit.
- Unknown historical timestamps/actors cannot be recovered automatically. Totals
  cover retained sessions; deletion-event snapshots are preserved but not silently
  resurrected into totals. An audit reader for deleted parents remains outside scope.
- Use explicit session IDs for retry-safe stop/pause. Legacy no-ID stop deliberately
  targets whatever is active when the request is processed. Ordinary start after a
  completed session intentionally starts a new session; without a client request ID,
  a much later replay cannot be distinguished from that new intent. Resume/restart
  use the predecessor ID and unique continuation for durable retry identity.
- Legacy task/dashboard `total_tracked_seconds` fields retain their closed-entry sum
  behavior for existing UI clients. Consumers needing interval-unioned totals with
  active time must use the new analytics contract, not add those old fields together.
- Journey pagination is not a gap-free cross-transaction change feed. Refresh its
  snapshot on existing invalidations. Audit retention/archival remains an operational
  policy; the history currently grows without automatic purge.
- Current child-state lists are still returned in full. Analytics caps a task at
  50,000 sessions rather than truncating totals. Large single-task graphs/payloads
  need production-size performance validation beyond the measured query counts.
- Runtime DB ownership can bypass triggers; this is not cryptographic or DBA-proof
  auditing. Mixed old/new writers do not all participate in the new timer locks;
  drain/restart workers together for release. No high-load/stress tests or live
  provider, browser call/media, or full product certification were performed.

**Verdict: PHASE 1 VERIFIED for local implementation and regression scope.**
Production release remains gated by backup rehearsal and operational approval.
Phase 2 was not started. No production deployment or restart occurred.
