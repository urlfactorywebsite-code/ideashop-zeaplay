import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import {
  TicketApprovalActionPayload,
  TicketApprovalCycle,
  TicketApprovalRequestPayload,
} from '../types';

export const useTicketApprovals = (ticketId: string | undefined) => {
  const [approvals, setApprovals] = useState<TicketApprovalCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTicketApprovals(ticketId);
      setApprovals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const requestApproval = useCallback(
    async (payload: TicketApprovalRequestPayload) => {
      if (!ticketId) throw new Error('No ticket ID provided');
      const approval = await api.requestTicketApproval(ticketId, payload);
      await fetchApprovals();
      return approval;
    },
    [ticketId, fetchApprovals],
  );

  const approveApproval = useCallback(
    async (cycleId: string, payload: TicketApprovalActionPayload) => {
      const approval = await api.approveTicketApproval(cycleId, payload);
      await fetchApprovals();
      return approval;
    },
    [fetchApprovals],
  );

  const rejectApproval = useCallback(
    async (cycleId: string, payload: TicketApprovalActionPayload) => {
      const approval = await api.rejectTicketApproval(cycleId, payload);
      await fetchApprovals();
      return approval;
    },
    [fetchApprovals],
  );

  return {
    approvals,
    loading,
    error,
    refetch: fetchApprovals,
    requestApproval,
    approveApproval,
    rejectApproval,
  };
};
