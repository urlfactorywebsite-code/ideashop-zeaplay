# Status Management production-readiness review

Review date: 2026-11-05. Checkout: `F:\Projects\ideashop-zeaplay-v5`.
Architecture verified from source: React/Vite/TypeScript, FastAPI, SQLAlchemy and
Alembic. This is the `frontend/` + `backend/` checkout, despite the V2 feature name.

**Release decision: NO-GO for production deployment.** The scoped implementation
passes its automated regressions after the fixes below. A clean release gate is
blocked by the running local API's database readiness failure, the repository's
legacy baseline migration requirement, the existing TypeScript errors, and the
absence of a migration rehearsal against the actual target's restored backup.
No shared application/production database was migrated, repaired or stamped.

## Defects fixed in this review

| Finding | Change and evidence |
| --- | --- |
| Different tasks could overwrite a shared assignee's points/completion counter using stale ORM User instances | Scorers lock account rows in stable ID order and refresh balances before applying existing awards/penalties. Deterministic stale-session and real concurrent callbacks pass on SQLite/PostgreSQL. |
| Completion safety depended partly on process-local mutexes, which also accumulated entries indefinitely | Task award markers now use transaction-owned database locks; SQLite takes its writer lock before reading markers. Independent Python processes with preloaded task state produce exactly one award on both engines. Per-task mutex registries were removed. |
| Badge progress could overwrite another task's progress or XP from a stale instance | Badge handling uses the shared account locks and refreshes existing progress rows before updating them. Two real events reach the existing two-completion badge exactly once. No badge rule or bonus policy was changed. |
| Subtask reopening could leave its parent DONE after another request completed it | The parent entity is refreshed while acquiring its row lock. The same existing parent completion/reopen engine now observes the committed status. |
| An empty custom column's behavior could change while a move/Hold prompt was open | Optional `configuration_revision` is validated under the scope lock. The board supplies the revision; an open Hold confirmation pins the reviewed revision. A conflict returns 409 without moving the task. Re-selecting the destination uses the new revision. Legacy clients omitting the field retain the existing API contract. |
| Cached Kanban cards/counts survived project-membership revocation | User/manager Kanban reads evaluate current grants instead of reading/writing a cached task snapshot. Owner/admin caching remains tenant/user/role/configuration scoped. Cache format is 5. Membership-revocation tests reproduced the leak before the fix and pass on both engines afterward. |
| Board/history/audit ordering lacked matching composite indexes | Additive migration `f339a0b1c2d3` creates three indexes. Actual PostgreSQL query plans use the board index. SQLite/PostgreSQL migration round trips retain task values and lifecycle rows. Conflicting pre-existing index definitions fail preflight. |
| Readiness could report healthy with missing/disabled status guards or incomplete indexes | `/ready` now checks required status columns, enabled capture/protection triggers and index definitions/validity. A new standalone read-only integrity gate reports data/schema anomalies without repairing or provisioning data. |

The first focused regressions reproduced the stale account/parent bugs and missing
revision/index coverage on both engines. A later membership-revocation regression
also failed on both engines before its cache fix. These failures were corrected;
final scoped automated suites pass.

## Review coverage

| Requested area | Result and limits |
| --- | --- |
| System immutability | PASS: BATTLE_PLAN maps to WAITING_FOR_REQUIREMENT; CONQUERED maps to DONE. IN_PROGRESS/ON_HOLD and all seven legacy enum stages retain their IDs/meanings. API whitelists plus database update/delete/archive/visibility/truncate guards protect registered systems. Labels/order/style remain presentation. |
| Migrations/backward compatibility | PASS for targeted Phase 1/2/3 upgrade/backfill fixtures, legacy mappings/history and the real f228-to-f339 CLI upgrade on both engines. FAIL for a completely empty PostgreSQL `alembic upgrade head`; see blockers below. |
| Hold deadlines/penalties | PASS: original due date is retained; closed plus ongoing authorized hold time extends the effective deadline. Pre-hold overdue age is retained. Repeated holds produce one open interval; resume closes it. Completion scoring, task filters, calendar urgency and reporting use shared hold-aware calculations. No daily penalty scheduler was introduced; existing penalties apply on completion. |
| Conquered idempotency | PASS: server timestamps, permanent award markers, account counters and completion badges. Same-task concurrent retries, cross-process callbacks, two completion retries and reopen/re-complete retain a single award. |
| Custom behavior | PASS: new custom statuses default Active; Pending and Hold map to canonical services. Assigned behavior changes require reassignment. Custom Completed remains rejected pending deliberate policy approval. |
| Tenant isolation | PASS in actual JWT/API/SQL tests: configuration, counts, moves, hold history and reassignment remain tenant scoped. Foreign-tenant task moves fail. Raw SQL custom/hold tenant guards are tested. Production data contents were not inspected. |
| RBAC/input validation | PASS: owner/admin status management, existing navigation restrictions, active-user/JWT tenant checks, task ownership/assignment/project permissions, protected attributes and reason validation. Restricted cached visibility revocation is now covered. |
| Concurrent movements | PASS: shared configuration/task locks, coherent count/card/revision snapshot, referenced-status protection, pending-source-card retention, stale configuration rejection and shared XP account serialization. |
| Reporting/achievements/automations | PASS: current-state reporting native categories/hold-aware overdue calculations, existing XP/achievement/badge regressions and canonical API automation payloads. External automation/email/push delivery was intentionally suppressed in fixtures and was not certified. |
| Projects/subtasks | PASS: existing project-dashboard, evidence/approval, dependency/handoff, auto-completion/reopening and explicit Hold-with-completed-children regressions. |
| UI/accessibility | PASS for tested desktop/compact views, keyboard move/reorder/filter controls, pointer dragging, focus/Escape tooltips, long labels, preview updates, empty/error/loading states, unsaved/conflict drafts and inactive/hidden/unmapped task recovery. No redesign was introduced. This is interaction coverage, not a complete WCAG certification. |
| API performance/indexing | PASS for bounded query/population checks and PostgreSQL/SQLite index-plan probes. 50 empty columns add no task queries. A synthetic 2,001-task board took about 25 ms on SQLite and 35 ms on PostgreSQL in the focused run; the indexed PostgreSQL 20-row query executed in about 0.073 ms. These are local fixture measurements, not production SLOs or a load test. |

## Executed checks

| Command/suite | Final result |
| --- | --- |
| `pytest test_core_status_business_rules.py test_task_status_management.py test_kanban_customization.py test_task_lifecycle.py test_subtask_handoff_regression.py` | PASS: 158; one SQLite skip for PostgreSQL-only snapshot behavior |
| `pytest test_status_production_readiness.py test_kanban_customization.py` after final cache fix | PASS: 48; includes 24 new readiness cases and 24 already-counted Kanban cases |
| Index definition drift/preflight follow-up | PASS: 2; already counted in the 24 readiness cases |
| `pytest test_tasks_phase11.py test_gamification_phase12.py` | PASS: 17 |
| `pytest test_reporting_inventory.py test_reporting_index.py test_reporting_frontend_contract.py` | PASS: 43; one SQLite skip for PostgreSQL planner evidence |
| Frontend status/deadline/points/Settings/navigation/journey/subtask/report units | PASS: 59 |
| `status-management.playwright.js` | PASS: 33 browser checks |
| `kanban-customization.playwright.js` | PASS: 29 browser checks |
| `core-status-business-rules.playwright.js` | PASS: 24 browser checks, including revision changes during a Hold prompt |
| `core-status-live.playwright.js` | PASS: 22 checks through actual HTTP adapters, JWT authentication, FastAPI and disposable SQL persistence |
| Production frontend build | PASS; existing large-chunk/third-party eval warnings remain |
| Full project TypeScript vs unchanged HEAD baseline | FAIL baseline: 116 errors in each, zero added/removed diagnostics |
| Python syntax, `git diff --check`, Alembic heads | PASS; sole new head is `f339a0b1c2d3` |
| Completely fresh PostgreSQL `alembic upgrade head` | FAIL in legacy revision `8f4b2c6a1d3e`: `users` table absent |
| Existing local API `http://127.0.0.1:6311/ready` | FAIL: HTTP 503, `database:false`, `realtime:true` |
| Actual production backup restore/migration, packaged runtime and external delivery | NOT RUN |

Distinct totals, excluding overlapping reruns: **242 backend tests passed with two
engine-specific skips; 59 frontend unit tests; 108 browser checks**. Browser tests
use synthetic records/session/navigation shells. The live suite sends actual
task/status requests through the real backend and database. Network asset/WebSocket
failures caused by test isolation are not claims of deployed asset validation.

Evidence logs are under `.tmp/readiness-*.txt`; browser screenshots are under
`artifacts/`. PostgreSQL used the task-owned loopback server on port 57440 and
disposable `rt3_test` schemas. The blank migration probe used its own disposable
database. No Docker daemon or unrelated service was restarted.

## New migration and integrity gate

`backend/alembic/versions/f339a0b1c2d3_status_query_indexes.py` follows
`f228f9a0b1c2`. It creates:

- `ix_tasks_status_custom_updated_id`: status, custom_status_id, updated_at DESC, id.
- `ix_status_audit_tenant_created_id`: tenant_id, created_at DESC, id.
- `ix_task_hold_task_started_id`: task_id, started_at, id.

The migration validates existing names/column definitions before DDL. Repeated
upgrade is safe for correct existing indexes. It changes no task/status/hold/history
rows. Downgrade removes only these indexes. The Phase 3 migration's destructive
downgrade refusal remains in place. Earlier migrations and frozen database guards
were not rewritten. Ordinary index creation takes locks; schedule this migration
with writers paused and rehearse its duration against a restored production-sized
database. This review does not claim an online/zero-downtime index rollout.

`backend/scripts/check_status_integrity.py` requires `VEE_BOOTSTRAP_SCHEMA=false`
before importing application database code. PostgreSQL runs it in a repeatable-read,
read-only transaction; SQLite uses query-only mode. It reports codes/counts without
task descriptions, credentials or repairs, and exits nonzero for schema/revision/
data errors. It checks:

- Core identity set, activation/visibility, normalized/ambiguous values and scope ownership.
- Custom task references, native behavior/tenant/active mappings and foreign assignees.
- Hold summaries versus the ledger, open/orphan holds, overlaps and hold tenancy.
- Award marker consistency and legacy completion timestamp warnings.
- Required columns, enabled status/lifecycle protection/capture guards, composite
  index definitions, the partial unique open-hold index and PostgreSQL index validity.
- The expected deployment revision `f339a0b1c2d3`.

The real upgrade CLI and this gate passed on known disposable Phase 3 fixtures for
both engines. Deliberate summary corruption, disabled guards and incorrectly defined
indexes are detected. Warnings about legacy unknown completion timestamps require
review; they do not authorize fabricating completion times or reward history.

## Production blockers and policy decisions

1. **Running local database readiness fails.** Its OpenAPI exposes Status Management
   but lacks the new optional move-revision field. The running installation has not
   been validated against this checkout/build and the required schema. It must be
   reconciled through the deployment process before serving traffic with this code.
2. **The legacy migration chain assumes an existing base schema.** A fresh PostgreSQL
   run reaches `ALTER TABLE users ADD COLUMN tenant_id UUID` before any migration
   creates `users`. The existing repository audit records this same limitation in
   `docs/backend-audit-2026-10-21/README.md`. No unreviewed baseline stamp or unrelated
   historical migration rewrite was performed.
3. **116 existing TypeScript diagnostics remain.** Their remediation is outside this
   status/scoring review. A clean full-application type-check/release gate is not claimed.
4. **Target data and deployment remain unverified.** Rehearse from a verified full
   backup and run the integrity gate on the actual target before promotion. Logical
   task/CSV exports are not sufficient for protected status/hold/history rollback.
5. **Policy decisions remain explicit:** existing reopen behavior retains prior points
   and permanent award markers; changing reversal/re-award policy needs approval.
   Custom Completed mappings remain disabled. Pre-migration hold credit needs reviewed
   evidence; migration cutover is not a guessed historical start. Timer controls and
   tracked-time history remain unchanged.
6. **Performance scope:** restricted viewers now query current grants for every board
   read. Benchmark realistic tenant/project/subtask populations and request concurrency
   in staging. Per-tenant configuration/assignment locking remains intentionally conservative.

## Deployment instructions

1. Prepare a concrete reviewed release containing the status/scoring changes and
   migration. This checkout already contained other dirty work; nothing was committed
   or deployed by this review. Use the target's existing deployment configuration;
   do not substitute the disposable test URL or fixture servers.
2. Stop writers/workers/automations in a maintenance window. Take a full database and
   required private-media backup, then restore it into an isolated staging environment.
   Record the actual schema, database version, role privileges and migration revision.
3. Reconcile any unversioned/bootstrap schema through the existing reviewed baseline
   runbook. Do not run the empty-database migration path, stamp at head, or conceal drift.
   For an established versioned target, confirm the reviewed parent and rehearse every
   pending revision on the restored backup.
4. With the intended database configuration, run from `backend`:

   ```powershell
   $env:VEE_BOOTSTRAP_SCHEMA='false'
   venv/Scripts/python.exe -m alembic current
   venv/Scripts/python.exe -m alembic heads
   # From the verified Phase 3 parent, after a successful staging rehearsal:
   venv/Scripts/python.exe -m alembic upgrade f339a0b1c2d3
   venv/Scripts/python.exe scripts/check_status_integrity.py
   ```

   Linux uses the deployment virtualenv's Python executable. Apply Phase 1/2/3 first
   only when their actual prerequisites and restored-data tests have been reviewed.
   Use a migration owner for DDL and a separate least-privilege runtime role; runtime
   credentials should not be able to disable/drop database guards.
5. Treat any nonzero integrity result as a stop condition. Review warnings and compare
   task/history/hold/audit counts with the backup. Resolve anomalies with an explicit
   data-repair plan rather than deleting history or rewriting IDs.
6. Build matching backend/frontend artifacts and verify their packaged runtime in
   staging. `/ready` must return 200 with both database and realtime healthy. Verify
   owner/admin management, denied user/foreign-tenant writes, renamed/reordered columns,
   hidden-task recovery, required Hold reason, resume/deadline math, exactly-once
   completion, project/subtask approvals and the existing reports/automation consumer.
7. Promote only after the outstanding release gates are satisfied. Monitor API latency,
   database locks, task/configuration conflicts, failed integrity/readiness checks and
   notification/realtime queues before restoring full traffic.
8. Rollback: f339 can drop its three indexes without losing data, but current readiness
   will reject missing indexes. Prefer a compatible forward fix or prior compatible
   application with the additive schema retained. Do not downgrade/delete Phase 3 hold
   history or resume old deadline/scoring code after holds accrued. A database rollback
   requires stopped writers, a verified full restore and reconciliation of later writes.

## Files affected by this review

| Files | Purpose |
| --- | --- |
| `backend/app/services/scoring_users.py` (new), `gamification.py`, `badge_engine.py`, `task_transitions.py` | Transaction-owned award/account locking and refreshed badge progress |
| `backend/app/services/subtask_workflow.py` | Refresh parent state under its lock |
| `backend/app/services/task_statuses.py` | Refresh the locked configuration revision |
| `backend/app/routers/tasks.py`, `schemas.py` | Optional revision validation; authority-safe restricted Kanban reads |
| `backend/app/models.py`, `backend/alembic/versions/f339a0b1c2d3_status_query_indexes.py` (new) | Matching composite indexes and guarded migration |
| `backend/app/services/status_integrity.py` (new), `backend/scripts/check_status_integrity.py` (new), `backend/app/main.py` | Read-only integrity gate and schema-aware readiness |
| `frontend/pages/KanbanBoard.tsx`, `frontend/services/mockApi.ts` | Revision-aware moves and pinned Hold confirmations |
| `backend/tests/test_status_production_readiness.py` (new), `test_kanban_customization.py` | Race, revocation, integrity, migration, multi-process and index-plan regression |
| `frontend/e2e/core-status-business-rules.playwright.js`, `kanban-customization.playwright.js` | Configuration-revision browser checks |
| This report and `docs/status-management-phase3.md` | Evidence, blockers and deployment/rollback instructions |

Existing Phase 1/2/3 changes remain in the workspace. Their file inventories and
historical results remain in the phase reports; the results above are this review's
current verification, not a claim that unrelated application work is release-ready.
