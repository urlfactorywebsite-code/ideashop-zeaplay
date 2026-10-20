"""Index captured reporting events by tenant and event period.

Revision ID: ffa0d1e2f3a4
Revises: ff9c0d1e2f3a

The existing lifecycle index begins tenant/task/id. Date-wise reports need
a tenant/time range access path. PostgreSQL builds this index concurrently.
No business rows, status semantics, or existing indexes are changed.
"""
from alembic import op


revision = "ffa0d1e2f3a4"
down_revision = "ff9c0d1e2f3a"
branch_labels = None
depends_on = None

INDEX = "ix_task_lifecycle_reporting_period"


def upgrade():
    if op.get_context().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} "
                "ON task_lifecycle_events (tenant_id, occurred_at, task_id)"
            )
    else:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {INDEX} "
            "ON task_lifecycle_events (tenant_id, occurred_at, task_id)"
        )


def downgrade():
    if op.get_context().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}")
    else:
        op.execute(f"DROP INDEX IF EXISTS {INDEX}")
