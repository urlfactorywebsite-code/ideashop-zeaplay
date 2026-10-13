"""add media file crop metadata and deleted_at columns

Revision ID: 8b9c2d6a4f1e
Revises: 5f2a7c3d1b0e
Create Date: 2026-01-28 10:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "8b9c2d6a4f1e"
down_revision = "5f2a7c3d1b0e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_files", sa.Column("crop_metadata", sa.JSON(), nullable=True))
    op.add_column("media_files", sa.Column("deleted_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("media_files", "deleted_at")
    op.drop_column("media_files", "crop_metadata")
