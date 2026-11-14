import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import api from '../services/mockApi';
import { Task, TaskPageResponse } from '../types';
import { buildTaskListKey, getTaskCaches, TaskListCacheParams } from './useTaskCache';

type UseTaskListOptions = {
  params: TaskListCacheParams;
  enabled?: boolean;
};

type UseTaskListResult = {
  data: TaskPageResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  updateItems: (update: (items: Task[]) => Task[]) => void;
};

export const useTaskList = ({ params, enabled = true }: UseTaskListOptions): UseTaskListResult => {
  const { listCache, inflightControllers, ttlMs } = useMemo(() => getTaskCaches(), []);
  const [data, setData] = useState<TaskPageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const lastRefresh = useRef(0);

  const cacheKey = useMemo(() => buildTaskListKey(params), [params]);

  const refresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);
  const updateItems = useCallback((update: (items: Task[]) => Task[]) => {
    const reconcile = (previous: TaskPageResponse) => {
      const items = update(previous.items);
      const total = Math.max(0, previous.total + items.length - previous.items.length);
      return { ...previous, items, total, totalPages: Math.max(1, Math.ceil(total / previous.pageSize)) };
    };
    listCache.updateMatching(key => {
      try { return !!params.accountScope && JSON.parse(key.slice('tasks:list:'.length)).accountScope === params.accountScope; }
      catch { return false; }
    }, reconcile);
    setData(previous => {
      if (!previous) return previous;
      return reconcile(previous);
    });
  }, [listCache, params.accountScope]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    const cached = listCache.get(cacheKey);
    const explicitlyRefreshed = lastRefresh.current !== refreshTick;
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      if (!explicitlyRefreshed) return;
    } else {
      setLoading(true);
    }

    const controller = new AbortController();
    inflightControllers.set(cacheKey, controller);

    api
      .getTasksPage({
        grouped: params.grouped,
        timezone: params.timezone,
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        status: params.status,
        priority: params.priority,
        assigneeId: params.assigneeId,
        projectId: params.projectId,
        team: params.team,
        tag: params.tag,
        dueDate: params.dueDate,
        createdDate: params.createdDate,
        quickFilter: params.quickFilter,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        signal: controller.signal,
      })
      .then((response) => {
        if (!response || controller.signal.aborted) {
          return;
        }
        listCache.set(cacheKey, response, ttlMs);
        lastRefresh.current = refreshTick;
        setData(response);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
        setLoading(false);
      })
      .finally(() => {
        if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
      });

    return () => {
      controller.abort();
      if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
    };
  }, [cacheKey, enabled, inflightControllers, listCache, params, refreshTick, ttlMs]);

  return { data, loading, error, refresh, updateItems };
};
