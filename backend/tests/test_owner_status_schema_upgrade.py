"""Narrow unversioned local upgrade: no data edits or migration stamping."""
# Imported pytest fixtures are intentionally supplied again as function arguments.
# ruff: noqa: F811
from importlib import import_module

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
