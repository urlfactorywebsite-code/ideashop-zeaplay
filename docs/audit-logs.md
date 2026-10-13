# Audit Logs

## SQL schema (PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  actor_id VARCHAR(36) NULL,
  actor_role VARCHAR(50) NULL,
  action VARCHAR(255) NOT NULL,
  category VARCHAR(32) NOT NULL,
  entity_type VARCHAR(100) NULL,
  entity_id VARCHAR(64) NULL,
  target_user_id VARCHAR(36) NULL,
  approval_id VARCHAR(36) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  before JSONB NULL,
  after JSONB NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  source VARCHAR(32) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason TEXT NULL,
  trigger VARCHAR(255) NULL,
  route VARCHAR(255) NULL,
  method VARCHAR(16) NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_type ON audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS ix_audit_logs_actor_id ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_category ON audit_logs (category);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS ix_audit_logs_status ON audit_logs (status);
```

Retention configuration table:

```sql
CREATE TABLE IF NOT EXISTS audit_retention_config (
  id INTEGER PRIMARY KEY,
  retention_days INTEGER NOT NULL DEFAULT 90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_applied_at TIMESTAMPTZ NULL
);
```

## Example API response

`GET /logs/audit`

```json
{
  "items": [
    {
      "id": "f9d8c7b6-7a6b-4f2a-9c2e-2f3a9f6d7e10",
      "actor_id": "a7a6b5c4-1d2e-4f6a-9b2c-4d5e6f7a8b9c",
      "actor_role": "admin",
      "actor": {
        "id": "a7a6b5c4-1d2e-4f6a-9b2c-4d5e6f7a8b9c",
        "name": "Admin User",
        "email": "admin@example.com",
        "role": "admin"
      },
      "action": "TASK_UPDATED",
      "category": "task",
      "entity_type": "task",
      "entity_id": "e1b2c3d4-5678-4abc-9def-1234567890ab",
      "target_user_id": "b2c3d4e5-6789-4abc-9def-1234567890ab",
      "old_value": null,
      "new_value": null,
      "before": { "status": "TODO" },
      "after": { "status": "IN_PROGRESS" },
      "ip_address": "192.168.1.10",
      "user_agent": "Mozilla/5.0",
      "source": "manual",
      "severity": "info",
      "status": "success",
      "reason": null,
      "trigger": null,
      "route": "/tasks/e1b2c3d4-5678-4abc-9def-1234567890ab",
      "method": "PATCH",
      "metadata": { "fields": ["status"] },
      "created_at": "2026-02-05T08:12:45.123Z"
    }
  ],
  "page": 1,
  "total": 42,
  "page_size": 50,
  "total_pages": 1
}
```
