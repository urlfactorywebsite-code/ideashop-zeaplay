"""Extend existing user and avatar records, preserving legacy photos and fields."""
import sqlalchemy as sa
from alembic import op

revision = 'ffe4b5c6d7e8'
down_revision = 'ffd3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('profile_bio', sa.String(500), nullable=True))
    op.add_column('avatar_assets', sa.Column('tenant_id', sa.Uuid(), nullable=True))
    op.add_column('avatar_assets', sa.Column('storage_provider', sa.String(32), nullable=True))
    op.add_column('avatar_assets', sa.Column('thumbnail_path', sa.String(500), nullable=True))
    op.create_index('ix_avatar_assets_tenant_id', 'avatar_assets', ['tenant_id'])
    op.execute(sa.text('UPDATE avatar_assets SET tenant_id = (SELECT tenant_id FROM users WHERE users.id = avatar_assets.created_by_id) WHERE created_by_id IS NOT NULL'))
    # Legacy custom photos can outlive their uploader. Recover ownership only
    # when all remaining references belong to exactly one workspace.
    op.execute(sa.text('''UPDATE avatar_assets SET tenant_id =
        (SELECT tenant_id FROM users WHERE users.avatar_asset_id = avatar_assets.id LIMIT 1)
        WHERE tenant_id IS NULL AND is_default = false AND
        (SELECT COUNT(DISTINCT tenant_id) FROM users WHERE users.avatar_asset_id = avatar_assets.id) = 1'''))


def downgrade():
    # Photos written after upgrade require the provider and thumbnail metadata.
    # Refuse a lossy rollback; restore a reviewed backup instead.
    raise RuntimeError('Avatar profile migration is forward-only; restore a reviewed backup to roll back.')
