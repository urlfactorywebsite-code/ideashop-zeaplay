"""Adversarial regressions, exclusively on disposable SQLite/PostgreSQL fixtures."""
import asyncio
import threading
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from starlette.requests import Request

from backend.app.config import Settings, get_settings
from backend.app.oauth_models import OAuthGrant, OAuthToken, epoch
from backend.app.oauth_schemas import valid_redirect
from backend.app.routers.oauth_management import protocol
from backend.app.services import browser_session, oauth
from backend.tests.test_oauth2_server import (  # noqa: F401
    PUBLIC,
    api,
    authorize,
    bearer,
    data,
    engine,
    exchange,
    headers,
    issued,
    register,
)


@pytest.mark.parametrize('callback', [
    'https://client.example.com/cb?code=', 'https://client.example.com/cb?%73tate=',
    'https://client.example.com/cb?iss', 'https://client.example.com:bad/cb',
    'https://client.example.com:0/cb', 'https://client.example.com\\evil/cb',
    'https://client.example.com/cb#', 'https://client.example.com/cb?error_description=',
])
def test_ambiguous_registered_callbacks_are_rejected(callback):
    with pytest.raises(ValueError):
        valid_redirect(callback)


def test_prepared_consent_cannot_survive_client_edit(api, data):
    client = register(api, data)['client']
    _, _, params = authorize(api, data, client, allow=False)
    prepared = api.post('/api/oauth2/consent/prepare', json=params, headers=headers(data.owner)).json()
    changed = api.patch('/api/oauth2/clients/' + client['id'], json={**PUBLIC, 'name': 'Changed identity'}, headers=headers(data.owner))
    assert changed.status_code == 200
    response = api.post('/api/oauth2/consent', json={'ticket': prepared['ticket'], 'allow': True}, headers=headers(data.owner))
    assert response.status_code == 400


def test_expires_in_matches_remaining_absolute_grant_lifetime(api, data):
    client, token = issued(api, data)
    with data.factory() as db:
        access = db.scalar(select(OAuthToken).where(OAuthToken.verifier == oauth.digest(token['access_token'])))
        db.get(OAuthGrant, access.grant_id).expires_at = epoch() + 8
        db.commit()
    refreshed = api.post('/api/oauth2/token', data=dict(grant_type='refresh_token', client_id=client['client_id'], refresh_token=token['refresh_token']))
    assert refreshed.status_code == 200
    assert 0 < refreshed.json()['expires_in'] <= 8


def test_metadata_reports_effective_grant_revocation(api, data):
    issued(api, data)
    grant = next(g for g in api.get('/api/oauth2/my-grants', headers=headers(data.owner)).json() if g['active'])
    api.post('/api/oauth2/grants/' + grant['id'] + '/revoke', headers=headers(data.owner))
    records = api.get('/api/oauth2/tokens', headers=headers(data.owner)).json()
    assert records and all(row['revoked_at'] and not row['active'] for row in records)


def test_production_rejects_cleartext_oauth_transport(api, monkeypatch):
    monkeypatch.setattr(get_settings(), 'environment', 'production')
    result = api.post('/api/oauth2/token', data={'grant_type': 'client_credentials'})
    assert result.status_code == 400 and result.json().get('error') == 'invalid_request'
    assert 'https' in result.json().get('error_description', '').lower()


def test_origin_cannot_be_trusted_from_host_header():
    request = Request({'type': 'http', 'scheme': 'https', 'method': 'POST', 'path': '/',
        'headers': [(b'host', b'attacker.example.com'), (b'origin', b'https://attacker.example.com'), (b'x-zea-browser', b'1')]})
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        browser_session.check_origin(request)
    assert error.value.status_code == 403


def test_production_rejects_default_signing_keys():
    with pytest.raises(ValueError, match='JWT'):
        Settings(environment='production', _env_file=None)


def test_protocol_database_and_crypto_work_does_not_block_event_loop(monkeypatch):
    monkeypatch.setattr(get_settings(), 'oauth_issuer', 'https://api.example.test/api/oauth2')
    observed = []
    engine = SimpleNamespace(create_token_response=lambda *a, **kw: (observed.append(threading.get_ident()) or ({}, '{}', 200)),
        create_revocation_response=None, create_introspect_response=None)
    monkeypatch.setattr(oauth, 'server', lambda db: engine)
    monkeypatch.setattr(oauth, 'configured', lambda: None)
    monkeypatch.setattr(oauth, 'rate_limit', lambda *a: None)
    body = b'grant_type=client_credentials'
    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}
    async def run():
        thread = threading.get_ident()
        request = Request({'type': 'http', 'scheme': 'https', 'method': 'POST', 'path': '/',
            'query_string': b'', 'headers': [(b'content-type', b'application/x-www-form-urlencoded')]}, receive)
        await protocol('token', request, SimpleNamespace(commit=lambda: None))
        assert observed[0] != thread
    asyncio.run(run())


def test_cleanup_is_bounded_and_preserves_replay_evidence_for_live_grants(api, data):
    from backend.app.oauth_models import BrowserSession, OAuthCode
    from backend.app.services.oauth_cleanup import cleanup
    issued(api, data)
    with data.factory() as db:
        live_count = db.scalar(select(func.count()).select_from(OAuthToken))
        # Expired child verifiers remain necessary while the grant family is live.
        for row in db.scalars(select(OAuthCode)):
            row.expires_at = epoch() - 10 * 86400
        refresh = db.scalar(select(OAuthToken).where(OAuthToken.kind == 'refresh'))
        refresh.expires_at = epoch() - 10 * 86400
        db.add(BrowserSession(verifier=oauth.digest('synthetic-old-session'), user_id=data.owner.id,
            tenant_id=data.owner.tenant_id, credentials_version=0, expires_at=epoch() - 10 * 86400))
        db.commit()
        dry = cleanup(db)
        assert dry['tokens'] == 0 and dry['browser_sessions'] == 1
        assert db.get(BrowserSession, oauth.digest('synthetic-old-session'))
        result = cleanup(db, apply=True, batch_size=1)
        db.commit()
        assert result['tokens'] == 0 and result['browser_sessions'] == 1
        assert db.scalar(select(func.count()).select_from(OAuthToken)) == live_count
        grant = db.scalar(select(OAuthGrant))
        grant.revoked_at = epoch() - 10 * 86400
        db.commit()
        first = cleanup(db, apply=True, batch_size=1)
        db.commit()
        assert first['tokens'] == 1 and first['grants'] == 0
        second = cleanup(db, apply=True, batch_size=1)
        db.commit()
        assert second['tokens'] == 1 and second['grants'] == 1
        assert db.scalar(select(func.count()).select_from(OAuthToken)) == 0


def test_additive_index_migration_and_legacy_refinement(engine, monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect

    from backend.app.services.oauth_install import install, migration
    refinement = migration('ffc2f3a4b5c6_oauth_cleanup_indexes.py')
    monkeypatch.setattr(get_settings(), 'bootstrap_schema', False)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            refinement.downgrade()
        if conn.dialect.name == 'postgresql':
            assert install(conn)['status'] == 'refinement_required'
            assert install(conn, apply=True)['status'] == 'refined'
            assert install(conn)['status'] == 'already_compatible'
        else:
            with Operations.context(MigrationContext.configure(conn)):
                refinement.upgrade()
        for name, (table, columns) in refinement.INDEXES.items():
            actual = {index['name']: index['column_names'] for index in inspect(conn).get_indexes(table)}
            assert actual[name] == columns


def test_public_client_rejects_conflicting_authorization_header(api, data):
    client = register(api, data)['client']
    parsed, _, _ = authorize(api, data, client)
    from backend.tests.test_oauth2_server import CALLBACK, VERIFIER
    result = api.post('/api/oauth2/token', data=dict(grant_type='authorization_code', client_id=client['client_id'],
        code=parsed['code'][0], redirect_uri=CALLBACK, code_verifier=VERIFIER), headers={'Authorization': 'Bearer synthetic-invalid'})
    assert result.status_code == 401


def test_rejected_urls_logs_and_jsonp_never_expose_tokens(api, data):
    import logging

    from backend.app.oauth_logging import RedactQuery
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0, '%s - %s %s HTTP/%s %s',
        ('peer', 'POST', '/api/oauth2/token?client_secret=synthetic-secret', '1.1', 400), None)
    RedactQuery().filter(record)
    assert 'synthetic-secret' not in record.getMessage() and '?' not in record.getMessage()
    assert api.post('/api/oauth2/token?client_secret=synthetic-secret', data={'grant_type': 'password'}).json()['error'] == 'invalid_request'
    assert api.post('/api/oauth2/token', data={'client_id': 'unknown'}).json()['error'] == 'invalid_request'
    assert 'alert' not in api.post('/api/oauth2/revoke', data={'token': 'unknown', 'callback': 'alert'}).text


def test_patched_pkce_library_uses_constant_time_comparison():
    import inspect

    import oauthlib
    from oauthlib.oauth2.rfc6749.grant_types.authorization_code import (
        code_challenge_method_s256,
    )
    assert oauthlib.__version__ == '4.0.0'
    assert 'compare_digest' in inspect.getsource(code_challenge_method_s256)


def test_dashboard_aggregates_without_loading_grant_history(api, data):
    client, _ = issued(api, data)
    with data.factory() as db:
        db.add_all([OAuthGrant(client_id=client['id'], tenant_id=data.owner.tenant_id, user_id=data.owner.id,
            credentials_version=0, scopes=['profile:read'], expires_at=epoch() + 600) for _ in range(550)])
        db.commit()
    from sqlalchemy import event
    selects = []
    def statement(conn, cursor, sql, params, context, many):
        if sql.lstrip().upper().startswith('SELECT'):
            selects.append(sql)
    event.listen(data.factory.kw['bind'], 'before_cursor_execute', statement)
    try:
        response = api.get('/api/oauth2/dashboard', headers=headers(data.owner))
    finally:
        event.remove(data.factory.kw['bind'], 'before_cursor_execute', statement)
    assert response.status_code == 200 and response.json()['active_grants'] == 551
    assert len(selects) < 15


def test_production_requires_explicit_https_origins():
    with pytest.raises(ValueError, match='CORS'):
        Settings(environment='production', jwt_secret_key='a' * 48, jwt_refresh_secret_key='b' * 48,
                 cors_allow_origins=['*'], _env_file=None)
    Settings(environment='production', jwt_secret_key='a' * 48, jwt_refresh_secret_key='b' * 48,
             cors_allow_origins=['https://app.example.com'], _env_file=None)


def test_validation_responses_do_not_echo_credentials(api, data):
    response = api.post('/api/oauth2/clients', json={**PUBLIC, 'client_secret': 'synthetic-private-value'}, headers=headers(data.owner))
    assert response.status_code == 422 and 'synthetic-private-value' not in response.text
    assert all('input' not in item for item in response.json()['detail']) and response.headers['cache-control'] == 'no-store'


def test_service_accepts_case_insensitive_bearer_scheme(api, data):
    created = register(api, data, client_type='confidential', grant_types=['client_credentials'], scopes=['service:read'], redirect_uris=[])
    token = api.post('/api/oauth2/token', data={'grant_type': 'client_credentials', 'scope': 'service:read'},
        auth=(created['client']['client_id'], created['client_secret'])).json()['access_token']
    assert api.get('/api/oauth2/service', headers={'Authorization': 'bEaReR ' + token}).status_code == 200


def test_public_browser_can_read_scoped_resources_without_cookie_cors(api, data):
    _, token = issued(api, data)
    origin = 'https://third-party.example.com'
    for path in ['/api/oauth2/profile', '/api/tasks', '/api/projects']:
        preflight = api.options(path, headers={'Origin': origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'})
        assert preflight.status_code == 200 and preflight.headers['access-control-allow-origin'] == '*'
        assert 'access-control-allow-credentials' not in preflight.headers
        response = api.get(path, headers={**bearer(token['access_token']), 'Origin': origin})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == '*' and 'access-control-allow-credentials' not in response.headers
    assert api.get('/api/oauth2/profile', headers={'Origin': origin}).status_code == 401
    assert api.options('/api/tasks', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization'}).status_code == 400


def test_rotation_invalidates_machine_secret_and_all_existing_grants(api, data):
    assert api.post('/api/oauth2/clients', headers=headers(data.owner), json={**PUBLIC, 'grant_types': ['client_credentials'], 'scopes': ['service:read']}).status_code == 422
    created = register(api, data, client_type='confidential', grant_types=['client_credentials'], scopes=['service:read'], redirect_uris=[])
    credentials = (created['client']['client_id'], created['client_secret'])
    payload = {'grant_type': 'client_credentials', 'scope': 'service:read'}
    old = api.post('/api/oauth2/token', data=payload, auth=credentials).json()['access_token']
    rotated = api.post('/api/oauth2/clients/' + created['client']['id'] + '/rotate', headers=headers(data.owner)).json()
    assert api.get('/api/oauth2/service', headers=bearer(old)).status_code == 401
    assert api.post('/api/oauth2/token', data=payload, auth=credentials).status_code == 401
    assert api.post('/api/oauth2/token', data=payload, auth=(credentials[0], rotated['client_secret'])).status_code == 200
