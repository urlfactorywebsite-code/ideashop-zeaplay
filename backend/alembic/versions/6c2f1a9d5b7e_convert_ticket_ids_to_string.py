"""convert ticket user/task ids to string and add indexes

Revision ID: 6c2f1a9d5b7e
Revises: c9f9f2b9d2ad
Create Date: 2026-02-02 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "6c2f1a9d5b7e"
down_revision = "c9f9f2b9d2ad"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "tickets",
        "created_by",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="created_by::text",
    )
    op.alter_column(
        "tickets",
        "owner_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="owner_id::text",
    )
    op.alter_column(
        "ticket_participants",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="user_id::text",
    )
    op.alter_column(
        "ticket_participants",
        "added_by",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="added_by::text",
    )
    op.alter_column(
        "ticket_comments",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="user_id::text",
    )
    op.alter_column(
        "ticket_comment_mentions",
        "mentioned_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="mentioned_user_id::text",
    )
    op.alter_column(
        "ticket_attachments",
        "uploaded_by",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="uploaded_by::text",
    )
    op.alter_column(
        "ticket_activity_logs",
        "actor_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="actor_id::text",
    )
    op.alter_column(
        "ticket_notifications",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="user_id::text",
    )
    op.alter_column(
        "ticket_task_links",
        "task_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="task_id::text",
    )
    op.alter_column(
        "xp_ledger",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(length=36),
        postgresql_using="user_id::text",
    )

    op.create_index(
        "ix_ticket_participants_tenant_ticket",
        "ticket_participants",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_participants_tenant_user",
        "ticket_participants",
        ["tenant_id", "user_id"],
    )
    op.create_index(
        "ix_ticket_comments_tenant_ticket",
        "ticket_comments",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_comment_mentions_tenant_user",
        "ticket_comment_mentions",
        ["tenant_id", "mentioned_user_id"],
    )
    op.create_index(
        "ix_ticket_attachments_tenant_ticket",
        "ticket_attachments",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_activity_logs_tenant_ticket",
        "ticket_activity_logs",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_task_links_tenant_ticket",
        "ticket_task_links",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_task_links_task_id",
        "ticket_task_links",
        ["task_id"],
    )
    op.create_index(
        "ix_ticket_notifications_tenant_user",
        "ticket_notifications",
        ["tenant_id", "user_id"],
    )
    op.create_index(
        "ix_xp_ledger_tenant_user",
        "xp_ledger",
        ["tenant_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_xp_ledger_tenant_user", table_name="xp_ledger")
    op.drop_index("ix_ticket_notifications_tenant_user", table_name="ticket_notifications")
    op.drop_index("ix_ticket_task_links_task_id", table_name="ticket_task_links")
    op.drop_index("ix_ticket_task_links_tenant_ticket", table_name="ticket_task_links")
    op.drop_index("ix_ticket_activity_logs_tenant_ticket", table_name="ticket_activity_logs")
    op.drop_index("ix_ticket_attachments_tenant_ticket", table_name="ticket_attachments")
    op.drop_index("ix_ticket_comment_mentions_tenant_user", table_name="ticket_comment_mentions")
    op.drop_index("ix_ticket_comments_tenant_ticket", table_name="ticket_comments")
    op.drop_index("ix_ticket_participants_tenant_user", table_name="ticket_participants")
    op.drop_index("ix_ticket_participants_tenant_ticket", table_name="ticket_participants")

    op.alter_column(
        "xp_ledger",
        "user_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="user_id::uuid",
    )
    op.alter_column(
        "ticket_task_links",
        "task_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="task_id::uuid",
    )
    op.alter_column(
        "ticket_notifications",
        "user_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="user_id::uuid",
    )
    op.alter_column(
        "ticket_activity_logs",
        "actor_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="actor_id::uuid",
    )
    op.alter_column(
        "ticket_attachments",
        "uploaded_by",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="uploaded_by::uuid",
    )
    op.alter_column(
        "ticket_comment_mentions",
        "mentioned_user_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="mentioned_user_id::uuid",
    )
    op.alter_column(
        "ticket_comments",
        "user_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="user_id::uuid",
    )
    op.alter_column(
        "ticket_participants",
        "added_by",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="added_by::uuid",
    )
    op.alter_column(
        "ticket_participants",
        "user_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="user_id::uuid",
    )
    op.alter_column(
        "tickets",
        "owner_id",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="owner_id::uuid",
    )
    op.alter_column(
        "tickets",
        "created_by",
        existing_type=sa.String(length=36),
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="created_by::uuid",
    )
