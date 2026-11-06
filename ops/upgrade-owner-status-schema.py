"""Backup-first owner status upgrade for the reviewed unversioned VPS schema.

Read-only unless --apply is supplied. Uses the running backend image/environment;
does not pull, build, stamp, or replace application containers. Retains the backup
and rehearsal database. Requires Docker, Python 3 and the matching checkout files.
"""
import argparse
import hashlib
import http.client
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    names = {key: os.environ.get('STATUS_' + key.upper() + '_CONTAINER', default) for key, default in {
        'backend': 'zeaplay_backend', 'postgres': 'zeaplay_postgres',
        'presence': 'zeaplay_presence', 'frontend': 'zeaplay_frontend'}.items()}
    helper = Path(__file__).resolve().parents[1] / 'backend/scripts/apply_owner_status_schema.py'
    if not helper.is_file():
        parser.error('Matching backend/scripts/apply_owner_status_schema.py is required')
    root = Path(os.environ.get('STATUS_BACKUP_ROOT', '/root'))
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    evidence = root / ('zea-owner-upgrade-' + stamp + '-' + secrets.token_hex(4))
    evidence.mkdir(mode=0o700, parents=True)
    if os.name == 'posix':
        os.chmod(evidence, 0o700)
    print('Private evidence directory: ' + str(evidence), flush=True)
    stopped = False
    committed = False

    def run(command, phase, **kwargs):
        result = subprocess.run(command, stderr=subprocess.PIPE, check=False, **kwargs)
        if result.returncode:
            (evidence / (phase + '.stderr')).write_bytes(result.stderr)
            raise RuntimeError(phase + ' failed; inspect its private stderr file before continuing')
        return result

    def inspect(name):
        return json.loads(run(['docker', 'inspect', name], 'inspect-' + name, stdout=subprocess.PIPE).stdout)[0]

    def save(name, result):
        (evidence / name).write_text(json.dumps(result, indent=2), encoding='utf-8')

    try:
        info = {key: inspect(name) for key, name in names.items()}
        for key in ('backend', 'postgres', 'presence', 'frontend'):
            if not info[key]['State']['Running'] or info[key]['HostConfig']['AutoRemove']:
                raise RuntimeError(key + ' must be an existing running persistent container')
        networks = list(info['backend']['NetworkSettings']['Networks'])
        if len(networks) != 1:
            raise RuntimeError('Expected exactly one backend network; review deployment topology')
        environment = dict(entry.split('=', 1) for entry in info['backend']['Config']['Env'])
        pg_environment = dict(entry.split('=', 1) for entry in info['postgres']['Config']['Env'])
        database = pg_environment.get('POSTGRES_DB')
        user = pg_environment.get('POSTGRES_USER')
        if not database or not user:
            raise RuntimeError('PostgreSQL database/user configuration is required')
        target = json.loads(run(['docker', 'exec', '-e', 'VEE_BOOTSTRAP_SCHEMA=false', names['backend'],
            'python', '-c', ('import json; from app.config import get_settings; from sqlalchemy.engine import make_url; '
            'u=make_url(get_settings().database_url); print(json.dumps(dict(host=u.host,database=u.database)))')],
            'target', stdout=subprocess.PIPE).stdout)
        if target['host'] not in {'postgres', names['postgres']} or target['database'] != database:
            raise RuntimeError('Backend database differs from the backup target; no services stopped')
        environment['VEE_BOOTSTRAP_SCHEMA'] = 'false'
        environment_bytes = json.dumps(environment).encode('utf-8')

        def upgrade(phase, *arguments, proof=None):
            command = ['docker', 'run', '--rm', '-i', '--network', networks[0], '--mount',
                'type=bind,src=' + helper.as_posix() + ',dst=/app/scripts/apply_owner_status_schema.py,readonly']
            if proof:
                command += ['--mount', 'type=bind,src=' + proof.as_posix() + ',dst=/verified-rehearsal.json,readonly']
            command += ['--entrypoint', 'python', info['backend']['Image'], '-c',
                ('import json,os,runpy,sys; os.environ.update(json.load(sys.stdin)); '
                'sys.argv=["/app/scripts/apply_owner_status_schema.py"]+sys.argv[1:]; '
                'runpy.run_path(sys.argv[0],run_name="__main__")'), *arguments]
            result = run(command, phase, input=environment_bytes, stdout=subprocess.PIPE)
            value = json.loads(result.stdout)
            save(phase + '.json', value)
            return value

        preflight = upgrade('preflight')
        print('Schema preflight: ' + preflight['status'], flush=True)
        if preflight['status'] == 'already_compatible':
            print('Owner schema is already compatible. No services stopped or records changed.', flush=True)
            return 0
        if not args.apply:
            print('Read-only preflight passed. Use --apply for backup, restored rehearsal and live upgrade.', flush=True)
            return 0
        # Exact running images and environment remain in place. Stop all known
        # writers before the backup; table locks and proof matching reject drift.
        stopped = True
        run(['docker', 'stop', '--time', '30', names['backend'], names['presence']], 'stop-writers', stdout=subprocess.PIPE)
        archive = evidence / 'database.dump'
        with archive.open('wb') as output:
            run(['docker', 'exec', names['postgres'], 'pg_dump', '-U', user, '-d', database, '-Fc'], 'backup', stdout=output)
        if not archive.stat().st_size:
            raise RuntimeError('Backup is empty; live database was not changed')
        with archive.open('rb') as source, (evidence / 'database.list').open('wb') as output:
            run(['docker', 'exec', '-i', names['postgres'], 'pg_restore', '--list'], 'backup-list', stdin=source, stdout=output)
        if b'TABLE DATA' not in (evidence / 'database.list').read_bytes():
            raise RuntimeError('Backup listing contains no table data; live database was not changed')
        with archive.open('rb') as source:
            hasher = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                hasher.update(chunk)
            digest = hasher.hexdigest()
        save('backup.json', {'bytes': archive.stat().st_size, 'sha256': digest})
        rehearsal = 'zea_owner_rehearsal_' + stamp.lower() + '_' + secrets.token_hex(4)
        save('rehearsal-database.json', {'database': rehearsal})
        run(['docker', 'exec', names['postgres'], 'createdb', '-U', user, rehearsal], 'create-rehearsal', stdout=subprocess.PIPE)
        with archive.open('rb') as source:
            run(['docker', 'exec', '-i', names['postgres'], 'pg_restore', '-U', user, '-d', rehearsal,
                '--exit-on-error', '--no-owner', '--no-privileges'], 'restore', stdin=source, stdout=subprocess.PIPE)
        first = upgrade('rehearsal', '--database', rehearsal, '--apply')
        second = upgrade('rehearsal-repeat', '--database', rehearsal, '--apply')
        if (first['status'] != 'applied' or second['status'] != 'already_compatible'
                or first['table_fingerprints'] != second['table_fingerprints']):
            raise RuntimeError('Restored-backup upgrade/repeat verification failed')
        print('Backup restore, upgrade and unchanged repeat passed. Applying with matching live fingerprints.', flush=True)
        result = upgrade('applied', '--apply', '--verified-rehearsal', '/verified-rehearsal.json', proof=evidence / 'rehearsal.json')
        committed = True
        if result['status'] != 'applied' or result['table_fingerprints'] != first['table_fingerprints']:
            raise RuntimeError('Unexpected live verification result; review before resuming writers')
        upgrade('verified')
        run(['docker', 'start', names['backend'], names['presence']], 'start-writers', stdout=subprocess.PIPE)
        stopped = False
        url = os.environ.get('STATUS_READY_URL', 'http://127.0.0.1:6311/ready')
        for attempt in range(20):
            try:
                with urllib.request.urlopen(url, timeout=3) as response:
                    ready = json.load(response)
                if ready.get('database') is True and ready.get('realtime') is True:
                    save('ready.json', ready)
                    break
            except (urllib.error.URLError, http.client.HTTPException, OSError):
                pass
            if attempt == 19:
                raise RuntimeError('Upgrade committed, but readiness did not pass; inspect runtime without repeating migrations')
            time.sleep(2)
        run(['docker', 'exec', names['frontend'], 'nginx', '-t'], 'nginx-test', stdout=subprocess.PIPE)
        run(['docker', 'exec', names['frontend'], 'nginx', '-s', 'reload'], 'nginx-reload', stdout=subprocess.PIPE)
        print('PASS: owner schema upgraded; all records unchanged; database/realtime ready. Evidence: ' + str(evidence), flush=True)
        print('Retained restored rehearsal database: ' + rehearsal, flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - report maintenance state for any failed phase
        print('STOP: ' + str(exc), file=sys.stderr)
        print('Private backup/evidence: ' + str(evidence), file=sys.stderr)
        if stopped:
            print('Backend/presence may be stopped. Inspect the failed phase before resuming writers.', file=sys.stderr)
        if committed:
            print('The live upgrade committed. Do not repeat database repair as a readiness/proxy fix.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
