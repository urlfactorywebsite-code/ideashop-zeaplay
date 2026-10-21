"""Atomically configure the public Ideashop domains without replacing private settings."""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile

FRONTEND = 'https://ideashop.zeacrm.com'
BACKEND = 'https://api.ideashop.zeacrm.com'


def public_values(proxy_peer, backend_subnet):
    peer = ipaddress.ip_network(proxy_peer, strict=False)
    subnet = ipaddress.ip_network(backend_subnet, strict=False)
    if peer.prefixlen != peer.max_prefixlen or subnet.prefixlen == 0:
        raise ValueError('Use one exact NPM peer IP and a bounded private application subnet')
    if not peer.network_address.is_private or not subnet.is_private or not peer.subnet_of(subnet):
        raise ValueError('NPM peer must belong to the private application subnet')
    origins = json.dumps([FRONTEND, BACKEND], separators=(',', ':'))
    return {
        'VEE_CORS_ALLOW_ORIGINS': origins, 'VEE_BROWSER_SESSION_HTTP_ORIGINS': '[]',
        'VEE_WEBSOCKET_TRUSTED_ORIGINS': origins, 'VEE_WEBSOCKET_REQUIRE_ORIGIN': 'true',
        'VEE_WEBSOCKET_REQUIRE_TICKET': 'true',
        'VEE_OAUTH_ISSUER': BACKEND + '/api/oauth2', 'VEE_OAUTH_UI_URL': FRONTEND + '/#/oauth/authorize',
        'VEE_OAUTH_AUDIENCE': 'zeaplay-api', 'VEE_PASSWORD_RESET_URL': FRONTEND + '/#/reset-password',
        'VEE_MEDIA_PUBLIC_BASE': BACKEND + '/uploads',
        'VEE_BOOTSTRAP_SCHEMA': 'false',
        'API_URL': BACKEND + '/api', 'VITE_API_URL': BACKEND + '/api', 'VITE_API_BASE_URL': BACKEND + '/api',
        'PRESENCE_URL': BACKEND, 'VITE_PRESENCE_URL': BACKEND, 'CHAT_URL': BACKEND, 'VITE_CHAT_URL': BACKEND,
        'WS_URL': BACKEND.replace('https:', 'wss:') + '/api',
        'TICKET_CHAT_WS_URL': BACKEND.replace('https:', 'wss:') + '/api',
        'VITE_WS_URL': BACKEND.replace('https:', 'wss:') + '/api',
        'VITE_TICKET_CHAT_WS_URL': BACKEND.replace('https:', 'wss:') + '/api',
        'NGINX_TRUSTED_PROXY_CIDRS': str(peer), 'FORWARDED_ALLOW_IPS': str(subnet),
        'PRESENCE_CORS_ORIGINS': FRONTEND + ',' + BACKEND,
        'PRESENCE_REQUIRE_ORIGIN': 'true', 'PRESENCE_ALLOW_LOCALHOST_ORIGINS': 'false',
        'PRESENCE_MAX_CONNECTIONS_PER_USER': '12', 'PRESENCE_MAX_TOTAL_CONNECTIONS': '10000',
    }


def render_environment(original, values):
    lines, seen = [], set()
    for line in original.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=', line)
        key = match.group(1) if match else None
        if key in values:
            if key not in seen:
                lines.append(key + '=' + values[key])
                seen.add(key)
        else:
            lines.append(line)
    lines.extend(key + '=' + value for key, value in values.items() if key not in seen)
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=Path('.env.production'))
    parser.add_argument('--proxy-peer', required=True, help='Exact NPM peer IP/CIDR on the application network')
    parser.add_argument('--backend-subnet', required=True)
    parser.add_argument('--avatar-path', type=Path, help='Verified persistent custom-avatar directory')
    args = parser.parse_args()
    values = public_values(args.proxy_peer, args.backend_subnet)
    if args.avatar_path:
        if not args.avatar_path.is_dir():
            parser.error('--avatar-path must be an existing directory')
        values['ZEAPLAY_AVATAR_HOST_PATH'] = str(args.avatar_path.resolve())
    original = args.env_file.read_bytes()
    updated = render_environment(original.decode('utf-8-sig'), values)
    backup = args.env_file.with_name(args.env_file.name + '.before-live-domains-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(original)
    descriptor, temporary = tempfile.mkstemp(prefix='.live-domains-', dir=args.env_file.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, args.env_file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps({'configured': True, 'frontend': FRONTEND, 'backend': BACKEND,
                      'backup': str(backup), 'private_settings_preserved': True}))


if __name__ == '__main__':
    main()
