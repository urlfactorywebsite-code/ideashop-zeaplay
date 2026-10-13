"""add task list and calendar performance indexes

Revision ID: 9c8d7e6f5a4b
Revises: 7a8b9c0d1e2f
Create Date: 2026-09-12
"""

from alembic import op
from sqlalchemy import inspect


revision = "9c8d7e6f5a4b"
down_revision = "7a8b9c0d1e2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    dialect = bind.dialect.name
    if dialect == "postgresql":
        op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_tenant_due_status ON tasks (tenant_id, due_at, status)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_tenant_status_updated ON tasks (tenant_id, status, updated_at DESC)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_tenant_assignee_due ON tasks (tenant_id, assigned_to_id, due_at)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_tenant_team_status ON tasks (tenant_id, team, status)")
    else:
        existing = {index["name"] for index in inspector.get_indexes("tasks")}
        if "ix_tasks_tenant_due_status" not in existing:
            op.create_index("ix_tasks_tenant_due_status", "tasks", ["tenant_id", "due_at", "status"])
        if "ix_tasks_tenant_status_updated" not in existing:
            op.create_index("ix_tasks_tenant_status_updated", "tasks", ["tenant_id", "status", "updated_at"])
        if "ix_tasks_tenant_assignee_due" not in existing:
            op.create_index("ix_tasks_tenant_assignee_due", "tasks", ["tenant_id", "assigned_to_id", "due_at"])
        if "ix_tasks_tenant_team_status" not in existing:
            op.create_index("ix_tasks_tenant_team_status", "tasks", ["tenant_id", "team", "status"])


def downgrade() -> None:
    op.drop_index("ix_tasks_tenant_team_status", table_name="tasks")
    op.drop_index("ix_tasks_tenant_assignee_due", table_name="tasks")
    op.drop_index("ix_tasks_tenant_status_updated", table_name="tasks")
    op.drop_index("ix_tasks_tenant_due_status", table_name="tasks")
