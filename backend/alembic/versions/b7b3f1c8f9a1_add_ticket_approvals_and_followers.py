"""add ticket approvals and followers

Revision ID: b7b3f1c8f9a1
Revises: 6c2f1a9d5b7e
Create Date: 2026-02-05 18:40:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b7b3f1c8f9a1"
down_revision = "6c2f1a9d5b7e"
branch_labels = None
depends_on = None


ticket_approval_type_enum = postgresql.ENUM(
    "SEQUENTIAL",
    "PARALLEL",
    name="ticket_approval_type_enum",
    create_type=False,
)

ticket_approval_status_enum = postgresql.ENUM(
    "PENDING",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    name="ticket_approval_status_enum",
    create_type=False,
)

ticket_approval_decision_enum = postgresql.ENUM(
    "PENDING",
    "APPROVED",
    "REJECTED",
    name="ticket_approval_decision_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    ticket_approval_type_enum.create(bind, checkfirst=True)
    ticket_approval_status_enum.create(bind, checkfirst=True)
    ticket_approval_decision_enum.create(bind, checkfirst=True)

    inspector = sa.inspect(bind)
    ticket_cols = {col["name"] for col in inspector.get_columns("tickets")}
    existing_tables = set(inspector.get_table_names())

    if "assigned_user_id" not in ticket_cols:
        op.add_column("tickets", sa.Column("assigned_user_id", sa.String(length=36), nullable=True))
    if "due_at" not in ticket_cols:
        op.add_column("tickets", sa.Column("due_at", sa.DateTime(timezone=True), nullable=True))
    if "approval_enabled" not in ticket_cols:
        op.add_column(
            "tickets",
            sa.Column("approval_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "approval_type" not in ticket_cols:
        op.add_column(
            "tickets",
            sa.Column("approval_type", ticket_approval_type_enum, nullable=True),
        )
    if "min_approvals" not in ticket_cols:
        op.add_column("tickets", sa.Column("min_approvals", sa.Integer(), nullable=True))
    if "approval_deadline" not in ticket_cols:
        op.add_column("tickets", sa.Column("approval_deadline", sa.DateTime(timezone=True), nullable=True))
    if "approval_approver_ids" not in ticket_cols:
        op.add_column(
            "tickets",
            sa.Column(
                "approval_approver_ids",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )

    if "ticket_followers" not in existing_tables:
        op.create_table(
            "ticket_followers",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "ticket_id", "user_id", name="uq_ticket_follower"),
        )
        op.create_index("ix_ticket_followers_user", "ticket_followers", ["tenant_id", "user_id"])

    if "ticket_approvals" not in existing_tables:
        op.create_table(
            "ticket_approvals",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("attempt_no", sa.Integer(), nullable=False),
            sa.Column("approval_type", ticket_approval_type_enum, nullable=False),
            sa.Column("min_approvals", sa.Integer(), nullable=False),
            sa.Column(
                "status",
                ticket_approval_status_enum,
                nullable=False,
                server_default=sa.text("'PENDING'"),
            ),
            sa.Column("requested_by", sa.String(length=36), nullable=False),
            sa.Column("approval_deadline", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_ticket_approvals_ticket", "ticket_approvals", ["tenant_id", "ticket_id"])

    if "ticket_approval_users" not in existing_tables:
        op.create_table(
            "ticket_approval_users",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("approval_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column(
                "decision",
                ticket_approval_decision_enum,
                nullable=False,
                server_default=sa.text("'PENDING'"),
            ),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sequence_order", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["approval_id"], ["ticket_approvals.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("approval_id", "user_id", name="uq_ticket_approval_user"),
        )
        op.create_index("ix_ticket_approval_users_ticket", "ticket_approval_users", ["tenant_id", "ticket_id"])


def downgrade() -> None:
    op.drop_index("ix_ticket_approval_users_ticket", table_name="ticket_approval_users")
    op.drop_table("ticket_approval_users")
    op.drop_index("ix_ticket_approvals_ticket", table_name="ticket_approvals")
    op.drop_table("ticket_approvals")
    op.drop_index("ix_ticket_followers_user", table_name="ticket_followers")
    op.drop_table("ticket_followers")

    op.drop_column("tickets", "approval_approver_ids")
    op.drop_column("tickets", "approval_deadline")
    op.drop_column("tickets", "min_approvals")
    op.drop_column("tickets", "approval_type")
    op.drop_column("tickets", "approval_enabled")
    op.drop_column("tickets", "due_at")
    op.drop_column("tickets", "assigned_user_id")

    bind = op.get_bind()
    ticket_approval_decision_enum.drop(bind, checkfirst=True)
    ticket_approval_status_enum.drop(bind, checkfirst=True)
    ticket_approval_type_enum.drop(bind, checkfirst=True)
