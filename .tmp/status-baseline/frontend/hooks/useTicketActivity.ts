import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { TicketActivityItem } from '../types';

export const useTicketActivity = (ticketId: string | undefined) => {
  const [activity, setActivity] = useState<TicketActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTicketActivity(ticketId);
      setActivity(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return {
    activity,
    loading,
    error,
    refetch: fetchActivity,
  };
};
