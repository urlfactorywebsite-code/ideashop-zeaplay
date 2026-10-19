# Phase 3 Distributed Systems Refinement Review

Date: 2026-10-15. Scope: the inherited, uncommitted Phase 3 working tree on HEAD `6631576`, plus the refinements listed below. No production deployment, production restart, production database migration, Phase 4 work, task XP change or reward change was performed.

## Verdict

**Distributed backend validation: PASS locally. Complete production acceptance: NO-GO.**

Two independent Uvicorn processes were exercised against real PostgreSQL 15.13 and Redis 7.0.15, not an in-memory broker or a single-process mock. The live distributed suite passed all 11 tests. The complete backend suite passed 237 tests with no skips. Production acceptance is still blocked by repository TypeScript failures, unexecuted browser/media and real deployment checks, production-like restore/lineage verification, and the existing webhook scheduler's multi-worker claim risk.

The original implementation report is [realtime-reliable-delivery-phase3.md](realtime-reliable-delivery-phase3.md). Its earlier unavailable-infrastructure results are historical; this review supersedes them for current local validation. The task-manager checklist report and accounting probes predate this review and were preserved unchanged.

## Architecture Matrix

| Critical property | Result | Verified scope |
| --- | --- | --- |
| Chat/tasks/tickets use FastAPI native WebSockets | PASS | Existing endpoints and browser adapters retained; REST chat creation remains authoritative. |
| Presence/calls/meetings use Socket.IO | PASS | Existing Node Redis adapter and room contracts retained; live signaling test passed. |
| PostgreSQL is durable business authority | PASS | Gateway tests used PostgreSQL scratch schemas; outbox and snapshots reference persisted rows. |
| Worker registries own only local sockets | PASS | Separate Python processes, distinct local registries, shared Redis fanout. |
| No replacement broker or unnecessary runtime dependency | PASS | No Kafka, Streams, RabbitMQ, new package dependency or replacement socket stack. Temporary test services are not production infrastructure changes. |
| All workers receive required events | PASS | Chat, task and ticket cross-process cases passed; six Redis subscriptions observed for two workers. |
| Redis Pub/Sub is not treated as durable replay | PASS | PostgreSQL outbox records intent; REST snapshots recover durable state. No browser receipt/exactly-once claim. |
| Production multi-worker application as a whole | FAIL / NOT CERTIFIED | Gateway harness does not start the application's notification/webhook schedulers or bootstrap/seed routines. See scaling prerequisite below. |

## Functional And Security Matrix

PASS means the named local automated check passed, not live VPS acceptance. FAIL / NOT VERIFIED is an incomplete acceptance gate, not a claim that the feature necessarily fails in production.

| Function / gate | Result | Evidence and limits |
| --- | --- | --- |
| Chat creation, REST delivery, client_id idempotency | PASS | Existing chat API tests plus separate-worker REST-to-WebSocket delivery. Public SPACE joins now commit automatically created membership. |
| Optimistic message recovery / duplicate and out-of-order data | PASS for helpers; browser gate NOT VERIFIED | Executable identity/UTC/merge tests; REST-confirmed sends now enter the in-flight recovery buffer. No complete browser optimistic-send scenario was run. |
| Task updates / assignments | PASS for automated API contracts | Existing backend suites and PostgreSQL cross-worker update test. Tenant/task authorization is rechecked before detailed fanout. |
| Ticket comments / status invalidation / history | PASS | Real cross-worker comments, persisted snapshot, tenant checks, pagination and existing ticket status tests. |
| Multiple tabs/devices | PASS for two sockets/processes | One user receives the same persisted comment on sockets owned by different workers. Actual browser tab lifecycle remains unverified. |
| Redis disconnect and full Redis restart | PASS | Targeted Pub/Sub disconnect and owned-server shutdown/restart both recover all six worker subscriptions; sockets reconnect and subsequent ticket delivery succeeds. |
| FastAPI worker restart / missed state | PASS | Replacement process becomes ready; authorized snapshot contains a comment written while the receiving worker was down. |
| Delayed PostgreSQL commit / rollback | PASS | Independent connection sees no uncommitted business/outbox state; rollback releases aggregate ordering to a blocked concurrent writer. |
| Snapshot/realtime race and cancellation | PASS for deterministic helper tests | In-flight refresh requests coalesce into a follow-up fetch, scope cleanup cancels queued recovery, and stale response checks/AbortController protect ticket recovery. Browser network timing not certified. |
| Active permission revocation | PASS for tested boundaries | Ticket membership removal closes the socket; disabled/moved users cannot continue chat mutations; task pong processing revalidates the user. No instantaneous database-change push to every idle socket is claimed. |
| Tenant injection / resource isolation | PASS | Wrong-tenant ticket envelopes do not deliver; duplicate valid IDs apply once; existing chat cross-tenant privileged-membership policy remains intact. |
| Native JWT, expired ticket, wrong scope, unauthorized users | PASS | Existing handshake regressions plus disabled/moved-user tests. Signed JWT expiry is checked at handshake, not continuously throughout a long-lived connection. |
| Native Origin policy | PASS | Malformed ports/URLs, paths, userinfo, whitespace, duplicate headers and unsupported schemes fail closed. Missing Origin still follows the explicit client policy. Production wildcard origins fail closed. |
| Socket.IO JWT and Origin policy | PASS | Real invalid/expired JWT, missing/untrusted/malformed Origin rejection, and wrong-protocol ticket rejection. Valid presence-scoped tickets and legacy access tokens continue to connect. |
| Presence online state, call initiation/answer/reject/candidate/end, meetings | PASS for signaling | Real Node process and Redis, tenant-scoped rooms, offer/answer/candidate/rejection/end and meeting joins. Camera/microphone, media quality, TURN and browser teardown NOT VERIFIED. |
| Login/logout, refresh, browser sleep/wake, tenant switching | FAIL / NOT VERIFIED end to end | Source lifecycle guards and existing unit/API tests reviewed; no complete browser journey was run. Shared presence/call keys now include tenant identity and reject changed credentials. |
| Private contents / credential logging | PASS for changed error paths | Backend/Node errors log exception classes rather than exception bodies; chat failures no longer return raw internal exception text. Production proxy/access-log configuration and broader legacy logging need staging review. |
| Readiness/liveness | PARTIAL | Subscriber health exercised live; `/health` versus `/ready` logic reviewed. Main-app readiness through the actual TLS/WSS proxy and all production workers was not exercised. |

## Confirmed Issues Corrected

1. Native Origin normalization discarded userinfo/path data and could throw on malformed ports. Validation now rejects malformed/surplus headers and only normalizes valid HTTP(S) origins, including default ports and IPv6 literals.
2. Socket.IO had the same permissive normalization and lacked an explicit Engine.IO `allowRequest` gate. Both HTTP polling and WebSocket admission now use the trusted-origin policy. Production mode is explicit in Compose.
3. Socket.IO accepted native chat/task/ticket WebSocket tickets without honoring their scopes. WebSocket-purpose tokens must now authorize presence, calls or realtime. Legacy access and existing presence-token contracts remain supported.
4. Chat inbound handlers could act for a disabled user or a user moved to another tenant. Every inbound action now checks current active user/tenant state. Task inbound pong processing also checks current user state.
5. Raw backend/Node error details could contain private content, provider details or broker payload fragments. Changed paths use bounded error classification and generic browser error messages.
6. A bounded asyncio queue did not bound the number of local cross-thread callbacks waiting before it. Local handoff admission is now bounded to the queue size; overflow coalesces a reconciliation request.
7. A nested rollback discarded outer post-commit ticket hints. Staged hints now retain their owning SQLAlchemy transaction and savepoint ancestry; only rolled-back intents are discarded. Post-commit transport failure cannot turn an already committed business write into a reported transaction failure.
8. Redis client library defaults added retries outside the intended retry policy. Explicit zero library retries now leave retry/backoff ownership to subscribers and the durable relay. Stable event IDs still protect uncertain-publish retries.
9. The relay accepted inconsistent payload versus outbox-row identity and inserted an unconditional one-second pause between aggregate heads. It now validates persisted identity, drains available work without that pause, prunes at most once per minute, and caps retry jitter after applying it.
10. Ticket recovery ignored refreshes requested during a delayed snapshot. Recovery now queues one follow-up request, aborts obsolete fetches, ignores stale socket closes and sorts live comments deterministically.
11. A successful REST chat send could disappear when an older history response arrived. Confirmed sends now enter the same recovery buffer as WebSocket messages. Stale conversation/directory errors and loading updates are discarded after scope changes.
12. A failed short-lived-ticket fetch could permanently strand native hooks. Logged-in hooks now use their existing bounded-backoff scheduler to retry, and reject obsolete connection attempts.
13. Shared Socket.IO leases did not include tenant identity or consistently reject credentials changed during token retrieval/delivery. Tenant-aware keys, exact credential checks, guarded listeners/acknowledgments, and tenant-sensitive consumer lifecycles now prevent stale-scope reuse.
14. Public chat SPACE socket joins flushed automatically created membership but closed the SQLAlchemy session without committing it. The authorized membership is now committed before acknowledging join; the regression test verifies it persists. No task/XP behavior changed.
15. Native chat retained offline presence entries after the user's final socket left. The offline event is preserved, but the unused cached entry is removed.
16. Production Uvicorn admitted much larger frames before the app's 64 KB validation. Compose now applies the same inbound frame limit at the protocol layer and bounds its inbound queue to 16 by default.

## Outbox And PostgreSQL Review

- ORM capture inserts counter/version and publication intent through the business Session's connection. Core SQL inserts avoid recursive ORM capture. Enabled durable intent rolls back with business changes. Disabled categories remain explicitly best effort.
- PostgreSQL `FOR UPDATE SKIP LOCKED` rechecks eligible heads after candidate selection. Claim locks remain held until publication status commits. A crash releases locks; publish-before-commit can replay the same ID. The relay never executes the business mutation again.
- An unresolved earlier aggregate version, including DEAD, blocks later versions of that aggregate only. Concurrent enqueue/upsert uses the aggregate's unique key. No global ordering across resources is promised.
- Twelve failed publication attempts produce DEAD. Pending/DEAD rows are not pruned. Operator `--retry-dead` preserves identity/version but resets attempts; keep an external incident/change record for lifetime retry history.
- Published rows older than the configured retention are deleted in bounded batches. Aggregate counters are retained. The unresolved-row capacity check supplies backpressure but is a soft count under concurrent transactions, not a strict distributed quota.
- The due index covers `(status, next_attempt_at, created_at)`; the unique tenant/aggregate/version index supports predecessor lookup. PostgreSQL migration tests inspect both. Retention filtering by `published_at` and capacity counts still need production-sized query plans; no retention-performance certification is claimed.
- Payloads carry references/invalidation hints, not copies of chat/ticket bodies. Consumers reload authoritative records and check recipients. Outbox payload identity must match its persisted row before publishing.
- `fc4d5e6f7a8b` upgrade/downgrade was tested on actual PostgreSQL in an isolated scratch schema with a legacy-balance sentinel. Populated outbox OR counter tables refuse downgrade. This is not a full historical migration-chain or production-backup rehearsal.

## Live Integration Evidence

The user authorized adding test services. A separate temporary WSL distro, `zeaplay-rt3-review-c15190a5`, was created from a SHA256-checked [official Alpine minirootfs archive](https://dl-cdn.alpinelinux.org/alpine/v3.18/releases/x86_64/). Redis and PostgreSQL listened on loopback test ports 56379 and 56415, respectively. The Docker Desktop/project stack was not started. The archived distro is test-only, not a production base-image recommendation.

Gateway tests created random PostgreSQL schemas under the explicit `zeaplay_rt3_test` database, provisioned the existing `pg_trgm` prerequisite, and launched two independent Windows Uvicorn subprocesses using those schemas. They disabled bootstrap/seed and external forwarding. Redis namespaces were unique; no FLUSHDB was used. The restart test launched and shut down its own additional Redis process, checked its run ID, and never restarted the shared/project Redis service.

After validation, both temporary database/broker services were stopped and the temporary distro was unregistered. Its registered installation path was verified to be inside this review's temporary directory before removal. Test logs/scripts remain; project containers and existing distributions were not removed or restarted.

| Test group | Result |
| --- | --- |
| Chat/task/ticket cross-process delivery | 3 passed |
| Tenant injection and repeated event ID | 1 passed |
| Targeted subscriber connection loss | 1 passed |
| Receiving worker restart and REST recovery | 1 passed |
| Two devices for one user | 1 passed |
| Full owned Redis server restart | 1 passed |
| PostgreSQL rollback and concurrent SKIP LOCKED relays | 1 passed |
| Actual PostgreSQL additive migration and guarded downgrade | 1 passed |
| Delayed commit visibility and concurrent enqueue after rollback | 1 passed |
| Distributed suite total | **11 passed, 0 skipped, 58.67 seconds** |

The initial live run exposed a restart-test bug: an unread ready frame was mistaken for a connection surviving process death. That test now consumes readiness before termination. The first PostgreSQL gateway setup failed because `pg_trgm` was absent; the isolated fixture now provisions it. The first owned-Redis restart run failed during implicit client retry/teardown; explicit retry ownership corrected it. These initial failures are retained in local logs, not presented as successful runs.

## Validation Results

| Check | Result |
| --- | --- |
| Complete backend suite, with real infrastructure enabled | **PASS: 237 passed, 0 failures, 0 skips, 4850 warnings, 199.73 seconds** |
| Focused refinement/chat/ticket/proxy run | **PASS: final post-cleanup run 93 passed, 824 warnings, 35.32 seconds**. Earlier corrected run: 92 passed before the public SPACE test. |
| Frontend suite | **PASS: 46 passed, 0 skipped** |
| Presence suite | **PASS: 6 passed, 0 skipped**, including real Redis/Socket.IO signaling and JWT/Origin failure cases |
| Frontend production build | **PASS: 5240 modules, 11.77 seconds**; existing Lottie eval and 3.33 MB main-bundle warnings remain |
| TypeScript | **FAIL: 131 diagnostics**, unchanged count from the earlier review; no diagnostics reported in the changed realtime hooks/helpers/shared client |
| Compose and optional relay profile | **PASS: sample-env `config -q`**; Docker image build/runtime and `nginx -t` NOT RUN |
| Migration graph | **PASS: single head `fc4d5e6f7a8b`** |
| Python compile / whitespace | PASS for changed modules/tests and `git diff --check`; Windows line-ending warnings remain |
| Lint | No dedicated lint script/configuration available; not represented as a passing lint run |

The final full run preceded the last one-line offline-cache cleanup and Compose protocol-limit assertions; the focused final run covers those affected paths. Earlier Phase 3 runs had intermittent shared-StaticPool SQLite workflow/timer failures, including a failure reproduced on untouched HEAD. A green run here does not erase that history or certify those unrelated workflow races under PostgreSQL.

Evidence directory: `%TEMP%\zeaplay-rt3-review-c15190a50c41424fab6d7a6d2b2e580f`. Important files: `full-review.log`, `full-review.xml`, `distributed-final.log`, `distributed-final.xml`, `refinement-final.log`, and the measurement script `measure_transport.py`. TypeScript diagnostics are `%TEMP%\zeaplay-rt3-review-typescript-final.log`. These are local artifacts, not a signed/immutable release package. A release commit/image digest must be fixed before final certification.

### Repeat The Checks

Provision isolated Redis/PostgreSQL test services first; the temporary services used here have been removed. Supply private test URLs through the environment, never a production/default application database. PostgreSQL URLs must name a database containing `rt3_test`. A modern `websockets.sync` package, pytest, backend requirements, and the declared frontend/presence dependencies must be installed.

```powershell
$repo = 'F:\Projects\ideashop-zeaplay-v5'
$env:PYTHONPATH = $repo
$env:VEE_DATABASE_URL = 'sqlite:///./verification.db'
$env:VEE_MEDIA_ROOT = './media'
# Set ZEAPLAY_RT_REDIS_TEST_URL and ZEAPLAY_RT_POSTGRES_TEST_URL to the isolated services.
$env:ZEAPLAY_RT_WORKER_POSTGRES_TEST_URL = $env:ZEAPLAY_RT_POSTGRES_TEST_URL
# Run on a runner with redis-server installed, or supply an equivalent dedicated test-only argv.
$env:ZEAPLAY_RT_REDIS_SERVER_ARGV = '["redis-server"]'
# Change to a fresh temporary directory, create its assets directory, then:
python -m pytest "$repo\backend\tests" -q --tb=short --junitxml=review.xml
```

From `frontend`, run `npm test`, `npx tsc --noEmit --pretty false`, and `npm run build`. From `presence-server`, run `npm test` with the isolated Redis test URL still set. Missing explicit infrastructure URLs cause skips; a configured but unavailable service is a failure. A run with skips is not equivalent to the fully enabled 237-test result above. The Redis restart fixture controls only the server process it launches, never the supplied shared test broker.

## Performance And Resource Review

No production benchmark or before/after throughput improvement is claimed.

Local smoke measurements: Python 3.14 on Windows, Redis 7.0.15 in temporary WSL, one sequential publisher/subscriber, 347-byte envelopes. Mean encoding was 3.066 microseconds and decoding 5.073 microseconds over 10,000 iterations each. Across 200 sequential Pub/Sub round trips, median was 0.249 ms and p95 0.305 ms. These exclude gateway authorization, PostgreSQL work, real browser receipt, TLS, network contention, serialization of large messages and fanout load. They are not end-to-end application latency or a comparison with the prior implementation.

| Area | Observation / remaining constraint |
| --- | --- |
| Redis subscriptions | Three per FastAPI worker; two-worker tests assert six distinct Pub/Sub clients. All gateway workers receive category events and filter local recipients. |
| Publish frequency | Durable capture coalesces task hints per flush, not per transaction. Chat/comment references remain distinct. One hot aggregate serializes counter writes. No production event-rate measurement. |
| Relay polling | Idle poll is one second. Available heads no longer incur that artificial pause. Retention is attempted at most once per minute, 500 rows per batch. |
| Queue memory | Per feature: 128 queued envelopes plus at most 128 pending local thread handoffs by default, a 4096-ID dedup window, and one consumer. The 256 KiB wire limit is not a Python RSS cap; decoded objects, transport buffers and sockets add overhead. |
| Inbound memory | Production Uvicorn uses the existing 64 KiB app message limit and queue 16. Node retains its existing bounded Engine.IO payload behavior. Native connection limits are per user, per worker, not a global distributed quota. |
| Fanout | Authorization reloads add SQL reads. Socket sends are serialized and bounded by send timeout, so many slow recipients can delay a feature consumer. No hot-tenant throughput certification. |
| Recovery load | Chat unread hints and task refreshes debounce; ticket snapshots are bounded to 200 comments with coalesced follow-up requests. Per-client recovery still adds DB/API load under a reconnect storm. |
| Task caches | Every task subscriber invalidates cache prefixes; multiple workers can repeat SCAN/DEL work. Existing prefix scanning is not a measured large-cache optimization. |
| PostgreSQL budget | Configured potential connections are roughly `(API workers + relays + other API processes) * (db_pool_size + db_max_overflow)`, plus migration/monitoring/admin headroom. Defaults are 10 + 20 per process. Measure actual occupancy before scaling; do not equate workers with connection count. |

## Remaining Risks And Deployment Prerequisites

1. **HIGH: existing webhook retry scheduling is not safely claimed across API workers.** `main.py` starts a webhook retry thread in every worker; `_run_due_webhook_deliveries` selects eligible rows without atomic claim/row locking. This can duplicate external delivery after increasing worker count. The notification email outbox has a conditional claim, but the webhook scheduler needs a separately verified claim/fencing fix or a deliberate single-scheduler deployment. Do not increase `VEE_API_WORKERS` merely because gateway tests pass. This review did not silently change webhook business delivery rules.
2. Fix or formally disposition the 131 TypeScript diagnostics and obtain Linux/Python 3.11 container build/test evidence. Presence has no committed lockfile: `npm ci` failed for that reason; existing declared dependencies were installed with `--package-lock=false --ignore-scripts` for validation. No dependency manifest or version was changed.
3. Run complete browser E2E for login/logout, refresh, optimistic chat, tab remount, sleep/wake, token refresh, tenant switching, network loss, calls and meetings. Real signaling is not proof of WebRTC media or TURN.
4. Reconcile the actual production Alembic revision and rehearse on a restored production-like backup. The earlier unknown `7g8h9i0j1k2l` lineage issue was not queried/fixed. Reconcile historical rows/balances and separately resolve the prior task-manager accounting/evidence findings.
5. Keep outbox flags disabled and API workers at one until release approval. Apply the additive migration before enabling capture; disable runtime schema/seed bootstrap on scaled workers. Provision `pg_trgm` once where required.
6. Use a coordinated old/new protocol cutover; mixed pre-Phase-3 and new internal broker cohorts are unsupported. Pin the release commit/image and plan browser reconnect/REST reconciliation. No zero-downtime mixed-worker rollout is certified.
7. Production Redis remains trusted internal infrastructure. Current Compose does not configure Redis ACL credentials. Apply network isolation and an ACL/secret plan that permits the actual cache, Pub/Sub and Socket.IO commands/channels; update every consumer URL consistently and test rotation. Do not expose Redis/PostgreSQL publicly.
8. Keep explicit trusted origins, `VEE_WEBSOCKET_REQUIRE_ORIGIN=true`, ticket enforcement and `PRESENCE_REQUIRE_ORIGIN=true`; remove wildcard, userinfo/path and malformed Origin configurations. The stricter policy intentionally rejects previously permissive malformed values. Preserve current valid browser origins and short-lived ticket routes.
9. JWT signatures/expiry are checked on handshake; active database-user/resource checks occur at subsequent native data boundaries. No new universal JWT revocation store was introduced. Already-open Socket.IO sessions cannot immediately learn that a database user was disabled. Define and test the required session-revocation SLA before calling that behavior fully secured.
10. Verify actual HTTPS/WSS proxy upgrades, trusted forwarded headers, token-free access/error logs and timeout behavior. `/ready` is per process, not fleet-wide; Compose does not automatically wire the new endpoint into upstream routing. Design readiness/drain checks without removing the only working access path.
11. Measure realistic backlog, hot-tenant fanout, recovery storms, retention plans and DB-pool usage. Native per-worker connection limits multiply with worker count; total native connections have no new cross-worker global cap.

## Rollback Validation

PASS: isolated PostgreSQL upgrade preserved a pre-existing balance sentinel; populated outbox and retained counters rejected downgrade; genuinely empty new tables could be downgraded. Existing task/user/reward schemas were not changed by this refinement.

NOT VERIFIED: production backup restoration, a complete historical-chain downgrade, a mixed-version rolling release, and live VPS rollback. Safe code rollback retains additive tables rather than destroying publication history.

Approved rollback sequence:

1. Freeze or drain writes for the coordinated release window and record the current release/image, flags, backlog and oldest pending age.
2. Stop only the independent realtime relay; decide whether pending intents should be drained before code rollback. A successful Redis publish does not prove browser receipt.
3. Disable durable category/master flags, roll back the entire backend cohort, and retain the additive tables/counters. Do not run a populated downgrade, reset IDs/counters, or reset XP/rewards.
4. Reconnect clients and reconcile authoritative REST state. Verify permissions, task status, balances and new writes on the approved code cohort.
5. Before re-enabling, review DEAD heads and pending intents with an incident record. Preserve IDs/ordering and use explicit operator retry, not deletion to bypass ordering. Database restore is a separately approved recovery path with potential loss of newer business writes.

## Files Changed During Refinement

These are changes made in this review, not the entire inherited Phase 3 diff:

- `.env.production.example`
- `docker-compose.prod.yml`
- `backend/app/cache.py`
- `backend/app/realtime/capture.py`
- `backend/app/realtime/outbox.py`
- `backend/app/realtime/relay.py`
- `backend/app/realtime/transport.py`
- `backend/app/ws/chat.py`
- `backend/app/ws/security.py`
- `backend/app/ws/tasks.py`
- `backend/tests/test_realtime_phase3.py`
- `backend/tests/test_realtime_processes.py`
- `backend/tests/test_realtime_proxy_config.py`
- `backend/tests/test_realtime_refinement.py` (new)
- `backend/tests/test_realtime_postgres_refinement.py` (new)
- `frontend/features/chat/hooks/useChat.ts`
- `frontend/features/chat/hooks/useChatRealtime.ts`
- `frontend/features/chat/hooks/useNexusCalls.ts`
- `frontend/hooks/usePresence.ts`
- `frontend/hooks/useTaskWebSocket.ts`
- `frontend/hooks/useTicketChat.ts`
- `frontend/services/realtimeRecovery.ts`
- `frontend/services/sharedSocketIo.ts`
- `frontend/test/realtime-optimization.test.ts`
- `frontend/test/realtime-recovery.test.ts`
- `presence-server/src/server.js`
- `presence-server/test/realtime-integration.test.js`
- `docs/realtime-reliable-delivery-phase3.md`
- `docs/realtime-phase3-refinement-review.md` (this report)

No production credentials or invented production domains/certificates, new business identity model, new broker, destructive production migration or later-phase implementation was introduced. Complete Phase 3 release acceptance remains BLOCKED; the local distributed backend checks are PASS.
