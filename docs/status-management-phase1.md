# Phase 1 Status Management — implementation and verification

Target checkout: `F:\Projects\ideashop-zeaplay-v5`. This checkout uses React/Vite/TypeScript, FastAPI, SQLAlchemy and Alembic. It is the existing `frontend/` + `backend/` application, despite the V2 name in the implementation brief.

## Identity and compatibility

| Protected code | Existing task enum / database value |
| --- | --- |
| BATTLE_PLAN | WAITING_FOR_REQUIREMENT |
| IN_PROGRESS | IN_PROGRESS |
| ON_HOLD | ON_HOLD |
| CONQUERED | DONE |

The seven other built-in enum statuses remain protected as well. Existing task IDs, enum values, task groups, project links, histories, reporting categories and automation mappings are retained. Display labels do not determine business behavior.

Custom statuses use `Task.custom_status_id` alongside the existing `IN_PROGRESS` enum. They use the existing active-work overdue and points rules. Conquered/DONE and Deployed completion still pass through the existing completion checks and idempotent reward service. Changing a task to another canonical status clears its custom association in both ORM and SQL paths.

Legacy `/kanban-columns` routes remain available and now operate within the authenticated tenant. Previously stored custom column IDs are retained as tenant-specific aliases; responses also expose the resolved `custom_status_id`. New task creation, task detail editing, Kanban grouping/filtering and assignee copies use the resolved identity. Settings are under Settings → Sidebar Management → Status Management.

## Security and writes

- Only active owners/admins can change configuration. The navigation policy also gates the management API. Managers/users cannot gain authority through a client payload.
- Scope comes from the authenticated user, never a submitted tenant. Task ownership uses the existing project-tenant / creator-tenant predicate.
- Codes, IDs, tenant ownership, built-in names, system flags and legacy mappings are protected. SQL guards additionally prevent deletion/deactivation of system statuses and PostgreSQL workflow truncation.
- Names/labels use Unicode NFKC normalization, whitespace normalization and case folding for duplicate detection, including cross name/label/code collisions. Empty/control-character names and invalid colors/icons are rejected.
- Configuration writes and custom assignment take a tenant workflow lock. Revision checks reject stale configuration saves. Name swaps are staged inside the same transaction. No-op saves do not manufacture revisions/audits.
- Referenced custom statuses cannot be deleted or archived directly. Removal requires the reviewed task count, typed display label, and an allowed destination. Reassignment, audit and removal commit together. Allowed destinations are In Progress or active custom statuses; bulk removal cannot bypass completion rewards/approval checks.
- Configuration audit records are tenant-scoped and append-only, with actor and before/after snapshots. Removal retains the reassigned task IDs. Custom task moves append separate lifecycle events with historical label/code snapshots; canonical lifecycle events and analytics retain their existing meaning.
- Controls have accessible names, keyboard ordering alternatives and live announcements; the table is keyboard-scrollable on small screens. The removal dialog has a title/description and explicit confirmation. The system tooltip works on focus and hover and wraps within the viewport.

## Migration and rollout

Revision: `f006d7e8f9a0`, parent `fff5c6d7e8f9`.

The migration adds workflow scope, status configuration and audit tables, plus a nullable indexed custom-status reference on tasks. It seeds existing user tenants from legacy Kanban labels/order and retains custom-column aliases. It does not rewrite existing tasks or lifecycle history. It validates legacy labels before any DDL or data changes. Conflicting/invalid labels stop the migration for review. Newly encountered tenants are provisioned transactionally.

Run during a maintenance window, before starting this application version:

1. Take a full PostgreSQL custom-format dump using the existing deployment's connection settings. Validate the dump with `pg_restore --list` and restore it to a separate database before proceeding. Keep the previous application image/code available.
2. Check `alembic current` and `alembic heads` from the backend environment. Investigate unversioned/drifted databases; do not stamp or broadly upgrade them to conceal drift.
3. If the database is at the documented parent revision, run `alembic upgrade f006d7e8f9a0` using the deployment's configured database URL. No database URL or credentials are embedded here.
4. Start/rebuild the matching backend and frontend. Verify `/ready`, authenticated status reads, the four protected mappings, task counts and a scoped custom-status round trip. Existing enum status APIs must still return their original values.

Application rollback: restore the prior application version while retaining this additive schema, associations and audit history. Canonical task statuses remain usable by older code. A destructive Alembic downgrade is intentionally refused. To roll back the database itself, stop writers and restore the verified full backup in a reviewed maintenance procedure; account for any writes after the backup. Legacy logical task/CSV exports are not substitutes for this full database backup.

Migration execution in this work: disposable SQLite and PostgreSQL only. No persistent local application database, VPS database or production deployment was migrated.

## Files

- Backend models/schema: `backend/app/models.py`, `schemas.py`, `task_status_schema.py`.
- Backend behavior: `services/task_statuses.py`, `routers/task_statuses.py`, `routers/kanban.py`, `routers/tasks.py`, `navigation_registry.py`, `main.py`.
- Migration: `backend/alembic/versions/f006d7e8f9a0_task_status_management.py`.
- UI/integration: `frontend/components/StatusManagement.tsx`, `CreateTaskModal.tsx`, `TaskDetailModal.tsx`, `TaskJourneyModal.tsx`, `frontend/pages/SidebarManagement.tsx`, `KanbanBoard.tsx`, `frontend/services/mockApi.ts`, `frontend/types.ts`.
- Verification: `backend/tests/test_task_status_management.py`, `backend/tests/test_task_lifecycle.py`, `frontend/e2e/status-management.playwright.js`. The existing lifecycle migration fixture removes newer custom-history triggers before emulating its older schema; the frozen lifecycle migration is unchanged.

## Verification

The accompanying tests cover real JWT authorization, tenant boundaries, immutable properties, duplicates, transactions, revision conflicts/concurrent saves, referenced-status removal, reward idempotency, report categories/overdue counts, normalized automation payloads, lifecycle snapshots, legacy API aliases and migrations from a legacy-shaped database. Browser tests use the actual Settings UI with synthetic APIs; backend authorization is verified separately with real API/database integration tests.

Results on 2026-11-05:

| Check | Result |
| --- | --- |
| Status API/database/migration tests, SQLite + PostgreSQL | PASS: 46 cases |
| Status + existing lifecycle tests | PASS: 82 distinct cases after the migration-fixture correction and its two-engine retry; 1 intentional SQLite skip for PostgreSQL repeatable-read semantics |
| Existing lifecycle/navigation/gamification regression run | 197 passed, 1 skipped; 2 SQLite setup errors caused by C: disk exhaustion. The affected tests and PostgreSQL counterparts were rerun using F: scratch storage: 4 passed. |
| Frontend journey/settings/navigation unit tests | PASS: 32 |
| Settings browser checks, actual UI with synthetic APIs | PASS: 17, including desktop/mobile and keyboard accessibility |
| Production frontend build | PASS; existing bundle-size/eval warnings remain |
| TypeScript versus unchanged HEAD baseline | 116 diagnostics in each; no added diagnostics |
| Python compile and `git diff --check` | PASS |

Runtime task/report/automation tests verify unchanged canonical enums, overdue categorization, completion guards, reward idempotency and immutable history snapshots. Migration tests compare existing task rows and history before/after and verify that invalid legacy labels fail before schema mutation. Browser screenshots are in `artifacts/status-management-desktop.png` and `artifacts/status-management-mobile.png`.

Remaining rollout work: run the reviewed migration and deployment procedure against the intended installation. Persistent application/production migration and deployment were not performed. The unrelated baseline TypeScript diagnostics prevent claiming a clean project-wide type check. This verification does not claim full-project release certification.
