import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowJourney, stageStateName, workflowCompletion, type WorkflowStage } from '../utils/workflowJourney';
import type { LifecycleEvent } from '../types/taskLifecycle';
import { MAIN_STAGES, OTHER_STAGES, timestamp } from '../utils/taskJourney';

const at = (hour: string) => `2026-11-14T${hour}:00Z`;
const change = (id: number, previous: string | null, next: string, time: string): LifecycleEvent => ({
  id, task_id: 'a', subtask_id: null, time_entry_id: null, event_type: previous ? 'task.status_changed' : 'task.created',
  previous_status: previous, new_status: next, actor_id: null, occurred_at: at(time), recorded_at: at(time), details: {},
});
const entries = [...MAIN_STAGES, ...OTHER_STAGES].map((id, order) => ({ id, title: `Configured ${id}`, order, is_active: true }));
const now = timestamp(at('12:00'))!;

test('canonical track order uses configured names and enabled IDs, with no inferred skipped completions', () => {
  const events = [change(1, null, 'TODO', '09:00'), change(2, 'TODO', 'DONE', '10:00')];
  const result = buildWorkflowJourney([...entries].reverse(), events, [], 'DONE', now, true, true);
  assert.deepEqual(result.main.map(row => row.id), MAIN_STAGES);
  assert.equal(result.main.find(row => row.id === 'IN_PROGRESS')?.completed, false);
  assert.equal(result.main.find(row => row.id === 'TODO')?.label, 'Configured TODO');
  assert.deepEqual(workflowCompletion(result.main), { completed: 2, total: 6, percentage: 33 });
  assert.equal(result.main.find(row => row.id === 'DONE')?.isCurrent, true);
  assert.equal(result.main.find(row => row.id === 'DONE')?.completed, true);
});

test('alternate and custom states do not contribute to main completion and disabled entries stay hidden', () => {
  const configured = [...entries.map(row => ({ ...row, is_active: row.id !== 'TODO' })),
    { id: 'legacy-custom', custom_status_id: 'quality', title: 'Quality gate', is_active: true, order: 15 }];
  const custom = [{ ...change(3, 'IN_PROGRESS', 'quality', '10:00'), event_type: 'task.custom_status_changed' }];
  const result = buildWorkflowJourney(configured, [change(1, null, 'ON_HOLD', '09:00')], custom, 'quality', now, true, true);
  assert.equal(result.main.some(row => row.id === 'TODO'), false);
  assert.equal(result.alternate.at(-1)?.isCurrent, true);
  assert.equal(result.alternate.at(-1)?.recordedSeconds, 7200);
  assert.deepEqual(workflowCompletion(result.main), { completed: 0, total: 5, percentage: 0 });
});

test('reopening keeps the current checkpoint active and removes its completed state without erasing earlier visits', () => {
  const events = [change(1, null, 'IN_PROGRESS', '09:00'), change(2, 'IN_PROGRESS', 'DONE', '10:00'), change(3, 'DONE', 'IN_PROGRESS', '11:00')];
  const result = buildWorkflowJourney(entries, events, [], 'IN_PROGRESS', now, true, true);
  const current = result.main.find(row => row.isCurrent)!;
  assert.equal(stageStateName(current), 'Current');
  assert.equal(current.completed, false);
  assert.equal(current.visits, 2);
  assert.equal(current.recordedSeconds, 7200);
  assert.equal(result.main.find(row => row.id === 'DONE')?.completed, true);
});

test('partial pages and missing history never produce a current duration or fabricate pending history', () => {
  const events = [change(1, null, 'IN_PROGRESS', '09:00')];
  const result = buildWorkflowJourney(entries, events, [], 'IN_PROGRESS', now, false, false);
  assert.equal(result.main.find(row => row.isCurrent)?.recordedSeconds, null);
  assert.equal(result.main.find(row => row.isCurrent)?.metadata?.['Current stay'], 'Not recorded');
  assert.equal(result.main.find(row => row.id === 'TODO')?.pending, false);
  assert.deepEqual(workflowCompletion([]), { completed: 0, total: 0, percentage: 0 });
});

test('component state precedence keeps completion independent of current identity', () => {
  const stage: WorkflowStage = { id: 'x', label: 'X', isCurrent: true, completed: true, recorded: true };
  assert.equal(stageStateName(stage), 'Current');
  assert.equal(workflowCompletion([stage]).percentage, 100);
});
