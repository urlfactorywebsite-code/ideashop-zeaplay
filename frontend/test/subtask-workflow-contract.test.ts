import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CompletionSubmissionStatus, SubtaskStatus, type CompletionSubmission, type Subtask } from '../types';

test('subtask workflow contract exposes all phase 6 statuses', () => {
  assert.deepEqual(Object.values(SubtaskStatus), [
    'WAITING',
    'TODO',
    'IN_PROGRESS',
    'BLOCKED',
    'IN_REVIEW',
    'DONE',
  ]);
});

test('subtask UI contract keeps legacy completed flag with workflow metadata', () => {
  const subtask: Subtask = {
    id: 'subtask-1',
    title: 'Prepare evidence',
    completed: false,
    assignedToId: 'user-1',
    status: SubtaskStatus.WAITING,
    sortOrder: 1,
    dependencyIds: ['subtask-0'],
    dependentIds: [],
    dependencyState: 'WAITING',
  };

  assert.equal(subtask.completed, false);
  assert.equal(subtask.status, SubtaskStatus.WAITING);
  assert.equal(subtask.dependencyIds?.[0], 'subtask-0');
});

test('phase 7 force-start contract carries an explicit reason', () => {
  const update: Partial<Subtask> = {
    status: SubtaskStatus.IN_PROGRESS,
    forceStartReason: 'Customer escalation requires early parallel work',
  };

  assert.equal(update.status, SubtaskStatus.IN_PROGRESS);
  assert.equal(typeof update.forceStartReason, 'string');
  assert.ok(update.forceStartReason.length >= 3);
});

test('create task UI defaults new subtasks to the parent task assignee until manually changed', () => {
  const createTaskSource = readFileSync(new URL('../components/CreateTaskModal.tsx', import.meta.url), 'utf8');

  assert.match(createTaskSource, /const primaryTaskAssigneeId = assignedTo\[0\] \?\? null/);
  assert.match(createTaskSource, /assignedToId: primaryTaskAssigneeId/);
  assert.match(createTaskSource, /assigneeTouched: true/);
});

test('phase 9 completion submissions preserve review state and evidence metadata', () => {
  const submission: CompletionSubmission = {
    id: 'submission-1',
    tenantId: 'tenant-1',
    taskId: 'task-1',
    subtaskId: 'subtask-1',
    submittedById: 'user-1',
    description: 'Finished work with attached proof',
    descriptionWordCount: 5,
    status: CompletionSubmissionStatus.PENDING_REVIEW,
    approvalRequired: true,
    attemptNumber: 1,
    createdAt: '2026-10-13T00:00:00Z',
    attachments: [
      {
        id: 'attachment-1',
        originalFilename: 'proof.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        checksumSha256: 'a'.repeat(64),
        createdAt: '2026-10-13T00:00:00Z',
      },
    ],
  };
  const subtask: Subtask = {
    id: 'subtask-1',
    title: 'Prepare evidence',
    completed: false,
    status: SubtaskStatus.IN_REVIEW,
    completionApprovalRequired: true,
    latestCompletionSubmission: submission,
    completionSubmissions: [submission],
  };

  assert.equal(subtask.latestCompletionSubmission?.status, CompletionSubmissionStatus.PENDING_REVIEW);
  assert.equal(subtask.completionSubmissions?.[0].attachments[0].originalFilename, 'proof.pdf');
});
