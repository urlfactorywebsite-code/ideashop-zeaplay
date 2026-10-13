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
      api
        .getTasksPage({
          page,
          pageSize: params.pageSize,
          search: params.search,
          status: params.status,
          priority: params.priority,
          assigneeId: params.assigneeId,
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
            inflightControllers.delete(cacheKey);
          }
        })
        .finally(() => {
          inflightControllers.delete(cacheKey);
        });
    });
  }, [baseParams, enabled, inflightControllers, listCache, pages, ttlMs]);

  useEffect(() => {
    if (!enabled || !prefetchSummaries || visibleTasks.length === 0) {
      return;
    }
    visibleTasks.forEach((task) => {
      const summaryKey = buildTaskSummaryKey(task.id);
      if (summaryCache.get(summaryKey) || inflightControllers.has(summaryKey)) {
        return;
      }
      const controller = new AbortController();
      inflightControllers.set(summaryKey, controller);
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
            inflightControllers.delete(summaryKey);
          }
        })
        .finally(() => {
          inflightControllers.delete(summaryKey);
        });
    });
  }, [enabled, prefetchSummaries, inflightControllers, summaryCache, ttlMs, visibleTasks]);

  useEffect(() => {
    if (!enabled || !kanbanParams) {
      return;
    }
    const cacheKey = buildTaskKanbanKey(kanbanParams);
    if (kanbanCache.get(cacheKey) || inflightControllers.has(cacheKey)) {
      return;
    }
    const controller = new AbortController();
    inflightControllers.set(cacheKey, controller);
    api
      .getTasksKanban({
        pageSize: kanbanParams.pageSize,
        search: kanbanParams.search,
        priority: kanbanParams.priority,
        assigneeId: kanbanParams.assigneeId,
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
          inflightControllers.delete(cacheKey);
        }
      })
      .finally(() => {
        inflightControllers.delete(cacheKey);
      });
  }, [enabled, inflightControllers, kanbanCache, kanbanParams, ttlMs]);
};
