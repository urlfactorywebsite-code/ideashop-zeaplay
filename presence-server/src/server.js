import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

import express from 'express';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { adapter, authFailures, errors as metricErrors, instrument, metricsRoute, presence } from './metrics.js';

const config = {
  environment: process.env.NODE_ENV || process.env.VEE_ENVIRONMENT || 'development',
  port: Number.parseInt(process.env.PRESENCE_PORT || '6312', 10),
  redisUrl: process.env.PRESENCE_REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.PRESENCE_JWT_SECRET || '',
  jwtAlgorithm: process.env.PRESENCE_JWT_ALGORITHM || 'HS256',
  eventsChannel: process.env.PRESENCE_EVENTS_CHANNEL || 'presence:events',
  corsOrigins: parseOrigins(process.env.PRESENCE_CORS_ORIGINS),
  requireOrigin: parseBool(process.env.PRESENCE_REQUIRE_ORIGIN, false),
  allowLocalhostOrigins: parseBool(process.env.PRESENCE_ALLOW_LOCALHOST_ORIGINS, true),
  maxConnectionsPerUser: Number.parseInt(process.env.PRESENCE_MAX_CONNECTIONS_PER_USER || '12', 10),
  maxTotalConnections: Number.parseInt(process.env.PRESENCE_MAX_TOTAL_CONNECTIONS || '10000', 10),
  chatHistoryLimit: Number.parseInt(process.env.PRESENCE_CHAT_HISTORY_LIMIT || '200', 10),
};

if (!config.jwtSecret) {
  throw new Error('PRESENCE_JWT_SECRET is required');
}

const instanceId = crypto.randomUUID();
const app = express();
const server = http.createServer(app);
if (process.env.PRESENCE_TEST_ISOLATION_FILE) {
  if (config.environment !== 'test') throw new Error('Isolation proof is test-only');
  const proof = JSON.parse(fs.readFileSync(process.env.PRESENCE_TEST_ISOLATION_FILE, 'utf8'));
  if (!proof.nonce || !proof.runId || !Array.isArray(proof.accounts)) throw new Error('Invalid owned isolation proof');
  app.get('/api/__test__/realtime-isolation', (_request, response) => response.json({ ...proof, outboundDeliveryBlocked: true }));
}
const redis = createClient({ url: config.redisUrl });
const pubClient = createClient({ url: config.redisUrl });
const subClient = pubClient.duplicate();

let redisReady = false;
let shuttingDown = false;

const localUserSockets = new Map();
const socketProfiles = new Map();
const meetingRooms = new Map();

function parseOrigins(value) {
  if (!value) {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:6300',
      'http://127.0.0.1:6300',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://play.zeacrm.com',
      'https://playapi.zeacrm.com',
    ];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeOrigin(origin) {
  try {
    if (typeof origin !== 'string' || /[\s\x00-\x1f\x7f\\,?#@]/.test(origin) || origin.endsWith('/') || origin.endsWith(':')) {
      return '';
    }
    const url = new URL(origin);
    const protocol = url.protocol.toLowerCase();
    if ((protocol !== 'http:' && protocol !== 'https:') || url.pathname !== '/' || url.username || url.password) {
      return '';
    }
    const defaultPort =
      (protocol === 'http:' && url.port === '80') ||
      (protocol === 'https:' && url.port === '443');
    const port = url.port && !defaultPort ? `:${url.port}` : '';
    return `${protocol}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return '';
  }
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return !config.requireOrigin;
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }
  if (config.corsOrigins.includes('*')) {
    return config.environment !== 'production';
  }
  const allowedOrigins = new Set(config.corsOrigins.map(normalizeOrigin).filter(Boolean));
  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }
  if (config.allowLocalhostOrigins) {
    try {
      const url = new URL(normalizedOrigin);
      return ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

function onlineKey(tenantId) {
  return `presence:tenant:${tenantId}:online_users`;
}

function userSocketsKey(tenantId, userId) {
  return `presence:tenant:${tenantId}:user:${userId}:sockets`;
}

function chatHistoryKey(tenantId, spaceId) {
  return `chat:tenant:${tenantId}:space:${spaceId}:history`;
}

function userSocketKey(profile) {
  return `${profile.tenantId}:${profile.id}`;
}

function buildUserRoom(tenantId, userId) {
  return `tenant:${tenantId}:user:${userId}`;
}

function buildChatRoom(tenantId, spaceId) {
  return `tenant:${tenantId}:chat:${spaceId}`;
}

function meetingRoomKey(tenantId, meetingId) {
  return `${tenantId}:${meetingId}`;
}

function buildMeetingRoom(tenantId, meetingId) {
  return `tenant:${tenantId}:meeting:${meetingId}`;
}

function extractToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }
  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === 'string') {
    const [scheme, token] = authHeader.split(/\s+/, 2);
    if (scheme?.toLowerCase() === 'bearer' && token) {
      return token.trim();
    }
  }
  return '';
}

function authenticateSocket(socket, next) {
  authenticateSocketRequest(socket, error => {
    if (error) authFailures.inc();
    next(error);
  });
}

function authenticateSocketRequest(socket, next) {
  const token = extractToken(socket);
  if (!token) {
    next(new Error('Authentication token required'));
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [config.jwtAlgorithm],
    });
    if (payload.token_type && payload.token_type !== 'access') {
      next(new Error('Invalid token type'));
      return;
    }
    if (payload.purpose === 'websocket' && (!Array.isArray(payload.scopes) ||
        !payload.scopes.some(scope => ['websocket:presence', 'websocket:calls', 'websocket:realtime'].includes(scope)))) {
      next(new Error('WebSocket ticket scope mismatch'));
      return;
    }

    const userId = String(payload.user_id || payload.sub || '').trim();
    if (!userId) {
      next(new Error('Token missing user id'));
      return;
    }

    socket.data.user = {
      id: userId,
      tenantId: String(payload.tenant_id || 'default'),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    };
    next();
  } catch {
    next(new Error('Invalid authentication token'));
  }
}

async function publishPresenceEvent(type, profile) {
  const payload = {
    kind: 'presence',
    instanceId,
    type,
    tenantId: profile.tenantId,
    userId: profile.id,
    at: new Date().toISOString(),
  };
  await pubClient.publish(config.eventsChannel, JSON.stringify(payload));
}

function emitPresenceToTenant(type, profile) {
  const payload = { userId: profile.id };
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.user?.tenantId !== profile.tenantId) {
      continue;
    }
    connectedSocket.emit(`presence:${type}`, payload);
    connectedSocket.emit(type === 'online' ? 'user_online' : 'user_offline', payload);
  }
}

async function markOnline(socket) {
  const profile = socket.data.user;
  const tenantOnlineKey = onlineKey(profile.tenantId);
  const tenantUserSocketsKey = userSocketsKey(profile.tenantId, profile.id);

  socket.join(buildUserRoom(profile.tenantId, profile.id));

  const localKey = userSocketKey(profile);
  const localSockets = localUserSockets.get(localKey) || new Set();
  const wasLocalOffline = localSockets.size === 0;
  localSockets.add(socket.id);
  localUserSockets.set(localKey, localSockets);
  presence.set(localUserSockets.size);
  socketProfiles.set(socket.id, profile);

  const socketCount = await redis.sAdd(tenantUserSocketsKey, socket.id);
  await redis.expire(tenantUserSocketsKey, 60 * 60 * 24);
  const userWasOffline = socketCount === 1;
  if (userWasOffline) {
    await redis.sAdd(tenantOnlineKey, profile.id);
    emitPresenceToTenant('online', profile);
    await publishPresenceEvent('online', profile);
  } else if (wasLocalOffline) {
    io.to(buildUserRoom(profile.tenantId, profile.id)).emit('presence:online', { userId: profile.id });
  }
}

async function markOffline(socket) {
  const profile = socketProfiles.get(socket.id);
  if (!profile) {
    return;
  }

  const localKey = userSocketKey(profile);
  const localSockets = localUserSockets.get(localKey);
  if (localSockets) {
    localSockets.delete(socket.id);
    if (localSockets.size === 0) {
      localUserSockets.delete(localKey);
      presence.set(localUserSockets.size);
    }
  }
  socketProfiles.delete(socket.id);

  const tenantUserSocketsKey = userSocketsKey(profile.tenantId, profile.id);
  const tenantOnlineKey = onlineKey(profile.tenantId);
  await redis.sRem(tenantUserSocketsKey, socket.id);
  const remaining = await redis.sCard(tenantUserSocketsKey);
  if (remaining === 0) {
    await redis.del(tenantUserSocketsKey);
    await redis.sRem(tenantOnlineKey, profile.id);
    emitPresenceToTenant('offline', profile);
    await publishPresenceEvent('offline', profile);
  }
}

function normalizeSpaceSnapshot(space, fallbackUserId) {
  if (!space || typeof space !== 'object') {
    return null;
  }
  const id = typeof space.id === 'string' ? space.id.trim() : '';
  if (!id) {
    return null;
  }
  const memberIds = Array.isArray(space.memberIds)
    ? [...new Set(space.memberIds.map(String).filter(Boolean))]
    : [fallbackUserId];
  return {
    id,
    name: typeof space.name === 'string' ? space.name : undefined,
    type: typeof space.type === 'string' ? space.type : undefined,
    memberIds,
    createdBy: typeof space.createdBy === 'string' ? space.createdBy : fallbackUserId,
    updatedAt: typeof space.updatedAt === 'string' ? space.updatedAt : new Date().toISOString(),
    lastMessage: typeof space.lastMessage === 'string' ? space.lastMessage : undefined,
  };
}

function normalizeMessage(message, userId) {
  if (!message || typeof message !== 'object') {
    throw new Error('Message payload is required');
  }
  const id = typeof message.id === 'string' ? message.id.trim() : crypto.randomUUID();
  const spaceId = typeof message.spaceId === 'string' ? message.spaceId.trim() : '';
  if (!spaceId) {
    throw new Error('spaceId is required');
  }
  const memberIds = Array.isArray(message.memberIds)
    ? [...new Set(message.memberIds.map(String).filter(Boolean))]
    : [];
  const space = normalizeSpaceSnapshot(message.space, userId);
  const resolvedMemberIds = memberIds.length > 0 ? memberIds : space?.memberIds || [userId];

  return {
    id,
    spaceId,
    authorId: typeof message.authorId === 'string' ? message.authorId : userId,
    body: typeof message.body === 'string' ? message.body : '',
    createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
    replyTo: typeof message.replyTo === 'string' ? message.replyTo : null,
    attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
    memberIds: resolvedMemberIds,
    space,
    reactions: message.reactions && typeof message.reactions === 'object' ? message.reactions : undefined,
  };
}

async function saveChatMessage(tenantId, message) {
  const key = chatHistoryKey(tenantId, message.spaceId);
  await redis.rPush(key, JSON.stringify(message));
  await redis.lTrim(key, -config.chatHistoryLimit, -1);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

async function getChatHistory(tenantId, spaceId) {
  const rows = await redis.lRange(chatHistoryKey(tenantId, spaceId), 0, -1);
  return rows
    .map((row) => {
      try {
        return JSON.parse(row);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getSocketMeetings(socket) {
  if (!socket.data.meetings) {
    socket.data.meetings = new Set();
  }
  return socket.data.meetings;
}

function normalizeParticipant(socket, payload = {}) {
  const profile = socket.data.user;
  return {
    socketId: socket.id,
    userId: profile.id,
    displayName: typeof payload.displayName === 'string' && payload.displayName.trim()
      ? payload.displayName.trim()
      : profile.id,
    avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
    audioEnabled: payload.audioEnabled !== false,
    videoEnabled: payload.videoEnabled !== false,
    screenSharing: Boolean(payload.screenSharing),
  };
}

function emitMeetingParticipants(tenantId, meetingId) {
  const participants = Array.from((meetingRooms.get(meetingRoomKey(tenantId, meetingId)) || new Map()).values());
  io.to(buildMeetingRoom(tenantId, meetingId)).emit('meeting:participants', { meetingId, participants });
}

function exceedsConnectionLimits(profile) {
  const localUserCount = localUserSockets.get(userSocketKey(profile))?.size || 0;
  if (config.maxConnectionsPerUser > 0 && localUserCount >= config.maxConnectionsPerUser) {
    console.warn(`[presence] user connection limit user=${profile.id} active=${localUserCount} limit=${config.maxConnectionsPerUser}`);
    return true;
  }
  const totalConnections = io.engine.clientsCount || 0;
  if (config.maxTotalConnections > 0 && totalConnections > config.maxTotalConnections) {
    console.warn(`[presence] total connection limit active=${totalConnections} limit=${config.maxTotalConnections}`);
    return true;
  }
  return false;
}

function leaveMeetingRoom(socket, meetingId) {
  const profile = socket.data.user;
  const roomKey = meetingRoomKey(profile.tenantId, meetingId);
  const roomName = buildMeetingRoom(profile.tenantId, meetingId);
  const room = meetingRooms.get(roomKey);
  if (!room) {
    socket.leave(roomName);
    return;
  }
  const participant = room.get(socket.id);
  room.delete(socket.id);
  socket.leave(roomName);
  getSocketMeetings(socket).delete(meetingId);
  if (participant) {
    socket.to(roomName).emit('meeting:participant_left', {
      meetingId,
      socketId: socket.id,
      userId: participant.userId,
    });
  }
  if (room.size === 0) {
    meetingRooms.delete(roomKey);
  } else {
    emitMeetingParticipants(profile.tenantId, meetingId);
  }
}

const io = new Server(server, {
  allowRequest(request, callback) {
    const allowed = isAllowedOrigin(request.headers.origin);
    if (!allowed) metricErrors.inc({ kind: 'origin' });
    callback(null, allowed);
  },
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

io.use(authenticateSocket);
app.get('/internal/metrics', metricsRoute);

app.get('/health', async (_req, res) => {
  let redisStatus = redisReady ? 'ok' : 'unavailable';
  try {
    await redis.ping();
    redisStatus = 'ok';
  } catch {
    redisStatus = 'unavailable';
  }
  const statusCode = redisStatus === 'ok' ? 200 : 503;
  res.status(statusCode).json({
    status: redisStatus === 'ok' ? 'ok' : 'degraded',
    service: 'zeaplay-presence',
    redis: redisStatus,
  });
});

io.on('connection', async (socket) => {
  const on = instrument(socket);
  const profile = socket.data.user;
  if (exceedsConnectionLimits(profile)) {
    socket.emit('presence:error', { code: 'connection_limit' });
    socket.disconnect(true);
    return;
  }
  console.log(`[presence] socket connected user=${profile.id} tenant=${profile.tenantId} active=${io.engine.clientsCount}`);

  on('presence:get', async (ack) => {
    try {
      const users = await redis.sMembers(onlineKey(profile.tenantId));
      ack?.({ ok: true, users });
    } catch (error) {
      console.error('[presence] presence:get failed', error?.constructor?.name || 'Error');
      ack?.({ ok: false, error: 'Presence unavailable' });
    }
  });

  on('presence:ping', async (ack) => {
    try {
      await redis.expire(userSocketsKey(profile.tenantId, profile.id), 60 * 60 * 24);
      ack?.({ ok: true });
    } catch {
      metricErrors.inc({ kind: 'presence_heartbeat' });
      ack?.({ ok: false });
    }
  });

  on('chat:join', async (payload, ack) => {
    try {
      const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
      if (!spaceId) {
        ack?.({ ok: false, error: 'spaceId is required' });
        return;
      }
      socket.join(buildChatRoom(profile.tenantId, spaceId));
      const history = await getChatHistory(profile.tenantId, spaceId);
      ack?.({ ok: true, history });
    } catch (error) {
      console.error('[chat] join failed', error?.constructor?.name || 'Error');
      ack?.({ ok: false, error: 'Failed to join chat' });
    }
  });

  on('chat:leave', (payload) => {
    const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
    if (spaceId) {
      socket.leave(buildChatRoom(profile.tenantId, spaceId));
    }
  });

  on('chat:message', async (payload, ack) => {
    try {
      const message = normalizeMessage(payload, profile.id);
      await saveChatMessage(profile.tenantId, message);

      const recipients = new Set(message.memberIds || []);
      recipients.add(profile.id);
      if (message.space?.memberIds) {
        message.space.memberIds.forEach((memberId) => recipients.add(memberId));
      }

      io.to(buildChatRoom(profile.tenantId, message.spaceId)).emit('chat:message', message);
      for (const memberId of recipients) {
        io.to(buildUserRoom(profile.tenantId, memberId)).emit('chat:message', message);
      }

      ack?.({ ok: true, message });
    } catch (error) {
      const message = 'Failed to send message';
      ack?.({ ok: false, error: message });
    }
  });

  on('chat:typing', (payload) => {
    const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
    if (!spaceId) {
      return;
    }
    socket.to(buildChatRoom(profile.tenantId, spaceId)).emit('chat:typing', {
      spaceId,
      userId: profile.id,
      isTyping: Boolean(payload.isTyping),
      preview: typeof payload.preview === 'string' ? payload.preview : undefined,
    });
  });

  on('chat:reaction', (payload, ack) => {
    const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId.trim() : '';
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    const reaction = typeof payload?.reaction === 'string' ? payload.reaction.trim() : '';
    if (!spaceId || !messageId || !reaction) {
      ack?.({ ok: false, error: 'spaceId, messageId and reaction are required' });
      return;
    }
    const event = { spaceId, messageId, reaction, userId: profile.id };
    io.to(buildChatRoom(profile.tenantId, spaceId)).emit('chat:reaction', event);
    ack?.({ ok: true });
  });

  on('chat:space', (payload) => {
    const space = normalizeSpaceSnapshot(payload?.space || payload, profile.id);
    if (!space) {
      return;
    }
    const event = {
      ...space,
      memberIds: space.memberIds.length > 0 ? space.memberIds : [profile.id],
    };
    socket.join(buildChatRoom(profile.tenantId, event.id));
    io.to(buildChatRoom(profile.tenantId, event.id)).emit('chat:space', event);
    event.memberIds.forEach((memberId) => {
      io.to(buildUserRoom(profile.tenantId, memberId)).emit('chat:space', event);
    });
  });

  on('call:initiate', (payload, ack) => {
    const recipientId = typeof payload?.recipientId === 'string' ? payload.recipientId.trim() : '';
    if (!recipientId) {
      ack?.({ ok: false, error: 'recipientId is required' });
      return;
    }
    io.to(buildUserRoom(profile.tenantId, recipientId)).emit('call:incoming', {
      callerId: profile.id,
      callerName: typeof payload?.callerName === 'string' ? payload.callerName : profile.id,
      callerAvatar: typeof payload?.callerAvatar === 'string' ? payload.callerAvatar : undefined,
      callerTitle: typeof payload?.callerTitle === 'string' ? payload.callerTitle : undefined,
      callType: payload?.callType === 'video' ? 'video' : 'audio',
      conversationId: typeof payload?.conversationId === 'string' ? payload.conversationId : undefined,
      signalData: payload?.signalData,
    });
    ack?.({ ok: true });
  });

  on('call:answer', (payload, ack) => {
    const callerId = typeof payload?.callerId === 'string' ? payload.callerId.trim() : '';
    if (!callerId) {
      ack?.({ ok: false, error: 'callerId is required' });
      return;
    }
    io.to(buildUserRoom(profile.tenantId, callerId)).emit('call:answered', {
      responderId: profile.id,
      signalData: payload?.signalData,
    });
    ack?.({ ok: true });
  });

  on('call:candidate', (payload) => {
    const targetUserId = typeof payload?.targetUserId === 'string' ? payload.targetUserId.trim() : '';
    if (!targetUserId) {
      return;
    }
    io.to(buildUserRoom(profile.tenantId, targetUserId)).emit('call:candidate', {
      fromUserId: profile.id,
      candidate: payload?.candidate,
    });
  });

  on('call:reject', (payload) => {
    const callerId = typeof payload?.callerId === 'string' ? payload.callerId.trim() : '';
    if (callerId) {
      io.to(buildUserRoom(profile.tenantId, callerId)).emit('call:rejected', { responderId: profile.id });
    }
  });

  on('call:end', (payload) => {
    const targetUserId = typeof payload?.targetUserId === 'string' ? payload.targetUserId.trim() : '';
    if (targetUserId) {
      io.to(buildUserRoom(profile.tenantId, targetUserId)).emit('call:ended', { fromUserId: profile.id });
    }
  });

  on('meeting:join', (payload, ack) => {
    const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId.trim() : '';
    if (!meetingId) {
      ack?.({ ok: false, error: 'meetingId is required' });
      return;
    }
    const participant = normalizeParticipant(socket, payload?.userInfo || payload);
    const roomKey = meetingRoomKey(profile.tenantId, meetingId);
    const room = meetingRooms.get(roomKey) || new Map();
    room.set(socket.id, participant);
    meetingRooms.set(roomKey, room);
    getSocketMeetings(socket).add(meetingId);
    socket.join(buildMeetingRoom(profile.tenantId, meetingId));
    socket.to(buildMeetingRoom(profile.tenantId, meetingId)).emit('meeting:participant_joined', { meetingId, participant });
    emitMeetingParticipants(profile.tenantId, meetingId);
    ack?.({ ok: true, participants: Array.from(room.values()) });
  });

  on('meeting:media_state', (payload) => {
    const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId.trim() : '';
    const room = meetingId ? meetingRooms.get(meetingRoomKey(profile.tenantId, meetingId)) : null;
    const participant = room?.get(socket.id);
    if (!room || !participant) {
      return;
    }
    room.set(socket.id, {
      ...participant,
      audioEnabled: payload?.audioEnabled !== false,
      videoEnabled: payload?.videoEnabled !== false,
      screenSharing: Boolean(payload?.screenSharing),
    });
    emitMeetingParticipants(profile.tenantId, meetingId);
  });

  on('meeting:leave', (payload) => {
    const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId.trim() : '';
    if (meetingId) {
      leaveMeetingRoom(socket, meetingId);
    }
  });

  socket.on('disconnect', async (reason) => {
    console.log(`[presence] socket disconnected user=${profile.id} reason=${reason} active=${io.engine.clientsCount}`);
    try {
      for (const meetingId of Array.from(getSocketMeetings(socket))) {
        leaveMeetingRoom(socket, meetingId);
      }
      await markOffline(socket);
    } catch (error) {
      console.error('[presence] failed to mark offline', error?.constructor?.name || 'Error');
    }
  });

  try {
    await markOnline(socket);
  } catch (error) {
    console.error('[presence] failed to mark online', error?.constructor?.name || 'Error');
    socket.disconnect(true);
  }
});

async function start() {
  for (const [name, client] of [['command', redis], ['publisher', pubClient], ['subscriber', subClient]]) {
    adapter.set({ client: name }, 0);
    client.on('ready', () => adapter.set({ client: name }, 1));
    client.on('reconnecting', () => { adapter.set({ client: name }, 0); metricErrors.inc({ kind: 'redis_reconnect' }); });
    client.on('end', () => adapter.set({ client: name }, 0));
    client.on('error', (error) => {
      adapter.set({ client: name }, 0);
      metricErrors.inc({ kind: 'redis' });
      if (!shuttingDown) {
        console.error('[redis] error', error?.constructor?.name || 'Error');
      }
    });
  }

  await Promise.all([redis.connect(), pubClient.connect(), subClient.connect()]);
  redisReady = true;
  io.adapter(createAdapter(pubClient, subClient));

  await subClient.subscribe(config.eventsChannel, (raw) => {
    try {
      const event = JSON.parse(raw);
      if (event.instanceId === instanceId || event.kind !== 'presence') {
        return;
      }
      emitPresenceToTenant(event.type, {
        id: event.userId,
        tenantId: event.tenantId,
      });
    } catch (error) {
      console.error('[presence] invalid pubsub payload', error?.constructor?.name || 'Error');
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[presence] listening on 0.0.0.0:${config.port}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[presence] shutting down after ${signal}`);
  io.close();
  server.close();
  await Promise.allSettled([
    redis.quit(),
    pubClient.quit(),
    subClient.quit(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((error) => {
  console.error('[presence] failed to start', error?.constructor?.name || 'Error');
  process.exit(1);
});
