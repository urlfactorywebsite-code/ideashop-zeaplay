"""Guarded SMTP-only upgrade for verified legacy installations without Alembic metadata.

Reuses revision ff7a8b9c0d1e through Alembic Operations. Does not stamp or claim a
baseline for unrelated application tables. Stop API/mail workers and back up first.
"""
import argparse
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text

REVISION = 'ff7a8b9c0d1e'
LEGACY = {
    'smtp_config': {'id', 'host', 'port', 'username', 'password', 'encryption'},
    'multiple_smtp_configs': {'id', 'name', 'host', 'port', 'username', 'password', 'encryption',
                              'notification_types', 'created_at', 'updated_at'},
}
PROFILE = {'tenant_id', 'provider', 'priority', 'is_enabled', 'auth_method', 'sender_name',
           'sender_email', 'reply_to', 'rate_limit_per_minute', 'daily_limit',
           'last_test_at', 'last_test_ok', 'last_test_code'}
OUTBOX = {'id', 'status', 'attempts', 'max_attempts', 'next_attempt_at'}


def install(connection, *, apply=False):
    if connection.dialect.name != 'postgresql':
        raise RuntimeError('This guarded legacy operation supports PostgreSQL only')
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('zea:smtp:legacy-install'))"))
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    if 'alembic_version' in tables:
        raise RuntimeError('Version metadata exists; use the normal reviewed Alembic upgrade')
    if not {*LEGACY, 'notification_outbox'}.issubset(tables):
        raise RuntimeError('Required legacy SMTP/outbox tables are missing')
    columns = {table: {item['name']: item for item in inspector.get_columns(table)}
               for table in (*LEGACY, 'notification_outbox')}
    expected = {table: fields | PROFILE for table, fields in LEGACY.items()}
    expected['smtp_config'] |= {'name', 'created_at', 'updated_at', 'notification_types'}
    complete = all(fields.issubset(columns[table]) for table, fields in expected.items())
    complete = complete and {'delivery_state', 'claim_token'}.issubset(columns['notification_outbox'])
    complete = complete and 'smtp_delivery_attempts' in tables
    if complete:
        required_attempt = {'id', 'tenant_id', 'profile_key', 'outbox_id', 'category', 'kind', 'outcome', 'code', 'started_at', 'finished_at'}
        if not required_attempt.issubset({item['name'] for item in inspector.get_columns('smtp_delivery_attempts')}):
            raise RuntimeError('SMTP attempt schema is incomplete; inspect before continuing')
        for table, required in {
            'smtp_config': {'uq_primary_smtp_tenant', 'ix_smtp_config_tenant_id'},
            'multiple_smtp_configs': {'uq_smtp_tenant_name_ci', 'ix_multiple_smtp_configs_tenant_id'},
            'smtp_delivery_attempts': {'ix_smtp_attempt_quota', 'ix_smtp_attempt_tenant'},
        }.items():
            if not required.issubset({item['name'] for item in inspector.get_indexes(table)}):
                raise RuntimeError('SMTP indexes are incomplete; inspect before continuing')
        if any(str(columns[table]['password']['type']).upper() != 'TEXT' for table in LEGACY):
            raise RuntimeError('SMTP secret columns are incomplete; inspect before continuing')
        return 'already_compatible'
    # Fail closed for partial/unknown layouts; never opportunistically repair them.
    for table, fields in LEGACY.items():
        if set(columns[table]) != fields or str(columns[table]['password']['type']).upper() != 'VARCHAR(255)':
            raise RuntimeError('Unexpected or partially upgraded SMTP schema; no changes applied')
        if set(inspector.get_pk_constraint(table)['constrained_columns']) != {'id'}:
            raise RuntimeError('Unexpected SMTP primary key; no changes applied')
    if not OUTBOX.issubset(columns['notification_outbox']) or {'delivery_state', 'claim_token'} & columns['notification_outbox'].keys() or 'smtp_delivery_attempts' in tables:
        raise RuntimeError('Unexpected or partially upgraded outbox schema; no changes applied')
    if not apply:
        return 'legacy_compatible'
    module_path = Path(__file__).resolve().parents[2] / 'alembic' / 'versions' / f'{REVISION}_smtp_management.py'
    spec = importlib.util.spec_from_file_location('_reviewed_smtp_revision', module_path)
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)
    revision.op = Operations(MigrationContext.configure(connection))
    revision.upgrade()
    return 'applied'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply only after backup and legacy-schema verification')
    args = parser.parse_args()
    from ..config import get_settings
    if get_settings().bootstrap_schema:
        parser.error('Set VEE_BOOTSTRAP_SCHEMA=false before using the guarded installer')
    from ..database import engine
    with engine.begin() as connection:
        result = install(connection, apply=args.apply)
    print(f'SMTP {REVISION}: {result}; global Alembic baseline unchanged')


if __name__ == '__main__':
    main()
