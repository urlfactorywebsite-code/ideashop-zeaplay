export const SETTINGS_SECTIONS = [
  { key: 'profile', label: 'General / Profile' },
  { key: 'support', label: 'Support' },
  { key: 'api', label: 'API' },
  { key: 'oauth', label: 'OAuth' },
  { key: 'logs', label: 'Logs' },
  { key: 'media-library', label: 'Media Library' },
  { key: 'sidebar-management', label: 'Sidebar Management' },
  { key: 'push', label: 'Push notifications' },
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number]['key'];

export const SETTINGS_API_SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'token', label: 'Bearer Key Builder' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'smtp', label: 'SMTP' },
] as const;

export type SettingsApiSection = typeof SETTINGS_API_SECTIONS[number]['key'];

export const LEGACY_SETTINGS_ROUTES = {
  '/support': '/settings/support',
  '/master-control': '/settings/profile',
  '/api/overview': '/settings/api/overview',
  '/api/oauth-apps': '/settings/oauth',
  '/oauth/applications': '/settings/oauth/authorized-apps',
  '/api/smtp': '/settings/api/smtp',
  '/logs': '/settings/logs',
  '/media': '/settings/media-library',
} as const;

export function settingsLanding(search: string) {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const section = tab === 'push' ? 'push' : 'profile';
  if (tab === 'push' || tab === 'profile') params.delete('tab');
  return { pathname: `/settings/${section}`, search: params.size ? `?${params}` : '' };
}

export const SETTINGS_RELEASE_NOTES_EVENT = 'zea:settings-release-notes';
