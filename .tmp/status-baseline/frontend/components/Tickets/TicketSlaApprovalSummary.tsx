import React, { useMemo } from 'react';
import { Ticket, TicketApprovalCycle, TicketApprovalCycleStatus, TaskApprovalStatus } from '../../types';
import SLATimer from './SLATimer';

interface TicketSlaApprovalSummaryProps {
  ticket: Ticket;
  approvals: TicketApprovalCycle[];
}

const statusBadge = (status: TaskApprovalStatus | null | undefined) => {
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

const TicketSlaApprovalSummary: React.FC<TicketSlaApprovalSummaryProps> = ({ ticket, approvals }) => {
  const approvalStats = useMemo(() => {
    const pending = approvals.filter((cycle) => cycle.status === TicketApprovalCycleStatus.PENDING).length;
    const approved = approvals.filter((cycle) => cycle.status === TicketApprovalCycleStatus.APPROVED).length;
    const rejected = approvals.filter((cycle) => cycle.status === TicketApprovalCycleStatus.REJECTED).length;
    return { pending, approved, rejected };
  }, [approvals]);

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
      <p className="text-xs uppercase tracking-[0.25em] text-gray-400">SLA + Approval</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SLATimer ticket={ticket} />
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(ticket.approvalStatus ?? null)}`}>
          {ticket.approvalStatus ?? 'none'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-gray-200/60 bg-gray-50/70 px-2 py-2 text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/60 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Pending</p>
          <p className="mt-1 text-sm font-semibold">{approvalStats.pending}</p>
        </div>
        <div className="rounded-lg border border-gray-200/60 bg-gray-50/70 px-2 py-2 text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/60 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Approved</p>
          <p className="mt-1 text-sm font-semibold">{approvalStats.approved}</p>
        </div>
        <div className="rounded-lg border border-gray-200/60 bg-gray-50/70 px-2 py-2 text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/60 dark:text-gray-300">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Rejected</p>
          <p className="mt-1 text-sm font-semibold">{approvalStats.rejected}</p>
        </div>
      </div>
    </div>
  );
};

export default TicketSlaApprovalSummary;
