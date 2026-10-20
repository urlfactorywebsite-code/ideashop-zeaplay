"""Rebuilt Linux restore smoke; owns and drops one random scratch PG schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app import models
from app.config import get_settings
from app.database import Base, get_db
from app.routers.clients import router as clients_router
from app.routers.projects import router as projects_router
from app.tickets import models as ticket_models  # noqa: F401

url = os.environ['ZEAPLAY_RT_POSTGRES_TEST_URL']
assert 'rt3_test' in (make_url(url).database or ''), 'Scratch database required'
schema = 'restore_runtime_' + uuid4().hex
admin = create_engine(url)
engine = create_engine(url)
with admin.begin() as connection:
    connection.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public'))
    connection.execute(text(f'CREATE SCHEMA "{schema}"'))


@event.listens_for(engine, 'connect')
def scope(connection, _):
    cursor = connection.cursor()
    cursor.execute(f'SET search_path TO "{schema}", public')
    cursor.close(); connection.commit()


factory = sessionmaker(bind=engine, expire_on_commit=False)
def database():
    with factory() as db: yield db


try:
    Base.metadata.create_all(engine)
    tenant = uuid4()
    with factory() as db:
        users = [models.User(tenant_id=tenant if index < 2 else uuid4(), name='Synthetic restore actor',
            email=f'{uuid4()}@example.test', hashed_password='synthetic-unusable-password',
            role=models.RoleEnum.USER if index == 1 else models.RoleEnum.OWNER,
            status=models.UserStatusEnum.ACTIVE) for index in range(3)]
        db.add_all(users); db.commit()
    settings = get_settings()
    def auth(user):
        return {'Authorization': 'Bearer ' + jwt.encode({'user_id': user.id, 'tenant_id': str(user.tenant_id),
            'token_type': 'access', 'credentials_version': 0}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)}
    app = FastAPI()
    app.include_router(clients_router, prefix='/api'); app.include_router(projects_router, prefix='/api')
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        customer = client.post('/api/clients', json={'company_name': 'Runtime restore customer', 'notes': 'Preserved notes'}, headers=auth(users[0]))
        assert customer.status_code == 201, customer.text
        client_id = customer.json()['id']
        project = client.post('/api/projects', json={'name': 'Runtime restore project', 'client_id': client_id,
            'manager_ids': [users[0].id]}, headers=auth(users[0]))
        assert project.status_code == 201, project.text
        project_id = project.json()['id']
        with factory() as db:
            task = models.Task(project_id=project_id, title='Preserved task', created_by_id=users[0].id, assigned_to_id=users[0].id)
            db.add(task); db.flush()
            child = models.Subtask(task_id=task.id, title='Preserved complete work', status=models.SubtaskStatusEnum.DONE)
            db.add(child); db.flush()
            now = datetime.now(timezone.utc)
            entry = models.TimeEntry(tenant_id=tenant, user_id=users[0].id, subtask_id=child.id,
                started_at=now-timedelta(seconds=30), stopped_at=now, duration_seconds=30,
                status=models.TimeEntryStatusEnum.STOPPED, stop_reason='paused')
            db.add(entry); db.commit()
            preserved = (task.id, child.id, entry.id)
        assert client.post(f'/api/projects/{project_id}/archive', headers=auth(users[0])).status_code == 200
        assert client.post(f'/api/clients/{client_id}/archive', headers=auth(users[0])).status_code == 200
        assert client.post(f'/api/projects/{project_id}/restore', headers=auth(users[0])).status_code == 409
        for kind, identifier in [('clients', client_id), ('projects', project_id)]:
            path = f'/api/{kind}/{identifier}/restore'
            assert client.post(path).status_code == 401
            assert client.post(path, headers=auth(users[1])).status_code == 403
            assert client.post(path, headers=auth(users[2])).status_code == 404
            def restore(_):
                with TestClient(app) as tab:
                    response = tab.post(path, headers=auth(users[0]))
                    assert response.status_code == 200, response.text
                    return response.json()['id']
            with ThreadPoolExecutor(max_workers=6) as pool:
                assert set(pool.map(restore, range(6))) == {identifier}
            assert client.get(f'/api/{kind}?status=ARCHIVED', headers=auth(users[0])).json()['total'] == 0
            assert client.get(f'/api/{kind}?status=ACTIVE', headers=auth(users[0])).json()['total'] == 1
        with factory() as db:
            assert db.get(models.Task, preserved[0]).project_id == project_id
            assert db.get(models.Subtask, preserved[1]).status == models.SubtaskStatusEnum.DONE
            assert db.get(models.TimeEntry, preserved[2]).duration_seconds == 30
            assert db.get(models.TimeEntry, preserved[2]).stopped_at is not None
            for kind, identifier in [('client', client_id), ('project', project_id)]:
                events = db.scalars(select(models.AuditEvent).where(models.AuditEvent.entity_id == identifier,
                    models.AuditEvent.event_type.in_([f'{kind}.archived', f'{kind}.restored']))).all()
                assert len(events) == 2
                assert all(row.payload['tenant_id'] == str(tenant) for row in events)
    print(json.dumps({'platform': 'rebuilt Linux backend', 'database': 'isolated PostgreSQL schema',
        'concurrent_client_restores': 6, 'concurrent_project_restores': 6,
        'transition_events_per_entity': 2, 'rbac_tenant_integrity': 'PASS', 'result': 'PASS'}))
finally:
    engine.dispose()
    with admin.begin() as connection: connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()
