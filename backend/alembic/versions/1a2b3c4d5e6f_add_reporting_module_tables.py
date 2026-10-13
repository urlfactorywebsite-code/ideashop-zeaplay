"""add reporting module tables

Revision ID: 1a2b3c4d5e6f
Revises: f6a1d2c3b4e5
Create Date: 2026-02-14 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "1a2b3c4d5e6f"
down_revision = "f6a1d2c3b4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "employee_day_sessions" not in existing_tables:
        op.create_table(
            "employee_day_sessions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("employee_id", sa.String(length=36), nullable=False),
            sa.Column("manager_id", sa.String(length=36), nullable=True),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'open'")),
            sa.Column(
                "metadata_payload",
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
                "employee_id",
                "report_date",
                name="uq_session_employee_date",
            ),
        )
        op.create_index(
            "ix_employee_day_sessions_tenant_employee_date",
            "employee_day_sessions",
            ["tenant_id", "employee_id", "report_date"],
        )

    if "hourly_report_slots" not in existing_tables:
        op.create_table(
            "hourly_report_slots",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("slot_hour", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'pending'")),
            sa.Column(
                "reminder_state",
                sa.String(length=40),
                nullable=False,
                server_default=sa.text("'idle'"),
            ),
            sa.Column("last_reminder_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "payload",
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
                "session_id",
                "slot_hour",
                name="uq_slot_session_hour",
            ),
        )
        op.create_index(
            "ix_hourly_report_slots_session_hour",
            "hourly_report_slots",
            ["tenant_id", "session_id", "slot_hour"],
        )

    if "sales_visits" not in existing_tables:
        op.create_table(
            "sales_visits",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("employee_id", sa.String(length=36), nullable=False),
            sa.Column("manager_id", sa.String(length=36), nullable=True),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("location_name", sa.String(length=200), nullable=True),
            sa.Column("checkin_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("checkin_lat", sa.String(length=40), nullable=True),
            sa.Column("checkin_lng", sa.String(length=40), nullable=True),
            sa.Column("checkout_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("checkout_lat", sa.String(length=40), nullable=True),
            sa.Column("checkout_lng", sa.String(length=40), nullable=True),
            sa.Column("checkin_photo_id", sa.String(length=120), nullable=True),
            sa.Column("checkout_photo_id", sa.String(length=120), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
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
            "ix_sales_visits_manager_dashboard",
            "sales_visits",
            ["tenant_id", "department_id", "manager_id"],
        )

    if "report_templates" not in existing_tables:
        op.create_table(
            "report_templates",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("description", sa.String(length=400), nullable=True),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "config",
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
        )
        op.create_index(
            "ix_report_templates_tenant_department",
            "report_templates",
            ["tenant_id", "department_id"],
        )

    if "daily_reports" not in existing_tables:
        op.create_table(
            "daily_reports",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("template_id", sa.String(length=36), nullable=True),
            sa.Column("employee_id", sa.String(length=36), nullable=False),
            sa.Column("manager_id", sa.String(length=36), nullable=True),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'draft'")),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "payload",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
            sa.Column("rendered_html", sa.Text(), nullable=True),
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
            "ix_daily_reports_manager_dashboard",
            "daily_reports",
            ["tenant_id", "department_id", "manager_id", "report_date", "status"],
        )

    if "report_comments" not in existing_tables:
        op.create_table(
            "report_comments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("report_id", sa.String(length=36), nullable=False),
            sa.Column("manager_id", sa.String(length=36), nullable=False),
            sa.Column("comment", sa.Text(), nullable=False),
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
            "ix_report_comments_report_manager",
            "report_comments",
            ["tenant_id", "report_id", "manager_id"],
        )

    if "reporting_audit_events" not in existing_tables:
        op.create_table(
            "reporting_audit_events",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("event_type", sa.String(length=80), nullable=False),
            sa.Column("entity_type", sa.String(length=80), nullable=False),
            sa.Column("entity_id", sa.String(length=36), nullable=False),
            sa.Column("actor_id", sa.String(length=36), nullable=True),
            sa.Column(
                "metadata_payload",
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
        )
        op.create_index(
            "ix_reporting_audit_events_entity",
            "reporting_audit_events",
            ["tenant_id", "entity_type", "entity_id"],
        )

    if "report_notifications" not in existing_tables:
        op.create_table(
            "report_notifications",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("report_id", sa.String(length=36), nullable=False),
            sa.Column("channel", sa.String(length=40), nullable=False),
            sa.Column("recipient", sa.String(length=120), nullable=False),
            sa.Column("idempotency_key", sa.String(length=120), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'queued'")),
            sa.Column(
                "payload",
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
                "idempotency_key",
                name="uq_report_notifications_idempotency",
            ),
        )
        op.create_index(
            "ix_report_notifications_tenant_report",
            "report_notifications",
            ["tenant_id", "report_id"],
        )

    if "report_leaderboard_entries" not in existing_tables:
        op.create_table(
            "report_leaderboard_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("employee_id", sa.String(length=36), nullable=False),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("report_date", sa.Date(), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False, server_default=sa.text("0")),
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
            "ix_report_leaderboard_department_date",
            "report_leaderboard_entries",
            ["tenant_id", "department_id", "report_date"],
        )

    if "weekly_report_summaries" not in existing_tables:
        op.create_table(
            "weekly_report_summaries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", sa.String(length=36), nullable=False),
            sa.Column("department_id", sa.String(length=36), nullable=True),
            sa.Column("manager_id", sa.String(length=36), nullable=True),
            sa.Column("week_start", sa.Date(), nullable=False),
            sa.Column("week_end", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default=sa.text("'open'")),
            sa.Column(
                "payload",
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
        )
        op.create_index(
            "ix_weekly_report_summaries_manager",
            "weekly_report_summaries",
            ["tenant_id", "department_id", "manager_id", "week_start"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "weekly_report_summaries" in existing_tables:
        op.drop_index("ix_weekly_report_summaries_manager", table_name="weekly_report_summaries")
        op.drop_table("weekly_report_summaries")
    if "report_leaderboard_entries" in existing_tables:
        op.drop_index("ix_report_leaderboard_department_date", table_name="report_leaderboard_entries")
        op.drop_table("report_leaderboard_entries")
    if "reporting_audit_events" in existing_tables:
        op.drop_index("ix_reporting_audit_events_entity", table_name="reporting_audit_events")
        op.drop_table("reporting_audit_events")
    if "report_notifications" in existing_tables:
        op.drop_index("ix_report_notifications_tenant_report", table_name="report_notifications")
        op.drop_table("report_notifications")
    if "report_comments" in existing_tables:
        op.drop_index("ix_report_comments_report_manager", table_name="report_comments")
        op.drop_table("report_comments")
    if "daily_reports" in existing_tables:
        op.drop_index("ix_daily_reports_manager_dashboard", table_name="daily_reports")
        op.drop_table("daily_reports")
    if "report_templates" in existing_tables:
        op.drop_index("ix_report_templates_tenant_department", table_name="report_templates")
        op.drop_table("report_templates")
    if "sales_visits" in existing_tables:
        op.drop_index("ix_sales_visits_manager_dashboard", table_name="sales_visits")
        op.drop_table("sales_visits")
    if "hourly_report_slots" in existing_tables:
        op.drop_index("ix_hourly_report_slots_session_hour", table_name="hourly_report_slots")
        op.drop_table("hourly_report_slots")
    if "employee_day_sessions" in existing_tables:
        op.drop_index("ix_employee_day_sessions_tenant_employee_date", table_name="employee_day_sessions")
        op.drop_table("employee_day_sessions")
