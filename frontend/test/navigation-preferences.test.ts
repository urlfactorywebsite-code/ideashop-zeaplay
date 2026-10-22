import test from 'node:test';
import assert from 'node:assert/strict';
import { migratePersonal, pageIdForPath, resolveNavigationPage } from '../utils/navigationPreferences';
import { navigationDocument } from '../e2e/navigation-fixture.mjs';
import type { NavigationDocument } from '../types/navigation';

test('older navigation documents authorize the task list through the existing tasks policy', () => {
  for (const role of ['owner', 'admin', 'manager', 'user']) {
    for (const rule of [{}, { enabled: false }, { hidden: true }, { allowedRoles: [] }]) {
      const document = navigationDocument(role, { tasks: rule }) as NavigationDocument;
      document.pages = document.pages.filter(page => page.id !== 'tasks.list');
      const parent = resolveNavigationPage(document, 'tasks')!;
      const list = resolveNavigationPage(document, 'tasks.list')!;
      assert.equal(list.access, parent.access);
      assert.deepEqual(list.allowedRoles, parent.allowedRoles);
      assert.equal(list.id, 'tasks.list');
      assert.equal(list.parentId, 'tasks');
      assert.equal(list.navigationLocation, 'task-tab');
      assert.equal(document.pages.some(page => page.id === 'tasks.list'), false);
    }
  }
});

test('explicit task-list denials and unknown pages never use a permissive fallback', () => {
  for (const rule of [{ allowedRoles: [] }, { enabled: false }, { hidden: true }]) {
    const document = navigationDocument('owner', { 'tasks.list': rule }) as NavigationDocument;
    assert.equal(resolveNavigationPage(document, 'tasks.list'), document.pages.find(page => page.id === 'tasks.list'));
  }
  const document = navigationDocument('owner') as NavigationDocument;
  document.pages = document.pages.filter(page => !['tasks', 'tasks.list', 'kanban'].includes(page.id));
  assert.equal(resolveNavigationPage(document, 'tasks.list'), undefined);
  assert.equal(resolveNavigationPage(document, 'kanban'), undefined);
  assert.equal(resolveNavigationPage(document, 'unknown'), undefined);
  assert.equal(resolveNavigationPage(null, 'tasks.list'), undefined);
});

test('migration maps legacy routes to stable IDs without mutating or losing unknown preferences', () => {
  const source = { order: ['/tasks', '/dashboard', '/media', '/unknown', 'tasks'], labels: { '/tasks': 'My work', '/media': 'Files', '/unknown': 'Retained' } };
  const migrated = migratePersonal(source);
  assert.deepEqual(migrated.order, ['tasks', 'dashboard', 'settings.media-library', '/unknown']);
  assert.deepEqual(migrated.labels, { tasks: 'My work', 'settings.media-library': 'Files', '/unknown': 'Retained' });
  assert.equal(source.order[0], '/tasks');
  assert.deepEqual(migratePersonal(migrated), migrated);
});

test('nested and legacy routes resolve the correct policy, including achievement query tabs', () => {
  for (const [path, search, expected] of [
    ['/management', '', 'management'], ['/management/users', '', 'users'], ['/management/clients', '', 'clients'],
    ['/settings/oauth', '', 'settings.oauth'], ['/settings/oauth/authorized-apps', '', 'authorized-apps'],
    ['/settings/api/oauth', '', 'settings.oauth'], ['/settings/sidebar-management', '', 'settings.sidebar-management'],
    ['/settings/api/oauth/authorized-apps', '', 'authorized-apps'], ['/oauth/applications', '', 'authorized-apps'],
    ['/api/oauth-apps', '', 'settings.oauth'], ['/settings/master-control', '', 'settings.profile'],
    ['/achievements', '?tab=templates', 'template-editor'], ['/achievements', '?tab=points', 'points-table'],
    ['/achievements', '?tab=rewards', 'rewards'], ['/achievements', '?tab=levels', 'levels'],
    ['/achievements', '', 'achievements'], ['/chat/conversation', '', 'chat'],
    ['/TASKS/', '', 'tasks'], ['/%74asks', '', 'tasks'], ['/Settings/API/', '', 'settings.api'],
  ]) assert.equal(pageIdForPath(path, search), expected);
  assert.equal(pageIdForPath('/not-a-page'), undefined);
});
