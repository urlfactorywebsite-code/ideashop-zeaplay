import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { TicketAuditLogPage } from '../types';

export const useTicketLogs = (ticketId: string | undefined, page = 1, pageSize = 25) => {
  const [data, setData] = useState<TicketAuditLogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listTicketLogs(ticketId, page, pageSize);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [ticketId, page, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    data,
    loading,
    error,
    refetch: fetchLogs,
  };
};
