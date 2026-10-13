CREATE INDEX IF NOT EXISTS ix_tasks_tenant_created_at ON tasks (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_status ON tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_assigned_to ON tasks (tenant_id, assigned_to_id);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_due_at ON tasks (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS ix_tasks_tenant_priority ON tasks (tenant_id, priority);
