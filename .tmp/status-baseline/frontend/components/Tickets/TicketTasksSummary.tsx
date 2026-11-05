import React, { useMemo } from 'react';
import { TaskApprovalStatus, TaskStatus } from '../../types';
import { useTicketTasks } from '../../hooks/useTicketTasks';

interface TicketTasksSummaryProps {
  ticketId: string;
  onViewTasks?: () => void;
}

const statusBadge: Record<TaskStatus, string> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  [TaskStatus.TODO]: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  [TaskStatus.IN_PROGRESS]: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  [TaskStatus.BUG_FIXING]: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200',
  [TaskStatus.BLOCKED]: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200',
  [TaskStatus.IN_REVIEW]: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200',
  [TaskStatus.ON_HOLD]: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  [TaskStatus.DONE]: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  [TaskStatus.DEPLOYED]: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200',
  [TaskStatus.FAILED]: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  [TaskStatus.GRAVEYARD]: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
};

const approvalBadge = (status: TaskApprovalStatus) => {
  switch (status) {
    case TaskApprovalStatus.APPROVED:
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200';
    case TaskApprovalStatus.REJECTED:
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200';
    case TaskApprovalStatus.PENDING:
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
};

const TicketTasksSummary: React.FC<TicketTasksSummaryProps> = ({ ticketId, onViewTasks }) => {
  const { tasks, loading } = useTicketTasks(ticketId);

  const summary = useMemo(() => {
    const completed = tasks.filter((task) => task.status === TaskStatus.DONE).length;
    return {
      total: tasks.length,
      completed,
    };
  }, [tasks]);

  const previewTasks = useMemo(() => tasks.slice(0, 4), [tasks]);

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gray-400">Tasks</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {summary.completed}/{summary.total} completed
          </p>
        </div>
        {onViewTasks && (
          <button
            type="button"
            onClick={onViewTasks}
            className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-300"
          >
            View all
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-3 flex items-center justify-center rounded-lg border border-gray-200/60 bg-white/70 py-6 dark:border-gray-700/60 dark:bg-gray-900/60">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No linked tasks yet.</p>
      )}

      {!loading && tasks.length > 0 && (
        <div className="mt-3 space-y-3">
          {previewTasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-gray-200/50 bg-white/70 p-3 dark:border-gray-700/60 dark:bg-gray-900/60">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge[task.status]}`}>
                  {task.status.replace('_', ' ')}
                </span>
                {task.approvalRequired && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${approvalBadge(task.approvalStatus)}`}>
                    {task.approvalStatus}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">{task.title}</p>
              {task.dueAt && (
                <p className="mt-1 text-[11px] text-gray-400">Due {new Date(task.dueAt).toLocaleString()}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketTasksSummary;
