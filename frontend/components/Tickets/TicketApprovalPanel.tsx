import React, { useEffect, useMemo, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import api from '../../services/api';
import {
  Role,
  Ticket,
  TicketApprovalActionPayload,
  TicketApprovalCycle,
  TicketApprovalCycleStatus,
  TicketApprovalItemStatus,
  TicketApprovalRequestPayload,
  TicketApprovalType,
  User,
  UserStatus,
} from '../../types';
import { useAuth } from '../../hooks/useAuth';
import MultiSelect from '../ui/MultiSelect';
import { timeAgo } from '../../utils';
import { getUserAvatarUrl } from '../../utils/userAvatar';

interface TicketApprovalPanelProps {
  ticket: Ticket;
  approvals: TicketApprovalCycle[];
  loading: boolean;
  onRequestApproval: (payload: TicketApprovalRequestPayload) => Promise<void>;
  onApproveApproval: (cycleId: string, payload: TicketApprovalActionPayload) => Promise<void>;
  onRejectApproval: (cycleId: string, payload: TicketApprovalActionPayload) => Promise<void>;
}

const statusTone: Record<TicketApprovalCycleStatus, string> = {
  [TicketApprovalCycleStatus.PENDING]: 'text-sky-300',
  [TicketApprovalCycleStatus.APPROVED]: 'text-emerald-300',
  [TicketApprovalCycleStatus.REJECTED]: 'text-rose-300',
  [TicketApprovalCycleStatus.OVERDUE]: 'text-amber-300',
  [TicketApprovalCycleStatus.ESCALATED]: 'text-fuchsia-300',
};

const itemTone: Record<TicketApprovalItemStatus, string> = {
  [TicketApprovalItemStatus.PENDING]: 'border-sky-400/40 text-sky-200',
  [TicketApprovalItemStatus.APPROVED]: 'border-emerald-400/50 text-emerald-200',
  [TicketApprovalItemStatus.REJECTED]: 'border-rose-400/50 text-rose-200',
  [TicketApprovalItemStatus.OVERDUE]: 'border-amber-400/50 text-amber-200',
};

const formatLocalDateTime = (value: string) => {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const TicketApprovalPanel: React.FC<TicketApprovalPanelProps> = ({
  ticket,
  approvals,
  loading,
  onRequestApproval,
  onApproveApproval,
  onRejectApproval,
}) => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [approvalType, setApprovalType] = useState<TicketApprovalType>(ticket.approvalType ?? TicketApprovalType.PARALLEL);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [approverMessages, setApproverMessages] = useState<Record<string, string>>({});
  const [approvalDeadline, setApprovalDeadline] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showRequestForm) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowRequestForm(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showRequestForm]);

  const userMap = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const activeUsers = useMemo(
    () => users.filter((candidate) => candidate.status === UserStatus.ACTIVE),
    [users],
  );

  const approverOptions = useMemo(
    () =>
      activeUsers
        .filter((candidate) => candidate.id !== user?.id)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          avatarUrl: getUserAvatarUrl(candidate) ?? undefined,
          description: candidate.role.toUpperCase(),
        })),
    [activeUsers, user?.id],
  );

  const latestCycle = approvals[0];
  const canRequest = Boolean(
    user && (user.role === Role.ADMIN || user.role === Role.OWNER || user.role === Role.MANAGER || user.id === ticket.assignedUserId || user.id === ticket.createdBy),
  );

  const handleApproverChange = (value: string[]) => {
    const next = value.slice(0, 10);
    setApprovers(next);
    setApproverMessages((prev) => {
      const updated: Record<string, string> = {};
      next.forEach((id) => {
        updated[id] = prev[id] ?? '';
      });
      return updated;
    });
  };

  const handleDeadlineQuick = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setApprovalDeadline(formatLocalDateTime(date.toISOString()));
  };

  const handleRequest = async () => {
    setError(null);
    if (!approvers.length) {
      setError('Select approvers first.');
      return;
    }
    const missing = approvers.find((id) => !(approverMessages[id] || '').trim());
    if (missing) {
      setError('Every approver needs a message.');
      return;
    }
    await onRequestApproval({
      approvalType,
      approvers: approvers.map((id) => ({ approverUserId: id, message: approverMessages[id] })),
      deadlineUtc: approvalDeadline ? new Date(approvalDeadline).toISOString() : null,
    });
    setShowRequestForm(false);
    setApprovers([]);
    setApproverMessages({});
    setApprovalDeadline('');
  };
  const canActOnCycle = (cycle: TicketApprovalCycle) => {
    if (!user) return false;
    if (cycle.status !== TicketApprovalCycleStatus.PENDING && cycle.status !== TicketApprovalCycleStatus.OVERDUE) {
      return false;
    }
    const isApprover = cycle.approvers.some((item) => item.approverUserId === user.id);
    if (!isApprover) return false;
    if (cycle.approvalType !== TicketApprovalType.SEQUENTIAL) return true;
    const nextPending = cycle.approvers
      .filter((item) => item.status === TicketApprovalItemStatus.PENDING || item.status === TicketApprovalItemStatus.OVERDUE)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))[0];
    return nextPending?.approverUserId === user.id;
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/80">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Approval Track</h3>
          {latestCycle && (
            <p className="text-xs text-white/60">Attempts left: {latestCycle.attemptsLeft}</p>
          )}
        </div>
        {canRequest && (
          <button
            onClick={() => setShowRequestForm(true)}
            className="rounded-full border border-primary/40 bg-primary/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary"
          >
            Request Approval
          </button>
        )}
      </div>

      {loading && <p className="mt-4 text-xs text-white/60">Loading approvals...</p>}
      {!loading && approvals.length === 0 && (
        <p className="mt-4 text-sm text-white/60">No approval cycles yet.</p>
      )}

      <div className="mt-4 space-y-4">
        {approvals.map((cycle, index) => (
          <div key={cycle.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-white">Cycle {approvals.length - index}</div>
                <div className="text-xs text-white/50">Requested {timeAgo(cycle.requestedAtUtc)}</div>
              </div>
              <div className={`text-xs font-semibold uppercase tracking-[0.2em] ${statusTone[cycle.status]}`}>
                {cycle.status}
              </div>
            </div>
            {cycle.deadlineUtc && (
              <p className="mt-2 text-xs text-white/60">Deadline {timeAgo(cycle.deadlineUtc)}</p>
            )}
            <div className="mt-3 space-y-3">
              {cycle.approvers.map((approver) => {
                const info = userMap.get(approver.approverUserId);
                return (
                  <div key={approver.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/50 p-3">
                    <div className={`h-10 w-10 flex-shrink-0 rounded-full border ${itemTone[approver.status]} overflow-hidden`}>
                      {getUserAvatarUrl(info) ? (
                        <img src={getUserAvatarUrl(info) ?? ''} alt={info?.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-semibold">
                          {(info?.name || '?').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{info?.name || 'Approver'}</p>
                          <p className="text-xs text-white/50">{info?.role ?? 'Unknown role'}</p>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.2em] text-white/60">{approver.status}</span>
                      </div>
                      <p className="mt-2 text-xs text-white/70">{approver.message || 'No message provided.'}</p>
                      {approver.actedAtUtc && (
                        <p className="mt-1 text-[11px] text-white/50">Action {timeAgo(approver.actedAtUtc)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {canActOnCycle(cycle) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={actionMessage}
                  onChange={(event) => setActionMessage(event.target.value)}
                  placeholder="Optional note"
                  className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/40"
                />
                <button
                  onClick={() => onApproveApproval(cycle.id, { message: actionMessage })}
                  className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200"
                >
                  Approve
                </button>
                <button
                  onClick={() => onRejectApproval(cycle.id, { message: actionMessage })}
                  className="rounded-full border border-rose-400/50 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showRequestForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowRequestForm(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-gray-950 p-6 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold">Request Approval</h4>
              <button
                onClick={() => setShowRequestForm(false)}
                className="rounded-full border border-white/10 p-1 text-white/70 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-white/60">Type</label>
                <select
                  value={approvalType}
                  onChange={(event) => setApprovalType(event.target.value as TicketApprovalType)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white"
                >
                  <option value={TicketApprovalType.SEQUENTIAL}>Sequential</option>
                  <option value={TicketApprovalType.PARALLEL}>Parallel</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-white/60">Deadline</label>
                <input
                  type="datetime-local"
                  value={approvalDeadline}
                  onChange={(event) => setApprovalDeadline(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white"
                />
                <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                  {[{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: '+3 days', days: 3 }, { label: '+5 days', days: 5 }, { label: '+1 week', days: 7 }].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleDeadlineQuick(item.days)}
                      className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-white/70"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs uppercase tracking-[0.2em] text-white/60">Approvers</label>
              <div className="mt-2">
                <MultiSelect
                  options={approverOptions}
                  value={approvers}
                  onChange={handleApproverChange}
                  placeholder="Select approvers..."
                />
              </div>
            </div>

            {approvers.length > 0 && (
              <div className="mt-4 space-y-3">
                {approvers.map((approverId) => {
                  const info = userMap.get(approverId);
                  return (
                    <div key={approverId} className="rounded-xl border border-white/10 bg-black/60 p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full border border-white/10 overflow-hidden">
                          {getUserAvatarUrl(info) ? (
                            <img src={getUserAvatarUrl(info) ?? ''} alt={info?.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold">
                              {(info?.name || '?').slice(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{info?.name || 'Approver'}</p>
                          <p className="text-xs text-white/50">{info?.role ?? 'Unknown role'}</p>
                        </div>
                      </div>
                      <textarea
                        value={approverMessages[approverId] ?? ''}
                        onChange={(event) =>
                          setApproverMessages((prev) => ({ ...prev, [approverId]: event.target.value }))
                        }
                        placeholder="Write a message for this approver..."
                        className="mt-3 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/40"
                        rows={3}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRequestForm(false)}
                className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
              >
                Cancel
              </button>
              <button
                onClick={handleRequest}
                className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200"
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketApprovalPanel;
