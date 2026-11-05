import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { TicketFollower, User } from '../types';

export const useTicketFollowers = (ticketId: string | undefined) => {
  const [followers, setFollowers] = useState<TicketFollower[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFollowers = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTicketFollowers(ticketId);
      setFollowers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load followers');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users', err);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchFollowers();
  }, [fetchUsers, fetchFollowers]);

  return {
    followers,
    users,
    loading,
    error,
    refetch: fetchFollowers,
  };
};
