"""add subtask completion evidence and approval workflow

Revision ID: f9c1d2e3a4b5
Revises: f8b0c1d2e3a4
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f9c1d2e3a4b5"
down_revision = "f8b0c1d2e3a4"
branch_labels = None
depends_on = None


completion_submission_status_enum = sa.Enum(
    "PENDING_REVIEW",
    "APPROVED",
    "REJECTED",
    "COMPLETED",
    name="completion_submission_status_enum",
)


def _uuid_type() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(length=36), "sqlite")


def upgrade() -> None:
    bind = op.get_bind()
    completion_submission_status_enum.create(bind, checkfirst=True)

    op.add_column(
        "projects",
        sa.Column("subtask_approval_required_default", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("tasks", sa.Column("subtask_approval_required", sa.Boolean(), nullable=True))

    op.create_table(
        "completion_submissions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("subtask_id", sa.String(length=36), nullable=False),
        sa.Column("submitted_by_id", sa.String(length=36), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("description_word_count", sa.Integer(), nullable=False),
        sa.Column("status", completion_submission_status_enum, nullable=False),
        sa.Column("approval_required", sa.Boolean(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("reviewed_by_id", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subtask_id", "task_id"], ["subtasks.id", "subtasks.task_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submitted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_completion_submissions_tenant_id", "completion_submissions", ["tenant_id"])
    op.create_index(
        "ix_completion_submissions_tenant_subtask_created",
        "completion_submissions",
        ["tenant_id", "subtask_id", "created_at"],
    )
    op.create_index("ix_completion_submissions_tenant_task", "completion_submissions", ["tenant_id", "task_id"])
    op.create_index("ix_completion_submissions_tenant_status", "completion_submissions", ["tenant_id", "status"])
    op.create_index(
        "uq_completion_submissions_one_pending_review",
        "completion_submissions",
        ["tenant_id", "task_id", "subtask_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING_REVIEW'"),
        sqlite_where=sa.text("status = 'PENDING_REVIEW'"),
    )

    op.create_table(
        "completion_attachments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("submission_id", sa.String(length=36), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["submission_id"], ["completion_submissions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_completion_attachments_tenant_id", "completion_attachments", ["tenant_id"])
    op.create_index(
        "ix_completion_attachments_tenant_submission",
        "completion_attachments",
        ["tenant_id", "submission_id"],
    )
    op.create_index(
        "ix_completion_attachments_storage_key",
        "completion_attachments",
        ["storage_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_completion_attachments_storage_key", table_name="completion_attachments")
    op.drop_index("ix_completion_attachments_tenant_submission", table_name="completion_attachments")
    op.drop_index("ix_completion_attachments_tenant_id", table_name="completion_attachments")
    op.drop_table("completion_attachments")
    op.drop_index("uq_completion_submissions_one_pending_review", table_name="completion_submissions")
    op.drop_index("ix_completion_submissions_tenant_status", table_name="completion_submissions")
    op.drop_index("ix_completion_submissions_tenant_task", table_name="completion_submissions")
    op.drop_index("ix_completion_submissions_tenant_subtask_created", table_name="completion_submissions")
    op.drop_index("ix_completion_submissions_tenant_id", table_name="completion_submissions")
    op.drop_table("completion_submissions")
    op.drop_column("tasks", "subtask_approval_required")
    op.drop_column("projects", "subtask_approval_required_default")
    completion_submission_status_enum.drop(op.get_bind(), checkfirst=True)
