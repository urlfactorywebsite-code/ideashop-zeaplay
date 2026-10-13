import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { useToast } from './useToast';
import {
  Ticket,
  TicketClosePayload,
  TicketListFilters,
  TicketCreatePayload,
  TicketUpdatePayload,
  TicketTransferPayload,
  TicketParticipantsUpdate,
} from '../types';

export const useTickets = (filters: TicketListFilters = {}) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useToast();

  const {
    status,
    priority,
    departmentId,
    assigneeId,
    followerId,
    search,
    myTickets,
  } = filters;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTickets({
        status,
        priority,
        departmentId,
        assigneeId,
        followerId,
        search,
        myTickets,
      });
      setTickets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tickets');
    } finally {
      setLoading(false);
    }
  }, [status, priority, departmentId, assigneeId, followerId, search, myTickets]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const createTicket = useCallback(async (payload: TicketCreatePayload): Promise<Ticket> => {
    const newTicket = await api.createTicket(payload);
    setTickets(prev => [newTicket, ...prev]);
    notify('Ticket created successfully.');
    return newTicket;
  }, [notify]);

  const updateTicket = useCallback(async (ticketId: string, updates: TicketUpdatePayload): Promise<Ticket> => {
    const updatedTicket = await api.updateTicket(ticketId, updates);
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId ? updatedTicket : ticket
    ));
    notify('Ticket updated successfully.');
    return updatedTicket;
  }, [notify]);

  const deleteTicket = useCallback(async (ticketId: string): Promise<void> => {
    await api.deleteTicket(ticketId);
    setTickets(prev => prev.filter(ticket => ticket.id !== ticketId));
    notify('Ticket deleted.');
  }, [notify]);

  const transferTicket = useCallback(async (ticketId: string, payload: TicketTransferPayload): Promise<Ticket> => {
    const updatedTicket = await api.transferTicket(ticketId, payload);
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId ? updatedTicket : ticket
    ));
    notify('Ticket transferred.');
    return updatedTicket;
  }, [notify]);

  const updateParticipants = useCallback(async (ticketId: string, payload: TicketParticipantsUpdate): Promise<Ticket> => {
    const updatedTicket = await api.updateTicketParticipants(ticketId, payload);
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId ? updatedTicket : ticket
    ));
    notify('Participants updated.');
    return updatedTicket;
  }, [notify]);

  const closeTicket = useCallback(async (ticketId: string, payload: TicketClosePayload): Promise<Ticket> => {
    const updatedTicket = await api.closeTicket(ticketId, payload);
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId ? updatedTicket : ticket
    ));
    notify('Ticket closed.');
    return updatedTicket;
  }, [notify]);

  const reopenTicket = useCallback(async (ticketId: string): Promise<Ticket> => {
    const updatedTicket = await api.reopenTicket(ticketId);
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId ? updatedTicket : ticket
    ));
    notify('Ticket reopened.');
    return updatedTicket;
  }, [notify]);

  return {
    tickets,
    loading,
    error,
    refetch: fetchTickets,
    createTicket,
    updateTicket,
    deleteTicket,
    transferTicket,
    updateParticipants,
    closeTicket,
    reopenTicket,
  };
};

export const useTicket = (ticketId: string | undefined) => {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useToast();

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getTicket(ticketId);
      setTicket(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const updateTicket = useCallback(async (updates: TicketUpdatePayload): Promise<Ticket> => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.updateTicket(ticketId, updates);
    setTicket(updatedTicket);
    notify('Ticket updated successfully.');
    return updatedTicket;
  }, [notify, ticketId]);

  const transferTicket = useCallback(async (payload: TicketTransferPayload): Promise<Ticket> => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.transferTicket(ticketId, payload);
    setTicket(updatedTicket);
    notify('Ticket transferred.');
    return updatedTicket;
  }, [notify, ticketId]);

  const updateParticipants = useCallback(async (payload: TicketParticipantsUpdate): Promise<Ticket> => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.updateTicketParticipants(ticketId, payload);
    setTicket(updatedTicket);
    notify('Participants updated.');
    return updatedTicket;
  }, [notify, ticketId]);

  const closeTicket = useCallback(async (payload: TicketClosePayload): Promise<Ticket> => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.closeTicket(ticketId, payload);
    setTicket(updatedTicket);
    notify('Ticket closed.');
    return updatedTicket;
  }, [notify, ticketId]);

  const reopenTicket = useCallback(async (): Promise<Ticket> => {
    if (!ticketId) throw new Error('No ticket ID provided');

    const updatedTicket = await api.reopenTicket(ticketId);
    setTicket(updatedTicket);
    notify('Ticket reopened.');
    return updatedTicket;
  }, [notify, ticketId]);

  return {
    ticket,
    loading,
    error,
    refetch: fetchTicket,
    updateTicket,
    transferTicket,
    updateParticipants,
    closeTicket,
    reopenTicket,
  };
};
