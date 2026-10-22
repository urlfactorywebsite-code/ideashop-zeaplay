// Synthetic local test entry; never imported by the application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { storeTokens } from '../services/tokenStorage';
import api from '../services/api';
import Projects from '../pages/Projects';
import { Role, UserStatus, type User } from '../types';

const users = [
  { id: 'bob', name: 'Bob Williams', email: 'bob@example.test', role: Role.ADMIN },
  { id: 'alice', name: 'Alice Johnson', email: 'alice@example.test', role: Role.OWNER },
  { id: 'maya', name: 'Maya Lead', email: 'maya@example.test', role: Role.MANAGER },
  { id: 'charlie', name: 'Charlie Brown', email: 'charlie@example.test', role: Role.USER },
  { id: 'dana', name: 'Dana Davis', email: 'dana@example.test', role: Role.USER },
].map(person => ({ ...person, tenantId: 'project-form-tenant', status: UserStatus.ACTIVE, department: 'Engineering', avatarUrl: null })) as User[];
Object.assign(api, {
  restoreBrowserSession: async () => { storeTokens('synthetic-form-token', 'synthetic-form-refresh'); return true; },
  getCurrentUser: async () => users[1],
  getUsers: async () => users,
});
const content = new URLSearchParams(location.search).has('shell')
  ? <div className="flex h-screen flex-col overflow-hidden">
      <header className="zea-app-header relative z-[70] flex h-24 shrink-0 items-center px-6">Application header</header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-64 shrink-0 bg-slate-950 md:block">Sidebar</aside>
        <main className="layout-main-surface min-w-0 flex-1 overflow-auto p-6" style={{ transform: 'translateZ(0)' }}><Projects /></main>
      </div>
    </div>
  : <Projects />;
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider>{content}</AuthProvider></BrowserRouter>);
