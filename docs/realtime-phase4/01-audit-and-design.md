# Phase 4: Audit And Monitoring Design

Date: 2026-10-15. Checkout: `F:\Projects\ideashop-zeaplay-v5`, inherited HEAD `6631576` plus dirty Phase 3 changes. This is a source audit and local implementation, not evidence of a VPS deployment. No Phase 5 work or production load was authorized or performed.

## Verified Architecture

| Component | Source and observed behavior |
| --- | --- |
| Native realtime | `backend/app/ws/chat.py`, `tasks.py`, `ticket_chat.py`: process-local authorized socket registries; `/ws/chat`, `/ws/tasks`, `/ws/tickets/{id}` and `/api` aliases. REST remains authoritative. |
| Socket.IO | `presence-server/src/server.js`: one Node process, Redis adapter, tenant-scoped presence/user/chat/meeting rooms, offer/answer/candidate/reject/end forwarding. Existing legacy Socket.IO chat handlers also exist; Phase 4 does not remove them. |
| Distributed delivery | `backend/app/realtime/transport.py`: three Redis Pub/Sub channels per prefix, one subscriber thread/consumer per category per process, bounded queues and ID cache. Pub/Sub is not durable; no Streams are used. |
| Durable data | PostgreSQL/SQLAlchemy. `capture.py` writes outbox intents on the business transaction connection. `outbox.py` uses row locks/skip-locked and stable IDs; `relay.py` is a separate optional process. The Phase 3 additive migration is already in the dirty tree; Phase 4 adds no migration. |
| Recovery | Reconnect plus authorized REST snapshots, bounded event-ID dedup and coalesced frontend reconciliation. Redis does not replay disconnected clients' messages. |
| Auth | Strict configured Origins, JWT access/ticket authentication and native resource checks remain in place. A stateless ticket is not a revocation store. No new login architecture. |
| Reverse proxy | `frontend/nginx.conf` routes `/api/ws/` with upgrades, `/api/` to FastAPI, `/socket.io/` to Node. Phase 4 blocks `/internal/` and `/api/internal/` publicly. Outer HTTPS/WSS configuration remains an operator prerequisite. |

## Baseline Topology And Resources

`docker-compose.prod.yml`: frontend `6300:80`; backend loopback `6311:6311`; presence loopback `6312:6312`; Redis and PostgreSQL have no public published ports. Optional `realtime-outbox` profile runs the relay. `VEE_API_WORKERS` defaults to one; no automatic increase is introduced.

`docker-compose.yml` is development-only and publishes backend/presence/PostgreSQL/Redis on all host interfaces (`6311`, `6312`, `6432`, `6380`). Do not use it unmodified as production hardening. Development PostgreSQL is 16; production PostgreSQL is 15. Both conventions must remain explicit when comparing evidence.

Read-only inspection of the already-running **local** Docker containers found memory and NanoCPU limits equal to zero (unset), PID limits unset, and restart counts zero for API/presence/PostgreSQL/Redis. Local API command is a single Uvicorn process. Local Docker VM reports 16 CPUs and 16,615,931,904 bytes RAM. These are NOT VPS specifications or a capacity test. Production Compose also declares no CPU/RAM reservations or limits; none were added or changed.

`database.py` configures SQLAlchemy pool defaults of 10 plus 20 overflow per process, timeout 30s, recycle 1800s. Redis client pool max is 32 per API process with bounded command/connect timeouts. Pool capacity is not actual occupancy. Budget all API workers, relay/schedulers, exporters, migrations and admin headroom against PostgreSQL max_connections before scaling.

## Existing Instrumentation And Gaps

- `/health` is liveness; `/ready` checks DB and this process's three subscribers. It is not a fleet-wide readiness/drain mechanism.
- `/realtime/metrics` remains the existing Owner/Admin JSON diagnostic API. It reports only the answering worker; it is NOT used for fleet Prometheus scraping.
- Existing transport counters, connection snapshots and exception-class logging are retained. Logging is a mix of Python logging, startup prints and Node console output, not a uniform structured tracing system. No customer SQL/payload logging is enabled here.
- No pre-existing Prometheus/Grafana/exporter stack was found. No outbox, Redis Stream or media metric is invented where the underlying source does not exist.
- Known Phase 3 prerequisites remain: unsafe multi-worker legacy webhook scheduler, browser E2E gaps, unknown production migration lineage, revocation SLA and Redis ACL plan. Phase 4 does not repair unrelated business logic or certify Phase 3 merely because its targeted tests pass.

## Monitoring Design

The opt-in `docker-compose.monitoring.yml` overlay adds Prometheus, Grafana, Redis/PostgreSQL exporters, node-exporter and cAdvisor. It does not run with the default application deployment. Grafana/Prometheus bind only loopback; exporters publish no ports. No business schema changes. Host exporters have sensitive host visibility and require a trusted Linux operator; read-only Docker socket mounts are still powerful, not a security sandbox.

FastAPI uses `prometheus-client==0.22.1`; Node uses `prom-client==15.1.3`, compatible with the existing Node 20 image. Installation currently warns that prom-client was superseded by `@prometheus-io/client`; that replacement requires newer Node engines. This phase pins the compatible version rather than silently upgrading the runtime. A generated Node lockfile records transitive versions. Runtime/image lifecycle and vulnerability review remain release prerequisites.

The protected `/internal/metrics` endpoints require a random bearer token of at least 32 characters, provided through an external Docker secret file. Missing/short/incorrect credentials fail closed with 404. FastAPI rejects duplicate Authorization headers. Neither endpoint exports tokens, payloads, user/tenant IDs or resource identifiers. Proxy public paths are blocked separately. Scrapes do not execute SQL or Redis commands.

The optional outbox relay has a separately protected internal exporter on port 9164 (`--metrics-port`) with the same token convention, no published port and no request logs. It exposes the relay process's transport publication/failure counters. `relay-targets.json` defaults to an empty list because the relay profile is opt-in. Once the relay is enabled, explicitly configure its direct target(s); do not scrape the API and pretend its local publish counters include the relay. The exporter is a bounded-timeout stdlib WSGI listener, not a new business service; shutdown is registered for process exit.

### Multiprocess Lifecycle

The overlay launches `python -m app.metrics_launcher app.main:app ...`. Before importing Prometheus, it clears only the dedicated container-private `/tmp/zeaplay-prometheus/*.db` registry, exports `PROMETHEUS_MULTIPROC_DIR`, then execs Uvicorn. Never share this directory between replicas or separately launched API cohorts; never clear it on a child worker restart.

Counters/histograms accumulate for the container lifetime. Active sockets/queues use `livesum`; dependency/subscriber health uses `livemin`; database-wide sampled outbox values and worst loop lag use `livemax`. Shutdown marks a worker dead. Because Uvicorn has no Gunicorn child_exit callback, scrapes also remove live-gauge files for exited PIDs in the same container PID namespace. Windows uses a query-only process handle, not POSIX-style os.kill. Crash detection is eventual at scrape time; rapid PID reuse, registry file growth under worker churn and supervisor/container crash behavior need staging soak verification. Restart the whole cohort to reset the registry, not a rolling manual file purge.

Each replica requires its own direct scrape target/service discovery. Do not place one scrape address behind a multi-replica load balancer. Node is one process per container; scrape every replica directly. Existing Compose container names and process-local meeting participant maps are NOT a certified arbitrary-replica topology.

### Periodic Collection

Only when a valid token is configured, an owned lifespan task samples loop lag/subscriber/queue state about once per second. Every 30 seconds per API worker, a thread probes Redis PING and DB SELECT 1, samples pool usage and existing outbox backlog if enabled. PostgreSQL probes use a read-only transaction and 2s statement timeout; SQLAlchemy pool waits retain their existing timeout. Failed samples produce zero health; freshness alerts catch a stalled sampler. Outbox aggregation scans retained rows and must be profiled on large histories; a timeout fails health rather than changing database indexes speculatively.

PostgreSQL exporter queries in `ops/monitoring/postgres-queries.yml` are read-only aggregate statistics at 60s. They omit query text, PIDs and user labels. Use a separate pg_monitor account, database CONNECT and read-only session defaults; never the application's superuser. Slow-query *counts* (>30s) are not query latency distributions. pg_stat_statements and detailed SQL logging are not enabled. PostgreSQL host CPU is not attributable to a database solely from these statistics.

## Metric Catalog

| Families | Semantics and labels |
| --- | --- |
| `zea_ws_attempts_total`, `zea_ws_handshakes_total` | Native ASGI upgrade attempts/results; feature chat/tasks/tickets and finite result. Legacy policy-close helpers accept then close; their marked policy handshake is counted as policy, not accepted. |
| `zea_ws_rejections_total` | Explicit missing-token/JWT decode/expiry/scope and Origin failures. Does not claim to count every DB object authorization failure as authentication; generic policy closings cover those separately. |
| `zea_ws_active`, `zea_ws_disconnects_total` | Accepted connection lifetime, one decrement in finally; reason normal/abnormal/policy/retry. 1013 includes gaps as well as slow clients: do not mislabel it solely as slow-client loss. |
| `zea_ws_messages_total`, `zea_ws_payload_bytes_*`, `zea_ws_send_seconds_*` | Successful inbound/outbound ASGI message counts, UTF-8/binary payload histograms excluding network framing, and monotonic send durations. Send duration is not business-event latency. |
| `zea_ws_fanout_failures_total` | Exact existing manager send timeout/error paths per feature; timeout is a slow-recipient signal. This distinguishes timeouts from generic 1013 recovery closures without altering disconnect behavior. |
| `zea_rt_events_total` | Finite category/outcome: published, publish_error, processed, processing_error, subscriber_error, duplicate, invalid, queue_overflow, handoff_overflow, reconciliation_error, consumer_restart. |
| `zea_rt_handler_seconds_*`, `zea_rt_queue`, `zea_rt_subscriber_up` | Local fanout handler duration, queued envelopes and per-category worst live-worker subscription health. Handler duration includes authorized DB lookups/slow recipients; not client receipt. |
| `zea_dependency_up`, `zea_dependency_sample_timestamp_seconds`, `zea_event_loop_lag_seconds`, `zea_redis_ping_seconds_*`, `zea_db_pool_connections` | Probe health/freshness, scheduling lag, Redis ping and checked-out/idle pool counts. No queries during scrape. |
| `zea_outbox_records`, `zea_outbox_oldest_seconds`, `zea_outbox_retained_attempts` | Sampled global PENDING/DEAD/PUBLISHED rows, oldest unresolved age including DEAD, retained attempts gauge (pruning can decrease it). Absent when disabled; absence is not zero healthy backlog. |
| `zea_io_connections_total`, `zea_io_clients`, `zea_io_disconnects_total`, `zea_io_auth_failures_total` | Authenticated namespace connections/current sockets/disconnects and auth rejections. Connection-limit rejection may happen after namespace connection. |
| `zea_io_events_total`, `zea_io_handler_seconds_*`, `zea_io_errors_total` | Fixed event names plus other, direction in/out, monotonic handler duration and finite error kind. Catch-all event counts exclude acknowledgments; harness measures ack latency separately. |
| `zea_io_presence_sessions`, `zea_io_signaling_contexts` | Distinct local tenant/user sessions and sockets with unclosed signaling context. Neither is fleet-unique users or verified media sessions; a remote hangup/abandoned client can leave a context until local end/disconnect. |
| `zea_io_redis_up`, `zea_node_*` | Command/publisher/subscriber readiness, default process CPU/RSS/FD/start time/GC/event-loop metrics. Linux-only collectors require Linux validation. |
| `redis_*`, `pg_*`, `zea_pg_*`, `node_*`, `container_*` | Exporter families: Redis clients/memory/fragmentation/commands/evictions; PG connection/lock/long-query/commit/rollback/deadlock aggregates; host/container CPU/RAM/network/disk/FD/TCP/OOM/start times. Verify collector availability on actual cgroup/kernel versions. |

No per-user/tenant labels, dynamic event labels, arbitrary route/URL labels, exemplars or distributed trace IDs. Existing domain event IDs are retained in the protocol, not Prometheus labels.

## Dashboards And Alerts

Five reproducible dashboard JSON files under `ops/monitoring/grafana/dashboards`: infrastructure, fastapi-realtime, socketio-calling, redis-postgres, reliability. Source is `generate_dashboards.py`; refresh 30s, Prometheus UID fixed by provisioning. No absent panel is replaced with made-up data. Container start timestamp is explicitly NOT a restart count; cAdvisor restart/health availability varies. Use Docker inspect/events for exact restart/health evidence until an approved event collector exists.

Fourteen rules in `alerts.yml` cover scrape/dependency/probe failures, policy spikes, fanout/latency/loop lag, outbox, Redis ping, CPU/RAM/OOM, presence restart and disk. Each includes severity, sustained duration, impact and operator response. `alerts.test.yml` exercises sustained-down and DEAD-outbox firing and initial non-firing. Promtool validates syntax/PromQL for all rules; only these two rule behaviors have fixture tests.

Initial thresholds (85% CPU/10m, 90% RAM/10m, 15% disk/10m, 1s local handler p95/5m, 50ms Redis p95/5m, 1000 pending or oldest >60s/5m) are starting points, not measured SLOs. Tune from sustained workload distributions. Policy spikes can be attackers or broken configuration; short spikes do not page. No Alertmanager/notification receiver is configured, so rule evaluation is not proof of delivered operational alerts. Receiver provisioning and a test page are explicit deployment gates.

## Technical References

- [Python multiprocess lifecycle and limitations](https://prometheus.github.io/client_python/multiprocess/).
- [Supported k6 WebSocket API](https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/): `k6/websockets`, not the deprecated experimental module.
- [Socket.IO event APIs](https://socket.io/docs/v4/server-api/): catch-all observers do not measure acknowledgment delivery.
