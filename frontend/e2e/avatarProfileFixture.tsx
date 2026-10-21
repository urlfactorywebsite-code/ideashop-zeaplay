import { LoadingProvider } from '../components/loading/LoadingProvider';
// Isolated loopback fixture; production does not import this entry point.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, SearchProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import ProfileSettings from '../pages/ProfileSettings';
import Users from '../pages/Users';
import Header from '../components/Header';
import Projects from '../pages/Projects';
import TaskDetailModal from '../components/TaskDetailModal';
import { ToastProvider } from '../hooks/useToast';
import { User, Task, TaskStatus, TaskPriority, TaskCategory, RecurrenceRule, Project, ProjectStatus, ProjectMemberRole, ClientStatus } from '../types';
import api, { http } from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';

const role = new URLSearchParams(location.search).get('role') || 'owner';
const session = await http.get('/fixture/session', { params: { role } });
storeTokens(session.data.token, 'fixture-refresh');
api.restoreBrowserSession = async () => true;
api.getCurrentUser = () => api.getUserProfile(session.data.id);
const emptyPage = { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 };
for (const name of ['getTasks', 'getRewards', 'getNotifications', 'getFeatureFlags', 'getReleaseNotes', 'getLevels', 'getAchievements']) (api as any)[name] = async () => [];
(api as any).getActiveWork = async () => ({ items: [], running_count: 0, limit: 5, server_time: new Date().toISOString(), user_id: session.data.id });
(api as any).getProjects = async () => emptyPage;
(api as any).getMediaProviders = async () => [];
(api as any).getStorageConfig = async () => ({ provider: 'local' });
(api as any).getPushStatus = async () => ({ configured: false });

const propagation = new URLSearchParams(location.search).has('propagation');
if (propagation) {
  const owner = await api.getUserProfile(session.data.id);
  const now = new Date().toISOString();
  const task = { id: 'avatar-fixture-task', title: 'Avatar propagation task', description: 'Synthetic QA task', status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM, category: TaskCategory.WORK, team: '', assignedTo: [owner.id], taskGroupId: null,
    createdBy: owner.id, createdAt: now, updatedAt: now, dueAt: null, subtasks: [], recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null, clarityRating: null, attachments: [], estimatedHours: null, tags: [] } as Task;
  const project = { id: 'avatar-fixture-project', tenantId: owner.tenantId!, name: 'Avatar QA project', normalizedName: 'avatar qa project',
    clientId: 'fixture-client', status: ProjectStatus.ACTIVE, client: { id: 'fixture-client', companyName: 'Fixture client', status: ClientStatus.ACTIVE },
    members: [{ id: 'member', userId: owner.id, name: owner.name, email: owner.email, userRole: owner.role, status: owner.status, role: ProjectMemberRole.MANAGER }],
    taskCount: 1, createdAt: now, updatedAt: now } as Project;
  api.getProjects = async () => ({ ...emptyPage, items: [project], total: 1, totalPages: 1 });
  api.getTask = async () => task;
  api.getTaskGroup = async () => [task];
  api.getComments = async () => [{ id: 'fixture-comment', taskId: task.id, userId: owner.id, content: 'Avatar comment author', createdAt: now }];
  api.listTaskTransferRequests = async () => [];
  (api as any).getClients = async () => ({ ...emptyPage, items: [project.client] });
  (api as any).getProjectTaskDashboard = async () => ({ ...emptyPage, project,
    summary: { taskTotal: 0, subtaskTotal: 0, completedSubtasks: 0, progressPercent: 0, totalTrackedSeconds: 0, activeTimerCount: 0,
      statusCounts: {}, derivedStatusCounts: {}, subtaskStatusCounts: {}, priorityCounts: {}, workload: [] }, statusPolicy: 'fixture' });
  // Real profile mutations publish through the production API mapper while
  // stale project/task user props stay mounted, proving cross-surface updates.
  (window as any).avatarReview = {
    upload: (source: string) => api.uploadCurrentUserAvatar(source),
    remove: () => api.updateCurrentUserProfile(owner.id, { avatarAssetId: null }),
  };
}

function Fixture() {
  const { user } = useAuth();
  const [directory, setDirectory] = useState(false);
  const [people, setPeople] = useState<User[]>([]);
  useEffect(() => { if (propagation) void api.getUsers().then(setPeople); }, []);
  if (!user) return null;
  return <ActiveWorkProvider><Header onNotificationClick={() => {}} onRewardNotificationClick={() => {}} />
    <main className="mx-auto max-w-6xl px-4 py-6"><nav className="mb-6 flex gap-3"><button onClick={() => setDirectory(false)}>Profile settings</button><button onClick={() => setDirectory(true)}>User directory</button></nav>
      {propagation ? <><div data-testid="projects"><Projects /></div><div data-testid="task-comments"><TaskDetailModal isOpen taskId="avatar-fixture-task" onClose={() => {}} usersMap={new Map(people.map(person => [person.id, person]))} /></div></> : directory ? <Users /> : <ProfileSettings />}
    </main></ActiveWorkProvider>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider><LoadingProvider><AuthProvider><SearchProvider><ToastProvider><Fixture /></ToastProvider></SearchProvider></AuthProvider></LoadingProvider></ThemeProvider></QueryClientProvider></BrowserRouter>);
