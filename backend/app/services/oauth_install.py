"""Apply only the OAuth revision to a verified, unversioned legacy PostgreSQL DB.

No startup DDL, historical migration replay, adoption of plaintext clients or
Alembic stamping. Dry run by default. Back up before using --apply.
"""
import argparse
import importlib.util
import json
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text

from ..config import get_settings

if __name__ == '__main__' and get_settings().bootstrap_schema:
    raise SystemExit('Set VEE_BOOTSTRAP_SCHEMA=false before running the OAuth installer')

from .. import (
    models,  # noqa: F401 - register existing user FK targets for standalone CLI
)
from ..database import engine
from ..oauth_models import (
    BrowserSession,
    OAuthClient,
    OAuthCode,
    OAuthConsent,
    OAuthEvent,
    OAuthGrant,
    OAuthRateLimit,
    OAuthToken,
)

TABLES = [BrowserSession.__table__, OAuthClient.__table__, OAuthGrant.__table__, OAuthCode.__table__,
          OAuthConsent.__table__, OAuthToken.__table__, OAuthEvent.__table__, OAuthRateLimit.__table__]


def migration(filename):
    path = Path(__file__).resolve().parents[2] / 'alembic' / 'versions' / filename
    spec = importlib.util.spec_from_file_location('oauth_' + filename.replace('.', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def install(connection, apply=False):
    if get_settings().bootstrap_schema:
        raise RuntimeError('Set VEE_BOOTSTRAP_SCHEMA=false; bootstrap DDL must be disabled')
    if connection.dialect.name != 'postgresql':
        raise RuntimeError('Legacy installer supports PostgreSQL only')
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('zeaplay-oauth-install'))"))
    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    if 'alembic_version' in existing:
        raise RuntimeError('Versioned database: use the reviewed Alembic revision instead')
    if 'users' not in existing or not {'id', 'tenant_id', 'credentials_version', 'status'} <= {c['name'] for c in inspector.get_columns('users')}:
        raise RuntimeError('Existing tenant identity schema is incompatible')
    if not any(c['column_names'] == ['id', 'tenant_id'] for c in inspector.get_unique_constraints('users')):
        raise RuntimeError('Existing users(id, tenant_id) unique constraint is required')
    names = {t.name for t in TABLES}
    present = names & existing
    if present and present != names:
        raise RuntimeError('Partial OAuth installation: investigate and restore/reconcile before proceeding')
    refinement = migration('ffc2f3a4b5c6_oauth_cleanup_indexes.py')
    missing_refinement = set()
    if present:
        for table in TABLES:
            if set(table.c.keys()) != {c['name'] for c in inspector.get_columns(table.name)}:
                raise RuntimeError('OAuth column mismatch: ' + table.name)
            for actual in inspector.get_columns(table.name):
                expected = table.c[actual['name']]
                if (actual['nullable'] != expected.nullable or
                        actual['type'].compile(dialect=connection.dialect) != expected.type.compile(dialect=connection.dialect)):
                    raise RuntimeError('OAuth column definition mismatch: ' + table.name)
            from sqlalchemy import UniqueConstraint
            required_unique = {tuple(c.name for c in constraint.columns) for constraint in table.constraints if isinstance(constraint, UniqueConstraint)}
            actual_unique = {tuple(c['column_names']) for c in inspector.get_unique_constraints(table.name)}
            if required_unique != actual_unique or inspector.get_pk_constraint(table.name)['constrained_columns'] != [c.name for c in table.primary_key]:
                raise RuntimeError('OAuth uniqueness mismatch: ' + table.name)
            actual_indexes = {i['name']: i for i in inspector.get_indexes(table.name)}
            for expected in table.indexes:
                actual = actual_indexes.get(expected.name)
                if actual is None:
                    if expected.name not in refinement.INDEXES:
                        raise RuntimeError('OAuth index mismatch: ' + table.name)
                    missing_refinement.add(expected.name)
                elif (actual['column_names'] != [c.name for c in expected.columns]
                      or bool(actual['unique']) != bool(expected.unique)):
                    raise RuntimeError('OAuth index definition mismatch: ' + table.name)
            required_fk = {(tuple(c.parent.name for c in fk.elements), tuple(c.column.name for c in fk.elements), fk.referred_table.name) for fk in table.foreign_key_constraints}
            actual_fk = {(tuple(fk['constrained_columns']), tuple(fk['referred_columns']), fk['referred_table']) for fk in inspector.get_foreign_keys(table.name)}
            if required_fk != actual_fk:
                raise RuntimeError('OAuth foreign key mismatch: ' + table.name)
        if missing_refinement:
            if not apply:
                return {'status': 'refinement_required', 'indexes': sorted(missing_refinement)}
            with Operations.context(MigrationContext.configure(connection)):
                refinement.upgrade()
            return {'status': 'refined', 'revision': refinement.revision}
        return {'status': 'already_compatible', 'tables': sorted(names)}
    if not apply:
        return {'status': 'ready_to_install', 'tables': sorted(names)}
    module = migration('ffb1e2f3a4b5_oauth_management.py')
    with Operations.context(MigrationContext.configure(connection)):
        module.upgrade()
        refinement.upgrade()
    return {'status': 'installed', 'revision': refinement.revision, 'tables': sorted(names)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with engine.begin() as connection:
        result = install(connection, args.apply)
    print(json.dumps(result))
