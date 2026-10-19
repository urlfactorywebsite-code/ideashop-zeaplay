import http from 'k6/http';
import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'k6/timers';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Rate, Counter } from 'k6/metrics';

if (__ENV.ZEAPLAY_LOAD_ENABLED !== 'I_APPROVE_ISOLATED_LOAD_TESTING' || !__ENV.ZEAPLAY_LOAD_CONFIG) throw new Error('Use the approved run.mjs launcher');
const config = JSON.parse(__ENV.ZEAPLAY_LOAD_CONFIG);
const accounts = JSON.parse(open(__ENV.ZEAPLAY_LOAD_ACCOUNTS_FILE));
const failed = new Rate('realtime_failures');
const delivery = new Trend('realtime_delivery_ms', true);
const handshakes = new Trend('realtime_handshake_ms', true);
const received = new Counter('realtime_verified_deliveries');
const snapshot = new Trend('realtime_snapshot_verified_ms', true);
const now = () => exec.instance.currentTestRunDuration;
let lastMutationSlot = -1;
export const options = {
  scenarios: { realtime: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '10s', target: config.users }, { duration: `${config.seconds}s`, target: config.users }, { duration: '10s', target: 0 },
  ], gracefulRampDown: '5s', gracefulStop: '5s' } },
  maxRedirects: 0,
  rps: config.requestRate,
  systemTags: ['status', 'method', 'name', 'scenario', 'group', 'check', 'expected_response'],
  thresholds: {
    realtime_failures: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    realtime_delivery_ms: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '20s' }],
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    checks: ['rate>0.99'],
  },
};

function workload(vu) {
  if (config.scenario !== 'mixed') return ['chat', 'tasks', 'tickets'].includes(config.scenario) ? config.scenario : 'tasks';
  let slot = (vu * 37) % 100;
  for (const [name, weight] of Object.entries(config.weights)) { slot -= weight; if (slot < 0) return ['presence', 'calls', 'idle'].includes(name) ? 'idle' : name; }
  return 'idle';
}

export default function () {
  if (__VU > config.users || Date.now() >= Date.parse(config.expiresAt)) exec.test.abort('Approval expired or user ceiling exceeded');
  const account = accounts[__VU - 1];
  // Per-identity request budget includes ticket requests and retries; never hot-loop on failure.
  sleep(Math.max(1, config.users * 3 / config.requestRate));
  const feature = config.scenario === 'cross-worker' ? 'chat' : workload(__VU);
  const mutationTarget = config.scenario === 'cross-worker' ? config.workerTargets[0] : config.target;
  const receiverTarget = config.scenario === 'cross-worker' ? config.workerTargets[1] : config.target;
  const endpoint = feature === 'tickets' ? `tickets/${account.ticketId}` : feature === 'chat' ? 'chat' : 'tasks';
  const scope = endpoint.startsWith('tickets/') ? 'tickets' : endpoint;
  const headers = { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' };
  const ticket = http.get(`${config.target}/api/auth/websocket-ticket?scope=${scope}`, { headers, tags: { name: 'websocket-ticket' }, timeout: '5s' });
  if (!check(ticket, { 'authorized ticket issued': r => r.status === 200 && Boolean(r.json('access_token')) })) { failed.add(true); return; }
  const credential = ticket.json('access_token');
  let counter = 0;
  for (let session = 0; session < config.sessions; session++) {
    const started = now();
    const ws = new WebSocket(`${receiverTarget.replace(/^http/, 'ws')}/api/ws/${endpoint}?token=${encodeURIComponent(credential)}`, [], { headers: { Origin: config.origin }, tags: { name: `ws-${scope}` } });
    const pending = new Map();
    const verifying = new Set();
    let interval, verified = false, closed = false, joined = feature !== 'chat';
    const sessionMs = config.scenario === 'reconnect' ? 3000 : Math.max(1000, (config.seconds + 10) * 1000 - now());
    const closeTimer = setTimeout(() => ws.close(), sessionMs);
    ws.addEventListener('open', () => {
      handshakes.add(now() - started);
      if (feature === 'chat') ws.send(JSON.stringify({ type: 'chat:join', payload: { conversation_id: account.conversationId } }));
      interval = setInterval(() => {
        if (!joined || session !== 0 || ['idle', 'reconnect', 'redis-recovery', 'shutdown'].includes(config.scenario) || feature === 'idle') return;
        if (now() >= (config.seconds + 10) * 1000 - 5000) return; // Drain bounded in-flight requests before cooldown.
        // Disjoint wall-clock slots bound application mutations across all VUs.
        // A missed slot is skipped, never caught up in a burst.
        const slot = Math.floor(now() * config.eventRate / 1000);
        if (slot % config.users !== __VU - 1 || slot <= lastMutationSlot) return;
        lastMutationSlot = slot;
        // At most one mutation outstanding; deterministic per-VU pacing bounds total event rate.
        if (pending.size) return;
        const correlation = `${config.runId}-${__VU}-${__ITER}-${counter++}`;
        pending.set(correlation, now());
        if (feature === 'chat') {
          http.asyncRequest('POST', `${mutationTarget}/api/chat/conversations/${account.conversationId}/messages`, JSON.stringify({ content: correlation, client_id: correlation }), { headers, timeout: '5s', tags: { name: 'synthetic-chat-create' } })
            .then(r => { if (r.status !== 201) { failed.add(true); pending.delete(correlation); } }).catch(() => failed.add(true));
        } else if (feature === 'tasks') {
          http.asyncRequest('PATCH', `${mutationTarget}/api/tasks/${account.taskId}`, JSON.stringify({ description: correlation }), { headers, timeout: '5s', tags: { name: 'synthetic-task-edit' } })
            .then(r => { if (r.status !== 200) { failed.add(true); pending.delete(correlation); } }).catch(() => failed.add(true));
        } else {
          ws.send(JSON.stringify({ type: 'comment', body: correlation, is_internal: false }));
        }
      }, Math.max(20, Math.floor(500 / config.eventRate)));
    });
    ws.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(event.data); } catch { failed.add(true); return; }
      if (data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (data.type === 'error') { failed.add(true); return; }
      if (data.type === 'chat:joined') { joined = data.payload?.conversation_id === account.conversationId; verified = joined; }
      if (data.type === 'realtime:ready') verified = true;
      for (const [id, at] of pending) {
        const message = data.comment || data.payload?.message || data.payload || data;
        const matches = feature === 'chat' ? message.content === id || message.client_id === id : feature === 'tickets' ? (message.body === id && String(message.ticket_id) === account.ticketId) : data.type === 'task.changed' && data.task_id === account.taskId;
        if (matches) {
          // Task events are invalidations, not proof of the correlated durable edit.
          if (feature === 'tasks') {
            if (verifying.has(id)) continue;
            verifying.add(id);
            const receivedAt = now();
            http.asyncRequest('GET', `${mutationTarget}/api/tasks/${account.taskId}`, null, { headers, timeout: '5s', tags: { name: 'verify-task-snapshot' } })
              .then(state => {
                if (!closed && pending.has(id) && state.status === 200 && state.json('description') === id) {
                  delivery.add(receivedAt - at); snapshot.add(now() - at); received.add(1); pending.delete(id);
                }
              }).catch(() => failed.add(true)).finally(() => verifying.delete(id));
            continue;
          }
          delivery.add(now() - at); received.add(1); pending.delete(id); verified = true;
        }
      }
    });
    ws.addEventListener('error', () => failed.add(true));
    ws.addEventListener('close', () => {
      closed = true;
      clearTimeout(closeTimer); if (interval) clearInterval(interval);
      failed.add(!verified || pending.size > 0);
      check(verified && pending.size === 0, { 'authorized ready/join and all expected events received': value => value });
    });
  }
}
