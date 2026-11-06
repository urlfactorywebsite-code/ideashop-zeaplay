"""Upgrade the reviewed unversioned status schema after backup/restore rehearsal.

Read-only by default. Stop writers before --apply. Executes only the owner-control
revision, preserves every existing record, and never stamps migration history.
Production requires matching restored-backup proof; versioned databases must use
their reviewed Alembic procedure. Never stamp migration history to bypass refusal.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

os.environ['VEE_BOOTSTRAP_SCHEMA'] = 'false'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from app.config import get_settings
from app.database import engine
from app.services.status_integrity import audit_data, schema_issues
from app.tickets import models as tickets  # noqa: F401 - register Task relationships
from scripts.apply_status_schema import snapshot

REVISION = 'f44ab1c2d3e4'
MISSING_GUARD = 'missing_guard:zea_zz_native_status_available'


def plan(c):
    if c.dialect.name != 'postgresql':
        raise RuntimeError('This local upgrade supports PostgreSQL only')
    inspector = sa.inspect(c)
    if inspector.has_table('alembic_version'):
        raise RuntimeError('Versioned database: use the reviewed Alembic procedure')
    issues = set(schema_issues(c))
    checks = {item['name']: item['sqltext'] for item in inspector.get_check_constraints('task_statuses')}
    expression = checks.get('ck_task_status_system_active', '')
    normalized = re.sub(r'[\s()]', '', expression).lower()
    legacy = normalized == 'notis_systemoris_active'
    owner = all("'" + code + "'" in expression for code in ('BATTLE_PLAN','IN_PROGRESS','ON_HOLD','CONQUERED'))
    if issues == {MISSING_GUARD} and legacy:
        state = 'upgrade_required'
    elif not issues and owner:
        state = 'already_compatible'
    else:
        raise RuntimeError('Schema differs from the reviewed owner-control baseline; no changes made: ' + json.dumps(sorted(issues)))
    integrity = audit_data(c)
    if integrity['errors']:
        raise RuntimeError('Existing status data requires a reviewed repair: ' + json.dumps(integrity['errors']))
    return state


def repair(c, expected_fingerprints=None):
    inspector = sa.inspect(c)
    columns = {table: [item['name'] for item in inspector.get_columns(table)] for table in inspector.get_table_names()}
    quote = c.dialect.identifier_preparer.quote
    c.exec_driver_sql('LOCK TABLE ' + ', '.join(map(quote, sorted(columns))) + ' IN SHARE ROW EXCLUSIVE MODE')
    state = plan(c)
    before = snapshot(c, columns)
    if expected_fingerprints is not None and before != expected_fingerprints:
        raise RuntimeError('Live records differ from the verified restored backup; no changes made')
    if state == 'upgrade_required':
        config = Config()
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
        scripts = ScriptDirectory.from_config(config)
        with Operations.context(MigrationContext.configure(c)):
            scripts.get_revision(REVISION).module.upgrade()
    if plan(c) != 'already_compatible':
        raise RuntimeError('Owner-control schema verification failed')
    after = snapshot(c, columns)
    if before != after:
        raise RuntimeError('Existing records changed; rolling back the upgrade')
    return {'status': 'applied' if state == 'upgrade_required' else state,
            'revision_executed': REVISION if state == 'upgrade_required' else None,
            'migration_history_changed': False, 'existing_records_unchanged': True,
            'table_fingerprints': after, 'integrity': audit_data(c)}


def rehearsal_fingerprints(path):
    result = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if not isinstance(result, dict):
        raise ValueError('A restored-backup JSON object is required')  # noqa: TRY004 - invalid file contents
    hashes = result.get('table_fingerprints')
    if (result.get('status') not in {'applied', 'already_compatible'}
            or result.get('existing_records_unchanged') is not True
            or result.get('migration_history_changed') is not False
            or result.get('revision_executed') not in {None, REVISION}
            or not isinstance(result.get('integrity'), dict)
            or result['integrity'].get('errors') != {}
            or not isinstance(hashes, dict) or not hashes):
        raise ValueError('A successful restored-backup verification report is required')
    for record in hashes.values():
        if (not isinstance(record, dict) or type(record.get('rows')) is not int or record['rows'] < 0
                or not isinstance(record.get('sha256'), str)
                or not re.fullmatch('[0-9a-f]{64}', record['sha256'])):
            raise ValueError('Invalid restored-backup fingerprints')
    return hashes


def target_engine(database):
    if database is None:
        return engine
    if (not re.fullmatch(r'zea_owner_rehearsal_[a-z0-9_]{1,40}', database)
            or database == engine.url.database):
        raise ValueError('Database override must name a separate owner-upgrade rehearsal database')
    return sa.create_engine(engine.url.set(database=database))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--database', help='Separate zea_owner_rehearsal_* database only')
    parser.add_argument('--verified-rehearsal', help='Successful restored-backup JSON; live rows must match exactly')
    args = parser.parse_args()
    if engine.dialect.name != 'postgresql':
        parser.error('This local upgrade supports PostgreSQL only')
    try:
        selected_engine = target_engine(args.database)
        expected = rehearsal_fingerprints(args.verified_rehearsal) if args.verified_rehearsal else None
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    if args.verified_rehearsal and (not args.apply or args.database):
        parser.error('Restored-backup proof is only for an explicit live --apply')
    if (args.apply and not args.database and expected is None
            and get_settings().environment.lower() not in {'development','dev','local','test','testing'}):
        parser.error('Production apply requires --verified-rehearsal from the backup-first VPS wrapper')
    with selected_engine.begin() as c:
        if c.dialect.name == 'postgresql':
            c.exec_driver_sql("SET LOCAL lock_timeout='10s'")
            c.exec_driver_sql("SET LOCAL statement_timeout='120s'")
        if args.apply:
            c.execute(sa.text('SELECT pg_advisory_xact_lock(741906245)'))
            result = repair(c, expected_fingerprints=expected)
        else:
            c.exec_driver_sql('SET TRANSACTION READ ONLY')
            result = {'status': plan(c), 'migration_history_changed': False}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
