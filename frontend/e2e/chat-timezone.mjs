// Run against a loopback production preview with ZEAPLAY_PLAYWRIGHT_MODULE set
// to an installed @playwright/test/index.mjs. All API data is synthetic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const base = (process.env.ZEAPLAY_CHAT_TEST_URL || 'http://127.0.0.1:16320').replace(/\/$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
if (!process.env.ZEAPLAY_PLAYWRIGHT_MODULE) throw Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed @playwright/test/index.mjs');
const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 15000 });
const output = new URL('../../docs/chat-timezone/', import.meta.url);
await mkdir(output, { recursive: true });

const now = '2026-10-28T04:55:00Z'; // 10:25 AM in India.
const naiveNow = '2026-10-28T04:55:00';
const user = { id: 'self', tenant_id: 'timezone-fixture', name: 'Timezone Reviewer', email: 'self@example.test', role: 'owner', status: 'ACTIVE' };
const member = (id, name) => ({ user_id: id, name, email: `${id}@example.test`, account_status: 'ACTIVE',
  app_role: id === user.id ? 'owner' : 'user', role: id === user.id ? 'OWNER' : 'MEMBER',
  joined_at: now, is_muted: false, is_pinned: false });
const self = member(user.id, user.name), peer = member('peer', 'Synthetic Colleague');
const conversation = { id: 'timezone-room', tenant_id: user.tenant_id, type: 'GROUP', name: 'Timezone room',
  members: [self, peer], is_private: true, is_archived: false, created_at: now, updated_at: now,
  last_message_at: naiveNow, unread_count: 0 };
const message = (id, createdAt, content = id, sender = peer) => ({ id, conversation_id: conversation.id,
  sender_id: sender.user_id, sender_name: sender.name, content, created_at: createdAt, updated_at: createdAt,
  attachments: [], reactions: [], mentions: [], message_type: 'TEXT' });
const messages = [
  message('before-midnight', '2026-10-27T18:29:00', 'Yesterday at 23:59 in India'),
  message('after-midnight', '2026-10-27T18:31:00', 'Today at 00:01 in India'),
  message('utc-midnight', '2026-10-28T00:01:00', 'Same local day across UTC midnight'),
  message('naive-utc', naiveNow, 'Naive UTC history'),
  message('explicit-utc', now, 'Explicit UTC history'),
  message('explicit-offset', '2026-10-28T10:25:00+05:30', 'Explicit offset history'),
];
const directoryUser = { id: 'directory-peer', name: 'Directory Colleague', email: 'directory@example.test',
  is_favorite: false, unread_count: 0, last_message_at: naiveNow, latest_message_preview: 'Synthetic directory preview' };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
const errors = [], passed = [], sent = [];
let acknowledgeSend;
const acknowledgment = new Promise(resolve => { acknowledgeSend = resolve; });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce', timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  // Disable realtime entirely: the regression exercises the REST history/send path.
  await context.routeWebSocket('**/*', socket => socket.close({ code: 1008, reason: 'Synthetic REST-only timezone check' }));
  await context.addInitScript(({ frozenNow, origin }) => {
    const NativeDate = Date;
    const fixedTime = NativeDate.parse(frozenNow);
    window.Date = new Proxy(NativeDate, {
      apply: () => new NativeDate(fixedTime).toString(),
      construct: (target, args) => Reflect.construct(target, args.length ? args : [fixedTime]),
      get: (target, property) => property === 'now' ? () => fixedTime : Reflect.get(target, property),
    });
    window.__RUNTIME_CONFIG__ = { API_URL: '/api', PRESENCE_URL: origin, WS_URL: origin + '/api' };
  }, { frozenNow: now, origin: base });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (url.pathname.endsWith('/auth/browser-session/refresh')) return route.fulfill({ json: { access_token: 'synthetic-timezone-session', refresh_token: 'synthetic-refresh' } });
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: user });
    if (url.pathname.endsWith('/auth/websocket-ticket') || url.pathname.endsWith('/auth/presence-token')) return route.fulfill({ json: {} });
    if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
    if (url.pathname === '/api/users') return route.fulfill({ json: [user, { ...user, id: peer.user_id, name: peer.name }] });
    if (url.pathname === '/api/chat/conversations') return route.fulfill({ json: [conversation] });
    if (url.pathname === '/api/chat/users') return route.fulfill({ json: { items: [directoryUser], next_cursor: null } });
    if (url.pathname === `/api/chat/conversations/${conversation.id}`) return route.fulfill({ json: conversation });
    if (url.pathname === `/api/chat/conversations/${conversation.id}/messages`) {
      if (request.method() === 'POST') {
        const payload = request.postDataJSON();
        sent.push(payload);
        await acknowledgment;
        return route.fulfill({ json: { ...message('acknowledged-send', naiveNow, payload.content, self), client_id: payload.client_id } });
      }
      return route.fulfill({ json: { items: messages, has_more: false, next_cursor: null } });
    }
    if (url.pathname.endsWith('/read')) return route.fulfill({ json: self });
    if (url.pathname.endsWith('/work/active')) return route.fulfill({ json: { items: [], running_count: 0, limit: 5, server_time: now, user_id: user.id, tenant_id: user.tenant_id } });
    if (url.pathname.endsWith('/notifications/stream')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#/chat/' + conversation.id);
  await expect(page.getByPlaceholder(/^Message #timezone-room/)).toBeVisible();
  await expect(page.locator('#msg-naive-utc')).toBeVisible();
  const localTimes = await page.evaluate(timestamps => timestamps.map(timestamp => new Date(timestamp)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
  ['2026-10-27T18:29:00Z', '2026-10-27T18:31:00Z', '2026-10-28T00:01:00Z', now]);
  assert.match(localTimes[3], /10:25/, 'Browser reference time must be 10:25 in India');
  for (const id of ['naive-utc', 'explicit-utc', 'explicit-offset']) {
    await expect(page.locator('#msg-' + id).getByText(localTimes[3], { exact: true })).toHaveCount(1);
  }
  passed.push('Naive UTC, explicit Z, and +05:30 history timestamps all display 10:25 in India');
  for (const [id, expectedTime] of [['before-midnight', localTimes[0]], ['after-midnight', localTimes[1]], ['utc-midnight', localTimes[2]]]) {
    await expect(page.locator('#msg-' + id).getByText(expectedTime, { exact: true })).toHaveCount(1);
  }
  const history = page.locator('#msg-before-midnight').locator('..');
  await expect(history.getByText('Yesterday', { exact: true })).toHaveCount(1);
  await expect(history.getByText('Today', { exact: true })).toHaveCount(1);
  const headerPlacement = await history.evaluate(element => Array.from(element.children).map(child => ({
    id: child.id, header: child.querySelector('span')?.textContent,
  })).filter(child => child.id.startsWith('msg-') || ['Today', 'Yesterday'].includes(child.header)));
  const sequence = headerPlacement.map(child => child.id || child.header);
  assert.deepEqual(sequence.slice(0, 5), ['Yesterday', 'msg-before-midnight', 'Today', 'msg-after-midnight', 'msg-utc-midnight']);
  assert.deepEqual(sequence.slice(5).sort(), ['msg-explicit-offset', 'msg-explicit-utc', 'msg-naive-utc']);
  passed.push('Local date separators change at India midnight and remain Today across UTC midnight');
  await expect(page.getByRole('button', { name: /Timezone room/ }).getByText(localTimes[3], { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Directory Colleague/ }).getByText(localTimes[3], { exact: true })).toHaveCount(1);
  passed.push('Conversation and directory sidebar last_message_at timestamps display 10:25 in India');

  const content = 'Synthetic optimistic timezone verification';
  await page.getByPlaceholder(/^Message #timezone-room/).fill(content);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  const optimistic = page.locator('[id^="msg-tmp-"]').filter({ hasText: content });
  await expect(optimistic).toHaveCount(1);
  await expect(optimistic.getByText(localTimes[3], { exact: true })).toHaveCount(1);
  acknowledgeSend();
  const acknowledged = page.locator('#msg-acknowledged-send');
  await expect(acknowledged).toBeVisible();
  await expect(acknowledged.getByText(localTimes[3], { exact: true })).toHaveCount(1);
  await expect(optimistic).toHaveCount(0);
  await expect(history.getByText(content, { exact: true })).toHaveCount(1);
  assert.equal(sent[0].content, content);
  passed.push('Optimistic send and naive UTC server acknowledgment retain the same 10:25 display with one message');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL('chat-india.png', output)), fullPage: true });
  const report = { environment: 'Loopback production build; synthetic REST APIs; realtime disabled; Asia/Kolkata; en-IN; frozen browser date; no real messages', passed, errors };
  await writeFile(new URL('browser.json', output), JSON.stringify(report, null, 2) + '\n');
  passed.forEach(check => console.log('PASS: ' + check));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} finally {
  acknowledgeSend();
  await browser.close();
}
