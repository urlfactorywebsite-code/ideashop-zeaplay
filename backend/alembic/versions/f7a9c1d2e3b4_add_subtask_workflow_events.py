"""add subtask workflow events

Revision ID: f7a9c1d2e3b4
Revises: e6f8a0b2c4d6
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa


revision = "f7a9c1d2e3b4"
down_revision = "e6f8a0b2c4d6"
branch_labels = None
depends_on = None


subtask_status_enum = sa.Enum(
    "WAITING",
    "TODO",
    "IN_PROGRESS",
    "BLOCKED",
    "IN_REVIEW",
    "DONE",
    name="subtaskstatusenum",
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "subtask_workflow_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_key", sa.String(length=255), nullable=True),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("subtask_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("from_status", subtask_status_enum, nullable=True),
        sa.Column("to_status", subtask_status_enum, nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("blocked_predecessor_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_key", name="uq_subtask_workflow_events_event_key"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subtask_id"], ["subtasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_subtask_workflow_events_task_created",
        "subtask_workflow_events",
        ["task_id", "created_at"],
    )
    op.create_index(
        "ix_subtask_workflow_events_subtask_created",
        "subtask_workflow_events",
        ["subtask_id", "created_at"],
    )
    op.create_index(
        "ix_subtask_workflow_events_type",
        "subtask_workflow_events",
        ["event_type"],
    )
    op.alter_column("subtask_workflow_events", "blocked_predecessor_ids", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_subtask_workflow_events_type", table_name="subtask_workflow_events")
    op.drop_index("ix_subtask_workflow_events_subtask_created", table_name="subtask_workflow_events")
    op.drop_index("ix_subtask_workflow_events_task_created", table_name="subtask_workflow_events")
    op.drop_table("subtask_workflow_events")
