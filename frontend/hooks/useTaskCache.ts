import { TaskKanbanResponse, TaskPageResponse, TaskPriority, TaskStatus, TaskSummary } from '../types';
import { LRUCache } from '../utils/lruCache';

const DEFAULT_TASK_CACHE_TTL_MS = 60000;

export type TaskListCacheParams = {
  viewMode: 'list' | 'grid' | 'kanban';
  page: number;
  pageSize: number;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  projectId?: string;
  team?: string;
  tag?: string;
  dueDate?: string;
  createdDate?: string;
  quickFilter?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

export type TaskKanbanCacheParams = {
  pageSize?: number;
  search?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  projectId?: string;
  team?: string;
  tag?: string;
  dueDate?: string;
  createdDate?: string;
  quickFilter?: string;
};

const listCache = new LRUCache<TaskPageResponse>(50);
const kanbanCache = new LRUCache<TaskKanbanResponse>(20);
const summaryCache = new LRUCache<TaskSummary>(200);
const inflightControllers = new Map<string, AbortController>();

const normalizeParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  Object.keys(params)
    .sort()
    .forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null || value === '') {
        return;
      }
      normalized[key] = value;
    });
  return normalized;
};

const stableSerialize = (params: Record<string, unknown>): string => {
  const normalized = normalizeParams(params);
  return JSON.stringify(normalized);
};

export const buildTaskListKey = (params: TaskListCacheParams): string => {
  return `tasks:list:${stableSerialize(params)}`;
};

export const buildTaskKanbanKey = (params: TaskKanbanCacheParams): string => {
  return `tasks:kanban:${stableSerialize(params)}`;
};

export const buildTaskSummaryKey = (taskId: string): string => {
  return `tasks:summary:${taskId}`;
};

export const getTaskCaches = () => ({
  listCache,
  kanbanCache,
  summaryCache,
  inflightControllers,
  ttlMs: DEFAULT_TASK_CACHE_TTL_MS,
});

export const invalidateTaskCaches = (): void => {
  listCache.clear();
  kanbanCache.clear();
  summaryCache.clear();
};
