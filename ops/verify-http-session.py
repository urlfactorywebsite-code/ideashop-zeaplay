"""Exercise production HTTP IP sessions through nginx with an isolated PostgreSQL 15 DB."""
import argparse
from http.cookiejar import CookieJar
import json
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4


def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-image', required=True)
    parser.add_argument('--frontend-image', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run = 'zea-http-check-' + uuid4().hex[:12]
    containers, checks = [], []
    origin = 'http://167.86.108.178:6300'
    cookies = CookieJar()
    client = build_opener(HTTPCookieProcessor(cookies))

    def request(path, payload=None, headers=None, method=None):
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {'Content-Type': 'application/json', 'Origin': origin, 'X-Zea-Browser': '1', **(headers or {})}
        try:
            response = client.open(Request(base + path, data=body, headers=headers, method=method), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            try:
                body = json.loads(raw) if raw else None
            except ValueError:
                body = raw.decode(errors='replace')
            return response.status, body, response.headers

    def check(name, actual, expected):
        checks.append({'case': name, 'actual': actual, 'expected': expected, 'passed': actual == expected})
        if actual != expected:
            raise RuntimeError(f'{name}: expected {expected}, got {actual}')

    with tempfile.TemporaryDirectory(prefix=run) as scratch:
        init = Path(scratch) / 'initialize.py'
        init.write_text('''from uuid import uuid4
from sqlalchemy import text
from app.main import app
from app.database import Base, engine, SessionLocal
from app.auth import hash_password
from app.models import User, RoleEnum, UserStatusEnum
with engine.begin() as connection:
    connection.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
Base.metadata.create_all(engine)
with SessionLocal() as db:
    db.add(User(id=str(uuid4()), tenant_id=uuid4(), name='HTTP session test',
                email='http-session@example.com', hashed_password=hash_password('Synthetic-http-password!'),
                role=RoleEnum.USER, status=UserStatusEnum.ACTIVE))
    db.commit()
''', encoding='utf-8')
        postgres, redis, backend, frontend = [run + '-' + part for part in ('postgres', 'redis', 'backend', 'frontend')]
        try:
            docker('network', 'create', run)
            containers.append(postgres)
            docker('run', '-d', '--name', postgres, '--network', run, '--network-alias', 'postgres',
                   '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=zeaplay_rt3_test', 'postgres:15-alpine')
            for _ in range(100):
                probe = subprocess.run(['docker', 'exec', postgres, 'pg_isready', '-U', 'postgres'], capture_output=True)
                if probe.returncode == 0:
                    break
                time.sleep(0.2)
            else:
                raise RuntimeError('Isolated PostgreSQL did not start')
            containers.append(redis)
            docker('run', '-d', '--name', redis, '--network', run, '--network-alias', 'redis', 'redis:7-alpine')
            containers.append(backend)
            env = {
                'VEE_ENVIRONMENT': 'production', 'VEE_BOOTSTRAP_SCHEMA': 'false',
                'VEE_DATABASE_URL': 'postgresql+psycopg://postgres@postgres/zeaplay_rt3_test',
                'VEE_REDIS_URL': 'redis://redis:6379/0', 'VEE_CACHE_REDIS_URL': 'redis://redis:6379/1',
                'VEE_JWT_SECRET_KEY': 'synthetic-http-access-key-000000000000000000',
                'VEE_JWT_REFRESH_SECRET_KEY': 'synthetic-http-refresh-key-00000000000000000',
                'VEE_CORS_ALLOW_ORIGINS': json.dumps([origin]),
                'VEE_BROWSER_SESSION_HTTP_ORIGINS': json.dumps([origin]),
                'VEE_BCRYPT_ROUNDS': '4', 'VEE_SMTP_DELIVERY_ENABLED': 'false',
                'VEE_ENABLE_N8N_FORWARDING': 'false', 'VEE_MEDIA_ROOT': '/tmp/test-media',
            }
            command = ['run', '-d', '--name', backend, '--network', run, '--network-alias', 'backend',
                       '--network-alias', 'presence', '--mount', f'type=bind,source={init},target=/tmp/initialize.py,readonly']
            for name, value in env.items():
                command += ['-e', name + '=' + value]
            docker(*command, args.backend_image, 'sh', '-c',
                   'PYTHONPATH=/app python /tmp/initialize.py && exec uvicorn app.main:app --host 0.0.0.0 --port 6311')
            containers.append(frontend)
            docker('run', '-d', '--name', frontend, '--network', run, '-p', '127.0.0.1::80', args.frontend_image)
            mapping = json.loads(docker('inspect', frontend))[0]['NetworkSettings']['Ports']['80/tcp'][0]
            base = 'http://127.0.0.1:' + mapping['HostPort']
            deadline = time.monotonic() + 45
            while True:
                try:
                    if request('/api/health')[0] == 200:
                        break
                except (URLError, TimeoutError, ConnectionError, ValueError):
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError('Isolated backend did not start: ' + docker('logs', backend))
                time.sleep(0.2)
            check('Full production backend health', request('/api/health')[0], 200)
            check('PostgreSQL and Redis readiness', request('/api/ready')[0], 200)
            status, _, cors = request('/api/auth/login', headers={
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type,X-Zea-Browser',
            }, method='OPTIONS')
            check('HTTP browser CORS preflight', status, 200)
            check('CORS permits exact HTTP IP', cors.get('Access-Control-Allow-Origin'), origin)
            check('CORS permits browser credentials', cors.get('Access-Control-Allow-Credentials'), 'true')
            check('Anonymous HTTP refresh', request('/api/auth/browser-session/refresh', {})[0], 401)
            check('Invalid HTTP login', request('/api/auth/login', {'email': 'missing@example.test', 'password': 'invalid'})[0], 401)
            status, _, headers = request('/api/auth/login', {'email': 'http-session@example.com', 'password': 'Synthetic-http-password!'})
            check('Valid HTTP login', status, 200)
            check('Login response permits credentialed browser access',
                  headers.get('Access-Control-Allow-Origin') == origin and headers.get('Access-Control-Allow-Credentials') == 'true', True)
            cookie = headers.get('Set-Cookie', '')
            check('HTTP cookie accepted by cookie jar', len(list(cookies)), 1)
            check('HTTP cookie has separate name', cookie.startswith('zea_browser_session_http_'), True)
            check('HTTP cookie is HttpOnly and SameSite=Lax', 'HttpOnly' in cookie and 'SameSite=lax' in cookie, True)
            check('HTTP cookie has no Secure or Domain attribute', 'Secure' not in cookie and 'Domain=' not in cookie, True)
            status, body, _ = request('/api/auth/browser-session/refresh', {})
            check('Persisted HTTP session refresh', status, 200)
            check('Refreshed token authenticates user', request('/api/auth/me', headers={'Authorization': 'Bearer ' + body['access_token']})[0], 200)
            check('Foreign origin rejected', request('/api/auth/browser-session/refresh', {}, {'Origin': 'http://evil.example.test'})[0], 403)
            check('Different IP port rejected', request('/api/auth/browser-session/refresh', {}, {'Origin': 'http://167.86.108.178:6200'})[0], 403)
            check('Missing browser marker rejected', request('/api/auth/browser-session/refresh', {}, {'X-Zea-Browser': ''})[0], 403)
            check('Logout revokes HTTP session', request('/api/auth/browser-session/logout', {})[0], 204)
            check('Revoked HTTP session cannot refresh', request('/api/auth/browser-session/refresh', {})[0], 401)
        except Exception:
            if backend in containers:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                # Docker logs writes server tracebacks to stderr too.
                logs = subprocess.run(['docker', 'logs', backend], capture_output=True, text=True)
                args.output.with_suffix('.backend.log').write_text(logs.stdout + logs.stderr, encoding='utf-8')
            raise
        finally:
            for container in reversed(containers):
                subprocess.run(['docker', 'rm', '-f', '-v', container], capture_output=True)
            subprocess.run(['docker', 'network', 'rm', run], capture_output=True)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({'checks': checks, 'passed': len(checks) == 20 and all(c['passed'] for c in checks)}, indent=2), encoding='utf-8')
    print(json.dumps({'checks': len(checks), 'passed': all(c['passed'] for c in checks)}))


if __name__ == '__main__':
    main()
