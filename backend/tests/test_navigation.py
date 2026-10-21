"""Tenant navigation authorization on disposable SQLite and isolated PostgreSQL."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event, inspect, select

from backend.app import models
from backend.app.auth import create_access_token
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.navigation_registry import API_SECTIONS, PAGES
from backend.app.routers import (
    auth,
    config,
    data_admin,
    logs,
    n8n,
    navigation,
    oauth_management,
    support,
    tasks,
    users,
    webhooks,
)
from backend.app.services import navigation as service
from backend.tests import test_task_lifecycle as lifecycle_fixtures

# Explicit aliases register the shared disposable-database pytest fixtures.
data = lifecycle_fixtures.data
engine = lifecycle_fixtures.engine


def headers(user):
    return {'Authorization': 'Bearer ' + create_access_token(user.id, extra_claims={
        'tenant_id': str(user.tenant_id), 'credentials_version': user.credentials_version})}


@pytest.fixture(autouse=True)
def isolate_side_effects(monkeypatch):
    from backend.app.services import audit_logger
    monkeypatch.setattr(audit_logger, 'log_event', lambda *args, **kwargs: None)
    monkeypatch.setattr(users, 'trigger_n8n_event', lambda *args, **kwargs: None)
    monkeypatch.setattr(get_settings(), 'enable_n8n_forwarding', False)


def test_browser_manifest_tracks_authoritative_server_registry():
    expected = [{'id': p.id, 'parentId': p.parent, 'defaultLabel': p.label, 'route': p.route,
        'navigationLocation': p.location, 'permittedRoles': list(p.roles), 'isSystemProtected': p.protected, 'sortOrder': i} for i, p in enumerate(PAGES)]
    actual = json.loads((Path(__file__).resolve().parents[2] / 'frontend/e2e/navigation-manifest.json').read_text(encoding='utf-8'))
    assert actual == expected
    api = json.loads((Path(__file__).resolve().parents[2] / 'frontend/e2e/navigation-api-manifest.json').read_text(encoding='utf-8'))
    assert api == [{'key': k, 'label': l, 'roles': list(r)} for k, l, r in API_SECTIONS]


@pytest.fixture
def people(data):
    with data.factory() as db:
        result = {}
        for role in models.RoleEnum:
            user = models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name=role.value,
                email=f'{uuid4()}@example.com', hashed_password='not-a-login-password',
                role=role, status=models.UserStatusEnum.ACTIVE)
            db.add(user)
            result[role.value] = user
        db.commit()
    return result


@pytest.fixture
def client(data):
    with data.factory() as db:
        for user in (data.owner, data.outsider):
            db.get(models.User, user.id).email = f'{uuid4()}@example.com'
        db.commit()
    app = FastAPI()
    for router in (data_admin.router, navigation.router, tasks.router, config.router, users.router, logs.router, support.router, n8n.router, auth.router, webhooks.router, oauth_management.router):
        app.include_router(router, prefix='/api')
        app.include_router(router)
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client


def document(client, user):
    response = client.get('/api/navigation', headers=headers(user))
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    return response.json()


def payload(doc):
    return {'revision': doc['revision'], 'pages': [{key: page[key] for key in ('id', 'enabled', 'hidden', 'allowedRoles', 'sortOrder')} for page in doc['pages']]}


def page(doc, id):
    return next(page for page in doc['pages'] if page['id'] == id)


def save(client, user, value):
    return client.put('/api/navigation', headers=headers(user), json=value)


@pytest.mark.parametrize('role', ['user', 'manager', 'admin', 'owner'])
def test_defaults_use_server_roles_and_restrict_nested_settings(client, people, role):
    doc = document(client, people[role])
    assert doc['revision'] == 0
    assert page(doc, 'settings')['access'] == 'allowed'
    assert page(doc, 'settings.api')['access'] == ('allowed' if role in ('admin', 'owner') else 'forbidden')
    assert page(doc, 'authorized-apps')['access'] == 'allowed'
    assert page(doc, 'authorized-apps')['route'] == '/settings/oauth/authorized-apps'
    assert page(doc, 'authorized-apps')['navigationLocation'] == 'settings-tab'
    assert page(doc, 'settings.sidebar-management')['access'] == ('allowed' if role in ('admin', 'owner') else 'forbidden')
    assert doc['canManageGlobal'] == (role == 'owner')
    assert doc['canManagePersonal'] == (role in ('admin', 'owner'))


@pytest.mark.parametrize('role', ['user', 'manager', 'admin', 'owner'])
def test_management_tabs_keep_role_ceilings_and_existing_policy_ids(client, people, role):
    doc = document(client, people[role])
    expected = 'forbidden' if role == 'user' else 'allowed'
    assert page(doc, 'management')['access'] == expected
    for id in ('users', 'clients'):
        entry = page(doc, id)
        assert entry['parentId'] == 'management'
        assert entry['navigationLocation'] == 'management-tab'
        assert entry['route'] == '/management/' + id
        assert entry['access'] == expected


def test_management_parent_and_child_policies_apply_independently(client, data, people):
    change = payload(document(client, data.owner))
    page(change, 'users')['allowedRoles'] = ['owner']
    page(change, 'clients')['hidden'] = True
    assert save(client, data.owner, change).status_code == 200
    assert page(document(client, people['manager']), 'users')['access'] == 'forbidden'
    assert page(document(client, people['manager']), 'clients')['access'] == 'hidden'
    change = payload(document(client, data.owner))
    page(change, 'management')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    for id in ('management', 'users', 'clients'):
        assert page(document(client, data.owner), id)['access'] == 'disabled'
    assert client.post('/api/auth/register', headers=headers(data.owner), json={}).status_code == 403
    with data.factory() as db:
        assert service.api_decision('clients', data.owner.role, db.get(models.NavigationPolicy, str(data.owner.tenant_id)).rules) == 'disabled'
    assert client.patch('/api/users/me', headers=headers(data.owner), json={'name': 'Own profile'}).status_code == 200


def test_oauth_is_independent_of_api_with_unchanged_management_role_ceiling(client, data, people):
    change = payload(document(client, data.owner))
    page(change, 'settings.api')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    for role, actor in people.items():
        assert page(document(client, actor), 'settings.oauth')['access'] == 'allowed'
        assert client.get('/api/oauth2/clients', headers=headers(actor)).status_code == (200 if role in ('owner', 'admin') else 403)
        assert client.get('/api/oauth2/my-grants', headers=headers(actor)).status_code == 200
    change = payload(document(client, data.owner))
    page(change, 'settings.oauth')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    assert client.get('/api/oauth2/clients', headers=headers(data.owner)).status_code == 403
    assert client.get('/api/oauth2/my-grants', headers=headers(data.owner)).status_code == 403


def test_existing_oauth_management_restrictions_survive_route_move(client, data, people):
    # A saved policy from before the new OAuth tab must never reopen admin APIs.
    with data.factory() as db:
        db.add(models.NavigationPolicy(tenant_id=str(data.owner.tenant_id), revision=1,
            updated_by=data.owner.id, updated_at=datetime.now(timezone.utc),
            rules={'settings.api': {'enabled': False}}))
        db.commit()
    for role in ('owner', 'admin'):
        doc = document(client, people[role])
        assert doc['oauthManagementAccess'] == 'disabled'
        assert client.get('/api/oauth2/clients', headers=headers(people[role])).status_code == 403
        assert client.get('/api/oauth2/my-grants', headers=headers(people[role])).status_code == 200
    change = payload(document(client, data.owner))
    assert save(client, data.owner, change).status_code == 200
    assert client.get('/api/oauth2/clients', headers=headers(data.owner)).status_code == 200


def test_owner_policy_persists_across_sessions_and_is_tenant_scoped(client, data, people):
    change = payload(document(client, data.owner))
    page(change, 'projects')['enabled'] = False
    response = save(client, data.owner, change)
    assert response.status_code == 200, response.text
    assert response.json()['revision'] == 1
    assert response.json()['updatedBy'] == data.owner.id
    assert response.json()['updatedAt']
    assert page(document(client, people['user']), 'projects')['access'] == 'disabled'
    assert page(document(client, data.outsider), 'projects')['access'] == 'allowed'
    assert document(client, data.outsider)['revision'] == 0
    # A caller cannot select a different tenant in either query or update body.
    assert client.get('/api/navigation?tenant_id=' + str(data.owner.tenant_id), headers=headers(data.outsider)).json()['revision'] == 0
    change['tenant_id'] = str(data.outsider.tenant_id)
    assert save(client, data.owner, change).status_code == 422
    with data.factory() as db:
        audit = db.scalar(select(models.AuditLog).where(models.AuditLog.action == 'navigation.policy.updated'))
        assert audit.entity_id == str(data.owner.tenant_id)
        assert audit.metadata_payload['tenant_id'] == str(data.owner.tenant_id)
        assert audit.after['projects']['enabled'] is False


@pytest.mark.parametrize('role', ['user', 'manager', 'admin'])
def test_non_owner_cannot_modify_global_policy(client, data, people, role):
    change = payload(document(client, data.owner))
    assert save(client, people[role], change).status_code == 403
    assert document(client, data.owner)['revision'] == 0


@pytest.mark.parametrize('id', ['settings', 'settings.profile', 'settings.sidebar-management', 'dashboard'])
@pytest.mark.parametrize('restriction', ['disable', 'hide', 'narrow'])
def test_protected_recovery_pages_cannot_be_restricted(client, data, id, restriction):
    change = payload(document(client, data.owner))
    target = page(change, id)
    target.update({'enabled': False} if restriction == 'disable' else {'hidden': True} if restriction == 'hide' else {'allowedRoles': []})
    assert save(client, data.owner, change).status_code == 422
    assert document(client, data.owner)['revision'] == 0


@pytest.mark.parametrize('mutation', ['unknown', 'duplicate', 'missing', 'unknown-role', 'permission-escalation', 'coerced-bool', 'negative-order'])
def test_invalid_policies_are_rejected_atomically(client, data, mutation):
    change = payload(document(client, data.owner))
    if mutation == 'unknown': change['pages'][0]['id'] = 'invented'
    elif mutation == 'duplicate': change['pages'].append(change['pages'][0])
    elif mutation == 'missing': change['pages'].pop()
    elif mutation == 'unknown-role': page(change, 'settings.api')['allowedRoles'] = ['superadmin']
    elif mutation == 'permission-escalation': page(change, 'settings.api')['allowedRoles'] = ['user', 'owner']
    elif mutation == 'coerced-bool': page(change, 'projects')['enabled'] = 'false'
    else: page(change, 'projects')['sortOrder'] = -1
    assert save(client, data.owner, change).status_code == 422
    assert document(client, data.owner)['revision'] == 0


def test_disabled_tasks_reject_real_api_calls_and_preserve_records(client, data):
    change = payload(document(client, data.owner))
    page(change, 'tasks')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    for prefix in ('', '/api'):
        response = client.get(prefix + '/tasks/' + data.task.id, headers=headers(data.owner))
        assert response.status_code == 403
        assert response.json()['detail']['code'] == 'MODULE_DISABLED'
    with data.factory() as db:
        assert db.get(models.Task, data.task.id).title == 'Lifecycle test'
        assert db.get(models.Subtask, data.child.id)


def test_hidden_only_remains_independently_authorized_and_disabled_parent_blocks_children(client, data):
    change = payload(document(client, data.owner))
    page(change, 'tasks')['hidden'] = True
    page(change, 'achievements')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    assert client.get('/api/tasks/' + data.task.id, headers=headers(data.owner)).status_code == 200
    doc = document(client, data.owner)
    assert page(doc, 'tasks')['access'] == 'hidden'
    assert page(doc, 'levels')['access'] == 'disabled'
    assert page(doc, 'points-table')['access'] == 'disabled'


def test_role_narrowing_is_enforced_by_api_not_just_navigation(client, data, people):
    change = payload(document(client, data.owner))
    page(change, 'tasks')['allowedRoles'] = ['owner']
    assert save(client, data.owner, change).status_code == 200
    response = client.get('/api/tasks', headers=headers(people['user']))
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'PAGE_FORBIDDEN'
    assert client.get('/api/tasks/' + data.task.id, headers=headers(data.owner)).status_code == 200


@pytest.mark.parametrize('role', ['user', 'manager', 'admin'])
def test_sensitive_credentials_cannot_be_exposed_by_policy(client, people, role):
    assert client.get('/api/config/api', headers=headers(people[role])).status_code == 403


def test_profile_recovery_remains_available_when_users_module_disabled(client, data, people):
    change = payload(document(client, data.owner))
    page(change, 'users')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    # Existing profile endpoint still validates its own payload and password.
    assert client.patch('/api/users/me', headers=headers(people['user']), json={'name': 'Updated self'}).status_code == 200
    profile = client.patch('/api/users/me', headers=headers(people['user']), json={'name': 'Still self', 'role': 'owner'})
    assert profile.status_code in {200, 422}  # Ignoring or rejecting unknown fields must never grant roles.
    with data.factory() as db:
        assert db.get(models.User, people['user'].id).role == models.RoleEnum.USER
    response = client.post('/api/users/me/change-password', headers=headers(people['user']), json={})
    assert response.status_code == 422


def test_stale_save_is_409_and_never_overwrites_newer_policy(client, data):
    first = payload(document(client, data.owner))
    second = payload(document(client, data.owner))
    page(first, 'tasks')['enabled'] = False
    page(second, 'projects')['enabled'] = False
    assert save(client, data.owner, first).status_code == 200
    assert save(client, data.owner, second).status_code == 409
    current = document(client, data.owner)
    assert page(current, 'tasks')['enabled'] is False
    assert page(current, 'projects')['enabled'] is True
    second['revision'] = current['revision'] - 1
    assert save(client, data.owner, second).status_code == 409


def test_concurrent_initial_writers_have_one_winner(client, data):
    change = payload(document(client, data.owner))
    def write(_):
        with data.factory() as db:
            try:
                service.save(db, data.owner, navigation.PolicyUpdate.model_validate(change))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, range(2))) == [200, 409]


def test_concurrent_existing_revision_writers_have_one_winner(client, data):
    initial = payload(document(client, data.owner))
    assert save(client, data.owner, initial).status_code == 200
    change = payload(document(client, data.owner))
    def write(index):
        value = json.loads(json.dumps(change))
        page(value, 'projects' if index else 'tasks')['enabled'] = False
        with data.factory() as db:
            try:
                service.save(db, data.owner, navigation.PolicyUpdate.model_validate(value))
                return 200
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, range(2))) == [200, 409]
    current = document(client, data.owner)
    assert current['revision'] == 2
    assert sum(not page(current, id)['enabled'] for id in ('tasks', 'projects')) == 1


def test_forged_role_claims_cannot_override_database_role_or_tenant(client, people, data):
    user = people['user']
    token = create_access_token(user.id, extra_claims={'tenant_id': str(user.tenant_id),
        'credentials_version': user.credentials_version, 'roles': ['owner']})
    forged = {'Authorization': 'Bearer ' + token}
    assert client.get('/api/navigation', headers=forged).json()['actorRole'] == 'user'
    assert client.put('/api/navigation', json=payload(document(client, data.owner)), headers=forged).status_code == 403
    other_tenant = create_access_token(user.id, extra_claims={'tenant_id': str(data.outsider.tenant_id),
        'credentials_version': user.credentials_version, 'roles': ['owner']})
    assert client.get('/api/navigation', headers={'Authorization': 'Bearer ' + other_tenant}).status_code == 401


def test_anonymous_policy_read_and_update_are_rejected(client):
    assert client.get('/api/navigation').status_code in {401, 403}
    assert client.put('/api/navigation', json={'revision': 0, 'pages': []}).status_code in {401, 403}


@pytest.mark.parametrize('role,destination', [('manager', 'admin'), ('manager', 'owner'), ('admin', 'owner')])
def test_account_mutations_cannot_escalate_navigation_authority(client, data, people, role, destination):
    actor, target = people[role], people[destination]
    response = client.patch('/api/users/' + actor.id, json={'role': destination}, headers=headers(actor))
    assert response.status_code == 403
    assert client.patch('/api/users/' + target.id, json={'name': 'Taken over'}, headers=headers(actor)).status_code == 403
    assert client.delete('/api/users/' + target.id, headers=headers(actor)).status_code == 403
    assert client.post('/api/users/' + target.id + '/reset-password', json={'new_password': 'Synthetic-review-only-2026!'}, headers=headers(actor)).status_code == 403
    with data.factory() as db:
        assert db.get(models.User, actor.id).role.value == role
        assert db.get(models.User, target.id).name == destination
        assert db.get(models.User, target.id).hashed_password == 'not-a-login-password'
    with pytest.raises(HTTPException) as denied:
        users._ensure_user_admin_scope(actor, new_role=models.RoleEnum(destination))
    assert denied.value.status_code == 403


def test_registration_requires_staff_and_cannot_select_another_tenant_or_higher_role(client, data, people):
    value = {'name': 'Registration review', 'email': f'{uuid4()}@example.com', 'password': 'Synthetic-registration-review-2026!',
        'role': 'owner', 'status': 'ACTIVE', 'employer_id': str(data.outsider.tenant_id)}
    assert client.post('/api/auth/register', json=value).status_code in {401, 403}
    for role in ('user', 'manager', 'admin'):
        assert client.post('/api/auth/register', json=value, headers=headers(people[role])).status_code == 403
    created = client.post('/api/auth/register', json=value, headers=headers(data.owner))
    assert created.status_code == 201, created.text
    assert created.json()['user']['tenant_id'] == str(data.owner.tenant_id)
    assert created.json()['user']['tenant_id'] != value['employer_id']
    # This is the ordinary staff-create flow, not a permission escalation.
    value.update(email=f'{uuid4()}@example.com', role='user', employer_id=None)
    ordinary = client.post('/api/auth/register', json=value, headers=headers(people['manager']))
    assert ordinary.status_code == 201
    assert ordinary.json()['user']['role'] == 'user'


def test_disabled_task_policy_prevents_fanout_without_affecting_another_tenant(client, data, monkeypatch):
    import asyncio

    from backend.app.ws import tasks as sockets
    monkeypatch.setattr(sockets, 'SessionLocal', data.factory)
    class Socket:
        def __init__(self): self.scope = {'credentials_version': 0}; self.messages = []; self.closed = []
        async def send_json(self, message): self.messages.append(message)
        async def close(self, code): self.closed.append(code)
    manager = sockets.TaskConnectionManager()
    first, second = Socket(), Socket()
    manager._connections = {str(data.owner.tenant_id): {first}, str(data.outsider.tenant_id): {second}}
    manager._socket_users = {first: data.owner.id, second: data.outsider.id}
    change = payload(document(client, data.owner))
    page(change, 'tasks')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    asyncio.run(manager.broadcast(str(data.owner.tenant_id), {'type': 'task.changed'}))
    assert first.messages == [] and first.closed == [1008]
    assert second.messages == [] and second.closed == []
    asyncio.run(manager.broadcast(str(data.outsider.tenant_id), {'type': 'task.changed'}))
    assert second.messages == [{'type': 'task.changed'}]


def test_audit_failure_rolls_back_policy(data):
    with data.factory() as db:
        change = payload(service.document(db, data.owner))
        @event.listens_for(db, 'before_flush')
        def fail_audit(session, *_):
            if any(isinstance(item, models.AuditLog) for item in session.new):
                raise RuntimeError('synthetic audit failure')
        with pytest.raises(RuntimeError, match='synthetic audit'):
            service.save(db, data.owner, navigation.PolicyUpdate.model_validate(change))
    with data.factory() as db:
        assert service.document(db, data.owner)['revision'] == 0


def test_navigation_audit_reads_do_not_cross_tenants(client, data):
    change = payload(document(client, data.owner))
    assert save(client, data.owner, change).status_code == 200
    assert client.get('/api/logs/audit?action=navigation.policy.updated', headers=headers(data.owner)).json()['total'] == 1
    assert client.get('/api/logs/audit?action=navigation.policy.updated', headers=headers(data.outsider)).json()['total'] == 0


def test_support_policy_is_enforced_before_external_forwarding(client, data, people, monkeypatch):
    calls = []
    class Transport:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, json):
            calls.append((url, json))
            class Response: status_code = 200
            return Response()
    monkeypatch.setattr(support.httpx, 'AsyncClient', Transport)
    value = {'email': 'member@example.com', 'subject': 'Synthetic support', 'category': 'Bug', 'priority': 'Low', 'description': 'No real delivery.', 'user_id': 'spoofed'}
    assert client.post('/api/support/requests', json=value, headers=headers(people['user'])).status_code == 200
    assert calls[0][1]['user_id'] == people['user'].id
    change = payload(document(client, data.owner))
    page(change, 'settings.support')['enabled'] = False
    assert save(client, data.owner, change).status_code == 200
    response = client.post('/api/support/requests', json=value, headers=headers(people['user']))
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'MODULE_DISABLED'
    assert len(calls) == 1


def test_disabled_task_socket_rejected_at_handshake_and_existing_socket_revalidated(client, data, monkeypatch):
    from starlette.websockets import WebSocketDisconnect

    from backend.app.config import get_settings
    from backend.app.ws import tasks as sockets
    monkeypatch.setattr(sockets, 'SessionLocal', data.factory)
    monkeypatch.setattr(get_settings(), 'websocket_require_ticket', False)
    monkeypatch.setattr(get_settings(), 'websocket_require_origin', False)
    client.app.include_router(sockets.router)
    token = headers(data.owner)['Authorization'].split(' ', 1)[1]
    with client.websocket_connect('/ws/tasks?token=' + token) as ws:
        assert ws.receive_json()['type'] == 'realtime:ready'
        change = payload(document(client, data.owner))
        page(change, 'tasks')['enabled'] = False
        assert save(client, data.owner, change).status_code == 200
        ws.send_json({'type': 'pong'})
        with pytest.raises(WebSocketDisconnect): ws.receive_json()
    with pytest.raises(WebSocketDisconnect), client.websocket_connect('/ws/tasks?token=' + token):
        pass


@pytest.mark.parametrize('id', ['tasks', 'chat', 'tickets'])
def test_socket_policy_rechecks_disabled_modules_and_allows_hidden_only(data, id):
    with data.factory() as db:
        change = payload(service.document(db, data.owner))
        page(change, id)['hidden'] = True
        doc = service.save(db, data.owner, navigation.PolicyUpdate.model_validate(change))
        assert service.socket_allowed(db, data.owner, id)
        change = payload(doc)
        page(change, id)['enabled'] = False
        service.save(db, data.owner, navigation.PolicyUpdate.model_validate(change))
        assert not service.socket_allowed(db, data.owner, id)


def test_default_navigation_save_does_not_replace_independent_api_permissions(client, data, people):
    # Scoped client resource reads can be independently authorized to ordinary
    # users even though they cannot open the Clients administration page.
    role = people['user'].role
    assert service.api_decision('clients', role, {}) == 'allowed'
    change = payload(document(client, data.owner))
    assert save(client, data.owner, change).status_code == 200
    with data.factory() as db:
        rules = db.get(models.NavigationPolicy, str(data.owner.tenant_id)).rules
        assert service.api_decision('clients', role, rules) == 'allowed'
        assert service.decision('clients', role, rules) == 'forbidden'
        rules['clients']['hidden'] = True
        assert service.api_decision('clients', role, rules) == 'allowed'


def test_real_login_api_visibility_disable_and_reenable_matrix(client, data, people, monkeypatch):
    from backend.app.auth import hash_password
    from backend.app.services import audit_logger
    monkeypatch.setattr(audit_logger, 'log_event', lambda *a, **kw: None)
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    password = 'Synthetic-navigation-review-2026!'
    hashed = hash_password(password)
    with data.factory() as db:
        for user in people.values(): db.get(models.User, user.id).hashed_password = hashed
        db.commit()
    tokens = {}
    for role, user in people.items():
        login = client.post('/api/auth/login', json={'email': user.email, 'password': password})
        assert login.status_code == 200, login.text
        tokens[role] = {'Authorization': 'Bearer ' + login.json()['token']['access_token']}
    change = payload(client.get('/api/navigation', headers=tokens['owner']).json())
    page(change, 'settings')['enabled'] = True
    page(change, 'settings.api').update(enabled=True, allowedRoles=['owner', 'admin'])
    assert client.put('/api/navigation', json=change, headers=tokens['owner']).status_code == 200
    for role in ('owner', 'admin', 'manager', 'user'):
        doc = client.get('/api/navigation', headers=tokens[role]).json()
        assert page(doc, 'settings.api')['access'] == ('allowed' if role in ('owner', 'admin') else 'forbidden')
        assert client.get('/api/oauth2/clients', headers=tokens[role]).status_code == (200 if role in ('owner', 'admin') else 403)
        if role in ('user', 'manager'):
            for endpoint in ('/config/api', '/config/smtp/multiple', '/integrations/n8n/config', '/webhooks'):
                assert client.get('/api' + endpoint, headers=tokens[role]).status_code == 403, endpoint
    change = payload(client.get('/api/navigation', headers=tokens['owner']).json())
    page(change, 'settings.api')['enabled'] = False
    page(change, 'settings.oauth')['enabled'] = False
    assert client.put('/api/navigation', json=change, headers=tokens['owner']).status_code == 200
    for role, authentication in tokens.items():
        doc = client.get('/api/navigation', headers=authentication).json()
        assert page(doc, 'settings.api')['access'] in {'disabled', 'forbidden'}
        assert client.get('/api/oauth2/clients', headers=authentication).status_code == 403
        assert page(doc, 'settings.profile')['access'] == 'allowed'
    change = payload(client.get('/api/navigation', headers=tokens['owner']).json())
    page(change, 'settings.api')['enabled'] = True
    assert client.put('/api/navigation', json=change, headers=tokens['owner']).status_code == 200
    for role in tokens:
        assert page(client.get('/api/navigation', headers=tokens[role]).json(), 'settings.api')['access'] == ('allowed' if role in ('owner', 'admin') else 'forbidden')


def test_legacy_installation_configuration_is_not_exposed_to_other_tenant_owners(client, data, monkeypatch):
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    assert client.get('/api/config/api', headers=headers(data.owner)).status_code == 200
    assert client.get('/api/config/api', headers=headers(data.outsider)).status_code == 403
    assert client.get('/api/integrations/n8n/config', headers=headers(data.outsider)).status_code == 403


def test_nested_api_permissions_inherit_parent_state_without_becoming_grants(client, data, people):
    for role in people:
        doc = document(client, people[role])
        assert all(section['access'] == 'forbidden' for section in doc['apiSections']) if role in ('user', 'manager') else True
    assert service.decision('settings.api', 'owner', {'settings': {'enabled': False}}) == 'disabled'
    assert service.decision('settings.api', 'owner', {'settings': {'hidden': True}}) == 'hidden'
    assert service.decision('settings.api', 'user', {'settings': {'hidden': False}}) == 'forbidden'


def test_webhook_management_and_delivery_queue_are_tenant_scoped(client, data):
    from backend.app.tickets.models import WebhookSubscription
    from backend.app.webhooks import service as webhook_service
    with data.factory() as db:
        own = WebhookSubscription(tenant_id=data.owner.tenant_id, name='Owned', target_url='https://example.com/owned', secret='synthetic-own-secret', subscribed_events=['task.created'])
        other = WebhookSubscription(tenant_id=data.outsider.tenant_id, name='Other', target_url='https://example.com/other', secret='synthetic-other-secret', subscribed_events=['task.created'])
        db.add_all([own, other]); db.commit()
        own_id, other_id = str(own.id), str(other.id)
        deliveries = webhook_service.queue_event(db, event_name='task.created', data={'message': 'synthetic'}, tenant_id=data.owner.tenant_id)
        assert [delivery.subscription_id for delivery in deliveries] == [own.id]
        assert all(delivery.tenant_id == data.owner.tenant_id for delivery in deliveries)
        db.commit()
    listing = client.get('/api/webhooks', headers=headers(data.owner))
    assert listing.status_code == 200
    assert [row['id'] for row in listing.json()] == [own_id]
    assert 'synthetic-other-secret' not in listing.text
    assert client.delete('/api/webhooks/' + other_id, headers=headers(data.owner)).status_code == 404
    assert client.put('/api/webhooks/' + other_id, json={'name': 'Tampered'}, headers=headers(data.owner)).status_code == 404
    assert client.post('/api/webhooks/' + other_id + '/test', json={}, headers=headers(data.owner)).status_code == 404
    assert client.get('/api/webhooks/deliveries', headers=headers(data.outsider)).json()['total'] == 0
    with data.factory() as db:
        assert db.get(WebhookSubscription, UUID(other_id)).name == 'Other'


def test_unattributed_webhook_event_cannot_leak_to_installation_tenant(data, monkeypatch):
    from backend.app.tickets.models import WebhookSubscription
    from backend.app.webhooks import service as webhook_service
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    with data.factory() as db:
        db.add(WebhookSubscription(tenant_id=data.owner.tenant_id, name='Installation',
            target_url='https://example.com/unused', secret='synthetic', subscribed_events=['user.updated']))
        db.commit()
        db.info.clear()
        assert webhook_service.queue_event(db, event_name='user.updated', data={'message': 'No trusted tenant'}) == []


def test_additive_migration_round_trip_and_missing_storage_fails_closed(engine, data):
    models.NavigationPolicy.__table__.drop(engine)
    with data.factory() as db:
        with pytest.raises(HTTPException) as error:
            service.document(db, data.owner)
        assert error.value.status_code == 503
    migration = import_module('backend.alembic.versions.ffd3a4b5c6d7_navigation_policies')
    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
    assert 'navigation_policies' in inspect(engine).get_table_names()
    with data.factory() as db:
        assert db.get(models.Task, data.task.id)
        assert service.document(db, data.owner)['revision'] == 0
    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
    assert 'tasks' in inspect(engine).get_table_names()


def test_legacy_global_data_and_retention_fail_closed_in_multitenant_settings(client, data, monkeypatch):
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    def forbidden(*args, **kwargs):
        raise AssertionError('An unsafe global operation or outbound email was entered')
    monkeypatch.setattr(data_admin, 'session_scope', forbidden)
    monkeypatch.setattr(data_admin, 'send_notification_email', forbidden)
    monkeypatch.setattr(logs, '_get_or_create_retention_config', forbidden)
    operations = [('GET', '/admin/data/export?scope=users', None),
        ('POST', '/admin/data/import', {}), ('POST', '/admin/data/reset/request', {}),
        ('POST', '/admin/data/reset/confirm', {'otp': '123456'}),
        ('GET', '/logs/retention', None), ('PATCH', '/logs/retention', {'retention_days': 30}),
        ('POST', '/logs/retention/apply', {})]
    for prefix in ('', '/api'):
        for method, route, value in operations:
            response = client.request(method, prefix + route, json=value, headers=headers(data.owner))
            assert response.status_code == 403, (route, response.text)
            assert 'not-a-login-password' not in response.text
    with data.factory() as db:
        assert db.get(models.Task, data.task.id)
        assert db.get(models.User, data.outsider.id)
        assert db.get(models.OwnerResetToken, data.owner.id) is None


def test_single_tenant_export_and_import_retain_staff_permission_and_bound_tenant(client, data, monkeypatch):
    from contextlib import contextmanager
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    with data.factory() as db:
        db.delete(db.get(models.User, data.outsider.id)); db.commit()
        backup = data_admin._serialize_users([db.get(models.User, data.owner.id)])[0].model_dump(mode='json')
    response = client.get('/api/admin/data/export?scope=users', headers=headers(data.owner))
    assert response.status_code == 200, response.text
    assert len(response.json()['users']) == 1
    @contextmanager
    def isolated_session():
        with data.factory() as db:
            yield db
            db.commit()
    monkeypatch.setattr(data_admin, 'session_scope', isolated_session)
    backup.update(id=str(uuid4()), email=f'{uuid4()}@example.com', employer_id=str(data.outsider.tenant_id), role='user')
    imported = client.post('/api/admin/data/import', json={'scope': 'users', 'users': [backup]}, headers=headers(data.owner))
    assert imported.status_code == 202, imported.text
    with data.factory() as db:
        assert db.get(models.User, backup['id']).tenant_id == data.owner.tenant_id


def test_legacy_global_guard_detects_foreign_configuration_without_members(client, data, monkeypatch):
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    from datetime import datetime, timezone
    with data.factory() as db:
        db.delete(db.get(models.User, data.outsider.id))
        db.add(models.NavigationPolicy(tenant_id=str(data.outsider.tenant_id), rules={}, revision=1,
            updated_by=data.owner.id, updated_at=datetime.now(timezone.utc)))
        db.commit()
    assert client.get('/api/admin/data/export?scope=users', headers=headers(data.owner)).status_code == 403


def test_general_audit_exports_retries_and_reward_logs_cannot_cross_tenants(client, data):
    action = 'review.tenant.audit'
    with data.factory() as db:
        own = models.AuditLog(actor_id=data.owner.id, action=action, category=models.AuditLogCategoryEnum.AUTOMATION)
        other = models.AuditLog(actor_id=data.outsider.id, target_user_id=data.owner.id, action=action, category=models.AuditLogCategoryEnum.AUTOMATION)
        unknown = models.AuditLog(action=action, category=models.AuditLogCategoryEnum.AUTOMATION)
        attributed = models.AuditLog(action=action, category=models.AuditLogCategoryEnum.AUTOMATION,
            metadata_payload={'tenant_id': str(data.owner.tenant_id)})
        foreign = models.AuditLog(action=action, category=models.AuditLogCategoryEnum.AUTOMATION,
            metadata_payload={'tenant_id': str(data.outsider.tenant_id)})
        own_reward = models.RewardLog(actor_id=data.owner.id, subject_type='reward', subject_id=str(uuid4()), action=models.RewardLogActionEnum.CLAIMED)
        other_reward = models.RewardLog(actor_id=data.outsider.id, subject_type='reward', subject_id=str(uuid4()), action=models.RewardLogActionEnum.CLAIMED)
        db.add_all([own, other, unknown, attributed, foreign, own_reward, other_reward]); db.commit()
        expected = {own.id, attributed.id}
        other_id, own_id, reward_id = other.id, own.id, own_reward.id
    listing = client.get('/api/logs/audit?action=' + action, headers=headers(data.owner))
    assert listing.status_code == 200, listing.text
    assert {row['id'] for row in listing.json()['items']} == expected
    exported = client.get('/api/logs/audit/export?format=json&action=' + action, headers=headers(data.owner))
    assert exported.status_code == 200
    assert {row['id'] for row in exported.json()} == expected
    assert client.post('/api/logs/audit/' + other_id + '/retry', headers=headers(data.owner)).status_code == 404
    assert client.post('/api/logs/audit/' + own_id + '/retry', headers=headers(data.owner)).status_code == 200
    reward_rows = client.get('/api/logs', headers=headers(data.owner))
    assert reward_rows.status_code == 200, reward_rows.text
    assert [row['id'] for row in reward_rows.json()['items']] == [reward_id]
