# Subtask 500/CORS and Logout Rejection Fix

Verified locally on 2026-10-19 in `F:\Projects\ideashop-zeaplay-v5`. No production deployment or application-container restart was performed.

## Verified Causes

1. The running PostgreSQL `notificationtypeenum` lacked all six `SUBTASK_*` labels and `MENTION`; `notification_entity_type_enum` lacked `subtask`. Subtask reassignment reached the real task, then its transactional notification INSERT failed with `InvalidTextRepresentation: SUBTASK_REASSIGNED`. This was **not** evidence that `task-1`/`sub-1-*` were nonexistent frontend fallback records.
2. Allowed-origin preflight already worked. An unhandled backend exception generated its 500 outside the existing CORS middleware, masking the database failure as a browser CORS error. Widening the origin allowlist would not repair that failure.
3. Frontend logout used `void http.post(...)` inside a synchronous try/catch. The rejection escaped the catch. Clearing tokens immediately also raced with the shared asynchronous request interceptor; a logout request could be sent without credentials, while its 401 activated the ordinary refresh path.

## Fixes

- New `backend/app/services/notification_schema.py` derives expected enum labels from the actual ORM column definitions. It appends missing labels only to existing PostgreSQL types, preserves legacy labels, quotes identifiers/literals and serializes concurrent bootstrap attempts with a transaction-scoped advisory lock. SQLite is unchanged. New labels are committed before application code uses them; absent types are left to metadata creation.
- The existing development-bootstrap `ensure_notification_table_schema()` calls that repair in its own transaction. Migration-managed production startup remains controlled by `VEE_BOOTSTRAP_SCHEMA=false`.
- Existing migration `fa2b3c4d5e6f_add_notification_outbox.py` already adds these labels. No new or rewritten migration was needed. The affected local installation has no `alembic_version` table; it was **not** stamped or run through an unreviewed migration chain.
- `CorsFastAPI` retains the FastAPI object/API while wrapping its complete middleware stack, including the outer error handler, with the existing configured CORS policy. Only one CORS middleware is installed. Native WebSocket authentication/origin rules are unchanged.
- Unhandled HTTP errors return generic JSON plus existing no-store/security headers. Exceptions remain visible to server logging; database failures are not converted to success or silently swallowed. Untrusted origins receive no allow-origin header.
- Logout captures the current access token, clears local tokens synchronously, then sends a bounded best-effort audit request using plain Axios with explicit credentials and a rejection handler. No token means no request. Logout cannot refresh credentials or clear a newer session when a late failure arrives. The server's authenticated logout policy is unchanged; a genuinely expired credential may still receive an expected 401, without an unhandled promise rejection.

## Local Database Repair Applied

Confirmed the running backend environment was `development` before applying changes to the Compose database at loopback port 6432. PostgreSQL 16 remains running; no external/VPS connection was used.

- Full custom-format backup copied outside the repository: `C:\Users\Lenovo\.codex\backups\ideashop-zeaplay-v5\before-notification-enums-20261019-153447.dump`.
- SHA-256: `9248541CA98CE9C1700602F8BD5AD71CFA3C2B2F6ADA1E983796E8AD906591F5`.
- `pg_restore --list` validated the archive structure. This is **not** a complete restoration rehearsal of this backup.
- Added `SUBTASK_ACTIVATED`, `SUBTASK_REASSIGNED`, `SUBTASK_APPROVED`, `SUBTASK_REJECTED`, `SUBTASK_FORCE_STARTED`, `SUBTASK_REVIEW_REQUIRED`, `MENTION`, and entity label `subtask`.
- Six full-row table digests compared equal before/after the repair in a consistent transaction: users, tasks, subtasks, rewards, reward_claims, notifications. No password, task assignment, balance or notification record was updated by the repair.
- New enum casts work in a separate connection after commit; introspection reports no remaining gaps.
- Actual local backend `/health`: 200. PATCH preflight for `http://localhost:6300`: 200 with the exact allow-origin header.

The running backend already knows how to emit these notification events, so the enum repair does not need a restart. Retry the original action. No authenticated write was replayed against an existing task merely to demonstrate success; API mutation verification used synthetic isolated data.

## Test Results

| Check | Result |
| --- | --- |
| Backend notification schema, CORS failures, authorization, workflow notifications, token/WebSocket ticket and lifecycle-bootstrap regressions | **40 passed, 2 skipped**, 47.61s. Skips are SQLite variants of PostgreSQL-specific enum tests; actual PostgreSQL variants passed. Logs/JUnit: `console-error-fix-tests.txt/xml` |
| PostgreSQL legacy API reproduction | First PATCH failed and rolled back assignment/notification; after repair the same authorized PATCH returned 200 with correct tenant/subtask notification. Foreign-tenant assignee denied; points unchanged |
| Concurrent enum repair | Two callers added eight labels exactly once; second was an idempotent no-op; unknown legacy labels retained |
| CORS/error checks | Generic 500 JSON, trusted origin/Vary, untrusted/no-origin denial, preflight, 401 and 413 checked; no allowlist expansion |
| Logout Chrome interactions | **5 scenarios passed**: no token, 204, 401, 500 and network failure. Captured authorization, immediate local cleanup, no unhandled rejection, no refresh and no late clearing of a newer session. All business APIs intercepted; `console-error-fix-browser-tests.txt` |
| Frontend `npm test` | **70 passed**, zero skipped |
| Frontend `npm run build` | PASS; existing Lottie eval and large-chunk warnings remain; `console-error-fix-build.txt` |
| Python compilation and scoped diff whitespace checks | PASS; existing Git line-ending notices remain |
| TypeScript | **FAIL**, exit 2; 131 existing diagnostics, zero normalized diagnostic changes from the preceding password-reset check. See `console-error-fix-typescript.txt` |
| Lint | No configured frontend lint script; no lint pass claimed |

The initial new API fixture used a reserved `.test` email rejected by the actual response schema. The fixture was corrected to synthetic `example.com` addresses; application validation was not relaxed. Email, push and webhook delivery were stubbed to avoid external effects during isolated mutation tests. Dedicated PostgreSQL/Redis test services were removed afterward; application services were left running.

## Activate the Source Changes

The local database repair is already active, but containers still run their earlier images. The preview server at `http://127.0.0.1:6302/#/login` uses updated frontend source. The served bundle on port 6300 needs a rebuild for the logout fix:

```powershell
# Local frontend only; does not recreate backend, database or Redis.
docker compose up -d --build --no-deps frontend
```

After the container is healthy, hard-refresh the browser (`Ctrl+Shift+R`) and sign in again. A cached/old bundle will continue to exhibit the old promise-rejection bug.

For backend code activation, **do not blindly recreate it**: first preserve and verify existing private media and database backups, then follow the reviewed media/image/migration procedure in [the deployment runbook](task-status-journey-production-review/runbook.md) and [password-recovery activation guide](password-reset-implementation.md). This dirty checkout includes other unreleased changes. Deploy an explicitly reviewed change set; a local build is not production approval. Do not stamp a bootstrap database at head or run all pending migrations without reconciling its schema.

## Rollback and Limits

- Retain the new enum labels during application rollback. Removing/recreating PostgreSQL enum types would be destructive and unnecessary, especially after notifications use them. The prior code can ignore unused added labels.
- Prefer compatible code rollback/forward-fix. Do not overwrite the database with the backup to undo an additive enum repair; that would discard subsequent business writes. Use a separate restore/reconciliation procedure if recovery is genuinely required.
- Generic 500/CORS behavior was verified locally against source, not against a rebuilt Linux backend image. Full user click-to-server E2E on current containers and production deployment remain unexecuted.
- Existing running-server WebSocket access logs include ticket query URLs. No tokens were copied into this report; transport log redaction remains a separate deployment/security item.

## Exact Source Changes

`backend/app/main.py`, new `backend/app/services/notification_schema.py`, `frontend/services/mockApi.ts`, new `backend/tests/test_notification_schema.py`, new `backend/tests/test_cors_errors.py`, new `frontend/e2e/logout.mjs`, this report and the generated `console-error-fix-*` validation artifacts. Unrelated dirty work was preserved.
