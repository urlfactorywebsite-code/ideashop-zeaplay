import assert from 'node:assert/strict';
import test from 'node:test';
import { CoalescedReconciliation, mergeRecoveredMessages, RecentEventIds } from '../services/realtimeRecovery';

test('snapshot recovery merges newer events and sent optimistic messages exactly once', () => {
  const optimistic = { id: 'temporary', clientId: 'client-1', createdAt: '2026-10-15T10:00:00Z', content: 'sending' };
  const snapshot = [{ ...optimistic, id: 'persisted', content: 'snapshot' }];
  const buffered = [{ ...snapshot[0], content: 'edited while snapshot was loading' },
    { id: 'later', clientId: null, createdAt: '2026-10-15T10:00:01Z', content: 'new' }];
  assert.deepEqual(mergeRecoveredMessages(snapshot, buffered, [optimistic]).map(item => [item.id, item.content]), [
    ['persisted', 'edited while snapshot was loading'], ['later', 'new'],
  ]);
});

test('recovery orders out-of-order events deterministically without using publication as a cursor', () => {
  const messages = [{ id: 'b', createdAt: '2026-10-15T10:00:00Z' }, { id: 'a', createdAt: '2026-10-15T10:00:00Z' }];
  assert.deepEqual(mergeRecoveredMessages(messages, []).map(item => item.id), ['a', 'b']);
});

test('persisted id still deduplicates when an update omits client id', () => {
  const snapshot = [{ id: 'persisted', clientId: 'client-1', createdAt: '2026-10-15T10:00:00Z', content: 'before' }];
  const buffered = [{ ...snapshot[0], clientId: null, content: 'after' }];
  assert.deepEqual(mergeRecoveredMessages(snapshot, buffered).map(item => [item.id, item.content]), [['persisted', 'after']]);
});

test('event id deduplication is bounded and accepts legacy events without ids', () => {
  const seen = new RecentEventIds();
  assert.equal(seen.accept('one'), true);
  assert.equal(seen.accept('one'), false);
  assert.equal(seen.accept(), true);
  for (let i = 0; i < 4096; i++) seen.accept(`event-${i}`);
  assert.equal(seen.accept('one'), true);
});

test('chronological recovery handles UTC-naive database values and explicit offsets', () => {
  const result = mergeRecoveredMessages([
    { id: 'later', createdAt: '2026-10-15T09:00:00Z' },
    { id: 'first', createdAt: '2026-10-15T10:00:00+02:00' },
    { id: 'middle', createdAt: '2026-10-15T08:30:00' },
  ], []);
  assert.deepEqual(result.map(message => message.id), ['first', 'middle', 'later']);
});

test('reconciliation requested during a delayed snapshot runs again without parallel fetches', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const recovery = new CoalescedReconciliation(async () => {
    calls += 1;
    if (calls === 1) await gate;
  });
  const first = recovery.request();
  void recovery.request();
  void recovery.request();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 2);
});

test('scope cleanup cancels queued reconciliation after an in-flight snapshot', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const recovery = new CoalescedReconciliation(async () => { calls += 1; await gate; });
  const first = recovery.request();
  void recovery.request();
  recovery.cancel();
  release();
  await first;
  await recovery.request();
  assert.equal(calls, 1);
});

test('REST-confirmed send buffered during a snapshot survives a stale history response', () => {
  const sent = { id: 'persisted', clientId: 'client-1', createdAt: '2026-10-15T10:00:00Z', deliveryStatus: 'sent' };
  assert.deepEqual(mergeRecoveredMessages([], [sent]), [sent]);
});
