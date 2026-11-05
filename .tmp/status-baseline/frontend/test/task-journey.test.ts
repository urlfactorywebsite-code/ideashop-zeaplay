import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { TaskStatus, TimeEntryStatus, type TimeEntry } from '../types';
import type { LifecycleEvent } from '../types/taskLifecycle';
import { canAdvanceMetrics, currentStageStart, duration, exactTimestamp, liveMetrics, MAIN_STAGES,
  mergeEvents, OTHER_STAGES, sessionMetrics, stageState, stageVisits, statusEvents, timestamp } from '../utils/taskJourney';
import { journeyMatchesTarget, orderedSessions, prepareLiveMetrics, sameSubtaskStates, sessionSeconds, sessionsMatchTarget } from '../utils/taskJourney';
import type { TaskJourney } from '../types/taskLifecycle';

const event = (id: number, previous: string | null, next: string, at: string, subtask: string | null = null): LifecycleEvent => ({
  id, previous_status: previous, new_status: next, occurred_at: at, recorded_at: at,
  task_id: 'task', subtask_id: subtask, time_entry_id: null, actor_id: null, details: {},
  event_type: `${subtask ? 'subtask' : 'task'}.${previous ? 'status_changed' : 'created'}`,
});
const entry = (id: string, start: string, stop: string | null, user = 'u'): TimeEntry => ({
  id, tenantId: 'tenant', userId: user, taskId: 'task', startedAt: start, stoppedAt: stop,
  status: stop ? TimeEntryStatus.STOPPED : TimeEntryStatus.ACTIVE,
});
const at = (time: string) => `2026-10-19T${time}Z`;

test('roadmap retains all eleven task statuses without mixing subtask vocabulary', () => {
  assert.deepEqual(new Set([...MAIN_STAGES, ...OTHER_STAGES]), new Set(Object.values(TaskStatus)));
  assert.equal(stageState('TODO', 'DONE', []), 'upcoming');
  assert.equal(stageState('DONE', 'DONE', []), 'active');
});

test('roadmap does not fabricate visited stages or collapse reopened transitions', () => {
  const rows = [event(1, null, 'TODO', at('10:00:00')), event(2, 'TODO', 'DONE', at('10:01:00')),
    event(3, 'DONE', 'TODO', at('10:02:00')), event(4, 'TODO', 'DONE', at('10:03:00'))];
  assert.equal(stageState('IN_PROGRESS', 'DONE', rows), 'upcoming');
  assert.equal(stageState('TODO', 'DONE', rows), 'visited');
  assert.equal(currentStageStart(rows, 'DONE'), at('10:03:00'));
  assert.equal(currentStageStart(rows, 'IN_REVIEW'), null);
  assert.deepEqual(stageVisits(rows, 'DONE', timestamp(at('10:04:00'))!, true).map(row => row.seconds), [60, 60, 60, 60]);
  assert.equal(stageVisits(rows, 'DONE', timestamp(at('10:04:00'))!, false).at(-1)?.seconds, null);
});

test('event pagination deduplicates IDs but preserves repeated stages and target isolation', () => {
  const a = event(1, null, 'TODO', at('10:00:00'));
  const b = event(2, 'TODO', 'DONE', at('10:01:00'));
  const child = event(3, null, 'TODO', at('10:02:00'), 'subtask');
  const result = mergeEvents([a, b], [b, child]);
  assert.deepEqual(result.map(row => row.id), [1, 2, 3]);
  assert.deepEqual(statusEvents(result, null), [a, b]);
  assert.deepEqual(statusEvents(result, 'subtask'), [child]);
});

test('exact timestamps retain server precision, respect offsets and never guess missing times', () => {
  assert.equal(timestamp(at('10:00:00')), timestamp('2026-10-19T15:30:00+05:30'));
  assert.equal(timestamp('2026-10-19 10:00:00'), timestamp(at('10:00:00')));
  assert.equal(exactTimestamp('2026-10-19T10:00:00.123456Z'), '2026-10-19 10:00:00.123456 UTC');
  assert.equal(exactTimestamp(null), 'Not recorded');
  assert.equal(timestamp('invalid'), null);
  assert.equal(duration(null), 'Not recorded');
});

test('out-of-order clocks do not fabricate a status duration', () => {
  const rows = [event(1, null, 'TODO', at('10:01:00')), event(2, 'TODO', 'DONE', at('10:00:00'))];
  assert.equal(stageVisits(rows, 'DONE', timestamp(at('10:02:00'))!, true)[0].seconds, null);
});

test('time union does not double count overlapping parent and child sessions for one user', () => {
  const rows = [entry('a', at('10:00:00'), at('10:30:00')), { ...entry('b', at('10:15:00'), at('10:45:00')), taskId: null, subtaskId: 'child' }];
  const metrics = sessionMetrics(rows, timestamp(at('11:00:00'))!);
  assert.equal(metrics.raw_session_seconds, 3600);
  assert.equal(metrics.person_seconds, 2700);
  assert.equal(metrics.elapsed_seconds, 2700);
});

test('parallel users count person time separately and elapsed wall time only once', () => {
  const metrics = sessionMetrics([entry('a', at('10:00:00'), at('10:30:00')), entry('b', at('10:00:00'), at('10:30:00'), 'v')], timestamp(at('11:00:00'))!);
  assert.equal(metrics.person_seconds, 3600);
  assert.equal(metrics.elapsed_seconds, 1800);
});

test('fractional intervals are rounded after union, not per session', () => {
  const metrics = sessionMetrics([entry('a', at('10:00:00.000'), at('10:00:00.600')), entry('b', at('10:00:01.000'), at('10:00:01.600'))], timestamp(at('11:00:00'))!);
  assert.equal(metrics.person_seconds, 1);
});

test('running work across midnight uses server as-of, not stored duration or client time zone', () => {
  const row = { ...entry('a', '2026-10-18T23:59:30Z', null), durationSeconds: 999999 };
  assert.equal(sessionMetrics([row], timestamp(at('00:00:30'))!).person_seconds, 60);
});

test('live totals advance only a complete reconciled server snapshot', () => {
  const rows = [entry('a', at('10:00:00'), null)];
  const asOf = timestamp(at('10:00:30'))!;
  const base = sessionMetrics(rows, asOf);
  assert.equal(liveMetrics(base, rows, asOf, asOf + 5000, true).person_seconds, 35);
  assert.equal(liveMetrics(base, rows, asOf, asOf + 5000, false).person_seconds, 30);
  assert.equal(canAdvanceMetrics(base, [], asOf, true), false);
  assert.equal(liveMetrics(base, [], asOf, asOf + 5000, true).person_seconds, 30);
  assert.equal(liveMetrics(base, rows, asOf, asOf - 5000, true).person_seconds, 30);
});

test('future legacy starts retain active count without inventing elapsed work', () => {
  const result = sessionMetrics([entry('a', at('12:00:00'), null)], timestamp(at('10:00:00'))!);
  assert.equal(result.active_session_count, 1);
  assert.equal(result.person_seconds, 0);
});

test('stopped legacy sessions with future end times do not keep accruing live work', () => {
  const asOf = timestamp(at('10:00:00'))!;
  const rows = [entry('future-stop', at('09:00:00'), at('11:00:00'))];
  const base = sessionMetrics(rows, asOf);
  assert.equal(liveMetrics(base, rows, asOf, asOf + 5000, true).person_seconds, 3600);
});

test('a gap between recorded statuses cannot be presented as continuous time in one stage', () => {
  const rows = [event(1, null, 'TODO', at('10:00:00')), event(2, 'BLOCKED', 'DONE', at('10:30:00'))];
  assert.equal(stageVisits(rows, 'DONE', timestamp(at('11:00:00'))!, true)[0].seconds, null);
});

test('stage durations do not extend into future observations beyond the displayed server clock', () => {
  const rows = [event(1, null, 'TODO', at('10:00:00')), event(2, 'TODO', 'DONE', at('11:00:00'))];
  assert.equal(stageVisits(rows, 'DONE', timestamp(at('10:30:00'))!, true)[0].seconds, null);
});

test('prepared live accounting never reparses history on subsequent clock ticks', () => {
  const asOf = timestamp(at('10:00:00'))!;
  const rows = Array.from({ length: 250 }, (_, index) => entry(`history-${index}`, at('09:00:00'), at('09:30:00')));
  rows.push(entry('active', at('09:46:00'), null));
  const base = sessionMetrics(rows, asOf);
  const prepared = prepareLiveMetrics(base, rows, asOf, true);
  const original = Date.parse;
  let calls = 0;
  Date.parse = value => { calls++; return original(value); };
  try {
    for (let seconds = 0; seconds <= 60; seconds++) assert.equal(prepared.at(asOf + seconds * 1000).person_seconds, 2640 + seconds);
    assert.equal(calls, 0);
  } finally { Date.parse = original; }
});

test('session displays clamp future stops, reject corrupt timestamps and retain chronological identity', () => {
  const now = timestamp(at('10:00:00'))!;
  assert.equal(sessionSeconds(entry('a', at('09:00:00'), at('11:00:00')), now), 3600);
  assert.equal(sessionSeconds(entry('a', 'invalid', null), now), null);
  assert.equal(sessionSeconds(entry('a', at('09:00:00'), 'invalid'), now), null);
  assert.equal(sessionSeconds(entry('a', at('10:00:00'), at('09:00:00')), now), null);
  const newer = entry('a', at('09:30:00'), null);
  const older = entry('z', at('09:00:00'), at('09:15:00'));
  assert.deepEqual(orderedSessions([newer, older]).map(row => row.id), ['z', 'a']);
});

test('snapshot child comparison ignores ordering but rejects missing, duplicate or changed states', () => {
  const rows = [{ id: 'a', status: 'TODO' }, { id: 'b', status: 'DONE' }];
  assert.equal(sameSubtaskStates(rows, [...rows].reverse()), true);
  assert.equal(sameSubtaskStates(rows, rows.slice(1)), false);
  assert.equal(sameSubtaskStates(rows, [{ id: 'a', status: 'TODO' }, { id: 'b', status: 'TODO' }]), false);
  assert.equal(sameSubtaskStates([rows[0], rows[0]], rows), false);
});

test('history and sessions cannot silently cross tenant, parent or child boundaries', () => {
  const page = { task_id: 'task', items: [event(1, null, 'TODO', at('09:00:00'))] } as TaskJourney;
  assert.equal(journeyMatchesTarget(page, 'task'), true);
  assert.equal(journeyMatchesTarget({ ...page, items: [{ ...page.items[0], task_id: 'foreign' }] }, 'task'), false);
  const rows = [entry('a', at('09:00:00'), null)];
  assert.equal(sessionsMatchTarget(rows, 'task', 'tenant', new Set(['child'])), true);
  assert.equal(sessionsMatchTarget([{ ...rows[0], tenantId: 'foreign' }], 'task', 'tenant', new Set(['child'])), false);
  assert.equal(sessionsMatchTarget([{ ...rows[0], taskId: 'foreign' }], 'task', 'tenant', new Set(['child'])), false);
  assert.equal(sessionsMatchTarget([{ ...rows[0], taskId: null, subtaskId: 'child' }], 'task', 'tenant', new Set(['child'])), true);
  assert.equal(sessionsMatchTarget([{ ...rows[0], taskId: null, subtaskId: 'other' }], 'task', 'tenant', new Set(['child'])), false);
  assert.equal(sessionsMatchTarget([{ ...rows[0], subtaskId: 'child' }], 'task', 'tenant', new Set(['child'])), false);
});

test('journey is read-only, lazy-loaded, reduced-motion aware and reuses the existing socket', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const modal = read('../components/TaskJourneyModal.tsx');
  const hook = read('../hooks/useTaskJourney.ts');
  assert.match(read('../components/TaskDetailModal.tsx'), /React\.lazy\(\(\) => import\('\.\/TaskJourneyModal'\)\)/);
  assert.match(read('../components/TaskJourneyModal.css'), /prefers-reduced-motion: reduce/);
  assert.match(modal, /DialogPanel/);
  assert.match(modal, /Reason:.*Not recorded/);
  assert.doesNotMatch(modal + hook, /new WebSocket|updateTask|updateSubtask|localStorage/);
  assert.match(hook, /controller\.signal\.aborted/);
  assert.match(hook, /version !== request\.current\.version/);
  assert.match(hook, /notice\.tenantId !== tenantId/);
  assert.match(read('../hooks/useTaskWebSocket.ts'), /publishTaskRealtime/);
});
