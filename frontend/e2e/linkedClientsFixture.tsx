// Local browser harness only; the application entry never imports this module.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { storeTokens } from '../services/tokenStorage';
import api from '../services/api';
import Clients from '../pages/Clients';
import CreateTaskModal from '../components/CreateTaskModal';
import { Role, UserStatus, type User } from '../types';

const user = { id: 'picker-owner', tenantId: 'picker-tenant', name: 'Asha Reviewer', email: 'asha@example.test',
  role: Role.OWNER, status: UserStatus.ACTIVE, department: 'Engineering', avatarUrl: null } as User;
const users = [user, { ...user, id: 'picker-worker', name: 'Dev Kumar', email: 'dev@example.test' }];
const getProjects = api.getProjects.bind(api);
Object.assign(api, {
  restoreBrowserSession: async () => { storeTokens('synthetic-picker-token', 'synthetic-picker-refresh'); return true; },
  getCurrentUser: async () => user,
  getUsers: async () => users,
  getProjects: async (filters: Parameters<typeof getProjects>[0]) => new URLSearchParams(location.search).has('projects')
    ? getProjects(filters) : ({ items: [], page: 1, totalPages: 1, total: 0, pageSize: 25 }),
});

function Fixture() {
  const { loading } = useAuth();
  const [task, setTask] = useState(false);
  if (loading) return null;
  return <><button onClick={() => setTask(true)}>Open task selector</button><Clients />
    {task && <CreateTaskModal isOpen onClose={() => setTask(false)} onTaskCreated={() => {}} />}</>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><ToastProvider><Fixture /></ToastProvider></AuthProvider></BrowserRouter>);
