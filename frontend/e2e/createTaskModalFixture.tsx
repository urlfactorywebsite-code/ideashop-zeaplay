// Disposable loopback harness. Creation and upload use the application's HTTP adapter.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, ThemeProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import CreateTaskModal from '../components/CreateTaskModal';
import api from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';
import { Role, UserStatus, type User } from '../types';

const viewer = { id: 'creator', tenantId: 'modal-fixture', name: 'Asha Reviewer', email: 'creator@example.test',
  timezone: 'Asia/Kolkata', role: new URLSearchParams(location.search).has('user') ? Role.USER : Role.OWNER,
  status: UserStatus.ACTIVE, department: 'Management', points: 0,
  claimedRewardIds: [], unlockedAchievementIds: [], clarityScores: [] } as User;
const users = [viewer, ...['worker-a', 'worker-b', 'follower'].map((id, i) => ({ ...viewer, id,
  name: ['Dev Kumar', 'Leena Shah', 'Nila Rao'][i], email: `${id}@example.test`, role: Role.USER }))];
const overrides: Record<string, (...args: any[]) => unknown> = {
  restoreBrowserSession: () => { storeTokens('synthetic-modal', 'synthetic-refresh'); return true; },
  getCurrentUser: () => viewer,
  getUsers: () => users,
  getProjects: () => {
    const items = [{ id: 'project-1', name: 'Website refresh', status: 'ACTIVE', members: users.map(user => ({ userId: user.id })) }];
    if (new URLSearchParams(location.search).has('projects')) items.push(
      { id: 'project-2', name: 'Leena project', status: 'ACTIVE', members: [{ userId: 'worker-b' }] },
      { id: 'project-empty', name: 'Empty project', status: 'ACTIVE', members: [] });
    return { items, page: 1, totalPages: 1, total: items.length };
  },
};
for (const [name, method] of Object.entries(api)) {
  if (typeof method !== 'function' || ['createTask', 'createTicketTask', 'uploadTaskAttachment', 'getKanbanColumns', 'clearBrowserMemory'].includes(name)) continue;
  (api as any)[name] = async (...args: unknown[]) => overrides[name] ? overrides[name](...args) : [];
}
function Fixture() {
  const [open, setOpen] = useState(true);
  const ticket = new URLSearchParams(location.search).has('ticket');
  return <><button onClick={() => setOpen(true)}>Open create task</button>{open && <CreateTaskModal isOpen
    onClose={() => setOpen(false)} onTaskCreated={() => {}} dueTimezone={new URLSearchParams(location.search).get('zone') || 'Asia/Kolkata'}
    {...(ticket ? { ticketId: 'ticket-1', ticketTitle: 'Existing ticket task', ticketDescription: 'Ticket description' } : {})} />}</>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><AuthProvider><ThemeProvider><ToastProvider><Fixture /></ToastProvider></ThemeProvider></AuthProvider></MemoryRouter>);
