import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateTaskPoints, calculateUserPointsForTask } from '../utils/taskPoints';
import GamificationService from '../services/gamification';
import {
  RecurrenceRule,
  Role,
  SubtaskStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  UserStatus,
  type Task,
  type User,
} from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Backend-compatible points task',
  description: '',
  status: TaskStatus.TODO,
  priority: TaskPriority.HIGH,
  category: TaskCategory.WORK,
  team: 'Data Team',
  assignedTo: ['user-1'],
  taskGroupId: 'group-1',
  createdBy: 'creator-1',
  createdAt: '2026-10-13T08:00:00.000Z',
  updatedAt: '2026-10-13T08:00:00.000Z',
  dueAt: '2026-10-14T08:00:00.000Z',
  completedAt: null,
  subtasks: [],
  recurrenceRule: RecurrenceRule.NONE,
  recurringTaskId: null,
  clarityRating: null,
  attachments: [],
  estimatedHours: null,
  tags: [],
  ...overrides,
});

test('task points utility matches backend defaults for completion timing', () => {
  const early = calculateTaskPoints(
    makeTask({
      status: TaskStatus.DONE,
      completedAt: '2026-10-13T09:00:00.000Z',
    }),
  );
  assert.equal(early.basePoints, 25);
  assert.equal(early.awardedBonus, 15);
  assert.equal(early.totalAwarded, 40);

  const late = calculateTaskPoints(
    makeTask({
      status: TaskStatus.DONE,
      completedAt: '2026-10-15T09:00:00.000Z',
    }),
  );
  assert.equal(late.awardedPenalty, -15);
  assert.equal(late.totalAwarded, 10);

  const noDueDate = calculateTaskPoints(
    makeTask({
      status: TaskStatus.DEPLOYED,
      dueAt: null,
      completedAt: '2026-10-13T09:00:00.000Z',
    }),
  );
  assert.equal(noDueDate.totalAwarded, 25);
});

test('pending overdue tasks show potential points but do not count as earned XP', () => {
  const task = makeTask({
    dueAt: '2026-10-12T08:00:00.000Z',
    completedAt: null,
  });
  const breakdown = calculateTaskPoints(task, undefined, new Date('2026-10-13T08:00:00.000Z'));
  assert.equal(breakdown.status, 'pending-overdue');
  assert.equal(breakdown.awardedPenalty, 0);
  assert.equal(breakdown.totalAwarded, 0);
  assert.equal(breakdown.potentialLateTotal, 10);

  const manager: User = {
    id: 'creator-1',
    name: 'Manager',
    email: 'manager@example.com',
    role: Role.MANAGER,
    department: 'Data Team',
    status: UserStatus.ACTIVE,
    points: 0,
    overallXpPoints: 0,
    claimedXpPoints: 0,
    tasksCreated: 0,
    tasksCompleted: 0,
    clarityScores: [],
    claimedRewardIds: [],
    unlockedAchievementIds: [],
  };

  const assigneePoints = calculateUserPointsForTask({ ...task, pointsBreakdown: breakdown }, 'user-1');
  assert.equal(assigneePoints.taskPoints, 0);
  assert.equal(assigneePoints.total, 0);

  const managerPoints = calculateUserPointsForTask(
    { ...task, pointsBreakdown: breakdown },
    'creator-1',
    { user: manager },
  );
  assert.equal(managerPoints.managerPenalty, 0);
});

test('legacy calendar gamification does not invent subtask completion XP', () => {
  const taskWithSubtasks = makeTask({
    status: TaskStatus.DONE,
    completedAt: '2026-10-13T09:00:00.000Z',
    subtasks: [
      { id: 'subtask-1', title: 'One', completed: true, status: SubtaskStatus.DONE },
      { id: 'subtask-2', title: 'Two', completed: true, status: SubtaskStatus.DONE },
    ],
  });

  const service = GamificationService.getInstance();
  assert.equal(service.calculatePoints(taskWithSubtasks), 40);
});
