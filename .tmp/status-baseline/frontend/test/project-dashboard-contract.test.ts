import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOM_STATUS_NAMES,
  ClientStatus,
  CompletionSubmissionStatus,
  ProjectMemberRole,
  ProjectStatus,
  SubtaskStatus,
  TaskPriority,
  TaskStatus,
  type ProjectTaskDashboardResponse,
} from '../types';

test('project dashboard keeps all backend task statuses and labels BUG_FIXING and DEPLOYED', () => {
  assert.deepEqual(Object.values(TaskStatus), [
    'WAITING_FOR_REQUIREMENT',
    'TODO',
    'IN_PROGRESS',
    'BUG_FIXING',
    'BLOCKED',
    'IN_REVIEW',
    'ON_HOLD',
    'DONE',
    'DEPLOYED',
    'FAILED',
    'GRAVEYARD',
  ]);
  assert.equal(CUSTOM_STATUS_NAMES[TaskStatus.BUG_FIXING].name, 'Bug Fixing');
  assert.equal(CUSTOM_STATUS_NAMES[TaskStatus.DEPLOYED].name, 'Deployed');
});

test('project dashboard keeps SubtaskStatus separate from TaskStatus and exposes workflow metadata', () => {
  assert.deepEqual(Object.values(SubtaskStatus), [
    'WAITING',
    'TODO',
    'IN_PROGRESS',
    'BLOCKED',
    'IN_REVIEW',
    'DONE',
  ]);

  const response: ProjectTaskDashboardResponse = {
    project: {
      id: 'project-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      name: 'Client rollout',
      normalizedName: 'client rollout',
      status: ProjectStatus.ACTIVE,
      client: {
        id: 'client-1',
        companyName: 'Client Co',
        status: ClientStatus.ACTIVE,
      },
      members: [],
      taskCount: 1,
      subtaskApprovalRequiredDefault: true,
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    },
    summary: {
      taskTotal: 1,
      subtaskTotal: 2,
      completedSubtasks: 1,
      progressPercent: 50,
      totalTrackedSeconds: 900,
      activeTimerCount: 1,
      statusCounts: Object.fromEntries(Object.values(TaskStatus).map((status) => [status, status === TaskStatus.TODO ? 1 : 0])) as Record<TaskStatus, number>,
      derivedStatusCounts: Object.fromEntries(Object.values(TaskStatus).map((status) => [status, status === TaskStatus.IN_PROGRESS ? 1 : 0])) as Record<TaskStatus, number>,
      subtaskStatusCounts: Object.fromEntries(Object.values(SubtaskStatus).map((status) => [status, status === SubtaskStatus.DONE ? 1 : 0])) as Record<SubtaskStatus, number>,
      priorityCounts: Object.fromEntries(Object.values(TaskPriority).map((priority) => [priority, priority === TaskPriority.HIGH ? 1 : 0])) as Record<TaskPriority, number>,
      workload: [
        {
          userId: 'user-1',
          name: 'Manager',
          role: ProjectMemberRole.MANAGER,
          assignedTasks: 1,
          assignedSubtasks: 1,
          actionableSubtasks: 1,
          waitingSubtasks: 0,
          blockedSubtasks: 0,
          inReviewSubtasks: 0,
          completedSubtasks: 0,
          totalTrackedSeconds: 900,
        },
      ],
    },
    items: [
      {
        id: 'task-1',
        title: 'Build dashboard',
        description: '',
        status: TaskStatus.TODO,
        derivedStatus: TaskStatus.IN_PROGRESS,
        statusSource: 'subtask_rollup',
        priority: TaskPriority.HIGH,
        assignedToId: 'user-1',
        assignedUserName: 'Manager',
        projectId: 'project-1',
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
        progressPercent: 50,
        completedSubtasks: 1,
        totalSubtasks: 2,
        totalTrackedSeconds: 900,
        activeTimerUserIds: [],
        subtasks: [
          {
            id: 'subtask-1',
            title: 'Design',
            completed: true,
            status: SubtaskStatus.DONE,
            sortOrder: 0,
            dependencyIds: [],
            dependentIds: ['subtask-2'],
            dependencyState: 'READY',
            totalTrackedSeconds: 900,
            activeTimerUserIds: [],
            completionApprovalRequired: false,
            forceStarted: false,
          },
          {
            id: 'subtask-2',
            title: 'Build',
            completed: false,
            assignedToId: 'user-1',
            assignedUserName: 'Manager',
            status: SubtaskStatus.IN_PROGRESS,
            sortOrder: 1,
            dependencyIds: ['subtask-1'],
            dependentIds: [],
            dependencyState: 'READY',
            branchKey: 'parallel-a',
            totalTrackedSeconds: 0,
            activeTimerUserIds: ['user-1'],
            completionApprovalRequired: true,
            latestSubmissionStatus: CompletionSubmissionStatus.PENDING_REVIEW,
            forceStarted: true,
          },
        ],
      },
    ],
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    statusPolicy: 'Task.status is the manual parent-task status and remains separate from progress.',
  };

  assert.equal(response.items[0].status, TaskStatus.TODO);
  assert.equal(response.items[0].derivedStatus, TaskStatus.IN_PROGRESS);
  assert.equal(response.items[0].subtasks[1].status, SubtaskStatus.IN_PROGRESS);
  assert.equal(response.items[0].subtasks[1].forceStarted, true);
  assert.equal(response.summary.progressPercent, 50);
});
