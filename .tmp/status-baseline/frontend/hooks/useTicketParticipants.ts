import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { User, TicketParticipant, TicketParticipantsUpdate } from '../types';

export const useTicketParticipants = (ticketId: string | undefined) => {
  const [participants, setParticipants] = useState<TicketParticipant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, []);

  const fetchParticipants = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTicketParticipants(ticketId);
      setParticipants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch participants');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchUsers();
    fetchParticipants();
  }, [fetchUsers, fetchParticipants]);

  const updateParticipants = useCallback(async (payload: TicketParticipantsUpdate) => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.updateTicketParticipants(ticketId, payload);
    // Update local state based on the response
    fetchParticipants();
    return updatedTicket;
  }, [ticketId, fetchParticipants]);

  return {
    participants,
    users,
    loading,
    error,
    refetch: fetchParticipants,
    updateParticipants,
  };
};
