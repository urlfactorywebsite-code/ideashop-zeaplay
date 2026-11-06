#!/usr/bin/env bash
# Uses the exact running backend image/environment; never builds/pulls/stamps.
set -euo pipefail
umask 077
backend_container=${STATUS_BACKEND_CONTAINER:-zeaplay_backend}
postgres_container=${STATUS_POSTGRES_CONTAINER:-zeaplay_postgres}
presence_container=${STATUS_PRESENCE_CONTAINER:-zeaplay_presence}
frontend_container=${STATUS_FRONTEND_CONTAINER:-zeaplay_frontend}
backup_root=${STATUS_BACKUP_ROOT:-/root}
ready_url=${STATUS_READY_URL:-http://127.0.0.1:6311/ready}
python_bin=${STATUS_PYTHON:-python3}
for service_container in "$backend_container" "$presence_container"; do
  test "$(docker inspect --format '{{.HostConfig.AutoRemove}}' "$service_container")" = false
  test "$(docker inspect --format '{{.State.Running}}' "$service_container")" = true
done
helper="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/repair_partial_status_schema.py"
if [[ ! -f "$helper" ]]; then
  helper="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../backend/scripts" && pwd)/repair_partial_status_schema.py"
fi
test -f "$helper"
mount_helper=$helper
if command -v cygpath >/dev/null 2>&1; then
  mount_helper=$(cygpath -m "$helper")
fi
image=$(docker inspect --format '{{.Image}}' "$backend_container")
network=$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$backend_container" | "$python_bin" -c 'import json,sys; names=list(json.load(sys.stdin)); assert len(names)==1, "Expected one backend network"; print(names[0])')
# Keep credentials in a pipe/shell variable; do not print or persist them.
environment_json=$(docker inspect --format '{{json .Config.Env}}' "$backend_container" | "$python_bin" -c 'import json,sys; print(json.dumps(dict(entry.split("=",1) for entry in json.load(sys.stdin))))')
database=$(docker exec "$postgres_container" sh -c 'printf "%s" "$POSTGRES_DB"')
docker exec -e VEE_BOOTSTRAP_SCHEMA=false "$backend_container" python -c 'import sys; from app.config import get_settings; from sqlalchemy.engine import make_url; u=make_url(get_settings().database_url); assert u.host in {"postgres","zeaplay_postgres"} and u.database==sys.argv[1], "Backup target differs from backend"' "$database"
run_repair() {
  docker run --rm -i --network "$network" \
    --mount "type=bind,src=$mount_helper,dst=/repair.py,readonly" \
    --entrypoint python "$image" -c 'import json,os,runpy,sys; os.environ.update(json.load(sys.stdin)); os.environ["VEE_BOOTSTRAP_SCHEMA"]="false"; sys.argv=["/repair.py"]+sys.argv[1:]; runpy.run_path("/repair.py",run_name="__main__")' "$@" <<< "$environment_json"
}
run_repair
if [[ "${1:-}" != "--apply" ]]; then
  printf 'Read-only preflight completed. Run this file with --apply for backup, restore rehearsal and repair.\n'
  exit 0
fi
backup=$(mktemp -d "$backup_root/zeaplay-status-repair.XXXXXXXX")
rehearsal="zea_status_rehearsal_$(date -u +%Y%m%d%H%M%S)_$$"
stopped=false
finished=false
on_exit() {
  if [[ "$stopped" == true && "$finished" != true ]]; then
    printf '\nRecovery did not finish. Inspect backend/presence state before resuming writers. Backup and logs: %s\n' "$backup" >&2
    printf 'Restored rehearsal database (if created): %s\n' "$rehearsal" >&2
  fi
}
trap on_exit EXIT
stopped=true
docker stop --time 30 "$backend_container" "$presence_container" >/dev/null
docker exec "$postgres_container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
test -s "$backup/database.dump"
docker exec -i "$postgres_container" pg_restore --list < "$backup/database.dump" > "$backup/database.list"
printf 'Verified backup archive: %s/database.dump\n' "$backup"
docker exec "$postgres_container" sh -c 'exec createdb -U "$POSTGRES_USER" "$1"' sh "$rehearsal"
docker exec -i "$postgres_container" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --no-owner --no-privileges' sh "$rehearsal" < "$backup/database.dump"
run_repair --database "$rehearsal" --apply > "$backup/rehearsal.json"
run_repair --database "$rehearsal" --apply > "$backup/rehearsal-repeat.json"
printf 'Restored-backup repair and repeat verification passed. Applying to the original database.\n'
run_repair --apply > "$backup/applied.json"
run_repair > "$backup/verified.json"
cat "$backup/verified.json"
docker start "$backend_container" "$presence_container" >/dev/null
stopped=false
ready=false
for attempt in {1..20}; do
  if curl --max-time 3 --fail --silent --show-error "$ready_url" > "$backup/ready.json" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  printf 'Repair committed, but readiness has not passed. Inspect docker logs --tail 100 %s. Evidence: %s\n' "$backend_container" "$backup" >&2
  exit 1
fi
# The gateway's static upstream names are resolved when Nginx loads. A stopped
# backend/presence container can receive a new IP when started again, leaving
# the running gateway with stale addresses even while direct readiness is good.
docker exec "$frontend_container" nginx -t
docker exec "$frontend_container" nginx -s reload
cat "$backup/ready.json"
printf '\nRepair finished. Evidence: %s\nRetained rehearsal database: %s\n' "$backup" "$rehearsal"
printf 'Refresh Tasks and Status Management. Alembic history remains unversioned; no stamp was performed.\n'
finished=true
