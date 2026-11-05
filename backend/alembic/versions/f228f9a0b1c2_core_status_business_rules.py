"""Audited hold ledger and explicit workflow semantics; retain native status IDs."""
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = 'f228f9a0b1c2'
down_revision = 'f117e8f9a0b1'
branch_labels = None
depends_on = None


def schema():
    try:
        from app import status_business_schema_v3
    except ModuleNotFoundError:
        from backend.app import status_business_schema_v3
    return status_business_schema_v3


def upgrade():
    connection = op.get_bind()
    for column in (
        sa.Column('hold_started_at',sa.DateTime(),nullable=True),
        sa.Column('hold_paused_seconds',sa.Float(),nullable=False,server_default='0'),
        sa.Column('hold_previous_status',sa.String(40),nullable=True),
        sa.Column('hold_reason',sa.String(500),nullable=True),
        sa.Column('status_transitioned_at',sa.DateTime(),nullable=True),
        sa.Column('status_transition_version',sa.Integer(),nullable=False,server_default='0'),
    ):
        op.add_column('tasks',column)
    op.add_column('task_status_scopes',sa.Column('hold_reason_required',sa.Boolean(),nullable=False,server_default=sa.false()))
    op.add_column('task_statuses',sa.Column('workflow_behavior',sa.String(16),nullable=False,server_default='ACTIVE'))
    connection.execute(sa.text(f'UPDATE task_statuses SET workflow_behavior={schema().behavior_case("legacy_status")} WHERE is_system'))
    op.create_table('task_hold_intervals',
        sa.Column('id',sa.String(36),primary_key=True),sa.Column('tenant_id',sa.Uuid(),nullable=False),
        sa.Column('task_id',sa.String(36),nullable=False),sa.Column('started_at',sa.DateTime(),nullable=False),
        sa.Column('ended_at',sa.DateTime(),nullable=True),sa.Column('started_by_id',sa.String(36),nullable=True),
        sa.Column('ended_by_id',sa.String(36),nullable=True),sa.Column('previous_status',sa.String(40),nullable=False),
        sa.Column('previous_custom_status_id',sa.String(36),nullable=True),sa.Column('original_due_at',sa.DateTime(),nullable=True),
        sa.Column('reason',sa.String(500),nullable=True),sa.Column('source',sa.String(40),nullable=False,server_default='transition'),
        sa.CheckConstraint('ended_at IS NULL OR ended_at >= started_at',name='ck_hold_time_order'))
    op.create_index('ix_task_hold_intervals_tenant_id','task_hold_intervals',['tenant_id'])
    op.create_index('ix_task_hold_intervals_task_id','task_hold_intervals',['task_id'])
    op.create_index('uq_task_hold_open','task_hold_intervals',['task_id'],unique=True,
                    postgresql_where=sa.text('ended_at IS NULL'),sqlite_where=sa.text('ended_at IS NULL'))
    # No pre-rollout hold duration is fabricated. Existing holds begin eligible
    # pausing at this cutover, with a durable marker for administrator review.
    cutover = datetime.utcnow()
    holds = sa.Table('task_hold_intervals',sa.MetaData(),sa.Column('tenant_id',sa.Uuid()),autoload_with=connection)
    tasks = sa.Table('tasks',sa.MetaData(),autoload_with=connection)
    projects = sa.Table('projects',sa.MetaData(),sa.Column('tenant_id',sa.Uuid()),autoload_with=connection)
    users = sa.Table('users',sa.MetaData(),sa.Column('tenant_id',sa.Uuid()),autoload_with=connection)
    for row in connection.execute(sa.select(tasks).where(sa.cast(tasks.c.status,sa.String())=='ON_HOLD')).mappings():
        owner = projects if row['project_id'] else users
        tenant = connection.scalar(sa.select(owner.c.tenant_id).where(owner.c.id==(row['project_id'] or row['created_by_id'])))
        connection.execute(holds.insert().values(id=str(uuid4()),tenant_id=tenant,task_id=row['id'],started_at=cutover,
            previous_status='ON_HOLD',previous_custom_status_id=row['custom_status_id'],original_due_at=row['due_at'],
            reason='Legacy hold: eligible pause begins at migration cutover; prior duration requires review.',source='migration:f228f9a0b1c2'))
        connection.execute(tasks.update().where(tasks.c.id==row['id']).values(hold_started_at=cutover,hold_previous_status='ON_HOLD',status_transitioned_at=cutover))
    schema().install(connection)


def downgrade():
    raise RuntimeError('Refusing to discard hold history or effective deadlines. Retain this schema on application rollback, or restore a verified full backup with writers stopped.')
