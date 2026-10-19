# Task Lifecycle Phase 1

Scope: backend history, existing execution sessions, and authorized read APIs only.
No new task statuses, transition rules, XP rules, dashboards, identity systems, Redis
infrastructure, or production deployment are included. Existing dirty realtime and
monitoring work was preserved.

The independent [Phase 1 review](review.md) supersedes the initial validation
results and records the additional guards and regression evidence.

## Verified Integration Points

| Area | Existing source and behavior | Phase 1 integration |
| --- | --- | --- |
| Persistence | `backend/app/models.py`, SQLAlchemy; PostgreSQL production, SQLite tests | Add immutable observation tables; reuse `time_entries` |
| Migrations | Alembic; previous head `fc4d5e6f7a8b` | New head `fd5e6f7a8b9c` |
| Parent status | `routers/tasks.py`: create, edit, complete, recurrence/duplication; `services/project_dashboard.py`: manual override | Database triggers observe persisted changes, including Core/bulk/raw SQL |
| Subtask status | `services/subtask_workflow.py`; submission/review routes use this service | Capture activation, force-start, completion, rejection and downstream reopen review; flush intermediate stages within the same transaction |
| Other producers | `tickets/task_link_service.py`, `routers/data_admin.py`, `seed.py`, schema normalization | Same database triggers; import/reset explicitly bind their authenticated actor in their separate sessions |
| Authentication | JWT tenant validation and active users in `dependencies.py` | Bind authenticated actor transaction-locally; pooled connections cannot retain attribution across requests |
| Authorization | `routers/tasks.py` task tenant and visibility policy | Reuse it, including project members, followers, department managers and legacy creator tenancy |
| Timers | `services/time_tracking.py`, `routers/time_entries.py` | Extend existing start/stop/resume/correction service, not a second timer model |
| Realtime | Native task WebSockets, existing task invalidations/outbox; Socket.IO remains separate | No changed event names or payloads; conditional timer stops explicitly retain the existing transactional task invalidation |
| XP | Existing completion/creation award guards | No writes or new awards introduced by history or analytics |

All 11 `TaskStatusEnum` values and all six separate `SubtaskStatusEnum` values remain
unchanged. History reports persisted parent status, not a derived subtask rollup.
Approvals remain governed by existing code; history does not bypass approval or
award XP for subtasks.

## Schema And Event Contract

`task_lifecycle_events` contains an ordered integer ID, tenant/task/subtask/session
identifiers, event type, previous/new status, nullable actor, UTC occurrence and
recording timestamps, and allowlisted JSON details. No notes, evidence files,
passwords, tokens, user emails, or completion descriptions enter this table.

Database triggers observe INSERT/UPDATE and pre-deletion on `tasks`, `subtasks`,
and `time_entries`, within the mutation transaction. A rollback removes both.
Same-status writes produce no transition. Reopening and repeated transitions are
distinct events; concurrent starts for an active target and explicit-ID stop retries
do not manufacture new sessions/events. An ordinary start after a stopped session
is still a new start, not an indefinitely deduplicated request.
No network delivery takes place inside the triggers.

Event types:

- `task.created`, `task.status_changed`, `task.deleted`.
- `subtask.created`, `subtask.status_changed`, `subtask.deleted`.
- `timer.started`, `timer.paused`, `timer.resumed`, `timer.stopped`,
  `timer.restarted`, `timer.corrected`, `timer.deleted`.

Timer correction details preserve the actual OLD and NEW timestamps and duration
on every correction. Existing first-original fields and correction audit records
are retained. Creator ID and stored task creation time accompany insertion events.
`occurred_at` is the database observation time, not a claimed historical creation
or commit time. PostgreSQL provides microsecond timestamp precision; SQLite's
trigger clock has millisecond precision. Stored legacy naive datetimes follow the
existing application's UTC convention; no timezone conversion rewrites old rows.

Authenticated request attribution comes from the existing JWT dependency, using
transaction-local PostgreSQL configuration / SQLite connection functions. Jobs,
maintenance SQL and older binaries without context have `actor_id=null`. An actor
is never guessed from assignee or creator. Trusted internal services can call
`lifecycle.context.bind_actor(db, actor)` when an authenticated actor is known.

There are intentionally no cascading foreign keys from history to business rows.
Deleting a task/user cannot erase recorded history. UPDATE/DELETE of history and
coverage are rejected; PostgreSQL TRUNCATE is also rejected. This is not protection
against a database owner/superuser disabling triggers or fabricating SQL records.
Unresolvable legacy tenant IDs remain NULL and are never returned by tenant reads.

`task_lifecycle_coverage` records when capture was installed. No historical events
are backfilled. The journey exposes the real stored task creation timestamp, but
`history_complete=false` when task creation predates capture, captured creation
metadata differs from the current row, or a current child/session lacks creation
evidence. Pre-capture original/corrected session starts and future session dates
also make coverage incomplete. This flag is conservative coverage for the current
entities, not a claim that every actor is known or privileged tampering is impossible.
Restoring/importing old timestamps does not create a supposedly complete historical
journey. Legacy subtasks have no creation timestamp to reconstruct.

New nullable `time_entries` columns:

- `continued_from_id`: previous execution session; partial unique index permits
  only one continuation per predecessor and deduplicates resume/restart retries.
- `start_kind`: `resumed` / `restarted`, otherwise NULL for ordinary starts.
- `stop_reason`: `paused` / `stopped` / `restarted`; legacy values remain NULL.

PostgreSQL transaction advisory locks serialize timer mutations per user without
locking XP/user balance rows. Target task/subtask share locks recheck current status
after concurrent workflow changes; entry locks refresh mutable session values.
SQLite uses its writer lock. The existing active-session unique index, conditional
stop writes and continuation unique index remain database safeguards. A stale active
timer from a privileged tenant transfer blocks new work without revealing its data;
close timers before transferring identities. The existing DB active index is scoped
to `(tenant_id, user_id)`, so cross-tenant transfer protection also relies on these
application guards, not a new global database constraint.

Resume after a stop creates
a new row. Restart atomically closes an active row and starts its continuation;
failure rolls back the close. Restart after a stopped row starts its continuation.
Retrying an old predecessor returns that predecessor's existing continuation,
even if that continuation has since stopped. Resume/restart the latest session to
continue again. Explicit entry-ID stop/pause is recommended for retry safety;
the legacy no-ID stop still means "stop my currently active timer".
An unrelated active session is a 409 conflict for resume/restart, not a substitute
continuation. Continuation reads require the same tenant, user and target. Manual
corrections reject overlaps with running or stopped work across all targets of that
user and reject future work. Existing authorization, including legacy creator
correction permission, remains unchanged.

## API Contracts

Read routes are included with the existing task router at both its existing
mounts: `/tasks/...` and `/api/tasks/...`. Bearer authentication is unchanged.

| Method | Canonical route | Contract |
| --- | --- | --- |
| GET | `/api/tasks/{task_id}/journey?after_id=0&limit=100` | Creator/time, current parent and child statuses, capture coverage, event items and `next_after_id` |
| GET | `/api/tasks/{task_id}/execution-sessions?after_id=&limit=100` | Existing `TimeEntryRead` rows including continuation metadata, `next_after_id` |
| GET | `/api/tasks/{task_id}/analytics` | Server `as_of`, parent/children/aggregate metrics and per-subtask metrics with status and coverage |
| POST | `/api/time-entries/{entry_id}/pause` | Existing stop authorization; returns stopped entry with `stop_reason=paused` |
| POST | `/api/time-entries/{entry_id}/restart` | Existing target/owner authorization; returns continuation, HTTP 201 |

Existing start, active, stop, resume and correction endpoints and request bodies
remain available. `TimeEntryRead` gains three optional fields. New read contracts
are typed in `backend/app/lifecycle/contracts.py`. Pagination defaults to 100,
maximum 500. Journey sorts by observation ID; sessions sort stably by session UUID,
not time. Use returned timestamps for chronology. Invalid pagination returns 422;
unauthenticated requests return 401; other tenants/missing tasks return 404;
same-tenant unauthorized readers return 403. Timer conflicts remain 409.

New reads reject invalid bearer credentials before opening the snapshot. They use
PostgreSQL REPEATABLE READ/READ ONLY or an explicit SQLite read transaction. Existing
user/tenant/role authorization runs within that snapshot. Active-time calculations
use the database UTC clock on PostgreSQL and application UTC clock immediately after
acquiring the SQLite snapshot, avoiding its coarser Windows clock resolution, not browser
durations. Pages are independent snapshots, not an exactly-once change feed.
Sequence IDs order observations, not cross-transaction commit order. A long
transaction may commit an earlier ID after another page was read; existing realtime
invalidations should trigger a fresh journey/snapshot read rather than permanently
tailing `after_id`. No new reliable realtime event contract is claimed.

## Metric Definitions

All calculations use effective persisted UTC intervals; corrections do not create
additional billable/work duration. Stopped intervals are clipped at `as_of`, active
sessions end at `as_of`, and zero/invalid/future intervals contribute no duration.
Active-session counts report persisted open rows even when a legacy future start
timestamp prevents calculating elapsed work; those rows are not silently repaired.
Totals cover currently retained `time_entries`; existing business deletion/cascade
behavior is unchanged. Deleted sessions' final timestamps remain in journey deletion
events, but are not silently resurrected into current-session totals. Full historical
reconstruction across deleted entities is outside these current-state analytics APIs.

- `raw_session_seconds`: sum of individual interval durations, useful for detecting
  historical overlaps; **not** the deduplicated work total.
- `person_seconds`: union overlapping/adjacent intervals per user, then sum users.
  This is the deduplicated aggregate work total. Two employees working for one hour
  contribute two person-hours, not one.
- `elapsed_seconds`: union across all users; measures covered wall-clock time.
- `session_count` / `active_session_count`: persisted rows and currently running rows.

Parent-only, child-only and each subtask's metrics are independently useful, but
must not be added together for a grand total. The `aggregate` union performs that
deduplication across targets. Fractions are retained during interval merging and
floored to integer seconds after merging and summing users (using exact timedeltas). More than
50,000 sessions for one task yields 422, never silently truncated totals. No cache
or new reporting/materialization infrastructure is introduced.

## Deployment And Recovery

No production migration or restart was performed. Before release:

1. Back up the actual PostgreSQL database with `pg_dump -Fc` and test `pg_restore`
   into a separate database. Include the new tables, functions and triggers in
   future backups; do not rely on the legacy application JSON export as a full DB backup.
2. Rehearse on a restored production-like database, comparing user/reward balances,
   task/subtask counts, statuses, creation timestamps and existing time entries.
   Isolated synthetic migration tests are not a production-backup rehearsal.
3. Drain writers / use a maintenance window. From the new backend image/directory,
   with the actual deployment database environment, run `alembic current`,
   `alembic heads`, then `alembic upgrade fd5e6f7a8b9c`. The predecessor is
   `fc4d5e6f7a8b`; do not stamp an unverified legacy schema to this revision.
4. Use bounded PostgreSQL migration timeouts, e.g. `PGOPTIONS='-c lock_timeout=5s
   -c statement_timeout=120s'` for the migration process. The nullable additions do
   not rewrite historical values, but DDL/trigger installation and the partial
   unique-index scan still require locks and must be rehearsed on real table sizes.
   On timeout let the transaction roll back; inspect blockers before retrying.
5. Deploy new application code only after migration. Keep `VEE_BOOTSTRAP_SCHEMA=false`
   in production; startup `create_all` is not an upgrade mechanism. Restart all API
   workers together to avoid older timer code omitting pause/resume semantics or
   actor attribution during a rolling deployment. No new worker is required.
6. Use separate deployment/runtime DB roles. Runtime needs ordinary table reads,
   business writes, INSERT on lifecycle history and sequence USAGE for trigger
   execution, not schema ownership, trigger management or history UPDATE/DELETE.
   Trigger functions intentionally use invoker privileges. Keep Redis and database
   access private and synchronize application/database clocks with NTP.
   If built-in function execution has been restricted, permit the timer runtime role
   to execute `pg_advisory_xact_lock(bigint)` and `hashtextextended(text,bigint)`.
7. Smoke-test status/reopen, timer start/pause/resume/restart, tenant denial, snapshot
   reads, XP invariants and the existing task invalidation relay before reopening traffic.

Rollback prefers the previous application image **with additive schema retained**.
Stop/drain the new image first. Older timer/status writes remain compatible and
still generate basic history, but lack explicit continuation/pause and actor
context. Do not drop audit data to downgrade. The revision refuses downgrade when
history is populated; only a completely unused migration can be downgraded to its
predecessor and re-upgraded. Forward fixes should use a new migration/helper version,
not edit `schema_v1.py` after release. Restore a backup only into an isolated DB for
validation; replacing live data needs explicit incident approval and reconciliation.
The reviewed downgrade locks writers before its constant-time history existence
check. Downgrade requires an online connection; PostgreSQL upgrade SQL can be rendered
with `alembic upgrade fc4d5e6f7a8b:fd5e6f7a8b9c --sql` for review. The refinement only
adds an offline-compatible execution adapter; the v1 trigger SQL is unchanged.
No new revision, history backfill or stored-timestamp correction is required by this review.

History currently has no automatic purge, partitioning or archive job. Monitor row
growth and disk usage; retention/archival requires an explicitly approved policy.
Deleted tasks' retained history is not exposed by the task API once the parent is
gone; a future privileged audit reader is outside this phase. No claim is made
about cryptographic audit tamper-proofing or production-scale performance.

## Files In This Phase

- `backend/app/models.py`, `schemas.py`, `dependencies.py`.
- `backend/app/lifecycle/{__init__,context,schema_v1,contracts,analytics}.py`.
- `backend/app/routers/{tasks,time_entries,data_admin,task_lifecycle}.py`.
- `backend/app/services/{time_tracking,subtask_workflow}.py`.
- `backend/app/services/task_access.py` shares the existing tenant predicate without changing role policy.
- `backend/alembic/versions/fd5e6f7a8b9c_task_lifecycle_history.py`.
- `backend/tests/test_task_lifecycle.py`.
- `backend/tests/test_task_lifecycle_review.py` adds independent adversarial/concurrency cases.
- This directory's documentation and generated validation results.

See [Validation](validation.md) for actual test results and release limitations.
