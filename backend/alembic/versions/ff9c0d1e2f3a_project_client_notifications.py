"""Add project/client notification labels without changing existing values."""
from alembic import op


revision = "ff9c0d1e2f3a"
down_revision = "ff8b9c0d1e2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        for label in ("PROJECT_CREATED", "PROJECT_UPDATED", "CLIENT_CREATED", "CLIENT_UPDATED"):
            op.execute(f"ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS '{label}'")
        for label in ("project", "client"):
            op.execute(f"ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS '{label}'")


def downgrade() -> None:
    # PostgreSQL enum labels may be referenced by retained notification history.
    pass
