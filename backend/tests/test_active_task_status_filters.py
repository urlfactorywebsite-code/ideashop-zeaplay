"""Configured status counts and task filters retain tenant/assignment boundaries."""
from datetime import datetime
from uuid import uuid4

import pytest

from backend.app import models as m
from backend.app.services import task_statuses
from backend.tests.test_task_status_management import (  # noqa: F401
    client, data, engine, headers,
)


def seed_status(data, user, name):
    # These read-contract tests seed configuration directly; the shared ORM-only
    # fixture intentionally does not run PostgreSQL Settings-write migrations.
    with data.factory() as db:
        task_statuses.scope(db, user)
        row = m.TaskStatus(id=str(uuid4()), tenant_id=user.tenant_id, code='CUSTOM_' + uuid4().hex,
                           system_name=name, display_label=name, normalized_name=name.lower(), normalized_label=name.lower(),
                           is_system=False, is_active=True, kanban_visible=False, workflow_behavior='ACTIVE')
        db.add(row)
        db.commit()
        return {'id': row.id}


def configure(client, data):
    custom = seed_status(data, data.owner, 'Active review')
    response = client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner), json={'custom_status_id': custom['id']})
    assert response.status_code == 200, response.text
    with data.factory() as db:
        db.get(m.Task, data.task.id).due_at = datetime(2026, 11, 16, 12)
        native = m.Task(id=str(uuid4()), title='Native working task',
                        created_by_id=data.owner.id, assigned_to_id=data.owner.id,
                        status=m.TaskStatusEnum.IN_PROGRESS, due_at=datetime(2026, 11, 16, 12))
        other = m.Task(id=str(uuid4()), title='Other workspace',
                       created_by_id=data.outsider.id, assigned_to_id=data.outsider.id,
                       status=m.TaskStatusEnum.IN_PROGRESS, due_at=datetime(2026, 11, 16, 12))
        db.add_all([native, other])
        db.commit()
        native_id = native.id
    return custom, native_id


@pytest.mark.parametrize('grouped', [False, True])
def test_exact_custom_counts_and_filters_keep_legacy_aggregate(client, data, grouped):
    custom, native_id = configure(client, data)
    params = {'grouped': grouped}
    response = client.get('/api/tasks/page', headers=headers(data.owner), params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['total'] == 2
    assert body['status_counts'] == {'IN_PROGRESS': 2}
    assert body['configured_status_counts'] == {'IN_PROGRESS': 1, custom['id']: 1}
    for value, expected in [('IN_PROGRESS', native_id), (custom['id'], data.task.id)]:
        response = client.get('/api/tasks/page', headers=headers(data.owner), params={**params, 'status': value})
        assert response.status_code == 200, response.text
        assert response.json()['total'] == 1
        assert response.json()['items'][0]['id'] == expected
        assert response.json()['configured_status_counts'] == {value: 1}
    foreign = seed_status(data, data.outsider, 'Other review')
    for value in [foreign['id'], 'unknown-status']:
        response = client.get('/api/tasks/page', headers=headers(data.owner), params={**params, 'status': value})
        assert response.status_code == 422, response.text


def test_calendar_filters_support_configured_status_identity(client, data):
    custom, native_id = configure(client, data)
    for value, expected in [('IN_PROGRESS', native_id), (custom['id'], data.task.id)]:
        params = {'start_date': '2026-11-16', 'end_date': '2026-11-16', 'timezone': 'UTC', 'status': value}
        response = client.get('/api/tasks/calendar/tasks', headers=headers(data.owner), params=params)
        assert response.status_code == 200, response.text
        assert [row['id'] for row in response.json()] == [expected]
        response = client.get('/api/tasks/calendar/summary', headers=headers(data.owner), params=params)
        assert response.status_code == 200, response.text
        assert sum(day['total'] for day in response.json()['days']) == 1

