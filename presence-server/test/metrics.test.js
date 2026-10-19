import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { instrument, registry, metricsRoute } from '../src/metrics.js';

test('metrics route hides itself without a valid bearer and never exposes credentials', async () => {
  const original = process.env.ZEAPLAY_METRICS_TOKEN;
  const response = { sendStatus(code) { this.status = code; }, set() {}, type() { return this; }, send(body) { this.body = body; } };
  try {
    delete process.env.ZEAPLAY_METRICS_TOKEN;
    await metricsRoute({ headers: {} }, response);
    assert.equal(response.status, 404);
    process.env.ZEAPLAY_METRICS_TOKEN = 'synthetic-unit-metric-token-123456789';
    await metricsRoute({ headers: { authorization: `Bearer ${process.env.ZEAPLAY_METRICS_TOKEN}` } }, response);
    assert.match(response.body, /zea_io_clients/);
    assert.ok(!response.body.includes(process.env.ZEAPLAY_METRICS_TOKEN));
  } finally {
    if (original === undefined) delete process.env.ZEAPLAY_METRICS_TOKEN;
    else process.env.ZEAPLAY_METRICS_TOKEN = original;
  }
});
test('handler signatures, promise values and disconnect cleanup remain compatible', async () => {
  const socket = new EventEmitter();
  socket.onAny = handler => { socket.any = handler; };
  socket.onAnyOutgoing = handler => { socket.outgoing = handler; };
  const on = instrument(socket);
  let ack;
  on('presence:ping', async cb => { cb({ ok: true }); });
  socket.emit('presence:ping', result => { ack = result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ack.ok, true);
  socket.any('attacker-controlled-label');
  socket.emit('disconnect', 'ping timeout');
  socket.emit('disconnect', 'ping timeout');
  const data = await registry.metrics();
  assert.match(data, /zea_io_clients 0/);
  assert.ok(!data.includes('attacker-controlled-label'));
});

test('collector failure returns 503 instead of an unhandled Express rejection', async () => {
  const originalToken = process.env.ZEAPLAY_METRICS_TOKEN;
  const originalMetrics = registry.metrics;
  process.env.ZEAPLAY_METRICS_TOKEN = 'synthetic-collector-error-token-0000000000';
  registry.metrics = async () => { throw new Error('synthetic failure, not exposed'); };
  const response = { set() {}, type() { return this; }, status(code) { this.code = code; return this; }, end() { this.ended = true; } };
  try {
    await metricsRoute({ headers: { authorization: `Bearer ${process.env.ZEAPLAY_METRICS_TOKEN}` } }, response);
    assert.equal(response.code, 503);
    assert.equal(response.ended, true);
  } finally {
    registry.metrics = originalMetrics;
    if (originalToken === undefined) delete process.env.ZEAPLAY_METRICS_TOKEN;
    else process.env.ZEAPLAY_METRICS_TOKEN = originalToken;
  }
});

test('async handler rejection is counted and propagated without changing its error', async () => {
  const socket = new EventEmitter();
  socket.onAny = () => {};
  socket.onAnyOutgoing = () => {};
  const on = instrument(socket);
  const error = new Error('synthetic rejection');
  on('call:answer', async () => { throw error; });
  await assert.rejects(socket.listeners('call:answer')[0]({}), failure => failure === error);
  socket.emit('disconnect', 'client namespace disconnect');
  assert.match(await registry.metrics(), /zea_io_errors_total\{kind="signaling"\} [1-9]/);
});
