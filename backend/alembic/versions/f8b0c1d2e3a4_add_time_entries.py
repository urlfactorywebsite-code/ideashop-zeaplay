"""add task and subtask time entries

Revision ID: f8b0c1d2e3a4
Revises: f7a9c1d2e3b4
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f8b0c1d2e3a4"
down_revision = "f7a9c1d2e3b4"
branch_labels = None
depends_on = None


time_entry_status_enum = sa.Enum("ACTIVE", "STOPPED", "CORRECTED", name="time_entry_status_enum")


def _uuid_type() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(length=36), "sqlite")


def upgrade() -> None:
    bind = op.get_bind()
    time_entry_status_enum.create(bind, checkfirst=True)
    op.create_table(
        "time_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=True),
        sa.Column("subtask_id", sa.String(length=36), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("status", time_entry_status_enum, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("original_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("original_stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("original_duration_seconds", sa.Integer(), nullable=True),
        sa.Column("correction_reason", sa.Text(), nullable=True),
        sa.Column("corrected_by_id", sa.String(length=36), nullable=True),
        sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(task_id IS NOT NULL AND subtask_id IS NULL) OR (task_id IS NULL AND subtask_id IS NOT NULL)",
            name="ck_time_entries_exactly_one_target",
        ),
        sa.CheckConstraint(
            "(stopped_at IS NULL AND duration_seconds IS NULL) OR "
            "(stopped_at IS NOT NULL AND duration_seconds IS NOT NULL AND duration_seconds >= 0)",
            name="ck_time_entries_duration_state",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subtask_id"], ["subtasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["corrected_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_time_entries_tenant_id", "time_entries", ["tenant_id"])
    op.create_index("ix_time_entries_tenant_user_started", "time_entries", ["tenant_id", "user_id", "started_at"])
    op.create_index("ix_time_entries_task_started", "time_entries", ["task_id", "started_at"])
    op.create_index("ix_time_entries_subtask_started", "time_entries", ["subtask_id", "started_at"])
    op.create_index(
        "uq_time_entries_one_active_per_user",
        "time_entries",
        ["tenant_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("stopped_at IS NULL"),
        sqlite_where=sa.text("stopped_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_time_entries_one_active_per_user", table_name="time_entries")
    op.drop_index("ix_time_entries_subtask_started", table_name="time_entries")
    op.drop_index("ix_time_entries_task_started", table_name="time_entries")
    op.drop_index("ix_time_entries_tenant_user_started", table_name="time_entries")
    op.drop_index("ix_time_entries_tenant_id", table_name="time_entries")
    op.drop_table("time_entries")
    time_entry_status_enum.drop(op.get_bind(), checkfirst=True)
