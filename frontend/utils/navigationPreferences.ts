import type { SidebarPreferences } from './sidebarPreferences';
import type { NavigationDocument, NavigationPage } from '../types/navigation';

export function resolveNavigationPage(document: NavigationDocument | null, id: string): NavigationPage | undefined {
  const page = document?.pages.find(entry => entry.id === id);
  if (page || id !== 'tasks.list') return page;
  // Before task tabs existed, the server authorized the same list through tasks.
  // Inherit that decision only when the new entry is absent; never override a denial.
  const parent = document?.pages.find(entry => entry.id === 'tasks');
  return parent ? { ...parent, id, parentId: 'tasks', navigationLocation: 'task-tab' } : undefined;
}

export function pageIdForPath(path: string, search = ''): string | undefined {
  try { path = decodeURIComponent(path).replace(/\/+$/, '').toLowerCase() || '/'; } catch { return undefined; }
  if (path === '/settings/master-control' || path === '/master-control') return 'settings.profile';
  if (path === '/achievements') {
    const sub = new URLSearchParams(search).get('tab');
    return ({ levels: 'levels', rewards: 'rewards', points: 'points-table', templates: 'template-editor' } as Record<string, string>)[sub || ''] || 'achievements';
  }
  if (path.startsWith('/chat/')) return 'chat';
  if (path === '/tasks/kanban') return 'kanban';
  if (path === '/tasks/gantt') return 'gantt';
  if (path === '/tasks/calendar') return 'calendar';
  if (path === '/management/users') return 'users';
  if (path === '/management/clients') return 'clients';
  if (path === '/management' || path.startsWith('/management/')) return 'management';
  if (path === '/settings/oauth/authorized-apps' || path === '/settings/api/oauth/authorized-apps') return 'authorized-apps';
  if (path === '/settings/api/oauth' || path === '/api/oauth-apps') return 'settings.oauth';
  if (path.startsWith('/settings/')) return `settings.${path.split('/')[2]}`;
  return ({ '/dashboard': 'dashboard', '/tasks': 'tasks', '/chat': 'chat', '/oauth/applications': 'authorized-apps',
    '/projects': 'projects', '/kanban': 'kanban', '/tickets': 'tickets', '/clients': 'clients', '/admin/users': 'users',
    '/gantt': 'gantt', '/reports': 'reports', '/achievements': 'achievements', '/settings': 'settings', '/calendar': 'calendar',
    '/tool-library': 'tool-library', '/levels': 'levels', '/admin/rewards': 'rewards', '/admin/points-table': 'points-table',
    '/template-editor': 'template-editor', '/media': 'settings.media-library', '/logs': 'settings.logs',
    '/api/overview': 'settings.api', '/api/oauth-apps': 'settings.api', '/api/smtp': 'settings.api',
    '/support': 'settings.support' } as Record<string, string>)[path];
}

export function migratePersonal(value: SidebarPreferences): SidebarPreferences {
  const id = (key: string) => pageIdForPath(key.split('?')[0], key.includes('?') ? `?${key.split('?')[1]}` : '') || key;
  return { order: [...new Set(value.order.map(id))], labels: Object.fromEntries(Object.entries(value.labels).map(([key, label]) => [id(key), label])) };
}

