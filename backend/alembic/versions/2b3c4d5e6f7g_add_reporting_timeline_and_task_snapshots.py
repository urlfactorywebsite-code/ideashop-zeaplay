"""add reporting timeline events and task snapshots

Revision ID: 2b3c4d5e6f7g
Revises: 1a2b3c4d5e6f
Create Date: 2026-02-16 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "2b3c4d5e6f7g"
down_revision = "1a2b3c4d5e6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "tasks" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("tasks")}
        if "assigned_at" not in columns:
            op.add_column("tasks", sa.Column("assigned_at", sa.DateTime(), nullable=True))
            op.create_index("ix_tasks_assigned_at", "tasks", ["assigned_at"])

    if "report_timeline_events" not in existing_tables:
        op.create_table(
            "report_timeline_events",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("event_type", sa.String(length=80), nullable=False),
            sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("source", sa.String(length=40), nullable=False, server_default=sa.text("'system'")),
            sa.Column(
                "payload_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
            sa.Column("idempotency_key", sa.String(length=120), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id",
                "idempotency_key",
                name="uq_report_timeline_idempotency",
            ),
        )
        op.create_index(
            "ix_report_timeline_user_date",
            "report_timeline_events",
            ["tenant_id", "user_id", "report_date"],
        )
        op.create_index(
            "ix_report_timeline_session",
            "report_timeline_events",
            ["tenant_id", "session_id"],
        )

    if "report_task_snapshots" not in existing_tables:
        op.create_table(
            "report_task_snapshots",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=True),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("task_id", sa.String(length=36), nullable=False),
            sa.Column(
                "snapshot_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tenant_id",
                "report_date",
                "task_id",
                name="uq_report_task_snapshot",
            ),
        )
        op.create_index(
            "ix_report_task_snapshot_session",
            "report_task_snapshots",
            ["tenant_id", "session_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "report_task_snapshots" in existing_tables:
        op.drop_index("ix_report_task_snapshot_session", table_name="report_task_snapshots")
        op.drop_table("report_task_snapshots")
    if "report_timeline_events" in existing_tables:
        op.drop_index("ix_report_timeline_session", table_name="report_timeline_events")
        op.drop_index("ix_report_timeline_user_date", table_name="report_timeline_events")
        op.drop_table("report_timeline_events")
    if "tasks" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("tasks")}
        if "assigned_at" in columns:
            op.drop_index("ix_tasks_assigned_at", table_name="tasks")
            op.drop_column("tasks", "assigned_at")
