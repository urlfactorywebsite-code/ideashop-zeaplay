// Synthetic loopback-only fixture for permission changes with an open modal.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import TaskDetailModal from '../components/TaskDetailModal';
import api from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';
import { Role, UserStatus, TaskStatus, TaskPriority, TaskCategory, RecurrenceRule, type Task, type User } from '../types';

let viewer = { id: 'reviewer', tenantId: 'review-fixture', name: 'Reviewer', email: 'reviewer@example.test',
  role: Role.OWNER, status: UserStatus.ACTIVE, department: 'Engineering', points: 0, overallXpPoints: 0,
  claimedXpPoints: 0, tasksCreated: 0, tasksCompleted: 0, claimedRewardIds: [], unlockedAchievementIds: [], clarityScores: [] } as User;
const preview: Task = { id: 'private-preview', title: 'Private cached assignment', description: 'Restricted assignment content',
  taskGroupId: 'review-group', status: TaskStatus.TODO, priority: TaskPriority.LOW, category: TaskCategory.OTHER,
  team: 'Engineering', assignedTo: ['other-member'], createdBy: 'another-creator', createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z', dueAt: null, subtasks: [], attachments: [], tags: [],
  recurrenceRule: RecurrenceRule.NONE, recurringTaskId: null, clarityRating: null, estimatedHours: null, canEdit: true };
let hold = false;
const releases: Array<() => void> = [];
const overrides: Record<string, (...args: any[]) => unknown> = {
  restoreBrowserSession: () => { storeTokens('synthetic-preview', 'synthetic-refresh'); return true; },
  getCurrentUser: () => viewer,
  getTask: async () => {
    const authorized = viewer.role === Role.OWNER;
    if (hold) await new Promise<void>(resolve => releases.push(resolve));
    if (!authorized) throw Error('Synthetic assignment access denied');
    return preview;
  },
  getTaskGroup: () => [preview],
  getComments: () => [],
  getKanbanColumns: () => [],
  getActiveWork: () => ({ items: [], running_count: 0, limit: 5, next_offset: null,
    server_time: new Date().toISOString(), user_id: viewer.id, tenant_id: viewer.tenantId }),
};
for (const [name, method] of Object.entries(api)) {
  if (typeof method !== 'function' || ['clearBrowserMemory', 'invalidateNotificationCaches'].includes(name)) continue;
  (api as any)[name] = async (...args: unknown[]) => overrides[name] ? overrides[name](...args) : [];
}
function Harness() {
  const { updateUserInContext } = useAuth();
  Object.assign(window, { groupPreviewReview: {
    switchRole: (role: Role) => { hold = true; viewer = { ...viewer, role }; updateUserInContext(viewer); },
    release: () => { hold = false; releases.splice(0).forEach(resolve => resolve()); },
  } });
  return <ActiveWorkProvider>
    <TaskDetailModal taskId={preview.id} initialTask={preview} isOpen onClose={() => {}} usersMap={new Map()} />
  </ActiveWorkProvider>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><QueryClientProvider client={new QueryClient({
  defaultOptions: { queries: { retry: false } },
})}><AuthProvider><ThemeProvider><ToastProvider><Harness /></ToastProvider></ThemeProvider></AuthProvider></QueryClientProvider></MemoryRouter>);
