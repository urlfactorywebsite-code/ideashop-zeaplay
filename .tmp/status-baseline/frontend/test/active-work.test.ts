import assert from 'node:assert/strict';
import test from 'node:test';
import { workDuration, sessionSeconds, workRange } from '../utils/activeWork';
import type { WorkSession } from '../types/activeWork';

test('duration supports more than 24 hours and excludes paused elapsed time', () => {
  assert.equal(workDuration(49 * 3600 + 61), '49:01:01');
  assert.equal(workDuration(-2), '00:00:00');
  const session = { status: 'RUNNING', active_seconds: 80 } as WorkSession;
  assert.equal(sessionSeconds(session, 40), 120);
  assert.equal(sessionSeconds({ ...session, status: 'PAUSED' }, 40), 80);
  assert.equal(sessionSeconds({ ...session, status: 'STOPPED' }, 40), 80);
});
test('ranges use local midnights and custom inclusive final day', () => {
  const now = new Date(2026, 9, 20, 13);
  const today = workRange('today', '', '', now);
  const yesterday = workRange('yesterday', '', '', now);
  assert.equal(today.from_at, yesterday.to_at);
  assert.equal(new Date(workRange('week', '', '', now).from_at).getDay(), 1);
  const custom = workRange('custom', '2026-10-01', '2026-10-02', now);
  assert.equal(new Date(custom.to_at).getDate(), 3);
  assert.throws(() => workRange('custom', '', '', now));
  assert.throws(() => workRange('custom', '2026-10-03', '2026-10-01', now));
});

test('profile timezone boundaries handle daylight saving without 24-hour assumptions', () => {
  const range = workRange('custom', '2026-03-08', '2026-03-08', new Date(), 'America/New_York');
  assert.equal((Date.parse(range.to_at) - Date.parse(range.from_at)) / 3600000, 23);
  const india = workRange('custom', '2026-10-20', '2026-10-20', new Date(), 'Asia/Kolkata');
  assert.equal(india.from_at, '2026-10-19T18:30:00.000Z');
});
