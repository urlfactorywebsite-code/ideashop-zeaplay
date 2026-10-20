"""Tenant-scoped OAuth storage. Does not import or activate legacy credentials."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = 'ffb1e2f3a4b5'
down_revision = 'ffa0d1e2f3a4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('browser_sessions',
        sa.Column('verifier', sa.String(64), primary_key=True), sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('credentials_version', sa.Integer, nullable=False),
        sa.Column('expires_at', sa.Integer, nullable=False), sa.Column('revoked_at', sa.Integer),
        sa.ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']))
    op.create_index('ix_browser_sessions_expires_at', 'browser_sessions', ['expires_at'])
    op.create_table('oauth_clients',
        sa.Column('id', sa.String(64), primary_key=True), sa.Column('client_id', sa.String(64), nullable=False, unique=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('owner_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(150), nullable=False), sa.Column('description', sa.String(2000), nullable=False),
        sa.Column('category', sa.String(80), nullable=False), sa.Column('client_type', sa.String(16), nullable=False),
        sa.Column('secret_hash', sa.String(255)), sa.Column('secret_expires_at', sa.Integer),
        sa.Column('redirect_uris', sa.JSON, nullable=False), sa.Column('grant_types', sa.JSON, nullable=False),
        sa.Column('scopes', sa.JSON, nullable=False), sa.Column('enabled', sa.Boolean, nullable=False),
        sa.Column('archived', sa.Boolean, nullable=False), sa.Column('created_at', sa.Integer, nullable=False),
        sa.Column('updated_at', sa.Integer, nullable=False), sa.UniqueConstraint('id', 'tenant_id'),
        sa.ForeignKeyConstraint(['owner_id', 'tenant_id'], ['users.id', 'users.tenant_id']))
    op.create_index('ix_oauth_clients_tenant_status', 'oauth_clients', ['tenant_id', 'enabled'])
    op.create_table('oauth_grants',
        sa.Column('id', sa.String(36), primary_key=True), sa.Column('client_id', sa.String(64), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('user_id', sa.String(36)),
        sa.Column('credentials_version', sa.Integer), sa.Column('scopes', sa.JSON, nullable=False),
        sa.Column('created_at', sa.Integer, nullable=False), sa.Column('expires_at', sa.Integer, nullable=False),
        sa.Column('revoked_at', sa.Integer), sa.Column('last_used_at', sa.Integer), sa.UniqueConstraint('id', 'tenant_id'),
        sa.ForeignKeyConstraint(['client_id', 'tenant_id'], ['oauth_clients.id', 'oauth_clients.tenant_id']),
        sa.ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']))
    op.create_index('ix_oauth_grants_tenant_user', 'oauth_grants', ['tenant_id', 'user_id', 'revoked_at'])
    op.create_table('oauth_codes',
        sa.Column('verifier', sa.String(64), primary_key=True), sa.Column('grant_id', sa.String(36), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('redirect_uri', sa.String(2000), nullable=False),
        sa.Column('challenge', sa.String(128), nullable=False), sa.Column('expires_at', sa.Integer, nullable=False),
        sa.Column('consumed_at', sa.Integer),
        sa.ForeignKeyConstraint(['grant_id', 'tenant_id'], ['oauth_grants.id', 'oauth_grants.tenant_id']))
    op.create_index('ix_oauth_codes_expires_at', 'oauth_codes', ['expires_at'])
    op.create_table('oauth_consents',
        sa.Column('verifier', sa.String(64), primary_key=True), sa.Column('client_id', sa.String(64), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('credentials_version', sa.Integer, nullable=False), sa.Column('parameters', sa.JSON, nullable=False),
        sa.Column('expires_at', sa.Integer, nullable=False), sa.Column('consumed_at', sa.Integer),
        sa.ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']),
        sa.ForeignKeyConstraint(['client_id', 'tenant_id'], ['oauth_clients.id', 'oauth_clients.tenant_id']))
    op.create_index('ix_oauth_consents_expires_at', 'oauth_consents', ['expires_at'])
    op.create_table('oauth_tokens',
        sa.Column('id', sa.String(36), primary_key=True), sa.Column('verifier', sa.String(64), nullable=False, unique=True),
        sa.Column('kind', sa.String(16), nullable=False), sa.Column('grant_id', sa.String(36), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False), sa.Column('issuer', sa.String(500), nullable=False),
        sa.Column('audience', sa.String(100), nullable=False), sa.Column('scopes', sa.JSON, nullable=False),
        sa.Column('created_at', sa.Integer, nullable=False), sa.Column('expires_at', sa.Integer, nullable=False),
        sa.Column('consumed_at', sa.Integer), sa.Column('revoked_at', sa.Integer), sa.Column('last_used_at', sa.Integer),
        sa.ForeignKeyConstraint(['grant_id', 'tenant_id'], ['oauth_grants.id', 'oauth_grants.tenant_id']))
    op.create_index('ix_oauth_tokens_expires_at', 'oauth_tokens', ['expires_at'])
    op.create_index('ix_oauth_tokens_tenant_grant', 'oauth_tokens', ['tenant_id', 'grant_id'])
    op.create_table('oauth_events',
        sa.Column('id', sa.String(36), primary_key=True), sa.Column('tenant_id', UUID(as_uuid=True), nullable=False),
        sa.Column('client_id', sa.String(64)), sa.Column('actor_id', sa.String(36)),
        sa.Column('action', sa.String(80), nullable=False), sa.Column('created_at', sa.Integer, nullable=False))
    op.create_index('ix_oauth_events_tenant_time', 'oauth_events', ['tenant_id', 'created_at'])
    op.create_table('oauth_rate_limits', sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('window', sa.Integer, primary_key=True), sa.Column('count', sa.Integer, nullable=False))


def downgrade():
    for name in ['oauth_rate_limits', 'oauth_events', 'oauth_tokens', 'oauth_consents', 'oauth_codes', 'oauth_grants', 'oauth_clients', 'browser_sessions']:
        op.drop_table(name)
