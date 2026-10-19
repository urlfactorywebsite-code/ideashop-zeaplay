# Reliable Real-Time Delivery - Phase 3

Date: 2026-10-15. Implementation is local. Acceptance remains BLOCKED pending real Redis/PostgreSQL integration and browser verification. No production deployment, service restart, or application-database migration was performed. Phase 4 was not started.

**Subsequent review:** [Phase 3 refinement review](realtime-phase3-refinement-review.md) supersedes the initial validation findings below. Isolated real PostgreSQL/Redis services were subsequently provisioned with user authorization; distributed tests and the full backend suite passed. Complete production acceptance remains NO-GO for the specific remaining gates in that review. Historical initial failures/skips below are retained rather than rewritten as passes.

## Verified Starting Architecture

Inspected starting revision: `6631576` (`Websocket Update`). References in this section describe that revision; later sections describe the changed implementation.

| Path / starting reference | Observed behavior |
| --- | --- |
| `backend/app/chat/realtime.py:34`, `:41` | Chat publisher and process-local subscriber thread on `<prefix>:chat:events`; subscriber has no supervised reconnect. |
| `backend/app/services/task_events.py:16`, `:23` | Task publisher/subscriber on `<prefix>:tasks:events`; no durable publication intent. |
| `backend/app/ws/chat.py:148`, `:196` | Local socket ownership and cross-process chat dispatch; local publisher origin is ignored to avoid an echo. |
| `backend/app/ws/tasks.py:88` | Local task socket registry consumes Redis invalidations. |
| `backend/app/ws/ticket_chat.py:31`, `:61` | Ticket ownership and broadcasts are local to one process; no Redis ticket subscription. |
| `backend/app/chat/router.py:176`, `backend/app/chat/services.py:534` | REST message creation commits to PostgreSQL, then a background broadcast runs. REST creation and `client_id` idempotency must remain. |
| `backend/app/routers/tasks.py:261` | Post-commit cache invalidation and task publication; Redis errors can surface after a successful write. |
| `backend/app/events/bus.py:130` | Ticket domain events create notification/webhook work; this is not WebSocket worker fanout. |
| `backend/app/main.py:788` | Startup schema/seed helpers and task/chat listeners; shutdown stops these listeners. |
| `presence-server/src/server.js:205`, `:677` | Presence Pub/Sub plus Socket.IO Redis adapter. Calls/meetings use Socket.IO; active frontend chat uses FastAPI. |
| `docker-compose.prod.yml`, `backend/Dockerfile` | One Uvicorn backend by default, one presence process, PostgreSQL 15, Redis 7, frontend Nginx. Existing WEB_CONCURRENCY/GUNICORN env values did not control this Uvicorn entry point. |

Phase 1 Origin/ticket checks and Phase 2 shared Socket.IO leases/backoff are present. No package dependencies were added.

### Producer Inventory

- Chat: `chat/services.py` create/edit/delete, REST `chat/router.py`, and `ws/chat.py` message, reaction, read, typing and heartbeat handlers. Chat service domain events also feed existing webhook infrastructure.
- Tasks: `routers/tasks.py` normal creation, grouped/recurring/duplicate construction, updates, transfers, approvals, subtasks/dependencies/evidence. Internal producers include `tickets/task_link_service.py:90`, `tickets/task_engine_service.py:73`, `routers/data_admin.py:431` / `:598`, and `seed.py:788`.
- Ticket mutations: `tickets/service.py`, workflow services and WebSocket comments. `events/bus.py` continues handling existing notification/webhook contracts.
- Presence/calls/meetings: `presence-server/src/server.js`, including legacy Socket.IO chat handlers. Legacy Node chat has Redis history and is not the active PostgreSQL-backed frontend chat path; its behavior was not redesigned.
- Persistent notifications continue using `Notification` and the existing email `NotificationOutbox`. Webhook delivery keeps its own existing retry infrastructure. The new realtime outbox records browser-publication intent, not a second notification system.

## Before / After

```mermaid
flowchart LR
  PG[(PostgreSQL)] --> REST[REST history]
  CA[Chat worker A] --> R[(Redis Pub/Sub)] --> CB[Chat worker B]
  TA[Task publisher] --> R --> TB[Task worker sockets]
  TicketA[Ticket sockets A] --- LocalA[Local-only ticket broadcast]
  TicketB[Ticket sockets B] --- LocalB[Separate local registry]
  Presence[Socket.IO presence and calls] --- Adapter[Redis adapter]
```

```mermaid
flowchart LR
  Write[Authorized ORM mutation] --> TX[One PostgreSQL transaction]
  TX --> Business[(Business rows)]
  TX --> Outbox[(Opt-in realtime outbox)]
  Outbox --> Relay[Independent relay]
  Relay --> Redis[(Redis Pub/Sub)]
  Ephemeral[Typing and presence] --> Redis
  Redis --> A[Worker A bounded subscriber]
  Redis --> B[Worker B bounded subscriber]
  A --> AuthA[Revalidate resource access] --> LocalA[Owned sockets A]
  B --> AuthB[Revalidate resource access] --> LocalB[Owned sockets B]
  Business --> Snapshot[Authorized REST snapshots]
  Snapshot --> Recovery[Client identity merge and reconciliation]
  Presence[Existing Socket.IO presence and calls] --- Adapter[Existing Redis adapter]
```

## Changed Files

| Area | Files |
| --- | --- |
| Shared backend transport | `backend/app/realtime/__init__.py`, `contracts.py`, `transport.py`, `capture.py`, `outbox.py`, `relay.py` |
| Models/configuration | `backend/app/models.py`, `schemas.py`, `config.py`, `database.py`, `cache.py`, `main.py` |
| Existing producers/adapters | `backend/app/chat/realtime.py`, `chat/services.py`, `services/task_events.py`, `routers/tasks.py`, `tickets/service.py`, `ws/chat.py`, `ws/tasks.py`, `ws/ticket_chat.py` |
| Additive migration | `backend/alembic/versions/fc4d5e6f7a8b_realtime_outbox.py` |
| Frontend | `frontend/services/realtimeRecovery.ts`, `services/mockApi.ts`, `types.ts`, `features/chat/hooks/useChat.ts`, `useChatRealtime.ts`, `hooks/useTaskWebSocket.ts`, `hooks/useTicketChat.ts`, `components/Tickets/TicketDetailDrawer.tsx` |
| Tests | `backend/tests/test_realtime_phase3.py`, `test_realtime_processes.py`, `test_realtime_postgres.py`, `realtime_worker.py`, `frontend/test/realtime-recovery.test.ts`, `presence-server/test/realtime-integration.test.js` |
| Operations | `.env.production.example`, `docker-compose.prod.yml`, this report |

The previously created task-manager checklist report and accounting probes are separate pre-existing work and were preserved.

## Broker Contracts

| Channel | Consumer | Purpose |
| --- | --- | --- |
| `<cache_prefix>:chat:events` | Every FastAPI worker's chat subscriber | Message references; legacy browser events through adapters; typing, read/presence hints. |
| `<cache_prefix>:tasks:events` | Every FastAPI worker's task subscriber | Authorized task/workflow invalidations. |
| `<cache_prefix>:ticket:events` | Every FastAPI worker's ticket subscriber | Comment references, ticket changes and ephemeral typing. |
| `PRESENCE_EVENTS_CHANNEL` | Existing Node presence instances | Existing ephemeral presence protocol, unchanged. |
| Socket.IO adapter channels | Existing Socket.IO adapter | Transient room broadcasts/signaling, unchanged. |

Broker channels are application/category scoped. Tenant isolation is enforced by validated envelopes plus database/resource checks on delivery, not by trusting a caller-supplied channel or tenant. Redis is trusted internal infrastructure and needs authentication, least-privilege ACLs and network isolation; it is not an end-user event API.

The internal Pydantic envelope has UUID event ID, allowlisted event type, version `1`, tenant/resource IDs, optional known actor, UTC occurred-at, optional aggregate version, and bounded payload. Unsupported versions, resource/category mismatch, malformed adapters and oversize payloads are rejected. Invalid broker messages increment counters without logging contents or credentials.

Browser contracts remain the existing chat `{version:'v1', type, payload}`, task invalidations, and ticket `comment`/`typing`/`error` forms, with optional `event_id`. Task/ticket sockets add a `realtime:ready` control frame after registration. Ticket changes add an invalidation frame rather than exposing ticket details through a tenant-wide broadcast.

Chat supports the existing explicit privileged cross-tenant membership policy. Its envelope tenant must match the conversation; actual conversation participants, including authorized cross-tenant participants, determine delivery. Ticket delivery requires matching current user and ticket tenants and current access. Task recipients receive only authorized resource details; a deleted or inaccessible task generates a minimal list invalidation without its resource contents.

## Durable Capture And Relay

- `RealtimeAggregate` provides an atomic per-tenant/resource publication sequence. `RealtimeOutbox` stores immutable event identity/reference, version, type, status, attempts, due/published timestamps and a sanitized error class.
- SQLAlchemy transaction hooks capture ORM Task/Subtask/Dependency/TimeEntry, ChatMessage, Ticket/Comment/Participant changes. Task changes coalesce per aggregate within one flush. Message/comment references remain distinct.
- ORM bulk Task update/delete used by administrative imports/resets gets a tenant-specific invalidation in the same transaction. Arbitrary external SQL, database triggers or direct Connection writes do not pass through these hooks; an external producer must explicitly enqueue intent or arrange reconciliation.
- Captured tenant identity comes from persisted parent/project/creator relationships. Outbox payloads use identifiers and invalidation hints, not copies of private message bodies. Consumers reload current message/comment state and recheck recipients.
- Durable intent is opt-in using `VEE_REALTIME_OUTBOX_ENABLED` and `VEE_REALTIME_OUTBOX_CATEGORIES=["chat","task","ticket"]`. Disabled chat/task retain best-effort delivery. Disabled tickets use post-commit best-effort capture and fanout.
- The relay is a separate CLI/process. FastAPI startup never starts this relay. Existing notification/webhook workers remain separate.
- Relays select bounded candidate batches, then recheck/claim with PostgreSQL `FOR UPDATE SKIP LOCKED`. An older unresolved event blocks only its aggregate. Publication happens while the claim transaction holds its lock; socket timeouts bound the network wait.
- Retry uses jittered exponential delay, capped at one hour. After 12 failed attempts the event is DEAD and blocks later events for that aggregate until operator intervention. Error text is not retained.
- Published rows older than seven days are pruned in batches of at most 500. DEAD/pending rows are not silently deleted. A default 100,000 unresolved-row backpressure threshold rejects new intent instead of silently losing it; concurrent in-flight transactions can overshoot this threshold temporarily.
- Ordering counters remain after pruning. They order publication intent, not every business revision and not independent aggregates. No global ordering is promised.

No Redis Streams were added. PostgreSQL business rows, the publication outbox, existing notification retries, Pub/Sub fanout and authorized REST reconciliation cover the concrete requirements without another replay store.

### Guarantees And Failure Windows

Business state and enabled publication intent commit or roll back together. No relay can see uncommitted intent. Redis failure delays publication without invalidating the business transaction. A successful PUBLISH means Redis accepted the notification; it does not acknowledge a browser or even an active subscriber.

A relay crash after PUBLISH but before its PostgreSQL commit can republish the same ID. Workers retain a bounded 4096-ID deduplication window. Browser messages merge by persisted ID/client_id; task/ticket invalidations are idempotent. Duplicates beyond a dedup window can cause extra reads, not duplicate message/XP mutations. REST remains the recovery authority. No exactly-once end-user delivery is claimed.

The relay holds claims within its database transaction instead of persisting a SENDING lease, so a process crash releases row locks and leaves the event pending. A DEAD head must be reviewed; do not delete it to force later versions through without a reconciliation plan.

## Reconnect Algorithms

### Chat

Join the conversation and wait for `chat:joined` before the authoritative recovery fetch. Buffer incoming messages/edits during the fetch, merge the persisted latest page with buffered state and pending optimistic sends, deduplicate by client_id/ID, and sort by UTC timestamp/ID. Acknowledged client IDs replace their optimistic entry. Older history remains accessible through the existing persisted pagination cursor.

The recovery buffer is bounded at 2000 messages; overflow requests another latest snapshot. Stale responses from another conversation or auth scope are discarded. Unread events are debounced REST reconciliation hints, so late counts and duplicate deliveries cannot increment balances of unread messages. The persisted message history cursor never advances because Redis published an event.

### Tasks

Initial connection, ready frame and reconnection invalidate client caches and trigger the existing 250 ms debounced refresh. Redis task-event consumers also invalidate bounded-TTL task cache views before notifying local sockets, including internal/system producers. Complete state is fetched rather than applying intermediate status deltas. Scope changes tear down old sockets and reject late connection attempts.

### Tickets

Wait for the post-registration ready control frame, buffer events, fetch the authorized snapshot, then merge snapshot comments with buffered comments by ID and sort by persisted time/ID. Keep the latest 200 comments, with older pages available through `before=<persisted-comment-id>`. Fetch ticket details again after recovery/change notifications. Overflow or recovery failure reconnects the socket. A one-second fallback supports older backends without the ready frame, with the older protocol's weaker registration timing guarantee.

`GET /ws/tickets/{ticket_id}/snapshot` (also `/api/ws/...` for direct API clients) accepts `limit=1..200`, optional `before`, and returns ticket summary, comments, has_more and next_cursor. The cursor identifies persisted state, not publication/delivery/application acknowledgment. It does not confer authorization.

Logout/login and tenant context changes clear socket/recovery state. `UserRead.tenant_id`, `ApiUser.tenant_id` and frontend `User.tenantId` are optional additive fields used for this lifecycle key; server authorization still derives from authenticated database state.

## Resilience And Observability

- Three supervised subscriptions per FastAPI worker use the existing pooled Redis client (32 connections, 2-second socket/connect timeouts). Subscription retries have jitter and a bounded 30-second base delay, and stop on shutdown.
- Each category has one bounded 128-entry queue and one consumer. The Redis thread waits for the event-loop handoff instead of creating unlimited delivery futures. Queue overflow requests socket reconnection/reconciliation. Local socket sends time out after two seconds and slow clients are closed with 1013.
- Resubscription closes affected local sockets to trigger reconciliation of events missed during a Redis gap. Process shutdown stops/join subscribers, cancels consumers, closes sockets and the shared Redis client.
- `GET /health` remains liveness-compatible. `GET /ready` returns 503 if the database or required subscribers are unavailable. Proxy these as `/api/health` and `/api/ready` through the existing frontend Nginx configuration.
- Admin/Owner `GET /realtime/metrics` reports connection snapshots, subscriber state/queue sizes and bounded counters for fanout, duplicates, publish/subscriber/processing errors, and cumulative delivery latency. Enabled outbox metrics include status counts, attempts and oldest unresolved age. `python -m app.realtime.relay --metrics` supplies relay-side backlog visibility.
- Metrics use bounded feature/status keys, not per-user/tenant/ticket/event labels. Browser reconciliation errors are handled in UI/reconnect paths; no fleet-wide browser-failure telemetry endpoint was introduced. There is no per-socket application queue; slow-client handling uses send timeouts and the bounded feature queue.

## Migration And Rollback

New head: `fc4d5e6f7a8b`, predecessor `fb3c4d5e6f7a`. Two additive tables and indexes/check constraints; no changes to historical tasks, XP, claims or balances. Runtime create_all excludes these two tables; enabling the outbox requires the explicit migration. Populated outbox OR aggregate-counter tables refuse schema downgrade, including when published events have already been pruned. Empty-table downgrade is tested locally.

Production lineage was not queried or repaired. The previously reported unknown revision `7g8h9i0j1k2l` remains a separate release prerequisite. Never stamp over it or run this migration against an unreconciled target.

Preferred rollback: stop intake of writes for the coordinated release window, stop the relay, disable durable flags, deploy the previous code cohort, retain the additive tables and their contents, reconnect browsers and reconcile REST state. Record whether pending intents need draining/replay before re-enabling. Do not reset event IDs/counters, drop populated tables, reset XP, or downgrade award markers. Recovery of business data still requires verified database/evidence backups.

The internal broker wire format changed; mixed pre-Phase-3/new worker cohorts on these channels are not supported. Use an approved coordinated restart/drain or isolated cohort cutover. Browser REST/WS routes remain compatible, but an uninterrupted mixed-worker rolling deployment is not claimed.

## Deployment Preparation (Not Executed)

1. Back up/restore to isolated PostgreSQL, reconcile Alembic lineage, compare historical data and apply `fc4d5e6f7a8b` there. Run PostgreSQL/Redis process tests before promoting. With an explicitly isolated staging env file, the migration commands are:

```bash
# Commands for the isolated restore only; not executed here. Inspect current revision before upgrading.
ZEAPLAY_ENV_FILE=.env.staging docker compose -p zeaplay_rt3_staging --env-file .env.staging -f docker-compose.prod.yml run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend alembic current
ZEAPLAY_ENV_FILE=.env.staging docker compose -p zeaplay_rt3_staging --env-file .env.staging -f docker-compose.prod.yml run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend alembic upgrade fc4d5e6f7a8b
```

Prepare `.env.staging` privately and verify it points exclusively to restored, isolated test services reachable by the one-off migration container. The commands do not start dependencies or publish service ports. If creating a full staging stack, remove/change the production fixed container names/host ports and provision separate databases/volumes first; this repository does not supply that isolated staging topology automatically. Only repeat the approved migration procedure against production after backup/restore, lineage and staging gates pass.
2. Keep `VEE_API_WORKERS=1` and outbox disabled for the initial code cohort. Review the coordinated cutover/write-freeze window above.
3. Bootstrap/migrate/seed once in the controlled release procedure. Set `VEE_BOOTSTRAP_SCHEMA=false` on scaled workers. This disables existing import-time schema helpers and startup schema/seed work. Ensure assets/media configuration and privileges are ready before disabling bootstrap.
4. After acceptance, enable categories gradually using the env file, for example `VEE_REALTIME_OUTBOX_ENABLED=true` and `VEE_REALTIME_OUTBOX_CATEGORIES=["ticket"]`, then chat/task. Keep all processes on the new code protocol.
5. Manually start exactly one relay initially with the optional `realtime-outbox` Compose profile. The relay has no public ports. Additional relays use SKIP LOCKED but require PostgreSQL verification first.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile realtime-outbox up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml exec realtime-relay python -m app.realtime.relay --metrics
```

6. Monitor readiness, DEAD rows, backlog age, duplicate/processing counters and reconnect behavior. After correcting a failed dependency, explicitly requeue a reviewed DEAD event without changing its ID:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec realtime-relay python -m app.realtime.relay --retry-dead EVENT_ID
```

7. Scale FastAPI only after acceptance using `VEE_API_WORKERS`, initially from 1 to the reviewed value, with bootstrap disabled. Default topology is unchanged. Compose's fixed container_name/host binding means arbitrary backend replica scaling is not configured by this change.

Socket.IO stays a single presence service by default. The Redis adapter broadcasts across instances but does not replay events. Long-polling remains enabled, so multiple presence replicas need session affinity (or an explicitly tested websocket-only policy). Meeting participant maps are still process-local; presence replica scaling is not certified. Test actual WebRTC media/TURN separately from signaling.

Use least-privilege DB roles without DDL after bootstrap; give API/relay only the DML needed for their outbox tables and existing application roles. Keep PostgreSQL/Redis internal, preserve the existing TLS/WSS proxy and Origin/ticket policy, and supply production secrets through the existing private env/secret mechanism. No domains, certificates or production secrets were invented.

## Validation

Infrastructure tests require explicit opt-in and do not silently fall back to mocks. Tests ran on Windows with Python 3.14; the production Python 3.11 Linux image was not built because the Docker daemon is unavailable.

| Check | Result and evidence |
| --- | --- |
| Focused realtime/chat/ticket/proxy regression run | PASS: 55 passed, 766 warnings, 31.06 seconds, before the final chat tenant-change regression was added. |
| Final realtime unit/API tests | PASS: 22 passed, 47 warnings, 2.96 seconds; includes stale-tenant socket rejection, transactional capture/rollback, safe migration downgrade, retries/dead letters, bounded dedup/queues, consumer supervision, shared-pool initialization, socket registration during gap cleanup, shutdown, permission revocation, slow clients and ticket pagination. |
| Full backend run history | One run: 181 passed / 6 skipped before later tests. Next: 185 passed / 1 failed / 8 skipped, approval-race `IndexError` in the shared SQLite fixture; isolated retry passed. Next: 185 passed / 1 failed / 8 skipped, timer double-click returned 201 and 404; isolated retry passed together with realtime tests (17 passed). A later full run passed 189 tests / 8 skipped in 129.07 seconds. These intermittent concurrency failures are not hidden or certified as PostgreSQL correctness. |
| Final full backend run | FAIL: 192 passed, 1 failed, 8 skipped, 4707 warnings, 137.67 seconds. `test_tasks_phase7.py::test_simultaneous_completion_requests_do_not_duplicate_activation_history` raised SQLite `InterfaceError: bad parameter or other API misuse` during a dependency query; its isolated retry also failed, with `ObjectDeletedError`. The shared `StaticPool` in-memory fixture is not a PostgreSQL concurrency oracle. |
| Untouched starting-commit comparison | The same workflow test was run from a `git archive` of HEAD `6631576` in a separate temporary source tree, without reverting the workspace. It also FAILED with SQLite `InterfaceError` in workflow-event persistence (1 failed, 34 warnings, 5.77 seconds). This demonstrates the failure also exists at baseline; it does not establish a complete root cause or certify production concurrency. No workflow business behavior or existing fixture was silently changed. |
| Frontend tests | PASS: 43 passed, 0 failed. Five added executable recovery tests cover deduplication, optimistic IDs, persisted-ID updates, ordering and UTC handling. Existing source-contract tests are not browser E2E. |
| Presence tests | PARTIAL: 5 source-contract tests passed, 1 real Socket.IO integration test skipped because an isolated Redis URL/dependencies were unavailable. No live call/media acceptance claim. |
| Production frontend build | PASS: 5240 modules, 11.50 seconds. Existing Lottie eval warning and 3.33 MB main bundle warning remain. |
| TypeScript | FAIL: `npx tsc --noEmit --pretty false`, exit 2, 131 diagnostics. Examples include AvatarCropModal, Ballpit and existing ticket approval callback return types (also present at starting HEAD). No errors reported in the new recovery helper or changed realtime hooks. Full repository typing is not certified. |
| Production Compose configuration | PASS: sample env and optional `realtime-outbox` profile pass `docker compose ... config -q`. Runtime container build/start is NOT RUN. |
| Python compile and migration graph | PASS: compileall on new realtime modules/tests/migration; Alembic resolves to single head `fc4d5e6f7a8b`. This is not a full PostgreSQL migration rehearsal. |
| Whitespace validation | PASS: `git diff --check`; Git reports existing Windows LF/CRLF conversion warnings. |
| Lint | NOT CONFIGURED: no frontend/presence lint script or dedicated lint configuration found. TypeScript/build results are reported separately. |
| Live Redis / PostgreSQL | BLOCKED: Docker Linux-engine pipe unavailable; no local Redis/PostgreSQL server executable found. Seven Redis process tests and one PostgreSQL test skipped without explicit test URLs. |

Local command logs/JUnit artifacts are in `%TEMP%\\zeaplay-rt3-1133fe6d5c14466fbbe6bcbd674c9e83`, not production storage. Final suite artifacts: `phase3-final.log`, `phase3-final.xml`; new tests: `realtime-unit-release.log`; baseline comparison: `baseline-workflow.log`. Current TypeScript output is `%TEMP%\\zeaplay-rt3-typescript-release.log`. Temporary files are local investigation evidence, not a durable release package. No production-like backup, migration rehearsal, historical-balance reconciliation or real browser E2E was performed by this phase.

### Acceptance Matrix

| Capability | Local evidence | Release gate |
| --- | --- | --- |
| Chat/tasks/tickets across workers | Adapters/API/authorization tests pass; separate-process suite added | BLOCKED until real Redis suite passes |
| Outbox atomicity, retry, deduplication | SQLite transactional/unit checks pass | BLOCKED until PostgreSQL concurrent-claim test and migrated restore pass |
| Tenant and resource isolation | Existing chat/ticket tests plus injection/revocation/stale-scope tests | PARTIAL; real broker injection test not executed |
| Redis connection recovery | Supervised lifecycle and bounded-queue tests pass | BLOCKED; targeted disconnect test skipped and full Redis restart still needs staging verification |
| Reconnect recovery and ordering | Executable merge/UTC/identity tests pass | PARTIAL; actual browser sleep/wake, offline and cross-worker recovery not executed |
| Presence, WebRTC, meetings | Existing server source unchanged; five contract checks pass | BLOCKED until live Socket.IO/signaling and browser media smoke tests pass |
| Existing Origin/auth/proxy contracts | Included in passing focused regressions | PARTIAL until actual TLS/WSS proxy smoke test |
| Production rollout and rollback | Additive migration and guarded local downgrade; operational steps documented | BLOCKED pending operator approval, restore rehearsal and coordinated cohort cutover |

Decision: **PHASE 3 ACCEPTANCE BLOCKED / NO-GO for production**. Implementation is present locally with durable flags disabled by default; live multi-worker and database acceptance criteria are not yet demonstrated.

```powershell
# From a fresh temporary working directory with an assets directory and PYTHONPATH pointing to this checkout:
$env:VEE_DATABASE_URL='sqlite:///./verification.db'
python -m pytest F:\Projects\ideashop-zeaplay-v5\backend\tests -q --tb=short

# Real services must be isolated test infrastructure, never the production/default application DB:
$env:ZEAPLAY_RT_REDIS_TEST_URL='redis://127.0.0.1:6379/15'
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg://USER:PASSWORD@127.0.0.1/zeaplay_rt3_test'
python -m pytest F:\Projects\ideashop-zeaplay-v5\backend\tests\test_realtime_processes.py F:\Projects\ideashop-zeaplay-v5\backend\tests\test_realtime_postgres.py -q

# From frontend: npm test; npx tsc --noEmit --pretty false; npm run build
# From presence-server, after installing declared dependencies: npm test
```

The process suite starts two independent Uvicorn workers against a temporary shared SQLite file and real Redis, testing chat/task/ticket fanout, duplicate/tenant injection, multiple devices, targeted subscriber disconnects and worker restart/snapshot recovery. PostgreSQL has a separate guarded scratch-schema test for rollback and concurrent SKIP LOCKED relay claims. These establish different properties; neither replaces a migrated production-like PostgreSQL restore.

The optional Node integration test uses the same dedicated Redis test URL and declared presence dependencies to test presence, tenant-scoped call offer/answer/candidate/end and meeting signaling. It needs frontend and presence npm dependencies installed. Browser camera/microphone, full network Redis restart, multi-replica Socket.IO, and browser E2E remain separate staging gates.

## Resource Impact And Remaining Risks

No throughput, browser latency or Redis traffic improvement was measured. The architectural queue bound is 128 * 256 KiB per feature before Python object overhead, plus 4096 dedup IDs and live connection registries. Enabled capture adds transactional counter updates/outbox inserts; bounded retention adds delete work. Per-recipient authorization adds DB reads, and task subscribers invalidate task cache views. Measure these on production-sized staging data before worker increases.

Acceptance requires real cross-process fanout and PostgreSQL tests, Redis restart testing, browser recovery and signaling/media smoke tests. Local static/unit tests alone do not satisfy that gate. Existing TypeScript debt, intermittent shared-SQLite concurrency failures, and the task-manager checklist's historical XP/refund and evidence-storage blockers remain explicit release risks outside this phase's business logic changes.
