-- Production performance indexes for ZeaPlay.
-- Run during a maintenance window. For PostgreSQL production systems, consider
-- changing CREATE INDEX to CREATE INDEX CONCURRENTLY where supported.

CREATE INDEX IF NOT EXISTS ix_tasks_tenant_created_at_desc ON tasks (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_updated_at_desc ON tasks (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_status_updated_at ON tasks (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_priority ON tasks (tenant_id, priority);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_assigned_to_status ON tasks (tenant_id, assigned_to_id, status);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_created_by_created_at ON tasks (tenant_id, created_by_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_due_at ON tasks (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS ix_tasks_task_group_id ON tasks (task_group_id);
CREATE INDEX IF NOT EXISTS ix_tasks_recurring_task_id ON tasks (recurring_task_id);

CREATE INDEX IF NOT EXISTS ix_subtasks_task_id ON subtasks (task_id);
CREATE INDEX IF NOT EXISTS ix_comments_task_id_created_at ON comments (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_task_followers_user_id ON task_followers (user_id);
CREATE INDEX IF NOT EXISTS ix_task_followers_task_id ON task_followers (task_id);

CREATE INDEX IF NOT EXISTS ix_notifications_user_created_at ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_user_read_created_at ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_entity ON notifications (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS ix_user_badge_progress_user_badge ON user_badge_progress (user_id, badge_id);
CREATE INDEX IF NOT EXISTS ix_user_badge_progress_status ON user_badge_progress (status);
CREATE INDEX IF NOT EXISTS ix_badges_state_tier ON badges (state, tier_group, tier_order);

CREATE INDEX IF NOT EXISTS ix_rewards_status_created_at ON rewards (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reward_claims_user_created_at ON reward_claims (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reward_claims_reward_status ON reward_claims (reward_id, status);

CREATE INDEX IF NOT EXISTS ix_users_tenant_role ON users (tenant_id, role);
CREATE INDEX IF NOT EXISTS ix_users_department_id ON users (department_id);
CREATE INDEX IF NOT EXISTS ix_users_points ON users (points DESC);
