# Production browser-session 403 repair

Live diagnosis on 21 October 2026:

| Public entry point | Health | Documented API paths | Session refresh |
| --- | --- | --- | --- |
| `http://167.86.108.178:6300` | 200 | 522, including browser sessions | 403: origin rejected |
| `https://todoplay.urlfactory.website` | 200 | 393, no browser-session routes | 404: route missing |

The HTTPS proxy currently reaches a different/stale backend. The HTTP IP origin is intentionally absent from production's HTTPS origin allowlist. Supplying the approved HTTPS Origin to the HTTP endpoint gets a second rejection: `400 HTTPS is required for browser sessions`. Adding the HTTP IP to CORS is not a working repair.

The production login URL is **https://todoplay.urlfactory.website** after repairing the proxy target and deploying these files. SSH port 22 refused the connection, so no VPS configuration was changed by this work.

## Source repair and verification

- The frontend now preserves `X-Forwarded-Proto: https` only when the request peer matches explicitly configured `NGINX_TRUSTED_PROXY_CIDRS`. The default trusts no peers. Public clients cannot assert HTTPS by setting this header themselves.
- Production Compose exposes Uvicorn's `FORWARDED_ALLOW_IPS` setting, defaulting to loopback. Set this to the private application Docker network so Uvicorn accepts the frontend proxy's scheme.
- A new LF-only Docker entrypoint generates nginx's trusted-peer list and rejects invalid/injected entries and `/0` networks.
- Corrected the three login background imports to use the existing `frontend/images/` files. Their previous locations had been removed, causing the image build to fail.
- **PASS:** complete frontend image build; all **129 frontend tests**; **4 focused backend/proxy regressions**; **10 real nginx → Uvicorn → production browser-session guard tests** and **4 proxy configuration checks**. These verify trusted HTTPS, plain HTTP rejection, foreign-origin rejection, malformed headers, untrusted peers, bounded peer lists, universal-trust rejection, and directive-injection rejection. No real user credentials are used.
- Existing Node 18 dependency engine/deprecation warnings remain in the image build log; the final build succeeds.

## Nginx Proxy Manager settings

Use the current application frontend container as the upstream, rather than the old backend or frontend currently selected by the domain. The example below uses the production container names from `docker-compose.prod.yml` and the existing `ideashop-zeaplay` project. Confirm these names on the VPS before executing commands.

1. Identify the Nginx Proxy Manager container with `docker ps --format '{{.Names}} {{.Image}}'`.
2. Connect it to the **existing** application network, if it is not already connected. This allows NPM to reach the frontend by its container name:

   ```bash
   APP_NETWORK=ideashop-zeaplay_default
   NPM_CONTAINER=your_existing_npm_container_name
   docker network inspect "$APP_NETWORK" >/dev/null
   docker inspect zeaplay_frontend >/dev/null
   docker inspect zeaplay_backend >/dev/null
   docker network connect "$APP_NETWORK" "$NPM_CONTAINER"
   ```

   Skip `network connect` if NPM is already a member. Keep this network attachment in NPM's own deployment configuration so it survives replacement of that container. Do not create a new PostgreSQL network/project or run the development Compose file on this server.

3. In **Proxy Hosts → todoplay.urlfactory.website → Edit**, use:

   | Field | Value |
   | --- | --- |
   | Domain | `todoplay.urlfactory.website` |
   | Scheme | `http` (the private upstream hop) |
   | Forward hostname | `zeaplay_frontend` |
   | Forward port | `80` |
   | Websocket support | On |
   | SSL certificate | The valid certificate for this domain |
   | Force SSL | On |

   Remove or correct any **Custom Location** for `/api/` that still forwards to the old stack. Keep NPM's standard Host, Origin, X-Forwarded-Proto, and X-Forwarded-For forwarding. Save the host after the deployment below is ready.

## Trust the actual proxy addresses

On the VPS, from `/opt/ideashop-zeaplay`, after the corrected source files have been transferred through your normal release process:

```bash
# Use the same APP_NETWORK and NPM_CONTAINER chosen above.
NPM_IP=$(docker inspect --format "{{with index .NetworkSettings.Networks \"$APP_NETWORK\"}}{{.IPAddress}}{{end}}" "$NPM_CONTAINER")
APP_SUBNET=$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$APP_NETWORK")
test -n "$NPM_IP"
test -n "$APP_SUBNET"
printf 'NGINX_TRUSTED_PROXY_CIDRS=%s/32\nFORWARDED_ALLOW_IPS=%s\n' "$NPM_IP" "$APP_SUBNET"
```

Set the two printed values in the private `.env.production`. These are network addresses, not JWT/password values. Keep `VEE_CORS_ALLOW_ORIGINS` as explicit HTTPS origins including `https://todoplay.urlfactory.website`, and retain `/api` for both frontend API variables. Never use `*`, `0.0.0.0/0`, or `::/0` as proxy trust. If NPM's container IP changes later, regenerate the first setting and recreate the frontend.

## Deploy with the current database and uploads preserved

The source changes are local and have not been pushed or deployed. Transfer them first. Build only the frontend, using the existing production project:

```bash
cd /opt/ideashop-zeaplay
dc=(docker compose --project-name ideashop-zeaplay --env-file .env.production -f docker-compose.prod.yml)
"${dc[@]}" config --quiet
"${dc[@]}" build frontend
```

Changing backend environment requires recreating its container. The base production Compose file has no backend media mount, so verify/preserve uploads first. Keep any persistent-media override already in use. For the unmounted `/app/media` layout in the base file, this checkpoint creates a private database backup and moves a copy of the current uploads to a persistent host directory:

```bash
umask 077
set -euo pipefail
backup=$(mktemp -d /root/zeaplay-browser-proxy.XXXXXXXX)
cp .env.production "$backup/environment.before"
docker exec zeaplay_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
docker exec -i zeaplay_postgres pg_restore --list < "$backup/database.dump" >/dev/null
docker inspect zeaplay_backend --format '{{range .Mounts}}{{println .Destination .Type}}{{end}}'
```

If `/app/media` is already mounted, retain that deployment's mount and skip the new host-directory setup. Otherwise, after the backup succeeds, stop **only the backend**, copy the upload directory, and retain the existing opt-in media override:

```bash
"${dc[@]}" stop backend
media_dir=$(mktemp -d /opt/zeaplay-media.XXXXXXXX)
docker cp zeaplay_backend:/app/media/. "$media_dir/"
export ZEAPLAY_MEDIA_HOST_PATH="$media_dir"
printf 'ZEAPLAY_MEDIA_HOST_PATH=%s\n' "$media_dir"
```

Persist the printed `ZEAPLAY_MEDIA_HOST_PATH` value in `.env.production` for future deployments. Use the unchanged backend image; no backend source/schema change is required for this repair. If the existing database is already initialized, keep schema bootstrap disabled (`VEE_BOOTSTRAP_SCHEMA=false`) during this configuration restart. Then use the media override for **all** subsequent up operations:

```bash
dc=(docker compose --project-name ideashop-zeaplay --env-file .env.production -f docker-compose.prod.yml -f ops/deploy/task-journey-media.compose.yml)
"${dc[@]}" config --quiet
"${dc[@]}" up -d --no-deps backend
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6311/health
"${dc[@]}" up -d --no-deps frontend
```

Use the actual media path if your deployment overrides `/app/media`; inspect the existing backend settings before copying. This procedure does not recreate PostgreSQL, change database majors, apply migrations, or delete volumes.

## Verify through NPM

After saving the NPM host, run from the checkout on the VPS (or from a machine with Python):

```bash
python3 ops/verify-browser-session.py --base https://todoplay.urlfactory.website
```

Expected: health/schema **200**, both browser-session routes present in OpenAPI, anonymous refresh **401**, and synthetic invalid login **401**. A 401 here proves the request reached authentication; no cookie or valid password was supplied. **403** indicates an origin mismatch, **400** indicates an untrusted/lost HTTPS scheme, and **404** indicates a stale/different upstream. Then open the HTTPS domain and sign in with your existing account.

Actual successful sign-in and cookie restoration on the VPS remain unverified until this deployment is applied. Evidence is in `checks/vps-http.json`, `checks/vps-https.json`, `checks/local.json`, and `checks/proxy-chain.json`.
