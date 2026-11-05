import test from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '../types';
import { navigationDocument } from '../e2e/navigation-fixture.mjs';
import { SETTINGS_SECTIONS, SETTINGS_API_SECTIONS, LEGACY_SETTINGS_ROUTES, settingsLanding } from '../utils/settingsNavigation';

for (const [role, keys] of [
  [Role.USER, ['profile', 'support', 'oauth', 'media-library', 'push']],
  [Role.MANAGER, ['profile', 'support', 'oauth', 'logs', 'media-library', 'push']],
  [Role.ADMIN, ['profile', 'support', 'api', 'oauth', 'logs', 'media-library', 'sidebar-management', 'push']],
  [Role.OWNER, ['profile', 'support', 'api', 'oauth', 'logs', 'media-library', 'sidebar-management', 'push']],
] as const) {
  test(`${role} sees only the established Settings permissions`, () => {
    assert.deepEqual(SETTINGS_SECTIONS.filter(section => navigationDocument(role).pages.find(page => page.id === `settings.${section.key}`)?.access === 'allowed').map(section => section.key), keys);
  });
}

test('server decisions retain admin SMTP/OAuth without exposing owner tools or user API access', () => {
  const visible = (role: Role) => navigationDocument(role).apiSections.filter(section => section.access === 'allowed').map(section => section.key);
  assert.deepEqual(visible(Role.ADMIN), ['smtp']);
  assert.equal(visible(Role.OWNER).length, 5);
  assert.deepEqual(visible(Role.USER), []);
  assert.deepEqual(visible(Role.MANAGER), []);
});

test('saved legacy API restrictions continue to protect OAuth management until OAuth is configured independently', () => {
  const legacy = navigationDocument(Role.ADMIN, { 'settings.api': { enabled: false } });
  assert.equal(legacy.oauthManagementAccess, 'disabled');
  assert.equal(legacy.pages.find(page => page.id === 'authorized-apps')?.access, 'allowed');
  assert.equal(navigationDocument(Role.ADMIN, {
    'settings.api': { enabled: false }, 'settings.oauth': { enabled: true },
  }).oauthManagementAccess, 'allowed');
  assert.equal(navigationDocument(Role.USER).oauthManagementAccess, 'forbidden');
});

test('Settings defaults to profile and retains unrelated query parameters', () => {
  assert.deepEqual(settingsLanding('?filter=active'), { pathname: '/settings/profile', search: '?filter=active' });
  assert.deepEqual(settingsLanding('?tab=profile&filter=active'), { pathname: '/settings/profile', search: '?filter=active' });
});

test('old push links retain query parameters while selecting the canonical route', () => {
  assert.deepEqual(settingsLanding('?tab=push&filter=active&filter=mine'), { pathname: '/settings/push', search: '?filter=active&filter=mine' });
});

test('every relocated bookmark targets an existing Settings section', () => {
  assert.equal(new Set(Object.keys(LEGACY_SETTINGS_ROUTES)).size, 8);
  for (const target of Object.values(LEGACY_SETTINGS_ROUTES)) {
    assert.ok(SETTINGS_SECTIONS.some(section => target.startsWith(`/settings/${section.key}`)));
    assert.ok(!Object.hasOwn(LEGACY_SETTINGS_ROUTES, target));
  }
});
