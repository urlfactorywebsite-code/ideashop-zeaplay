# Task Manager Upgrade - Target Architecture

Phase 1 scope: architecture target only. No Phase 2 implementation has started.

## Target Principles

1. Preserve all existing task, ticket, XP, reward, notification, auth, and upload behavior unless a later phase explicitly migrates it behind compatibility coverage.
2. Use additive migrations only.
3. Use Alembic as the only migration authority for new production schema.
4. Keep existing task APIs compatible while adding new fields and endpoints.
5. Treat tenant isolation as a first-class invariant for all new tables.
6. Do not overload legacy JSON fields such as `users.projects` or task `attachments` for new canonical data.
7. Keep XP and reward side effects idempotent and auditable.
8. Reuse existing storage and notification infrastructure instead of adding duplicate file or message systems.

## Canonical Architecture Decisions

### AD-001: Canonical Task Model

The upgraded task manager should use the existing global `tasks` model as the canonical task entity.

Rationale:

- existing frontend task pages and task APIs already depend on `tasks`.
- XP, badges, task templates, followers, comments, dependencies, and task transfers are wired to global tasks.
- ticket-specific `ticket_tasks` should be bridged deliberately rather than expanded into the main task manager.

Compatibility requirement:

- existing routes and response fields must continue to work.
- `task_group_id` multi-assignee behavior must remain readable during transition.

### AD-002: Tenant Ownership

All new tables must include `tenant_id`.

The global `tasks` table should receive a nullable `tenant_id` in an additive migration, followed by verified backfill from the creator, assignee, ticket, or fallback audit rules. A non-null constraint can only be considered after production data is proven consistent.

Compatibility requirement:

- existing task queries must keep returning legacy tasks during the backfill window.
- new task rows should always write tenant ownership.

### AD-003: Clients, Contacts, And Projects

Add normalized tables:

- `clients`
- `contacts`
- `client_contacts`
- `projects`
- `project_clients` if projects can relate to multiple clients.
- `project_managers`
- `project_members`

Relationships:

- one tenant owns many clients.
- one contact can be linked to multiple clients.
- one project can have multiple managers and members.
- tasks can be linked to a project with a nullable `project_id`.

Compatibility requirement:

- do not reuse `users.projects` as the canonical project membership model.

### AD-004: Subtask Workflow Model

Expand subtasks additively rather than replacing the existing table.

Target capabilities:

- assigned subtasks.
- sequential and parallel workflow groups.
- explicit order indexes.
- dependency links between subtasks.
- activation states.
- automatic activation.
- force-start with audit metadata.
- independent completion metadata.
- independent timers.
- completion evidence.
- approval requirements where configured.

Compatibility requirement:

- existing checklist subtasks must continue to render and update.
- legacy subtasks without workflow metadata should behave as always-active checklist items.

### AD-005: Timers

Introduce normalized timer session tables.

Recommended tables:

- `task_timer_sessions`
- `subtask_timer_sessions`

Core fields:

- `tenant_id`
- task/subtask ID
- user ID
- started, paused, resumed, stopped timestamps
- elapsed seconds
- status
- source

Compatibility requirement:

- do not map ticket timeline `time_spent_seconds` directly to task timers.

### AD-006: Completion Evidence

Introduce normalized evidence tables instead of extending task attachment JSON.

Recommended table:

- `task_completion_evidence`

Core fields:

- `tenant_id`
- `task_id`
- optional `subtask_id`
- submitter ID
- evidence type
- text
- file/media reference
- storage key or existing media reference
- submitted timestamp
- approval association.

Compatibility requirement:

- reuse existing presign/confirm upload conventions where possible.
- preserve current task attachment JSON for backwards compatibility.

### AD-007: Approval Policy

Unify new task approvals around an approval policy/request model rather than adding isolated booleans.

Recommended tables:

- `task_approval_policies`
- `task_approval_steps`
- `task_approval_requests`

Target behavior:

- configurable approval at project, task, or subtask level.
- approval can gate final task completion.
- rejection can return task/subtask to a configured status.
- XP award timing must be configurable and auditable.

Compatibility requirement:

- current `approval_required`, `approval_status`, and `approver_id` fields must continue to work.
- existing reward approval and refund behavior must not be weakened.

### AD-008: XP And Rewards Preservation

Preserve existing XP/reward behavior while making new task completion awards idempotent.

Recommended table:

- `task_xp_awards`

Core fields:

- `tenant_id`
- task/subtask ID
- user ID
- award type
- source event
- points
- awarded_at
- reversed_at
- unique idempotency key.

Compatibility requirement:

- existing user point totals must not be recalculated in-place.
- reward claim and rejection refund behavior must remain unchanged.
- new approval-gated completion must define whether XP is awarded at submission or final approval.

### AD-009: Notifications And Email

Reuse existing notification infrastructure.

Target behavior:

- in-app notifications for assignment, activation, force-start, evidence submission, approval request, approval result, timer anomalies, and project membership changes.
- email notifications where preferences and SMTP configuration allow.

Compatibility requirement:

- preserve existing notification response shapes.
- avoid duplicate notification rows for the same event.

## Target Core Data Model

### Clients And Contacts

`clients`:

- `id`
- `tenant_id`
- name and status fields
- owner/account manager fields
- metadata JSON
- created/updated timestamps

`contacts`:

- `id`
- `tenant_id`
- name, email, phone, title
- status
- metadata JSON
- created/updated timestamps

`client_contacts`:

- `tenant_id`
- `client_id`
- `contact_id`
- role/title for this client
- primary contact flag
- created timestamp.

### Projects

`projects`:

- `id`
- `tenant_id`
- `client_id` or project-client join depending on final multiplicity
- name, status, priority
- start/due dates
- description
- metadata JSON
- created/updated timestamps.

`project_managers`:

- `tenant_id`
- `project_id`
- `user_id`
- role metadata

`project_members`:

- `tenant_id`
- `project_id`
- `user_id`
- role metadata

Task link:

- add nullable `project_id` to `tasks`, or add `project_tasks` if many-to-many is later required. Current requirements indicate project-linked tasks, so nullable `tasks.project_id` is the simpler target.

### Subtask Workflow

Recommended additive subtask fields:

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

Recommended table:

- `subtask_dependencies`

Legacy behavior:

- if workflow fields are null, the subtask is treated as active and unordered.

## API Compatibility Requirements

Existing task API fields to preserve:

- `id`
- `title`
- `description`
- `status`
- `priority`
- `assignedTo`
- `assignedToId`
- `createdById`
- `taskGroupId`
- `subtasks`
- `followers`
- `dependencies`
- `attachments`
- `approvalRequired`
- `approvalStatus`
- `approverId`
- dates and recurring fields.

New fields should be additive:

- `tenantId`
- `projectId`
- `clientId` through project response expansion.
- `workflowMode`
- `activationStatus`
- timer summaries.
- evidence summaries.
- approval policy summaries.

Endpoint strategy:

- preserve existing `/tasks` routes.
- add scoped project/client/contact endpoints.
- add subtask workflow endpoints under tasks.
- add evidence and timer endpoints with clear ownership and permission checks.
- keep `/api` route aliases compatible.

## Permissions Target

Every new query must filter by `tenant_id`.

Project access should permit:

- owners/admins within tenant.
- project managers.
- project members for assigned or visible work.
- task creator, assignee, follower, or approver according to existing task rules.

Tenant rules:

- no cross-tenant user, project, client, contact, task, evidence, timer, approval, or notification links.
- database constraints should use same-tenant validation at service level first; database-level composite constraints can be added where practical.

## Existing Feature Overlap To Reuse Or Avoid

Features that overlap with the target upgrade:

- global task followers and task dependencies already exist. Reuse them for task-level observing and task-level dependency graphs instead of duplicating them.
- ticket-specific `ticket_tasks` and `points_ledger` already implement tenant-scoped ticket task completion points. Do not copy this blindly into global tasks; use it as a reference for an idempotent global task XP ledger.
- ticket attachments already implement presign/confirm/list/delete with tenant-aware storage keys. Reuse this pattern for task evidence rather than extending task attachment JSON.
- ticket timeline stages expose `time_spent_seconds`. Treat this as historical workflow duration, not as the new independent timer system.
- notifications, notification preferences, push subscriptions, SMTP settings, email templates, and ticket email dispatch already exist. New task events should integrate with these.
- `TaskDocumentation` stores per-task notes and reactions in browser `localStorage`. Do not use this as authoritative completion evidence.
- frontend local point configuration and gamification helpers exist, but backend point configuration and award services must remain authoritative for persisted XP and rewards.

## Phase 2-14 Dependency Map

### Phase 2 - Baseline Stabilization

Dependencies:

- Phase 1 docs.
- backend test collection fix plan.
- decision on tenant backfill source of truth.

Scope:

- add compatibility tests around task creation, completion, approval, XP, rewards, and task visibility.
- fix or isolate SQLite/PostgreSQL full-text test incompatibility.
- no product feature changes.

### Phase 3 - Client And Contact Foundation

Dependencies:

- Phase 2 tests passing or explicitly quarantined.

Scope:

- additive client/contact migrations.
- tenant-scoped APIs.
- minimal frontend types and admin views if authorized.

### Phase 4 - Project Foundation

Dependencies:

- clients/contacts schema.

Scope:

- projects.
- project managers and members.
- permission checks.
- optional client-project link.

### Phase 5 - Project-Linked Tasks

Dependencies:

- project permissions.
- task compatibility tests.

Scope:

- add nullable project link to tasks.
- tenant-aware task create/list/update.
- preserve legacy task routes.

### Phase 6 - Subtask Workflow Expansion

Dependencies:

- project-linked tasks.

Scope:

- additive subtask fields.
- subtask dependency table.
- sequential/parallel workflow evaluation.
- legacy checklist compatibility.

### Phase 7 - Automatic Activation And Force Start

Dependencies:

- subtask workflow model.

Scope:

- automatic activation rules.
- force-start endpoint.
- audit events.
- notifications.

### Phase 8 - Independent Timers

Dependencies:

- task/subtask ownership and activation model.

Scope:

- timer sessions.
- active timer guards.
- timer summaries.
- frontend timer state.

### Phase 9 - Completion Evidence

Dependencies:

- upload/storage decision.
- task/subtask workflow model.

Scope:

- evidence submission.
- normalized file references.
- evidence list APIs.

### Phase 10 - Configurable Approval

Dependencies:

- evidence model.
- project/task ownership model.

Scope:

- policy tables.
- approval request lifecycle.
- compatibility bridge for existing approval fields.

### Phase 11 - XP/Reward Idempotency

Dependencies:

- final approval semantics.

Scope:

- task XP award ledger.
- duplicate award prevention.
- rejection/approval point timing rules.
- reward behavior preservation tests.

### Phase 12 - Notifications And Email

Dependencies:

- activation, evidence, approval, and timer events.

Scope:

- in-app notification events.
- email templates and preference integration.
- deduplication.

### Phase 13 - Frontend Upgrade

Dependencies:

- stable APIs from Phases 3-12.

Scope:

- project task UI.
- subtask workflow UI.
- timers.
- evidence.
- approval screens.
- compatibility with existing task pages.

### Phase 14 - Certification And Rollout

Dependencies:

- full backend/frontend test baseline.
- migration dry run.
- production data audit.

Scope:

- migration rehearsal.
- performance checks.
- tenant isolation verification.
- deployment runbook.
- rollback plan.
