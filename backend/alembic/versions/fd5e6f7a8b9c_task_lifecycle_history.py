"""Add immutable lifecycle observations without synthesizing historical events.

Revision ID: fd5e6f7a8b9c
Revises: fc4d5e6f7a8b
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.lifecycle.schema_v1 import install, uninstall

revision = "fd5e6f7a8b9c"
down_revision = "fc4d5e6f7a8b"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("continued_from_id", "start_kind", "stop_reason"):
        op.add_column("time_entries", sa.Column(name, sa.String(36 if name == "continued_from_id" else 16), nullable=True))
    op.create_index("uq_time_entries_continued_from_id", "time_entries", ["continued_from_id"], unique=True,
                    postgresql_where=sa.text("continued_from_id IS NOT NULL"),
                    sqlite_where=sa.text("continued_from_id IS NOT NULL"))
    op.create_table("task_lifecycle_events",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("subtask_id", sa.String(36)),
        sa.Column("time_entry_id", sa.String(36)),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("previous_status", sa.String(40)),
        sa.Column("new_status", sa.String(40)),
        sa.Column("actor_id", sa.String(36)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False))
    op.create_index("ix_task_lifecycle_tenant_task_id", "task_lifecycle_events", ["tenant_id", "task_id", "id"])
    op.create_index("ix_task_lifecycle_entry_id", "task_lifecycle_events", ["time_entry_id", "id"])
    op.create_index("ix_task_lifecycle_subtask_id", "task_lifecycle_events", ["subtask_id", "id"])
    op.create_index("ix_task_lifecycle_task_id", "task_lifecycle_events", ["task_id", "id"])
    op.create_table("task_lifecycle_coverage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False))
    install(op.get_bind())


def downgrade():
    if op.get_context().as_sql:
        raise RuntimeError("Lifecycle downgrade requires an online history check")
    connection = op.get_bind()
    # The empty-history guard must not race a writer that commits between count and DROP.
    if connection.dialect.name == "postgresql":
        connection.exec_driver_sql("LOCK TABLE tasks, subtasks, time_entries, task_lifecycle_events, task_lifecycle_coverage IN ACCESS EXCLUSIVE MODE")
    elif not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    if connection.scalar(sa.text("SELECT 1 FROM task_lifecycle_events LIMIT 1")):
        raise RuntimeError("Lifecycle history exists: retain schema and roll back application code instead")
    uninstall(connection)
    op.drop_table("task_lifecycle_coverage")
    op.drop_table("task_lifecycle_events")
    op.drop_index("uq_time_entries_continued_from_id", table_name="time_entries")
    for name in ("stop_reason", "start_kind", "continued_from_id"):
        op.drop_column("time_entries", name)
