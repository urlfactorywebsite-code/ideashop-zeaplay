// Browser security review: real authentication, navigation policy and OAuth APIs.
// Only unrelated dashboard/layout services are replaced with synthetic responses.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import api from '../services/mockApi';

const real = new Set(['login', 'getCurrentUser', 'restoreBrowserSession', 'logout', 'clearBrowserMemory', 'invalidateNotificationCaches']);
const substitutes: Record<string, unknown> = {
  getReleaseNotes: { versionLabel: 'Zea.Play V6.0.1', updates: [], content: '' },
  getActiveWork: { items: [], running_count: 0, limit: 5, next_offset: null, server_time: new Date().toISOString() },
};
for (const [name, method] of Object.entries(api)) {
  if (typeof method === 'function' && !real.has(name)) (api as any)[name] = async () => substitutes[name] ?? [];
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
