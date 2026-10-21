from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import pytest

from backend.app.oauth_cors import build_cors_stack


TRUSTED_ORIGINS = ['http://localhost:6300', 'http://127.0.0.1:6300']
TASK_ID = 'ac9e77eb-e709-41e6-b100-88e2c48b8dab'
RESOURCE_PATHS = [
    '/api/tasks', f'/api/tasks/{TASK_ID}',
    '/api/projects', f'/api/projects/{TASK_ID}',
    '/api/oauth2/profile', '/api/oauth2/service',
    '/tasks', f'/tasks/{TASK_ID}',
    '/projects', f'/projects/{TASK_ID}',
    '/oauth2/profile', '/oauth2/service',
]


@pytest.fixture
def cors_client():
    app = FastAPI()

    @app.api_route('/{path:path}', methods=['GET', 'POST', 'PATCH'])
    async def unauthorized(path: str):
        return JSONResponse({'detail': 'Not authenticated'}, status_code=401)

    settings = SimpleNamespace(
        cors_allow_origins=TRUSTED_ORIGINS,
        cors_allow_credentials=True,
        cors_allow_methods=['*'],
        cors_allow_headers=['*'],
    )
    with TestClient(build_cors_stack(app, settings)) as client:
        yield client


@pytest.mark.parametrize('origin', TRUSTED_ORIGINS)
@pytest.mark.parametrize('path', RESOURCE_PATHS)
def test_trusted_resource_reads_support_browser_credentials(cors_client, origin, path):
    preflight = cors_client.options(path, headers={
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert preflight.status_code == 200
    response = cors_client.get(path, headers={'Origin': origin, 'Cookie': 'synthetic=session'})
    assert response.status_code == 401
    for result in (preflight, response):
        assert result.headers['Access-Control-Allow-Origin'] == origin
        assert result.headers['Access-Control-Allow-Credentials'] == 'true'
        assert 'origin' in result.headers['Vary'].lower()


@pytest.mark.parametrize('path', RESOURCE_PATHS)
def test_external_oauth_reads_keep_public_cors_without_credentials(cors_client, path):
    origin = 'https://third-party.example.test'
    preflight = cors_client.options(path, headers={
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
    })
    assert preflight.status_code == 200
    response = cors_client.get(path, headers={'Origin': origin})
    assert response.status_code == 401
    for result in (preflight, response):
        assert result.headers['Access-Control-Allow-Origin'] == '*'
        assert 'Access-Control-Allow-Credentials' not in result.headers
    assert cors_client.options(path, headers={
        'Origin': origin, 'Access-Control-Request-Method': 'POST',
    }).status_code == 400


def test_trusted_resource_mutation_preflight_uses_application_policy(cors_client):
    response = cors_client.options(f'/api/tasks/{TASK_ID}', headers={
        'Origin': TRUSTED_ORIGINS[0], 'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert response.status_code == 200
    assert response.headers['Access-Control-Allow-Origin'] == TRUSTED_ORIGINS[0]
    assert response.headers['Access-Control-Allow-Credentials'] == 'true'


@pytest.mark.parametrize('path', ['/oauth2/token', '/api/oauth2/token', '/oauth2/revoke', '/api/oauth2/revoke'])
@pytest.mark.parametrize('origin', [TRUSTED_ORIGINS[0], 'https://third-party.example.test'])
def test_protocol_token_endpoints_do_not_enable_ambient_credentials(cors_client, path, origin):
    response = cors_client.options(path, headers={
        'Origin': origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert response.status_code == 200
    assert response.headers['Access-Control-Allow-Origin'] == '*'
    assert 'Access-Control-Allow-Credentials' not in response.headers


def test_private_routes_do_not_allow_external_origins(cors_client):
    response = cors_client.options('/api/auth/me', headers={
        'Origin': 'https://third-party.example.test', 'Access-Control-Request-Method': 'GET',
    })
    assert response.status_code == 400
    assert 'Access-Control-Allow-Origin' not in response.headers
