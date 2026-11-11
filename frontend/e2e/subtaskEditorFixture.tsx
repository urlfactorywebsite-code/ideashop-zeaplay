// Synthetic loopback-only harness; uses the real HTTP mapper for add/edit.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ThemeProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import TaskDetailModal from '../components/TaskDetailModal';
import api from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';
import { Role, UserStatus, TaskStatus, TaskPriority, TaskCategory, RecurrenceRule, type Task, type User } from '../types';

const readOnly = new URLSearchParams(location.search).has('readOnly');
const viewer = { id: 'reviewer', tenantId: 'subtask-fixture', name: 'Reviewer', email: 'reviewer@example.test',
  role: Role.OWNER, status: UserStatus.ACTIVE, department: 'Engineering', points: 0,
  claimedRewardIds: [], unlockedAchievementIds: [], clarityScores: [] } as User;
const task: Task = { id: 'subtask-parent', title: 'Subtask editor review', description: 'Synthetic task',
  status: TaskStatus.TODO, priority: TaskPriority.LOW, category: TaskCategory.OTHER, team: 'Engineering',
  assignedTo: [viewer.id], createdBy: viewer.id, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  dueAt: null, subtasks: [], attachments: [], tags: [], recurrenceRule: RecurrenceRule.NONE,
  recurringTaskId: null, clarityRating: null, estimatedHours: null,
  canEdit: !readOnly, canManageSubtasks: !readOnly, canReviewSubtasks: !readOnly };
const overrides: Record<string, (...args: any[]) => unknown> = {
  restoreBrowserSession: () => { storeTokens('synthetic-subtask', 'synthetic-refresh'); return true; },
  getCurrentUser: () => viewer,
  getTask: () => task,
  getTaskGroup: () => [task],
  getComments: () => [],
  getKanbanColumns: () => [],
  getActiveWork: () => ({ items: [], running_count: 0, limit: 5, next_offset: null,
    server_time: new Date().toISOString(), user_id: viewer.id, tenant_id: viewer.tenantId }),
};
for (const [name, method] of Object.entries(api)) {
  if (typeof method !== 'function' || ['createSubtask', 'updateSubtask', 'clearBrowserMemory', 'invalidateNotificationCaches'].includes(name)) continue;
  (api as any)[name] = async (...args: unknown[]) => overrides[name] ? overrides[name](...args) : [];
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><QueryClientProvider client={new QueryClient({
  defaultOptions: { queries: { retry: false } },
})}><AuthProvider><ThemeProvider><ToastProvider><ActiveWorkProvider>
  <TaskDetailModal taskId={task.id} initialTask={task} isOpen onClose={() => {}} usersMap={new Map([[viewer.id, viewer]])} />
</ActiveWorkProvider></ToastProvider></ThemeProvider></AuthProvider></QueryClientProvider></MemoryRouter>);
