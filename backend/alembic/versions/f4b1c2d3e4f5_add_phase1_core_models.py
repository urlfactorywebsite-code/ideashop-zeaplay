"""add phase 1 core models

Revision ID: f4b1c2d3e4f5
Revises: e3a1c7b4f2d8
Create Date: 2026-02-07 09:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f4b1c2d3e4f5"
down_revision = "e3a1c7b4f2d8"
branch_labels = None
depends_on = None


task_approval_status_enum = postgresql.ENUM(
    "none",
    "pending",
    "approved",
    "rejected",
    name="task_approval_status_enum",
    create_type=False,
)

approval_scope_type_enum = postgresql.ENUM(
    "ticket",
    "task",
    "override_close",
    name="approval_scope_type_enum",
    create_type=False,
)

approval_status_enum = postgresql.ENUM(
    "pending",
    "approved",
    "rejected",
    "cancelled",
    name="approval_status_enum",
    create_type=False,
)

ticket_overall_approval_status_enum = postgresql.ENUM(
    "none",
    "pending",
    "approved",
    "rejected",
    name="ticket_overall_approval_status_enum",
    create_type=False,
)

ticket_close_reason_enum = postgresql.ENUM(
    "resolved",
    "not_solved",
    "duplicate",
    name="ticket_close_reason_enum",
    create_type=False,
)

notification_entity_type_enum = postgresql.ENUM(
    "ticket",
    "task",
    "approval",
    name="notification_entity_type_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    task_approval_status_enum.create(bind, checkfirst=True)
    approval_scope_type_enum.create(bind, checkfirst=True)
    approval_status_enum.create(bind, checkfirst=True)
    ticket_overall_approval_status_enum.create(bind, checkfirst=True)
    ticket_close_reason_enum.create(bind, checkfirst=True)
    notification_entity_type_enum.create(bind, checkfirst=True)

    # Ensure enum values exist even if the type pre-dates this migration.
    # Postgres requires an autocommit block before using new enum values.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE task_approval_status_enum ADD VALUE IF NOT EXISTS 'none'")
        op.execute("ALTER TYPE task_approval_status_enum ADD VALUE IF NOT EXISTS 'pending'")
        op.execute("ALTER TYPE task_approval_status_enum ADD VALUE IF NOT EXISTS 'approved'")
        op.execute("ALTER TYPE task_approval_status_enum ADD VALUE IF NOT EXISTS 'rejected'")

        op.execute("ALTER TYPE ticket_overall_approval_status_enum ADD VALUE IF NOT EXISTS 'none'")
        op.execute("ALTER TYPE ticket_overall_approval_status_enum ADD VALUE IF NOT EXISTS 'pending'")
        op.execute("ALTER TYPE ticket_overall_approval_status_enum ADD VALUE IF NOT EXISTS 'approved'")
        op.execute("ALTER TYPE ticket_overall_approval_status_enum ADD VALUE IF NOT EXISTS 'rejected'")

    if "tasks" in existing_tables:
        task_cols = {col["name"] for col in inspector.get_columns("tasks")}
        if "ticket_id" not in task_cols:
            op.add_column(
                "tasks",
                sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_tasks_ticket_id",
                "tasks",
                "tickets",
                ["ticket_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "approval_required" not in task_cols:
            op.add_column(
                "tasks",
                sa.Column(
                    "approval_required",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("false"),
                ),
            )
        if "approval_status" not in task_cols:
            op.add_column(
                "tasks",
                sa.Column(
                    "approval_status",
                    task_approval_status_enum,
                    nullable=False,
                    server_default=sa.text("'none'"),
                ),
            )
        if "approver_id" not in task_cols:
            op.add_column(
                "tasks",
                sa.Column("approver_id", sa.String(length=36), nullable=True),
            )
            op.create_foreign_key(
                "fk_tasks_approver_id",
                "tasks",
                "users",
                ["approver_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if "tickets" in existing_tables:
        ticket_cols = {col["name"] for col in inspector.get_columns("tickets")}
        if "sla_hours" not in ticket_cols:
            op.add_column("tickets", sa.Column("sla_hours", sa.Integer(), nullable=True))
        if "approval_status" not in ticket_cols:
            op.add_column(
                "tickets",
                sa.Column(
                    "approval_status",
                    ticket_overall_approval_status_enum,
                    nullable=False,
                    server_default=sa.text("'none'"),
                ),
            )

    if "task_messages" not in existing_tables:
        op.create_table(
            "task_messages",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("task_id", sa.String(length=36), nullable=False),
            sa.Column("author_id", sa.String(length=36), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column(
                "mentions",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
            sa.Column(
                "is_deleted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "approvals" not in existing_tables:
        op.create_table(
            "approvals",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("scope_type", approval_scope_type_enum, nullable=False),
            sa.Column("scope_id", sa.String(length=36), nullable=False),
            sa.Column("requested_by", sa.String(length=36), nullable=False),
            sa.Column("approver_id", sa.String(length=36), nullable=True),
            sa.Column("order_index", sa.Integer(), nullable=True),
            sa.Column(
                "status",
                approval_status_enum,
                nullable=False,
                server_default=sa.text("'pending'"),
            ),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column(
                "sla_hours",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("12"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["approver_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "notifications" in existing_tables:
        notification_cols = {col["name"] for col in inspector.get_columns("notifications")}
        if "title" not in notification_cols:
            op.add_column("notifications", sa.Column("title", sa.String(length=255), nullable=True))
        if "body" not in notification_cols:
            op.add_column("notifications", sa.Column("body", sa.Text(), nullable=True))
        if "entity_type" not in notification_cols:
            op.add_column(
                "notifications",
                sa.Column("entity_type", notification_entity_type_enum, nullable=True),
            )
        if "entity_id" not in notification_cols:
            op.add_column("notifications", sa.Column("entity_id", sa.String(length=36), nullable=True))
        if "deep_link" not in notification_cols:
            op.add_column(
                "notifications",
                sa.Column("deep_link", sa.String(length=1024), nullable=True),
            )

    if "audit_events" not in existing_tables:
        op.create_table(
            "audit_events",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("actor_id", sa.String(length=36), nullable=True),
            sa.Column("event_type", sa.String(length=255), nullable=False),
            sa.Column("entity_type", sa.String(length=100), nullable=False),
            sa.Column("entity_id", sa.String(length=36), nullable=False),
            sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "ticket_close_events" not in existing_tables:
        op.create_table(
            "ticket_close_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("closed_by", sa.String(length=36), nullable=False),
            sa.Column("close_reason", ticket_close_reason_enum, nullable=False),
            sa.Column("duplicate_ticket_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["duplicate_ticket_id"], ["tickets.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["closed_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "ticket_close_events" in existing_tables:
        op.drop_table("ticket_close_events")

    if "audit_events" in existing_tables:
        op.drop_table("audit_events")

    if "notifications" in existing_tables:
        with op.batch_alter_table("notifications") as batch:
            notification_cols = {col["name"] for col in inspector.get_columns("notifications")}
            if "deep_link" in notification_cols:
                batch.drop_column("deep_link")
            if "entity_id" in notification_cols:
                batch.drop_column("entity_id")
            if "entity_type" in notification_cols:
                batch.drop_column("entity_type")
            if "body" in notification_cols:
                batch.drop_column("body")
            if "title" in notification_cols:
                batch.drop_column("title")

    if "approvals" in existing_tables:
        op.drop_table("approvals")

    if "task_messages" in existing_tables:
        op.drop_table("task_messages")

    if "tickets" in existing_tables:
        with op.batch_alter_table("tickets") as batch:
            ticket_cols = {col["name"] for col in inspector.get_columns("tickets")}
            if "approval_status" in ticket_cols:
                batch.drop_column("approval_status")
            if "sla_hours" in ticket_cols:
                batch.drop_column("sla_hours")

    if "tasks" in existing_tables:
        with op.batch_alter_table("tasks") as batch:
            task_cols = {col["name"] for col in inspector.get_columns("tasks")}
            task_fks = {fk["name"] for fk in inspector.get_foreign_keys("tasks")}
            if "approver_id" in task_cols:
                if "fk_tasks_approver_id" in task_fks:
                    batch.drop_constraint("fk_tasks_approver_id", type_="foreignkey")
                batch.drop_column("approver_id")
            if "approval_status" in task_cols:
                batch.drop_column("approval_status")
            if "approval_required" in task_cols:
                batch.drop_column("approval_required")
            if "ticket_id" in task_cols:
                if "fk_tasks_ticket_id" in task_fks:
                    batch.drop_constraint("fk_tasks_ticket_id", type_="foreignkey")
                batch.drop_column("ticket_id")

    notification_entity_type_enum.drop(bind, checkfirst=True)
    ticket_close_reason_enum.drop(bind, checkfirst=True)
    ticket_overall_approval_status_enum.drop(bind, checkfirst=True)
    approval_status_enum.drop(bind, checkfirst=True)
    approval_scope_type_enum.drop(bind, checkfirst=True)
    task_approval_status_enum.drop(bind, checkfirst=True)
