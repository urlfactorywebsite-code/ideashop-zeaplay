"""Tenant navigation policy, additive and empty by default."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'ffd3a4b5c6d7'
down_revision = 'ffc2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('navigation_policies',
        sa.Column('tenant_id', sa.String(64), primary_key=True),
        sa.Column('rules', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('updated_by', sa.String(36), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table('navigation_policies')
