#!/usr/bin/env bash
# Existing production stack only; --prepare-proxy attaches NPM without a restart.
set -euo pipefail
umask 077
cd /opt/ideashop-zeaplay
mode=${1:---apply}
case "$mode" in --prepare-proxy|--apply) ;; *) printf 'Use --prepare-proxy or --apply\n' >&2; exit 1;; esac
command -v python3 >/dev/null
project=$(docker inspect zeaplay_backend --format '{{index .Config.Labels "com.docker.compose.project"}}')
test -n "$project"
app_network=${ZEAPLAY_APP_NETWORK:-${project}_default}
npm_container=${ZEAPLAY_NPM_CONTAINER:-nginx-proxy-npm-1}
docker network inspect "$app_network" >/dev/null
docker inspect "$npm_container" >/dev/null
for service in zeaplay_backend zeaplay_frontend; do
  ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$app_network\"}}{{.IPAddress}}{{end}}" "$service")
  test -n "$ip"
done
npm_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$app_network\"}}{{.IPAddress}}{{end}}" "$npm_container")
if [ -z "$npm_ip" ]; then
  docker network connect "$app_network" "$npm_container"
  npm_ip=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$app_network\"}}{{.IPAddress}}{{end}}" "$npm_container")
fi
subnet=$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$app_network")
printf 'NPM: create two HTTPS Proxy Hosts: ideashop.zeacrm.com and api.ideashop.zeacrm.com\nBoth upstreams: http://zeaplay_frontend:80; Websockets ON, valid certificates, Force SSL ON.\n'
printf 'Keep NPM attached to existing network %s in its own deployment configuration.\n' "$app_network"
if [ "$mode" = --prepare-proxy ]; then exit 0; fi

# Stop before changing private settings or services if either TLS host is not ready.
for host in ideashop.zeacrm.com api.ideashop.zeacrm.com; do
  if ! curl --fail --silent --show-error --max-time 15 "https://$host/api/health" >/dev/null; then
    printf 'Configure the two NPM hosts/certificates first, then rerun --apply. No application settings changed.\n' >&2
    exit 1
  fi
done
media_root=$(docker exec zeaplay_backend python -c 'from pathlib import Path; from app.config import get_settings; print(Path(get_settings().media_root).resolve())')
mount_type=$(docker inspect zeaplay_backend --format '{{range .Mounts}}{{if eq .Destination "/app/media"}}{{.Type}}{{end}}{{end}}')
media_path=$(docker inspect zeaplay_backend --format '{{range .Mounts}}{{if eq .Destination "/app/media"}}{{.Source}}{{end}}{{end}}')
if [ "$media_root" != /app/media ] || [ "$mount_type" != bind ] || [ ! -d "$media_path" ]; then
  printf 'Retain/preserve the current media mount before domain deployment; see docs/live-domains/README.md. No application settings changed.\n' >&2
  exit 1
fi
backup=$(mktemp -d /root/zeaplay-live-domains.XXXXXXXX)
cp .env.production "$backup/environment.before"
for service in zeaplay_backend zeaplay_frontend zeaplay_presence; do
  image=$(docker inspect "$service" --format '{{.Image}}')
  docker image tag "$image" "$service:before-domains-$(date -u +%Y%m%dT%H%M%SZ)"
  printf '%s %s\n' "$service" "$image" >> "$backup/images.before"
done
docker exec zeaplay_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
docker exec -i zeaplay_postgres pg_restore --list < "$backup/database.dump" >/dev/null
printf 'Private backup: %s\n' "$backup"
avatar_type=$(docker inspect zeaplay_backend --format '{{range .Mounts}}{{if eq .Destination "/app/assets/avatars/custom"}}{{.Type}}{{end}}{{end}}')
avatar_path=$(docker inspect zeaplay_backend --format '{{range .Mounts}}{{if eq .Destination "/app/assets/avatars/custom"}}{{.Source}}{{end}}{{end}}')
copy_avatars=false
if [ "$avatar_type" != bind ] || [ ! -d "$avatar_path" ]; then
  avatar_path=$(mktemp -d /opt/zeaplay-avatars.XXXXXXXX)
  if docker exec zeaplay_backend test -d /app/assets/avatars/custom; then copy_avatars=true; fi
fi
python3 ops/configure-live-domains.py --proxy-peer "$npm_ip/32" --backend-subnet "$subnet" --avatar-path "$avatar_path"
# The env file is authoritative; ignore stale exported public settings.
unset API_URL PRESENCE_URL CHAT_URL WS_URL TICKET_CHAT_WS_URL NGINX_TRUSTED_PROXY_CIDRS FORWARDED_ALLOW_IPS
unset VITE_API_URL VITE_API_BASE_URL VITE_PRESENCE_URL VITE_CHAT_URL VITE_WS_URL VITE_TICKET_CHAT_WS_URL
unset VEE_CORS_ALLOW_ORIGINS VEE_BROWSER_SESSION_HTTP_ORIGINS VEE_WEBSOCKET_TRUSTED_ORIGINS
unset VEE_OAUTH_ISSUER VEE_OAUTH_UI_URL VEE_OAUTH_AUDIENCE VEE_PASSWORD_RESET_URL VEE_MEDIA_PUBLIC_BASE VEE_BOOTSTRAP_SCHEMA
unset PRESENCE_CORS_ORIGINS PRESENCE_REQUIRE_ORIGIN PRESENCE_ALLOW_LOCALHOST_ORIGINS PRESENCE_MAX_CONNECTIONS_PER_USER PRESENCE_MAX_TOTAL_CONNECTIONS
export ZEAPLAY_MEDIA_HOST_PATH="$media_path"
export ZEAPLAY_AVATAR_HOST_PATH="$avatar_path"
dc=(docker compose --project-name "$project" --env-file .env.production -f docker-compose.prod.yml -f ops/deploy/live-domains.compose.yml)
"${dc[@]}" config --quiet
"${dc[@]}" build backend frontend presence
"${dc[@]}" run --rm -T --no-deps --entrypoint python backend - <<'PY'
import os
from sqlalchemy import inspect
from app.config import get_settings
from app.database import engine
from app import oauth_models as m
s = get_settings()
assert s.environment == 'production'
assert s.oauth_issuer == 'https://api.ideashop.zeacrm.com/api/oauth2'
assert s.oauth_ui_url == 'https://ideashop.zeacrm.com/#/oauth/authorize'
assert s.browser_session_http_origins == []
assert (os.environ.get('PRESENCE_JWT_SECRET') == s.jwt_secret_key
        and (os.environ.get('PRESENCE_JWT_ALGORITHM') or 'HS256') == s.jwt_algorithm), (
    'Presence signing configuration must match the existing API signing configuration; no keys printed')
required = {c.__tablename__ for c in [m.OAuthClient, m.OAuthCode, m.OAuthGrant, m.OAuthToken,
                                    m.OAuthConsent, m.OAuthRateLimit, m.OAuthEvent, m.BrowserSession]}
assert required <= set(inspect(engine).get_table_names()), (
    'OAuth storage is incomplete; review docs/oauth/deployment.md before deployment')
print('Live domain configuration and OAuth storage: PASS')
PY
if [ "$copy_avatars" = true ]; then
  docker stop zeaplay_backend
  if ! docker cp zeaplay_backend:/app/assets/avatars/custom/. "$avatar_path/"; then
    docker start zeaplay_backend
    printf 'Custom-avatar copy failed; original backend restarted.\n' >&2
    exit 1
  fi
fi
"${dc[@]}" up -d --no-deps backend presence
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6311/ready
"${dc[@]}" up -d --no-deps frontend
for host in ideashop.zeacrm.com api.ideashop.zeacrm.com; do
  curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 "https://$host/api/health"
done
python3 ops/verify-live-domains.py
printf 'Keep -f ops/deploy/live-domains.compose.yml in all later Compose up operations.\n'
