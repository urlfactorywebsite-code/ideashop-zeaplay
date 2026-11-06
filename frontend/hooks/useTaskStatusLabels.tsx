import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { http } from '../services/mockApi';
import { configurationStorageKey, STATUS_CONFIGURATION_EVENT } from '../utils/kanbanConfiguration';
import { createStatusLabels, type StatusLabelEntry } from '../utils/taskStatusLabels';

const defaults = { label: createStatusLabels(), entries: [] as StatusLabelEntry[] };
const StatusLabels = createContext(defaults);
export const useTaskStatusLabels = () => useContext(StatusLabels);

export function TaskStatusLabelsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const queryKey = ['task-status-labels', user?.tenantId, user?.id];
  const query = useQuery({
    queryKey, enabled: !!user?.tenantId, staleTime: 30_000, gcTime: 0,
    refetchInterval: 30_000, refetchOnWindowFocus: 'always', retry: 1,
    queryFn: async ({ signal }) => {
      const response = await http.get<StatusLabelEntry[]>('/kanban-columns', { params: { include_inactive: true }, signal });
      return Array.isArray(response.data) ? response.data : [];
    },
  });
  useEffect(() => {
    if (!user?.tenantId) return;
    const refresh = () => { void client.invalidateQueries({ queryKey: ['task-status-labels', user.tenantId, user.id], exact: true }); };
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.tenantId === user.tenantId) refresh(); };
    const stored = (event: StorageEvent) => { if (event.key === configurationStorageKey(user.tenantId)) refresh(); };
    window.addEventListener(STATUS_CONFIGURATION_EVENT, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(STATUS_CONFIGURATION_EVENT, changed); window.removeEventListener('storage', stored); };
  }, [client, user?.tenantId, user?.id]);
  const value = useMemo(() => {
    const entries = user ? query.data || [] : [];
    return { label: createStatusLabels(entries), entries };
  }, [query.data, user?.tenantId, user?.id]);
  return <StatusLabels.Provider value={value}>{children}</StatusLabels.Provider>;
}

export function TaskStatusName({ status, customStatusId, fallback }: { status: string; customStatusId?: string | null; fallback?: string | null }) {
  return <>{useTaskStatusLabels().label(status, customStatusId, fallback)}</>;
}
