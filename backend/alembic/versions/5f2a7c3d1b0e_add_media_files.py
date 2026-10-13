"""add media files table and profile image columns

Revision ID: 5f2a7c3d1b0e
Revises: c9f9f2b9d2ad
Create Date: 2026-01-28 09:15:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "5f2a7c3d1b0e"
down_revision = "c9f9f2b9d2ad"
branch_labels = None
depends_on = None


media_file_type_enum = postgresql.ENUM(
    "image",
    "video",
    "document",
    "zip",
    "avatar",
    name="media_file_type_enum",
    create_type=False,
)
media_file_status_enum = postgresql.ENUM(
    "pending",
    "confirmed",
    "failed",
    name="media_file_status_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    media_file_type_enum.create(bind, checkfirst=True)
    media_file_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "media_files",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("department_id", sa.String(length=36), nullable=True),
        sa.Column("media_type", media_file_type_enum, nullable=False),
        sa.Column("bucket", sa.String(length=255), nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column(
            "status",
            media_file_status_enum,
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_media_files_user_created", "media_files", ["user_id", "created_at"])
    op.create_index(
        "ix_media_files_department_created",
        "media_files",
        ["department_id", "created_at"],
    )

    op.add_column("users", sa.Column("profile_image_key", sa.String(length=1024), nullable=True))
    op.add_column("users", sa.Column("profile_image_url", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "profile_image_url")
    op.drop_column("users", "profile_image_key")

    op.drop_index("ix_media_files_department_created", table_name="media_files")
    op.drop_index("ix_media_files_user_created", table_name="media_files")
    op.drop_table("media_files")

    bind = op.get_bind()
    media_file_status_enum.drop(bind, checkfirst=True)
    media_file_type_enum.drop(bind, checkfirst=True)
