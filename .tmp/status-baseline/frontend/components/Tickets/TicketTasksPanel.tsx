import React, { useMemo, useState } from 'react';
import { Ticket, TaskApprovalStatus, TaskPriority, TaskStatus } from '../../types';
import { useTicketTasks } from '../../hooks/useTicketTasks';
import CreateTaskModal from '../CreateTaskModal';

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

interface TicketTasksPanelProps {
  ticketId: string;
  ticket: Ticket;
  canCreate: boolean;
}

const TicketTasksPanel: React.FC<TicketTasksPanelProps> = ({ ticketId, ticket, canCreate }) => {
  const { tasks, loading, error, completeTask, refetch } = useTicketTasks(ticketId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.status === TaskStatus.DONE && b.status !== TaskStatus.DONE) return 1;
        if (a.status !== TaskStatus.DONE && b.status === TaskStatus.DONE) return -1;
        return (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
      }),
    [tasks],
  );

  const handleComplete = async (taskId: string) => {
    await completeTask(taskId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Ticket Tasks</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Track the tasks linked to this ticket.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-200"
          >
            Create Task
          </button>
        )}
      </div>

      <div className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center rounded-xl border border-gray-200/60 bg-white/70 py-10 dark:border-gray-700/60 dark:bg-gray-900/60">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}
        {!loading && !tasks.length && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
            No linked tasks yet.
          </div>
        )}

        {sortedTasks.map((task) => (
          <div key={task.id} className="rounded-2xl border border-gray-200/60 bg-white/70 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[task.status]}`}>
                {task.status.replace('_', ' ')}
              </span>
              {task.approvalRequired && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${approvalBadge(task.approvalStatus)}`}>
                  {task.approvalStatus === TaskApprovalStatus.PENDING ? 'Approval pending' : task.approvalStatus}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {task.priority as TaskPriority}
              </span>
            </div>

            <div className="mt-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{task.title}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{task.description}</p>
                {task.dueAt && (
                  <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                    Due {new Date(task.dueAt).toLocaleString()}
                  </p>
                )}
              </div>
              {task.status !== TaskStatus.DONE && (
                <button
                  type="button"
                  onClick={() => handleComplete(task.id)}
                  className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-200"
                >
                  Complete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <CreateTaskModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onTaskCreated={() => {
          setIsCreateOpen(false);
          refetch();
        }}
        ticketId={ticketId}
        ticketTitle={ticket.title}
        ticketDescription={ticket.description}
      />
    </div>
  );
};

export default TicketTasksPanel;
