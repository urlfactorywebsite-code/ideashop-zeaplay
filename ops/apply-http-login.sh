#!/usr/bin/env bash
# Run on the existing VPS deployment. Does not recreate database/Redis containers.
set -euo pipefail
umask 077
cd /opt/ideashop-zeaplay
grep -q browser_session_http_origins backend/app/config.py
command -v python3 >/dev/null
command -v curl >/dev/null
project=$(docker inspect zeaplay_backend --format '{{index .Config.Labels "com.docker.compose.project"}}')
test -n "$project"
media_root=$(docker exec zeaplay_backend python -c 'from pathlib import Path; from app.config import get_settings; print(Path(get_settings().media_root).resolve())')
if [ "$media_root" != /app/media ]; then
  printf 'Custom media root detected; retain its deployment override using docs/vps-http-login.md. No changes made.\n' >&2
  exit 1
fi
cors=$(docker exec zeaplay_backend python -c 'import json; from app.config import get_settings; print(json.dumps(get_settings().cors_allow_origins))')
backup=$(mktemp -d /root/zeaplay-http-login.XXXXXXXX)
cp .env.production "$backup/environment.before"
docker inspect zeaplay_backend --format '{{.Image}}' > "$backup/backend-image.before"
docker image tag "$(cat "$backup/backend-image.before")" "zeaplay-backend:before-http-$(date -u +%Y%m%dT%H%M%SZ)"
docker exec zeaplay_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
docker exec -i zeaplay_postgres pg_restore --list < "$backup/database.dump" >/dev/null
printf 'Private backup: %s\n' "$backup"
dc=(docker compose --project-name "$project" --env-file .env.production -f docker-compose.prod.yml)
"${dc[@]}" build backend
media_dir=$(mktemp -d /opt/zeaplay-media.XXXXXXXX)
CURRENT_CORS="$cors" MEDIA_DIR="$media_dir" python3 - <<'PY'
import json, os, re, tempfile
from pathlib import Path
origin = 'http://167.86.108.178:6300'
origins = json.loads(os.environ['CURRENT_CORS'])
assert isinstance(origins, list) and all(isinstance(value, str) for value in origins)
origins = list(dict.fromkeys([*origins, origin]))
values = {
    'VEE_CORS_ALLOW_ORIGINS': json.dumps(origins, separators=(',', ':')),
    'VEE_BROWSER_SESSION_HTTP_ORIGINS': json.dumps([origin]),
    'VEE_BOOTSTRAP_SCHEMA': 'false',
    'ZEAPLAY_MEDIA_HOST_PATH': os.environ['MEDIA_DIR'],
}
path = Path('.env.production')
lines, seen = [], set()
for line in path.read_text().splitlines():
    match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=', line)
    key = match.group(1) if match else None
    if key in values:
        lines.append(key + '=' + values[key])
        seen.add(key)
    else:
        lines.append(line)
lines.extend(key + '=' + value for key, value in values.items() if key not in seen)
fd, temporary = tempfile.mkstemp(prefix='.env.production.http-', dir='.')
with os.fdopen(fd, 'w') as stream:
    stream.write('\n'.join(lines) + '\n')
    stream.flush()
    os.fsync(stream.fileno())
os.replace(temporary, path)
print('HTTP IP added to both allowlists; other private settings retained.')
PY
unset VEE_CORS_ALLOW_ORIGINS VEE_BROWSER_SESSION_HTTP_ORIGINS VEE_BOOTSTRAP_SCHEMA
export ZEAPLAY_MEDIA_HOST_PATH="$media_dir"
"${dc[@]}" config --quiet
"${dc[@]}" run --rm --no-deps --entrypoint python backend -c 'from app.config import get_settings; s=get_settings(); o="http://167.86.108.178:6300"; assert s.environment=="production" and o in s.cors_allow_origins and o in s.browser_session_http_origins; print("HTTP IP configuration: PASS")'
docker stop zeaplay_backend
if ! docker cp zeaplay_backend:/app/media/. "$media_dir/"; then
  docker start zeaplay_backend
  printf 'Media copy failed; original backend restarted. Do not recreate it.\n' >&2
  exit 1
fi
dc+=(-f ops/deploy/task-journey-media.compose.yml)
"${dc[@]}" config --quiet
"${dc[@]}" up -d --no-deps backend
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6311/health
docker restart zeaplay_frontend
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6300/api/health
python3 ops/verify-browser-session.py --base http://167.86.108.178:6300
printf '\nLogin repair verified. Keep -f ops/deploy/task-journey-media.compose.yml in future deployment commands.\n'
