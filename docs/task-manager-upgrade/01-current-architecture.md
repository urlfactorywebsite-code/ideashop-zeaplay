# Task Manager Upgrade - Current Architecture

Phase 1 audit date: 2026-10-13

## Verified Stack And Conventions

- Backend: FastAPI, SQLAlchemy ORM, Pydantic v2, Alembic.
- Frontend: Vite, React 19, TypeScript.
- Local database default: SQLite at `sqlite:///./vee_task_manager.db`.
- Container database: PostgreSQL through `VEE_DATABASE_URL`.
- API inclusion convention: most backend routers are mounted both unprefixed and under `/api`; the ticket workflow router already defines `/api` routes internally.
- Authentication convention: JWT token carries `sub`, `role`, and `tenant_id`; `get_current_user` validates that the token tenant matches the loaded user's tenant.
- Migration convention: Alembic exists, but the application also performs startup schema changes and seed mutations from `app.database` and `app.main`. This is a production risk and should not be extended.
- Frontend API convention: `frontend/services/api.ts` re-exports `frontend/services/mockApi.ts`; despite the name, `mockApi.ts` contains the primary axios-backed API client and data mappers.

## Source Map

Primary backend files inspected:

- `backend/app/models.py`
- `backend/app/schemas.py`
- `backend/app/main.py`
- `backend/app/database.py`
- `backend/app/dependencies.py`
- `backend/app/config.py`
- `backend/app/routers/tasks.py`
- `backend/app/routers/rewards.py`
- `backend/app/routers/notifications.py`
- `backend/app/routers/media.py`
- `backend/app/services/gamification.py`
- `backend/app/services/points_table.py`
- `backend/app/services/rewards.py`
- `backend/app/services/task_link_service.py`
- `backend/app/tickets/*`

Primary frontend files inspected:

- `frontend/types.ts`
- `frontend/services/api.ts`
- `frontend/services/mockApi.ts`
- task, ticket, reward, notification, chat, upload, and seed-related components and services found by repository search.

Environment and deployment files inspected:

- `backend/alembic.ini`
- `backend/alembic/versions/*`
- `backend/migrations/*.sql`
- `backend/sql/*.sql`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- frontend package/test configuration.

## Current Domain Model

### Users And Tenants

`users` is the central identity table. The local database snapshot contains 6 rows.

Important columns:

- `id`
- `tenant_id`
- `name`
- `email`
- `role`
- `department_id`
- manager fields
- `skills`
- `projects`
- `status`
- `points`
- `tasks_created`
- `tasks_completed`
- `clarity_scores`
- `claimed_reward_ids`
- `unlocked_achievement_ids`
- avatar/profile fields

Important relationships:

- `users.department_id -> departments.id`
- `users.avatar_asset_id -> avatar_assets.id`
- task creator, assignee, followers, comments, notifications, rewards, chats, and ticket references use user IDs.

Important indexes and constraints observed in SQLite:

- unique index on `users.email`
- index on `users.tenant_id`

Compatibility concern:

- `users.projects` is a JSON/string list field, not a normalized project membership model.

### Departments

`departments` contains 13 rows in the local snapshot.

Important columns:

- `id`
- `name`
- manager and display metadata

Compatibility concern:

- departments are global in the current model. They are not tenant-scoped in the inspected schema.

### Tasks

`tasks` contains 5 rows in the local snapshot.

Important columns:

- `id`
- `title`
- `description`
- `status`
- `priority`
- `team`
- `task_group_id`
- `ticket_id`
- `assigned_to_id`
- `created_by_id`
- `approval_required`
- `approval_status`
- `approver_id`
- created, updated, due, and completion dates
- recurrence fields
- `clarity_rating`
- `attachments`
- `estimated_hours`
- `tags`
- `search_vector`

Important relationships:

- `tasks.ticket_id -> tickets.id`
- `tasks.assigned_to_id -> users.id`
- `tasks.created_by_id -> users.id`
- `tasks.recurring_task_id -> tasks.id`
- followers through `task_followers`
- dependencies through `task_dependencies`
- subtasks through `subtasks`
- comments through `comments`
- tickets may link to tasks through `ticket_task_links`

Important indexes and constraints observed in SQLite:

- primary key on `tasks.id`
- index on `tasks.task_group_id`
- no observed tenant index because `tasks` has no `tenant_id` column in the current schema.

Task statuses in the ORM:

- `WAITING_FOR_REQUIREMENT`
- `TODO`
- `IN_PROGRESS`
- `BUG_FIXING`
- `IN_REVIEW`
- `BLOCKED`
- `ON_HOLD`
- `DONE`
- `DEPLOYED`
- `FAILED`
- `GRAVEYARD`

Approval statuses:

- `none`
- `pending`
- `approved`
- `rejected`

Compatibility concerns:

- tasks are not directly tenant-scoped.
- multi-assignment is represented by cloning one task per assignee under a shared `task_group_id`.
- task attachments are a JSON field, not normalized file metadata.
- task approval currently affects status metadata but does not gate XP awarding.

### Subtasks

`subtasks` contains 7 rows in the local snapshot.

Important columns:

- `id`
- `task_id`
- `title`
- `completed`

Relationship:

- `subtasks.task_id -> tasks.id`

Compatibility concern:

- subtasks have no assignee, ordering, dependency, activation state, timer, evidence, approval, or independent completion metadata.

### Task Dependencies And Followers

`task_dependencies` is a many-to-many task dependency table.

`task_followers` has a composite primary key over `task_id` and `user_id`, plus `created_at`.

Compatibility concern:

- dependency information exists only between tasks, not between subtasks.

### Tickets And Ticket Tasks

The ticket domain is tenant-aware and significantly richer than the global task model.

Important ticket tables:

- `tickets`
- `ticket_participants`
- `ticket_followers`
- `ticket_approvals`
- `ticket_approval_users`
- `ticket_approval_cycles`
- `ticket_approval_items`
- `ticket_tasks`
- `ticket_task_links`
- `ticket_attachments`
- `ticket_activity`
- `ticket_status_history`
- ticket notifications and approval support tables.

Important finding:

- There are two task-like systems:
  - global `tasks`, linked to tickets by `tasks.ticket_id` and `ticket_task_links`.
  - ticket-specific `ticket_tasks`, with its own completion flow and points ledger.

Compatibility concern:

- Phase 2+ must choose one canonical task model for the upgraded task manager. The safest choice is to keep `tasks` as the canonical task manager model and bridge ticket-specific task behavior deliberately.

### Approvals

There are multiple approval concepts:

- task fields: `approval_required`, `approval_status`, `approver_id`
- generic `approvals` table with `scope_type`, `scope_id`, requested/approver/status fields
- ticket approval tables for workflow approvals

Compatibility concern:

- approval is not unified. The upgraded task manager should avoid adding another unrelated approval concept.

### Notifications

`notifications` contains 9 rows in the local snapshot.

Important columns:

- `id`
- `user_id`
- `type`
- `title`
- `body` / `message`
- entity fields
- deep link fields
- task/reward/chat references
- read timestamps

Related tables:

- `notification_preferences`
- `push_subscriptions`

Important behavior:

- task notifications use in-app notification creation.
- ticket notifications include richer templates and email dispatch support.

Compatibility concern:

- task email notifications are not currently equivalent to ticket email notifications.

### Rewards, XP, Badges, And Gamification

Important tables:

- `rewards`
- `reward_claims`
- `reward_logs`
- `reward_icons`
- `badges`
- `badge_rules`
- `user_badge_progress`
- `achievements`
- `user_achievements`
- `points_table_config`

Important behavior:

- point values are configurable through `points_table_config`; missing config is created with defaults.
- task creation awards creator points.
- task completion awards assignee points.
- clarity ratings award creator points.
- rewards spend user points at claim time.
- rejected reward claims refund spent points.

Compatibility concerns:

- there is no idempotent XP award ledger for global task completion.
- task completion XP can be awarded before task approval is approved.
- rewards are not tenant-scoped in the inspected model.

### Files And Attachments

Existing file systems:

- task `attachments` JSON field.
- ticket attachments with presign/confirm/list/delete behavior and MinIO metadata.
- media library through `media_files` and `media_items`.
- chat message attachments.

Compatibility concern:

- task completion evidence should reuse existing upload/storage patterns but should not be stored only as an unstructured task JSON attachment list.

## Current API Routes

### Task Routes

Important task routes:

- `GET /tasks`
- `GET /tasks/page`
- `GET /tasks/kanban`
- `GET /tasks/calendar/summary`
- `GET /tasks/calendar/tasks`
- `GET /tasks/{task_id}`
- `POST /tasks`
- `PATCH /tasks/{task_id}`
- `DELETE /tasks/{task_id}`
- `POST /tasks/{task_id}/complete`
- `POST /tasks/{task_id}/approve`
- `PATCH /tasks/{task_id}/subtasks/{subtask_id}`
- task transfer request routes.
- task template routes.

Most of these are mounted both directly and under `/api`.

### Ticket Routes

Important ticket routes:

- ticket CRUD
- participants
- followers
- activity
- approvals
- timeline
- close/reopen
- `POST /tickets/{ticket_id}/tasks/create`
- `POST /tickets/{ticket_id}/tasks/split`
- ticket attachment presign/confirm/list/delete
- ticket workflow routes under `/api/tickets/{ticket_id}/tasks`, `/api/tasks/{task_id}`, `/api/tasks/{task_id}/complete`, and `/api/approvals/*`.

### Rewards Routes

Important reward routes:

- reward CRUD
- reward image upload/delete
- reward claims
- claim approval/rejection
- reward logs
- reward icon routes.

### Notification Routes

Important notification routes:

- list notifications
- mark one notification read
- mark all read
- delete notification
- notification preferences
- push subscription routes.

### Media And Upload Routes

Important media routes:

- presign upload
- confirm upload
- avatar finalize
- media list
- direct upload compatibility route
- media metadata routes.

## End-To-End Flow Traces

### Task Creation

1. `POST /tasks` accepts `TaskCreate`.
2. Multiple assignees are represented as separate task rows sharing one `task_group_id`.
3. Dependencies are validated.
4. Followers are resolved and creator/assignees are excluded.
5. Subtasks are created as simple title/completed rows.
6. Creator `tasks_created` is incremented.
7. Creator receives task creation XP from `points_table_config`.
8. Notifications are created for assignees and followers.
9. Audit events/logs and badge events are recorded.

Important deviation:

- task create UI and future requirements imply approval configuration at creation time, but the current backend create schema does not carry all approval fields used by update.

### Task Update And Completion

1. `PATCH /tasks/{id}` updates task fields, dependencies, followers, and subtasks.
2. If status changes from an incomplete status to `DONE` or `DEPLOYED`, completion time is set and XP is awarded.
3. Shared group updates propagate selected fields to peer tasks in the same `task_group_id`.
4. Task-link completion hooks run after commit.

`POST /tasks/{id}/complete`:

1. sets status to `DONE`.
2. sets `completed_at`.
3. sets approval status to `pending` when `approval_required` is true, otherwise `approved`.
4. awards completion XP immediately.

Important compatibility issue:

- completion XP is awarded before approval is approved. Rejection does not revoke the XP.

### Task Approval

1. `POST /tasks/{id}/approve` checks the current user is the configured approver.
2. approval status is changed to `approved` or `rejected`.
3. notifications and audit events are recorded.

Important compatibility issue:

- approval does not control XP award timing or refund/reversal.

### XP Awarding

Task completion XP:

1. base completion points come from `points_table_config`.
2. on-time completion may grant a bonus.
3. late completion may use an overdue penalty value.
4. assignee `points` and `tasks_completed` are updated.
5. selected achievement/badge events are triggered.
6. creator may be notified.
7. late completion can penalize a manager creator in the same department.

Task creation XP:

1. creator receives task creation points.
2. creator task counters are incremented.

Clarity rating XP:

1. creator receives points based on rating and per-star configuration.
2. clarity score history is updated.

Important compatibility issue:

- global task XP relies on status-transition logic, not an immutable award ledger.

### Reward Redemption And Refund

Reward claim:

1. validates active reward, expiry, department whitelist, duplicate claim rules, and sufficient user points.
2. creates a claim.
3. claim status is `redeemed` for auto-redeem rewards or `pending` for approval-required rewards.
4. subtracts `xp_spent` from user points immediately.
5. appends reward ID to `claimed_reward_ids` for single-claim rewards.
6. creates notification and reward log records.

Reward rejection:

1. changes claim status to `rejected`.
2. refunds `xp_spent` to the claimant.
3. removes the reward from `claimed_reward_ids`.
4. logs the refund/rejection.

Important compatibility issue:

- reward refund behavior is stronger than task approval rejection behavior. The task upgrade should not weaken reward refund behavior.

## Tenant Isolation And Permissions

Verified enforcement:

- auth token tenant is validated against the current user.
- ticket queries and ticket services use `tenant_id` and role-aware permission checks.
- chat has tenant-aware access checks.

Gaps:

- global `tasks` has no `tenant_id` column.
- task access is role and relationship based, but not tenant-filtered at the row level.
- rewards are not tenant-scoped in the inspected model.
- departments, achievements, badges, and some media concepts are effectively global.

Current task access behavior:

- admins, owners, and managers have broad access.
- managers may see tasks they created, are assigned to, follow, or tasks assigned to department users.
- regular users may see tasks they created, are assigned to, or follow.

Compatibility concern:

- tenant isolation must be fixed additively and carefully because legacy data does not have direct tenant ownership on tasks.

## Existing Subtask, Timer, Attachment, And Notification Features

Subtasks:

- simple completion checklist only.
- no assignment, sequencing, parallel groups, activation, timers, force-start, evidence, or approval.

Timers:

- no global task or subtask independent timer table was found.
- ticket timeline stages have time-spent fields, but that is not equivalent to task timers.

Attachments:

- tasks use JSON attachments.
- tickets use normalized attachment metadata and MinIO.
- media library and chat attachments also exist.

Notifications:

- in-app notifications exist for tasks and rewards.
- ticket notifications include richer email-capable templates.
- notification preferences and push subscriptions exist.

## Deviations From Assumptions

- There are no normalized `clients`, `contacts`, or `projects` tables in the inspected application.
- `User.projects` is a JSON/list field, not a membership model.
- project-linked tasks do not exist.
- multiple task assignees are modeled as cloned task rows in a task group.
- global tasks are not tenant-scoped.
- ticket tasks and global tasks are separate systems.
- task approval currently does not gate XP.
- task attachments are not normalized.
- there is no independent task/subtask timer system.
- startup code mutates schema and data outside Alembic.
- local tests currently fail during backend collection because PostgreSQL full-text generated column SQL is applied to SQLite.

## Independent Review Corrections

The Phase 1 audit was rechecked against source code and the local SQLite schema on 2026-10-13.

Verified corrections:

- task update is `PATCH /tasks/{task_id}`, not `PUT /tasks/{task_id}`.
- task complete and task approve are `POST` routes, not `PATCH` routes.
- no source-defined `Client`, `Contact`, or `Project` model/table was found under `backend/app` or the project frontend source when excluding vendored dependencies.
- the local SQLite file has 92 tables and no `alembic_version` table.
- the checked source defines a `points_ledger` table for ticket tasks; global task completion still has no equivalent idempotent XP award ledger.
- ticket timeline `time_spent_seconds` exists and overlaps with reporting/timeline duration, but it is not an independent user-controlled task/subtask timer.
- `TaskDocumentation` stores task documentation and reactions in `localStorage`; this overlaps with future completion evidence and collaboration features and must not be treated as authoritative backend evidence.
- frontend `utils/pointsConfigStorage.ts` and `frontend/services/gamification.ts` overlap conceptually with backend point configuration, but backend `points_table_config` and `services/gamification.py` are the authoritative XP paths for persisted task/reward behavior.

Review result:

- the core architecture findings remain valid after correction.
- API verb documentation needed correction.
- migration readiness is weaker than originally stated because Alembic environment verification found a remote database revision mismatch; see the migration plan and baseline test documents.
