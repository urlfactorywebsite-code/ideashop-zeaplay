"""Owner-only controls preserve legacy identities, tasks and business rules."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Event

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import DatabaseError

from backend.app import models as m
from backend.app.services import status_integrity
from backend.tests.test_task_status_management import (  # noqa: F401
    client, data, engine, document, headers, payload, add,
)


def deactivate(client, user, doc, row, count=0, **changes):
    body = dict(revision=doc['revision'], action='archive', confirmation=row['display_label'], expected_task_count=count)
    return client.post(f"/api/task-statuses/{row['id']}/remove", headers=headers(user), json={**body, **changes})


@pytest.mark.parametrize('code', ['TODO','BUG_FIXING','BLOCKED','IN_REVIEW','DEPLOYED','FAILED','GRAVEYARD'])
def test_owner_can_hide_deactivate_and_reactivate_legacy(client, data, code):
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == code)
    draft = payload(doc)
    next(item for item in draft['statuses'] if item['id'] == row['id'])['kanban_visible'] = False
    hidden = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert hidden.status_code == 200, hidden.text
    assert deactivate(client, data.owner, doc, row).status_code == 409  # stale revision
    count = 1 if code == 'TODO' else 0
    response = deactivate(client, data.owner, hidden.json(), row, count)
    assert response.status_code == 200, response.text
    inactive = next(item for item in response.json()['statuses'] if item['id'] == row['id'])
    assert not inactive['is_active'] and not inactive['kanban_visible']
    assert inactive['code'] == row['code'] and inactive['is_system']
    draft = payload(response.json())
    next(item for item in draft['statuses'] if item['id'] == row['id']).update(is_active=True, kanban_visible=True)
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 200
    with data.factory() as db:
        audit = db.scalar(sa.select(m.StatusConfigurationAudit).where(m.StatusConfigurationAudit.action == 'deactivated'))
        assert audit.actor_id == data.owner.id and audit.tenant_id == data.owner.tenant_id
        assert audit.new_values['retained_task_count'] == count
        assert db.get(m.Task, data.task.id).status == m.TaskStatusEnum.TODO
        assert db.get(m.User, data.owner.id).points == 125
        assert status_integrity.audit_data(db.connection())['errors'] == {}


@pytest.mark.parametrize('role', [m.RoleEnum.ADMIN, m.RoleEnum.MANAGER, m.RoleEnum.USER])
def test_nonowners_cannot_modify_configuration_or_compatibility_routes(client, data, role):
    doc, custom = add(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    with data.factory() as db:
        db.get(m.User, data.owner.id).role = role
        db.commit()
    read = client.get('/api/task-statuses', headers=headers(data.owner))
    if role == m.RoleEnum.ADMIN:
        assert read.status_code == 200 and not read.json()['can_manage']
    else:
        assert read.status_code == 403
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=payload(doc)).status_code == 403
    assert deactivate(client, data.owner, doc, row).status_code == 403
    assert deactivate(client, data.owner, doc, custom, action='delete').status_code == 403
    assert client.post('/api/kanban-columns', headers=headers(data.owner), json={'title':'Injected', 'order':0}).status_code == 403
    assert client.patch('/api/kanban-columns/BUG_FIXING', headers=headers(data.owner), json={'title':'Changed'}).status_code == 403
    assert client.delete('/api/kanban-columns/BUG_FIXING', headers=headers(data.owner)).status_code == 403


@pytest.mark.parametrize('code', ['BATTLE_PLAN','IN_PROGRESS','ON_HOLD','CONQUERED'])
def test_core_statuses_still_protected_in_api_and_sql(client, data, code):
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == code)
    assert deactivate(client, data.owner, doc, row).status_code == 422
    for field, value in [('is_active',False), ('kanban_visible',False), ('system_name','Renamed')]:
        draft = payload(doc)
        next(item for item in draft['statuses'] if item['id'] == row['id'])[field] = value
        assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
        with data.factory() as db, pytest.raises(DatabaseError):
            db.execute(sa.text(f'UPDATE task_statuses SET {field}=:value WHERE id=:id'), {'value':value,'id':row['id']})


def test_deactivation_retains_tasks_histories_counts_and_blocks_new_assignments(client, data):
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == 'TODO')
    assert deactivate(client, data.owner, doc, row, 0).status_code == 409
    assert deactivate(client, data.owner, doc, row, 1, confirmation='wrong').status_code == 422
    assert deactivate(client, data.owner, doc, row, 1, destination_id=doc['statuses'][0]['id']).status_code == 422
    assert deactivate(client, data.outsider, document(client, data.outsider), row, 1).status_code == 404
    with data.factory() as db:
        history = list(db.scalars(sa.select(m.TaskLifecycleEvent.id)))
    response = deactivate(client, data.owner, doc, row, 1)
    assert response.status_code == 200, response.text
    board = client.get('/api/tasks/kanban', headers=headers(data.owner)).json()
    assert row['id'] not in [col['status_id'] for col in board['columns']]
    outside = next(col for col in board['outside_columns'] if col['status_id'] == row['id'])
    assert outside['count'] == 1 and outside['items'][0]['id'] == data.task.id
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'title':'Still editable'}).status_code == 200
    with data.factory() as db:
        assert list(db.scalars(sa.select(m.TaskLifecycleEvent.id))) == history
        assert db.get(m.Subtask, data.child.id)
    active = next(item for item in doc['statuses'] if item['code'] == 'IN_PROGRESS')
    url = f'/api/tasks/{data.task.id}/kanban-status'
    assert client.patch(url, headers=headers(data.owner), json={'status_id':active['id']}).status_code == 200
    assert client.patch(url, headers=headers(data.owner), json={'status_id':row['id']}).status_code == 409
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'status':'TODO'}).status_code == 409
    with data.factory() as db, pytest.raises(DatabaseError, match='inactive'):
        db.execute(sa.text("UPDATE tasks SET status='TODO' WHERE id=:id"), {'id':data.task.id})
    with data.factory() as db, pytest.raises(DatabaseError, match='inactive'):
        db.add(m.Task(title='Inactive injection', created_by_id=data.owner.id, status=m.TaskStatusEnum.TODO))
        db.flush()
    with data.factory() as db:
        customer = m.Client(tenant_id=data.owner.tenant_id,company_name='Guild Client',normalized_company_name='guild client')
        db.add(customer); db.flush()
        project = m.Project(tenant_id=data.owner.tenant_id,client_id=customer.id,name='Guild Project',normalized_name='guild project')
        db.add(project); db.commit()
    response = client.post('/api/tasks', headers=headers(data.owner), json={'title':'Inactive API injection','status':'TODO','project_id':project.id})
    assert response.status_code == 409, response.text


def test_legacy_identity_and_completion_behavior_remain_immutable(client, data):
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == 'DEPLOYED')
    draft = payload(doc)
    next(item for item in draft['statuses'] if item['id'] == row['id'])['workflow_behavior'] = 'ACTIVE'
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 422
    assert deactivate(client, data.owner, doc, row, action='delete').status_code == 422
    draft = payload(doc)
    next(item for item in draft['statuses'] if item['id'] == row['id'])['is_active'] = False
    assert client.put('/api/task-statuses', headers=headers(data.owner), json=draft).status_code == 409


def test_concurrent_deactivation_and_assignment_serialized(client, data):
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    def move():
        return client.patch(f'/api/tasks/{data.task.id}/kanban-status', headers=headers(data.owner), json={'status_id':row['id']})
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(deactivate, client, data.owner, doc, row), pool.submit(move)]
        results = [f.result() for f in futures]
    assert sorted(result.status_code for result in results) == [200,409]
    with data.factory() as db:
        inactive = not db.get(m.TaskStatus, row['id']).is_active
        assert (db.get(m.Task, data.task.id).status == m.TaskStatusEnum.BUG_FIXING) != inactive


def test_native_sql_assignment_guard_runs_after_custom_canonicalization(client, data):
    doc, custom = add(client, data.owner)
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id':custom['id']}).status_code == 200
    row = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    assert deactivate(client, data.owner, doc, row).status_code == 200
    with data.factory() as db, pytest.raises(DatabaseError, match='inactive'):
        db.execute(sa.text("UPDATE tasks SET status='BUG_FIXING' WHERE id=:id"), {'id':data.task.id})


def test_deactivation_reviews_assignments_from_other_database_writers(client, data, engine):
    if engine.dialect.name != 'postgresql':
        pytest.skip('PostgreSQL row lock ordering')
    doc = document(client, data.owner)
    row = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    locking = Event()
    def before_cursor(connection, cursor, statement, parameters, context, executemany):
        if 'FROM task_statuses' in statement and 'task_statuses.id =' in statement and 'FOR UPDATE' in statement:
            locking.set()
    sa.event.listen(engine, 'before_cursor_execute', before_cursor)
    try:
        with data.factory() as writer:
            writer.execute(sa.text("UPDATE tasks SET status='BUG_FIXING' WHERE id=:id"), {'id':data.task.id})
            with ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(deactivate, client, data.owner, doc, row)
                # The owner must lock the status before counting, waiting for
                # the direct writer's status SHARE lock, rather than reviewing
                # a stale zero count and deactivating behind the writer.
                try:
                    assert locking.wait(10)
                finally:
                    writer.commit()
                assert result.result(timeout=15).status_code == 409
    finally:
        sa.event.remove(engine, 'before_cursor_execute', before_cursor)


def test_migration_preserves_data_and_refuses_unsafe_downgrade(client, data, engine):
    doc, custom = add(client, data.owner)
    assert client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id':custom['id']}).status_code == 200
    migration = import_module('backend.alembic.versions.f44ab1c2d3e4_owner_status_controls')
    with engine.connect() as c:
        if engine.dialect.name == 'sqlite':
            c.exec_driver_sql('PRAGMA foreign_keys=OFF'); c.commit()
        with c.begin(), Operations.context(MigrationContext.configure(c)):
            migration.downgrade()  # Genuine prior constraints/guards.
            queries = ['SELECT * FROM task_statuses ORDER BY id', 'SELECT id,status,custom_status_id,completed_at FROM tasks ORDER BY id',
                       'SELECT * FROM task_lifecycle_events ORDER BY id', 'SELECT * FROM status_configuration_audits ORDER BY id']
            before = [list(c.execute(sa.text(query))) for query in queries]
            migration.upgrade()
            assert before == [list(c.execute(sa.text(query))) for query in queries]
            assert not status_integrity.schema_issues(c)
        if engine.dialect.name == 'sqlite':
            c.exec_driver_sql('PRAGMA foreign_keys=ON'); c.commit()
    row = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    assert deactivate(client, data.owner, doc, row).status_code == 200
    with pytest.raises(RuntimeError, match='Reactivate'), engine.begin() as c, Operations.context(MigrationContext.configure(c)):
        migration.downgrade()


def test_deactivation_keeps_deployed_completion_award_and_history(client, data):
    doc = document(client, data.owner)
    with data.factory() as db:
        child = db.get(m.Subtask, data.child.id)
        child.status = m.SubtaskStatusEnum.DONE; child.completed = True
        db.commit()
    moved = client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'status':'DEPLOYED'})
    assert moved.status_code == 200, moved.text
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        marker, completed = task.completion_xp_awarded_at, task.completed_at
        points = db.get(m.User, data.owner.id).points
        history = list(db.scalars(sa.select(m.TaskLifecycleEvent.id)))
        assert marker and points > 125
    row = next(row for row in doc['statuses'] if row['code'] == 'DEPLOYED')
    assert deactivate(client, data.owner, doc, row, 1).status_code == 200
    with data.factory() as db:
        task = db.get(m.Task, data.task.id)
        assert task.status == m.TaskStatusEnum.DEPLOYED
        assert (task.completion_xp_awarded_at, task.completed_at) == (marker, completed)
        assert db.get(m.User, data.owner.id).points == points
        assert list(db.scalars(sa.select(m.TaskLifecycleEvent.id))) == history
        assert status_integrity.audit_data(db.connection())['errors'] == {}
