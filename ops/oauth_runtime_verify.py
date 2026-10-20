"""Read-only local runtime probes. Credentials never leave this process or its output."""
import json

import httpx
from sqlalchemy import select

from app.auth import create_access_token
from app.database import SessionLocal
from app.models import RoleEnum, User, UserStatusEnum
from app.tickets import models as ticket_models  # noqa: F401

with SessionLocal() as db:
    user = db.scalar(select(User).where(User.role.in_([RoleEnum.OWNER, RoleEnum.ADMIN]), User.status == UserStatusEnum.ACTIVE))
    assert user, 'No existing active administrator for read-only probes'
    token = create_access_token(user.id, expires_minutes=5, extra_claims={
        'tenant_id': str(user.tenant_id), 'credentials_version': user.credentials_version, 'roles': [user.role.value]})
    wrong_tenant = create_access_token(user.id, expires_minutes=1, extra_claims={
        'tenant_id': '00000000-0000-4000-8000-000000000099', 'credentials_version': user.credentials_version})

results = {}
with httpx.Client(base_url='http://127.0.0.1:6311', timeout=30) as client:
    for path in ['/health', '/ready']:
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code)
        results[path] = response.status_code
    headers = {'Authorization': 'Bearer ' + token}
    for path in ['/api/auth/me', '/api/oauth2/clients', '/api/oauth2/dashboard', '/api/oauth2/grants',
                 '/api/oauth2/tokens', '/api/oauth2/events', '/api/oauth2/my-grants', '/api/oauth2/scopes',
                 '/api/config/smtp/multiple', '/api/webhooks']:
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.status_code)
        assert response.headers.get('cache-control') == 'no-store'
        if '/oauth2/' in path:
            assert all(key not in response.text for key in ['secret_hash', '"verifier"', '"access_token"', '"refresh_token"'])
        results[path] = response.status_code
    assert client.get('/api/oauth2/clients').status_code == 401
    assert client.get('/api/oauth2/clients', headers={'Authorization': 'Bearer ' + wrong_tenant}).status_code == 401
    assert client.get('/api/config/oauth', headers=headers).status_code == 410
    minted = client.post('/api/auth/generate-token', json={'scopes': ['profile:read'], 'expires_in_minutes': 5}, headers=headers)
    assert minted.status_code == 200
    assert client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + minted.json()['access_token']}).status_code == 200
    spec = client.get('/openapi.json').json()
    assert 'application/x-www-form-urlencoded' in spec['paths']['/api/oauth2/token']['post']['requestBody']['content']
    discovery = client.get('/.well-known/oauth-authorization-server/api/oauth2')
    assert discovery.status_code == 200
    assert discovery.json()['code_challenge_methods_supported'] == ['S256']
    assert client.post('/api/oauth2/token', data={'grant_type': 'password'}).json()['error'] == 'unsupported_grant_type'
results.update(anonymous_admin_denied=True, wrong_tenant_denied=True, legacy_registry_retired=True,
               bearer_builder_compatible=True, openapi_form_contract=True, discovery=True, password_grant_retired=True)
print(json.dumps(results, indent=2))
