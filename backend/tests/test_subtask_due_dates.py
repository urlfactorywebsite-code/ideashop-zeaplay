"""Due-date persistence through real routes and independent database sessions."""
from datetime import date
from importlib import import_module

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from backend.app import models
from backend.app.subtask_due_date_schema import due_date_column, ensure_subtask_due_date_column, repair
from backend.tests.test_subtask_handoff_regression import no_external_delivery, chain  # noqa: F401
from backend.tests.test_task_lifecycle import api, auth, data, engine  # noqa: F401


def child(response, child_id):
    assert response.status_code in (200, 201), response.text
    return next(row for row in response.json()['subtasks'] if row['id'] == child_id)


def test_detail_create_edit_clear_refresh_and_legacy(api, data):
    path = f'/api/tasks/{data.task.id}'
    assert child(api.get(path, headers=auth(data.owner)), data.child.id)['due_date'] is None
    created = api.post(path + '/subtasks', json={'title': 'Dated child', 'due_date': '2026-11-16'}, headers=auth(data.owner))
    assert created.status_code == 201, created.text
    added = created.json()['subtasks'][-1]
    child_id = added['id']
    assert added['due_date'] == '2026-11-16'
    assert added['status'] == 'TODO' and not added['completed']
    assert child(api.get(path, headers=auth(data.owner)), child_id)['due_date'] == '2026-11-16'
    url = path + f'/subtasks/{child_id}'
    assert child(api.patch(url, json={'due_date': '2026-12-01'}, headers=auth(data.owner)), child_id)['due_date'] == '2026-12-01'
    assert child(api.patch(url, json={'title': 'Renamed'}, headers=auth(data.owner)), child_id)['due_date'] == '2026-12-01'
    with data.factory() as db:
        assert db.get(models.Subtask, child_id).due_date == date(2026, 12, 1)
    assert child(api.patch(url, json={'due_date': None}, headers=auth(data.owner)), child_id)['due_date'] is None
    assert child(api.get(path, headers=auth(data.owner)), child_id)['due_date'] is None
    with data.factory() as db:
        assert db.get(models.Subtask, child_id).due_date is None
    without = api.post(path + '/subtasks', json={'title': 'No deadline'}, headers=auth(data.owner))
    assert without.status_code == 201, without.text
    assert without.json()['subtasks'][-1]['due_date'] is None


def test_parent_creation_and_full_subtask_update_preserve_dates(api, data):
    with data.factory() as db:
        client = models.Client(tenant_id=data.owner.tenant_id, company_name='Date test client', normalized_company_name='date-test-client')
        db.add(client)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=client.id, name='Date project', normalized_name='date-project')
        db.add(project)
        db.commit()
    response = api.post('/api/tasks', json={'title': 'Parent with dates', 'project_id': project.id,
        'subtasks': [{'title': 'Dated', 'due_date': '2026-11-16'}, {'title': 'Undated'}]}, headers=auth(data.owner))
    assert response.status_code == 201, response.text
    task = response.json()[0]
    path = f"/api/tasks/{task['id']}"
    first, second = task['subtasks']
    assert first['due_date'] == '2026-11-16' and second['due_date'] is None
    # Older clients that omit due_date must not erase it on list replacement.
    children = [{'id': first['id'], 'title': 'Dated renamed'}, {'id': second['id'], 'title': second['title']}]
    assert child(api.patch(path, json={'subtasks': children}, headers=auth(data.owner)), first['id'])['due_date'] == '2026-11-16'
    children[0]['due_date'] = '2026-12-02'
    assert child(api.patch(path, json={'subtasks': children}, headers=auth(data.owner)), first['id'])['due_date'] == '2026-12-02'
    children[0]['due_date'] = None
    assert child(api.patch(path, json={'subtasks': children}, headers=auth(data.owner)), first['id'])['due_date'] is None
    assert child(api.get(path, headers=auth(data.owner)), first['id'])['due_date'] is None


def test_dates_do_not_change_completed_workflow(api, data):
    path = f'/api/tasks/{data.task.id}'
    url = path + f'/subtasks/{data.child.id}'
    done = api.patch(url, json={'status': 'DONE'}, headers=auth(data.owner))
    assert done.status_code == 200, done.text
    assert done.json()['status'] == 'DONE'
    for value in ('2000-01-01', None):
        updated = api.patch(url, json={'due_date': value}, headers=auth(data.owner))
        row = child(updated, data.child.id)
        assert row['due_date'] == value and row['status'] == 'DONE' and row['completed']
        assert updated.json()['status'] == 'DONE'


def test_due_date_updates_enforce_workflow_permissions(api, data, chain):
    path = f'/api/tasks/{data.task.id}'
    for user, expected in ((chain.users[0], 403), (data.outsider, 404)):
        response = api.patch(path + f'/subtasks/{data.child.id}', json={'due_date': '2026-11-16'}, headers=auth(user))
        assert response.status_code == expected, response.text
        response = api.patch(path, json={'subtasks': [{'id': data.child.id, 'title': 'Design', 'due_date': '2026-11-16'}]}, headers=auth(user))
        assert response.status_code in (403, 404), response.text
    with data.factory() as db:
        assert db.get(models.Subtask, data.child.id).due_date is None


@pytest.mark.parametrize('value', ['not-a-date', '2026-02-30'])
def test_invalid_dates_are_rejected(api, data, value):
    path = f'/api/tasks/{data.task.id}/subtasks'
    assert api.post(path, json={'title': 'Invalid', 'due_date': value}, headers=auth(data.owner)).status_code == 422
    assert api.patch(path + f'/{data.child.id}', json={'due_date': value}, headers=auth(data.owner)).status_code == 422


def test_migration_keeps_legacy_rows_null(tmp_path, monkeypatch):
    migration = import_module('backend.alembic.versions.fff6d7e8f9a0_subtask_due_dates')
    scratch = sa.create_engine('sqlite:///' + (tmp_path / 'due-migration.db').as_posix())
    try:
        with scratch.begin() as db:
            db.execute(sa.text('CREATE TABLE subtasks (id TEXT PRIMARY KEY, title TEXT, completed BOOLEAN)'))
            db.execute(sa.text("INSERT INTO subtasks VALUES ('old', 'Preserved', 1)"))
            monkeypatch.setattr(migration, 'op', Operations(MigrationContext.configure(db)))
            migration.upgrade()
            assert tuple(db.execute(sa.text('SELECT * FROM subtasks')).one()) == ('old', 'Preserved', 1, None)
            db.execute(sa.text("UPDATE subtasks SET due_date='2026-11-16' WHERE id='old'"))
            assert db.execute(sa.text('SELECT due_date FROM subtasks')).scalar() == '2026-11-16'
            migration.downgrade()
            assert tuple(db.execute(sa.text('SELECT * FROM subtasks')).one()) == ('old', 'Preserved', 1)
    finally:
        scratch.dispose()


def test_unversioned_repair_is_idempotent_and_keeps_legacy_data(tmp_path):
    scratch = sa.create_engine('sqlite:///' + (tmp_path / 'bootstrap.db').as_posix())
    try:
        with scratch.begin() as db:
            db.execute(sa.text('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT)'))
            db.execute(sa.text("INSERT INTO tasks VALUES ('parent', 'Unchanged')"))
            db.execute(sa.text('CREATE TABLE subtasks (id TEXT PRIMARY KEY, title TEXT, completed BOOLEAN)'))
            db.execute(sa.text("INSERT INTO subtasks VALUES ('old', 'Preserved', 1)"))
            assert due_date_column(db) is None
            result = repair(db)
            assert result['status'] == 'added' and result['existing_records_unchanged']
            assert tuple(db.execute(sa.text('SELECT * FROM subtasks')).one()) == ('old', 'Preserved', 1, None)
            db.execute(sa.text("UPDATE subtasks SET due_date='2026-11-16' WHERE id='old'"))
            assert repair(db)['status'] == 'already_compatible'
            assert ensure_subtask_due_date_column(db) is False
            assert db.execute(sa.text('SELECT due_date FROM subtasks')).scalar() == '2026-11-16'
            assert not sa.inspect(db).has_table('alembic_version')
    finally:
        scratch.dispose()


def test_repair_refuses_versioned_or_incompatible_schemas():
    scratch = sa.create_engine('sqlite://')
    try:
        with scratch.begin() as db:
            db.execute(sa.text('CREATE TABLE alembic_version (version_num TEXT)'))
            with pytest.raises(RuntimeError, match='Versioned database'):
                repair(db)
            db.execute(sa.text('DROP TABLE alembic_version'))
            db.execute(sa.text('CREATE TABLE subtasks (id TEXT, due_date TEXT)'))
            with pytest.raises(RuntimeError, match='nullable DATE'):
                repair(db)
    finally:
        scratch.dispose()
