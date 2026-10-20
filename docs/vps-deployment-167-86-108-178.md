# VPS Deployment Runbook - 167.86.108.178

This runbook deploys the current GitHub project to the VPS at `167.86.108.178` using Docker Compose.

## Local Push

Run these commands on your local machine from the project root.

```powershell
cd F:\Projects\ideashop-zeaplay-v5
git status
git add -- .env.production.example docker-compose.prod.yml backend/app/config.py backend/app/main.py docs/vps-deployment-167-86-108-178.md
git commit -m "Prepare VPS deployment for 167.86.108.178"
git push origin main
```

If you also want to publish current frontend work already in your working tree, stage those files explicitly in the same commit:

```powershell
git add -- frontend/index.css frontend/pages/Logs.tsx frontend/test/audit-logs-redesign.test.ts
git commit -m "Prepare VPS deployment for 167.86.108.178"
git push origin main
```

## First-Time Server Setup

Connect to the VPS.

```bash
ssh root@167.86.108.178
```

Install Docker, Compose, Git and firewall tooling on Ubuntu.

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

Open the required ports.

```bash
ufw allow OpenSSH
ufw allow 6300/tcp
ufw --force enable
ufw status
```

Clone the project from GitHub.

```bash
mkdir -p /opt
git clone https://github.com/urlprojectsmith/ideashop-zeaplay.git /opt/ideashop-zeaplay
cd /opt/ideashop-zeaplay
git checkout main
```

Create the production environment file.

```bash
cp .env.production.example .env.production
nano .env.production
```

Before starting, replace these values in `.env.production`:

```text
POSTGRES_PASSWORD=change-this
VEE_DATABASE_URL=postgresql+psycopg://vee_user:change-this@postgres:5432/vee_task_manager
VEE_JWT_SECRET_KEY=change-this-to-a-long-random-secret
VEE_JWT_REFRESH_SECRET_KEY=change-this-to-a-different-long-random-secret
PRESENCE_JWT_SECRET=change-this-to-a-long-random-secret
PRESENCE_REQUIRE_ORIGIN=true
PRESENCE_ALLOW_LOCALHOST_ORIGINS=false
PRESENCE_MAX_CONNECTIONS_PER_USER=12
PRESENCE_MAX_TOTAL_CONNECTIONS=10000
VEE_MINIO_ENDPOINT=...
VEE_MINIO_ACCESS_KEY=...
VEE_MINIO_SECRET_KEY=...
VEE_MINIO_PUBLIC_BASE=...
VEE_VAPID_PUBLIC_KEY=...
VEE_VAPID_PRIVATE_KEY=...
VEE_VAPID_SUBJECT=mailto:your-email@example.com
```

Start the app.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Check logs.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f frontend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f presence
```

Smoke test the deployment.

```bash
curl -I http://167.86.108.178:6300
curl http://167.86.108.178:6300/api/health
curl http://127.0.0.1:6311/health
curl http://127.0.0.1:6312/health
```

Expected URLs:

```text
Frontend: http://167.86.108.178:6300
API through frontend proxy: http://167.86.108.178:6300/api
Direct API on the VPS host only: http://127.0.0.1:6311
Presence service on the VPS host only: http://127.0.0.1:6312
```

## Enable browser push notifications

The HTTP IP URL above serves the app, but cannot enable browser push. Browser push
requires a trusted HTTPS origin (localhost is a development exception). See
[MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).
The Enable button also requires valid backend VAPID configuration; HTTPS alone
does not resolve "Server delivery: Setup required".

1. Point the intended frontend domain at this VPS and configure a trusted TLS
   certificate on the reverse proxy. Forward that domain to the frontend on
   `127.0.0.1:6300`, retaining `/api/`, `/socket.io/`, WebSocket upgrades and
   unbuffered `/api/notifications/stream` responses. Open the HTTPS domain in the
   browser after configuring TLS; changing `http` to `https` on port 6300 does not
   configure a certificate.
2. Add the exact HTTPS frontend origin to `VEE_CORS_ALLOW_ORIGINS`,
   `VEE_WEBSOCKET_TRUSTED_ORIGINS`, and `PRESENCE_CORS_ORIGINS` in
   `.env.production`. Keep the relative `/api` and `same-origin` frontend URL
   settings. If password recovery is enabled, also update `VEE_PASSWORD_RESET_URL`
   to that origin plus `/#/reset-password`.
3. Replace the sample VAPID values in `.env.production` with a matching key pair
   and a real contact subject such as `mailto:your-admin@your-domain.example`.
   Reuse an existing valid production pair when available. Do not rotate a valid
   pair on restart: existing subscriptions depend on it.

If this is the initial push setup and no valid pair exists, run this **on the VPS**
from `/opt/ideashop-zeaplay`. It creates a private, Git-ignored file without
printing the keys to the terminal and refuses to overwrite an existing file:

```bash
(
  umask 077
  set -C
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend python - <<'PY' > .env.push.generated
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

def encoded(value):
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

private = ec.generate_private_key(ec.SECP256R1())
public = private.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)
print("VEE_VAPID_PUBLIC_KEY=" + encoded(public))
print("VEE_VAPID_PRIVATE_KEY=" + encoded(private.private_numbers().private_value.to_bytes(32, "big")))
PY
)
```

Use a private editor to copy those two values into `.env.production`, replacing
the placeholders, then set `VEE_VAPID_SUBJECT` to your real contact address.
Keep one definition of each setting. Check for old `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` entries too: those unprefixed environment
variables take precedence over their `VEE_` equivalents. Do not share either
environment file or include keys in screenshots/logs.

After the reviewed backend fix has been deployed and environment settings saved:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --no-deps backend
# Recreate presence only if its allowed origins changed.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps presence
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T -e VEE_BOOTSTRAP_SCHEMA=false backend python - <<'PY'
import json
from app.services.push_service import configuration_status
print(json.dumps(configuration_status()))
PY
```

The diagnostic disables import-time schema helpers and prints only booleans.
All five flags, including `configured` and
`configuration_valid`, must be `true`. A normal `docker compose restart` does not
apply updated environment values; use `up -d` to recreate the service.

Sign in on the HTTPS domain, open **Settings > Push notifications**, select
**Refresh status**, then **Enable this browser** and allow the browser permission.
Verify **Server delivery: Configured**, **Browser permission: Allowed**, and
**This browser: Enabled for your account**. Use **Send test to this browser** and
confirm the notification actually appears. Provider acceptance alone is not proof
of a displayed notification; check browser and OS notification settings if needed.

## Active-work 404 behind the frontend proxy

The read-only live check on 2026-10-20 returned `404` for
`/api/time-entries/work/active` and `401 Not authenticated` for
`/api/api/time-entries/work/active`. Live OpenAPI listed time-entry routes only
under `/api/time-entries`. This identifies a prefix mismatch: frontend nginx
strips the first `/api/`, while the backend had only the prefixed registration.

The fix in `backend/app/main.py` registers time-entry routes both without a prefix
and with the existing `/api` alias, as other API routers already do. Deploy the
reviewed backend change and rebuild/recreate the backend using the command above.
Keep the normal frontend URL `/api/time-entries/work/active`.

Verify without credentials:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6300/api/time-entries/work/active
```

Expected: `401`, proving the route reaches authentication rather than `404`.
After signing in, the same request must return `200`; no active timers is a valid
snapshot with `items: []`. This route defect is separate from HTTPS and VAPID push
configuration. These instructions do not constitute a completed VPS deployment.

## Update Deployment

Use this after pushing a new commit to GitHub.

```bash
ssh root@167.86.108.178
cd /opt/ideashop-zeaplay
git status
git pull origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -I http://167.86.108.178:6300
curl http://167.86.108.178:6300/api/health
curl http://127.0.0.1:6311/health
curl http://127.0.0.1:6312/health
```

## Database Backup

Run this before pulling major changes.

```bash
cd /opt/ideashop-zeaplay
set -a
. ./.env.production
set +a
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backup_$(date +%F_%H%M%S).sql"
ls -lh backup_*.sql
```

## Rollback

Use this if a deployment fails after a pull.

```bash
cd /opt/ideashop-zeaplay
git log --oneline -5
git checkout <previous-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

To return to normal branch tracking after rollback testing:

```bash
git checkout main
git pull origin main
```

## Notes

### Login returns 502 after an update

For the confirmed 2026-10-20 mixed-Compose incident, the backend error changed
from JWT/CORS validation to `failed to resolve host 'postgres'`. The stopped
development `postgres:16-alpine` container had the production volume
`ideashop-zeaplay_postgres_data`, whose `PG_VERSION` was 15. Its logs explicitly
reported an incompatible major version. Restore the PostgreSQL 15 service from
the production Compose file using that existing volume; do not initialize a new
cluster or attempt a major-version upgrade as an outage workaround.

The narrowly scoped [recovery script](../ops/recover-vps-postgres15.sh) checks
the production image/volume, stops backend retries, requires the volume to be
unused, checks disk headroom, takes and validates a private offline backup,
restores production PostgreSQL/Redis, checks existing user/task counts, takes a
logical backup, and finally resumes matching application services. It is for
that verified VPS layout and intentionally fails on other layouts. Local syntax
and disposable-volume backup checks passed; VPS execution remains operator work.
Always include `-f docker-compose.prod.yml --env-file .env.production` for this
deployment. The development file uses PostgreSQL 16 and the same logical volume
name, so selecting it under the production project can reproduce this outage.

A 200 frontend page with 502 from `/api/health`, `/api/ready` and
`/api/auth/login` means nginx cannot reach a healthy API upstream. Inspect
startup before changing the login endpoint or resetting credentials:

```bash
cd /opt/ideashop-zeaplay
docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=80 backend
curl -i --max-time 10 http://127.0.0.1:6311/health
```

Keep log output private and redact credentials before sharing it. Do not print
the resolved Compose environment or the contents of `.env.production`.

The OAuth security refinement adds production startup validation. A deployment
with HTTP entries in `VEE_CORS_ALLOW_ORIGINS`, default/short/shared JWT keys, or
non-HTTPS OAuth issuer/UI URLs can now fail before Uvicorn starts. Only treat
this as the cause when the backend log names the corresponding validation error.
Use explicit origins for the actual HTTPS frontend and independently managed
signing keys. Preserve existing valid keys; changing signing keys invalidates
existing sessions and requires a coordinated change. Keep OAuth issuer/UI blank
until that feature's HTTPS deployment is configured. Setting OAuth blank does
not bypass JWT/CORS production validation.

If the log explicitly says `Production JWT signing keys must be independent,
non-default secrets of at least 32 bytes`, restore an existing valid production
pair if available. Otherwise the following generates a new pair without printing
it, saves a private backup, atomically updates only signing-key entries, and keeps
Presence on the API access-signing key. Run this once on the VPS from the project
directory. Rotation invalidates existing first-party JWT sessions and generated
JWT bearer keys; users must sign in and reissue those keys. It does not change
passwords or business data.

```bash
python3 - <<'PY'
import os, re, secrets, tempfile, time
from pathlib import Path

p = Path('.env.production')
original = p.read_bytes()
backup = p.with_name(p.name + '.before-jwt-' + str(time.time_ns()))
with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
    f.write(original)
text = original.decode('utf-8-sig').replace('\r\n', '\n')
access, refresh = secrets.token_hex(32), secrets.token_hex(32)
for key, value in {'VEE_JWT_SECRET_KEY': access,
                   'VEE_JWT_REFRESH_SECRET_KEY': refresh,
                   'PRESENCE_JWT_SECRET': access}.items():
    pattern = r'(?m)^[ \t]*(?:export[ \t]+)?' + key + r'[ \t]*=.*$'
    text, count = re.subn(pattern, key + '=' + value, text)
    if not count:
        text = text.rstrip('\n') + '\n' + key + '=' + value + '\n'
with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                 dir=p.parent, prefix='.env-jwt-', delete=False) as f:
    f.write(text)
os.replace(f.name, p)
print('Signing keys updated; private backup:', backup.name)
PY

# Shell exports override --env-file: remove stale signing-key overrides.
unset VEE_JWT_SECRET_KEY VEE_JWT_REFRESH_SECRET_KEY PRESENCE_JWT_SECRET

# Configuration-only preflight; does not import database/bootstrap code.
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps --entrypoint python backend -c 'from app.config import get_settings; get_settings(); print("Production settings valid")'
```

Proceed with `up -d --no-deps backend presence` only after the preflight passes.
If it reports HTTPS CORS/OAuth configuration errors next, fix those named settings
for the actual HTTPS deployment first. Then verify direct API health and refresh
frontend nginx as described below. Do not share or commit the backup/key values.

The HTTP IP/port URLs elsewhere in this historical runbook are useful for
reachability checks, but they are not a supported production browser-session or
OAuth origin after the refinement. Complete the actual domain/TLS/proxy setup
described in [OAuth deployment](oauth/deployment.md). Do not switch production
to development mode or weaken the checks to hide a startup error.

After correcting a confirmed backend configuration error:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps backend
curl --fail --show-error --max-time 10 http://127.0.0.1:6311/health
```

If direct API health is 200 but the frontend proxy still returns 502, inspect
frontend errors for an obsolete upstream address or Docker network/DNS failure.
Once the backend is healthy, restarting only frontend nginx refreshes its
startup-time upstream resolution:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart frontend
curl --fail --show-error --max-time 10 http://127.0.0.1:6300/api/health
```

That restart is conditional on the direct-health result; it does not repair a
crashing backend. No schema deletion, database reset or volume removal is needed
to diagnose a 502.

- Do not commit `.env.production`; it contains secrets.
- The Compose file uses `.env.production` by default. For local syntax checks against the sample file, run `ZEAPLAY_ENV_FILE=.env.production.example docker compose --env-file .env.production.example -f docker-compose.prod.yml config`.
- `docker-compose.prod.yml` builds images from the pulled Git checkout, so server updates follow `git pull`.
- The old production worker images were removed from this Compose file because this checkout does not include matching Celery/reporting worker modules.
- Backend `6311` and presence `6312` are bound to `127.0.0.1` in production Compose. Public browser traffic should go through frontend/reverse-proxy routes on `6300`, including `/api/ws/` and `/socket.io/`.
- If you later add a domain and HTTPS, update `.env.production`, `VEE_CORS_ALLOW_ORIGINS`, `PRESENCE_CORS_ORIGINS`, and reverse-proxy rules together.
