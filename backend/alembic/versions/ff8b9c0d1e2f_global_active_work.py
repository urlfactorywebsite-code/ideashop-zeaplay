"""Concurrent active work, preserving existing timer intervals and lifecycle history."""
from alembic import op
from app.work_timer_schema import upgrade as install, downgrade as uninstall

revision = "ff8b9c0d1e2f"
down_revision = "ff7a8b9c0d1e"
branch_labels = None
depends_on = None


def upgrade():
    install(op.get_bind())


def downgrade():
    uninstall(op.get_bind())
