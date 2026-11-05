"""Real auth/API/SQL coverage on SQLite and explicitly isolated PostgreSQL."""
from datetime import datetime, timezone, timedelta
from importlib import import_module
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DatabaseError

from backend.app import models as m
from backend.app.auth import create_access_token
from backend.app.database import get_db
from backend.app.routers import kanban, task_statuses, tasks
from backend.app.services import task_statuses as service
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401


def headers(user):
    return {"Authorization": "Bearer " + create_access_token(user.id, extra_claims={
        "tenant_id": str(user.tenant_id), "credentials_version": user.credentials_version})}


@pytest.fixture
def client(data, monkeypatch):
    monkeypatch.setattr(tasks, "get_cached_json", lambda *args: None)
    monkeypatch.setattr(tasks, "set_cached_json", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "invalidate", lambda *args: None)
    with data.factory() as db:
        for user in (data.owner, data.outsider):
            db.get(m.User, user.id).email = f'{uuid4()}@example.com'
        db.commit()
    from backend.app.services import audit_logger
    monkeypatch.setattr(audit_logger, "log_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks, "_schedule_notification_outbox_delivery", lambda *args: None)
    monkeypatch.setattr(tasks, "_invalidate_task_cache", lambda *args, **kwargs: None)
    app = FastAPI()
    for router in (task_statuses.router, kanban.router, tasks.router):
        app.include_router(router, prefix="/api")
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client


def document(client, user):
    response = client.get('/api/task-statuses', headers=headers(user))
    assert response.status_code == 200, response.text
    return response.json()


def payload(doc):
    names = task_statuses.StatusDraft.model_fields
    return {"revision": doc["revision"], "statuses": [{key: row[key] for key in names if key in row} for row in doc["statuses"]]}


def add(client, user, name="Quality Check"):
    draft = payload(document(client, user))
    draft["statuses"].append({"system_name": name, "display_label": name, "color": "#123abc", "icon": "flag"})
    response = client.put('/api/task-statuses', headers=headers(user), json=draft)
    assert response.status_code == 200, response.text
    return response.json(), response.json()["statuses"][-1]


def test_system_mapping_labels_and_reordering_preserve_tasks_and_history(client, data):
    doc = document(client, data.owner)
    assert {row['code']: row['legacy_status'] for row in doc['statuses']}['BATTLE_PLAN'] == 'WAITING_FOR_REQUIREMENT'
    assert next(row for row in doc['statuses'] if row['code'] == 'CONQUERED')['legacy_status'] == 'DONE'
    assert len(doc['statuses']) == 11
    draft = payload(doc)
    draft['statuses'].reverse()
    next(row for row in draft['statuses'] if row['system_name'] == 'Battle Plan')['display_label'] = 'Planning'
    response = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert response.status_code == 200, response.text
    assert response.json()['statuses'][0]['code'] == 'GRAVEYARD'
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 409
    with data.factory() as db:
        assert db.get(m.Task, data.task.id).status == m.TaskStatusEnum.TODO
        assert db.get(m.User, data.owner.id).points == 125
        audits = list(db.scalars(select(m.StatusConfigurationAudit)))
        assert audits and all(row.tenant_id == data.owner.tenant_id and row.actor_id == data.owner.id for row in audits)


@pytest.mark.parametrize('change', [{'system_name': 'Broken'}, {'is_active': False}, {'is_system': False}, {'code': 'CHANGED'}, {'tenant_id': str(uuid4())}])
def test_protected_attributes_rejected_atomically(client, data, change):
    doc = document(client, data.owner)
    draft = payload(doc)
    draft['statuses'][0].update(change)
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
    assert document(client, data.owner) == doc


@pytest.mark.parametrize('name', [' in   progress ', 'ＩＮ ＰＲＯＧＲＥＳＳ', 'BATTLE_PLAN', 'Conquered'])
def test_ambiguous_names_are_rejected(client, data, name):
    draft = payload(document(client, data.owner))
    draft['statuses'].append({'system_name': name, 'display_label': name})
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422


def test_roles_and_tenant_boundaries(client, data):
    _, custom = add(client, data.owner)
    other = document(client, data.outsider)
    assert custom['id'] not in [row['id'] for row in other['statuses']]
    draft = payload(other)
    draft['statuses'][0]['id'] = custom['id']
    assert client.put('/api/task-statuses', headers=headers(data.outsider), json=draft).status_code == 409
    body = {'revision': 0, 'action': 'delete', 'confirmation': custom['display_label'], 'expected_task_count': 0}
    assert client.post(f"/api/task-statuses/{custom['id']}/remove", headers=headers(data.outsider), json=body).status_code == 404
    assert client.patch(f"/api/tasks/{data.task.id}", headers=headers(data.outsider), json={'custom_status_id': custom['id']}).status_code in (403, 404)
    for role in (m.RoleEnum.USER, m.RoleEnum.MANAGER):
        with data.factory() as db:
            user = db.get(m.User, data.owner.id)
            user.role = role
            db.commit()
        assert client.get('/api/task-statuses', headers=headers(data.owner)).status_code == 403
        assert client.put('/api/task-statuses', headers=headers(data.owner), json=payload(other)).status_code == 403
        assert client.delete('/api/kanban-columns/IN_PROGRESS', headers=headers(data.owner)).status_code == 403


def test_custom_assignment_board_reassignment_archive_delete_and_audit(client, data):
    doc, custom = add(client, data.owner)
    response = client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': custom['id']})
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'IN_PROGRESS'
    assert response.json()['custom_status_id'] == custom['id']
    doc = document(client, data.owner)
    custom = next(row for row in doc['statuses'] if row['id'] == custom['id'])
    assert custom['task_count'] == 1
    board = client.get('/api/tasks/kanban', headers=headers(data.owner))
    assert board.status_code == 200, board.text
    col = next(row for row in board.json()['columns'] if row['status'] == custom['id'])
    assert col['count'] == 1 and col['items'][0]['id'] == data.task.id and col['color'] == '#123abc'
    assert next(row for row in board.json()['columns'] if row['status'] == 'IN_PROGRESS')['count'] == 0
    assert client.delete(f"/api/kanban-columns/{custom['id']}", headers=headers(data.owner)).status_code == 409
    draft = payload(doc)
    draft['statuses'][-1]['is_active'] = False
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 409
    destination = next(row for row in doc['statuses'] if row['code'] == 'IN_PROGRESS')
    body = {'revision': doc['revision'], 'action': 'archive', 'confirmation': custom['display_label'],
            'expected_task_count': 0, 'destination_id': destination['id']}
    assert client.post(f"/api/task-statuses/{custom['id']}/remove", headers=headers(data.owner), json=body).status_code == 409
    body['expected_task_count'] = 1
    body['destination_id'] = next(row for row in doc['statuses'] if row['code'] == 'CONQUERED')['id']
    assert client.post(f"/api/task-statuses/{custom['id']}/remove", headers=headers(data.owner), json=body).status_code == 422
    body['destination_id'] = destination['id']
    response = client.post(f"/api/task-statuses/{custom['id']}/remove", headers=headers(data.owner), json=body)
    assert response.status_code == 200, response.text
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': custom['id']}).status_code == 409
    body.update(revision=response.json()['revision'], action='delete', expected_task_count=0, destination_id=None)
    assert client.post(f"/api/task-statuses/{custom['id']}/remove", headers=headers(data.owner), json=body).status_code == 200
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        assert task.custom_status_id is None and task.status == m.TaskStatusEnum.IN_PROGRESS
        assert db.get(m.User, data.owner.id).points == 125
        assert db.get(m.Subtask, data.child.id)
        audit = list(db.scalars(select(m.StatusConfigurationAudit).where(m.StatusConfigurationAudit.action == 'archive')))[0]
        assert audit.new_values['task_ids'] == [task.id]


def test_canonical_workflows_clear_custom_and_database_protects_system(client, data):
    doc, custom = add(client, data.owner)
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        task.status = m.TaskStatusEnum.IN_PROGRESS
        task.custom_status_id = custom['id']
        db.commit()
        task.status = m.TaskStatusEnum.ON_HOLD
        assert task.custom_status_id is None
        db.commit()
        system_id = doc['statuses'][0]['id']
        with pytest.raises(DatabaseError):
            db.execute(text('DELETE FROM task_statuses WHERE id=:id'), {'id': system_id})
        db.rollback()
        db.execute(text("UPDATE tasks SET status='IN_PROGRESS', custom_status_id=:status WHERE id=:id"), {'status': custom['id'], 'id': task.id})
        db.commit()
        db.execute(text("UPDATE tasks SET status='DONE' WHERE id=:id"), {'id': task.id})
        db.commit()
        db.expire_all()
        assert db.get(m.Task, task.id).custom_status_id is None


def test_status_names_can_swap_without_transient_unique_collisions(client, data):
    add(client, data.owner, 'Alpha')
    doc, _ = add(client, data.owner, 'Bravo')
    draft = payload(doc)
    for field in ('system_name', 'display_label'):
        draft['statuses'][-1][field], draft['statuses'][-2][field] = draft['statuses'][-2][field], draft['statuses'][-1][field]
    response = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert response.status_code == 200, response.text


def test_noop_saves_preserve_revision_and_control_characters_are_rejected(client, data):
    doc = document(client, data.owner)
    before = client.get('/api/task-statuses/audit', headers=headers(data.owner)).json()
    result = client.put('/api/task-statuses', headers=headers(data.owner), json=payload(doc))
    assert result.status_code == 200 and result.json()['revision'] == doc['revision']
    assert client.get('/api/task-statuses/audit', headers=headers(data.owner)).json() == before
    draft = payload(doc)
    draft['statuses'][0]['description'] = 'Invalid\x00description'
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': '\x00'}).status_code == 422


def test_concurrent_saves_use_revision_lock_and_admin_can_manage(client, data):
    doc = document(client, data.owner)
    with data.factory() as db:
        db.get(m.User, data.owner.id).role = m.RoleEnum.ADMIN
        db.commit()
    draft = payload(doc)
    draft['statuses'][0]['display_label'] = 'Admin Planning'
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.put('/api/task-statuses', headers=headers(data.owner), json=draft), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert document(client, data.owner)['revision'] == doc['revision'] + 1


def test_custom_status_cannot_bypass_completion_policy_or_duplicate_rewards(client, data):
    _, custom = add(client, data.owner)
    url = f'/api/tasks/{data.task.id}'
    assert client.patch(url, headers=headers(data.owner), json={'custom_status_id': custom['id']}).status_code == 200
    assert client.patch(url, headers=headers(data.owner), json={'status': 'DONE'}).status_code == 409
    with data.factory() as db:
        child = db.get(m.Subtask, data.child.id)
        child.status, child.completed = m.SubtaskStatusEnum.DONE, True
        db.commit()
    completed = client.patch(url, headers=headers(data.owner), json={'status': 'DONE'})
    assert completed.status_code == 200, completed.text
    assert completed.json()['custom_status_id'] is None
    with data.factory() as db:
        awarded = db.get(m.User, data.owner.id).points
        assert awarded > 125
        assert db.get(m.Task, data.task.id).completion_xp_awarded_at is not None
    assert client.patch(url, headers=headers(data.owner), json={'status': 'DONE'}).status_code == 200
    with data.factory() as db:
        assert db.get(m.User, data.owner.id).points == awarded


def test_database_tenant_guard_audit_immutability_and_navigation_policy(client, data):
    doc, custom = add(client, data.owner)
    with data.factory() as db:
        alien = m.Task(title='Other workspace', created_by_id=data.outsider.id, status=m.TaskStatusEnum.IN_PROGRESS,
                       custom_status_id=custom['id'])
        db.add(alien)
        with pytest.raises(DatabaseError):
            db.flush()
        db.rollback()
        with pytest.raises(DatabaseError, match='append-only'):
            db.execute(text('DELETE FROM status_configuration_audits'))
        db.rollback()
        db.add(m.NavigationPolicy(tenant_id=str(data.owner.tenant_id), revision=1, updated_by=data.owner.id,
            rules={'settings.sidebar-management': {'enabled': False}}, updated_at=datetime.now(timezone.utc)))
        db.commit()
    assert client.get('/api/task-statuses', headers=headers(data.owner)).status_code == 403
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=payload(doc)).status_code == 403
    assert client.get('/api/task-statuses').status_code == 401


def test_legacy_column_ids_names_and_api_shapes_remain_usable(client, data):
    with data.factory() as db:
        db.add(m.KanbanColumn(id='original-custom-column', title='  Client   feedback ', order=30))
        db.commit()
    doc = document(client, data.owner)
    custom = next(row for row in doc['statuses'] if row['legacy_column_id'] == 'original-custom-column')
    assert custom['display_label'] == 'Client feedback'
    listed = client.get('/api/kanban-columns', headers=headers(data.owner)).json()
    old_column = next(row for row in listed if row['id'] == 'original-custom-column')
    assert old_column['custom_status_id'] == custom['id']
    renamed = client.patch('/api/kanban-columns/original-custom-column', headers=headers(data.owner), json={'title': 'Client approval'})
    assert renamed.status_code == 200 and renamed.json()['id'] == 'original-custom-column'
    assigned = client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': 'original-custom-column'})
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()['custom_status_id'] == custom['id']
    assert assigned.json()['status'] == 'IN_PROGRESS'
    normalized = client.post('/api/kanban-columns', headers=headers(data.owner), json={'title': '  ＱＡ   Review ', 'order': 1})
    assert normalized.status_code == 201, normalized.text
    assert normalized.json()['title'] == 'QA Review' and normalized.json()['order'] == 1
    assert client.post('/api/kanban-columns', headers=headers(data.owner), json={'title': '   ', 'order': 10}).status_code == 422
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'status': None}).status_code == 422
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': ''}).status_code == 422


def test_custom_history_snapshots_reporting_and_automation_keep_canonical_status(client, data, monkeypatch):
    from backend.app.reporting.inventory import task_aggregates
    from backend.app.webhooks.service import _normalize_payload
    _, alpha = add(client, data.owner, 'Review Alpha')
    _, bravo = add(client, data.owner, 'Review Bravo')
    payloads = []
    monkeypatch.setattr(tasks, 'trigger_n8n_event', lambda event, payload: payloads.append((event, payload)))
    url = f'/api/tasks/{data.task.id}'
    assert client.patch(url, headers=headers(data.owner), json={'custom_status_id': alpha['id']}).status_code == 200
    assert client.patch(url, headers=headers(data.owner), json={'custom_status_id': bravo['id']}).status_code == 200
    with data.factory() as db:
        db.get(m.Task, data.task.id).due_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        db.commit()
        aggregates = db.execute(select(*task_aggregates(m.Task, datetime.now(timezone.utc))).where(m.Task.id == data.task.id)).mappings().one()
        assert aggregates['in_progress_tasks'] == 1 and aggregates['completed_tasks'] == 0 and aggregates['overdue_tasks'] == 1
        history = list(db.scalars(select(m.TaskLifecycleEvent).where(m.TaskLifecycleEvent.task_id == data.task.id,
            m.TaskLifecycleEvent.event_type == 'task.custom_status_changed').order_by(m.TaskLifecycleEvent.id)))
        assert len(history) == 2
        assert history[-1].details['previous_custom_label'] == 'Review Alpha'
        assert history[-1].details['new_custom_label'] == 'Review Bravo'
        assert history[-1].actor_id == data.owner.id
        assert history[-1].previous_status == history[-1].new_status == 'IN_PROGRESS'
    event, automation_payload = payloads[-1]
    assert event == 'task.updated'
    normalized = _normalize_payload(automation_payload)
    assert normalized['status'] == 'IN_PROGRESS' and normalized['custom_status_id'] == bravo['id']
    draft = payload(document(client, data.owner))
    next(row for row in draft['statuses'] if row['id'] == alpha['id'])['display_label'] = 'Renamed Alpha'
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 200
    with data.factory() as db:
        assert db.get(m.TaskLifecycleEvent, history[-1].id).details['previous_custom_label'] == 'Review Alpha'


def test_database_identity_and_workflow_truncation_are_protected(client, data):
    doc, custom = add(client, data.owner)
    with data.factory() as db:
        for statement, values in (
            ('UPDATE task_statuses SET code=:value WHERE id=:id', {'value': 'BROKEN', 'id': doc['statuses'][0]['id']}),
            ('UPDATE task_statuses SET is_system=true WHERE id=:id', {'id': custom['id']}),
            ('UPDATE task_statuses SET tenant_id=:value WHERE id=:id', {'value': data.outsider.tenant_id.hex, 'id': custom['id']}),
        ):
            with pytest.raises(DatabaseError):
                db.execute(text(statement), values)
            db.rollback()
        if db.bind.dialect.name == 'postgresql':
            with pytest.raises(DatabaseError, match='cannot be truncated'):
                db.execute(text('TRUNCATE task_statuses CASCADE'))
            db.rollback()
    assert len(document(client, data.owner)['statuses']) == 12


def test_migration_backfill_is_idempotent_and_preserves_task_fields(data):
    migration = import_module('backend.alembic.versions.f006d7e8f9a0_task_status_management')
    with data.factory() as db:
        before = db.execute(text('SELECT * FROM tasks')).all()
        history_before = db.execute(text('SELECT * FROM task_lifecycle_events')).all()
    with data.factory.kw['bind'].begin() as connection:
        # This fixture exercises the frozen Phase 1 migration. Newer business
        # guards must be absent, as they were at that historical revision.
        from backend.app import status_business_schema_v3
        status_business_schema_v3.uninstall(connection)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
        connection.execute(text(f'UPDATE task_statuses SET workflow_behavior={status_business_schema_v3.behavior_case("legacy_status")} WHERE is_system'))
        status_business_schema_v3.install(connection)
        assert connection.execute(text('SELECT * FROM tasks')).all() == before
        assert connection.execute(text('SELECT * FROM task_lifecycle_events')).all() == history_before
        assert connection.scalar(text('SELECT count(*) FROM task_statuses')) == 22
    with pytest.raises(RuntimeError, match='preserved'):
        migration.downgrade()


def test_upgrade_from_legacy_schema_preserves_identifiers_and_history(engine, tmp_path):
    """Actually execute CREATE/ALTER/backfill, independent of metadata.create_all."""
    schema = 'status_migration_' + uuid4().hex
    if engine.dialect.name == 'postgresql':
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scratch = sa.create_engine(engine.url)
        @sa.event.listens_for(scratch, 'connect')
        def search_path(connection, _):
            connection.execute(f'SET search_path TO "{schema}", public')
            connection.commit()
    else:
        scratch = sa.create_engine('sqlite:///' + (tmp_path / 'legacy-status.db').as_posix())
    try:
        metadata = sa.MetaData()
        users = sa.Table('users', metadata, sa.Column('id', sa.String(36), primary_key=True), sa.Column('tenant_id', sa.Uuid()))
        sa.Table('projects', metadata, sa.Column('id', sa.String(36), primary_key=True), sa.Column('tenant_id', sa.Uuid()))
        legacy_tasks = sa.Table('tasks', metadata, sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('status', sa.String(40)), sa.Column('created_by_id', sa.String(36)), sa.Column('project_id', sa.String(36)))
        columns = sa.Table('kanban_columns', metadata, sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('title', sa.String(100)), sa.Column('order', sa.Integer()))
        history = sa.Table('task_lifecycle_events', metadata, sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('task_id', sa.String(36)), sa.Column('previous_status', sa.String(40)), sa.Column('new_status', sa.String(40)))
        metadata.create_all(scratch)
        tenant = uuid4()
        migration = import_module('backend.alembic.versions.f006d7e8f9a0_task_status_management')
        with scratch.begin() as connection:
            connection.execute(users.insert(), [{'id': 'owner', 'tenant_id': tenant}, {'id': 'other', 'tenant_id': uuid4()}])
            connection.execute(legacy_tasks.insert(), [{'id': 'old-task', 'status': 'DONE', 'created_by_id': 'owner'}])
            connection.execute(columns.insert(), [{'id': 'WAITING_FOR_REQUIREMENT', 'title': 'Plan this week', 'order': 3},
                                                  {'id': 'old-custom', 'title': 'Client Review', 'order': 20}])
            connection.execute(history.insert().values(id=1, task_id='old-task', previous_status='IN_PROGRESS', new_status='DONE'))
            before = connection.execute(sa.select(legacy_tasks)).all()
            old_history = connection.execute(sa.select(history)).all()
            connection.execute(columns.insert().values(id='ambiguous', title=' in progress ', order=40))
            with Operations.context(MigrationContext.configure(connection)):
                with pytest.raises(RuntimeError, match='Ambiguous legacy'):
                    migration.upgrade()
            assert 'task_statuses' not in sa.inspect(connection).get_table_names()
            assert 'custom_status_id' not in {col['name'] for col in sa.inspect(connection).get_columns('tasks')}
            connection.execute(columns.delete().where(columns.c.id == 'ambiguous'))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.execute(sa.select(legacy_tasks)).all() == before
            assert connection.execute(sa.select(history)).all() == old_history
            statuses = sa.Table('task_statuses', sa.MetaData(), autoload_with=connection)
            seeded = connection.execute(sa.select(statuses).where(statuses.c.tenant_id == tenant)).mappings().all()
            assert len(seeded) == 12
            assert next(row for row in seeded if row['code'] == 'BATTLE_PLAN')['display_label'] == 'Plan this week'
            assert next(row for row in seeded if row['code'] == 'CONQUERED')['legacy_status'] == 'DONE'
            assert next(row for row in seeded if row['system_name'] == 'Client Review')['is_system'] is False
            assert 'custom_status_id' in {col['name'] for col in sa.inspect(connection).get_columns('tasks')}
    finally:
        scratch.dispose()
        if engine.dialect.name == 'postgresql':
            with engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
