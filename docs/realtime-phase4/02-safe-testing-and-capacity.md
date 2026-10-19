# Safe Testing And Capacity Engineering

No load profile, including smoke, was executed during Phase 4 implementation. Functional regression tests and `k6 inspect` are not capacity evidence.

## Test Data And Authorization

1. Provision a separate local/staging database and Redis namespace. Do not point the app or tests at a production backup containing unredacted personal data. The regression-only `ops/testing/compose.realtime.yml` uses loopback ports 56379/56415, a volatile PostgreSQL 15 database named `zeaplay_rt3_test`, and no app production env/volumes. Its trust authentication is ONLY for disposable isolated local testing; do not expose or deploy it.
2. In an isolated app, use existing authorized UI/API flows to create a synthetic tenant, active users, a conversation with those users, one editable synthetic task per user and tickets with authorized participants. Preserve ordinary roles, Origin checks, ticket issuance and project membership policies. The load harness never signs forged JWTs or disables permissions.
3. Obtain short-lived synthetic account access tokens using the normal login flow. Tokens must cover the test window. The harness fetches `/api/auth/websocket-ticket` per session for the relevant scope. Never paste actual production credentials into examples or reports.
4. Prepare `approval.local.json` and `accounts.local.json` using the checked-in examples as a schema. The example approval is expired and the example account is not marked synthetic, so examples cannot run as supplied. Supply at least 10 DISTINCT synthetic users for smoke, each with real user/tenant/conversation/task/ticket IDs and its own access token; set synthetic=true only after checking ownership. Marking a fixture synthetic is an operator attestation, not proof from the server.
5. Approval must name a local/staging environment, test owner, unique alphanumeric/hyphen run ID, private/loopback target origins, allowed profiles, optional workload proportions and expiry within 24 hours. No public targets or DNS hostnames other than localhost are accepted. This intentionally excludes public staging until accessed through an approved private network/tunnel. HTTPS verification is never disabled. The production public IP is not a default or accepted target.
6. Retain a fixture manifest of owned IDs and original task descriptions. After the run, restore only those synthetic descriptions and archive/delete only explicitly owned fixtures through existing authorized flows. Alternatively dispose of the entirely dedicated test deployment/database after preserving results. Do not delete records by broad title/prefix searches, reset balances, FLUSHDB or drop shared schemas. The harness does not auto-delete history. No production mutation or cleanup command is supplied.

Keep credential files outside Git or in ignored `*.local.json` paths with OS permissions limited to the test operator. Summary files/results directories are ignored. Do not enable HTTP debug or URL tags: WebSocket ticket query strings are credentials.

## Tools And Validation

- Native suite: `benchmarks/realtime/native.js`, supported `k6/websockets` API, validated by k6 1.6.0 `inspect` with network disabled. No load execution is implied by compilation.
- Socket.IO suite: `socketio.mjs`, reuses the frontend's official `socket.io-client` v4 dependency. Run frontend npm installation first; no raw-WS substitute.
- Shared safety/launcher: `safety.mjs`, `run.mjs`; default action is validation only. Node 20+ required (local validation used Node 24).
- `safety.test.mjs`: pure authorization/target/ceiling/watchdog checks; no network.
- `validate-k6.mjs`: Docker-based syntax/config compilation with synthetic non-credentials, `--network none`, never `k6 run`.
- The previous unguarded `benchmarks/k6_tasks_list.js` now refuses execution and points to the guarded harness.

PowerShell validation example, after preparing approved fixtures:

```powershell
$env:ZEAPLAY_LOAD_APPROVAL_FILE = (Resolve-Path benchmarks/realtime/approval.local.json).Path
$env:ZEAPLAY_LOAD_ACCOUNTS_FILE = (Resolve-Path benchmarks/realtime/accounts.local.json).Path
$env:ZEAPLAY_LOAD_ENABLED = 'I_APPROVE_ISOLATED_LOAD_TESTING'
$env:LOAD_PROFILE = 'smoke'
$env:LOAD_SCENARIO = 'idle'
node benchmarks/realtime/run.mjs native
node benchmarks/realtime/run.mjs socketio
```

Only after a separately approved execution window, append `--run` to ONE selected launcher command. `K6_BINARY` may specify a local k6 executable; Docker k6 is used only for inspect validation here. Do not bypass the launcher, add arbitrary `--vus` overrides or execute native/Socket.IO suites simultaneously without dividing and approving their combined connection/event budgets. Distributed load generators are not coordinated by this single-generator safety layer.

## Profiles And Ceilings

| Profile | Concurrent synthetic identities | Unlock |
| --- | ---: | --- |
| smoke | 10 | Explicit enable + unexpired approval |
| baseline | 25 | Approved profile + `APPROVE_BASELINE` |
| small | 50 | Approved profile + `APPROVE_SMALL` |
| medium | 100 | Approved profile + `APPROVE_MEDIUM` |
| high | 250 | Approved profile + `APPROVE_HIGH` |
| stress | 500 | Approved profile + `APPROVE_STRESS` |
| extended | 1000-2000 | Approved profile + `APPROVE_EXTENDED`; optional `LOAD_EXTENDED_USERS` |

Higher unlock uses `ZEAPLAY_LOAD_HIGHER_APPROVAL`; it also requires a resource watchdog. Profiles are selectable, not an automatic escalating sequence. Extended counts above 1000 require explicit `LOAD_EXTENDED_USERS`; the 2000 hard ceiling is a harness safety bound, not an application capacity claim.

Default independent limits: `LOAD_MAX_USERS=10`, `LOAD_MAX_CONNECTIONS=20`, `LOAD_MAX_SECONDS=120`, `LOAD_MAX_EVENT_RATE=10`, `LOAD_MAX_REQUEST_RATE=20`. Requested defaults: `LOAD_SESSIONS_PER_USER=1`, `LOAD_SECONDS=60`, `LOAD_EVENT_RATE=5`, `LOAD_REQUEST_RATE=10`. Sessions/user limited to four. Raising a profile does NOT raise limits automatically. All numeric inputs must be integers and pass absolute bounds (2000 users, 8000 connections, 3600 seconds, 1000 requested events/requests per second). Validate requested duration plus a 40s ramp/grace allowance against max duration.

Native ramps 0 -> selected users over 10s, holds selected duration, ramps down over 10s, bounded grace. Connections are bounded by identities x sessions; `rps` bounds HTTP requests; disjoint per-identity time slots cap business mutations. Missed slots are skipped; callbacks/HTTP delays can reduce achieved rate. Heartbeat/pong and protocol packets are not business mutations and must be measured separately. A connection handshake budget is paced by identity sleeps and ramp stages, not an assurance of exact per-second network packets. Node connects gradually and paces signaling operations conservatively (up to 10 application packets/operation); each harness's ceilings apply independently.

Native abort thresholds: failure/HTTP error fraction >=5% after startup window, p95 correlated delivery >=2s, final checks >99%. They are initial safety/SLO candidates, not calibrated production requirements. Missing deliveries fail at connection close. Node stops after >=10 attempts if errors exceed 5%. The launcher terminates at max wall duration, approval expiry or stop-file creation, and escalates to kill after 5s if needed. Interrupted runs fail rather than report success.

### Resource Watchdog

Set `LOAD_WATCHDOG_FILE` to an explicit `*.watchdog.local.json` path. Higher profiles cannot start without a fresh safe sample. `watchdog.mjs` reads a separately approved private `monitorTarget` Prometheus origin from the manifest and writes atomic samples every 5s. It requires all five core scrape jobs healthy and present; missing/invalid metrics cause failure, not an invented healthy sample.

```powershell
# Separate terminal, same approved environment and higher-profile unlock if relevant:
node benchmarks/realtime/watchdog.mjs
```

The launcher rejects samples older than 15s, unavailable fields, CPU or memory >=90%, delivery error fraction >=5%, or unresolved outbox age >=60s. `LOAD_STOP_FILE` supplies a separate operator kill switch. Prometheus must already have fresh rates before starting; the monitoring readout itself is not a load profile. A monitored host average can still hide container throttling; watch container panels and stop manually for unexpected saturation. Default smoke can run without this watchdog; the brief's higher-load guard remains mandatory.

## Scenario Coverage And Boundaries

| Scenario | Native harness / independent tests |
| --- | --- |
| idle | Authorized ticket, upgrade, ready/join, heartbeat, bounded connection lifetime |
| chat | Authorized chat join; REST message create with client correlation ID; validate actual message content/client ID on socket |
| tasks | PATCH only synthetic description; task.changed ID check AND authorized GET description match; no status or XP write |
| tickets | Existing WS comment persistence path; match actual body and ticket ID on committed comment event |
| mixed | Configurable idle/tasks/chat/tickets/presence/calls weights (default 50/20/15/10/4/1). Native maps presence/calls to idle; Node supplies their independent protocol workload. This is not an automated combined-budget full-browser simulation. |
| reconnect | Short native sessions repeat, or Node explicit reconnects; no automatic infinite transport retry |
| cross-worker | Native requires two approved independent `workerTargets`: mutation on first, receive on second. Node accepts `presenceTargets` for multi-instance adapter experiments. A load balancer alone does not prove cross-worker selection. |
| redis-recovery / shutdown | Observation profiles only; NO automatic service restart/injection. An operator controls only dedicated test services. Existing two-process regression tests exercise subscriber loss/worker restart/snapshot recovery separately. Harness observation alone is insufficient proof of missed-data reconciliation. |

Socket.IO validates presence:get/ping acknowledgments, multi-socket sessions, meeting join participant arrays and leave, same-tenant incoming/answer/candidate/end/reject field forwarding with synthetic SDP labels. This is signaling-only; synthetic SDP is deliberately not offered to a browser media engine. No ack is fabricated for server events that have none. Tenancy negative tests belong to functional regressions, not mutation-heavy load traffic. Sustained Node signaling latency is reported as ack p50/p95/p99; zero samples are null, not zero latency.

The Node summary records peak connected identities separately from peak sockets. Ack storage is a fixed-size ring of the last 100,000 samples; total/retained sample counts and window policy are explicit. Percentiles describe that retained window, not an unbounded whole-run distribution.

## Correlation And Measurement Semantics

Use unique run ID + VU + iteration + local sequence as fixture content/client ID. Keep the set of outstanding mutations bounded (one per sending socket). Receive matches are deleted once, so duplicate echoes do not count as multiple successes. Task invalidations require a durable snapshot match because their envelope carries no changed description. That task measurement includes the verification GET and must not be compared directly with message receive latency.

| Milestone | Available evidence |
| --- | --- |
| Created | Sender timestamp immediately before REST/WS mutation; harness correlation ID |
| Persisted | REST success/persisted message ID, ticket comment history and authorized task snapshot; not merely WS upgrade |
| Published | Stable Phase 3 event ID and transport published counter; cannot equate this to browser receipt |
| Dispatched | Server monotonic local fanout/send histograms; no per-event ID metric label |
| Received | Correlation validated in actual application payload/snapshot |
| Acknowledged | Socket.IO server ack where supported; no new business-protocol client acknowledgment invented |

Node handler/ack durations use performance.now; Python handler/send use perf_counter. Native k6 correlation uses the same load generator's clock, not a server/browser timestamp difference. Clock changes can still disturb wall-clock slot pacing; use synchronized clocks and reject corrupted measurements. Cross-host publication/receipt timestamps require NTP/PTP skew bounds, reported clock source and uncertainty; no exact server-to-client segment is inferred from an unsynchronized occurred_at timestamp. Prometheus histogram quantiles describe sampled aggregate distributions, not traces.

Capture k6 summary, bounded Node summary, Prometheus query exports over the exact test window, build/revision/flags, CPU/RAM/limits/network, worker count, DB/Redis configuration, workload mix, active senders, active connections, achieved requests/events per second, pool occupancy, queues/outbox age and recovery times. Protect raw outputs; avoid URL/token/payload exports. Observe warmup/cooldown separately.

## WebRTC Media Analysis And Separate Test Specification

`frontend/features/chat/hooks/useNexusCalls.ts` has one `RTCPeerConnection` ref per hook, Google STUN (`stun.l.google.com`, `stun1.l.google.com`), no configured TURN credentials/URL, no SFU integration and no explicit maxBitrate/setParameters policy. Audio/video are P2P; screen sharing calls getDisplayMedia and replaces the outbound video track. Meeting participant/media-state Socket.IO signaling is NOT proof of a group media mesh/SFU: the hook maintains one peer connection, not a certified N-way media topology.

Before claiming media capacity, use two or more isolated browser contexts/hosts with real synthetic video/audio, secure context/permissions and normal app login/call controls. Chromium may use fake device/UI media flags in this test-only harness. Do not change production permission policy or fake signaling responses. Use same-LAN, different-network and restrictive-NAT cases; no TURN success can be claimed until TURN is explicitly configured and tested. Screen share needs a separate approved synthetic capture source.

Sample RTCPeerConnection.getStats once/second: nominated candidate-pair state/local+remote candidate type (host/srflx/relay), currentRoundTripTime, availableOutgoingBitrate, bytes sent/received deltas, inbound packetsLost/packetsReceived/jitter, outbound/retransmitted packets, frames decoded/dropped and qualityLimitationReason where supported. Measure ICE checking-to-connected and UI initiation-to-bidirectional media. Use browser performance/OS sampling for client CPU; report browser codec/resolution/device limits. Relay byte rate is TURN bandwidth only for selected relay candidates; no media-server CPU exists in this P2P design. Do not call backend signaling sockets media streams. This browser media harness is specified, not executed or certified in Phase 4.

## Capacity Report Template

| Field | Value before authorized sustained tests |
| --- | --- |
| Revision / image digests / hardware / limits | Record exact staging topology, not local VM substitution |
| Profile, duration, mix, active senders, sessions | Record actual achieved workload |
| Max tested connected identities / sockets | UNKNOWN |
| Max tested active messaging users / event rate | UNKNOWN |
| Handshake success and p50/p95/p99 | NOT MEASURED |
| HTTP and verified delivery p50/p95/p99 / errors | NOT MEASURED |
| CPU, RSS slope, network, Redis, DB/pool, loop lag | NOT MEASURED UNDER LOAD |
| Recovery duration / sustained outbox backlog | NOT MEASURED UNDER LOAD |
| Memory per connection / workload CPU cost | UNKNOWN; estimate only via repeated controlled deltas with stable baseline |
| Media capacity / TURN bandwidth | UNKNOWN; separate browser/media experiment required |
| Safe sustained capacity / scaling headroom | NO RECOMMENDATION UNTIL sustained SLO/headroom and soak tests pass |

Choose explicit SLOs first. Run a separately approved profile long enough to reach steady state and expose memory/backlog growth. Identify the first saturated resource using synchronized charts. Recommend capacity below the largest sustained SLO-passing workload with measured resource headroom, and label the workload mix/uncertainty. Do not linearly extrapolate 10 sockets to thousands or treat regression-test runtimes as throughput benchmarks.

## Bottleneck Checklist

- CPU/event-loop high: correlate handler histograms, synchronous permission queries, recipient count and serialization; profile before changing code.
- Memory trend: separate live sockets, queue bounds, ID caches, Node listeners, allocator/GC and metrics file churn; compare after cooldown.
- DB saturation: checked-out pools, max_connections, lock waiters, long queries and read-only backlog sample cost. No speculative index/migration changes.
- Redis: connected clients, commands/PUBLISH, subscriber failures, latency, fragmentation, evictions, adapter readiness; Pub/Sub has no durable lag metric.
- Hot-tenant fanout: authorized recipient count versus per-worker send duration; do not add high-cardinality tenant labels to diagnose it.
- Recovery storm: request rate, DB pool waits, snapshot retries and cache invalidation cost (current invalidate_prefix scans and collects keys).
- Proxy/OS: upgrades/timeouts/drain, FD/TCP limits, cgroup throttling/OOM, network/disk ceilings, outer TLS limits.
- Media: client encoder/decoder CPU and selected candidate path; a signaling-only test cannot diagnose media bandwidth.
- Client: browser main-thread/render/long tasks and event merge behavior; Node/k6 do not measure React performance.
