"""OAuth behavior against disposable databases; never use live users or sessions."""
import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from backend.app import models
from backend.app.auth import create_access_token, hash_password
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.oauth_cors import build_cors_stack
from backend.app.oauth_models import (
    OAuthClient,
    OAuthCode,
    OAuthToken,
    epoch,
)
from backend.app.routers.auth import router as auth
from backend.app.routers.config import router as config
from backend.app.routers.oauth_management import router
from backend.app.routers.projects import router as projects
from backend.app.routers.tasks import router as tasks
from backend.app.services import audit_logger, oauth
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401

VERIFIER = 'v' * 64
CALLBACK = 'https://client.example.test/callback'
PUBLIC = dict(name='Controlled client', client_type='public', redirect_uris=[CALLBACK],
    grant_types=['authorization_code', 'refresh_token'], scopes=['profile:read', 'projects:read', 'tasks:read', 'offline_access'])


def headers(user):
    return {'Authorization': 'Bearer ' + create_access_token(user.id, extra_claims={
        'tenant_id': str(user.tenant_id), 'credentials_version': user.credentials_version})}


@pytest.fixture
def api(data, monkeypatch):
    with data.factory() as db:
        for identity in (data.owner, data.outsider):
            db.get(models.User, identity.id).email = identity.id + '@example.com'
        db.commit()
    monkeypatch.setattr(get_settings(), 'oauth_issuer', 'https://api.example.test/api/oauth2')
    monkeypatch.setattr(get_settings(), 'oauth_ui_url', 'https://app.example.test/#/oauth/authorize')
    monkeypatch.setattr(audit_logger, 'log_event', lambda *a, **kw: None)
    app = FastAPI()
    for route in [router, projects, tasks, auth, config]:
        app.include_router(route, prefix='/api')
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(build_cors_stack(app, get_settings())) as client:
        yield client


def register(api, data, **changes):
    response = api.post('/api/oauth2/clients', json={**PUBLIC, **changes}, headers=headers(data.owner))
    assert response.status_code == 201, response.text
    return response.json()


def authorize(api, data, client, allow=True, **changes):
    query = dict(client_id=client['client_id'], redirect_uri=CALLBACK, response_type='code',
        scope='profile:read projects:read tasks:read offline_access', state='s' * 32,
        code_challenge=base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('='), code_challenge_method='S256')
    query.update(changes)
    response = api.post('/api/oauth2/consent/prepare', json=query, headers=headers(data.owner))
    assert response.status_code == 200, response.text
    ticket = response.json()['ticket']
    response = api.post('/api/oauth2/consent', json={'ticket': ticket, 'allow': allow}, headers=headers(data.owner))
    assert response.status_code == 200, response.text
    redirect = response.json()['redirect_to']
    parsed = parse_qs(urlsplit(redirect).query)
    assert parsed['state'] == ['s' * 32]
    assert parsed['iss'] == [get_settings().oauth_issuer]
    return parsed, ticket, query


def exchange(api, client, code, **changes):
    params = dict(grant_type='authorization_code', client_id=client['client_id'], code=code,
        redirect_uri=CALLBACK, code_verifier=VERIFIER)
    params.update(changes)
    return api.post('/api/oauth2/token', data=params)


def issued(api, data):
    client = register(api, data)['client']
    parsed, _, _ = authorize(api, data, client)
    response = exchange(api, client, parsed['code'][0])
    assert response.status_code == 200, response.text
    return client, response.json()


def bearer(token):
    return {'Authorization': 'Bearer ' + token}


def test_client_lifecycle_tenant_boundary_and_no_secret_reads(api, data):
    created = register(api, data, client_type='confidential')
    secret, client = created['client_secret'], created['client']
    assert secret and 'secret_hash' not in client
    with data.factory() as db:
        row = db.get(OAuthClient, client['id'])
        assert row.secret_hash != secret and oauth.verify_password(secret, row.secret_hash)
    for path in ['/clients', '/clients/' + client['id'], '/dashboard', '/events']:
        response = api.get('/api/oauth2' + path, headers=headers(data.owner))
        assert response.status_code == 200
        assert secret not in response.text and 'secret_hash' not in response.text
        assert response.headers['cache-control'] == 'no-store'
    assert api.get('/api/oauth2/clients', headers=headers(data.outsider)).json() == []
    assert api.post('/api/oauth2/clients/' + client['id'] + '/rotate', headers=headers(data.outsider)).status_code == 404
    rotated = api.post('/api/oauth2/clients/' + client['id'] + '/rotate', headers=headers(data.owner))
    assert rotated.status_code == 200 and rotated.json()['client_secret'] != secret
    changed = api.patch('/api/oauth2/clients/' + client['id'], json={**PUBLIC, 'client_type': 'confidential', 'name': 'Edited'}, headers=headers(data.owner))
    assert changed.status_code == 200
    assert api.post('/api/oauth2/clients/' + client['id'] + '/revoke', headers=headers(data.owner)).status_code == 200
    assert api.delete('/api/oauth2/clients/' + client['id'], headers=headers(data.owner)).status_code == 204


def test_pkce_flow_refresh_reuse_revokes_family_and_no_plaintext(api, data):
    client, token = issued(api, data)
    assert api.get('/api/oauth2/profile', headers=bearer(token['access_token'])).status_code == 200
    assert api.get('/api/projects', headers=bearer(token['access_token'])).status_code == 200
    assert api.get('/api/tasks/' + data.task.id, headers=bearer(token['access_token'])).status_code == 200
    with data.factory() as db:
        for row in db.scalars(select(OAuthToken)):
            assert row.verifier not in token.values() and len(row.verifier) == 64
    refresh = dict(grant_type='refresh_token', client_id=client['client_id'], refresh_token=token['refresh_token'])
    response = api.post('/api/oauth2/token', data=refresh)
    assert response.status_code == 200, response.text
    successor = response.json()
    assert successor['refresh_token'] != token['refresh_token']
    assert api.post('/api/oauth2/token', data=refresh).json()['error'] == 'invalid_grant'
    assert api.get('/api/oauth2/profile', headers=bearer(successor['access_token'])).status_code == 401
    assert api.post('/api/oauth2/token', data={**refresh, 'refresh_token': successor['refresh_token']}).status_code == 400


@pytest.mark.parametrize('change', [dict(code_verifier='x' * 64), dict(redirect_uri='https://evil.example/cb'), dict(client_id='invalid')])
def test_invalid_exchange(api, data, change):
    client = register(api, data)['client']
    parsed, _, _ = authorize(api, data, client)
    assert exchange(api, client, parsed['code'][0], **change).status_code in {400, 401}


def test_code_replay_expiration_consent_one_use_and_denial(api, data):
    client = register(api, data)['client']
    parsed, ticket, _ = authorize(api, data, client)
    assert api.post('/api/oauth2/consent', json={'ticket': ticket, 'allow': True}, headers=headers(data.owner)).status_code == 400
    first = exchange(api, client, parsed['code'][0])
    assert first.status_code == 200
    assert exchange(api, client, parsed['code'][0]).status_code == 400
    assert api.get('/api/oauth2/profile', headers=bearer(first.json()['access_token'])).status_code == 401
    parsed, _, _ = authorize(api, data, client)
    with data.factory() as db:
        db.get(OAuthCode, oauth.digest(parsed['code'][0])).expires_at = epoch() - 1
        db.commit()
    assert exchange(api, client, parsed['code'][0]).status_code == 400
    denied, _, _ = authorize(api, data, client, allow=False)
    assert denied['error'] == ['access_denied'] and 'code' not in denied


@pytest.mark.parametrize('change', [dict(redirect_uri='https://evil.example/cb'), dict(scope='admin:write'),
    dict(code_challenge_method='plain'), dict(code_challenge='short'), dict(state='')])
def test_bad_authorization_never_redirects(api, data, change):
    client = register(api, data)['client']
    _, _, params = authorize(api, data, client, allow=False)
    response = api.get('/api/oauth2/authorize', params={**params, **change}, follow_redirects=False)
    if change == {'scope': 'admin:write'}:
        assert response.status_code == 303
        redirect = urlsplit(response.headers['location'])
        assert redirect.scheme + '://' + redirect.netloc + redirect.path == CALLBACK
        assert parse_qs(redirect.query)['error'] == ['invalid_scope']
        assert parse_qs(redirect.query)['state'] == ['s' * 32]
    else:
        assert response.status_code in {400, 422} and 'location' not in response.headers
    response = api.post('/api/oauth2/consent/prepare', json={**params, **change}, headers=headers(data.owner))
    assert response.status_code in {400, 422}


def test_machine_client_introspection_and_revocation(api, data):
    created = register(api, data, client_type='confidential', grant_types=['client_credentials'], scopes=['service:read'], redirect_uris=[])
    client, secret = created['client'], created['client_secret']
    params = dict(grant_type='client_credentials', scope='service:read')
    response = api.post('/api/oauth2/token', data=params, auth=(client['client_id'], secret))
    assert response.status_code == 200, response.text
    token = response.json()
    assert 'refresh_token' not in token
    assert api.get('/api/oauth2/service', headers=bearer(token['access_token'])).status_code == 200
    assert api.get('/api/tasks', headers=bearer(token['access_token'])).status_code == 403
    assert api.post('/api/oauth2/introspect', data={'token': token['access_token']}).status_code == 401
    response = api.post('/api/oauth2/introspect', data={'token': token['access_token']}, auth=(client['client_id'], secret))
    assert response.status_code == 200 and response.json()['active'] is True, response.text
    assert response.json()['aud'] == 'zeaplay-api'
    assert api.post('/api/oauth2/revoke', data={'token': token['access_token']}, auth=(client['client_id'], secret)).status_code == 200
    assert api.get('/api/oauth2/service', headers=bearer(token['access_token'])).status_code == 401
    assert api.post('/api/oauth2/revoke', data={'token': 'unknown'}, auth=(client['client_id'], secret)).status_code == 200


@pytest.mark.parametrize('field,value', [('issuer', 'incorrect'), ('audience', 'incorrect'), ('expires_at', 1), ('revoked_at', 1)])
def test_token_validation(api, data, field, value):
    _, token = issued(api, data)
    with data.factory() as db:
        record = db.scalar(select(OAuthToken).where(OAuthToken.verifier == oauth.digest(token['access_token'])))
        setattr(record, field, value)
        db.commit()
    assert api.get('/api/oauth2/profile', headers=bearer(token['access_token'])).status_code == 401


def test_scope_and_management_escalation_denied(api, data):
    client = register(api, data)['client']
    parsed, _, _ = authorize(api, data, client, scope='profile:read')
    token = exchange(api, client, parsed['code'][0]).json()
    assert 'refresh_token' not in token
    for path in ['/api/projects', '/api/oauth2/clients', '/api/oauth2/my-grants', '/api/auth/me', '/api/config/smtp/multiple']:
        assert api.get(path, headers=bearer(token['access_token'])).status_code == 403
    assert api.post('/api/auth/generate-token', json={'scopes': ['admin:write']}, headers=bearer(token['access_token'])).status_code == 403
    assert api.patch('/api/tasks/' + data.task.id, json={'title': 'Escalation'}, headers=bearer(token['access_token'])).status_code == 403
    assert api.post('/api/oauth2/clients', json=PUBLIC).status_code == 401


def test_disable_reenable_rotation_and_user_revocation(api, data):
    client, token = issued(api, data)
    api.post('/api/oauth2/clients/' + client['id'] + '/revoke', headers=headers(data.owner))
    assert api.get('/api/oauth2/profile', headers=bearer(token['access_token'])).status_code == 401
    assert api.post('/api/oauth2/token', data=dict(grant_type='refresh_token', client_id=client['client_id'], refresh_token=token['refresh_token'])).status_code in {400, 401}
    assert api.patch('/api/oauth2/clients/' + client['id'], json=PUBLIC, headers=headers(data.owner)).status_code == 200
    parsed, _, _ = authorize(api, data, client)
    token = exchange(api, client, parsed['code'][0]).json()
    grant = next(g for g in api.get('/api/oauth2/my-grants', headers=headers(data.owner)).json() if g['active'])
    assert api.post('/api/oauth2/grants/' + grant['id'] + '/revoke', headers=headers(data.outsider)).status_code == 404
    assert api.post('/api/oauth2/grants/' + grant['id'] + '/revoke', headers=headers(data.owner)).status_code == 200
    assert api.get('/api/oauth2/profile', headers=bearer(token['access_token'])).status_code == 401


def test_current_user_changes_and_cross_tenant_consent(api, data):
    client, token = issued(api, data)
    _, _, params = authorize(api, data, client, allow=False)
    assert api.post('/api/oauth2/consent/prepare', json=params, headers=headers(data.outsider)).status_code == 400
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        user.credentials_version += 1
        db.commit()
    assert api.get('/api/oauth2/profile', headers=bearer(token['access_token'])).status_code == 401


def test_concurrent_refresh_does_not_create_two_successors(api, data):
    client, token = issued(api, data)
    params = dict(grant_type='refresh_token', client_id=client['client_id'], refresh_token=token['refresh_token'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: api.post('/api/oauth2/token', data=params), range(2)))
    assert sorted(r.status_code for r in results) == [200, 400]
    successor = next(r.json() for r in results if r.status_code == 200)
    assert api.get('/api/oauth2/profile', headers=bearer(successor['access_token'])).status_code == 401


def test_legacy_credentials_are_not_served_and_password_grant_retired(api, data):
    assert api.get('/api/config/oauth', headers=headers(data.owner)).status_code == 410
    assert api.post('/api/oauth2/token', data=dict(grant_type='password', username='synthetic', password='synthetic')).json()['error'] == 'unsupported_grant_type'
    assert api.get('/api/auth/me', headers=headers(data.owner)).status_code == 200


def test_migration_roundtrip_and_indexes(engine):
    migration = import_module('backend.alembic.versions.ffb1e2f3a4b5_oauth_management')
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
            migration.upgrade()
        assert {'oauth_clients', 'oauth_grants', 'oauth_tokens', 'oauth_consents', 'oauth_events', 'oauth_codes', 'oauth_rate_limits'} <= set(inspect(conn).get_table_names())
        assert inspect(conn).get_foreign_keys('oauth_tokens')
        assert inspect(conn).get_indexes('oauth_tokens')


def test_guarded_legacy_installer(engine, monkeypatch):
    from backend.app.services.oauth_install import install
    monkeypatch.setattr(get_settings(), 'bootstrap_schema', False)
    with engine.begin() as conn:
        if conn.dialect.name == 'sqlite':
            with pytest.raises(RuntimeError, match='PostgreSQL only'):
                install(conn, True)
            return
        migration = import_module('backend.alembic.versions.ffb1e2f3a4b5_oauth_management')
        assert install(conn)['status'] == 'already_compatible'
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
        assert install(conn)['status'] == 'ready_to_install'
        assert install(conn, True)['status'] == 'installed'
        assert install(conn)['status'] == 'already_compatible'
        conn.execute(__import__('sqlalchemy').text('CREATE TABLE alembic_version (version_num varchar(32))'))
        with pytest.raises(RuntimeError, match='Versioned database'):
            install(conn, True)


def test_browser_cookie_restores_existing_login_and_logout_revokes(api, data, monkeypatch):
    monkeypatch.setattr(get_settings(), 'environment', 'production')
    api.base_url = 'https://testserver'
    monkeypatch.setattr(get_settings(), 'cors_allow_origins', ['https://app.example.test'])
    request_headers = {'Origin': 'https://app.example.test', 'X-Zea-Browser': '1'}
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        user.hashed_password = hash_password('Synthetic-browser-password!')
        email = user.email
        db.commit()
    assert api.post('/api/auth/browser-session/refresh', headers={'Origin': 'https://evil.example.test', 'X-Zea-Browser': '1'}).status_code == 403
    response = api.post('/api/auth/login', json={'email': email, 'password': 'Synthetic-browser-password!'}, headers=request_headers)
    assert response.status_code == 200, response.text
    assert all(flag in response.headers['set-cookie'] for flag in ['HttpOnly', 'SameSite=lax', 'Secure'])
    assert 'Path=/' in response.headers['set-cookie']
    assert api.post('/api/auth/browser-session/refresh', headers={'Origin': 'https://app.example.test'}).status_code == 403
    response = api.post('/api/auth/browser-session/refresh', headers=request_headers)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert api.get('/api/auth/me', headers=bearer(response.json()['access_token'])).status_code == 200
    assert api.post('/api/auth/browser-session/logout', headers=request_headers).status_code == 204
    assert api.post('/api/auth/browser-session/refresh', headers=request_headers).status_code == 401


def test_basic_role_permissions_and_tenant_resource_checks(api, data):
    client = register(api, data)['client']
    with data.factory() as db:
        other = models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name='Limited user', email=str(uuid4()) + '@example.com',
            hashed_password='not-a-login', role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
        db.add(other)
        db.commit()
        db.refresh(other)
        db.expunge(other)
    assert api.post('/api/oauth2/clients', headers=headers(other), json=PUBLIC).status_code == 403
    assert api.post('/api/oauth2/clients/' + client['id'] + '/rotate', headers=headers(other)).status_code == 403
    _, _, params = authorize(api, data, client, allow=False)
    response = api.post('/api/oauth2/consent/prepare', json=params, headers=headers(other))
    assert response.status_code == 200
    result = api.post('/api/oauth2/consent', json={'ticket': response.json()['ticket'], 'allow': True}, headers=headers(other))
    code = parse_qs(urlsplit(result.json()['redirect_to']).query)['code'][0]
    token = exchange(api, client, code).json()['access_token']
    assert api.get('/api/tasks/' + data.task.id, headers=bearer(token)).status_code in {403, 404}
    assert api.get('/api/oauth2/profile', headers=bearer(token)).json()['id'] == other.id
    assert api.get('/api/oauth2/grants', headers=bearer(token)).status_code == 403


def test_no_unauthorized_introspection_or_secret_auth_and_rate_limit(api, data):
    registered = register(api, data, client_type='confidential', grant_types=['client_credentials'], scopes=['service:read'], redirect_uris=[])
    client, secret = registered['client'], registered['client_secret']
    params = {'grant_type': 'client_credentials', 'scope': 'service:read'}
    assert api.post('/api/oauth2/token', data=params, auth=(client['client_id'], 'incorrect')).status_code == 401
    token = api.post('/api/oauth2/token', data=params, auth=(client['client_id'], secret)).json()['access_token']
    other = register(api, data, client_type='confidential', grant_types=['client_credentials'], scopes=['service:read'], redirect_uris=[])
    response = api.post('/api/oauth2/introspect', data={'token': token}, auth=(other['client']['client_id'], other['client_secret']))
    assert response.json() == {'active': False}
    assert api.post('/api/oauth2/token', data={**params, 'scope': 'tasks:read'}, auth=(client['client_id'], secret)).status_code == 400
    from backend.app.oauth_models import OAuthRateLimit
    with data.factory() as db:
        for row in db.scalars(select(OAuthRateLimit)):
            row.count = 120
        db.commit()
    response = api.post('/api/oauth2/token', data=params, auth=(client['client_id'], secret))
    assert response.status_code == 429 and response.headers['retry-after'] == '60'


def test_public_browser_cors_does_not_enable_cookie_management_access(api, data):
    request = {'Origin': 'https://third-party.example.com', 'Access-Control-Request-Method': 'POST',
               'Access-Control-Request-Headers': 'content-type'}
    response = api.options('/api/oauth2/token', headers=request)
    assert response.status_code == 200 and response.headers['access-control-allow-origin'] == '*'
    assert 'access-control-allow-credentials' not in response.headers
    assert api.options('/api/oauth2/clients', headers=request).status_code == 400
    response = api.post('/api/oauth2/token', data={'grant_type': 'password'}, headers={'Origin': request['Origin']})
    assert response.headers['access-control-allow-origin'] == '*'
    assert 'access-control-allow-credentials' not in response.headers
