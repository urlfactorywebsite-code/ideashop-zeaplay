"""Add optional civil due dates without changing existing subtask statuses."""
import sqlalchemy as sa
from alembic import op

revision = "fff6d7e8f9a0"
down_revision = "f44ab1c2d3e4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("subtasks", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade():
    op.drop_column("subtasks", "due_date")
