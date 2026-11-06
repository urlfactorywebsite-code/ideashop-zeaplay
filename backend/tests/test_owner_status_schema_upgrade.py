"""Narrow unversioned local upgrade: no data edits or migration stamping."""
# Imported pytest fixtures are intentionally supplied again as function arguments.
# ruff: noqa: F811
import json
from importlib import import_module
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from backend.scripts import apply_owner_status_schema as upgrade
from backend.tests.test_task_status_management import (  # noqa: F401
    client,
    data,
    document,
    engine,
    headers,
    payload,
)


def legacy(c):
    migration = import_module('backend.alembic.versions.f44ab1c2d3e4_owner_status_controls')
    with Operations.context(MigrationContext.configure(c)):
        migration.downgrade()


def postgres(engine):
    if engine.dialect.name != 'postgresql':
        pytest.skip('Local PostgreSQL repair only')


def test_upgrade_preserves_all_records_and_is_idempotent(client, data, engine):
    postgres(engine)
    document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
        assert upgrade.plan(c) == 'upgrade_required'
        result = upgrade.repair(c)
        assert result['existing_records_unchanged'] and result['revision_executed'] == upgrade.REVISION
        assert not result['migration_history_changed'] and not result['integrity']['errors']
        assert not sa.inspect(c).has_table('alembic_version')
        again = upgrade.repair(c)
        assert again['status'] == 'already_compatible' and again['revision_executed'] is None
        assert result['table_fingerprints'] == again['table_fingerprints']


def test_upgrade_refuses_versioned_or_unreviewed_schema(client, data, engine):
    postgres(engine)
    document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
        c.exec_driver_sql('CREATE TABLE alembic_version (version_num VARCHAR(32))')
        with pytest.raises(RuntimeError, match='Versioned'):
            upgrade.repair(c)
        c.exec_driver_sql('DROP TABLE alembic_version')
        c.exec_driver_sql('DROP INDEX ix_tasks_status_custom_updated_id')
        with pytest.raises(RuntimeError, match='differs'):
            upgrade.repair(c)
        assert upgrade.MISSING_GUARD in upgrade.schema_issues(c)


def test_failure_after_ddl_rolls_back_guards_and_all_records(client, data, engine, monkeypatch):
    postgres(engine)
    document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
    snapshot = upgrade.snapshot
    calls = 0
    def fail_final(c, columns):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('Injected verification failure')
        return snapshot(c, columns)
    monkeypatch.setattr(upgrade, 'snapshot', fail_final)
    with pytest.raises(RuntimeError, match='Injected'), engine.begin() as c:
        upgrade.repair(c)
    with engine.connect() as c:
        assert upgrade.plan(c) == 'upgrade_required'
        assert not upgrade.audit_data(c)['errors']


def test_unknown_activation_constraint_is_refused(client, data, engine):
    postgres(engine)
    document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
        c.exec_driver_sql('ALTER TABLE task_statuses DROP CONSTRAINT ck_task_status_system_active')
        c.exec_driver_sql('ALTER TABLE task_statuses ADD CONSTRAINT ck_task_status_system_active CHECK (is_active)')
        with pytest.raises(RuntimeError, match='differs'):
            upgrade.plan(c)


def test_restored_backup_proof_must_match_before_live_ddl(client, data, engine, tmp_path):
    postgres(engine)
    document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
        proof = upgrade.repair(c)
        legacy(c)
    path = tmp_path / 'rehearsal.json'
    path.write_text(json.dumps(proof), encoding='utf-8')
    expected = upgrade.rehearsal_fingerprints(path)
    with engine.begin() as c:
        changed = {**expected, 'tasks': {**expected['tasks'], 'rows': expected['tasks']['rows'] + 1}}
        with pytest.raises(RuntimeError, match='differ'):
            upgrade.repair(c, expected_fingerprints=changed)
        assert upgrade.plan(c) == 'upgrade_required'
        assert upgrade.repair(c, expected_fingerprints=expected)['status'] == 'applied'
    proof['existing_records_unchanged'] = False
    path.write_text(json.dumps(proof), encoding='utf-8')
    with pytest.raises(ValueError, match='successful'):
        upgrade.rehearsal_fingerprints(path)


def test_rehearsal_database_override_cannot_select_live_or_arbitrary_database():
    for name in ('production', 'zeaplay', 'zea_owner_rehearsal_x;DROP DATABASE zeaplay', upgrade.engine.url.database):
        with pytest.raises(ValueError, match='separate'):
            upgrade.target_engine(name)


def test_incomplete_deployment_reports_upgrade_instead_of_duplicate_conflict(client, data, engine):
    postgres(engine)
    doc = document(client, data.owner)
    with engine.begin() as c:
        legacy(c)
    response = client.put('/api/task-statuses', headers=headers(data.owner), json=payload(doc))
    assert response.status_code == 503 and 'database upgrade required' in response.json()['detail']
    row = next(row for row in doc['statuses'] if row['code'] == 'DEPLOYED')
    response = client.post('/api/task-statuses/' + row['id'] + '/remove', headers=headers(data.owner), json={
        'revision': doc['revision'], 'action': 'archive', 'confirmation': row['display_label'], 'expected_task_count': 0})
    assert response.status_code == 503 and 'database upgrade required' in response.json()['detail']
    assert document(client, data.owner) == doc


def test_production_cli_refuses_without_rehearsal_before_connecting(monkeypatch):
    monkeypatch.setattr(upgrade, 'engine', SimpleNamespace(dialect=SimpleNamespace(name='postgresql'),
        url=sa.engine.make_url('postgresql+psycopg://localhost/live')))
    monkeypatch.setattr(upgrade, 'get_settings', lambda: SimpleNamespace(environment='production'))
    monkeypatch.setattr(upgrade.sys, 'argv', ['apply_owner_status_schema.py', '--apply'])
    with pytest.raises(SystemExit) as refused:
        upgrade.main()
    assert refused.value.code == 2
