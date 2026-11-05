import { TaskStatus, type Task } from '../types';
import { taskInstant } from './taskDates';

export function effectiveTaskDeadline(task: Pick<Task, 'dueAt' | 'holdPausedSeconds' | 'holdStartedAt'>, now = Date.now()): number | null {
  if (!task.dueAt) return null;
  const original = taskInstant(task.dueAt).toMillis();
  if (!Number.isFinite(original)) return null;
  const started = task.holdStartedAt ? taskInstant(task.holdStartedAt).toMillis() : NaN;
  const paused = Math.max(0, task.holdPausedSeconds || 0) * 1000;
  return original + paused + (Number.isFinite(started) ? Math.max(0, now - started) : 0);
}

export function isTaskOverdue(task: Task, now = Date.now()) {
  const deadline = effectiveTaskDeadline(task, now);
  return deadline !== null && deadline < now && ![TaskStatus.DONE, TaskStatus.DEPLOYED].includes(task.status);
}
