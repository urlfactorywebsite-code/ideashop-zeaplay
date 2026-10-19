import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));

test('real Socket.IO presence, tenant-scoped calls and meeting signaling', {
  skip: !process.env.ZEAPLAY_RT_REDIS_TEST_URL,
  timeout: 30000,
}, async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const { io } = requireFrontend('socket.io-client');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const tenant = randomUUID();
  const secret = randomUUID();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
    env: { ...process.env, PRESENCE_PORT: String(port), PRESENCE_REDIS_URL: process.env.ZEAPLAY_RT_REDIS_TEST_URL,
      PRESENCE_JWT_SECRET: secret, PRESENCE_EVENTS_CHANNEL: `rt3-test:${randomUUID()}`, PRESENCE_REQUIRE_ORIGIN: 'true',
      PRESENCE_CORS_ORIGINS: 'https://trusted.example', PRESENCE_ALLOW_LOCALHOST_ORIGINS: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const sockets = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Isolated presence process did not become ready');
    const connectUser = async (userId, tenantId = tenant, options = {}) => {
      const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false,
        timeout: 2000, extraHeaders: options.origin === null ? {} : { Origin: options.origin || 'https://trusted.example' },
        auth: { token: options.token || jwt.sign({ user_id: userId, tenant_id: tenantId, token_type: 'access' }, secret, { expiresIn: '2m' }) } });
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    };
    for (const origin of ['https://trusted.example/path', 'https://user@trusted.example', 'https://evil.example', null]) {
      await assert.rejects(connectUser('denied', tenant, { origin }));
    }
    await assert.rejects(connectUser('denied', tenant, { token: 'not-a-jwt' }));
    await assert.rejects(connectUser('denied', tenant, { token: jwt.sign({ user_id: 'denied', tenant_id: tenant, token_type: 'access' }, secret, { expiresIn: -1 }) }));
    for (const scope of ['chat', 'tasks', 'tickets']) {
      await assert.rejects(connectUser('denied', tenant, { token: jwt.sign({ user_id: 'denied', tenant_id: tenant,
        token_type: 'access', purpose: 'websocket', scopes: [`websocket:${scope}`] }, secret, { expiresIn: '2m' }) }));
    }
    const scoped = await connectUser('scoped-user', tenant, { token: jwt.sign({ user_id: 'scoped-user', tenant_id: tenant,
      token_type: 'access', purpose: 'websocket', scopes: ['websocket:presence'] }, secret, { expiresIn: '2m' }) });
    scoped.disconnect();
    const a = await connectUser('a');
    const b = await connectUser('b');
    const foreign = await connectUser('b', randomUUID());
    let leaked = 0;
    foreign.on('call:incoming', () => leaked++);
    const next = (socket, name) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off(name, receive); reject(new Error(`Missing ${name}`)); }, 5000);
      function receive(value) { clearTimeout(timeout); resolve(value); }
      socket.once(name, receive);
    });
    const incoming = next(b, 'call:incoming');
    a.emit('call:initiate', { recipientId: 'b', signalData: { type: 'offer', sdp: 'test-offer' } });
    assert.equal((await incoming).callerId, 'a');
    const answered = next(a, 'call:answered');
    b.emit('call:answer', { callerId: 'a', signalData: { type: 'answer', sdp: 'test-answer' } });
    assert.equal((await answered).responderId, 'b');
    const candidate = next(b, 'call:candidate');
    a.emit('call:candidate', { targetUserId: 'b', candidate: { candidate: 'test-candidate' } });
    assert.equal((await candidate).fromUserId, 'a');
    const rejected = next(a, 'call:rejected');
    b.emit('call:reject', { callerId: 'a' });
    assert.equal((await rejected).responderId, 'b');
    const meetingId = randomUUID();
    await a.timeout(5000).emitWithAck('meeting:join', { meetingId });
    const joined = await b.timeout(5000).emitWithAck('meeting:join', { meetingId });
    assert.equal(joined.participants.length, 2);
    b.emit('meeting:leave', { meetingId });
    const ended = next(b, 'call:ended');
    a.emit('call:end', { targetUserId: 'b' });
    await ended;
    await delay(100);
    assert.equal(leaked, 0);
    const presence = await a.timeout(5000).emitWithAck('presence:get');
    assert.ok(presence.users.includes('a') && presence.users.includes('b'));
  } finally {
    sockets.forEach(socket => socket.disconnect());
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
});
