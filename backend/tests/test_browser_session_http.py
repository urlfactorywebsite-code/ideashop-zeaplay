"""Explicit HTTP IP deployment exceptions never change the HTTPS default."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.app.config import Settings
from backend.app.services import browser_session

ORIGIN = 'http://167.86.108.178:6300'


def production(**changes):
    return Settings(_env_file=None, **{
        'environment': 'production', 'jwt_secret_key': 'a' * 40,
        'jwt_refresh_secret_key': 'b' * 40, 'cors_allow_origins': ['https://app.example.test'],
        'browser_session_http_origins': [], **changes,
    })


@pytest.mark.parametrize('origin', [ORIGIN, 'http://127.0.0.1:6300', 'http://[::1]:6300'])
def test_production_accepts_only_explicit_ip_http_exception(origin):
    settings = production(cors_allow_origins=[origin], browser_session_http_origins=[origin])
    assert settings.environment == 'production'


@pytest.mark.parametrize('origin', [
    '*', 'http://*', 'http://example.com:6300', 'https://167.86.108.178:6300',
    ORIGIN + '/', ORIGIN + '/path', ORIGIN + '?query', ORIGIN + '#',
    'http://user@167.86.108.178:6300', 'http://167.86.108.178:0',
    'http://167.86.108.178:65536', 'http://167.86.108.178:bad',
    'http://167.86.108.178:6300\\evil', ' ' + ORIGIN, ORIGIN + '\n',
])
def test_invalid_or_broad_http_exceptions_are_rejected(origin):
    with pytest.raises(ValueError, match='exact HTTP IP origins'):
        production(cors_allow_origins=[origin], browser_session_http_origins=[origin])


def test_http_origin_is_rejected_without_explicit_exception():
    with pytest.raises(ValueError, match='HTTPS'):
        production(cors_allow_origins=[ORIGIN])
    with pytest.raises(ValueError, match='CORS'):
        production(browser_session_http_origins=[ORIGIN])


def test_http_exception_does_not_relax_oauth_https_validation():
    with pytest.raises(ValueError, match='OAuth URLs require HTTPS'):
        production(cors_allow_origins=[ORIGIN], browser_session_http_origins=[ORIGIN], oauth_issuer=ORIGIN)


def request(origin=ORIGIN, scheme='http', marker='1'):
    return Request({'type': 'http', 'scheme': scheme, 'method': 'POST', 'path': '/',
                    'headers': [(b'host', b'attacker.example.test'),
                                (b'origin', origin.encode()), (b'x-zea-browser', marker.encode())]})


@pytest.mark.parametrize('origin,marker,status', [
    (ORIGIN, '1', None), (ORIGIN, '', 403), ('null', '1', 403),
    ('http://167.86.108.178:6200', '1', 403), ('http://attacker.example.test', '1', 403),
    ('https://app.example.test', '1', 400),
])
def test_http_guard_remains_exact_and_csrf_protected(monkeypatch, origin, marker, status):
    settings = production(cors_allow_origins=[ORIGIN, 'https://app.example.test'],
                          browser_session_http_origins=[ORIGIN])
    monkeypatch.setattr(browser_session, 'get_settings', lambda: settings)
    if status:
        with pytest.raises(HTTPException) as error:
            browser_session.check_origin(request(origin, marker=marker))
        assert error.value.status_code == status
    else:
        browser_session.check_origin(request(origin, marker=marker))


def test_default_transport_and_cookie_names_remain_separate(monkeypatch):
    settings = SimpleNamespace(environment='production', cors_allow_origins=[ORIGIN], browser_session_http_origins=[])
    monkeypatch.setattr(browser_session, 'get_settings', lambda: settings)
    with pytest.raises(HTTPException) as error:
        browser_session.check_origin(request())
    assert error.value.status_code == 400
    settings.browser_session_http_origins = [ORIGIN, 'http://167.86.108.178:6200']
    http_cookie = browser_session.cookie_name(request())
    assert http_cookie.startswith('zea_browser_session_http_')
    assert http_cookie != browser_session.cookie_name(request('http://167.86.108.178:6200'))
    assert browser_session.cookie_name(request(scheme='https')) == '__Host-zea_browser_session'
