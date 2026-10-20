"""Indexes for OAuth revocation and bounded retention cleanup; no data rewrites."""
from alembic import op

revision = 'ffc2f3a4b5c6'
down_revision = 'ffb1e2f3a4b5'
branch_labels = None
depends_on = None

INDEXES = {
    'ix_oauth_grants_client': ('oauth_grants', ['client_id']),
    'ix_oauth_grants_expiry': ('oauth_grants', ['expires_at']),
    'ix_oauth_grants_revoked': ('oauth_grants', ['revoked_at']),
    'ix_oauth_codes_grant': ('oauth_codes', ['grant_id']),
    'ix_oauth_consents_client': ('oauth_consents', ['client_id']),
    'ix_oauth_tokens_grant': ('oauth_tokens', ['grant_id']),
    'ix_oauth_rate_window': ('oauth_rate_limits', ['window']),
}


def upgrade():
    for name, (table, columns) in INDEXES.items():
        op.create_index(name, table, columns, if_not_exists=True)


def downgrade():
    for name, (table, _) in reversed(list(INDEXES.items())):
        op.drop_index(name, table_name=table)
