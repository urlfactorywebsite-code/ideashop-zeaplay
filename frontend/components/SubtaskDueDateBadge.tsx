import { useAuth } from '../hooks/useAuth';
import type { Subtask } from '../types';
import { formatSubtaskDueDate, subtaskDueState } from '../utils/subtaskDueDates';

export default function SubtaskDueDateBadge({ subtask }: { subtask: Pick<Subtask, 'dueDate' | 'completed' | 'status'> }) {
  const { user } = useAuth();
  const state = subtaskDueState(subtask, user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const color = state === 'Overdue' ? 'text-rose-300' : state === 'Due today' ? 'text-amber-300' : 'text-current opacity-80';
  return <span className={`inline-flex flex-wrap items-center gap-2 text-xs ${color}`}>
    {subtask.dueDate ? <><time dateTime={subtask.dueDate}>{formatSubtaskDueDate(subtask.dueDate)}</time>{state && <span>{state}</span>}</> : 'No due date'}
  </span>;
}
