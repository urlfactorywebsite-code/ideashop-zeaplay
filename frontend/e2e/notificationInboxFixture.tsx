// Synthetic loopback-only fixture for the real Header, auth and notification hook.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Header from '../components/Header';
import { AuthProvider, SearchProvider, ThemeProvider } from '../hooks/useAuth';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import { LoadingProvider } from '../components/loading/LoadingProvider';
import api from '../services/mockApi';
import { storeTokens } from '../services/tokenStorage';
import { Role, UserStatus, type User } from '../types';
import '../index.css';

let user = { id: 'inbox-owner', tenantId: 'inbox-guild', name: 'Inbox Owner', email: 'inbox@example.test',
  role: Role.OWNER, status: UserStatus.ACTIVE, avatarUrl: null, claimedRewardIds: [], unlockedAchievementIds: [] } as User;
api.restoreBrowserSession = async () => { storeTokens('synthetic-' + user.id, 'synthetic-refresh-' + user.id); return true; };
api.getCurrentUser = async () => user;
api.getUsers = async () => [user];
api.getActiveWork = async () => ({ items: [], running_count: 0, limit: 5, next_offset: null,
  server_time: new Date().toISOString(), user_id: user.id, tenant_id: user.tenantId });
Object.assign(window, { notificationInboxFixture: {
  switchAccount: () => {
    user = { ...user, id: 'inbox-other', tenantId: 'other-guild', name: 'Other Guild' };
    storeTokens('synthetic-inbox-other', 'synthetic-inbox-other-refresh');
    window.dispatchEvent(new StorageEvent('storage', { key: 'zea_session_changed', newValue: 'other' }));
  },
} });
function Fixture() {
  const location = useLocation();
  return <><Header onNotificationClick={() => {}} onRewardNotificationClick={() => {}} />
    <main className="p-6 text-text-primary" data-testid="notification-destination">{location.pathname}{location.search}</main></>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}>
  <HashRouter><ThemeProvider><LoadingProvider><AuthProvider><SearchProvider><ActiveWorkProvider><Fixture /></ActiveWorkProvider></SearchProvider></AuthProvider></LoadingProvider></ThemeProvider></HashRouter>
</QueryClientProvider>);
