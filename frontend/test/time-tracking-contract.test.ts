import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SubtaskStatus, TimeEntryStatus, type Subtask, type Task, type TimeEntry } from '../types';

test('phase 8 time-entry contract exposes lifecycle statuses and persisted timestamps', () => {
  assert.deepEqual(Object.values(TimeEntryStatus), ['ACTIVE', 'STOPPED', 'CORRECTED']);

  const entry: TimeEntry = {
    id: 'entry-1',
    userId: 'user-1',
    taskId: 'task-1',
    subtaskId: null,
    startedAt: '2026-10-13T08:00:00Z',
    stoppedAt: '2026-10-13T08:30:00Z',
    durationSeconds: 1800,
    status: TimeEntryStatus.STOPPED,
    note: null,
  };

  assert.equal(entry.taskId, 'task-1');
  assert.equal(entry.subtaskId, null);
  assert.equal(entry.durationSeconds, 1800);
});

test('phase 8 task and subtask UI contracts carry tracked totals', () => {
  const subtask: Subtask = {
    id: 'subtask-1',
    title: 'Wire timer controls',
    completed: false,
    status: SubtaskStatus.TODO,
    totalTrackedSeconds: 600,
  };
  const task: Partial<Task> = {
    id: 'task-1',
    title: 'Timer implementation',
    totalTrackedSeconds: 3600,
    subtasks: [subtask],
  };

  assert.equal(task.totalTrackedSeconds, 3600);
  assert.equal(task.subtasks?.[0].totalTrackedSeconds, 600);
});

test('phase 8 frontend calls the timer APIs and renders timer controls', () => {
  const mockApiSource = readFileSync(new URL('../services/mockApi.ts', import.meta.url), 'utf8');
  const taskDetailSource = readFileSync(new URL('../components/TaskDetailModal.tsx', import.meta.url), 'utf8');

  assert.match(mockApiSource, /getActiveTimeEntry/);
  assert.match(mockApiSource, /\/time-entries\/active/);
  assert.match(mockApiSource, /\/time-entries\/start/);
  assert.match(mockApiSource, /\/time-entries\/stop/);
  assert.match(mockApiSource, /\/time-entries\/\$\{entryId\}\/resume/);
  assert.match(mockApiSource, /task_id/);
  assert.match(mockApiSource, /subtask_id/);

  assert.match(taskDetailSource, /Start timer/);
  assert.match(taskDetailSource, /Stop timer/);
  assert.match(taskDetailSource, /totalTrackedSeconds/);
  assert.match(taskDetailSource, /SubtaskStatus\.WAITING/);
});
