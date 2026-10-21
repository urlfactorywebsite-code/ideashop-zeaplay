"""Repair VPS VAPID settings privately, preserving any working signing key pair.

Uses the existing backend's installed push library to validate/sign locally.
Does not restart services, contact push providers, or send notifications.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


PROBE = r'''
import base64
import io
import json
import sys
from cryptography.hazmat.primitives import serialization
from dotenv import dotenv_values
from py_vapid import Vapid
from app.services import push_service as push

subject = 'https://ideashop.zeacrm.com'
original = push.configuration_status()
runtime = push.get_vapid_public_key(), push._get_vapid_private_key(), push._get_vapid_subject()
persisted = dotenv_values(stream=io.StringIO(sys.stdin.read()), interpolate=False)
saved = tuple(persisted.get(name) or persisted.get('VEE_' + name)
              for name in ('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'))

def candidate(public, private, subject):
    push.get_vapid_public_key = lambda: public
    push._get_vapid_private_key = lambda: private
    push._get_vapid_subject = lambda: subject
    return push.configuration_status()['configured']

# Prefer a valid persisted pair so retrying before container recreation cannot
# rotate keys again. Otherwise retain a working pair from the running backend.
for public, private, saved_subject in (saved, runtime):
    if candidate(public, private, saved_subject):
        subject, action = saved_subject, 'preserve_valid_pair'
        break
    if candidate(public, private, subject):
        action = 'repair_subject'
        break
else:
    action = 'replace_invalid_pair'
    vapid = Vapid()
    vapid.generate_keys()
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')
    public = encode(vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    private = encode(vapid.private_key.private_numbers().private_value.to_bytes(32, 'big'))

push.get_vapid_public_key = lambda: public
push._get_vapid_private_key = lambda: private
push._get_vapid_subject = lambda: subject
assert push.configuration_status()['configured'], 'Candidate signing configuration is invalid'
# Captured in memory by the host helper; never forwarded to its console.
print(json.dumps({'action': action, 'before': original, 'public': public, 'private': private, 'subject': subject}))
'''


def render_environment(original, values):
    result, seen = [], set()
    for line in original.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=', line)
        key = match.group(1) if match else None
        if key in values:
            existing = line[match.end():].lstrip()
            if existing.startswith(('"', "'")) and not re.fullmatch(
                r'''(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?''', existing
            ):
                raise ValueError('Review multiline VAPID settings before updating this environment file')
            if key not in seen:
                result.append(key + '=' + json.dumps(values[key]))
                seen.add(key)
        else:
            result.append(line)
    result.extend(key + '=' + json.dumps(value) for key, value in values.items() if key not in seen)
    return '\n'.join(result) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=Path('.env.production'))
    parser.add_argument('--container', default='zeaplay_backend')
    parser.add_argument('--apply', action='store_true', help='Save the validated settings with a private backup')
    args = parser.parse_args()
    if not args.env_file.is_file() or args.env_file.is_symlink():
        parser.error('Use an existing regular production environment file')
    original = args.env_file.read_bytes()
    probe = subprocess.run(['docker', 'exec', '-i', args.container, 'python', '-c', PROBE],
                           input=original.decode('utf-8-sig'), text=True, capture_output=True)
    if probe.returncode:
        # Do not expose arbitrary subprocess diagnostics containing private data.
        parser.exit(1, 'Backend signing check failed. Confirm the backend is running and push dependencies are installed; no settings changed.\n')
    try:
        material = json.loads(probe.stdout)
        values = {prefix + name: material[field]
                  for prefix in ('VEE_', '')
                  for name, field in [('VAPID_PUBLIC_KEY', 'public'), ('VAPID_PRIVATE_KEY', 'private'), ('VAPID_SUBJECT', 'subject')]}
        updated = render_environment(original.decode('utf-8-sig'), values).encode('utf-8')
    except (ValueError, KeyError, TypeError):
        parser.exit(1, 'Invalid signing-check response; no settings changed.\n')
    report = {'action': material['action'], 'before': material['before'],
              'candidate_validated': True, 'applied': False, 'notifications_sent': False}
    if args.apply and updated != original:
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = args.env_file.with_name(args.env_file.name + '.before-push-' + stamp)
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
        descriptor, temporary = tempfile.mkstemp(prefix='.push-env-', dir=args.env_file.parent)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(updated)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, args.env_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        report.update(applied=True, backup=str(backup), recreate_backend_required=True)
    elif args.apply:
        report.update(applied=True, recreate_backend_required=True)
    else:
        report['note'] = 'Preview only. Use --apply to persist settings; preview key material is discarded.'
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
