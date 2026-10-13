"""add task transfer requests

Revision ID: 6e7f8g9h0i1j
Revises: 3b234f98f91f
Create Date: 2026-02-16 16:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "6e7f8g9h0i1j"
down_revision = "3b234f98f91f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    status_enum = postgresql.ENUM(
        "pending",
        "approved",
        "rejected",
        name="task_transfer_status_enum",
        create_type=False,
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_transfer_status_enum') THEN
                CREATE TYPE task_transfer_status_enum AS ENUM ('pending', 'approved', 'rejected');
            END IF;
        END $$;
        """
    )
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()
    created_table = False
    if "task_transfer_requests" not in existing_tables:
        op.create_table(
            "task_transfer_requests",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("from_user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("to_user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=False),
            sa.Column("requested_by_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=False),
            sa.Column("approved_by_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column(
                "status",
                status_enum,
                nullable=False,
                server_default="pending",
            ),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        )
        created_table = True

    existing_indexes = set() if created_table else {index["name"] for index in inspector.get_indexes("task_transfer_requests")}
    if "ix_task_transfer_requests_task_id" not in existing_indexes:
        op.create_index("ix_task_transfer_requests_task_id", "task_transfer_requests", ["task_id"])
    if "ix_task_transfer_requests_status" not in existing_indexes:
        op.create_index("ix_task_transfer_requests_status", "task_transfer_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_task_transfer_requests_status", table_name="task_transfer_requests")
    op.drop_index("ix_task_transfer_requests_task_id", table_name="task_transfer_requests")
    op.drop_table("task_transfer_requests")
    op.execute("DROP TYPE IF EXISTS task_transfer_status_enum")
