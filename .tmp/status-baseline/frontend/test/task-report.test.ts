import assert from 'node:assert/strict';
import test from 'node:test';
import { TimeEntryStatus, type TimeEntry } from '../types';
import type { ReportCompletion } from '../types/taskReport';
import { completionOrder, evidenceBytes, linkedPause, reportLifetime, reportName, safeFilename } from '../utils/taskReport';

test('completion attempt ordering is chronological, stable and does not collapse repeat completions', () => {
  const rows = [
    { id: 'b', created_at: '2026-10-19T10:00:00Z' }, { id: 'a', created_at: '2026-10-19T10:00:00Z' },
    { id: 'c', created_at: '2026-10-19T09:00:00Z' }, { id: 'd', created_at: 'unknown' },
  ] as ReportCompletion[];
  assert.deepEqual(completionOrder(rows).map(row => row.id), ['c', 'a', 'b', 'd']);
  assert.equal(rows[0].id, 'b');
  assert.deepEqual(completionOrder([
    { id: 'a', created_at: '2026-10-19T09:00:00.123457Z' }, { id: 'z', created_at: '2026-10-19T09:00:00.123456Z' },
  ] as ReportCompletion[]).map(row => row.id), ['z', 'a']);
});

test('unknown evidence and users remain unknown; file names are safe download names', () => {
  assert.equal(reportName(null), 'Not recorded');
  assert.equal(reportName({ id: 'u', name: null }), 'User u');
  assert.equal(safeFilename('../folder/../../proof.pdf\r\n'), 'proof.pdf');
  assert.equal(safeFilename('C:\\private\\image.png'), 'image.png');
  assert.equal(safeFilename(null), 'evidence');
  assert.equal(evidenceBytes(null), 'Size not recorded');
  assert.equal(evidenceBytes(1024 * 1024), '1.0 MB');
});

test('completed legacy tasks with unknown completion times never use now as a fabricated end', () => {
  const row = { status: 'DONE', created_at: '2026-10-19T09:00:00Z', final_completed_at: null };
  const asOf = '2026-10-19T10:00:00Z';
  assert.equal(reportLifetime(row, asOf), null);
  assert.equal(reportLifetime({ ...row, status: 'DEPLOYED' }, asOf), null);
  assert.equal(reportLifetime({ ...row, status: 'IN_PROGRESS' }, asOf), 3600);
  assert.equal(reportLifetime({ ...row, final_completed_at: '2026-10-19T09:30:00Z' }, asOf), 1800);
  assert.equal(reportLifetime({ ...row, final_completed_at: '2026-10-19T08:00:00Z' }, asOf), null);
});

test('only explicit same-user same-target continuations prove a paused interval', () => {
  const source: TimeEntry = { id: 'a', tenantId: 't', userId: 'u', taskId: 'task', subtaskId: null,
    startedAt: '2026-10-19T09:00:00Z', stoppedAt: '2026-10-19T09:15:00Z', stopReason: 'paused', status: TimeEntryStatus.STOPPED };
  const next: TimeEntry = { ...source, id: 'b', continuedFromId: 'a', startKind: 'resumed', startedAt: '2026-10-19T09:25:00Z' };
  const now = Date.parse('2026-10-19T10:00:00Z');
  assert.equal(linkedPause(source, next, now), 600);
  assert.equal(linkedPause(undefined, next, now), null);
  assert.equal(linkedPause({ ...source, stopReason: 'stopped' }, next, now), null);
  assert.equal(linkedPause(source, { ...next, userId: 'foreign' }, now), null);
  assert.equal(linkedPause(source, { ...next, taskId: 'other' }, now), null);
  assert.equal(linkedPause(source, { ...next, startedAt: source.startedAt }, now), null);
  assert.equal(linkedPause(source, next, Date.parse('2026-10-19T09:20:00Z')), null);
});
