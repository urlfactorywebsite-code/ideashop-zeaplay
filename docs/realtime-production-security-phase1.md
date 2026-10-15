# Real-Time Production Security Hardening - Phase 1

## Existing Entry Points

- Browser app: `http://<host>:6300`
- FastAPI API and native WebSockets: container `backend:6311`
- Socket.IO presence/calls/meetings: container `presence:6312`
- Redis: internal Docker network only

Native FastAPI WebSockets:

- `/api/ws/chat`
- `/api/ws/tasks`
- `/api/ws/tickets/{ticket_id}`

Socket.IO:

- `/socket.io/` proxied by the frontend nginx container to `presence:6312`

## Hardened Production Topology

The production Compose file keeps direct backend and presence host bindings on loopback:

- `127.0.0.1:6311:6311`
- `127.0.0.1:6312:6312`

The public application path remains the frontend/reverse-proxy entrypoint:

- `6300:80`

For HTTPS/WSS, terminate TLS in the existing host reverse proxy and forward traffic to `http://127.0.0.1:6300`. The frontend nginx container then routes:

- `/api/` to FastAPI REST
- `/api/ws/` to FastAPI native WebSockets
- `/socket.io/` to the Socket.IO presence service

Do not publish production secrets or certificate material in this repository.

## Required Environment

Set trusted browser origins explicitly:

```env
VEE_WEBSOCKET_TRUSTED_ORIGINS=["https://your-domain.example","http://167.86.108.178","http://167.86.108.178:6300"]
VEE_WEBSOCKET_REQUIRE_ORIGIN=true
VEE_WEBSOCKET_REQUIRE_TICKET=true
VEE_WEBSOCKET_TICKET_EXPIRE_MINUTES=2
VEE_WEBSOCKET_MAX_MESSAGE_BYTES=65536
VEE_WEBSOCKET_MAX_CONNECTIONS_PER_USER=6
```

Use same-origin realtime routing for production builds:

```env
VITE_API_BASE_URL=/api
VITE_API_URL=/api
VITE_PRESENCE_URL=same-origin
VITE_WS_URL=/api
VITE_TICKET_CHAT_WS_URL=/api
PRESENCE_URL=same-origin
WS_URL=/api
TICKET_CHAT_WS_URL=/api
```

Socket.IO must allow the public frontend origin:

```env
PRESENCE_CORS_ORIGINS=https://your-domain.example,http://167.86.108.178,http://167.86.108.178:6300
PRESENCE_REQUIRE_ORIGIN=true
PRESENCE_ALLOW_LOCALHOST_ORIGINS=false
PRESENCE_MAX_CONNECTIONS_PER_USER=12
PRESENCE_MAX_TOTAL_CONNECTIONS=10000
```

`PRESENCE_JWT_SECRET` must match `VEE_JWT_SECRET_KEY` because the FastAPI auth endpoints mint the short-lived presence/WebSocket tokens that the Socket.IO service validates.

## Deployment Steps

After pulling this change on the VPS:

```bash
cd /opt/ideashop-zeaplay
cp .env.production.example .env.production
nano .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Verify:

```bash
curl http://127.0.0.1:6311/health
curl http://127.0.0.1:6312/health
curl -I http://167.86.108.178:6300
```

Browser checks:

- Chat websocket should connect to `wss://<domain>/api/ws/chat?...` when HTTPS is enabled.
- Task websocket should connect to `wss://<domain>/api/ws/tasks?...`.
- Socket.IO should connect to `https://<domain>/socket.io/`.

## Rollback

If realtime fails after deploy:

```bash
cd /opt/ideashop-zeaplay
git log --oneline -5
git checkout <previous-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Temporary compatibility switch:

```env
VEE_WEBSOCKET_REQUIRE_TICKET=false
VEE_WEBSOCKET_REQUIRE_ORIGIN=false
```

Use the temporary switch only while investigating a deployment issue.
