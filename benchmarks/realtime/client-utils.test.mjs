import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { waitForEvent, connectSocket, nearestRank } from './client-utils.mjs';

test('correlated waits clean listeners after success, timeout and cancellation', async () => {
  const socket = new EventEmitter();
  const waiting = waitForEvent(socket, 'answer', 20);
  socket.emit('answer', { ok: true });
  assert.equal((await waiting.promise).ok, true);
  assert.equal(socket.listenerCount('answer'), 0);
  const expired = waitForEvent(socket, 'answer', 5);
  await assert.rejects(expired.promise);
  assert.equal(socket.listenerCount('answer'), 0);
  const cancelled = waitForEvent(socket, 'answer', 1000);
  cancelled.cancel();
  await assert.rejects(cancelled.promise);
  assert.equal(socket.listenerCount('answer'), 0);
});

test('repeated reconnects install listeners before connect and remove both outcomes', async () => {
  const socket = new EventEmitter();
  socket.connect = () => socket.emit('connect');
  for (let i = 0; i < 20; i++) {
    await connectSocket(socket, 20);
    assert.equal(socket.listenerCount('connect'), 0);
    assert.equal(socket.listenerCount('connect_error'), 0);
  }
  socket.connect = () => socket.emit('connect_error');
  await assert.rejects(connectSocket(socket, 20));
  assert.equal(socket.listenerCount('connect'), 0);
  assert.equal(socket.listenerCount('connect_error'), 0);
});

test('nearest rank reports exact small-sample percentiles and empty as null', () => {
  assert.equal(nearestRank([], .95), null);
  assert.equal(nearestRank([1, 10], .5), 1);
  assert.equal(nearestRank([1, 10], .95), 10);
  assert.equal(nearestRank([1, 2, 3, 4], .5), 2);
});
