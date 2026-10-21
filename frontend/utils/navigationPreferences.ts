import type { SidebarPreferences } from './sidebarPreferences';

export function pageIdForPath(path: string, search = ''): string | undefined {
  try { path = decodeURIComponent(path).replace(/\/+$/, '').toLowerCase() || '/'; } catch { return undefined; }
  if (path === '/settings/master-control' || path === '/master-control') return 'settings.profile';
  if (path === '/achievements') {
    const sub = new URLSearchParams(search).get('tab');
    return ({ levels: 'levels', rewards: 'rewards', points: 'points-table', templates: 'template-editor' } as Record<string, string>)[sub || ''] || 'achievements';
  }
  if (path.startsWith('/chat/')) return 'chat';
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

