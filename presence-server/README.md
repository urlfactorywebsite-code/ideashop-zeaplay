# ZeaPlay Presence Server

Socket.IO realtime service for ZeaPlay presence and chat fanout.

## Environment

- `PRESENCE_PORT`: HTTP/Socket.IO port, default `6312`
- `PRESENCE_REDIS_URL`: Redis connection URL, default `redis://localhost:6379`
- `PRESENCE_JWT_SECRET`: JWT access-token secret, must match `VEE_JWT_SECRET_KEY`
- `PRESENCE_JWT_ALGORITHM`: JWT algorithm, default `HS256`
- `PRESENCE_EVENTS_CHANNEL`: Redis pub/sub channel, default `presence:events`

## Socket.IO Events

Clients authenticate with `auth: { token }`.

Presence:
- `presence:get` ack: `{ ok: true, users: [] }`
- `presence:ping`
- emits `presence:online`, `presence:offline`, `user_online`, `user_offline`

Chat:
- `chat:join` ack: `{ ok: true, history: [] }`
- `chat:leave`
- `chat:message` ack: `{ ok: true, message }`
- `chat:typing`
- `chat:reaction`
- `chat:space`

Health endpoint: `GET /health`.
