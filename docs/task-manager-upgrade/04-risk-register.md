# Task Manager Upgrade - Risk Register

Phase 1 scope: identified risks only. No mitigations have been implemented.

| ID | Risk | Evidence | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Application startup mutates schema and seed data outside Alembic. | `app.main` and `app.database` contain schema ensure functions, `Base.metadata.create_all`, seed calls, and enum/status normalization. | Alembic migrations can drift from production schema; startup may modify production unexpectedly. | Freeze this pattern for the upgrade. New schema must be Alembic-only. Add startup mutation audit before release. |
| R2 | Global tasks are not tenant-scoped. | `tasks` lacks `tenant_id`; task access logic is role/relationship based. | Cross-tenant task visibility or linking is possible. | Add nullable `tasks.tenant_id`, backfill safely, and enforce tenant filters before project/task expansion. |
| R3 | Task XP can be awarded before approval. | `complete_task` awards XP while setting approval status to pending. `approve_task` does not award or revoke XP. | Configurable approval may conflict with existing point totals and rejection behavior. | Define explicit XP timing. Add idempotent award ledger before changing approval semantics. |
| R4 | Backend tests fail during collection on SQLite. | `to_tsvector` generated column is applied to SQLite test database. | Current backend test baseline cannot certify changes. | Add database-specific search-vector handling or PostgreSQL-backed tests. |
| R5 | Two task systems exist. | Global `tasks` and ticket-specific `ticket_tasks` both model work and completion. | Duplicate behavior, inconsistent XP, and confusing APIs. | Make global `tasks` canonical for the task manager. Bridge ticket tasks deliberately. |
| R6 | Task attachments are unstructured JSON. | `tasks.attachments` stores JSON while tickets/media have normalized file records. | Completion evidence can become hard to audit and permission-check. | Add normalized evidence table and reuse existing upload conventions. |
| R7 | Production seeding is coupled to app startup. | `seed_database()` and badge seeding run from startup path. | Startup may alter production state outside migration/change control. | Separate seed execution from normal app boot before production upgrade work. |
| R8 | Frontend TypeScript baseline fails. | `npx tsc --noEmit` reports existing type errors across task, ticket, chat, seed, and component files. | New UI work may hide real regressions among existing failures. | Establish a focused compatibility test/type baseline or fix existing errors in a stabilization phase. |
| R9 | Production compose may reference missing or unverifiable modules in this checkout. | `docker-compose.prod.yml` references gunicorn config and worker modules not confirmed in the inspected app tree. | Deployment may fail independently of task-manager changes. | Verify production image context and module presence before rollout. |
| R10 | Secrets-like defaults exist in source config. | MinIO access/secret defaults are present in `backend/app/config.py`. | Credential leakage or unsafe defaults. | Require env-provided secrets and audit default settings before production deployment. |
| R11 | No frontend lint script is configured. | `npm run lint` fails because the script is missing. | Lint cannot be used as a baseline gate. | Add lint configuration only in a dedicated stabilization phase. |
| R12 | Existing frontend local metadata may diverge from backend. | Task-related frontend code stores user-specific state such as reactions/read/dismissed task IDs locally. | New backend task workflow state could be duplicated in local storage. | Classify UI-only local state versus authoritative backend workflow state. |
| R13 | Repository root is not a Git repository. | `git status` fails at `F:\Projects\ideashop-zeaplay-v5`. | Change tracking and review boundaries are weaker. | Confirm intended repo root before implementation phases. |
| R14 | No normalized clients, contacts, or projects exist. | Only `users.projects` JSON/list was found. | Requirements need new core schema and permission model. | Add normalized tenant-scoped tables additively. |
| R15 | Task create and update approval capabilities differ. | Create schema and flow do not fully mirror update-time approval fields. | Approval configuration at creation may silently not persist. | Add compatibility tests and schema alignment before new approval UX. |
| R16 | Duplicate XP award risk exists on status churn. | Completion award logic is tied to status transition and has no global task award ledger. | Reopen/recomplete paths can award unexpectedly. | Add idempotent ledger before expanding completion states. |
| R17 | Raw SQL migrations exist outside Alembic. | `backend/migrations/*.sql` and `backend/sql/*.sql`. | Environments may have inconsistent index/table state. | Inventory raw SQL application state before production migration. |
| R18 | SQLite and PostgreSQL feature differences are already visible. | PostgreSQL full-text search SQL fails under SQLite tests. | Local certification may not match production. | Use database-appropriate DDL and run PostgreSQL verification before release. |
| R19 | Configured Alembic database revision is missing from this checkout. | `alembic current` fails with missing revision `7g8h9i0j1k2l`; source head is `9c8d7e6f5a4b`. | New migrations cannot be safely ordered or applied to that database. | Reconcile migration history or establish a deliberate baseline before Phase 2. |
| R20 | Backend `.env` contains remote database and storage credentials. | Alembic read the configured PostgreSQL URL from `backend/.env`; storage/VAPID-style settings are also present. | Local commands can unintentionally target remote infrastructure. | Require explicit local/staging env selection for all migration and test commands. |
| R21 | Browser-only task documentation overlaps with future evidence. | `TaskDocumentation` persists docs and reactions in `localStorage`. | Users may expect local notes/reactions to become official evidence. | Treat local task docs as UI-only unless migrated through a planned backend model. |

## Highest Priority Compatibility Risks

1. Tenant isolation on tasks and rewards.
2. Approval and XP timing.
3. Canonical task model decision.
4. Backend test collection failure.
5. Startup schema/data mutation.
6. Alembic revision mismatch on the configured database.

## Required Decisions Before Phase 2

1. Confirm whether global `tasks` is the canonical upgraded task manager model.
2. Confirm source of truth for backfilling `tasks.tenant_id`.
3. Decide whether XP should be awarded on completion submission or final approval for approval-required work.
4. Confirm whether projects can link to one client or multiple clients.
5. Confirm whether subtask approval is required per subtask, per task, per project, or all three.
6. Confirm whether email notifications are required immediately or after in-app notification coverage.
7. Confirm the intended database target for migration planning and resolve the missing Alembic revision before any Phase 2 work.
