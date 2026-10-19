import crypto from 'node:crypto';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'zea_node_' });
const counter = (name, help, labelNames = []) => new Counter({ name, help, labelNames, registers: [registry] });
const gauge = (name, help, labelNames = []) => new Gauge({ name, help, labelNames, registers: [registry] });
export const connections = counter('zea_io_connections_total', 'Authenticated Socket.IO namespace connections');
export const authFailures = counter('zea_io_auth_failures_total', 'Rejected namespace authentication');
export const errors = counter('zea_io_errors_total', 'Bounded error categories', ['kind']);
export const disconnects = counter('zea_io_disconnects_total', 'Socket.IO disconnections', ['reason']);
export const clients = gauge('zea_io_clients', 'Authenticated locally owned sockets');
export const presence = gauge('zea_io_presence_sessions', 'Local distinct online tenant/user sessions');
export const adapter = gauge('zea_io_redis_up', 'Ready Redis command/publisher/subscriber clients', ['client']);
export const signaling = gauge('zea_io_signaling_contexts', 'Local sockets with unclosed call signaling context; NOT verified media sessions');
const events = counter('zea_io_events_total', 'Socket.IO application packets, excluding acks', ['event', 'direction']);
const duration = new Histogram({ name: 'zea_io_handler_seconds', help: 'Application handler duration', labelNames: ['event'], registers: [registry] });
const names = new Set(['presence:get', 'presence:ping', 'chat:join', 'chat:leave', 'chat:message', 'chat:typing', 'chat:reaction', 'chat:space',
  'call:initiate', 'call:answer', 'call:candidate', 'call:reject', 'call:end', 'meeting:join', 'meeting:leave', 'meeting:media_state',
  'call:incoming', 'call:answered', 'call:ended', 'call:rejected', 'presence:online', 'presence:offline', 'presence:error',
  'user_online', 'user_offline', 'meeting:participants', 'meeting:participant_joined', 'meeting:participant_left']);
const label = name => names.has(name) ? name : 'other';

export function instrument(socket) {
  connections.inc();
  clients.inc();
  let context = false;
  socket.onAny((event) => {
    events.inc({ event: label(event), direction: 'in' });
  });
  socket.onAnyOutgoing(event => {
    events.inc({ event: label(event), direction: 'out' });
    if (['call:ended', 'call:rejected'].includes(event) && context) { signaling.dec(); context = false; }
  });
  socket.once('disconnect', reason => {
    clients.dec();
    disconnects.inc({ reason: ['ping timeout', 'transport close', 'transport error', 'server namespace disconnect', 'client namespace disconnect'].includes(reason) ? reason : 'other' });
    if (reason === 'ping timeout') errors.inc({ kind: 'heartbeat' });
    if (context) { signaling.dec(); context = false; }
  });
  return (event, handler) => socket.on(event, (...args) => {
    const started = performance.now();
    if ((event === 'call:initiate' && args[0]?.recipientId || event === 'call:answer' && args[0]?.callerId) && !context) { context = true; signaling.inc(); }
    if (['call:end', 'call:reject'].includes(event) && context) { context = false; signaling.dec(); }
    const done = () => duration.observe({ event: label(event) }, (performance.now() - started) / 1000);
    const last = args.length - 1;
    if (typeof args[last] === 'function' && event.startsWith('call:')) {
      const ack = args[last];
      args[last] = (...values) => {
        if (values[0]?.ok === false) errors.inc({ kind: 'signaling' });
        return ack(...values);
      };
    }
    try {
      const result = handler(...args);
      if (result?.then) return result.then(value => { done(); return value; }, error => {
        done(); errors.inc({ kind: event.startsWith('call:') ? 'signaling' : 'handler' }); throw error;
      });
      done();
      return result;
    } catch (error) { done(); errors.inc({ kind: event.startsWith('call:') ? 'signaling' : 'handler' }); throw error; }
  });
}

export async function metricsRoute(req, res) {
  let token = process.env.ZEAPLAY_METRICS_TOKEN || '';
  if (!token && process.env.ZEAPLAY_METRICS_TOKEN_FILE) {
    try { token = fs.readFileSync(process.env.ZEAPLAY_METRICS_TOKEN_FILE, 'utf8').trim(); } catch { /* Fail closed. */ }
  }
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (token.length < 32 || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    res.sendStatus(404);
    return;
  }
  res.set('Cache-Control', 'no-store');
  try {
    res.type(registry.contentType).send(await registry.metrics());
  } catch {
    res.status(503).end();
  }
}
