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
        const filtered = ['quick_filter', 'status', 'priority', 'assignee_id', 'project_id', 'team', 'due_date', 'created_date', 'search']
          .some(key => url.searchParams.has(key));
        const items = state === 'empty' || (state === 'filtered' && filtered) ? [] : [task];
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
    await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(0);
    state = 'filtered';
    const quick = index % 2 ? 'myTasks' : 'createdByMe';
    const filters = new URLSearchParams({ quickFilter: quick, ganttRange: '90' });
    if (index === 3) {
      Object.entries({ status: 'TODO', priority: 'HIGH', assigneeId: 'task-reviewer', projectId: 'project-0',
        team: 'Engineering', dueDate: '2026-10-24', createdDate: '2026-10-23' }).forEach(([key, value]) => filters.set(key, value));
    }
    await page.evaluate(mode => localStorage.setItem('taskViewMode', mode), index % 2 ? 'grid' : 'list');
    await page.goto(base + `/__task-loading?role=owner&networkTaskPage=1&scenario=${index}#/tasks?${filters}`, { waitUntil: 'domcontentloaded' });
    const empty = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'No tasks found', exact: true }) });
    await expect(empty).toContainText(quick === 'createdByMe' ? 'No tasks you created match' : 'No tasks assigned to you match');
    if (index === 0 || index === 3) {
      await empty.scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(`empty-filter-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    }
    const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal(favicon, '/favicon.svg');
    const iconResponse = await page.request.get(base + favicon);
    assert.equal(iconResponse.status(), 200);
    assert.match(iconResponse.headers()['content-type'], /image\/svg\+xml/);
    await expect(page.getByRole('button', { name: quick === 'createdByMe' ? /Task Created By Me/ : /My Tasks/, pressed: true })).toBeVisible();
    assert.equal(calls.at(-1).quick_filter, quick);
    if (index === 3) {
      await page.getByPlaceholder('Search Tasks', { exact: true }).fill('missing task');
      await expect.poll(() => calls.at(-1).search).toBe('missing task');
    }
    await page.waitForTimeout(350);
    assert.ok(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).has('quickFilter'), 'Empty results must retain the chosen filter');
    await empty.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder('Search Tasks', { exact: true })).toHaveValue('');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.split('?')[1])), { ganttRange: '90' });
    for (const key of ['quick_filter', 'status', 'priority', 'assignee_id', 'project_id', 'team', 'due_date', 'created_date', 'search']) {
      assert.equal(calls.at(-1)[key], undefined, `${key} must be removed from the task request`);
    }
    assert.equal(calls.at(-1).page, '1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const label = `${failure.abort ? 'Network failure' : failure.status}: visible error, retry pending/success, mapped API task and genuine empty state (${width}px)`;
    passed.push(label); console.log('PASS: ' + label);
    const recovery = `${quick}: filter-specific empty state and explicit reset restore API tasks (${index % 2 ? 'grid' : 'list'}, ${width}px)`;
    passed.push(recovery); console.log('PASS: ' + recovery);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser.json', output), JSON.stringify({ passed, errors, environment: 'Loopback Chrome; actual application, task-list hook, Axios adapter and synthetic HTTP responses' }, null, 2) + '\n');
} finally { await browser.close(); }
