"""Additive compatibility for unversioned development databases.

Read-only by default: python -m app.subtask_due_date_schema
After a verified backup: python -m app.subtask_due_date_schema --apply
Versioned installations must apply the Alembic migration instead.
"""
import argparse
import hashlib
import json

import sqlalchemy as sa


def due_date_column(connection):
    inspector = sa.inspect(connection)
    if not inspector.has_table('subtasks'):
        return None
    column = next((item for item in inspector.get_columns('subtasks') if item['name'] == 'due_date'), None)
    if column and (not isinstance(column['type'], sa.Date) or not column['nullable']):
        raise RuntimeError('Existing subtasks.due_date must be a nullable DATE; no changes made')
    return column


def ensure_subtask_due_date_column(connection):
    """Used only by the existing opt-in development schema bootstrap."""
    if connection.dialect.name not in {'sqlite', 'postgresql'}:
        raise RuntimeError('Subtask due dates support PostgreSQL and SQLite only')
    if connection.dialect.name == 'postgresql':
        connection.execute(sa.text('SELECT pg_advisory_xact_lock(741906242)'))
    if not sa.inspect(connection).has_table('subtasks') or due_date_column(connection):
        return False
    connection.execute(sa.text('ALTER TABLE subtasks ADD COLUMN due_date DATE NULL'))
    due_date_column(connection)
    return True


def snapshot(connection, columns):
    quote = connection.dialect.identifier_preparer.quote
    result = {}
    for table, names in columns.items():
        digest = hashlib.sha256()
        count = 0
        query = f'SELECT {", ".join(map(quote, names))} FROM {quote(table)} ORDER BY id'
        for row in connection.execute(sa.text(query)).mappings():
            digest.update(json.dumps(dict(row), sort_keys=True, default=str).encode())
            digest.update(b'\n')
            count += 1
        result[table] = {'rows': count, 'sha256': digest.hexdigest()}
    return result


def repair(connection):
    inspector = sa.inspect(connection)
    if inspector.has_table('alembic_version'):
        raise RuntimeError('Versioned database: apply the Alembic migration')
    if not inspector.has_table('subtasks'):
        raise RuntimeError('Missing subtasks table; no changes made')
    if connection.dialect.name == 'postgresql':
        connection.execute(sa.text("SET LOCAL lock_timeout = '10s'"))
        connection.execute(sa.text("SET LOCAL statement_timeout = '30s'"))
        connection.execute(sa.text('LOCK TABLE tasks, subtasks IN SHARE ROW EXCLUSIVE MODE'))
    columns = {table: [column['name'] for column in inspector.get_columns(table)]
               for table in ('tasks', 'subtasks') if inspector.has_table(table)}
    before = snapshot(connection, columns)
    changed = ensure_subtask_due_date_column(connection)
    if before != snapshot(connection, columns):
        raise RuntimeError('Existing-record verification failed; roll back this transaction')
    return {'status': 'added' if changed else 'already_compatible', 'existing_records_unchanged': True,
            'tables': before, 'migration_history_changed': False}


def main():
    from .config import get_settings
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    settings = get_settings()
    if args.apply and settings.environment.lower() not in {'development', 'dev', 'local', 'test', 'testing'}:
        parser.error('This compatibility repair is for development databases only')
    engine = sa.create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            result = repair(connection) if args.apply else {'status': 'compatible' if due_date_column(connection) else 'missing'}
        print(json.dumps(result, indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
