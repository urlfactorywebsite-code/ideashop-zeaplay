import React, { useEffect, useMemo, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import {
  Ticket,
  TicketApprovalActionPayload,
  TicketApprovalCycle,
  TicketApprovalItemStatus,
  User,
} from '../types';

interface ApprovalModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  userMap: Map<string, User>;
  onClose: () => void;
  onActionComplete?: () => void;
}

const pendingStatuses = new Set<TicketApprovalItemStatus>([
  TicketApprovalItemStatus.PENDING,
  TicketApprovalItemStatus.OVERDUE,
]);

const ApprovalModal: React.FC<ApprovalModalProps> = ({
  ticket,
  isOpen,
  userMap,
  onClose,
  onActionComplete,
}) => {
  const [approvals, setApprovals] = useState<TicketApprovalCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [selectedApproverId, setSelectedApproverId] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen || !ticket) {
      setApprovals([]);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .listTicketApprovals(ticket.id)
      .then((items) => setApprovals(items))
      .catch(() => setError('Failed to load approval details.'))
      .finally(() => setLoading(false));
  }, [isOpen, ticket]);

  const latestCycle = approvals[0];
  const pendingApprovers = useMemo(
    () =>
      latestCycle?.approvers.filter((entry) => pendingStatuses.has(entry.status)) ?? [],
    [latestCycle],
  );

  useEffect(() => {
    if (!pendingApprovers.length) {
      setSelectedApproverId('');
      return;
    }
    setSelectedApproverId((prev) => {
      if (user) {
        const current = pendingApprovers.find((entry) => entry.approverUserId === user.id);
        if (current) {
          return current.approverUserId;
        }
      }
      if (pendingApprovers.some((entry) => entry.approverUserId === prev)) {
        return prev;
      }
      return pendingApprovers[0].approverUserId;
    });
  }, [pendingApprovers, user]);

  if (!isOpen || !ticket) {
    return null;
  }

  const handleDecision = async (mode: 'approve' | 'reject') => {
    if (!ticket || !selectedApproverId) {
      return;
    }
    if (!userMap.has(selectedApproverId)) {
      setError('Select a valid approver.');
      return;
    }
    setActionLoading(true);
    setError(null);
    const payload: TicketApprovalActionPayload = {
      message: comment.trim() || undefined,
    };
    try {
      if (mode === 'approve') {
        await api.approveTicket(ticket.id, payload);
      } else {
        await api.rejectTicket(ticket.id, payload);
      }
      onActionComplete?.();
      setComment('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval action failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const approverOptions = pendingApprovers.map((entry) => ({
    id: entry.approverUserId,
    name: userMap.get(entry.approverUserId)?.name ?? entry.approverUserId,
  }));

  const isCurrentUserSelected = Boolean(user && selectedApproverId === user.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 p-6 text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sky-300/70">Approval Action</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">{ticket.title}</h2>
            <p className="text-sm text-white/60">#{ticket.id.slice(-6)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-white/60 hover:text-white"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="mt-6 text-sm text-white/60">Loading approval details...</div>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-white/60">Approver</label>
              <select
                value={selectedApproverId}
                onChange={(event) => setSelectedApproverId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white backdrop-blur"
              >
                {approverOptions.length === 0 ? (
                  <option value="">No approvers available</option>
                ) : (
                  approverOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-white/60">
                Comments
              </label>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="Add optional context for the decision..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-sky-500"
              />
            </div>

            {error && (
              <p className="text-sm text-rose-400">{error}</p>
            )}

            {!isCurrentUserSelected && (
              <p className="text-xs text-white/60">
                Select your own approver record to take action.
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={actionLoading || !isCurrentUserSelected}
                onClick={() => handleDecision('approve')}
                className="flex-1 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-40"
              >
                {actionLoading ? 'Processing...' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={actionLoading || !isCurrentUserSelected}
                onClick={() => handleDecision('reject')}
                className="flex-1 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40"
              >
                {actionLoading ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApprovalModal;
