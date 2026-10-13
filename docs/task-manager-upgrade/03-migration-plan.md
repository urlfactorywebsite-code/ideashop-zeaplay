# Task Manager Upgrade - Migration Plan

Phase 1 scope: additive migration strategy only. No migration has been created or run.

## Migration Rules

- Do not modify production data during planning.
- Do not use destructive migrations.
- Do not drop or rename existing columns or tables.
- Do not change existing enum values in place without compatibility handling.
- Do not make new production schema through FastAPI startup code.
- Use Alembic for all production schema changes.
- Keep migrations reversible where practical, but prefer forward-compatible disabling over destructive rollback.
- Add nullable columns first, backfill second, validate third, enforce constraints last.

## Preflight Checks Before Phase 2 Or Any Migration

Run against the target environment:

1. Confirm database type and URL source.
2. Confirm Alembic current revision and head.
3. Confirm row counts for users, tasks, subtasks, tickets, rewards, reward claims, notifications, and media tables.
4. Detect tasks without creator, assignee, or ticket tenant source.
5. Detect cross-tenant relationships through task assignee, creator, follower, and approver.
6. Detect legacy or unexpected task status values.
7. Detect duplicate task group behavior.
8. Detect reward claim states and negative point balances.
9. Confirm backup and restore procedure.
10. Run migration in a staging copy before production.

Phase 1 independent-review finding:

- `backend/.env` currently points `VEE_DATABASE_URL` at a remote PostgreSQL database.
- `alembic heads` reports source head `9c8d7e6f5a4b`.
- `alembic current` against the configured database fails with `Can't locate revision identified by '7g8h9i0j1k2l'`.
- the local SQLite file has no `alembic_version` table.

Implication:

- no Phase 2 migration should be authored or run until the intended target database, migration baseline, and missing revision history are reconciled.

## Current Migration History

Alembic head observed:

- `9c8d7e6f5a4b`

Configured database current revision:

- not verified as healthy. `alembic current` failed because the configured PostgreSQL database references missing revision `7g8h9i0j1k2l`.

Local SQLite migration state:

- no `alembic_version` table was present in `vee_task_manager.db`.

Notable migration areas:

- ticket system foundation.
- ticket workflow and approval additions.
- media and reporting additions.
- task search additions.
- task transfer requests.
- chat and performance indexes.

Additional raw SQL exists outside Alembic:

- push notification SQL.
- task followers SQL.
- task index SQL.
- performance index SQL.

Risk:

- application startup also mutates schema and seed data. This must be frozen for the task-manager upgrade instead of expanded.

## Recommended Additive Sequence

### Migration A - Tenant-Safe Foundation Columns

Add nullable ownership columns where needed:

- `tasks.tenant_id`
- possibly `rewards.tenant_id` in a later reward hardening migration.

Indexes:

- `tasks(tenant_id)`
- `tasks(tenant_id, status)`
- `tasks(tenant_id, assigned_to_id)`
- `tasks(tenant_id, created_by_id)`

Backfill strategy:

1. If task has linked ticket, use `tickets.tenant_id`.
2. Else use `tasks.created_by_id -> users.tenant_id`.
3. Else use `tasks.assigned_to_id -> users.tenant_id`.
4. Else mark for manual remediation.

Do not set `NOT NULL` until all production rows are verified.

### Migration B - Clients And Contacts

Create:

- `clients`
- `contacts`
- `client_contacts`

Constraints:

- primary keys by `id`.
- `tenant_id` required.
- foreign keys to users where owner/account manager fields are used.
- uniqueness should be tenant-scoped, not global.

Indexes:

- `clients(tenant_id, name)`
- `contacts(tenant_id, email)`
- `client_contacts(tenant_id, client_id, contact_id)`

### Migration C - Projects And Membership

Create:

- `projects`
- `project_managers`
- `project_members`
- optional `project_clients` if projects need many clients.

Indexes:

- `projects(tenant_id, status)`
- `projects(tenant_id, name)`
- `project_managers(tenant_id, project_id, user_id)`
- `project_members(tenant_id, project_id, user_id)`

Constraints:

- prevent duplicate manager/member rows.
- service layer must validate all linked users share the same tenant.

### Migration D - Project-Linked Tasks

Add:

- nullable `tasks.project_id`.

Indexes:

- `tasks(tenant_id, project_id)`
- `tasks(project_id, status)`

Backfill:

- do not infer from `users.projects` automatically without a reviewed mapping.
- allow tasks to remain projectless.

### Migration E - Subtask Workflow Expansion

Add nullable fields to `subtasks`:

- `tenant_id`
- `assigned_to_id`
- `order_index`
- `workflow_mode`
- `workflow_group`
- `activation_status`
- `activated_at`
- `force_started_by_id`
- `force_started_at`
- `started_at`
- `completed_at`
- `approval_required`
- `approval_status`
- `approver_id`

Create:

- `subtask_dependencies`

Indexes:

- `subtasks(tenant_id, task_id)`
- `subtasks(tenant_id, assigned_to_id)`
- `subtasks(task_id, order_index)`
- `subtask_dependencies(tenant_id, subtask_id, depends_on_subtask_id)`

Backfill:

- set `subtasks.tenant_id` from parent task tenant after task tenant backfill.
- leave workflow fields null for legacy behavior.

### Migration F - Timers

Create:

- `task_timer_sessions`
- `subtask_timer_sessions`

Indexes:

- active timer lookup by tenant/user/status.
- task/subtask timer history lookup.

Constraints:

- at most one active timer per user per scope should be enforced by service logic first; partial database indexes can be considered per database capability.

### Migration G - Completion Evidence

Create:

- `task_completion_evidence`

Indexes:

- `task_completion_evidence(tenant_id, task_id)`
- `task_completion_evidence(tenant_id, subtask_id)`
- `task_completion_evidence(tenant_id, submitted_by_id)`

Storage strategy:

- reuse existing presign/confirm conventions.
- store structured metadata rather than extending task attachment JSON.

### Migration H - Approval Policy And Requests

Create:

- `task_approval_policies`
- `task_approval_steps`
- `task_approval_requests`

Indexes:

- policy lookup by tenant/project/task/subtask.
- request lookup by tenant/approver/status.

Compatibility bridge:

- existing task approval fields remain.
- new services can derive default policy behavior from existing `approval_required`, `approval_status`, and `approver_id`.

### Migration I - XP Award Ledger

Create:

- `task_xp_awards`

Indexes and constraints:

- unique idempotency key.
- lookup by task/subtask/user/source event.

Purpose:

- prevent duplicate completion awards.
- support approval-gated award timing.
- support future reversal records without mutating history.

## Backfill Strategy

Backfills should be separate from schema creation when row counts or data ambiguity are significant.

Recommended order:

1. schema creation.
2. read-only data quality report.
3. staging backfill.
4. application compatibility deployment.
5. production backfill with audit logs.
6. post-backfill verification.
7. only later, optional constraints.

## Rollback Strategy

Preferred rollback:

- disable feature flags.
- stop writing new fields.
- leave additive columns/tables in place.
- keep legacy APIs functional.

Rollback feasibility caveat:

- additive rollback is feasible only after Alembic state is reconciled. A database stamped at a missing revision cannot be safely promoted through new migrations without either restoring the missing migration file, establishing a deliberate stamp strategy, or rebuilding a verified migration baseline in staging.

Avoid:

- dropping production data tables.
- rolling back point totals by recalculation.
- deleting evidence, timers, approvals, or notification rows.

## Production Risks To Validate Before Any Migration

- startup schema mutation may interfere with Alembic.
- local SQLite and PostgreSQL do not behave the same for generated full-text columns.
- configured Alembic database currently references a migration revision absent from this checkout.
- task tenant ownership may not be inferable for every legacy task.
- two task systems may produce duplicated completion or XP behavior if bridged carelessly.
- reward point balance and refund behavior must remain stable.
- existing frontend TypeScript baseline is not clean.
