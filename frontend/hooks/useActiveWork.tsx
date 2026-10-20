import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../services/mockApi';
import { TASK_REALTIME_EVENT, TaskRealtimeNotice } from '../services/taskRealtimeEvents';
import { useAuth } from './useAuth';
import { useTaskWebSocket } from './useTaskWebSocket';
import type { WorkSession, WorkSnapshot } from '../types/activeWork';

type WorkContext = {
  snapshot: WorkSnapshot | null; advance: number; error: string | null; busy: boolean;
  connectionStatus: 'connected' | 'connecting' | 'offline';
  open: boolean; setOpen: (open: boolean) => void; refresh: () => Promise<void>;
  start: (target: { taskId?: string; subtaskId?: string }) => Promise<void>;
  control: (session: WorkSession, action: 'pause' | 'resume' | 'stop') => Promise<void>;
};
const Context = createContext<WorkContext | null>(null);
export const WORK_UPDATED_EVENT = 'zea:work-updated';

export function ActiveWorkProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Reset all work UI and pending responses before a different identity can render it.
  return <ActiveWorkState key={`${user?.tenantId ?? ''}:${user?.id ?? ''}`}>{children}</ActiveWorkState>;
}

function ActiveWorkState({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null);
  const [advance, setAdvance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef(performance.now());
  const epoch = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const acting = useRef(false);
  // One shared task socket for the whole authenticated layout.
  const { status: connectionStatus } = useTaskWebSocket({ enabled: Boolean(user) });
  const refresh = useCallback(async () => {
    dirty.current = true;
    if (inflight.current) return inflight.current;
    const generation = epoch.current;
    const promise = (async () => {
      while (dirty.current && generation === epoch.current) {
        dirty.current = false;
        try {
          const requestStart = performance.now();
          const data = await api.getActiveWork();
          if (generation !== epoch.current) return;
          if (dirty.current) continue;
          if (data.user_id !== user?.id || data.tenant_id !== user?.tenantId) {
            setSnapshot(null);
            throw new Error('Work response does not match your signed-in account. Refresh your session.');
          }
          // Anchor server durations to a monotonic clock, independent of device clock changes.
          anchor.current = (requestStart + performance.now()) / 2;
          setAdvance((performance.now() - anchor.current) / 1000);
          setSnapshot(data); setError(null);
        } catch (failure) {
          if (generation === epoch.current && failure && typeof failure === 'object' && 'clearWorkState' in failure) setSnapshot(null);
          if (generation === epoch.current) setError(failure instanceof Error ? failure.message : 'Unable to synchronize Active Work.');
          break;
        }
      }
    })();
    inflight.current = promise;
    try { await promise; } finally { if (inflight.current === promise) inflight.current = null; }
  }, [user?.id, user?.tenantId]);
  useEffect(() => {
    epoch.current++; inflight.current = null; dirty.current = false;
    setSnapshot(null); setError(null); setOpen(false);
    if (!user) return;
    void refresh();
    const reconcile = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const realtime = (event: Event) => {
      const notice = (event as CustomEvent<TaskRealtimeNotice>).detail;
      if (notice?.userId === user.id && notice.tenantId === (user.tenantId ?? null)) reconcile();
    };
    const timer = window.setInterval(reconcile, 30000);
    window.addEventListener(TASK_REALTIME_EVENT, realtime);
    window.addEventListener('online', reconcile); window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      epoch.current++; window.clearInterval(timer);
      window.removeEventListener(TASK_REALTIME_EVENT, realtime);
      window.removeEventListener('online', reconcile); window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [user?.id, user?.tenantId, refresh]);
  useEffect(() => {
    if (!snapshot?.running_count && !open) return;
    const clock = window.setInterval(() => setAdvance((performance.now() - anchor.current) / 1000), 1000);
    return () => window.clearInterval(clock);
  }, [snapshot?.running_count, open]);
  const mutate = async (action: () => Promise<unknown>) => {
    if (acting.current) return;
    const generation = epoch.current;
    acting.current = true; setBusy(true); setError(null);
    try {
      if (!navigator.onLine) throw new Error('Reconnect to control timers. Existing sessions continue running.');
      await action();
      if (generation !== epoch.current) return;
      await refresh();
      window.dispatchEvent(new Event(WORK_UPDATED_EVENT));
    } catch (failure) {
      if (generation !== epoch.current) return;
      setError(failure instanceof Error ? failure.message : 'Timer action failed. Refresh before retrying.');
      setOpen(true); await refresh();
      // Reconciliation must not erase the actionable failure message.
      setError(failure instanceof Error ? failure.message : 'Timer action failed.');
    } finally { acting.current = false; if (generation === epoch.current) setBusy(false); }
  };
  return <Context.Provider value={{ snapshot, advance, error, busy, connectionStatus, open, setOpen, refresh,
    start: target => mutate(() => api.startTimeEntry(target)),
    control: (session, action) => mutate(() => api.controlWorkTimer(session.entry_id, action)),
  }}>{children}</Context.Provider>;
}
export function useActiveWork() {
  const context = useContext(Context);
  if (!context) throw new Error('ActiveWorkProvider is required');
  return context;
}
