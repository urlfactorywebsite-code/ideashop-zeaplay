# Monitoring Operations And Recovery

These are proposed operator commands, not a production deployment record. Obtain change approval first. Keep one FastAPI worker until the existing webhook scheduler ownership problem is separately resolved. Do not enable the Phase 3 outbox or alter migrations merely to collect Phase 4 metrics.

## Preflight

1. Preserve the exact approved application images/revision, Compose files, flags, current health and backup/recovery records. Check the actual production Alembic head independently; Phase 4 has no new schema.
2. Use a trusted Linux Docker host. Review existing host/container CPU, RAM, disk, FD/TCP limits, cgroup version and all other workloads before adding monitoring. Local Docker Desktop measurements are not VPS sizing evidence. Account for Prometheus retention and scrape cardinality; no new resource limits are imposed here.
3. Provision external files outside Git: a random >=32-character metrics token, a strong Grafana admin password, and a URL-encoded PostgreSQL monitoring DSN. Limit permissions to the deployment operator; make Docker-secret target files readable to the service's UID without exposing them publicly. Never use example placeholder credentials.
4. Provision a separate PostgreSQL login with database CONNECT and `pg_monitor`. Set `default_transaction_read_only=on` and a short statement timeout for that role. The exporter needs statistics access, not user-table writes or application superuser rights. Do not grant broad business-table SELECT merely for these aggregate queries. DSN must point to the intended DB and internal PostgreSQL endpoint. Password rotation is an operator-managed credential change, not a migration in this phase.
5. Redis exporter uses the current internal unauthenticated Redis topology. If Redis ACLs are configured, add its dedicated read-only monitoring credential through a secret and verify INFO/latency collectors; never give it broad app mutation privileges. Update all application/adapter/relay consumers consistently during a separately approved ACL rollout.
6. Image tags are pinned, but vulnerability scanning, signature/digest approval and ongoing security updates remain required. Presence still uses the existing Node 20 image; current runtime support/EOL must be dispositioned before release. The compatible prom-client version is deprecated upstream; do not mistake a successful npm audit for a runtime support guarantee.
7. Inspect host-exporter permissions. cAdvisor's host/Docker mounts reveal powerful operational state; do not expose its endpoint, use on an untrusted multi-tenant host or assume read-only socket mounts remove Docker control risk. Validate collectors against the host before relying on restart/OOM/health panels.
8. Configure an operational alert receiver/Alertmanager separately and prove a notification reaches the on-call owner. The supplied stack evaluates rules but has no paging destination. No fake email/webhook destination or secret is included.

## Configuration Validation (No Deployment)

From the repository root:

```powershell
node ops/monitoring/validate.mjs
node --test benchmarks/realtime/safety.test.mjs
node benchmarks/realtime/validate-k6.mjs
backend/venv/Scripts/python.exe -m pytest backend/tests/test_realtime_observability.py -q
```

The first command uses disposable promtool containers, a synthetic secret, and Compose `config --quiet`; it never starts app services. It validates all alert expressions and two firing/non-firing fixtures. The k6 command uses only inspect with network disabled. A failed command remains a failure even when later checks pass.

## Optional Monitoring Deployment (Approval Required, Not Executed Here)

On Linux, export the actual external secret file paths:

```bash
export ZEAPLAY_METRICS_TOKEN_FILE=/secure/zeaplay/metrics-token
export ZEAPLAY_GRAFANA_PASSWORD_FILE=/secure/zeaplay/grafana-password
export ZEAPLAY_POSTGRES_MONITOR_DSN_FILE=/secure/zeaplay/postgres-monitor-dsn
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.monitoring.yml config --quiet
```

Do not print rendered Compose configuration containing application secrets. Review diff and maintenance impact. A separately approved application image rebuild is required for the added Python/Node metric dependencies; production images do not change merely because source files changed. `npm ci` now uses the presence lockfile. The optional overlay changes API entrypoint to initialize the multiprocess directory and mounts secret files; recreating the API/presence interrupts connections and may drop current P2P calls.

After approval only:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d --build backend presence
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d prometheus grafana redis-exporter postgres-exporter node-exporter cadvisor
```

These commands deliberately do not change worker count, activate outbox flags, run migrations, restart PostgreSQL/Redis or deploy later phases. Review dependency behavior of your Compose version before use; use explicit `--no-deps` for approved service-only replacement when dependencies already exist and are healthy. Build the matching frontend image with the internal-path block in its normal approved release procedure. Until that proxy image is deployed, token protection still applies, but the old proxy could forward `/api/internal/metrics` if someone already possessed the monitoring secret.

Keep Prometheus/Grafana loopback-only. Use an SSH tunnel for admin access, for example `ssh -L 9090:127.0.0.1:9090 -L 3001:127.0.0.1:3001 operator@YOUR_APPROVED_HOST`. No new public domain/certificate/port is invented. `http://127.0.0.1:3001` is a tunnel/admin endpoint, not a public site URL.

If the already-approved realtime-outbox profile is enabled, the overlay adds `--metrics-port 9164` and its secret to the relay. Populate `ops/monitoring/relay-targets.json` with `[{"targets":["realtime-relay:9164"]}]` only after that service exists; leave the shipped empty list otherwise. Prometheus file discovery picks up this optional target. Multiple relays require individual targets. Do not enable the business outbox simply to populate a dashboard.

## Acceptance After Deployment

- Confirm old health endpoints, normal login, chat send/receive, task invalidation, ticket persistence and presence/call/meeting signaling still work through the existing TLS/WSS proxy.
- Confirm public `/internal/metrics` and `/api/internal/metrics` are 404 without leaking data. Internal scrapes with a correct secret succeed; wrong/missing secrets fail. Avoid shell commands that print tokens or put them into command-line arguments/history.
- In Prometheus targets, confirm all six jobs scrape successfully. In replicas, replace static single-target config with direct per-replica targets; never scrape through a load-balanced backend hostname.
- Verify actual metric names/units against exporter output. PostgreSQL custom statistics are current-database aggregates, not SQL text. Outbox panels may legitimately be absent while disabled. Verify Node Linux process/FD metrics and cAdvisor OOM/start data instead of assuming availability.
- Open all five provisioned Grafana dashboards, confirm real non-stale values and compare socket counts to controlled one-client changes. This runtime Grafana step has not been executed by implementation validation.
- Disconnect a controlled test client abnormally, kill/restart only an owned local worker and verify active gauge cleanup at the next scrape. Verify graceful whole-container restart clears the private registry once and does not erase another replica's metrics.
- Test alert delivery, silence duration/noise, failure/recovery and runbook ownership. Promtool success is not proof that a real page was sent.

## Troubleshooting

| Symptom | Check and response |
| --- | --- |
| Metrics 404 | Valid >=32-character secret file mounted/readable, matching bearer header, internal endpoint used. Do not weaken auth or expose publicly. |
| Scrapes only show one worker | Metrics launcher and inherited env before imports; shared private directory inside ONE container; per-replica targets. Do not sum repeated load-balanced scrapes. |
| Socket gauge remains high | Confirm request finally/worker lifetime; dead-PID cleanup happens on scrape; inspect killed-worker/PID-namespace assumptions. Never delete live registry files by hand. |
| Dependency healthy but old | Check sample timestamp; sampler may wait for a saturated DB pool. Readiness is separate and per process. |
| PostgreSQL custom metrics absent | pg_monitor/CONNECT, correct DB, exporter query config compatibility, timeouts. Never turn on customer query logging to debug exporter access. |
| Redis exporter fails | Internal network, ACL permissions, URL secret handling and Redis INFO availability. No Streams collector is expected. |
| Outbox old/DEAD | Verify relay is separately running when enabled. Investigate sanitized failure cause and aggregate ordering; never delete DEAD/pending rows to make charts green. |
| Node signaling count high | It tracks local unclosed signaling contexts, not media; remote/abandoned call paths can remain until disconnect. Use browser media stats for actual calls. |
| No OOM/restart/health series | Kernel/cgroup/cAdvisor permissions and metric support. Use approved read-only docker inspect/events, not fabricated zeros or privileged exposure as a shortcut. |
| Missing load samples | Inspect thresholds, fixture access, ticket TTL, workload slot skips and actual achieved rate. A configured user target is not measured active users or capacity. |

## Rollback And Forward Fix

| Condition | Preferred action |
| --- | --- |
| Bad dashboard/query/threshold | Restore only previous versioned monitoring config, validate with promtool and reload via approved mechanism; app/business data untouched. |
| Exporter permissions or overhead | Stop only the affected monitoring service; preserve app services and monitoring volumes. Record temporary coverage loss. |
| Instrumentation regression | Restore approved pre-Phase-4 application images and base Compose entrypoint, remove only Phase-4 secret mounts/env/overlay on API/presence, recreate only those approved services, reconnect clients and verify existing APIs. No DB downgrade. |
| Bad metrics token | Rotate external file and matching scraper credential, verify failures do not reveal token; coordinate process/container secret refresh as required. |
| Outbox/realtime reliability issue | Follow existing Phase 3 coordinated-cohort procedure. Phase 4 rollback must not delete outbox/aggregate tables or publication history. |
| Existing business-accounting defect | Separate incident/approved fix; do not reset XP/reward data or use a monitoring rollback as a database restore. |

Never `docker compose down -v` against the application/production project. Optional monitoring volumes can be retained for incident evidence. Remove only newly added monitoring services after confirming exact project/container ownership. The volatile `zeaplay-rt4-verification` regression project is separate and can be disposed of with its own exact Compose file/project after tests; it contains no app production volumes. No live production rollback, backup restore or mixed-version rolling upgrade is certified by this phase.
