import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/mockApi';
import { TASK_REALTIME_EVENT, type TaskRealtimeNotice } from '../services/taskRealtimeEvents';
import type { Task } from '../types';
import type { TaskAnalytics, TaskExecutionSessions, TaskJourney } from '../types/taskLifecycle';
import { journeyMatchesTarget, mergeEvents, sameSubtaskStates, sessionsMatchTarget, timestamp } from '../utils/taskJourney';

export interface JourneySnapshot {
  scope: string;
  task: Task;
  journey: TaskJourney;
  analytics: TaskAnalytics;
  sessions: TaskExecutionSessions;
  receivedAt: number;
}

function errorMessage(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403 || status === 404) return 'This task journey is no longer accessible.';
  if (status === 503) return 'Task history is not available on this server yet.';
  return 'Unable to load the task journey. Please try again.';
}

export function useTaskJourney(taskId: string, userId: string, tenantId: string | null) {
  const scope = JSON.stringify([tenantId, userId, taskId]);
  const [data, setData] = useState<JourneySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null });
  const busyRef = useRef(false);
  const alive = useRef(false);
  const pending = useRef(false);
  const suspended = useRef(false);
  const pages = useRef({ events: 1, sessions: 1 });
  const refreshRef = useRef<(manual?: boolean) => Promise<void>>(async () => {});

  const finish = useCallback((version: number) => {
    if (version !== request.current.version || !alive.current) return;
    busyRef.current = false;
    setBusy(false);
    if (pending.current && !suspended.current) {
      pending.current = false;
      void refreshRef.current(false);
    }
  }, []);

  const refresh = useCallback(async (manual = true) => {
    if (!alive.current || (!manual && (suspended.current || document.hidden))) return;
    if (manual) suspended.current = false;
    if (busyRef.current) { pending.current = true; return; }
    pending.current = false;
    const controller = new AbortController();
    const version = ++request.current.version;
    request.current.controller = controller;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const analyticsStarted = performance.now();
      let analyticsClockAnchor = analyticsStarted;
      const [task, initialJourney, analytics, initialSessions] = await Promise.all([
        api.getTask(taskId, { fresh: true, signal: controller.signal }),
        api.getTaskJourney(taskId, 0, controller.signal),
        api.getTaskAnalytics(taskId, controller.signal).then(value => {
          analyticsClockAnchor = analyticsStarted + (performance.now() - analyticsStarted) / 2;
          return value;
        }),
        api.getTaskExecutionSessions(taskId, '', controller.signal),
      ]);
      if (controller.signal.aborted || version !== request.current.version) return;
      if (!journeyMatchesTarget(initialJourney, taskId)) throw new Error('history target mismatch');
      let journey = { ...initialJourney, items: mergeEvents([], initialJourney.items) };
      let sessions = initialSessions;
      // Re-read the previously loaded window so invalidation cannot erase pages
      // or leave corrected sessions stale. No cursor is treated as a change feed.
      for (let index = 1; index < pages.current.events && journey.next_after_id !== null; index++) {
        const page = await api.getTaskJourney(taskId, journey.next_after_id, controller.signal);
        if (controller.signal.aborted || version !== request.current.version) return;
        if (!journeyMatchesTarget(page, taskId) || page.status !== journey.status || !sameSubtaskStates(page.subtasks, journey.subtasks)) throw new Error('snapshot changed');
        journey = { ...page, items: mergeEvents(journey.items, page.items) };
      }
      for (let index = 1; index < pages.current.sessions && sessions.next_after_id !== null; index++) {
        const page = await api.getTaskExecutionSessions(taskId, sessions.next_after_id, controller.signal);
        if (controller.signal.aborted || version !== request.current.version) return;
        if (page.task_id !== taskId) throw new Error('snapshot target mismatch');
        sessions = { ...page, items: [...new Map([...sessions.items, ...page.items].map(row => [row.id, row])).values()] };
      }
      if ([task.id, journey.task_id, analytics.task_id, sessions.task_id].some(id => id !== taskId)) {
        throw new Error('snapshot target mismatch');
      }
      const childIds = new Set([...journey.subtasks.map(row => row.id), ...journey.items.flatMap(row => row.subtask_id ? [row.subtask_id] : [])]);
      if (!sessionsMatchTarget(sessions.items, taskId, tenantId, childIds)) throw new Error('session target mismatch');
      // Independent API snapshots may straddle a transition. Never display two
      // conflicting current statuses as one authoritative journey.
      if (timestamp(analytics.as_of) === null || task.status !== journey.status || journey.status !== analytics.status || !sameSubtaskStates(journey.subtasks,
        task.subtasks.map(child => ({ id: child.id, status: child.status || '' }))) || !sameSubtaskStates(journey.subtasks,
        analytics.subtasks.map(child => ({ id: child.subtask_id, status: child.status })))) {
        throw new Error('snapshot changed');
      }
      setData({ scope, task, journey, analytics, sessions, receivedAt: analyticsClockAnchor });
    } catch (err) {
      if (!controller.signal.aborted && version === request.current.version) {
        controller.abort();
        const status = (err as { response?: { status?: number } })?.response?.status;
        suspended.current = status === 401 || status === 403 || status === 404;
        pending.current = false;
        setData(null);
        setError(errorMessage(err));
      }
    } finally {
      finish(version);
    }
  }, [finish, scope, taskId, tenantId]);
  refreshRef.current = refresh;

  useEffect(() => {
    alive.current = true;
    busyRef.current = false;
    pending.current = false;
    suspended.current = false;
    pages.current = { events: 1, sessions: 1 };
    setData(null);
    void refresh();
    let debounce: number | undefined;
    const schedule = () => {
      window.clearTimeout(debounce);
      if (suspended.current || document.hidden) return;
      if (busyRef.current) { pending.current = true; return; }
      debounce = window.setTimeout(() => void refresh(false), 250);
    };
    const onEvent = (event: Event) => {
      const notice = (event as CustomEvent<TaskRealtimeNotice>).detail;
      if (notice?.userId !== userId || notice.tenantId !== tenantId) return;
      if (!notice.payload || typeof notice.payload !== 'object' || Array.isArray(notice.payload)) return;
      const resource = notice.payload.task_id;
      if (!resource || resource === taskId) schedule();
    };
    const recover = () => { if (!document.hidden) schedule(); };
    const interval = window.setInterval(() => {
      void refresh(false);
    }, 30000);
    window.addEventListener(TASK_REALTIME_EVENT, onEvent);
    window.addEventListener('focus', recover);
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      alive.current = false;
      pending.current = false;
      ++request.current.version;
      request.current.controller?.abort();
      window.clearTimeout(debounce);
      window.clearInterval(interval);
      window.removeEventListener(TASK_REALTIME_EVENT, onEvent);
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [refresh, scope, taskId, userId, tenantId]);

  const loadMore = useCallback(async (kind: 'events' | 'sessions') => {
    if (!data || data.scope !== scope || busyRef.current) return;
    const cursor = kind === 'events' ? data.journey.next_after_id : data.sessions.next_after_id;
    if (cursor === null) return;
    const controller = new AbortController();
    const version = ++request.current.version;
    request.current.controller = controller;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'events') {
        const page = await api.getTaskJourney(taskId, cursor as number, controller.signal);
        if (controller.signal.aborted || version !== request.current.version) return;
        if (!journeyMatchesTarget(page, taskId)) throw new Error('history target mismatch');
        if (page.status !== data.journey.status || !sameSubtaskStates(page.subtasks, data.journey.subtasks)) {
          pending.current = true;
          return;
        }
        pages.current.events++;
        setData(previous => previous?.scope === scope ? { ...previous, journey: { ...previous.journey,
          items: mergeEvents(previous.journey.items, page.items), next_after_id: page.next_after_id } } : previous);
      } else {
        const page = await api.getTaskExecutionSessions(taskId, cursor as string, controller.signal);
        if (controller.signal.aborted || version !== request.current.version) return;
        if (page.task_id !== taskId) throw new Error('session target mismatch');
        const childIds = new Set([...data.journey.subtasks.map(row => row.id), ...data.journey.items.flatMap(row => row.subtask_id ? [row.subtask_id] : [])]);
        if (!sessionsMatchTarget(page.items, taskId, tenantId, childIds)) throw new Error('session target mismatch');
        pages.current.sessions++;
        setData(previous => previous?.scope === scope ? { ...previous, sessions: { ...page,
          items: [...new Map([...previous.sessions.items, ...page.items].map(row => [row.id, row])).values()] } } : previous);
      }
    } catch (err) {
      if (!controller.signal.aborted && version === request.current.version) {
        // Permission revocation must also remove already displayed private history.
        setData(null);
        setError(errorMessage(err));
        const status = (err as { response?: { status?: number } })?.response?.status;
        suspended.current = status === 401 || status === 403 || status === 404;
        pending.current = false;
      }
    } finally {
      finish(version);
    }
  }, [data, finish, scope, taskId, tenantId]);

  return { data: data?.scope === scope ? data : null, busy, error, refresh, loadMore };
}

export function useJourneyClock(snapshot: JourneySnapshot | null) {
  const [, tick] = useState(0);
  const enabled = Boolean(snapshot);
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => { if (!document.hidden) tick(value => value + 1); }, 1000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  const age = snapshot ? Math.max(0, performance.now() - snapshot.receivedAt) : 0;
  // Stop extrapolation when recovery is stale. A socket is an invalidation hint,
  // not a durable timer ledger, and browser clock changes must not change totals.
  return { age, advanceMs: Math.min(age, 60000) };
}
