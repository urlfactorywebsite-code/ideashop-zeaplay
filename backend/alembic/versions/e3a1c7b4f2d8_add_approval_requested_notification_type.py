"""add approval requested notification type

Revision ID: e3a1c7b4f2d8
Revises: d2f4a8b1c0e9, b7c2d9e1a0f4
Create Date: 2026-02-06 22:10:00.000000
"""

from alembic import op


revision = "e3a1c7b4f2d8"
down_revision = ("d2f4a8b1c0e9", "b7c2d9e1a0f4")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED'")


def downgrade() -> None:
    # Enum value removal is not supported in PostgreSQL without recreating the type.
    pass
