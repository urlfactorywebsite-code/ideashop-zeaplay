// Synthetic loopback-only fixture; never imported by the application entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import api from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';
import { publishTaskRealtime } from '../services/taskRealtimeEvents';
import { Role, TaskStatus, TaskPriority, UserStatus } from '../types';
import { DateTime } from 'luxon';

const params = new URLSearchParams(location.search);
const role = params.get('role') as Role || Role.OWNER;
const rowCount = Number(params.get('rows') || 2);
const user = { id: params.get('account') || 'task-reviewer', tenantId: params.get('tenant') || 'task-fixture', name: 'Task Reviewer', email: 'reviewer@example.test',
  role, status: UserStatus.ACTIVE, points: 0, overallXpPoints: 0, claimedXpPoints: 0, tasksCreated: 0,
  tasksCompleted: 0, claimedRewardIds: [], unlockedAchievementIds: [], clarityScores: [], department: 'Engineering', timezone: params.get('zone') || undefined };
const now = new Date();
const due = new Date(now); due.setDate(due.getDate() + 1);
let tasks = Array.from({ length: rowCount }, (_, index) => ({
  id: `task-${index}`, taskGroupId: `group-${index}`, title: `Navigation task ${index}`, description: 'Synthetic task for navigation checks',
  status: index % 2 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO, priority: TaskPriority.HIGH, team: 'Engineering', category: 'General', assignedTo: [user.id],
  createdBy: user.id, createdAt: now.toISOString(), dueAt: params.get('due') || due.toISOString(), completedAt: null,
  recurrenceRule: 'NONE', recurringTaskId: null, clarityRating: null, estimatedHours: 2,
  attachments: [], subtasks: [], tags: [], followerIds: [], points: 0, projectId: index < 60 ? 'project-0' : 'project-1', updatedAt: now.toISOString(),
  dependencies: index === 0 ? [{ id: 'task-1', title: 'Navigation task 1' }] : [],
}));
if (params.has('multiAssignee')) {
  tasks = tasks.map((task, index) => ({ ...task, canEdit: params.has('memberPermissions') ? index === 3 : !params.has('readOnlyParty'), taskGroupId: 'shared-fixture-group', title: 'Shared mission',
    priority: TaskPriority.LOW, dueAt: null, completedAt: index < 2 ? '2026-11-02T06:00:00Z' : null,
    project: { id: 'project-0', name: 'Verification project', status: 'ACTIVE' },
    status: index < 2 ? TaskStatus.DONE : TaskStatus.IN_PROGRESS, assignedTo: [`member-${index}`] }));
}
const calls: { method: string; args: unknown[] }[] = [];
const rawTasks = api.getTasks.bind(api);
const rawTaskPage = api.getTasksPage.bind(api);
const rawTaskGroup = api.getTaskGroup.bind(api);
const rawDeleteTask = api.deleteTask.bind(api);
let rejectUpdate = false;
const changed = () => publishTaskRealtime({ userId: user.id, tenantId: user.tenantId, payload: { type: 'task.updated' } });
Object.assign(window, { taskNavigationAudit: { calls, changed, rawTasks, rawTaskGroup,
  rotateSession: () => storeTokens('synthetic-next-task-token', 'synthetic-next-task-refresh'),
  moveMember: (id: string, status: TaskStatus) => { tasks = tasks.map(task => task.id === id ? { ...task, status } : task); publishTaskRealtime({ userId: user.id, tenantId: user.tenantId, payload: { type: 'task.updated', task_id: id } }); },
  rejectNextUpdate: () => { rejectUpdate = true; }, move: (notify = true) => {
  tasks = tasks.map(task => task.id === 'task-0' ? { ...task, status: TaskStatus.DONE } : task); if (notify) changed();
} } });
const filtered = (params: any = {}) => tasks.filter(task => (!params.status || task.status === params.status)
  && (!params.priority || task.priority === params.priority)
  && (!params.assigneeId || task.assignedTo.includes(params.assigneeId))
  && (!params.projectId || task.projectId === params.projectId)
  && (!params.search || task.title.toLowerCase().includes(params.search.toLowerCase())));
const page = (params: any = {}) => ({ items: filtered(params).slice(((params.page || 1) - 1) * (params.pageSize || 50), (params.page || 1) * (params.pageSize || 50)), total: filtered(params).length, page: params.page || 1, pageSize: params.pageSize || 50, totalPages: Math.max(1, Math.ceil(filtered(params).length / (params.pageSize || 50))),
  statusCounts: Object.fromEntries(Object.values(TaskStatus).map(status => [status, filtered(params).filter(task => task.status === status).length])) });
const calendarTasks = (params: any) => filtered(params).filter(task => {
  const date = DateTime.fromISO(task.dueAt, { zone: 'utc' }).setZone(params.timezone || 'UTC').toISODate()!;
  return date >= params.startDate && date <= (params.endDate || params.startDate);
});
const summary = (params: any) => ({ startDate: params.startDate, endDate: params.endDate, days: Array.from(new Set(calendarTasks(params).map(task => DateTime.fromISO(task.dueAt, { zone: 'utc' }).setZone(params.timezone || 'UTC').toISODate()!))).map(date => ({ date,
  total: calendarTasks(params).filter(task => DateTime.fromISO(task.dueAt, { zone: 'utc' }).setZone(params.timezone || 'UTC').toISODate() === date).length,
  completed: calendarTasks(params).filter(task => task.status === TaskStatus.DONE).length,
  low: 0, medium: 0, high: calendarTasks(params).length, urgent: 0, overdue: 0, dueSoon: 2 })) });
const emptyPage = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
const overrides: Record<string, (...args: any[]) => unknown> = {
  restoreBrowserSession: () => { storeTokens('synthetic-task-token', 'synthetic-task-refresh'); return true; },
  getCurrentUser: () => user,
  getUsers: () => params.has('multiAssignee') ? [user, ...tasks.map((task, index) => ({ ...user, id: task.assignedTo[0], name: params.has('longPartyName') && index === 0 ? '<script>' + 'x'.repeat(250) : 'Member ' + index, role: Role.USER, avatarUrl: null }))] : [user], getDepartments: () => [{ id: 'engineering', name: 'Engineering' }],
  getReleaseNotes: () => ({ versionLabel: 'Zea.Play V6.0.1', updates: [], content: '' }),
  getActiveWork: () => ({ items: [{ id: 'session-0', entry_id: 'entry-0', status: 'RUNNING', task_id: 'task-1', subtask_id: null,
    project_name: 'Verification project', task_title: 'Navigation task 1', subtask_title: null, subtask_status: 'IN_PROGRESS',
    started_at: now.toISOString(), stopped_at: null, running_since: now.toISOString(),
    active_seconds: 120 + (Date.now() - now.getTime()) / 1000, paused_seconds: 0, range_active_seconds: 120,
    range_paused_seconds: 0, subtask_total_seconds: 120, intervals: [], timeline: [] }],
    running_count: 1, limit: 5, next_offset: null, server_time: now.toISOString(), user_id: user.id, tenant_id: user.tenantId }),
  getFeatureFlags: () => [{ key: 'tasks.create', label: 'Task Creation', group: 'Tasks', description: 'Create tasks', enabled: true }],
  getProjects: () => ({ ...emptyPage, items: [{ id: 'project-0', name: 'Verification project', status: 'ACTIVE',
    createdBy: user.id, assignedTo: [user.id], memberIds: [user.id], createdAt: now.toISOString() }], total: 1 }), getClients: () => emptyPage,
  getTasksPage: options => params.has('networkTaskPage') ? rawTaskPage(options) : page(options), getTasks: () => tasks, getTask: id => tasks.find(task => task.id === id) || tasks[0],
  getTaskGroup: async (id, options) => {
    if (params.has('networkParty')) return rawTaskGroup(id, options);
    if (params.has('partyDelay')) await new Promise(resolve => setTimeout(resolve, 700));
    if (params.has('partyError')) throw Error('Synthetic party outage');
    if (params.has('emptyParty')) return [];
    return tasks.filter(task => params.has('multiAssignee') ? task.taskGroupId === tasks.find(item => item.id === id)?.taskGroupId : task.id === id);
  },
  getKanbanColumns: () => params.has('multiAssignee') ? Object.values(TaskStatus).map((status, order) => ({ id: status, title: status, order, workflowBehavior: status === TaskStatus.ON_HOLD ? 'HOLD' : 'ACTIVE' })) : [],
  deleteTask: id => params.has('networkTaskPage') ? rawDeleteTask(id) : [],
  getTaskCalendarSummary: summary, getTaskCalendarTasks: calendarTasks,
  moveTaskToKanbanStatus: (id, statusId) => {
    const status = statusId.replace('fixture-status-', '') as TaskStatus;
    tasks = tasks.map(task => task.id === id ? { ...task, status } : task); changed(); return tasks.find(task => task.id === id);
  },
  getTasksKanban: options => ({ columns: Object.values(TaskStatus).map((status, order) => ({ status,
    ...(params.has('multiAssignee') ? { statusId: 'fixture-status-' + status, title: status } : {}),
    title: params.get('customStage') && status === TaskStatus.TODO ? 'Custom owner stage' : params.has('multiAssignee') ? status : undefined,
    order, items: filtered(options).filter(task => task.status === status).slice(((options.page || 1) - 1) * (options.pageSize || 20), (options.page || 1) * (options.pageSize || 20)),
    count: filtered(options).filter(task => task.status === status).length })) }),
  getComments: () => [],
  updateTask: (id, updates) => {
    if (rejectUpdate) { rejectUpdate = false; throw new Error('Synthetic transition rejected'); }
    tasks = tasks.map(task => task.id === id ? { ...task, ...updates } : task); changed(); return tasks.find(task => task.id === id);
  },
  createTask: data => { const task = { ...tasks[0], ...data, id: 'created-task', createdBy: user.id }; tasks.push(task); changed(); return [task]; },
};
for (const [name, method] of Object.entries(api)) {
  if (typeof method !== 'function' || ['clearBrowserMemory', 'invalidateNotificationCaches'].includes(name)) continue;
  (api as any)[name] = async (...args: unknown[]) => {
    calls.push({ method: name, args });
    return overrides[name] ? overrides[name](...args) : [];
  };
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
