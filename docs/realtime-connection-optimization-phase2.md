# Real-Time Connection Optimization - Phase 2

## Before

- `usePresence` and `useNexusCalls` each opened their own Socket.IO connection to the same presence service.
- Native FastAPI WebSocket hooks used separate local reconnect loops with fixed or no backoff.
- Ticket chat appended every typing event and socket message to local state without a bounded buffer.
- Task realtime bursts could trigger repeated immediate cache invalidations and REST refreshes.

## After

- Presence and call signaling share one authenticated Socket.IO lease per browser tab, endpoint, user and token context.
- Shared Socket.IO leases are reference-counted, keep feature listeners separate, and delay final disconnect briefly to tolerate React Strict Mode remounts.
- Native chat, task and ticket WebSocket hooks keep separate security scopes, but use the same jittered exponential backoff utility.
- Chat reconciles persisted conversations and messages after reconnect because Redis Pub/Sub does not replay missed events.
- Tasks debounce burst refreshes into one cache invalidation and list refresh.
- Ticket chat deduplicates comments by id and bounds local realtime message state.
- Presence service has configurable per-user and total connection limits with concise connection logs.
- Call and meeting cleanup now sends `call:end` and `meeting:leave` before releasing the shared Socket.IO lease, because presence may keep the transport open after the call UI unmounts.
- Socket.IO server rooms for legacy chat, direct call signaling and meetings are tenant-scoped internally. Client event names and payloads are unchanged.

## Compatibility

Preserved event names and payloads:

- Socket.IO: `presence:get`, `presence:ping`, `presence:online`, `presence:offline`, `call:*`, `meeting:*`.
- FastAPI WebSocket: `/ws/chat`, `/ws/tasks`, `/ws/tickets/{ticket_id}`.
- Chat events: `message:*`, `typing:*`, `presence:heartbeat`, `unread:updated`.
- Ticket events: `comment`, `typing`, `error`.

Native WebSocket connections remain separate because chat, tasks and tickets use different authorization scopes and subscription rules.

## Environment

Existing Phase 1 settings remain valid. Phase 2 adds optional Socket.IO limits:

```env
PRESENCE_MAX_CONNECTIONS_PER_USER=12
PRESENCE_MAX_TOTAL_CONNECTIONS=10000
```

Use higher values only after observing normal tab/device usage.

## Deployment

1. Pull the commit.
2. Ensure `.env.production` includes the new optional presence limit values or compatible defaults.
3. Rebuild the frontend, backend and presence containers.
4. Verify one browser tab creates one Socket.IO transport for presence/calls and separate native WebSockets only for active chat/task/ticket features.

## Rollback

Rollback remains commit-based:

```bash
git checkout <previous-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

If a presence limit is too low, raise `PRESENCE_MAX_CONNECTIONS_PER_USER` and restart only the presence service.

## Known Limits

- Multi-tab behavior intentionally still uses one Socket.IO connection per tab.
- Missed realtime events are reconciled with REST reads; Redis Pub/Sub is still not treated as replayable.
- Existing repository-wide TypeScript errors remain outside this phase.
