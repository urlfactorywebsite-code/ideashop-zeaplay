"""add ticket track map, approvals, tasks, logs, and webhook fields

Revision ID: d2f4a8b1c0e9
Revises: 9b7c1a2e3d4f, b7b3f1c8f9a1
Create Date: 2026-02-06 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d2f4a8b1c0e9"
down_revision = ("9b7c1a2e3d4f", "b7b3f1c8f9a1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    ticket_resolution_enum = postgresql.ENUM(
        "ISSUE_RESOLVED",
        "DUPLICATE_ISSUE",
        "ISSUE_NOT_SOLVED",
        name="ticket_resolution_enum",
    )
    ticket_approval_cycle_status_enum = postgresql.ENUM(
        "PENDING",
        "APPROVED",
        "REJECTED",
        "OVERDUE",
        "ESCALATED",
        name="ticket_approval_cycle_status_enum",
    )
    ticket_approval_item_status_enum = postgresql.ENUM(
        "PENDING",
        "APPROVED",
        "REJECTED",
        "OVERDUE",
        name="ticket_approval_item_status_enum",
    )
    ticket_task_status_enum = postgresql.ENUM(
        "OPEN",
        "IN_PROGRESS",
        "COMPLETED",
        name="ticket_task_status_enum",
    )
    ticket_task_priority_enum = postgresql.ENUM(
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
        name="ticket_task_priority_enum",
    )

    ticket_resolution_enum.create(bind, checkfirst=True)
    ticket_approval_cycle_status_enum.create(bind, checkfirst=True)
    ticket_approval_item_status_enum.create(bind, checkfirst=True)
    ticket_task_status_enum.create(bind, checkfirst=True)
    ticket_task_priority_enum.create(bind, checkfirst=True)

    ticket_cols = {col["name"] for col in inspector.get_columns("tickets")}
    if "resolution_type" not in ticket_cols:
        with op.batch_alter_table("tickets") as batch:
            batch.add_column(
                sa.Column(
                    "resolution_type",
                    sa.Enum(
                        "ISSUE_RESOLVED",
                        "DUPLICATE_ISSUE",
                        "ISSUE_NOT_SOLVED",
                        name="ticket_resolution_enum",
                    ),
                    nullable=True,
                )
            )

    if "ticket_status_history" not in inspector.get_table_names():
        op.create_table(
            "ticket_status_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("from_status", sa.String(length=50), nullable=True),
            sa.Column("to_status", sa.String(length=50), nullable=False),
            sa.Column("actor_user_id", sa.String(length=36), nullable=True),
            sa.Column("moved_at_utc", sa.DateTime(timezone=True), nullable=False),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_ticket_status_history_ticket",
            "ticket_status_history",
            ["tenant_id", "ticket_id"],
        )

    if "ticket_approval_cycles" not in inspector.get_table_names():
        op.create_table(
            "ticket_approval_cycles",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "approval_type",
                sa.Enum("SEQUENTIAL", "PARALLEL", name="ticket_approval_type_enum"),
                nullable=False,
            ),
            sa.Column("deadline_utc", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attempts_left", sa.Integer(), nullable=False),
            sa.Column(
                "status",
                sa.Enum(
                    "PENDING",
                    "APPROVED",
                    "REJECTED",
                    "OVERDUE",
                    "ESCALATED",
                    name="ticket_approval_cycle_status_enum",
                ),
                nullable=False,
                server_default=sa.text("'PENDING'"),
            ),
            sa.Column("requested_by", sa.String(length=36), nullable=False),
            sa.Column("requested_at_utc", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at_utc", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_ticket_approval_cycles_ticket",
            "ticket_approval_cycles",
            ["tenant_id", "ticket_id"],
        )

    if "ticket_approval_items" not in inspector.get_table_names():
        op.create_table(
            "ticket_approval_items",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("cycle_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("approver_user_id", sa.String(length=36), nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column(
                "status",
                sa.Enum(
                    "PENDING",
                    "APPROVED",
                    "REJECTED",
                    "OVERDUE",
                    name="ticket_approval_item_status_enum",
                ),
                nullable=False,
                server_default=sa.text("'PENDING'"),
            ),
            sa.Column("acted_at_utc", sa.DateTime(timezone=True), nullable=True),
            sa.Column("order_index", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["cycle_id"], ["ticket_approval_cycles.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_ticket_approval_items_cycle",
            "ticket_approval_items",
            ["tenant_id", "cycle_id"],
        )

    if "ticket_tasks" not in inspector.get_table_names():
        op.create_table(
            "ticket_tasks",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column(
                "status",
                sa.Enum(
                    "OPEN",
                    "IN_PROGRESS",
                    "COMPLETED",
                    name="ticket_task_status_enum",
                ),
                nullable=False,
                server_default=sa.text("'OPEN'"),
            ),
            sa.Column("assigned_to", sa.String(length=36), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("due_at_utc", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "priority",
                sa.Enum(
                    "LOW",
                    "MEDIUM",
                    "HIGH",
                    "CRITICAL",
                    name="ticket_task_priority_enum",
                ),
                nullable=False,
                server_default=sa.text("'MEDIUM'"),
            ),
            sa.Column("points", sa.Integer(), nullable=False),
            sa.Column("completed_at_utc", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at_utc",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at_utc",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_ticket_tasks_ticket",
            "ticket_tasks",
            ["tenant_id", "ticket_id"],
        )

    if "points_ledger" not in inspector.get_table_names():
        op.create_table(
            "points_ledger",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("points", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(length=255), nullable=False),
            sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(length=36), nullable=True),
        )
        op.create_index(
            "ix_points_ledger_user",
            "points_ledger",
            ["tenant_id", "user_id"],
        )

    if "ticket_audit_logs" not in inspector.get_table_names():
        op.create_table(
            "ticket_audit_logs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("event_type", sa.String(length=255), nullable=False),
            sa.Column("actor_user_id", sa.String(length=36), nullable=True),
            sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("payload_json", sa.JSON(), nullable=True),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_ticket_audit_logs_ticket",
            "ticket_audit_logs",
            ["tenant_id", "ticket_id"],
        )

    delivery_cols = {col["name"] for col in inspector.get_columns("webhook_delivery_logs")}
    with op.batch_alter_table("webhook_delivery_logs") as batch:
        if "request_body" not in delivery_cols:
            batch.add_column(sa.Column("request_body", sa.JSON(), nullable=True))
        if "last_attempt_at" not in delivery_cols:
            batch.add_column(sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    with op.batch_alter_table("webhook_delivery_logs") as batch:
        batch.drop_column("last_attempt_at")
        batch.drop_column("request_body")

    op.drop_index("ix_ticket_audit_logs_ticket", table_name="ticket_audit_logs")
    op.drop_table("ticket_audit_logs")

    op.drop_index("ix_points_ledger_user", table_name="points_ledger")
    op.drop_table("points_ledger")

    op.drop_index("ix_ticket_tasks_ticket", table_name="ticket_tasks")
    op.drop_table("ticket_tasks")

    op.drop_index("ix_ticket_approval_items_cycle", table_name="ticket_approval_items")
    op.drop_table("ticket_approval_items")

    op.drop_index("ix_ticket_approval_cycles_ticket", table_name="ticket_approval_cycles")
    op.drop_table("ticket_approval_cycles")

    op.drop_index("ix_ticket_status_history_ticket", table_name="ticket_status_history")
    op.drop_table("ticket_status_history")

    with op.batch_alter_table("tickets") as batch:
        batch.drop_column("resolution_type")

    ticket_resolution_enum = postgresql.ENUM(
        "ISSUE_RESOLVED",
        "DUPLICATE_ISSUE",
        "ISSUE_NOT_SOLVED",
        name="ticket_resolution_enum",
    )
    ticket_approval_cycle_status_enum = postgresql.ENUM(
        "PENDING",
        "APPROVED",
        "REJECTED",
        "OVERDUE",
        "ESCALATED",
        name="ticket_approval_cycle_status_enum",
    )
    ticket_approval_item_status_enum = postgresql.ENUM(
        "PENDING",
        "APPROVED",
        "REJECTED",
        "OVERDUE",
        name="ticket_approval_item_status_enum",
    )
    ticket_task_status_enum = postgresql.ENUM(
        "OPEN",
        "IN_PROGRESS",
        "COMPLETED",
        name="ticket_task_status_enum",
    )
    ticket_task_priority_enum = postgresql.ENUM(
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
        name="ticket_task_priority_enum",
    )

    ticket_task_priority_enum.drop(bind, checkfirst=True)
    ticket_task_status_enum.drop(bind, checkfirst=True)
    ticket_approval_item_status_enum.drop(bind, checkfirst=True)
    ticket_approval_cycle_status_enum.drop(bind, checkfirst=True)
    ticket_resolution_enum.drop(bind, checkfirst=True)
