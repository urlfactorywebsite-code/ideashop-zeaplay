// Synthetic local-only navigation fixture. Never imported by the app entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import api from '../services/mockApi';
import { oauthApi } from '../services/oauthApi';
import { storeTokens } from '../services/tokenStorage';
import { Role, UserStatus, type User } from '../types';

const params = new URLSearchParams(location.search);
const role = params.get('role') as Role || Role.OWNER;
let user = { id: params.get('account') || 'settings-reviewer', tenantId: params.get('tenant') || 'settings-fixture', name: 'Settings Reviewer',
  email: 'settings@example.test', role, status: UserStatus.ACTIVE, points: 0, overallXpPoints: 0,
  claimedXpPoints: 0, tasksCreated: 0, tasksCompleted: 0, claimedRewardIds: [],
  unlockedAchievementIds: [], clarityScores: [], department: 'Engineering' } as User;
const audit = { calls: [] as { method: string; args: unknown[] }[] };
Object.assign(window, { settingsNavigationAudit: audit });
const emptyPage = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
const overrides: Record<string, (...args: any[]) => unknown> = {
  restoreBrowserSession: () => { storeTokens('synthetic-navigation-token', 'synthetic-navigation-refresh'); return true; },
  getCurrentUser: () => user,
  getUsers: () => [user], getDepartments: () => [{ id: 'engineering', name: 'Engineering' }],
  getReleaseNotes: () => ({ versionLabel: 'Zea.Play V6.0.1', updates: [], content: '' }),
  getActiveWork: () => ({ items: [], running_count: 0, limit: 5, next_offset: null, server_time: new Date().toISOString(), user_id: user.id, tenant_id: user.tenantId }),
  getFeatureFlags: () => [{ key: 'tasks.create', label: 'Task Creation', group: 'Tasks', description: 'Create tasks', enabled: true }],
  updateFeatureFlags: flags => flags,
  getAuditLogs: () => emptyPage,
  getAuditRetention: () => ({ retentionDays: 90, canManage: role === Role.OWNER }),
  listMediaFiles: () => emptyPage,
  getProjects: () => emptyPage,
  getClients: () => emptyPage,
  getPushStatus: () => ({ configured: false, publicKeyConfigured: false, privateKeyConfigured: false, subjectConfigured: false, configurationValid: false, activeSubscriptionCount: 0 }),
  updateCurrentUserProfile: (_id, changes) => { user = { ...user, ...changes }; return user; },
  changeCurrentUserPassword: () => undefined,
  getSmtpManagement: () => ({ profiles: [], jobs: [], attempts: [], health: {
    profiles: 0, enabled_profiles: 0, healthy_profiles: 0, as_of: new Date().toISOString(),
    queue: { queued: 0, sending: 0, retrying: 0, failed: 0, uncertain: 0 },
    profile_stats: {}, definitions: {}, retired_profile_keys: [], window_hours: 24,
    smtp_accepted: 0, failed_attempts: 0, success_percentage: null, average_processing_ms: null,
  } }),
};
for (const [name, value] of Object.entries(api)) {
  if (typeof value !== 'function') continue;
  if (['clearBrowserMemory', 'invalidateNotificationCaches'].includes(name)) continue;
  (api as any)[name] = async (...args: unknown[]) => {
    audit.calls.push({ method: name, args });
    return overrides[name] ? overrides[name](...args) : [];
  };
}
for (const name of ['dashboard', 'clients', 'scopes', 'grants', 'tokens', 'events'] as const) {
  (oauthApi as any)[name] = async () => {
    audit.calls.push({ method: `oauth.${name}`, args: [] });
    return name === 'dashboard' ? { configured: true, tenant_id: user.tenantId, total_clients: 0,
      enabled_clients: 0, disabled_clients: 0, active_grants: 0, revoked_grants: 0,
      recent_activity: 0, trends: [], expiring_credentials: [], usage: [] } : [];
  };
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
