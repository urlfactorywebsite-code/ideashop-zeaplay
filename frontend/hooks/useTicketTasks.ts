import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { TicketLinkedTask, TicketLinkedTaskCreatePayload, TicketLinkedTaskUpdatePayload } from '../types';

export const useTicketTasks = (ticketId: string | undefined) => {
  const [tasks, setTasks] = useState<TicketLinkedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTicketTasks(ticketId);
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(
    async (payload: TicketLinkedTaskCreatePayload) => {
      if (!ticketId) throw new Error('No ticket ID provided');
      const created = await api.createTicketTask(ticketId, payload);
      await fetchTasks();
      return created;
    },
    [ticketId, fetchTasks],
  );

  const updateTask = useCallback(
    async (taskId: string, payload: TicketLinkedTaskUpdatePayload) => {
      const updated = await api.updateTicketTask(taskId, payload);
      await fetchTasks();
      return updated;
    },
    [fetchTasks],
  );

  const completeTask = useCallback(
    async (taskId: string) => {
      const updated = await api.completeTicketTask(taskId);
      await fetchTasks();
      return updated;
    },
    [fetchTasks],
  );

  return {
    tasks,
    loading,
    error,
    refetch: fetchTasks,
    createTask,
    updateTask,
    completeTask,
  };
};
