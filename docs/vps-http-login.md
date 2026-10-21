# Login at the current HTTP IP URL

**Historical HTTP fallback:** this repair passed on the VPS before the domain
cutover. The new live URLs and HTTPS procedure are in
[the domain runbook](live-domains/README.md). Do not rerun this HTTP helper after
deploying the domain settings.

The current URL is **http://167.86.108.178:6300/**. A domain and Nginx Proxy Manager
are not required for this direct port mapping. The VPS backend starts successfully;
the reported login/session 403 is its production origin policy.

This change adds an explicit, empty-by-default `VEE_BROWSER_SESSION_HTTP_ORIGINS`
allowlist. Each entry must be an exact HTTP IP origin, also listed in CORS.
An exception permits a host-only, HttpOnly, SameSite=Lax cookie over HTTP. HTTP
cookies have a separate name for each origin and cannot replace the protected
`__Host-` HTTPS cookie. Requests still require the exact Origin and browser marker.
Production JWT checks, HTTPS defaults, and OAuth HTTPS requirements remain enabled.
HTTP credentials and sessions are unencrypted; remove the exception when moving to TLS.

## Apply on the VPS

After publishing/pulling the source **and** `ops/apply-http-login.sh`, the complete
procedure below is automated by `bash ops/apply-http-login.sh`. Run it from your
VPS terminal. It backs up private settings/database, preserves the running CORS
entries, adds the exact IP to both lists, builds/validates the backend before
stopping it, copies uploads to a persistent host directory, recreates only the
backend, refreshes nginx's backend address, and runs the credential-free checks.
It stops before making changes for custom media roots. No server execution or
publication of this helper was performed by the agent.

The changed source must first reach `/opt/ideashop-zeaplay` through your normal
release process. No commit, push, remote upload, or VPS deployment was performed
by this work. Do not just set these variables on the old image: it rejects HTTP CORS.

1. From a Bash VPS terminal, verify the new source, select the running project's
   label, and back up the private environment and database:

   ```bash
   cd /opt/ideashop-zeaplay
   set -euo pipefail
   umask 077
   grep -q browser_session_http_origins backend/app/config.py
   PROJECT=$(docker inspect zeaplay_backend --format '{{index .Config.Labels "com.docker.compose.project"}}')
   test -n "$PROJECT"
   dc=(docker compose --project-name "$PROJECT" --env-file .env.production -f docker-compose.prod.yml)
   backup=$(mktemp -d /root/zeaplay-http-login.XXXXXXXX)
   cp .env.production "$backup/environment.before"
   docker inspect zeaplay_backend --format '{{.Image}}' > "$backup/backend-image.before"
   docker image tag "$(cat "$backup/backend-image.before")" "zeaplay-backend:before-http-$(date -u +%Y%m%dT%H%M%SZ)"
   docker exec zeaplay_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
   docker exec -i zeaplay_postgres pg_restore --list < "$backup/database.dump" >/dev/null
   ```

2. Edit `.env.production` with `nano .env.production`. Add the HTTP origin to the
   existing CORS list, preserving the HTTPS entries, and set the HTTP exception:

   ```dotenv
   VEE_BROWSER_SESSION_HTTP_ORIGINS=["http://167.86.108.178:6300"]
   VEE_CORS_ALLOW_ORIGINS=["http://167.86.108.178:6300","https://todoplay.urlfactory.website","https://play.zeacrm.com","https://playapi.zeacrm.com","https://167.86.108.178"]
   VEE_BOOTSTRAP_SCHEMA=false
   ```

   Keep the existing database/Redis URLs, signing keys, credentials, and media
   settings. Bootstrap is disabled here because this VPS database is initialized;
   this repair requires no schema migration.

3. Build and validate the backend configuration before stopping the live process:

   ```bash
   "${dc[@]}" config --quiet
   "${dc[@]}" build backend
   "${dc[@]}" run --rm --no-deps --entrypoint python backend -c 'from app.config import get_settings; s=get_settings(); origin="http://167.86.108.178:6300"; assert s.environment=="production" and origin in s.cors_allow_origins and origin in s.browser_session_http_origins; print("HTTP IP configuration: PASS")'
   ```

4. Preserve uploads before recreating the backend. The base production Compose
   file has no media mount. This copies the current media into a persistent host
   directory and uses the existing opt-in media override. It preserves the original
   mounted volume too, if one was already attached. Confirm the running media root
   is `/app/media` before continuing:

   ```bash
   media_root=$(docker exec zeaplay_backend python -c 'from pathlib import Path; from app.config import get_settings; print(Path(get_settings().media_root).resolve())')
   test "$media_root" = /app/media
   docker stop zeaplay_backend
   media_dir=$(mktemp -d /opt/zeaplay-media.XXXXXXXX)
   docker cp zeaplay_backend:/app/media/. "$media_dir/"
   export ZEAPLAY_MEDIA_HOST_PATH="$media_dir"
   printf 'Persist this in .env.production: ZEAPLAY_MEDIA_HOST_PATH=%s\n' "$media_dir"
   ```

   Set the printed value in `.env.production` using `nano .env.production`.
   If copying fails, start the original container with `docker start zeaplay_backend`
   and resolve the copy failure before recreating it. If the media root is custom,
   retain the existing mount/deployment overrides for that root instead of using
   the `/app/media` override below.

5. Recreate only the backend, verify its direct health, and restart the existing
   frontend so nginx resolves the backend container's current address:

   ```bash
   dc=(docker compose --project-name "$PROJECT" --env-file .env.production -f docker-compose.prod.yml -f ops/deploy/task-journey-media.compose.yml)
   "${dc[@]}" config --quiet
   "${dc[@]}" up -d --no-deps backend
   curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6311/health
   docker restart zeaplay_frontend
   curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6300/api/health
   python3 ops/verify-browser-session.py --base http://167.86.108.178:6300
   ```

   Keep that media override in future Compose commands. PostgreSQL, Redis, presence,
   and other application stacks are not recreated. No volume is deleted.

The credential-free verifier should report `passed: true`: health/schema return
200; anonymous refresh and intentionally invalid login return 401. Then sign in
with your existing account at the HTTP IP URL and reload to verify session restore.
The VPS repair is complete only after these checks pass on that host.

## Local verification

See `browser-session-http-fix/checks/` for the production image build, focused
backend test results, real HTTP integration with disposable PostgreSQL 15/Redis,
and the HTTPS proxy/default-policy regression checks. These use synthetic users
and owned disposable containers, not the local or VPS business databases.

## Move to a domain later

Configure the HTTPS domain/proxy using
[the proxy guide](browser-session-origin-fix/README.md), add the domain to CORS,
and remove the HTTP IP from CORS and `VEE_BROWSER_SESSION_HTTP_ORIGINS` (set it to
`[]`). Recreate the backend with the persistent-media override. Sign in again:
HTTP and HTTPS intentionally use different session cookies. Browser push requires
a secure browser context and remains unavailable at the public HTTP IP address.
