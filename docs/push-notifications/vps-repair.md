# VPS push setup repair

The 21 October 2026 VPS failure had two separate causes:

- `/sw.js` was mode `0600`, owned by root. Nginx's worker could not read it and
  returned 403. This was confirmed by `Permission denied` in its error log.
- VAPID fields were present, but backend signing validation returned
  `configuration_valid: false`. A present public key is insufficient to enable push.

## Immediate worker repair

Run on the VPS:

```bash
docker exec zeaplay_frontend chmod 644 /usr/share/nginx/html/sw.js
curl -fsSI https://ideashop.zeacrm.com/sw.js
```

Expect 200 and a JavaScript content type. Refresh Settings > Push notifications.
Keep **Cache Assets off** for the frontend host in Nginx Proxy Manager; its asset
cache can override the gateway's worker/runtime revalidation headers.

The source fix normalizes public directories to `0755` and files to `0644` when
building the frontend image. Only `/usr/share/nginx/html` is changed. `/sw.js` has
an exact Nginx location with revalidation and a 404 for a missing file, so it
cannot silently return the application's HTML. A container chmod alone is lost
when that container is replaced.

## Persist valid VAPID settings and deploy the permanent worker fix

Commit and push the repair source through the normal release process before
pulling it on the VPS. The helper must exist in that published revision.

Run this Bash block on the VPS:

```bash
(
set -e
cd /opt/ideashop-zeaplay
git fetch origin
git switch main
git pull --ff-only origin main
test -f ops/configure-vps-push.py

python3 ops/configure-vps-push.py --apply

# Prevent stale shell exports from overriding the repaired environment file.
unset VEE_VAPID_PUBLIC_KEY VEE_VAPID_PRIVATE_KEY VEE_VAPID_SUBJECT
unset VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT

push_project=$(docker inspect zeaplay_backend --format '{{index .Config.Labels "com.docker.compose.project"}}')
test -n "$push_project"
push_compose=(docker compose -p "$push_project" --env-file .env.production -f docker-compose.prod.yml -f ops/deploy/live-domains.compose.yml)
"${push_compose[@]}" build frontend
"${push_compose[@]}" up -d --no-deps backend
curl --fail --retry 15 --retry-all-errors --retry-delay 2 --max-time 5 http://127.0.0.1:6311/ready
"${push_compose[@]}" up -d --no-deps frontend
)
```

This uses the existing HTTPS deployment, including its media/avatar mounts. It
does not recreate PostgreSQL or Redis, run migrations, or send notifications.

`configure-vps-push.py` validates candidate material using the backend's installed
push library and a local signature. It preserves a valid persisted or running
key pair, repairs only the subject when possible, and generates a new matching
pair only when neither existing pair validates. A second invocation preserves
the saved pair even before the backend is recreated. The fallback subject is
`https://ideashop.zeacrm.com`.

Both VAPID environment aliases are synchronized so a legacy value cannot take
precedence. Other environment settings remain intact. The original file is
backed up and the replacement is written atomically, both with mode `0600`.
Console output contains only status, action and backup path. A preview without
`--apply` does not write anything. Multiline quoted VAPID definitions require
manual review and stop the helper before any file is changed.

## Verify without sending a push

```bash
docker exec zeaplay_backend python -c 'import json; from app.services.push_service import configuration_status; print(json.dumps(configuration_status(), indent=2))'
curl -fsSI https://ideashop.zeacrm.com/sw.js
python3 ops/verify-live-domains.py
```

Expect every configuration flag to be true, worker HTTP 200 with JavaScript MIME
and `Cache-Control: no-cache`, and domain verification `passed: true`. After a
frontend replacement, if NPM temporarily keeps the old upstream address, save
the frontend Proxy Host again to reload its upstream resolution.

Hard refresh the site, open Push notifications, select **Enable this browser**,
and allow the browser permission prompt. Account subscription, provider acceptance
and physical OS notification display are separate checks. This repair does not
certify provider-to-device delivery; send a test only when deliberately requested
for the signed-in user's browser.
