import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfiguration } from './safety.mjs';
import { waitForEvent, connectSocket, nearestRank } from './client-utils.mjs';

// Reuse the app's official v4 client; no raw-WS approximation or new runtime dependency.
const { io } = createRequire(new URL('../../frontend/package.json', import.meta.url))('socket.io-client');
const { config, accounts } = loadConfiguration();
if (!process.env.ZEAPLAY_LOAD_CONFIG) throw new Error('Use run.mjs with explicit --run');
if (JSON.stringify(config) !== process.env.ZEAPLAY_LOAD_CONFIG) throw new Error('Approval changed after launcher validation');
const sockets = [];
const latencies = [];
let failures = 0, attempts = 0;
let ackSamples = 0, activeConnections = 0, peakConnections = 0, peakUsers = 0;
const connectedUsers = new Map();
const observations = new Set();
function next(socket, event) {
  const observation = waitForEvent(socket, event);
  observations.add(observation);
  observation.promise.finally(() => observations.delete(observation)).catch(() => {});
  return observation.promise;
}
async function ack(socket, event, payload) {
  const start = performance.now();
  const result = await socket.timeout(5000).emitWithAck(event, ...(payload === undefined ? [] : [payload]));
  assert.equal(result.ok, true);
  latencies[ackSamples++ % 100000] = performance.now() - start;
  return result;
}
const started = performance.now();
let steadyStarted = null, steadyStopped = null;
try {
  // Gradual connection ramp. One shared token per synthetic identity, multiple sockets if selected.
  for (const account of accounts) {
    for (let session = 0; session < config.sessions; session++) {
      const response = await fetch(`${config.target}/api/auth/websocket-ticket?scope=presence`, { headers: { Authorization: `Bearer ${account.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const ticket = await response.json();
      const socket = io(config.presenceTargets[sockets.length % config.presenceTargets.length], { autoConnect: false, auth: { token: ticket.access_token }, extraHeaders: { Origin: config.origin }, transports: ['websocket'], reconnection: false, timeout: 5000 });
      sockets.push(socket);
      let counted = false;
      socket.on('connect', () => {
        if (counted) return;
        counted = true;
        activeConnections++;
        connectedUsers.set(account.userId, (connectedUsers.get(account.userId) || 0) + 1);
        peakConnections = Math.max(peakConnections, activeConnections);
        peakUsers = Math.max(peakUsers, connectedUsers.size);
      });
      socket.on('disconnect', () => {
        if (!counted) return;
        counted = false;
        activeConnections--;
        const remaining = connectedUsers.get(account.userId) - 1;
        if (remaining) connectedUsers.set(account.userId, remaining);
        else connectedUsers.delete(account.userId);
      });
      await connectSocket(socket);
      await ack(socket, 'presence:get');
    }
    await sleep(Math.max(10000 / config.users, 2000 * config.sessions / config.requestRate));
  }
  steadyStarted = performance.now();
  const deadline = steadyStarted + config.seconds * 1000;
  if (deadline + 5000 > started + config.maxSeconds * 1000) throw new Error('Insufficient duration budget for the requested sustained phase');
  let step = 0;
  while (performance.now() < deadline && Date.now() < Date.parse(config.expiresAt)) {
    const index = step++ % accounts.length;
    const a = sockets[index * config.sessions];
    const bIndex = (index + 1) % accounts.length;
    const b = sockets[bIndex * config.sessions];
    attempts++;
    try {
      await ack(a, 'presence:ping');
      if (config.scenario === 'mixed' && accounts[index].tenantId === accounts[bIndex].tenantId && accounts[index].userId !== accounts[bIndex].userId && step % Math.max(1, Math.round(100 / Math.max(1, config.weights.calls))) === 0 && config.weights.calls > 0) {
        const incoming = next(b, 'call:incoming');
        await ack(a, 'call:initiate', { recipientId: accounts[bIndex].userId, signalData: { type: 'offer', sdp: 'synthetic-signaling-only' } });
        assert.equal((await incoming).callerId, accounts[index].userId);
        const answer = next(a, 'call:answered');
        await ack(b, 'call:answer', { callerId: accounts[index].userId, signalData: { type: 'answer', sdp: 'synthetic-signaling-only' } });
        assert.equal((await answer).responderId, accounts[bIndex].userId);
        const candidate = next(b, 'call:candidate');
        a.emit('call:candidate', { targetUserId: accounts[bIndex].userId, candidate: { candidate: 'synthetic-only' } });
        assert.equal((await candidate).fromUserId, accounts[index].userId);
        const ended = next(b, 'call:ended');
        a.emit('call:end', { targetUserId: accounts[bIndex].userId });
        assert.equal((await ended).fromUserId, accounts[index].userId);
        const rejected = next(a, 'call:rejected');
        const secondIncoming = next(b, 'call:incoming');
        await ack(a, 'call:initiate', { recipientId: accounts[bIndex].userId, signalData: { type: 'offer', sdp: 'synthetic-signaling-only' } });
        assert.equal((await secondIncoming).callerId, accounts[index].userId);
        b.emit('call:reject', { callerId: accounts[index].userId });
        assert.equal((await rejected).responderId, accounts[bIndex].userId);
      }
      if (config.scenario === 'mixed') {
        const meetingId = `synthetic-${config.runId}`;
        const result = await ack(a, 'meeting:join', { meetingId });
        assert.ok(Array.isArray(result.participants));
        a.emit('meeting:leave', { meetingId });
      }
      if (config.scenario === 'reconnect') {
        a.disconnect();
        const response = await fetch(`${config.target}/api/auth/websocket-ticket?scope=presence`, { headers: { Authorization: `Bearer ${accounts[index].accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        a.auth = { token: (await response.json()).access_token };
        await connectSocket(a);
      }
    } catch {
      for (const observation of observations) observation.cancel();
      failures++;
    }
    if (attempts >= 10 && failures / attempts > 0.05) throw new Error('Safety stop: error rate exceeds 5 percent');
    await sleep(1000 / Math.min(config.eventRate / 10, config.requestRate / 2)); // Budget low rates too; never clamp to one operation/sec.
  }
  steadyStopped = performance.now();
  await sleep(5000); // Connected cooldown; no application events.
} finally {
  for (const observation of observations) observation.cancel();
  for (const socket of sockets) socket.disconnect();
  latencies.sort((a,b) => a-b);
  const percentile = q => nearestRank(latencies, q);
  console.log(JSON.stringify({ tool: 'socketio', measured: true, attempts, failures, connectionsCreated: sockets.length,
    peakConnections, peakUsers, ackSamples, ackSamplesRetained: latencies.length, ackSamplePolicy: 'last-100000',
    sustainedSeconds: steadyStarted === null ? 0 : ((steadyStopped ?? performance.now()) - steadyStarted) / 1000,
    durationSeconds: (performance.now()-started)/1000, ackMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, mediaCapacity: 'NOT MEASURED' }));
}
if (failures) process.exitCode = 1;
