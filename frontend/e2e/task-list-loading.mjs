import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16309';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const output = new URL('../../docs/task-list-loading/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], passed = [];
const task = { id: 'network-task', title: 'Task loaded from API', description: 'Actual API adapter mapping',
  status: 'TODO', priority: 'HIGH', team: 'Engineering', assigned_to_ids: ['task-reviewer'],
  created_by_id: 'task-reviewer', created_at: '2026-10-23T06:00:00Z', updated_at: '2026-10-23T06:00:00Z',
  due_at: '2026-10-24T06:00:00Z', subtasks: [], attachments: [], tags: [] };
const failures = [
  { status: 500, json: { detail: 'Task service unavailable.' }, message: 'Task service unavailable.' },
  { status: 403, json: { detail: { code: 'PAGE_FORBIDDEN', message: 'Task access is restricted.' } }, message: 'Task access is restricted.' },
  { status: 422, json: { detail: [{ msg: 'Invalid task filter.' }] }, message: 'Invalid task filter.' },
  { abort: true, message: 'Network Error' },
];

try {
  for (const [index, failure] of failures.entries()) {
    const width = index % 2 ? 390 : 1440;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let state = 'failed', release, calls = [];
    const pending = new Promise(resolve => { release = resolve; });
    await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => socket.onMessage(() => {}));
    await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/__task-loading') {
        const response = await route.fetch({ url: base + '/' });
        return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
      }
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
      if (url.pathname === '/api/tasks/page') {
        calls.push(Object.fromEntries(url.searchParams));
        if (state === 'failed') return failure.abort ? route.abort('failed') : route.fulfill({ status: failure.status, json: failure.json });
        if (state === 'pending') await pending;
        const items = state === 'empty' ? [] : [task];
        return route.fulfill({ json: { items, total: items.length, page: 1, page_size: 50, total_pages: 1, status_counts: items.length ? { TODO: 1 } : {} } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
        ? { contentType: 'text/event-stream', body: '' }
        : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/__task-loading?role=owner&networkTaskPage=1#/tasks', { waitUntil: 'domcontentloaded' });
    const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Unable to load tasks', exact: true }) });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(failure.message);
    await expect(page.getByText('Updating...', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No tasks found' })).toHaveCount(0);
    assert.equal(calls[0].page, '1'); assert.equal(calls[0].page_size, '50');
    assert.ok(calls[0].timezone);
    state = 'pending';
    await alert.getByRole('button', { name: 'Retry loading tasks', exact: true }).click();
    await expect(page.getByText('Updating...', { exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    state = 'success'; release();
    await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();
    await expect(alert).toHaveCount(0);
    assert.equal(calls.length, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    state = 'empty'; await page.reload();
    await expect(page.getByRole('heading', { name: 'No tasks found', exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    const label = `${failure.abort ? 'Network failure' : failure.status}: visible error, retry pending/success, mapped API task and genuine empty state (${width}px)`;
    passed.push(label); console.log('PASS: ' + label);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser.json', output), JSON.stringify({ passed, errors, environment: 'Loopback Chrome; actual application, task-list hook, Axios adapter and synthetic HTTP responses' }, null, 2) + '\n');
} finally { await browser.close(); }
