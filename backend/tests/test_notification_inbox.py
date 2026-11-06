"""Notification bulk operations use real authentication and isolated databases."""
# Imported pytest fixtures are intentionally supplied again as function arguments.
# ruff: noqa: F811
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from backend.app import models
from backend.app.database import get_db
from backend.app.routers import notifications
from backend.tests.test_notification_realtime import token_for
from backend.tests.test_push_dispatch import engine, fixture  # noqa: F401


@pytest.fixture
def client(fixture):
    app = FastAPI()
    app.include_router(notifications.router, prefix='/api')
    def database():
        with fixture.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def notices(fixture):
    with fixture.factory() as db:
        values = [
            ('mine', fixture.recipient.id, fixture.recipient.tenant_id, False),
            ('read', fixture.recipient.id, fixture.recipient.tenant_id, True),
            ('legacy', fixture.recipient.id, None, False),
            ('wrong_tenant', fixture.recipient.id, fixture.foreign.tenant_id, False),
            ('other_user', fixture.actor.id, fixture.actor.tenant_id, False),
        ]
        rows = {key: models.Notification(user_id=user, tenant_id=tenant, is_read=read,
            type=models.NotificationTypeEnum.TASK_UPDATED, message=key) for key, user, tenant, read in values}
        db.add_all(rows.values())
        db.commit()
        return {key: value.id for key, value in rows.items()}


def auth(fixture):
    return {'Authorization': 'Bearer ' + token_for(fixture.recipient)}


@pytest.mark.parametrize('role', list(models.RoleEnum))
def test_bulk_delete_and_mark_all_read_are_available_only_for_own_scoped_history(client, fixture, notices, role):
    with fixture.factory() as db:
        db.get(models.User, fixture.recipient.id).role = role
        db.commit()
    headers = auth(fixture)
    assert client.post('/api/notifications/read-all', headers=headers).status_code == 204
    with fixture.factory() as db:
        for key in ('mine', 'read', 'legacy'):
            assert db.get(models.Notification, notices[key]).is_read
        for key in ('wrong_tenant', 'other_user'):
            assert not db.get(models.Notification, notices[key]).is_read
    chosen = [notices['mine'], notices['legacy']]
    response = client.post('/api/notifications/bulk-delete', headers=headers, json={'notification_ids': chosen + chosen})
    assert response.status_code == 200, response.text
    assert set(response.json()['deleted_ids']) == set(chosen)
    with fixture.factory() as db:
        assert all(db.get(models.Notification, key) is None for key in chosen)
        assert all(db.get(models.Notification, notices[key]) is not None for key in ('read', 'wrong_tenant', 'other_user'))
        audit = db.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == 'notifications.deleted'))
        assert audit.actor_id == fixture.recipient.id and audit.payload['count'] == 2
        assert set(audit.payload['notification_ids']) == set(chosen)
    assert client.post('/api/notifications/bulk-delete', headers=headers, json={'notification_ids': chosen}).status_code == 404


@pytest.mark.parametrize('unavailable', ['wrong_tenant', 'other_user', 'missing'])
def test_bulk_delete_rejects_entire_batch_when_any_id_is_unavailable(client, fixture, notices, unavailable):
    ids = [notices['mine'], notices.get(unavailable, str(uuid4()))]
    response = client.post('/api/notifications/bulk-delete', headers=auth(fixture), json={'notification_ids': ids})
    assert response.status_code == 404
    with fixture.factory() as db:
        assert db.get(models.Notification, notices['mine']) is not None
        assert list(db.scalars(select(models.AuditEvent))) == []


@pytest.mark.parametrize('body', [
    {'notification_ids': []}, {'notification_ids': ['x'] * 501}, {'notification_ids': ['x' * 37]},
    {'notification_ids': ['\x00']}, {'notification_ids': [True]},
    {'notification_ids': ['x'], 'tenant_id': 'injected'},
])
def test_bulk_delete_validates_bounded_explicit_ids(client, fixture, body):
    assert client.post('/api/notifications/bulk-delete', headers=auth(fixture), json=body).status_code == 422


def test_bulk_delete_requires_auth_and_rolls_back_a_failed_transaction(client, fixture, notices):
    body = {'notification_ids': [notices['mine']]}
    assert client.post('/api/notifications/bulk-delete', json=body).status_code == 401
    def fail_flush(db, *_):
        if any(isinstance(item, models.Notification) for item in db.deleted):
            raise RuntimeError('Injected transaction failure')
    event.listen(fixture.factory.class_, 'before_flush', fail_flush)
    try:
        assert client.post('/api/notifications/bulk-delete', headers=auth(fixture), json=body).status_code == 500
    finally:
        event.remove(fixture.factory.class_, 'before_flush', fail_flush)
    with fixture.factory() as db:
        assert db.get(models.Notification, notices['mine']) is not None
        assert list(db.scalars(select(models.AuditEvent))) == []
