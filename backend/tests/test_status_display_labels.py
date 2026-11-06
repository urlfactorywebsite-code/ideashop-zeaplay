"""Tenant-scoped public label reads; owner-only renames preserve task identity."""
import pytest
import sqlalchemy as sa

from backend.app import models as m
from backend.tests.test_task_status_management import (  # noqa: F401
    client, data, engine, headers, document, payload, add,
)


def test_owner_rename_reaches_all_roles_without_exposing_configuration_counts(client, data):
    doc = document(client, data.owner)
    draft = payload(doc)
    target = next(row for row in draft['statuses'] if row['system_name'] == 'Case Filed')
    target['display_label'] = 'Queued Quest'
    with data.factory() as db:
        before = [(row.id,row.event_type,row.previous_status,row.new_status) for row in db.scalars(sa.select(m.TaskLifecycleEvent))]
    response = client.put('/api/task-statuses', headers=headers(data.owner), json=draft)
    assert response.status_code == 200, response.text
    assert next(row for row in response.json()['statuses'] if row['id'] == target['id'])['code'] == 'TODO'
    for role in (m.RoleEnum.OWNER,m.RoleEnum.ADMIN,m.RoleEnum.MANAGER,m.RoleEnum.USER):
        with data.factory() as db:
            db.get(m.User,data.owner.id).role = role
            db.commit()
        catalog = client.get('/api/kanban-columns?include_inactive=true', headers=headers(data.owner))
        assert catalog.status_code == 200, catalog.text
        assert catalog.headers['cache-control'] == 'no-store'
        row = next(row for row in catalog.json() if row['id'] == 'TODO')
        assert row['title'] == 'Queued Quest' and row['is_active']
        assert 'task_count' not in row and 'tenant_id' not in row and 'revision' not in row
        task = client.get(f'/api/tasks/{data.task.id}', headers=headers(data.owner))
        assert task.status_code == 200, task.text
        assert task.json()['status'] == 'TODO' and task.json()['status_title'] == 'Queued Quest'
        if role != m.RoleEnum.OWNER:
            assert client.put('/api/task-statuses', headers=headers(data.owner), json=payload(response.json())).status_code == 403
    with data.factory() as db:
        assert [(row.id,row.event_type,row.previous_status,row.new_status) for row in db.scalars(sa.select(m.TaskLifecycleEvent))] == before
        assert db.get(m.Task,data.task.id).status == m.TaskStatusEnum.TODO
        assert db.get(m.User,data.owner.id).points == 125


def test_catalog_keeps_inactive_names_and_is_tenant_scoped(client, data):
    doc = document(client,data.owner)
    target = next(row for row in doc['statuses'] if row['code'] == 'BUG_FIXING')
    draft = payload(doc)
    next(row for row in draft['statuses'] if row['id'] == target['id'])['display_label'] = 'Private Guild Quality'
    changed = client.put('/api/task-statuses',headers=headers(data.owner),json=draft).json()
    removed = client.post(f"/api/task-statuses/{target['id']}/remove",headers=headers(data.owner),json={
        'revision':changed['revision'],'action':'archive','confirmation':'Private Guild Quality','expected_task_count':0})
    assert removed.status_code == 200, removed.text
    visible = client.get('/api/kanban-columns',headers=headers(data.owner)).json()
    assert 'BUG_FIXING' not in [row['id'] for row in visible]
    all_rows = client.get('/api/kanban-columns?include_inactive=true',headers=headers(data.owner)).json()
    row = next(row for row in all_rows if row['id'] == 'BUG_FIXING')
    assert row['title'] == 'Private Guild Quality' and not row['is_active']
    other = client.get(f'/api/kanban-columns?include_inactive=true&tenant_id={data.owner.tenant_id}',headers=headers(data.outsider))
    assert other.status_code == 200 and all(row['title'] != 'Private Guild Quality' for row in other.json())
    assert client.get('/api/kanban-columns?include_inactive=true').status_code == 401


def test_duplicate_rename_rejected_atomically_and_custom_aliases_remain_available(client, data):
    doc, custom = add(client,data.owner,'Review Queue')
    draft = payload(doc)
    draft['statuses'][0]['display_label'] = '  REVIEW   QUEUE '
    assert client.put('/api/task-statuses',headers=headers(data.owner),json=draft).status_code == 422
    assert document(client,data.owner) == doc
    rows = client.get('/api/kanban-columns?include_inactive=true',headers=headers(data.owner)).json()
    assert next(row for row in rows if row['custom_status_id'] == custom['id'])['title'] == 'Review Queue'
