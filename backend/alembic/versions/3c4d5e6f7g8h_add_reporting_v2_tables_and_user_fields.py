"""add reporting v2 tables and user fields

Revision ID: 3c4d5e6f7g8h
Revises: 2b3c4d5e6f7g
Create Date: 2026-02-16 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "3c4d5e6f7g8h"
down_revision = "2b3c4d5e6f7g"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("users")}
        if "webex_person_id" not in columns:
            op.add_column("users", sa.Column("webex_person_id", sa.String(length=120), nullable=True))
        if "manager_id" not in columns:
            op.add_column("users", sa.Column("manager_id", sa.String(length=36), nullable=True))
        if "manager_email" not in columns:
            op.add_column("users", sa.Column("manager_email", sa.String(length=255), nullable=True))

    if "report_task_snapshots" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("report_task_snapshots")}
        if "user_id" not in columns:
            op.add_column("report_task_snapshots", sa.Column("user_id", sa.String(length=36), nullable=True))
            op.create_index(
                "ix_report_task_snapshot_user_date",
                "report_task_snapshots",
                ["tenant_id", "user_id", "report_date"],
            )

    if "report_checkins" not in existing_tables:
        op.create_table(
            "report_checkins",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("slot_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("correlation_id", sa.String(length=120), nullable=False),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reply_received", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("retries_sent", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
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
                "correlation_id",
                name="uq_report_checkin_correlation",
            ),
        )
        op.create_index(
            "ix_report_checkins_user_date",
            "report_checkins",
            ["tenant_id", "user_id", "report_date"],
        )

    if "report_email_provider_configs" not in existing_tables:
        op.create_table(
            "report_email_provider_configs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("mode", sa.String(length=20), nullable=False, server_default=sa.text("'smtp'")),
            sa.Column("smtp_host", sa.String(length=255), nullable=True),
            sa.Column("smtp_port", sa.Integer(), nullable=True),
            sa.Column("smtp_user", sa.String(length=255), nullable=True),
            sa.Column("smtp_pass", sa.String(length=255), nullable=True),
            sa.Column("smtp_tls", sa.Boolean(), nullable=True, server_default=sa.text("true")),
            sa.Column("sendgrid_api_key", sa.String(length=255), nullable=True),
            sa.Column("from_email", sa.String(length=255), nullable=True),
            sa.Column("from_name", sa.String(length=255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        )
        op.create_index(
            "ix_report_email_provider_tenant_active",
            "report_email_provider_configs",
            ["tenant_id", "is_active"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "report_email_provider_configs" in existing_tables:
        op.drop_index("ix_report_email_provider_tenant_active", table_name="report_email_provider_configs")
        op.drop_table("report_email_provider_configs")
    if "report_checkins" in existing_tables:
        op.drop_index("ix_report_checkins_user_date", table_name="report_checkins")
        op.drop_table("report_checkins")
    if "report_task_snapshots" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("report_task_snapshots")}
        if "user_id" in columns:
            op.drop_index("ix_report_task_snapshot_user_date", table_name="report_task_snapshots")
            op.drop_column("report_task_snapshots", "user_id")
    if "users" in existing_tables:
        columns = {col["name"] for col in inspector.get_columns("users")}
        if "webex_person_id" in columns:
            op.drop_column("users", "webex_person_id")
        if "manager_id" in columns:
            op.drop_column("users", "manager_id")
        if "manager_email" in columns:
            op.drop_column("users", "manager_email")
