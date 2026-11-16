import assert from 'node:assert/strict';
import test from 'node:test';
import { SubtaskStatus } from '../types';
import { formatSubtaskDueDate, subtaskDueState } from '../utils/subtaskDueDates';

test('optional deadlines classify civil days in the profile timezone', () => {
  const now = new Date('2026-11-16T19:00:00Z'); // Nov 17 in Kolkata, Nov 16 in LA.
  const child = { completed: false, status: SubtaskStatus.TODO, dueDate: '2026-11-16' };
  assert.equal(subtaskDueState(child, 'Asia/Kolkata', now), 'Overdue');
  assert.equal(subtaskDueState(child, 'America/Los_Angeles', now), 'Due today');
  assert.equal(subtaskDueState({ ...child, dueDate: '2026-11-17' }, 'Asia/Kolkata', now), 'Due today');
  assert.equal(subtaskDueState({ ...child, dueDate: '2026-11-18' }, 'Asia/Kolkata', now), 'Upcoming');
  assert.equal(subtaskDueState({ ...child, dueDate: null }, 'Asia/Kolkata', now), 'No due date');
  assert.equal(subtaskDueState({ completed: false }, 'UTC', now), 'No due date');
});

test('completed subtasks keep the date and suppress active deadline warnings', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  for (const dueDate of ['2026-11-15', '2026-11-16', '2026-11-17']) {
    assert.equal(subtaskDueState({ completed: true, dueDate }, 'UTC', now), null);
    assert.equal(subtaskDueState({ completed: false, status: SubtaskStatus.DONE, dueDate }, 'UTC', now), null);
  }
  assert.equal(formatSubtaskDueDate('2026-11-16'), 'Nov 16, 2026');
});

test('due today lasts until local midnight across DST changes', () => {
  const child = { completed: false, dueDate: '2026-11-01' };
  assert.equal(subtaskDueState(child, 'America/New_York', new Date('2026-11-02T04:59:59Z')), 'Due today');
  assert.equal(subtaskDueState(child, 'America/New_York', new Date('2026-11-02T05:00:00Z')), 'Overdue');
});
