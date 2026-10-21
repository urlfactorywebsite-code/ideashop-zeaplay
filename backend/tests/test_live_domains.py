"""Canonical deployment URLs, private settings preservation, and real OAuth discovery."""
import json
import subprocess
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.app.config import Settings
from backend.app.routers.oauth_management import discovery_router
from backend.app.services import browser_session, oauth, password_recovery
spec = spec_from_file_location('live_domain_configuration', Path(__file__).resolve().parents[2] / 'ops/configure-live-domains.py')
configuration = module_from_spec(spec)
spec.loader.exec_module(configuration)
BACKEND, FRONTEND = configuration.BACKEND, configuration.FRONTEND
public_values, render_environment = configuration.public_values, configuration.render_environment


def settings():
    values = public_values('172.29.0.5/32', '172.29.0.0/16')
    return Settings(_env_file=None, environment='production',
        jwt_secret_key='synthetic-access-key-for-domain-tests-0000',
        jwt_refresh_secret_key='synthetic-refresh-key-for-domain-tests-000',
        cors_allow_origins=json.loads(values['VEE_CORS_ALLOW_ORIGINS']),
        websocket_trusted_origins=json.loads(values['VEE_WEBSOCKET_TRUSTED_ORIGINS']),
        browser_session_http_origins=json.loads(values['VEE_BROWSER_SESSION_HTTP_ORIGINS']),
        oauth_issuer=values['VEE_OAUTH_ISSUER'], oauth_ui_url=values['VEE_OAUTH_UI_URL'],
        password_reset_url=values['VEE_PASSWORD_RESET_URL'])


def test_canonical_urls_work_with_production_session_and_password_reset(monkeypatch):
    configured = settings()
    monkeypatch.setattr(browser_session, 'get_settings', lambda: configured)
    monkeypatch.setattr(password_recovery, 'get_settings', lambda: configured)
    request = Request({'type': 'http', 'scheme': 'https', 'path': '/api/auth/login', 'method': 'POST',
                       'headers': [(b'host', b'api.ideashop.zeacrm.com'),
                                   (b'origin', FRONTEND.encode()), (b'x-zea-browser', b'1')]})
    browser_session.check_origin(request)
    assert browser_session.cookie_name(request) == '__Host-zea_browser_session'
    assert configured.browser_session_http_origins == []
    assert password_recovery.reset_url() == FRONTEND + '/#/reset-password'
    assert configured.websocket_trusted_origins == [FRONTEND, BACKEND]


def test_rfc8414_discovery_returns_canonical_backend_endpoints(monkeypatch):
    monkeypatch.setattr(oauth, 'settings', settings)
    app = FastAPI()
    app.include_router(discovery_router)
    with TestClient(app) as api:
        response = api.get('/.well-known/oauth-authorization-server/api/oauth2')
        assert response.status_code == 200
        body = response.json()
        assert body['issuer'] == BACKEND + '/api/oauth2'
        for key, suffix in [('authorization_endpoint', 'authorize'), ('token_endpoint', 'token'),
                            ('revocation_endpoint', 'revoke'), ('introspection_endpoint', 'introspect')]:
            assert body[key] == BACKEND + '/api/oauth2/' + suffix
        assert api.get('/.well-known/oauth-authorization-server/other').status_code == 404


def test_domain_update_preserves_secrets_media_and_unrelated_services():
    original = ('# keep this comment\nVEE_JWT_SECRET_KEY=synthetic-private-key\n'
                'VEE_DATABASE_URL=synthetic-private-database\nZEAPLAY_MEDIA_HOST_PATH=/opt/existing-media\n'
                'VEE_MINIO_PUBLIC_BASE=https://existing-storage.example.com\n'
                'export API_URL = old\nAPI_URL=duplicate\nVEE_BROWSER_SESSION_HTTP_ORIGINS=["http://167.86.108.178:6300"]\n')
    updated = render_environment(original, public_values('172.29.0.5/32', '172.29.0.0/16'))
    for line in original.splitlines()[:5]:
        assert line in updated
    assert updated.count('API_URL=') == 2  # API_URL and VITE_API_URL, no duplicate API_URL entry
    assert updated.count('\nAPI_URL=') == 1
    assert 'VEE_BROWSER_SESSION_HTTP_ORIGINS=[]' in updated
    assert 'PRESENCE_REQUIRE_ORIGIN=true' in updated
    assert 'PRESENCE_ALLOW_LOCALHOST_ORIGINS=false' in updated
    assert 'http://167.86.108.178' not in updated


def test_configuration_cli_backups_original_and_preserves_persistent_paths(tmp_path):
    env = tmp_path / '.env.production'
    original = 'VEE_JWT_SECRET_KEY=synthetic-secret\nZEAPLAY_MEDIA_HOST_PATH=/opt/existing-media\n'
    env.write_text(original)
    avatars = tmp_path / 'avatars'
    avatars.mkdir()
    result = subprocess.run([sys.executable, configuration.__file__, '--env-file', str(env),
        '--proxy-peer', '172.29.0.5/32', '--backend-subnet', '172.29.0.0/16', '--avatar-path', str(avatars)],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert Path(report['backup']).read_text() == original
    assert 'synthetic-secret' not in result.stdout
    updated = env.read_text()
    assert 'ZEAPLAY_MEDIA_HOST_PATH=/opt/existing-media' in updated
    assert 'ZEAPLAY_AVATAR_HOST_PATH=' + str(avatars.resolve()) in updated
    assert 'VEE_OAUTH_ISSUER=' + BACKEND + '/api/oauth2' in updated
    assert 'VEE_MEDIA_PUBLIC_BASE=' + BACKEND + '/uploads' in updated


@pytest.mark.parametrize('peer,subnet', [
    ('0.0.0.0/0', '172.29.0.0/16'), ('172.29.0.5/32', '0.0.0.0/0'),
    ('172.29.0.0/16', '172.29.0.0/16'), ('8.8.8.8/32', '8.8.8.0/24'),
    ('172.30.0.5/32', '172.29.0.0/16'), ('not-an-ip', '172.29.0.0/16'),
])
def test_domain_configuration_refuses_unsafe_proxy_trust(peer, subnet):
    with pytest.raises(ValueError):
        public_values(peer, subnet)
