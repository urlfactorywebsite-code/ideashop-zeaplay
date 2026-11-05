"""Indexes for canonical/custom Kanban ordering and retained status history."""
from alembic import op
import sqlalchemy as sa

revision = 'f339a0b1c2d3'
down_revision = 'f228f9a0b1c2'
branch_labels = None
depends_on = None

INDEXES = (
    ('ix_tasks_status_custom_updated_id','tasks',['status','custom_status_id',sa.text('updated_at DESC'),'id']),
    ('ix_status_audit_tenant_created_id','status_configuration_audits',['tenant_id',sa.text('created_at DESC'),'id']),
    ('ix_task_hold_task_started_id','task_hold_intervals',['task_id','started_at','id']),
)


def upgrade():
    # Validate all pre-existing names before making any DDL changes.
    existing={table:{item['name']:item for item in sa.inspect(op.get_bind()).get_indexes(table)} for _,table,_ in INDEXES}
    for name,table,columns in INDEXES:
        expected=[str(column).removesuffix(' DESC') for column in columns]
        if name in existing[table] and existing[table][name]['column_names']!=expected:
            raise RuntimeError('Status index definition requires a reviewed repair: '+name)
    for name,table,columns in INDEXES:
        if name not in existing[table]:
            op.create_index(name,table,columns)


def downgrade():
    # Only these performance indexes are removed. No status/hold/history data changes.
    for name,table,_ in reversed(INDEXES):
        op.drop_index(name,table_name=table)
