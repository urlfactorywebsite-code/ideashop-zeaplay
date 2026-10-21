"""Verify public TLS, API/CORS, OAuth discovery and presence routing without credentials."""
import argparse
import json
from pathlib import Path
import re
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

FRONTEND = 'https://ideashop.zeacrm.com'
BACKEND = 'https://api.ideashop.zeacrm.com'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', default=FRONTEND)
    parser.add_argument('--backend', default=BACKEND)
    parser.add_argument('--ca-file', help='Optional trusted CA for isolated test certificates')
    parser.add_argument('--proxy', help='Optional HTTP CONNECT proxy for isolated tests')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    frontend, backend = args.frontend.rstrip('/'), args.backend.rstrip('/')
    context = ssl.create_default_context(cafile=args.ca_file)
    handlers = [HTTPSHandler(context=context)]
    if args.proxy:
        handlers.append(ProxyHandler({'https': args.proxy}))
    client = build_opener(*handlers)
    checks, errors = [], []

    def request(base, path, payload=None, headers=None, method=None):
        data = None if payload is None else json.dumps(payload).encode()
        headers = {'Content-Type': 'application/json', **(headers or {})}
        try:
            response = client.open(Request(base + path, data=data, headers=headers, method=method), timeout=12)
        except HTTPError as error:
            response = error
        except (URLError, OSError) as error:
            errors.append({'url': base + path, 'error': str(error)})
            return None, {}, {}, str(error)
        with response:
            raw = response.read().decode(errors='replace')
            try:
                body = json.loads(raw)
            except ValueError:
                body = {}
            return response.status, body, dict(response.headers.items()), raw

    def check(name, passed, status=None):
        checks.append({'case': name, 'passed': bool(passed), **({'status': status} if status is not None else {})})

    status, _, _, html = request(frontend, '/')
    check('Frontend TLS and application HTML', status == 200 and 'runtime-config.js' in html, status)
    status, _, runtime_headers, runtime = request(frontend, '/runtime-config.js')
    check('Runtime URLs are revalidated after deployment',
          'no-cache' in {key.lower(): value for key, value in runtime_headers.items()}.get('cache-control', ''))
    match = re.search(r'window\.__RUNTIME_CONFIG__\s*=\s*(\{.*\})', runtime)
    try:
        config = json.loads(match.group(1)) if match else {}
    except ValueError:
        config = {}
    check('Runtime API targets backend domain', status == 200 and config.get('API_URL') == backend + '/api', status)
    check('Runtime native WebSockets target backend domain', config.get('WS_URL') == backend.replace('https:', 'wss:') + '/api')
    check('Runtime presence targets backend domain', config.get('PRESENCE_URL') == backend)
    status, root, _, _ = request(backend, '/')
    check('API hostname serves backend', status == 200 and isinstance(root, dict) and root.get('health') == '/health', status)
    for path in ['/api/health', '/api/ready', '/api/openapi.json']:
        status, _, _, _ = request(backend, path)
        check('API TLS ' + path, status == 200, status)
    status, metadata, _, _ = request(backend, '/.well-known/oauth-authorization-server/api/oauth2')
    issuer = backend + '/api/oauth2'
    check('OAuth RFC 8414 discovery', status == 200 and metadata.get('issuer') == issuer, status)
    check('OAuth endpoints use canonical API domain', all(
        metadata.get(key) == issuer + '/' + suffix for key, suffix in [
            ('authorization_endpoint', 'authorize'), ('token_endpoint', 'token'),
            ('revocation_endpoint', 'revoke'), ('introspection_endpoint', 'introspect')]))
    common = {'Origin': frontend, 'X-Zea-Browser': '1'}
    for path, payload in [('/api/auth/browser-session/refresh', {}),
                          ('/api/auth/login', {'email': 'live-domain-probe@example.invalid', 'password': 'synthetic-invalid-domain-probe'})]:
        status, _, headers, _ = request(backend, path, payload, common)
        lowered = {key.lower(): value for key, value in headers.items()}
        check('Anonymous/invalid browser request ' + path, status == 401, status)
        check('Credentialed frontend CORS ' + path,
              lowered.get('access-control-allow-origin') == frontend and lowered.get('access-control-allow-credentials') == 'true')
    status, _, headers, _ = request(backend, '/api/auth/login', headers={
        'Origin': frontend, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,X-Zea-Browser,Authorization',
    }, method='OPTIONS')
    lowered = {key.lower(): value for key, value in headers.items()}
    check('Browser preflight permits frontend', status == 200 and lowered.get('access-control-allow-origin') == frontend, status)
    status, _, _, _ = request(backend, '/api/auth/browser-session/refresh', {}, {
        'Origin': 'https://foreign.example.invalid', 'X-Zea-Browser': '1'})
    check('Foreign browser origin rejected', status == 403, status)
    status, _, _, handshake = request(backend, '/socket.io/?EIO=4&transport=polling', headers={'Origin': frontend})
    check('Presence Engine.IO route and frontend origin', status == 200 and handshake.startswith('0{'), status)
    report = {'frontend': frontend, 'backend': backend, 'passed': all(row['passed'] for row in checks),
              'checks': checks, 'transport_errors': errors, 'real_account_login_tested': False}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
