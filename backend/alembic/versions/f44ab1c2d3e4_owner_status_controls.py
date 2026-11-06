"""Allow owner-managed legacy status visibility and deactivation without changing IDs."""
from alembic import op
import sqlalchemy as sa
try:
    from app import status_owner_schema_v4
except ModuleNotFoundError:
    from backend.app import status_owner_schema_v4

revision = 'f44ab1c2d3e4'
down_revision = 'f339a0b1c2d3'
branch_labels = None
depends_on = None


def upgrade():
    replace_activation_check("NOT is_system OR code NOT IN ('BATTLE_PLAN','IN_PROGRESS','ON_HOLD','CONQUERED') OR is_active")
    status_owner_schema_v4.install(op.get_bind())


def replace_activation_check(expression):
    c = op.get_bind()
    if c.dialect.name == 'sqlite':
        # SQLite table rebuilds require FK checks disabled before BEGIN. Refuse
        # unsafe live rebuilds rather than silently losing references/triggers.
        if c.scalar(sa.text('PRAGMA foreign_keys')):
            raise RuntimeError('SQLite migration requires an offline connection with foreign_keys=OFF before the transaction')
        if not c.connection.driver_connection.in_transaction:
            # Python's SQLite legacy mode does not BEGIN for DDL. Start the
            # transaction explicitly so trigger/table rebuilds roll back too.
            c.exec_driver_sql('BEGIN')
        triggers = list(c.execute(sa.text("SELECT name, sql FROM sqlite_master WHERE type='trigger'")))
        quote = c.dialect.identifier_preparer.quote
        for name, _ in triggers:
            c.execute(sa.text('DROP TRIGGER ' + quote(name)))
        with op.batch_alter_table('task_statuses', recreate='always') as batch:
            batch.drop_constraint('ck_task_status_system_active', type_='check')
            batch.create_check_constraint('ck_task_status_system_active', expression)
        for _, sql in triggers:
            c.execute(sa.text(sql))
        if list(c.execute(sa.text('PRAGMA foreign_key_check'))):
            raise RuntimeError('Status migration foreign key verification failed')
    else:
        op.drop_constraint('ck_task_status_system_active', 'task_statuses', type_='check')
        op.create_check_constraint('ck_task_status_system_active', 'task_statuses', expression)


def downgrade():
    c = op.get_bind()
    if c.scalar(sa.text('SELECT count(*) FROM task_statuses WHERE is_system AND (NOT is_active OR NOT kanban_visible)')):
        raise RuntimeError('Reactivate and show all legacy statuses before downgrading; no records changed')
    try:
        from app import task_status_schema, kanban_schema_v2, status_business_schema_v3
    except ModuleNotFoundError:
        from backend.app import task_status_schema, kanban_schema_v2, status_business_schema_v3
    replace_activation_check('NOT is_system OR is_active')
    status_owner_schema_v4.uninstall(c)
    task_status_schema.install(c)
    kanban_schema_v2.install(c)
    status_business_schema_v3.install(c)
