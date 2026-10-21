import test from 'node:test';
import assert from 'node:assert/strict';
import { migratePersonal, pageIdForPath } from '../utils/navigationPreferences';

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
