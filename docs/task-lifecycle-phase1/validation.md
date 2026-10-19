# Phase 1 Validation

Date: 2026-10-19. These are local results, not production certification.

Superseded by the [independent Phase 1 verification](review.md), which records
additional fixes and final Windows / Linux results with explicit skip accounting. Evidence below
is the original implementation baseline, not the final review result.

## Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| New lifecycle/session/analytics tests, Windows Python 3.14 | PASS: 37 | [JUnit](checks/lifecycle.xml) |
| Same new tests, Linux Python 3.11.17 | PASS: 37 | [JUnit](checks/linux-lifecycle.xml) |
| Task/workflow/timer/evidence/notifications/XP/security and selected realtime regression tests | PASS: 158 | [JUnit](checks/regression.xml) |
| Final workflow-specific rerun after causal flush ordering refinement | PASS: 38 | [JUnit](checks/final-workflow.xml) |
| Additive revision upgrade over populated legacy fixtures, empty-history downgrade/re-upgrade, populated-history downgrade refusal | PASS on SQLite and PostgreSQL 15 | Included in lifecycle results |
| Backend compilation | PASS | `python -m compileall -q` for new/modified lifecycle modules and revision |
| Alembic graph | PASS: one head, `fd5e6f7a8b9c` | `cd backend; python -m alembic heads` |
| Scoped tracked-file whitespace validation | PASS | `git diff --check -- <Phase 1 tracked paths>`; only Git CRLF notices |
| Full application suites / frontend build / browser E2E | NOT RUN for this backend-only phase | Do not infer whole-product release readiness |
| Production-like backup restore/reconciliation | NOT RUN | Required before deployment |
| Production performance / load tests | NOT RUN | No latency or capacity improvement claimed |

The final Linux lifecycle run also includes the causal ordering assertion described
below. The Windows lifecycle report precedes that last flush-order refinement;
affected workflow routes are separately rerun after it.

## Coverage

- Creation metadata, UTC serialization, all 11 parent statuses and all six child
  statuses; same-status writes do not create transitions.
- ORM/bulk/direct SQL transitions; DONE -> TODO -> DONE; rollback of mutation and
  history; unknown system actor and pooled-connection actor cleanup.
- Sequential activation, intermediate WAITING -> TODO -> IN_PROGRESS, reopen
  downstream IN_REVIEW; predecessor completion recorded before successor activation.
- Explicit pause, linked resume, atomic restart, repeated corrections preserving
  old/new values and first-original values.
- Concurrent parent completion writes, simultaneous start/stop/resume/restart,
  unique continuation, transaction failure rollback and no duplicate effective events.
- Existing transactional task invalidation on conditional timer stops, including
  rollback and stop retry behavior.
- Existing session lookup from a fresh request, pagination and continuation metadata.
- Parent/subtask overlap, distinct workers, active timers, midnight, timezone offsets,
  adjacent intervals, fractions and deterministic integer-second totals.
- Cross-tenant owner denial, same-tenant unrelated user denial, missing authentication,
  invalid pagination and preservation of existing permission policy.
- PostgreSQL repeatable read snapshot and write rejection; normal SQLite API read
  transactions; append-only enforcement and retained history after task deletion.
- Synthetic legacy creation time, completed subtask flag, task status, time duration
  and XP balance remain unchanged by the new revision. No baseline historical
  transition rows are invented.

The 158-test regression selection covers existing project-linked task behavior,
dependencies, force-start/reopen, evidence approvals, notification retries, XP and
reward accounting, security and selected realtime/outbox/metrics behavior. It is
not a live SMTP, browser call/media, full multi-worker load, or production release test.

## Isolation And Reproduction

Tests used only disposable SQLite files and random schemas in the explicitly named
`zeaplay_rt3_test` PostgreSQL database. The PostgreSQL test service was created with
the existing `ops/testing/compose.realtime.yml` under the new, isolated Compose
project `zeaplay-lifecycle-phase1`, bound to localhost port 56415 with tmpfs storage.
It did not mount production volumes or read production credentials. The existing
application containers on ports 6300/6311/6312/6432/6380 were not restarted or migrated.
The disposable validation container, PostgreSQL container and their test network
were removed after verification; the original application containers remained running.

The Linux validation container used the existing backend image with current source
mounted read-only, an isolated `/tmp` database, and only the test-service network.
`pytest==8.3.5` and `prometheus-client==0.21.1` were installed in that disposable
container for testing, not added as new application dependencies. The application
image itself was not rebuilt or deployed by this work.

PowerShell reproduction from the repository root, after starting the disposable
PostgreSQL service on its test-only port:

```powershell
$env:VEE_BOOTSTRAP_SCHEMA = 'false'
$scratch = Join-Path $env:TEMP ('zeaplay-validation-' + [guid]::NewGuid().ToString('N') + '.db')
$env:VEE_DATABASE_URL = 'sqlite:///' + ($scratch -replace '\\', '/')
$env:VEE_ENABLE_N8N_FORWARDING = 'false'
$env:ZEAPLAY_RT_POSTGRES_TEST_URL = 'postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_task_lifecycle.py -q --tb=short
```

The test requires a database name containing `rt3_test`, creates a random schema,
and removes only that schema during teardown. Without the explicit test URL,
PostgreSQL cases skip; such a run is not PostgreSQL validation. Synthetic identities
use `example.test`, not real customer accounts.

## Failures Observed During Development

These were not hidden by the final passing reports:

- First collection attempt: an extra parenthesis in a newly written test. Corrected.
- First PostgreSQL fixture run: 11 setup errors because the scratch database lacked
  the repository's existing `pg_trgm` prerequisite. The isolated test fixture now
  installs it and includes `public` in its schema search path. No application
  extension or production schema was changed to fix the fixture.
- Initial Alembic-head command was run from the repository root with a relative
  script path and failed. Running it from `backend` succeeds. Run migration commands
  from that directory or the backend image's `/app` working directory.
- An expanded Windows regression attempt with a global `sqlite://` engine terminated
  with a CPython SQLite access violation while test and audit-worker threads used
  the in-memory pool. That attempt produced no complete suite result. Repeating
  with an isolated file-backed global SQLite URL passed all 158 selected tests.
  No unrelated application pooling change was made to conceal the failure.
- The existing backend image did not include pytest. Test dependencies were installed
  only in the separate, disposable Linux validation container.

Existing warnings remain: `datetime.utcnow`, duplicate `Level.created_by` mapping,
class-based Pydantic config, deprecated FastAPI lifespan/event and HTTP status
names, plus installed TestClient dependency warnings. They are not silently
suppressed or refactored by this phase. No backend lint/typecheck configuration
was found; compilation and runtime typed-contract tests are not claimed as a
dedicated static typecheck or linter run.

## Release Limitations

- Production-backup rehearsal, before/after balance reconciliation and operational
  approval remain deployment gates.
- The revision needs table/function/trigger privileges, bounded DDL lock timeouts,
  correct runtime grants and space for growing append-only history.
- Retained-session totals do not resurrect business-deleted sessions. Their final
  timing snapshots remain in journey events. No fabricated legacy stage durations
  or automatic history backfill is provided.
- Journey pagination is a read interface, not a gap-free live event stream across
  concurrent transaction commits. Refresh after existing realtime invalidations.
- Older binaries remain structurally compatible with the additive schema but lack
  precise actor attribution and explicit continuation/pause semantics.
- Full historical analytics across deleted entities, UI dashboards and new realtime
  delivery guarantees are not part of Phase 1.

Phase 1 implementation is locally validated. Production deployment remains gated
by the [deployment and recovery procedures](README.md#deployment-and-recovery).
