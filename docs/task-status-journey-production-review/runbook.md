# Journey Release and Recovery Runbook

**Not executed against production. Production is NO-GO pending the gates in README.md.** Commands below are for an authorized operator on the Linux VPS, from the approved repository checkout. Use the existing Compose project, private environment, actual HTTPS proxy and approved release commit. Do not copy the example environment into production or publish credentials. Do not use `set -x`, print resolved Compose environment, expose PostgreSQL/Redis ports, run `down -v`, stamp an unknown schema, or downgrade populated history.

## 1. Reproduce Local Validation

Windows PowerShell, repository root; installed backend/frontend dependencies required. Ports 56415 and 56379 must be free. This test-only project uses synthetic accounts, random database schemas and Redis prefixes; never substitute a production URL. PostgreSQL is disposable tmpfs; Redis test DB is 15. The tests intentionally create/drop only owned scratch schemas and a temporary restore database.

```powershell
docker compose -p zeaplay-journey-review -f ops/testing/compose.realtime.yml up -d postgres redis
$env:VEE_BOOTSTRAP_SCHEMA='false'
$env:VEE_DATABASE_URL='sqlite:///'+($env:TEMP -replace '\\','/')+'/zeaplay-journey-global.db'
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
$env:ZEAPLAY_RT_WORKER_POSTGRES_TEST_URL=$env:ZEAPLAY_RT_POSTGRES_TEST_URL
$env:ZEAPLAY_RT_REDIS_TEST_URL='redis://127.0.0.1:56379/15'
$env:ZEAPLAY_RT_BACKUP_CONTAINER='zeaplay-journey-review-postgres-1'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_task_lifecycle.py backend/tests/test_task_lifecycle_review.py backend/tests/test_task_execution_report.py backend/tests/test_task_journey_readiness.py backend/tests/test_task_journey_migrations.py -q -r s
backend/venv/Scripts/python.exe -m pytest backend/tests/test_tasks_phase5.py backend/tests/test_tasks_phase6.py backend/tests/test_tasks_phase7.py backend/tests/test_tasks_phase8.py backend/tests/test_tasks_phase9.py backend/tests/test_tasks_phase10.py backend/tests/test_tasks_phase11.py backend/tests/test_gamification_phase12.py backend/tests/test_security_phase13.py -q
backend/venv/Scripts/python.exe -m pytest backend/tests/test_realtime_processes.py -q -k 'two_process_fanout or tenant_injection or targeted_subscriber'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_task_journey_deployment.py backend/tests/test_realtime_proxy_config.py -q
# After all test processes have exited; do not target the application's Compose project.
docker compose -p zeaplay-journey-review -f ops/testing/compose.realtime.yml down
```

Run frontend commands sequentially from `frontend`: `npm test`, `npx tsc --noEmit --pretty false`, `npm run build`. Record exit codes; TypeScript currently fails with the documented 131 existing diagnostics. No configured lint script exists.

For the browser harness, run a loopback-only Vite server (`npm run dev -- --host 127.0.0.1 --port 6302 --strictPort`); reuse an existing server rather than replacing it. Set `ZEAPLAY_PLAYWRIGHT_MODULE` to an **installed** Playwright `index.mjs` and `ZEAPLAY_JOURNEY_OUTPUT=../../docs/task-status-journey-production-review/checks/`; run `node frontend/e2e/task-journey.mjs` from the root. This harness intercepts business APIs and is not live-provider/full-stack E2E proof.

Offline SQL inspection, from `backend` with the safe local test environment above:

```powershell
venv/Scripts/python.exe -m alembic heads
venv/Scripts/python.exe -m alembic upgrade fc4d5e6f7a8b:fd5e6f7a8b9c --sql
```

The checked-in `migration-upgrade-transcript.txt` is a captured console transcript, **not executable SQL**. The automated migration test executes real online Alembic commands. Its predecessor stamp is confined to an owned synthetic schema and is not a production procedure.

## 2. Approval and Staging Gates

- Review the exact committed change set. This checkout contains unrelated/uncommitted phase work; do not blindly stage or publish all files. Use an approved clean release checkout, record its commit and reproducible image IDs, run Linux/Python 3.11 CI and resolve/disposition the typecheck failures.
- Restore an approved **actual** database backup into isolated PostgreSQL 15 using matching extensions and least-privilege roles. Supply a separate private staging env file whose URLs cannot reach production. Restore media/provider objects too, with customer notifications/integrations disabled. An empty-media staging test cannot certify evidence preservation.
- Inspect actual `alembic_version`. Only the lifecycle transition **fc4d5e6f7a8b -> fd5e6f7a8b9c** was rehearsed here. If behind fc, missing version metadata, or schema differs, stop and rehearse every pending migration on the restored backup. Never solve this by `alembic stamp head`.
- Reconcile complete users/rewards/claims/tasks/subtasks, balances/counters/claim statuses and file checksums before/after. Retained time entries gain nullable columns only; there must be no historical lifecycle event backfill. Run actual role/tenant, evidence, timer, reopen, task/XP/reward and browser/backend E2E acceptance tests.
- Measure migration lock time on real table sizes and a safe staging workload. Nullable additions and regular indexes/triggers still take locks; use a maintenance window, drain **all** writers and one migration runner. Do not scale workers or change realtime outbox mode as part of this release.
- Verify TLS/WSS on the already approved public origin, reverse-proxy upload/timeouts, provider ACLs/revocation and private media recovery. Existing publicly shared legacy objects must be remediated separately.

## 3. Prepare an Approved Release

Linux Bash examples below. These commands build/tag local images, but do not deploy until section 5. Use the existing private `.env.production`; it must explicitly set **`VEE_BOOTSTRAP_SCHEMA=false`**. The example file still defaults to true and is not safe as an unreviewed production configuration. Do not auto-run seed/bootstrap on scaled workers. Runtime database role should not own schema/disable triggers; use separately approved migration credentials where required.

```bash
set -euo pipefail
umask 077
# cd to the approved Linux checkout first; fetch/pull only the reviewed branch.
test -z "$(git status --porcelain)" || { echo 'Stop: dirty release checkout'; exit 1; }
git pull --ff-only
RELEASE_ID="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
export ZEAPLAY_ENV_FILE="$PWD/.env.production"
test -f "$ZEAPLAY_ENV_FILE"
export COMPOSE_PROJECT_NAME="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' zeaplay_backend)"
test -n "$COMPOSE_PROJECT_NAME"
BASE=(docker compose --env-file "$ZEAPLAY_ENV_FILE" -f docker-compose.prod.yml)
BACKEND_CID="$("${BASE[@]}" ps -q backend)"
FRONTEND_CID="$("${BASE[@]}" ps -q frontend)"
test -n "$BACKEND_CID" && test -n "$FRONTEND_CID"
MEDIA_IN_CONTAINER="$(docker exec "$BACKEND_CID" python -c 'from pathlib import Path; from app.config import get_settings; print(Path(get_settings().media_root).resolve())')"
test -n "$MEDIA_IN_CONTAINER"
OLD_BACKEND="zeaplay/backend:pre-journey-$RELEASE_ID"
OLD_FRONTEND="zeaplay/frontend:pre-journey-$RELEASE_ID"
docker image tag "$(docker inspect --format '{{.Image}}' "$BACKEND_CID")" "$OLD_BACKEND"
docker image tag "$(docker inspect --format '{{.Image}}' "$FRONTEND_CID")" "$OLD_FRONTEND"
export ZEAPLAY_BACKEND_RELEASE_IMAGE="zeaplay/backend:journey-$RELEASE_ID"
export ZEAPLAY_FRONTEND_RELEASE_IMAGE="zeaplay/frontend:journey-$RELEASE_ID"
# Set this to the approved persistent host location. Never mount an unverified empty directory.
export ZEAPLAY_MEDIA_HOST_PATH=/srv/zeaplay/media
DC=("${BASE[@]}" -f ops/deploy/task-journey-media.compose.yml -f ops/deploy/task-journey-images.compose.yml)
"${DC[@]}" config --quiet
"${DC[@]}" build backend frontend
```

Record image IDs/tags, previous env/config, Compose project, media path, approved commit and rollback approval in a restricted release record. A git pull is not a readiness check; verify the fetched commit is the one approved. If a registry is used, pin approved digests and retain the rollback images there. No image build or provider credential validation was done by this local review.

## 4. Consistent Backup and Media Adoption

Enter the **existing** maintenance mode at the outer proxy first, preventing new uploads/timer/status writes and background integrations. There is no new maintenance route. Drain open requests and stop all API/background writers, including separately managed workers. Stop the relay only if that profile is in use. Never stop/delete PostgreSQL or its volume for this procedure.

```bash
BACKUP_DIR="/srv/zeaplay-backups/$RELEASE_ID"
install -d -m 0700 "$BACKUP_DIR"
"${BASE[@]}" stop frontend backend
# If already enabled in this deployment:
# "${BASE[@]}" --profile realtime-outbox stop realtime-relay
"${BASE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$BACKUP_DIR/database.dump"
"${BASE[@]}" exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-toc.txt"
mkdir "$BACKUP_DIR/media"
# Include ALL existing media, especially private/completion-evidence, not just uploads.
docker cp "$BACKEND_CID:$MEDIA_IN_CONTAINER/." "$BACKUP_DIR/media/"
tar -C "$BACKUP_DIR" -czf "$BACKUP_DIR/media.tar.gz" media
(cd "$BACKUP_DIR" && sha256sum database.dump media.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
```

If media_root does not exist, do not ignore `docker cp` failure: establish whether there really is no evidence or storage is elsewhere. An absent directory on a deployment with completion attachment rows is an incident. Remote objects need the provider's versioned/private backup procedure, not just this local archive.

For **first adoption only**, create the host path and copy the verified snapshot; if it already contains files or is already mounted, stop and reconcile instead of overwriting it:

```bash
install -d -m 0700 "$ZEAPLAY_MEDIA_HOST_PATH"
test -z "$(find "$ZEAPLAY_MEDIA_HOST_PATH" -mindepth 1 -print -quit)" || { echo 'Stop: reconcile existing media directory'; exit 1; }
cp -a "$BACKUP_DIR/media/." "$ZEAPLAY_MEDIA_HOST_PATH/"
diff -qr "$BACKUP_DIR/media" "$ZEAPLAY_MEDIA_HOST_PATH"
```

Set host ownership/permissions for the approved image's actual runtime UID, not arbitrary world-readable permissions. The current Dockerfile inherits root; changing to non-root needs a separate tested permissions plan. Thereafter **every** backend up/run command must include the media override and the same verified path. Preserve/backup the private env file separately; do not put it in images, public docs or media directories.

Before migration, restore the dump and media on an isolated staging host and test a real authorized download; a TOC listing/checksum alone is **not** a restore test. These operations must have passed before production approval. Keep the old stopped backend container until the media backup/adoption is verified.

## 5. Controlled Migration and Deployment

The following is an **authorized maintenance-window procedure only**, after all gates pass. Keep migration/bootstrap credentials private. `--no-deps` prevents accidental infrastructure restarts. A private env configuration must point to the existing production database, not the local test services.

```bash
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic current
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic heads
# Stop unless current is the verified fc predecessor or fd already applied.
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic upgrade fd5e6f7a8b9c
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic current
"${BASE[@]}" exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT version_num FROM alembic_version;
SELECT id, started_at FROM task_lifecycle_coverage;
SELECT tgrelid::regclass, tgname FROM pg_trigger
 WHERE NOT tgisinternal AND tgname LIKE 'zea_lifecycle_%' ORDER BY 1, 2;
SELECT count(*) AS users, sum(points) AS spendable_xp FROM users;
SELECT status, count(*), sum(xp_spent) FROM reward_claims GROUP BY status;
SELECT count(*) AS tasks, count(*) FILTER (WHERE project_id IS NULL) AS legacy_tasks FROM tasks;
SELECT count(*) AS subtasks, count(*) FILTER (WHERE completed) AS completed_subtasks FROM subtasks;
SQL
"${DC[@]}" up -d --no-build --no-deps backend
curl --fail --silent --show-error http://127.0.0.1:6311/health
curl --fail --silent --show-error http://127.0.0.1:6311/ready
# If the relay was already enabled, restart it with the same existing mode, not a new category configuration.
# "${DC[@]}" --profile realtime-outbox up -d --no-build --no-deps realtime-relay
"${DC[@]}" up -d --no-build --no-deps frontend
curl --fail --silent --show-error http://127.0.0.1:6300/api/health
```

Compare database aggregates and full preserved-record snapshots with the approved pre-migration backup, not with invented expected totals. Verify new capture triggers plus authenticated Journey/report requests; `/ready` alone cannot prove the lifecycle migration. Verify unauthorized requests, active timers, one complete/reopen/deployed cycle, distinct managers, each authorized file target/preview/download, revoked access, actual realtime invalidation and report navigation through the existing public HTTPS origin before ending maintenance. Do not log bearer tokens or evidence contents. Watch database locks, errors, pool waits, disk, Redis recovery and outbox lag during the window. Do not seed/reset balances.

The relay profile uses a separate backend build image in the existing Compose file; if used, build/pin that approved image before this window (`"${BASE[@]}" --profile realtime-outbox build realtime-relay`). It does not require local media mounts. Record/reuse its old image as well for rollback; never change its mode implicitly. Existing production topology may have external workers/proxies: inventory them first, do not assume these Compose commands cover them.

## 6. Rollback / Forward-Fix Decision

| Situation | Action |
| --- | --- |
| UI-only regression; API/history healthy | Roll back only frontend image, retain hardened backend/schema/private media, then forward-fix UI. |
| Additive migration fails before commit | Keep maintenance; inspect database version/DDL/locks. PostgreSQL supports transactional DDL here. Do not blindly stamp/retry or drop tables. Resume old code only after confirming actual state. |
| Backend regression after migration, no data loss | Prefer forward-fix. Approved compatible backend rollback may keep fd schema/triggers; test old code against it first. |
| History exists | **Do not downgrade fd.** Online downgrade deliberately refuses to delete it. Retain schema and rollback only compatible code. |
| Empty history and no new data, extraordinary schema rollback | Restore-first rehearsal and explicit approval required. `alembic downgrade fc4d5e6f7a8b` takes exclusive writer locks and only succeeds with empty history. Not the normal production rollback. |
| Corruption/loss or unsafe migration of older revisions | Incident recovery into a separate database + matching media snapshot; reconcile post-backup writes before approved switch. Never overwrite/wipe the only production copy. |

UI rollback using the tags recorded in section 3, while keeping the current schema/backend and media override:

```bash
export ZEAPLAY_FRONTEND_RELEASE_IMAGE="$OLD_FRONTEND"
"${DC[@]}" up -d --no-build --no-deps frontend
```

Backend fallback additionally sets `ZEAPLAY_BACKEND_RELEASE_IMAGE="$OLD_BACKEND"` and restarts only backend after approval/compatibility rehearsal. **The pre-fix image may reintroduce metadata exposure**, so do not treat image rollback as security approval. Retain the metadata/path hardening in any approved fallback. Restore any previously running relay using its recorded compatible image/config. Do not remove the persistent media override or change secrets/tenant settings during rollback. Recheck health, auth, ledger writes, timers and file access after either rollback.

## 7. Isolated Disaster Recovery Rehearsal

On a **separate, explicitly disposable PostgreSQL restore container** (never `zeaplay_postgres`), with operator-selected restore name/user/database. Do not supply production connection strings to test scripts. Use approved encrypted transfer and restricted storage for the backup.

```bash
: "${RESTORE_CONTAINER:?Set the isolated restore container name}"
: "${RESTORE_USER:?Set the isolated database owner}"
: "${RESTORE_DB:?Set an isolated database name}"
test "$RESTORE_CONTAINER" != zeaplay_postgres
test "$(docker inspect --format '{{.Id}}' "$RESTORE_CONTAINER")" != "$("${BASE[@]}" ps -q postgres | xargs docker inspect --format '{{.Id}}')"
docker exec "$RESTORE_CONTAINER" createdb -U "$RESTORE_USER" "$RESTORE_DB"
# createdb must fail if the database already exists; do not drop it to force progress.
# Prepare any required cluster roles/extensions using the restore's least-privilege plan.
docker exec -i "$RESTORE_CONTAINER" pg_restore --exit-on-error --no-owner --no-acl -U "$RESTORE_USER" -d "$RESTORE_DB" < "$BACKUP_DIR/database.dump"
```

Restore media to a **separate recovery directory**, verify archive hashes and file checksums, and point an isolated backend at that database/directory with production notifications/integrations disabled. Check complete record/balance equality, migration revision, capture trigger existence and an actual private-file download. Measure restore time and document RPO/RTO; no RPO/RTO has been measured by this review. Account for missing remote objects and post-backup uploads/XP/claims before any approved endpoint/database switch. An old database plus newer media, or vice versa, is not a consistent recovery. Recovery is never permission to discard audit/XP/reward history.
