import { useEffect, useMemo } from 'react';

import api from '../services/mockApi';
import { Task } from '../types';
import {
  buildTaskKanbanKey,
  buildTaskListKey,
  buildTaskSummaryKey,
  getTaskCaches,
  TaskKanbanCacheParams,
  TaskListCacheParams,
} from './useTaskCache';

type TaskPrefetchOptions = {
  baseParams: Omit<TaskListCacheParams, 'page'>;
  pages: number[];
  enabled?: boolean;
  prefetchSummaries?: boolean;
  visibleTasks?: Task[];
  kanbanParams?: TaskKanbanCacheParams;
};

export const useTaskPrefetch = ({
  baseParams,
  pages,
  enabled = true,
  prefetchSummaries = false,
  visibleTasks = [],
  kanbanParams,
}: TaskPrefetchOptions): void => {
  const { listCache, kanbanCache, summaryCache, inflightControllers, ttlMs } = useMemo(
    () => getTaskCaches(),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const owned = new Map<string, AbortController>();
    pages.forEach((page) => {
      if (page < 1) {
        return;
      }
      const params: TaskListCacheParams = { ...baseParams, page };
      const cacheKey = buildTaskListKey(params);
      if (listCache.get(cacheKey) || inflightControllers.has(cacheKey)) {
        return;
      }
      const controller = new AbortController();
      inflightControllers.set(cacheKey, controller);
      owned.set(cacheKey, controller);
      api
        .getTasksPage({
          timezone: params.timezone,
          page,
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
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
          }
        })
        .finally(() => {
          if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
        });
    });
    return () => owned.forEach((controller, key) => {
      controller.abort();
      if (inflightControllers.get(key) === controller) inflightControllers.delete(key);
    });
  }, [baseParams, enabled, inflightControllers, listCache, pages, ttlMs]);

  useEffect(() => {
    if (!enabled || !prefetchSummaries || visibleTasks.length === 0) {
      return;
    }
    const owned = new Map<string, AbortController>();
    visibleTasks.forEach((task) => {
      const summaryKey = buildTaskSummaryKey(task.id);
      if (summaryCache.get(summaryKey) || inflightControllers.has(summaryKey)) {
        return;
      }
      const controller = new AbortController();
      inflightControllers.set(summaryKey, controller);
      owned.set(summaryKey, controller);
      api
        .getTaskSummary(task.id, { signal: controller.signal })
        .then((summary) => {
          if (!summary || controller.signal.aborted) {
            return;
          }
          summaryCache.set(summaryKey, summary, ttlMs);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            if (inflightControllers.get(summaryKey) === controller) inflightControllers.delete(summaryKey);
          }
        })
        .finally(() => {
          if (inflightControllers.get(summaryKey) === controller) inflightControllers.delete(summaryKey);
        });
    });
    return () => owned.forEach((controller, key) => {
      controller.abort();
      if (inflightControllers.get(key) === controller) inflightControllers.delete(key);
    });
  }, [enabled, prefetchSummaries, inflightControllers, summaryCache, ttlMs, visibleTasks]);

  useEffect(() => {
    if (!enabled || !kanbanParams) {
      return;
    }
    const owned = new Map<string, AbortController>();
    const cacheKey = buildTaskKanbanKey(kanbanParams);
    if (kanbanCache.get(cacheKey) || inflightControllers.has(cacheKey)) {
      return;
    }
    const controller = new AbortController();
    inflightControllers.set(cacheKey, controller);
    owned.set(cacheKey, controller);
    api
      .getTasksKanban({
        timezone: kanbanParams.timezone,
        pageSize: kanbanParams.pageSize,
        search: kanbanParams.search,
        priority: kanbanParams.priority,
        assigneeId: kanbanParams.assigneeId,
        projectId: kanbanParams.projectId,
        team: kanbanParams.team,
        tag: kanbanParams.tag,
        dueDate: kanbanParams.dueDate,
        createdDate: kanbanParams.createdDate,
        quickFilter: kanbanParams.quickFilter,
        signal: controller.signal,
      })
      .then((response) => {
        if (!response || controller.signal.aborted) {
          return;
        }
        kanbanCache.set(cacheKey, response, ttlMs);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
        }
      })
      .finally(() => {
        if (inflightControllers.get(cacheKey) === controller) inflightControllers.delete(cacheKey);
      });
    return () => owned.forEach((controller, key) => {
      controller.abort();
      if (inflightControllers.get(key) === controller) inflightControllers.delete(key);
    });
  }, [enabled, inflightControllers, kanbanCache, kanbanParams, ttlMs]);
};
