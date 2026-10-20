# Backend audit — 21 October 2026

**Overall result: FAIL.** The automated checks and isolated security probes found release blockers. This is a local Windows and Linux-container audit, not a production certification.

## Scope and isolation

- FastAPI/SQLAlchemy source, Alembic history, Python dependencies, Compose configuration, live HTTP/OpenAPI/CORS, PostgreSQL/Redis readiness, Node presence server, and the backend pytest suite.
- The initial inventory contained 175 application Python files (46,761 lines), 278 Python files including tests/migrations, and 677 documented HTTP operations across 522 paths.
- Mutation tests use synthetic identities and disposable PostgreSQL 16/Redis containers in the `zeaplay-journey-review` project. SQLite files and uploaded test media are in temporary directories. The application database is inspected read-only.
- Test configuration explicitly overrides application settings and credentials. SMTP transport tests use mocks or local test servers. Real SMTP, push-provider delivery, external storage, n8n, and production traffic are not exercised.
- The workspace was initially clean. Concurrent frontend image moves appeared during the audit; those are unrelated and were left untouched.

## Release blockers

| Priority | Finding | Evidence and consequence |
| --- | --- | --- |
| Critical | Public registration accepts an owner role and caller-selected employer/tenant | `backend/app/routers/auth.py` assigns `payload.role`, `payload.status`, and a tenant derived from `payload.employer_id` without authenticating the caller. Unauthenticated registration in an existing synthetic tenant granted owner access on both SQLite and PostgreSQL. |
| Critical | Owner backup export crosses tenant boundaries | `/api/admin/data/export?scope=users` returns the other synthetic tenant's user record, including `hashed_password`. The route discards `current_owner` and queries all users. Reproduced on SQLite and PostgreSQL. |
| High | Owner audit-log reads cross tenant boundaries | `/api/logs/audit` exposes an event whose actor belongs to the other synthetic tenant. `_apply_scope_filters` returns the unfiltered query for ADMIN/OWNER. Reproduced on both databases. |
| High | Empty-database migration fails | On a fresh disposable PostgreSQL database, `alembic upgrade head` fails with `UndefinedTable: relation "users" does not exist` at `ALTER TABLE users ADD COLUMN tenant_id UUID`. The migration chain requires a legacy baseline; it does not initialize an empty database. |

The access-control findings require a consistent policy across registration, export/import/reset, audit reading/export/retention, and owner/admin operations. Two narrow runtime repairs below do not resolve these security issues. No application database migration or permission-model change was made during this audit.

## Runtime defects repaired in source

1. `backend/app/tickets/service.py`: ticket updates referenced undefined `update_fields`, so authorized updates (including no-op requests) raised `NameError`. Use the existing `changes` dictionary to decide whether to emit an update notification.
2. `backend/app/routers/data_admin.py`: backup serialization referenced undefined `session` for project-linked tasks. Preserve the stored `task.project_id` in the backup.

`backend/tests/test_backend_audit_regressions.py` checks ticket update/no-op persistence and notification behavior, plus backup serialization with and without a project. The focused Windows run passed all eight SQLite/PostgreSQL cases. The running application container was not rebuilt; its source differs only at these two application files.

## Check results

| Check | Result | Evidence |
| --- | --- | --- |
| Full Windows/Python 3.14.3 baseline | FAIL | **1,179 passed, 8 failed, 31 skipped** out of 1,218 cases in 1,556 seconds; 68.9% statement coverage. Collected before the eight new regression cases were added. |
| Full Linux/Python 3.11.17 suite | FAIL | **1,185 passed, 8 failed, 32 skipped, 1 setup error** out of 1,226 cases in 848 seconds. Raw results are retained; environment corrections and stale tests are explained below. |
| Linux statement coverage | 70.3% | 16,382 of 23,310 executable lines covered; 6,928 uncovered. This is statement coverage, not branch or exhaustive endpoint coverage. |
| Python syntax | PASS | 279 Python files parsed successfully after adding repair regression tests. |
| Runtime Python dependency consistency | PASS | `docker compose exec -T backend python -m pip check`: no broken requirements. |
| Development and production Compose parsing | PASS | `docker compose config --quiet`; production example parsed with `--no-env-resolution`. |
| Live API/proxy/presence readiness | PASS | API `/health`, `/ready`, proxy `/api/health`, `/api/ready`, presence `/health`: HTTP 200. |
| Unauthenticated private GET endpoints | PASS | All 261 documented private GET operations returned HTTP 401, with no unexpected status. Dynamic IDs were synthetic placeholders. Internal metrics hidden with 404. |
| CORS | PASS | `http://localhost:6300` allowed; untrusted origin rejected with HTTP 400 and no allow-origin header. |
| PostgreSQL/Redis connectivity | PASS | `pg_isready` accepts connections; Redis PING returns PONG. |
| Presence tests | PASS after startup retry | 10 passed, zero skipped, including real Socket.IO calls, meetings, and tenant boundaries. First run timed out waiting for startup; repeat passed. |
| Presence dependency audit | PASS | `npm audit --omit=dev`: zero known vulnerabilities. |
| Benchmark safety tests | PASS | Eight Node tests covering isolation proof, authorization scope, watchdogs, and client checks. |
| Guarded realtime smoke and backup/restore | PASS | 10 passed, one inapplicable SQLite backup case skipped. Includes six real two-identity chat/tasks/tickets/cross-worker/reconnect/Socket.IO scenarios and PostgreSQL dump/restore verification. k6 v2.3.0 was downloaded into temporary tooling and its official SHA256 checksum verified. |
| Focused repair regressions | PASS | 8 passed on Windows; see `checks/regression-final.xml`. |
| Owner export/audit isolation | FAIL | Four failing synthetic probes: both endpoints on SQLite and PostgreSQL. |
| Unauthenticated owner registration | FAIL | Two failing probes: privileged access granted in an existing synthetic tenant on both databases. |
| Fresh Alembic migration | FAIL | Single graph head `ffc2f3a4b5c6`; clean upgrade fails at the missing legacy `users` table. |
| OpenAPI operation-ID uniqueness | FAIL | Four operation IDs reused across retired OAuth GET/POST/PATCH/DELETE operations. |
| Runtime-error lint | FAIL | After the two repairs, 13 F821 findings remain: 11 in unreachable code after a return in `routers/logs.py`, two SQLAlchemy forward type references (`Ticket`, `User`). |
| Broad lint | FAIL | Initial configured Ruff scan: 3,279 findings, largely annotations/imports/FastAPI default-argument style. No automatic broad rewrite was applied. |
| Static security scan | REVIEW REQUIRED | Bandit: 45 findings (1 high, 11 medium, 33 low). Findings require context; they are not 45 confirmed vulnerabilities. |
| Runtime dependency advisories | FAIL / triage required | Scanner reports five entries representing three distinct advisories in three packages; duplicated entries were deduplicated for interpretation. |

## Reproduced test-suite failures and environment corrections

The focused `failure-triage` run recorded **4 failed, 3 passed, 3 skipped**. The four failures reproduce on both full-suite platforms where applicable, but they do not all represent product defects:

- The project-update concurrency test waits for a client-row lock while submitting the *unchanged* client ID. The service now removes unchanged fields before validation and does not acquire that client lock. The test therefore never reaches its intended demotion scenario. This is an obsolete race setup, not proof that a demoted actor completed a write.
- The task-comment mention fixture passes a `SimpleNamespace` with only ID/title; current tenant checks require the task's project or creator. It fails with missing `project` before testing chat delivery.
- The notification-preferences assertion expects six modules; the current API defines nine. This fails for both databases before the duplicate-input and account-isolation assertions run. Those remaining assertions are not certified by that test result.

The production-default-key test initially hit the audit runner's explicit non-default synthetic keys. After restoring the default synthetic settings used by that test, the rejection check passed. The owned-Redis restart test also passed when its command-array environment value was supplied without PowerShell quote loss. The corrected Linux focused run passed both cases. The Linux run could not regenerate Grafana files in a read-only source mount; the same check passed in the full Windows run.

Two lifecycle revision tests initially failed because the temporary working directory lacked the `app` import path expected by the revision. Adding both the repository root and `backend` to the test subprocess's PYTHONPATH resolved both (two passed). This does **not** resolve the independent empty-database Alembic failure.

The Windows full run also encountered that import-path issue in the concurrent empty-history downgrade test. The final Windows retry passed both that PostgreSQL race check and the default-signing-key check; its SQLite race variant was correctly skipped. After the focused environment corrections, the four reproducible stale-test failures described above remain. The six audit-only security failures remain separate, confirmed failures.

Of the Linux suite's 32 skips, 24 are dialect-specific variants with PostgreSQL counterparts. Six guarded smoke cases and the PostgreSQL dump/restore case passed in the dedicated Windows run; Docker Compose validation was also exercised on Windows. The full-run summaries are not rewritten to pretend those later reruns were part of the original run.

These results are preserved rather than hidden by weakening assertions or marking failing cases as expected failures.

## Live schema and dependency observations

The running PostgreSQL version is 16.15. There are 101 application tables against 103 ORM tables, no missing columns in tables that exist, and no `alembic_version` table. The missing tables are `realtime_aggregates` and `realtime_outbox`; the corresponding optional outbox feature is disabled. This is a legacy schema, not proof of a successful migration to the current Alembic head. Schema bootstrapping is disabled in the running configuration.

Dependency advisories were checked against the packages actually installed in the runtime image:

- `python-jose 3.5.0`: algorithm confusion with DER-encoded public keys when algorithms are not restricted. Current token decoding explicitly restricts the algorithm and the running configuration uses HS256. That reduces the described exposure; it does not erase the package advisory. [Upstream report](https://github.com/mpdavis/python-jose/issues/414).
- `ecdsa 0.19.2`: timing side channel during signing/key generation; verification is unaffected according to the advisory. The application configuration observed here uses HS256. [Maintainer advisory](https://github.com/tlsfuzzer/python-ecdsa/security/advisories/GHSA-wj6h-64fc-37mp).
- `setuptools 79.0.1`: Unicode filename exclusion bypass when building source distributions on affected filesystems; the scanner identifies 83.0.0 as fixed. This is principally a packaging issue for the described environment. [Maintainer advisory](https://github.com/pypa/setuptools/security/advisories/GHSA-h35f-9h28-mq5c).

Bandit's high-severity SHA1 finding is a task-list cache-key fingerprint (`routers/tasks.py`), not password or token signing. Several SQL-injection alerts concern internal schema identifiers; the Supabase alert is an exception message, not SQL execution. These scanner labels do not replace the demonstrated access-control findings above.

## Evidence and reproducibility

- `checks/run_suite.py`: explicit synthetic configuration, disposable working directories, test-service URLs, logs, JUnit, and coverage.
- `checks/live-smoke.json`, `live-schema.json`, `live-openapi.json`, `runtime-flags.json`, and `source-runtime-drift.json`: live non-secret observations.
- `checks/test_tenant_scope_probe.py`: audit-only assertions which intentionally fail while the documented authorization defects remain.
- `checks/alembic-fresh.txt`: clean PostgreSQL migration failure.
- `checks/ruff.json`, `ruff-runtime-final.json`, `bandit.json`, `pip-audit.json`: raw static/dependency findings.
- `checks/Dockerfile.audit`: adds test tools to the existing Python 3.11 runtime image; the application services are not replaced.

Coverage is weakest in ticket approvals/timeline (about 13%), tool-library routes (17.5%), external MinIO media (18.2%), and data-admin/log routes (about 22–23%). The separate security probes are outside the full-run coverage measurement. Existing legacy tests also clear the PostgreSQL search-vector computed expression while collecting SQLite fixtures; these runs are not certification of the complete production-generated-column schema.

Production Compose currently references PostgreSQL 15, while the running local system and this audit use PostgreSQL 16. The production database version, VPS networking, external providers, OS package vulnerabilities, and sustained production capacity were not certified. The production backend/presence services also have no Docker healthcheck declarations; their local HTTP health endpoints were verified directly.

Raw totals, timings, coverage, and failure identifiers are also available in `checks/results-summary.json`. Several initial runs were corrected for isolated-runner setup issues; their original logs remain as evidence. The first Linux attempt was restarted with disposable files in tmpfs after disk I/O waits, and only `full-linux-final` is used for its full-suite totals.

Cleanup completed: both audit runner containers, the disposable PostgreSQL/Redis containers, their test network/volumes, and the temporary audit image were removed. The five existing application services remain running. Source edits are limited to the two one-line runtime fixes, the new regression test file, and this audit evidence directory; unrelated frontend work was preserved. No application deployment, application schema migration, commit, or push was performed.

Passing checks cannot establish complete endpoint coverage, production capacity, external delivery, or a production deployment result. The confirmed registration and tenant-isolation failures keep the overall result at **FAIL** regardless of the number of passing regressions.
