"""add notification outbox

Revision ID: fa2b3c4d5e6f
Revises: f9c1d2e3a4b5
Create Date: 2026-10-13 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "fa2b3c4d5e6f"
down_revision = "f9c1d2e3a4b5"
branch_labels = None
depends_on = None


notification_outbox_status = sa.Enum("PENDING", "SENDING", "SENT", "FAILED", name="notificationoutboxstatusenum")
notification_outbox_channel = sa.Enum("EMAIL", name="notificationoutboxchannelenum")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect = bind.dialect.name

    if dialect == "postgresql":
        with op.get_context().autocommit_block():
            for value in (
                "SUBTASK_ACTIVATED",
                "SUBTASK_REASSIGNED",
                "SUBTASK_APPROVED",
                "SUBTASK_REJECTED",
                "SUBTASK_FORCE_STARTED",
                "SUBTASK_REVIEW_REQUIRED",
                "MENTION",
            ):
                op.execute(f"ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS '{value}'")
            op.execute("ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'subtask'")

    existing_tables = set(inspector.get_table_names())
    if "notifications" in existing_tables:
        notification_cols = {col["name"] for col in inspector.get_columns("notifications")}
        if "tenant_id" not in notification_cols:
            op.add_column("notifications", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
        if "dedupe_key" not in notification_cols:
            op.add_column("notifications", sa.Column("dedupe_key", sa.String(length=255), nullable=True))
        op.execute(
            "UPDATE notifications SET tenant_id = "
            "(SELECT users.tenant_id FROM users WHERE users.id = notifications.user_id) "
            "WHERE tenant_id IS NULL"
        )
        op.create_index(
            "ix_notifications_tenant_user_created",
            "notifications",
            ["tenant_id", "user_id", "created_at"],
            if_not_exists=True,
        )
        op.create_index(
            "uq_notifications_user_dedupe_key",
            "notifications",
            ["user_id", "dedupe_key"],
            unique=True,
            if_not_exists=True,
            sqlite_where=sa.text("dedupe_key IS NOT NULL"),
            postgresql_where=sa.text("dedupe_key IS NOT NULL"),
        )

    if "notification_outbox" not in existing_tables:
        op.create_table(
            "notification_outbox",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("notification_id", sa.String(length=36), nullable=True),
            sa.Column("recipient_user_id", sa.String(length=36), nullable=False),
            sa.Column("channel", notification_outbox_channel, nullable=False),
            sa.Column("event_type", sa.String(length=100), nullable=False),
            sa.Column("event_id", sa.String(length=255), nullable=False),
            sa.Column("dedupe_key", sa.String(length=255), nullable=False),
            sa.Column("payload", sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"), nullable=False),
            sa.Column("status", notification_outbox_status, nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("dedupe_key", name="uq_notification_outbox_dedupe_key"),
        )
        op.create_index("ix_notification_outbox_event", "notification_outbox", ["event_type", "event_id"])
        op.create_index("ix_notification_outbox_status_next", "notification_outbox", ["status", "next_attempt_at"])
        op.create_index("ix_notification_outbox_tenant_recipient", "notification_outbox", ["tenant_id", "recipient_user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "notification_outbox" in existing_tables:
        op.drop_index("ix_notification_outbox_tenant_recipient", table_name="notification_outbox")
        op.drop_index("ix_notification_outbox_status_next", table_name="notification_outbox")
        op.drop_index("ix_notification_outbox_event", table_name="notification_outbox")
        op.drop_table("notification_outbox")

    if "notifications" in existing_tables:
        indexes = {idx["name"] for idx in inspector.get_indexes("notifications")}
        if "uq_notifications_user_dedupe_key" in indexes:
            op.drop_index("uq_notifications_user_dedupe_key", table_name="notifications")
        if "ix_notifications_tenant_user_created" in indexes:
            op.drop_index("ix_notifications_tenant_user_created", table_name="notifications")
        notification_cols = {col["name"] for col in inspector.get_columns("notifications")}
        with op.batch_alter_table("notifications") as batch:
            if "dedupe_key" in notification_cols:
                batch.drop_column("dedupe_key")
            if "tenant_id" in notification_cols:
                batch.drop_column("tenant_id")

    # PostgreSQL enum value removal is intentionally omitted.
