#!/usr/bin/env bash
# One-time recovery for the verified mixed-Compose incident on 2026-10-20.
# Does not upgrade PostgreSQL or remove volumes. Run on the affected VPS as root.
set +x
set -euo pipefail
umask 077

cd /opt/ideashop-zeaplay
compose=(docker compose --project-name ideashop-zeaplay --env-file .env.production -f docker-compose.prod.yml)
volume=ideashop-zeaplay_postgres_data
stopped=ideashop-zeaplay-postgres-1

# Fail before touching containers if the production file would select new data
# or a different PostgreSQL major version. Resolved secrets stay inside the pipe.
"${compose[@]}" config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)
assert c["services"]["postgres"]["image"] == "postgres:15", "Expected production PostgreSQL 15"
assert c["volumes"]["postgres_data"]["name"] == "ideashop-zeaplay_postgres_data", "Unexpected database volume"
'
actual_volume=$(docker inspect "$stopped" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
test "$actual_volume" = "$volume"
version=$(docker run --rm --pull=never --network none --read-only --volumes-from "$stopped:ro" --entrypoint cat postgres:16-alpine /var/lib/postgresql/data/PG_VERSION)
test "$version" = 15

"${compose[@]}" stop backend
if [ -n "$(docker ps -q --filter "volume=$volume")" ]; then
    echo 'Database volume is in use. Recovery stopped before backup.' >&2
    exit 1
fi

data_kb=$(docker run --rm --pull=never --network none --read-only --mount "type=volume,source=$volume,target=/source,readonly" --entrypoint sh postgres:16-alpine -c 'du -sk /source | cut -f1')
free_kb=$(df -Pk /root | awk 'NR==2 {print $4}')
if [ "$free_kb" -lt "$((2 * data_kb + 1048576))" ]; then
    echo 'Insufficient free space under /root for two backups plus 1 GiB headroom. Data volume is unchanged.' >&2
    exit 1
fi

backup_dir=$(mktemp -d /root/zeaplay-pg15-recovery.XXXXXXXX)
docker run --rm --pull=never --network none --read-only \
    --mount "type=volume,source=$volume,target=/source,readonly" \
    --mount "type=bind,source=$backup_dir,target=/backup" \
    --entrypoint tar postgres:16-alpine -C /source -czf /backup/postgres15-data.tar.gz .
chmod 600 "$backup_dir/postgres15-data.tar.gz"
tar -tzf "$backup_dir/postgres15-data.tar.gz" >/dev/null
test "$(tar -xOzf "$backup_dir/postgres15-data.tar.gz" ./PG_VERSION)" = 15
sha256sum "$backup_dir/postgres15-data.tar.gz" > "$backup_dir/postgres15-data.tar.gz.sha256"
printf 'Verified offline backup: %s\n' "$backup_dir"

# PostgreSQL 16 is used above ONLY as a cached utility image, never as a server.
"${compose[@]}" up -d --no-deps --wait --wait-timeout 90 postgres redis
docker exec zeaplay_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS users FROM users; SELECT count(*) AS tasks FROM tasks;"'
docker exec zeaplay_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
docker exec -i zeaplay_postgres pg_restore -l < "$backup_dir/database.dump" >/dev/null

# Existing application startup can run legacy schema helpers; both backups must
# succeed before resuming it. Schema/helper behavior is not bypassed here.
"${compose[@]}" up -d --no-deps backend presence frontend
curl --fail --show-error --retry 15 --retry-all-errors --retry-delay 2 --retry-max-time 60 --connect-timeout 3 --max-time 5 http://127.0.0.1:6311/health
curl --fail --show-error --retry 5 --retry-all-errors --retry-delay 2 --retry-max-time 30 --connect-timeout 3 --max-time 5 http://127.0.0.1:6300/api/health
"${compose[@]}" ps
printf '\nRecovery checks passed. Private backups: %s\n' "$backup_dir"
