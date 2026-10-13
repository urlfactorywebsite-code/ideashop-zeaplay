import { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../services/mockApi';
import { TaskPageResponse } from '../types';
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
};

export const useTaskList = ({ params, enabled = true }: UseTaskListOptions): UseTaskListResult => {
  const { listCache, inflightControllers, ttlMs } = useMemo(() => getTaskCaches(), []);
  const [data, setData] = useState<TaskPageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const cacheKey = useMemo(() => buildTaskListKey(params), [params]);

  const refresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    const cached = listCache.get(cacheKey);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const controller = new AbortController();
    inflightControllers.set(cacheKey, controller);

    api
      .getTasksPage({
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
        inflightControllers.delete(cacheKey);
      });

    return () => {
      controller.abort();
      inflightControllers.delete(cacheKey);
    };
  }, [cacheKey, enabled, inflightControllers, listCache, params, refreshTick, ttlMs]);

  return { data, loading, error, refresh };
};
