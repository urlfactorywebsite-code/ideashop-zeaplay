"""fix notification entity enum values

Revision ID: f6a1d2c3b4e5
Revises: f4b1c2d3e4f5
Create Date: 2026-02-07 10:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f6a1d2c3b4e5"
down_revision = "f4b1c2d3e4f5"
branch_labels = None
depends_on = None


notification_entity_type_enum = postgresql.ENUM(
    "ticket",
    "task",
    "approval",
    name="notification_entity_type_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    notification_entity_type_enum.create(bind, checkfirst=True)

    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'ticket'")
        op.execute("ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'task'")
        op.execute("ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'approval'")

    if "notifications" in inspector.get_table_names():
        op.execute(
            "UPDATE notifications "
            "SET entity_type = lower(entity_type::text)::notification_entity_type_enum "
            "WHERE entity_type IS NOT NULL"
        )


def downgrade() -> None:
    pass
