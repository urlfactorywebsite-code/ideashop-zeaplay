// Synthetic manifest generated from backend/app/navigation_registry.py.
import { readFileSync } from 'node:fs';
export const manifest = JSON.parse(readFileSync(new URL('./navigation-manifest.json', import.meta.url), 'utf8'));
export const apiManifest = JSON.parse(readFileSync(new URL('./navigation-api-manifest.json', import.meta.url), 'utf8'));
export function navigationDocument(role, rules = {}, revision = 0) {
  const pages = manifest.map(page => ({ ...page, enabled: true, hidden: false, allowedRoles: [...page.permittedRoles], ...rules[page.id] }));
  const access = id => {
    const page = pages.find(page => page.id === id);
    if (!page.permittedRoles.includes(role)) return 'forbidden';
    if (page.parentId && ['disabled', 'forbidden'].includes(access(page.parentId))) return access(page.parentId);
    if (!page.enabled) return 'disabled';
    if (!page.allowedRoles.includes(role)) return 'forbidden';
    if (page.hidden || (page.parentId && access(page.parentId) === 'hidden')) return 'hidden';
    return 'allowed';
  };
  return { revision, updatedAt: revision ? '2026-10-21T12:00:00Z' : null, updatedBy: revision ? 'synthetic-owner' : null,
    actorRole: role, oauthManagementAccess: !['owner', 'admin'].includes(role) ? 'forbidden'
      : !rules['settings.oauth'] && rules['settings.api'] ? access('settings.api') : access('settings.oauth'),
    apiSections: apiManifest.map(section => ({ key: section.key, label: section.label, access: section.roles.includes(role) ? access('settings.api') : 'forbidden' })),
    roles: ['user', 'admin', 'manager', 'owner'], canManageGlobal: role === 'owner', canManagePersonal: ['admin', 'owner'].includes(role),
    pages: pages.map(page => ({ ...page, access: access(page.id) })) };
}
