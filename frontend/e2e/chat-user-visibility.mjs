import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const base = process.env.ZEAPLAY_CHAT_TEST_URL || 'http://127.0.0.1:16320';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 15000 });
const output = new URL('../../docs/chat-user-visibility/', import.meta.url);
await mkdir(output, { recursive: true });
const user = { id: 'self', tenant_id: 'visibility-fixture', name: 'Reviewer', email: 'self@example.test', role: 'owner', status: 'ACTIVE' };
const now = '2026-10-23T06:00:00Z';
const member = (id, name, status = 'ACTIVE') => ({ user_id: id, name, email: `${id}@example.test`, account_status: status,
  app_role: 'user', role: id === 'self' ? 'OWNER' : 'MEMBER', joined_at: now, is_muted: false, is_pinned: false });
const self = member('self', 'Reviewer'), active = member('active', 'Active Colleague'), inactive = member('inactive', 'Deactivated Colleague', 'DEACTIVATED');
const conversation = (id, type, members, name) => ({ id, type, name, members, tenant_id: user.tenant_id,
  is_private: true, is_archived: false, created_at: now, updated_at: now, unread_count: 0 });
const rows = [conversation('inactive-direct', 'DIRECT', [self, inactive]), conversation('active-direct', 'DIRECT', [self, active]),
  conversation('team-room', 'GROUP', [self, active, inactive], 'Team room')];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], passed = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const requests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (url.origin !== base) return route.abort();
      if (url.pathname.endsWith('/auth/browser-session/refresh')) return route.fulfill({ json: { access_token: 'synthetic-visibility-session', refresh_token: 'synthetic-refresh' } });
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: user });
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
      if (url.pathname === '/api/users') return route.fulfill({ json: [user, { ...user, id: 'active', name: active.name }] });
      // Deliberately return old-server conversation data containing inactive people.
      if (url.pathname === '/api/chat/conversations') return route.fulfill({ json: rows });
      if (url.pathname === '/api/chat/users') return route.fulfill({ json: { items: [{ id: active.user_id, name: active.name, email: active.email, is_favorite: false, unread_count: 0 }], next_cursor: null } });
      if (url.pathname.endsWith('/messages')) return route.fulfill({ json: { items: [], has_more: false, next_cursor: null } });
      if (url.pathname.endsWith('/work/active')) return route.fulfill({ json: { items: [], running_count: 0, limit: 5, server_time: now, user_id: user.id, tenant_id: user.tenant_id } });
      if (url.pathname.endsWith('/notifications/stream')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/chat/team-room');
    await expect(page.getByPlaceholder(/^Message #team-room/)).toBeVisible();
    await expect(page.getByText('Deactivated Colleague', { exact: true })).toHaveCount(0);
    if (width === 390) await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await expect(page.getByRole('button', { name: /Active Colleague/ }).first()).toBeVisible();
    const newMessage = page.getByRole('button', { name: 'New message', exact: true });
    if (width === 390) { await newMessage.focus(); await newMessage.press('Enter'); }
    else await newMessage.click();
    await expect(page.getByText('Deactivated Colleague', { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder('Search users...')).toBeVisible();
    await page.getByPlaceholder('Search users...').fill('Deactivated Colleague');
    await expect(page.getByText('Deactivated Colleague', { exact: true })).toHaveCount(0);
    await page.goto(base + '/?deep-link-test=1#/chat/inactive-direct');
    await expect(page.getByPlaceholder(/^Message /)).toBeVisible();
    await expect(page.getByText('Deactivated Colleague', { exact: true })).toHaveCount(0);
    assert.ok(!requests.includes('/api/chat/conversations/inactive-direct/messages'), 'Hidden direct links must not load inactive history into the UI');
    passed.push(`Inactive DM/contact/member rows hidden, active contact retained, inactive deep link ignored (${width}px)`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser.json', output), JSON.stringify({ passed, errors, environment: 'Local production build, synthetic old-server responses, no real messages' }, null, 2) + '\n');
  passed.forEach(item => console.log('PASS: ' + item));
} finally { await browser.close(); }
