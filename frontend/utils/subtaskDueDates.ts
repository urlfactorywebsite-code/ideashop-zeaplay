import { SubtaskStatus, type Subtask } from '../types';
import { taskDateKey } from './taskDates';

// A date-only deadline stays on the selected day in every timezone.
export function subtaskDueState(subtask: Pick<Subtask, 'dueDate' | 'completed' | 'status'>, zone: string, now = new Date()) {
  if (!subtask.dueDate) return 'No due date';
  if (subtask.completed || subtask.status === SubtaskStatus.DONE) return null;
  const today = taskDateKey(now.toISOString(), zone);
  return subtask.dueDate < today ? 'Overdue' : subtask.dueDate === today ? 'Due today' : 'Upcoming';
}

export function formatSubtaskDueDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  });
}
