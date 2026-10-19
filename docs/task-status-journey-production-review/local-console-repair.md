# Local Task/Timer Console Error Repair

2026-10-19, local development Compose project `ideashop-zeaplay-v5`, not the VPS.

## Confirmed Cause

The browser reported missing CORS headers for HTTP 500 responses from task details, active timer and transfer-request reads. Backend logs confirmed `psycopg.errors.UndefinedColumn: column time_entries.continued_from_id does not exist`. The configured localhost origin allowlist was already correct; it was not widened.

The actual PostgreSQL 16 database had lifecycle tables, coverage and capture triggers but lacked all three continuation columns. It had **no Alembic version record**. `Base.metadata.create_all()` creates missing tables, not columns on existing tables; the legacy schema bootstrap had not reconciled existing timers before creating lifecycle triggers. Running all migrations or stamping head against this database would not be a safe repair.

## Scoped Fix

- `backend/app/lifecycle/bootstrap.py`: idempotent addition of nullable `continued_from_id`, `start_kind`, `stop_reason`, plus the existing partial unique continuation index. Reuse SQLAlchemy DDL compilation; serialize concurrent bootstrap calls and preserve transaction rollback. No historical updates, ledger backfill, coverage reset or migration stamp.
- `backend/app/main.py`: invoke this compatibility helper during the existing enabled schema bootstrap, **before** metadata/trigger creation and seeding. No change to auth, CORS, XP or workflow rules.
- `backend/tests/test_lifecycle_bootstrap.py`: existing/partial/fresh databases, row/coverage preservation, unique continuation enforcement, transaction failure, concurrent calls, startup ordering and production CLI refusal.

Production remains on the reviewed explicit migration procedure with `VEE_BOOTSTRAP_SCHEMA=false`. This helper does not establish that older migrations are applied. Its explicit `--repair` CLI refuses a production environment; auditing without that flag is read-only. Existing deployments opting into legacy schema bootstrap still use their existing bootstrap flag.

## Local Application and Evidence

A full custom-format database dump was generated before changing schema:

`C:\Users\Lenovo\.codex\backups\ideashop-zeaplay-v5\before-lifecycle-columns-20261019-143318.dump` (294,739 bytes; pg_restore TOC readable). This debugging backup was not restored in this turn and is not production backup certification. It is outside the repository; protect it as private data.

The tested helper was executed from source through stdin in the existing, verified **development** backend container. No image replacement/restart was necessary for the database repair. Its media was not copied, deleted or overmounted. The running backend has no persistent media mount, so it was deliberately not recreated merely to apply this SQL fix. The startup source change will be included in the next approved build; it is not claimed as deployed into the existing image.

Before/after hashes and row counts matched for users, tasks, subtasks, rewards, reward_claims, existing time-entry fields, lifecycle events and lifecycle coverage. The repair added schema only; users/XP/rewards, work sessions and history remained unchanged. No Alembic version was fabricated.

Authenticated read-only HTTP probes against the actual running backend returned **200** with `Access-Control-Allow-Origin: http://localhost:6300` for:

- `/api/tasks/task-2`
- `/api/time-entries/active`
- `/api/tasks/task-2/transfer-requests`
- `/api/tasks/task-2/journey`
- `/api/tasks/task-2/analytics`
- `/api/tasks/task-2/execution-sessions`

Probe authentication was a short-lived, in-memory development diagnostic token scoped to the existing task creator; tokens and response bodies were not emitted or persisted. Preflight requests for localhost:6300 and 127.0.0.1:6300 returned 200; an untrusted origin returned 400.

The separate `/api/tasks/task-2/execution-report` probe returned **404**: that Phase 3 route is not in the running older image. It was not one of the reported failing requests. This deployment discrepancy remains explicit; no pending/unreviewed feature rollout was performed to hide it. The first diagnostic script also omitted the Ticket ORM registration import; correcting the probe import resolved that diagnostic-only failure without changing the application.

## Validation

- New bootstrap suite: **12 passed**, SQLite + isolated PostgreSQL 15, including rollback/concurrency tests.
- Existing timer Phase 8 + lifecycle suite: **51 passed, 1 skipped**. Skip was the SQLite counterpart of a PostgreSQL snapshot test which passed on PostgreSQL.
- Actual local PostgreSQL 16 repair and six authenticated endpoint reads: passed, as above.
- Existing application containers were not restarted or rebuilt. Disposable test PostgreSQL was removed after validation.

Full frontend/build/product tests were not rerun for this backend-only fix. The previous production NO-GO verdict and outstanding production migration/media/TypeScript/provider gates still apply. Refresh the Tasks page to retry the previously failing reads. Retain this additive schema on application rollback; do not drop columns containing future session links.
