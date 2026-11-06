# Owner-only status controls

Status Management writes now require the authenticated tenant's **owner**. Administrators retain read access; manager/user access is unchanged. Both the status API and legacy `/kanban-columns` write routes enforce the restriction. UI controls also require the owner role and server-provided permission.

The seven optional legacy statuses (Case Filed, Bug Fixing, Boss Encounter, Tactical Shift, Deployed, Fallen and Graveyard) support owner-managed labels, description, color, icon, order, Hide/Show, confirmed Deactivate, and Reactivate. Their IDs, enum mappings, internal names and scoring behavior remain immutable. The four core statuses (Battle Plan, In Progress, On Hold and Conquered) remain active and visible. Custom status create/edit/archive/delete/reassignment also becomes owner-only.

Deactivation checks configuration revision, typed label confirmation and the current tenant's task count under workflow and native-status row locks. It sets activation and Kanban visibility off **without moving or deleting tasks**. Existing tasks retain their status, history, completion timestamps, rewards and subtask references. They remain in All Tasks and the Kanban outside-column list with correct counts and pagination. Tasks can move out; new assignments into an inactive status are rejected by the task APIs and database guards. Ordinary edits to existing inactive-status tasks still work. Hide alone only changes board visibility. Every change is audited and invalidates tenant task caches.

## Files

- Backend: `app/services/task_statuses.py`, `task_transitions.py`, `status_integrity.py`; `app/routers/tasks.py`, `kanban.py`; `app/models.py`; new `app/status_owner_schema_v4.py`.
- Migration: `alembic/versions/f44ab1c2d3e4_owner_status_controls.py`.
- Schema tools: `scripts/apply_status_schema.py` includes the new revision for its existing empty-schema recovery path; `scripts/check_status_integrity.py` expects the new head. Existing partial-recovery scripts are not an upgrade path for an already-populated schema.
- Frontend: `components/StatusManagement.tsx`, `KanbanPreview.tsx`, `utils/kanbanConfiguration.ts`.
- Tests: new `backend/tests/test_owner_status_controls.py`; updated concurrent-owner test, production-readiness CLI migration target, frontend visibility tests and Settings/Kanban browser scenarios.

## Migration and deployment

No application database was migrated as part of this source change. Tests use disposable databases only. Existing unrelated changes to the VPS repair documentation and shell wrapper were preserved.

1. Take and restore-test a full database backup. Stop application writers and workers for the migration/build switch.
2. With `VEE_BOOTSTRAP_SCHEMA=false`, verify the target's actual schema and Alembic history. For an already-reviewed versioned installation at `f339a0b1c2d3`, run from `backend/`:

   ```sh
   alembic upgrade f44ab1c2d3e4
   python scripts/check_status_integrity.py
   ```

   Unversioned or partially migrated installations need a reviewed baseline procedure first. Do not stamp an unverified schema or run the full historical chain blindly.
3. The new migration narrows the activation check to the four core codes, replaces activation/visibility guards, and adds a tenant-scoped native assignment guard. It changes no task/status/history rows, enums or IDs and adds no indexes. PostgreSQL DDL is transactional. Deploy backend and frontend together, restart workers, require `/ready` success, then verify owner and admin sessions.
4. SQLite is supported for offline migration/testing only: disable foreign keys on the dedicated connection **before starting the transaction**. The migration preserves and reinstalls triggers around the required table rebuild and runs `foreign_key_check`. It refuses a rebuild with FK enforcement enabled. Re-enable FK enforcement after committing and before normal use.
5. Before rolling back, the owner must reactivate and show every optional legacy status. Otherwise downgrade refuses before making changes. Then run `alembic downgrade f339a0b1c2d3` with writers stopped and restore the previous application build. Downgrade restores previous guards/constraint without deleting records. A full backup remains the fallback.

## Verification

Browser tests use the actual Settings and Kanban components with synthetic HTTP fixtures; backend integration tests use actual JWT authentication, authorization, SQL guards and transactions on isolated SQLite/PostgreSQL databases. No production data is used in previews or browser fixtures.

| Check | Result |
| --- | --- |
| Full status, Kanban, scoring, lifecycle and subtask backend regression | PASS after targeted reruns: 222 unique cases and one engine-specific skip; initial run had 220 passes and two CLI cases targeting the previous migration head, both corrected and rerun successfully |
| Additional concurrent/direct-SQL assignment checks | PASS: 7, one PostgreSQL-only case skipped on SQLite |
| Final native-status row locking check, including direct database writers | PASS: 3, one PostgreSQL-only case skipped on SQLite; adds one unique passing PostgreSQL case and one SQLite skip to the broad run |
| Enhanced upgrade/downgrade with assigned custom tasks and retained histories/audits | PASS: 2, SQLite and PostgreSQL |
| Actual Alembic CLI upgrade to the new head and read-only integrity script | PASS: 2, SQLite and PostgreSQL |
| Frontend unit suite | PASS: 150 |
| Settings browser regression, including owner-only hide/deactivate/reactivate, admin restrictions, typed confirmation, persistence, preview and accessibility | PASS: 45 checks |
| Kanban browser regression | PASS: 29 checks |
| Production frontend build | PASS; existing chunk-size/eval warnings |
| TypeScript | FAIL: existing 116 diagnostics; zero added/removed after path/line normalization, no diagnostics in changed UI files |
| Python compilation | PASS: 10 changed/new runtime and migration files |
| Alembic head | PASS: single head `f44ab1c2d3e4` |

Evidence is in ignored `.tmp/owner-status-*` logs. Production/target migration and deployment are **not run**. Automation or import jobs that request a newly deactivated legacy status must choose an active destination or wait for owner reactivation; the backend rejects the assignment. Full SQL database restores preserve historical inactive assignments by restoring data before guards. Existing project, subtask, hold, completion and scoring policies remain unchanged.

The backend evidence covers **223 unique passing cases and two engine-specific skips** across the broad run and targeted reruns. No unresolved backend test failures remain. The whole application cannot be declared type-check clean because of the unchanged 116-diagnostic baseline.
