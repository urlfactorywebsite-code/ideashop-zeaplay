"""Kanban presentation, identity transitions and migration safety on both engines."""
from importlib import import_module
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import DatabaseError
from backend.app.routers import tasks as task_router

from backend.app import models as m, kanban_schema_v2
from backend.tests.test_task_status_management import (  # noqa: F401
    add, client, data, document, engine, headers, payload,
)


def board(client, user, **params):
    response = client.get('/api/tasks/kanban', headers=headers(user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_system_visibility_api_and_sql_guards(client, data):
    doc = document(client, data.owner)
    draft = payload(doc)
    draft['statuses'][0]['kanban_visible'] = False
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
    assert document(client, data.owner) == doc
    with data.factory() as db:
        with pytest.raises(DatabaseError, match='remain visible'):
            db.execute(sa.text('UPDATE task_statuses SET kanban_visible=false WHERE id=:id'), {'id': doc['statuses'][0]['id']})
        db.rollback()
    result = board(client, data.owner)
    assert len(result['columns']) == 11
    assert all(column['is_system'] and column['status_id'] for column in result['columns'])


def test_hidden_quests_retained_filtered_paginated_and_tenant_scoped(client, data):
    doc, custom = add(client, data.owner)
    response = client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id': custom['id']})
    assert response.status_code == 200, response.text
    with data.factory() as db:
        db.add(m.Task(title='Other hidden quest', created_by_id=data.owner.id, status=m.TaskStatusEnum.IN_PROGRESS, custom_status_id=custom['id']))
        db.commit()
    draft = payload(document(client, data.owner))
    draft['statuses'][-1]['kanban_visible'] = False
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 200
    result = board(client, data.owner, page_size=1)
    assert custom['id'] not in [column['status_id'] for column in result['columns']]
    retained = result['outside_columns'][0]
    assert retained['status_id'] == custom['id'] and retained['outside_reason'] == 'hidden'
    assert retained['count'] == 2 and len(retained['items']) == 1
    second = board(client, data.owner, page=2, page_size=1)['outside_columns'][0]
    assert second['items'][0]['id'] != retained['items'][0]['id']
    filtered = board(client, data.owner, search='Other hidden quest')['outside_columns'][0]
    assert filtered['count'] == 1 and filtered['items'][0]['title'] == 'Other hidden quest'
    assert board(client, data.outsider)['outside_columns'] == []
    assert all(column['count'] == 0 for column in board(client, data.outsider)['columns'])
    # A stale board cannot move a task back into a now-hidden custom column.
    assert client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id': custom['id']}).status_code == 409
    destination = next(row for row in doc['statuses'] if row['code'] == 'ON_HOLD')
    moved = client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id': destination['id']})
    assert moved.status_code == 200 and moved.json()['status'] == 'ON_HOLD' and moved.json()['custom_status_id'] is None


def test_moves_use_immutable_ids_and_existing_completion_permissions(client, data):
    doc, custom = add(client, data.owner)
    url = f'/api/tasks/{data.task.id}/kanban-status'
    assert client.patch(url, headers=headers(data.owner), json={'status_id': 'IN_PROGRESS'}).status_code == 409
    assert client.patch(url, headers=headers(data.outsider), json={'status_id': custom['id']}).status_code in (403, 404)
    alien = document(client, data.outsider)['statuses'][0]
    assert client.patch(url, headers=headers(data.owner), json={'status_id': alien['id']}).status_code == 409
    assert client.patch(url, headers=headers(data.owner), json={'status_id': custom['id'], 'tenant_id': str(data.outsider.tenant_id)}).status_code == 422
    assert client.patch(url, headers=headers(data.owner), json={'status_id': custom['id']}).status_code == 200
    conquered = next(row for row in doc['statuses'] if row['code'] == 'CONQUERED')
    assert client.patch(url, headers=headers(data.owner), json={'status_id': conquered['id']}).status_code == 409
    with data.factory() as db:
        db.get(m.Subtask, data.child.id).status = m.SubtaskStatusEnum.DONE
        db.get(m.Subtask, data.child.id).completed = True
        db.commit()
    response = client.patch(url, headers=headers(data.owner), json={'status_id': conquered['id']})
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'DONE' and response.json()['custom_status_id'] is None
    with data.factory() as db:
        points = db.get(m.User, data.owner.id).points
        assert points > 125
    assert client.patch(url, headers=headers(data.owner), json={'status_id': conquered['id']}).status_code == 200
    with data.factory() as db:
        assert db.get(m.User, data.owner.id).points == points


def test_regular_users_keep_only_existing_task_move_authority(client, data):
    doc = document(client, data.owner)
    destination = next(row for row in doc['statuses'] if row['code'] == 'IN_PROGRESS')
    with data.factory() as db:
        db.get(m.User, data.owner.id).role = m.RoleEnum.USER
        other = db.get(m.User, data.outsider.id)
        other.tenant_id, other.role = data.owner.tenant_id, m.RoleEnum.USER
        db.commit()
    data.outsider.tenant_id = data.owner.tenant_id
    url = f'/api/tasks/{data.task.id}/kanban-status'
    assert client.patch(url, headers=headers(data.outsider), json={'status_id': destination['id']}).status_code == 403
    allowed = client.patch(url, headers=headers(data.owner), json={'status_id': destination['id']})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()['status'] == 'IN_PROGRESS'
    assert client.get('/api/task-statuses', headers=headers(data.owner)).status_code == 403


def test_labels_styles_order_persist_without_changing_task_or_history(client, data):
    doc = document(client, data.owner)
    with data.factory() as db:
        before = [(event.id, event.previous_status, event.new_status, event.details) for event in db.scalars(sa.select(m.TaskLifecycleEvent))]
    draft = payload(doc)
    draft['statuses'].reverse()
    for row in draft['statuses']:
        if row['system_name'] == 'In Progress':
            row.update(display_label='Guild expedition', color='#aabbcc', icon='play')
    response = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert response.status_code == 200, response.text
    result = board(client, data.owner)
    assert [column['status_id'] for column in result['columns']] == [row['id'] for row in reversed(doc['statuses'])]
    in_progress = next(column for column in result['columns'] if column['status'] == 'IN_PROGRESS')
    assert (in_progress['title'], in_progress['color'], in_progress['icon']) == ('Guild expedition', '#aabbcc', 'play')
    assert result['configuration_revision'] == response.json()['revision']
    with data.factory() as db:
        assert db.get(m.Task, data.task.id).status == m.TaskStatusEnum.TODO
        assert [(event.id, event.previous_status, event.new_status, event.details) for event in db.scalars(sa.select(m.TaskLifecycleEvent))] == before
        assert db.get(m.User, data.owner.id).points == 125


def test_move_and_visibility_write_serialize_without_losing_quests(client, data):
    doc, custom = add(client, data.owner)
    draft = payload(doc)
    draft['statuses'][-1]['kanban_visible'] = False
    def hide():
        return client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    def move():
        return client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id': custom['id']})
    with ThreadPoolExecutor(max_workers=2) as pool:
        hide_result, move_result = [future.result() for future in (pool.submit(hide), pool.submit(move))]
    assert hide_result.status_code == 200, hide_result.text
    assert move_result.status_code in (200, 409), move_result.text
    result = board(client, data.owner)
    all_items = [task for column in result['columns'] + result['outside_columns'] for task in column['items']]
    assert [task['id'] for task in all_items].count(data.task.id) == 1
    if move_result.status_code == 200:
        assert result['outside_columns'][0]['items'][0]['id'] == data.task.id


def test_unmapped_raw_legacy_record_is_explicitly_retained(client, data, engine):
    if engine.dialect.name != 'sqlite':
        # PostgreSQL already validates its native enum; add a historical value
        # in the disposable schema, as an older installation might have done.
        with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as connection:
            enum_name = m.Task.__table__.c.status.type.name
            connection.execute(sa.text(f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS 'LEGACY_STAGE'"))
    document(client, data.owner)
    with data.factory() as db:
        db.execute(sa.text("UPDATE tasks SET status='LEGACY_STAGE' WHERE id=:id"), {'id': data.task.id})
        db.commit()
    result = board(client, data.owner)
    assert result['unmapped_count'] == 1
    assert result['unmapped_items'][0]['id'] == data.task.id
    assert result['unmapped_items'][0]['raw_status'] == 'LEGACY_STAGE'
    assert len(result['columns']) == 11
    assert board(client, data.outsider)['unmapped_count'] == 0
    assert len(document(client, data.owner)['statuses']) == 11


def test_visibility_forward_migration_backfill_audit_idempotence_and_rollback(client, data, engine):
    doc = document(client, data.owner)
    migration = import_module('backend.alembic.versions.f117e8f9a0b1_kanban_system_visibility')
    with engine.begin() as connection:
        kanban_schema_v2.uninstall(connection)
        connection.execute(sa.text('UPDATE task_statuses SET kanban_visible=false WHERE id=:id'), {'id': doc['statuses'][0]['id']})
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
    updated = document(client, data.owner)
    assert updated['revision'] == doc['revision'] + 1
    assert all(row['kanban_visible'] for row in updated['statuses'])
    with data.factory() as db:
        audits = list(db.scalars(sa.select(m.StatusConfigurationAudit).where(m.StatusConfigurationAudit.action == 'system_visibility_backfill')))
        assert len(audits) == 1 and audits[0].actor_id == 'migration:f117e8f9a0b1'
        assert audits[0].previous_values == {'kanban_visible': False}
        assert db.get(m.Task, data.task.id).status == m.TaskStatusEnum.TODO
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
    assert document(client, data.owner) == updated
    with data.factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(m.StatusConfigurationAudit).where(m.StatusConfigurationAudit.action == 'system_visibility_backfill')) == 1


def test_empty_long_labels_duplicates_and_inactive_statuses(client, data):
    doc, custom = add(client, data.owner, 'Archived Stage')
    draft = payload(doc)
    draft['statuses'][-1]['is_active'] = False
    draft['statuses'][0]['display_label'] = 'L' * 80
    result = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert result.status_code == 200, result.text
    saved = result.json()
    result = board(client, data.owner)
    assert result['columns'][0]['title'] == 'L' * 80
    assert custom['id'] not in [column['status_id'] for column in result['columns']]
    assert result['outside_columns'] == []
    draft = payload(saved)
    draft['statuses'][-1]['display_label'] = 'l' * 80
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
    assert document(client, data.owner) == saved
    assert all(column['count'] == 0 and not column['items'] for column in board(client, data.owner, search='no matching quest')['columns'])
    assert client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id': custom['id']}).status_code == 409
    # Neither direct SQL assignment nor archiving may create an inactive task
    # reference; hidden active references remain recoverable in the other test.
    with data.factory() as db:
        with pytest.raises(DatabaseError):
            db.execute(sa.update(m.Task).where(m.Task.id == data.task.id).values(status=m.TaskStatusEnum.IN_PROGRESS, custom_status_id=custom['id']))
        db.rollback()
        db.execute(sa.update(m.TaskStatus).where(m.TaskStatus.id == custom['id']).values(is_active=True))
        db.get(m.Task, data.task.id).custom_status_id = custom['id']
        db.get(m.Task, data.task.id).status = m.TaskStatusEnum.IN_PROGRESS
        db.commit()
        with pytest.raises(DatabaseError):
            db.execute(sa.update(m.TaskStatus).where(m.TaskStatus.id == custom['id']).values(is_active=False))
        db.rollback()
    assert next(column for column in board(client, data.owner)['columns'] if column['status_id'] == custom['id'])['count'] == 1


def test_counts_cards_and_revision_share_one_snapshot_during_writes(client, data, engine):
    doc = document(client, data.owner)
    if engine.dialect.name == 'sqlite':
        with engine.connect() as connection:
            connection.exec_driver_sql('PRAGMA journal_mode=WAL')
    changed = False
    def write_after_count(connection, cursor, statement, parameters, context, executemany):
        nonlocal changed
        if changed or 'group by' not in statement.lower() or 'custom_status_id' not in statement.lower():
            return
        changed = True
        with engine.begin() as writer:
            writer.execute(sa.text("UPDATE tasks SET status='ON_HOLD' WHERE id=:id"), {'id': data.task.id})
            writer.execute(sa.text("UPDATE task_statuses SET display_label='Concurrent Hold', normalized_label='concurrent hold' WHERE id=:id"),
                           {'id': next(row['id'] for row in doc['statuses'] if row['code'] == 'ON_HOLD')})
            writer.execute(sa.text('UPDATE task_status_scopes SET revision=revision+1'))
    sa.event.listen(engine, 'after_cursor_execute', write_after_count)
    try:
        result = board(client, data.owner)
    finally:
        sa.event.remove(engine, 'after_cursor_execute', write_after_count)
    assert changed
    assert result['configuration_revision'] == doc['revision']
    assert next(column for column in result['columns'] if column['status'] == 'ON_HOLD')['title'] == 'On Hold'
    assert next(column for column in result['columns'] if column['status'] == 'TODO')['count'] == 1
    assert [task['id'] for column in result['columns'] for task in column['items']].count(data.task.id) == 1
    assert next(column for column in board(client, data.owner)['columns'] if column['status'] == 'ON_HOLD')['count'] == 1


def test_capabilities_and_cache_are_scoped_to_current_role(client, data, monkeypatch):
    document(client, data.owner)
    with data.factory() as db:
        other = db.get(m.User, data.outsider.id)
        other.tenant_id = data.owner.tenant_id
        shared = m.Task(title='Followed read-only quest', created_by_id=other.id, assigned_to_id=other.id)
        shared.followers.append(db.get(m.User, data.owner.id))
        db.add_all([shared, m.Task(title='Unrelated quest', created_by_id=other.id)])
        db.commit()
    cache = {}
    monkeypatch.setattr(task_router, 'get_cached_json', lambda key: cache.get(key))
    monkeypatch.setattr(task_router, 'set_cached_json', lambda key, value, **kwargs: cache.update({key: value}))
    privileged = board(client, data.owner)
    assert sum(column['count'] for column in privileged['columns']) == 3
    with data.factory() as db:
        db.get(m.User, data.owner.id).role = m.RoleEnum.USER
        db.commit()
    limited = board(client, data.owner)
    assert sum(column['count'] for column in limited['columns']) == 2
    cards = {task['title']: task for column in limited['columns'] for task in column['items']}
    assert not cards['Followed read-only quest']['can_edit']
    assert cards[data.task.title]['can_edit']
    assert len(cache) == 1  # Restricted viewers re-evaluate grants instead of reusing cards.


def test_empty_custom_columns_do_not_add_task_queries(client, data, engine):
    doc = document(client, data.owner)
    statements = []
    def capture(connection, cursor, statement, *args):
        if 'from tasks' in statement.lower(): statements.append(statement)
    sa.event.listen(engine, 'before_cursor_execute', capture)
    try:
        board(client, data.owner)
        baseline = len(statements)
        draft = payload(doc)
        draft['statuses'].extend({'system_name': f'Empty stage {index}', 'display_label': f'Empty stage {index}'} for index in range(50))
        assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 200
        statements.clear()
        result = board(client, data.owner)
        assert len(result['columns']) == 61
        assert len(statements) == baseline
    finally:
        sa.event.remove(engine, 'before_cursor_execute', capture)
