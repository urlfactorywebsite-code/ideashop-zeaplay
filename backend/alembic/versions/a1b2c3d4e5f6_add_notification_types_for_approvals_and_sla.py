"""add notification types for approvals and sla

Revision ID: a1b2c3d4e5f6
Revises: f4b1c2d3e4f5
Create Date: 2026-02-07 12:30:00.000000
"""

from alembic import op


revision = "a1b2c3d4e5f6"
down_revision = "f4b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TASK_OVERDUE'")
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TICKET_CREATED'")
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TICKET_ASSIGNED'")
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TICKET_CLOSED'")
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'APPROVAL_ACTED'")
    op.execute("ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'SLA_BREACH'")


def downgrade() -> None:
    # Enum value removal is not supported in PostgreSQL without recreating the type.
    pass
