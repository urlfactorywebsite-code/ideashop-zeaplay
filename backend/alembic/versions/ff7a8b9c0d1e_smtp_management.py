"""Tenant-owned SMTP, encrypted secret capacity and durable attempt records.

Existing global profiles are deliberately disabled/unowned until explicit adoption.
No ownership is inferred and no legacy outcome is fabricated into provider analytics.
"""
from alembic import op
import sqlalchemy as sa

revision = 'ff7a8b9c0d1e'
down_revision = 'fe6f7a8b9c0d'
branch_labels = None
depends_on = None


def profile_columns():
    return [sa.Column('tenant_id', sa.Uuid(), nullable=True),
        sa.Column('provider', sa.String(40), nullable=False, server_default='custom'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('auth_method', sa.String(20), nullable=False, server_default='password'),
        sa.Column('sender_name', sa.String(120), nullable=True), sa.Column('sender_email', sa.String(255), nullable=True),
        sa.Column('reply_to', sa.String(255), nullable=True),
        sa.Column('rate_limit_per_minute', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('daily_limit', sa.Integer(), nullable=False, server_default='1000'),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_test_ok', sa.Boolean(), nullable=True), sa.Column('last_test_code', sa.String(50), nullable=True)]


def upgrade():
    for table in ('smtp_config', 'multiple_smtp_configs'):
        with op.batch_alter_table(table) as batch:
            for column in profile_columns():
                batch.add_column(column)
            batch.alter_column('password', existing_type=sa.String(255), type_=sa.Text(), existing_nullable=True)
        op.create_index('ix_' + table + '_tenant_id', table, ['tenant_id'])
    with op.batch_alter_table('smtp_config') as batch:
        batch.add_column(sa.Column('name', sa.String(120), nullable=False, server_default='Primary SMTP'))
        batch.add_column(sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))
        batch.add_column(sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))
        batch.add_column(sa.Column('notification_types', sa.JSON(), nullable=False, server_default='["general"]'))
    op.create_index('uq_primary_smtp_tenant', 'smtp_config', ['tenant_id'], unique=True)
    op.create_index('uq_smtp_tenant_name_ci', 'multiple_smtp_configs', ['tenant_id', sa.text('lower(name)')], unique=True)
    op.create_table('smtp_delivery_attempts',
        sa.Column('id', sa.String(36), primary_key=True), sa.Column('tenant_id', sa.Uuid(), nullable=False),
        sa.Column('profile_key', sa.String(60), nullable=False), sa.Column('outbox_id', sa.String(36), nullable=True),
        sa.Column('category', sa.String(100), nullable=False), sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('outcome', sa.String(30), nullable=False), sa.Column('code', sa.String(50), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False), sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_smtp_attempt_quota', 'smtp_delivery_attempts', ['profile_key', 'kind', 'started_at'])
    op.create_index('ix_smtp_attempt_tenant', 'smtp_delivery_attempts', ['tenant_id', 'started_at'])
    op.add_column('notification_outbox', sa.Column('delivery_state', sa.String(20), nullable=False, server_default='queued'))
    op.add_column('notification_outbox', sa.Column('claim_token', sa.String(36), nullable=True))
    op.execute(sa.text("""UPDATE notification_outbox SET delivery_state = CASE
        WHEN status = 'SENT' THEN 'sent' WHEN status = 'SENDING' THEN 'uncertain'
        WHEN status = 'FAILED' AND next_attempt_at IS NOT NULL AND attempts < max_attempts THEN 'retrying'
        WHEN status = 'FAILED' THEN 'failed' ELSE 'queued' END"""))
    op.execute(sa.text("UPDATE notification_outbox SET status='FAILED', next_attempt_at=NULL WHERE delivery_state='uncertain'"))


def downgrade():
    if op.get_context().as_sql:
        raise RuntimeError('SMTP downgrade requires an online data-safety check')
    connection = op.get_bind()
    if connection.scalar(sa.text('SELECT 1 FROM smtp_delivery_attempts LIMIT 1')):
        raise RuntimeError('SMTP attempt history exists; retain schema and deploy a compatible forward fix')
    for table in ('smtp_config', 'multiple_smtp_configs'):
        if connection.scalar(sa.text(f"SELECT 1 FROM {table} WHERE tenant_id IS NOT NULL OR password LIKE 'smtp:v1:%' LIMIT 1")):
            raise RuntimeError('SMTP tenant ownership/encrypted credentials exist; downgrade is unsafe')
    op.drop_column('notification_outbox', 'claim_token')
    op.drop_column('notification_outbox', 'delivery_state')
    op.drop_table('smtp_delivery_attempts')
    op.drop_index('uq_smtp_tenant_name_ci', table_name='multiple_smtp_configs')
    op.drop_index('uq_primary_smtp_tenant', table_name='smtp_config')
    with op.batch_alter_table('smtp_config') as batch:
        for name in ('name', 'created_at', 'updated_at', 'notification_types'):
            batch.drop_column(name)
    for table in ('smtp_config', 'multiple_smtp_configs'):
        op.drop_index('ix_' + table + '_tenant_id', table_name=table)
        with op.batch_alter_table(table) as batch:
            for column in profile_columns():
                batch.drop_column(column.name)
            batch.alter_column('password', existing_type=sa.Text(), type_=sa.String(255), existing_nullable=True)
