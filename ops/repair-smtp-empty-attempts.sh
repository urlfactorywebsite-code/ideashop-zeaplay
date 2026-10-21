#!/usr/bin/env bash
set -euo pipefail
cd /opt/ideashop-zeaplay
umask 077
test -f .env.production
backup=$(mktemp -d /root/zeaplay-smtp-repair.XXXXXXXX)
image=$(docker inspect --format '{{.Image}}' zeaplay_backend)
network=$(docker inspect --format '{{json .NetworkSettings.Networks}}' zeaplay_backend | python3 -c 'import json,sys; n=list(json.load(sys.stdin)); assert len(n)==1, "Unexpected backend networks"; print(n[0])')
database=$(docker exec zeaplay_postgres sh -c 'printf "%s" "$POSTGRES_DB"')
dbsig=$(docker exec zeaplay_backend python -c 'import hashlib,sys; from sqlalchemy.engine import make_url; from app.config import get_settings; s=get_settings(); u=make_url(s.database_url); assert u.host in {"postgres","zeaplay_postgres"} and u.database==sys.argv[1], "Backup database differs"; assert not s.bootstrap_schema; print(hashlib.sha256(s.database_url.encode()).hexdigest())' "$database")
cat > "$backup/repair.py" <<'REPAIR'
"""Repair only the observed legacy-SMTP plus empty-attempt-table layout."""
import importlib.util
from pathlib import Path
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text


def repair(connection, installer):
    if connection.dialect.name != 'postgresql':
        raise RuntimeError('PostgreSQL only')
    connection.execute(text("SET LOCAL lock_timeout='5s'"))
    connection.execute(text("SET LOCAL statement_timeout='30s'"))
    connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('zea:smtp:legacy-install'))"))
    connection.execute(text('LOCK TABLE smtp_config, multiple_smtp_configs, notification_outbox, smtp_delivery_attempts IN ACCESS EXCLUSIVE MODE'))
    info = inspect(connection)
    if info.has_table('alembic_version'):
        raise RuntimeError('Versioned database; no changes applied')
    for table, fields in installer.LEGACY.items():
        columns = {c['name']: c for c in info.get_columns(table)}
        if set(columns) != fields or str(columns['password']['type']).upper() != 'VARCHAR(255)' or info.get_pk_constraint(table)['constrained_columns'] != ['id']:
            raise RuntimeError('SMTP profile layout differs; no changes applied')
    columns = {c['name'] for c in info.get_columns('notification_outbox')}
    if not installer.OUTBOX <= columns or {'delivery_state', 'claim_token'} & columns:
        raise RuntimeError('Outbox layout differs; no changes applied')
    expected = {'id': ('VARCHAR(36)', False), 'tenant_id': ('UUID', False),
        'profile_key': ('VARCHAR(60)', False), 'outbox_id': ('VARCHAR(36)', True),
        'category': ('VARCHAR(100)', False), 'kind': ('VARCHAR(20)', False),
        'outcome': ('VARCHAR(30)', False), 'code': ('VARCHAR(50)', True),
        'started_at': ('TIMESTAMP WITH TIME ZONE', False), 'finished_at': ('TIMESTAMP WITH TIME ZONE', True)}
    actual = {c['name']: (str(c['type'].compile(dialect=connection.dialect)).upper(), c['nullable']) for c in info.get_columns('smtp_delivery_attempts')}
    if actual != expected or info.get_pk_constraint('smtp_delivery_attempts')['constrained_columns'] != ['id']:
        raise RuntimeError('Attempt-table structure differs; no changes applied')
    if connection.scalar(text('SELECT count(*) FROM smtp_delivery_attempts')) != 0:
        raise RuntimeError('Attempt history exists; no changes applied')
    indexes = {i['name']: i for i in info.get_indexes('smtp_delivery_attempts')}
    for name, fields in {'ix_smtp_attempt_quota': ['profile_key', 'kind', 'started_at'], 'ix_smtp_attempt_tenant': ['tenant_id', 'started_at']}.items():
        if name in indexes and (indexes[name]['column_names'] != fields or indexes[name]['unique'] or indexes[name].get('dialect_options', {}).get('postgresql_where')):
            raise RuntimeError('Attempt index differs; no changes applied')
    before = {table: connection.execute(text('SELECT ' + ','.join(sorted(fields)) + ' FROM ' + table + ' ORDER BY id')).all() for table, fields in installer.LEGACY.items()}
    outbox_count = connection.scalar(text('SELECT count(*) FROM notification_outbox'))
    operations = Operations(MigrationContext.configure(connection))
    class ReuseAttempts:
        def __getattr__(self, name): return getattr(operations, name)
        def create_table(self, name, *args, **kwargs):
            if name != 'smtp_delivery_attempts': return operations.create_table(name, *args, **kwargs)
        def create_index(self, name, table, *args, **kwargs):
            if table != 'smtp_delivery_attempts' or name not in indexes:
                return operations.create_index(name, table, *args, **kwargs)
    path = Path(installer.__file__).resolve().parents[2] / 'alembic' / 'versions' / (installer.REVISION + '_smtp_management.py')
    spec = importlib.util.spec_from_file_location('_smtp_repair_revision', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.op = ReuseAttempts()
    migration.upgrade()
    for table, fields in installer.LEGACY.items():
        after = connection.execute(text('SELECT ' + ','.join(sorted(fields)) + ' FROM ' + table + ' ORDER BY id')).all()
        if before[table] != after: raise RuntimeError('Profile data changed; transaction rolled back')
    if connection.scalar(text('SELECT count(*) FROM notification_outbox')) != outbox_count:
        raise RuntimeError('Queue row count changed; transaction rolled back')
    if installer.install(connection) != 'already_compatible':
        raise RuntimeError('SMTP schema verification failed')


if __name__ == '__main__':
    import hashlib, os
    from app.database import engine
    from app.services import smtp_install
    from app.config import get_settings
    if get_settings().bootstrap_schema:
        raise RuntimeError('Schema bootstrap must remain disabled')
    if hashlib.sha256(get_settings().database_url.encode()).hexdigest() != os.environ['SMTP_EXPECTED_DB_SIG']:
        raise RuntimeError('Maintenance database differs from the running backend; no changes applied')
    with engine.begin() as connection:
        repair(connection, smtp_install)
    print('SMTP schema repaired and verified; existing profile values and queue rows preserved.')
REPAIR
trap 'docker start zeaplay_backend >/dev/null' EXIT
docker stop --time 30 zeaplay_backend >/dev/null
docker exec zeaplay_postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
test -s "$backup/database.dump"
docker exec -i zeaplay_postgres pg_restore --list < "$backup/database.dump" >/dev/null
printf 'Verified private backup: %s\n' "$backup"
docker run --rm --network "$network" -e SMTP_EXPECTED_DB_SIG="$dbsig" --mount "type=bind,src=/opt/ideashop-zeaplay/.env.production,dst=/maintenance.env,readonly" --mount "type=bind,src=$backup/repair.py,dst=/repair.py,readonly" --entrypoint python "$image" -c 'import os,runpy; from dotenv import dotenv_values; os.environ.update({k:v for k,v in dotenv_values("/maintenance.env").items() if v is not None}); os.environ.update(VEE_ENVIRONMENT="production",VEE_BOOTSTRAP_SCHEMA="false",VEE_SMTP_DELIVERY_ENABLED="false"); runpy.run_path("/repair.py",run_name="__main__")'
docker start zeaplay_backend >/dev/null
trap - EXIT
docker exec zeaplay_backend python -m app.services.smtp_install
curl --retry 8 --retry-delay 2 --retry-connrefused --fail --silent --show-error https://api.ideashop.zeacrm.com/api/ready
printf '\nRepair finished. Refresh Settings > API > SMTP.\n'
