import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16300';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const cssRuntime = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], results = [];
const passed = (name, evidence) => { results.push({ name, evidence }); console.log('PASS: ' + name); };

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 },
    timezoneId: options.browserZone || 'Asia/Kolkata', reducedMotion: 'reduce' });
  const sockets = [], exports = [], rawCalls = [];
  let rawVersion = 0;
  await context.addInitScript(() => localStorage.setItem('zea-play-cache:%2Fapi:task:legacy-test',
    JSON.stringify({ value: { title: 'Previous session private data' }, expiresAt: Date.now() + 300_000 })));
  await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => {
    sockets.push(socket); socket.send(JSON.stringify({ type: 'realtime:ready' }));
  });
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: cssRuntime });
    if (url.origin !== base) {
      if (route.request().method() === 'POST') exports.push(url.origin + url.pathname);
      return route.abort();
    }
    if (url.pathname === '/__task-validation') {
      const response = await route.fetch({ url: base + '/' });
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
    if (url.pathname === '/api/tasks') {
      rawCalls.push(rawVersion);
      return route.fulfill({ json: [{ id: 'raw-task', title: 'Raw task ' + rawVersion, description: '', status: 'TODO',
        priority: 'HIGH', team: 'Engineering', created_by_id: 'task-reviewer', created_at: '2026-10-21T19:00:00',
        updated_at: '2026-10-21T19:00:00', due_at: '2026-10-22T19:00:00', assigned_to_id: 'task-reviewer',
        recurrence_rule: 'NONE', attachments: ['uploads/preserved.png'], tags: [], subtasks: [],
        dependencies: [{ id: 'raw-predecessor', title: 'Raw API predecessor' }] }] });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
      ? { contentType: 'text/event-stream', body: '' } : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (options.now) await page.clock.setFixedTime(new Date(options.now));
  const entry = base + '/__task-validation?' + new URLSearchParams({ role: 'owner', rows: options.rows || 2,
    ...(options.zone ? { zone: options.zone } : {}), ...(options.due ? { due: options.due } : {}), customStage: '1' });
  const go = target => page.goto(entry + '#' + target, { waitUntil: 'domcontentloaded' });
  const calls = () => page.evaluate(() => window.taskNavigationAudit.calls);
  return { context, page, go, calls, sockets, exports, rawCalls, advanceRaw: () => { rawVersion++; } };
}

try {
  const owner = await setup(); const { page } = owner;
  await owner.go('/tasks');
  await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  await expect.poll(() => owner.sockets.length).toBe(1);
  // Let the initial socket ready message and batched invalidation window settle.
  await page.waitForTimeout(500);
  assert.equal((await owner.calls()).filter(call => call.method === 'getTasksPage').length, 1);
  assert.equal((await owner.calls()).filter(call => call.method === 'getActiveWork').length, 1);
  assert.equal((await owner.calls()).filter(call => call.method === 'getUsers').length, 1);
  const tabs = page.getByRole('tablist', { name: 'Task views' });
  for (const label of ['Kanban Board', 'Gantt Chart', 'Calendar', 'All Tasks']) {
    await tabs.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await expect(page.getByRole('heading', { name: label === 'Kanban Board' ? 'Battle Board ⚔️' : label === 'Gantt Chart' ? 'Gantt Raid Map' : label === 'Calendar' ? 'Calendar' : 'Tasks *', exact: true })).toBeVisible();
  }
  await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  assert.equal((await owner.calls()).filter(call => call.method === 'getTasksPage').length, 1);
  assert.equal((await owner.calls()).filter(call => call.method === 'getUsers').length, 1);
  assert.equal(owner.sockets.length, 1);
  passed('One initial task request, one users request and one socket; cached tab return does not refetch', await owner.calls());
  const rawBefore = await page.evaluate(() => window.taskNavigationAudit.rawTasks('raw-reviewer', 'owner'));
  owner.advanceRaw();
  const cached = await page.evaluate(() => window.taskNavigationAudit.rawTasks('raw-reviewer', 'owner'));
  const fresh = await page.evaluate(() => window.taskNavigationAudit.rawTasks('raw-reviewer', 'owner', { fresh: true }));
  assert.equal(rawBefore[0].title, 'Raw task 0');
  assert.equal(cached[0].title, 'Raw task 0');
  assert.equal(fresh[0].title, 'Raw task 1');
  assert.deepEqual(fresh[0].dependencies, [{ id: 'raw-predecessor', title: 'Raw API predecessor' }]);
  assert.deepEqual(fresh[0].attachments, ['uploads/preserved.png']);
  assert.deepEqual(owner.rawCalls, [0, 1]);
  passed('Actual HTTP task mapper preserves dependencies/attachments and fresh reads bypass stale response cache', { requests: owner.rawCalls.length });

  // Data changes remotely; the application's real task socket hook receives the wire event.
  const calendarReadsBeforeEvent = (await owner.calls()).filter(call => call.method === 'getTaskCalendarSummary').length;
  await page.evaluate(() => window.taskNavigationAudit.move(false));
  owner.sockets.at(-1).send(JSON.stringify({ type: 'task.updated', task_id: 'task-0' }));
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'getTasksPage').length).toBe(2);
  await tabs.getByRole('tab', { name: 'Kanban Board', exact: true }).click();
  await expect(page.locator('[data-task-status="DONE"]').getByText('Navigation task 0', { exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Gantt Chart', exact: true }).click();
  await expect(page.locator('[data-task-id="task-0"]')).toHaveAttribute('title', /Conquered/);
  await expect(page.getByText('Depends on: Navigation task 1', { exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'getTaskCalendarSummary').length).toBeGreaterThan(calendarReadsBeforeEvent);
  const tomorrowKey = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() + 1); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
  await page.locator(`[data-calendar-date="${tomorrowKey}"]`).click();
  await expect(page.getByRole('complementary', { name: 'Calendar day details' }).getByText('Conquered', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close day details', exact: true }).click();
  assert.deepEqual(owner.exports, []);
  passed('Wire task event refreshes list, Kanban, Gantt and Calendar without external task exports', { sockets: owner.sockets.length });

  // A genuine disconnect still reconciles the missing-event gap when restored.
  const before = (await owner.calls()).filter(call => call.method === 'getTaskCalendarSummary').length;
  owner.sockets.at(-1).close({ code: 1012, reason: 'Synthetic connection gap' });
  await expect.poll(() => owner.sockets.length).toBe(2);
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'getTaskCalendarSummary').length).toBeGreaterThan(before);
  passed('Genuine task reconnect reconciles cached views', { connectionsAcrossOneDisconnect: owner.sockets.length });
  owner.advanceRaw();
  await page.evaluate(() => window.taskNavigationAudit.rotateSession());
  const nextSession = await page.evaluate(() => window.taskNavigationAudit.rawTasks('raw-reviewer', 'owner'));
  assert.equal(nextSession[0].title, 'Raw task 2');
  assert.deepEqual(owner.rawCalls, [0, 1, 2]);
  const privateStoredKeys = await page.evaluate(() => Object.keys(localStorage).filter(key =>
    key.startsWith('zea-play-cache:') && /:(?:task|users|departments|projects|comments:|@task-session)/.test(key)));
  assert.deepEqual(privateStoredKeys, []);
  passed('Task response cache is session-scoped; legacy private cache is retired and no task data is persisted', { requests: owner.rawCalls.length, privateStoredKeys });
  await owner.context.close();

  const paginated = await setup({ rows: 70 });
  await paginated.go('/tasks?projectId=project-0');
  await expect(paginated.page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await paginated.calls()).filter(call => call.method === 'getTasksPage' && call.args[0].page === 2).length).toBe(1);
  const prefetch = (await paginated.calls()).find(call => call.method === 'getTasksPage' && call.args[0].page === 2);
  assert.equal(prefetch.args[0].projectId, 'project-0');
  await paginated.page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(paginated.page.getByText('Navigation task 50', { exact: true }).first()).toBeVisible();
  assert.equal(await paginated.page.getByText('Navigation task 60', { exact: true }).count(), 0);
  assert.equal((await paginated.calls()).filter(call => call.method === 'getTasksPage' && call.args[0].page === 2).length, 1);
  const beforeGrid = (await paginated.calls()).filter(call => call.method === 'getTasksPage').length;
  await paginated.page.getByRole('button', { name: /Grid$/ }).click();
  await expect(paginated.page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await paginated.calls()).filter(call => call.method === 'getTasksPage').at(-1).args[0].pageSize).toBe(30);
  assert.equal((await paginated.calls()).filter(call => call.method === 'getTasksPage')[beforeGrid].args[0].page, 1);
  await paginated.page.getByRole('tab', { name: 'Kanban Board', exact: true }).click();
  await expect(paginated.page.getByRole('heading', { name: 'Custom owner stage', exact: true })).toBeVisible();
  await expect(paginated.page.getByRole('tabpanel', { name: 'Kanban Board' }).getByText('Page 1 of 2', { exact: true })).toBeVisible();
  await paginated.page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(paginated.page.locator('[data-task-status="TODO"]').getByText('Navigation task 40', { exact: true })).toBeVisible();
  assert.equal(await paginated.page.locator('[data-task-status="TODO"]').getByText('Navigation task 0', { exact: true }).count(), 0);
  assert.ok((await paginated.calls()).some(call => call.method === 'getTasksKanban' && call.args[0].page === 2));
  passed('Project-correct list prefetch and server-backed Kanban pagination retain all tasks and custom stage titles', { prefetch });
  await paginated.context.close();

  for (const options of [
    { browserZone: 'Asia/Kolkata', zone: 'Asia/Kolkata', now: '2026-10-22T05:00:00Z', due: '2026-10-21T19:00:00Z' },
    { browserZone: 'America/Los_Angeles', zone: 'Asia/Tokyo', now: '2026-10-21T16:00:00Z', due: '2026-10-21T16:00:00Z' },
  ]) {
    const actor = await setup(options);
    await actor.go('/tasks/calendar');
    await expect(actor.page.getByText('Timezone: ' + options.zone, { exact: true })).toBeVisible();
    const cell = actor.page.locator('[data-calendar-date="2026-10-22"]');
    await expect(cell).toHaveAttribute('data-today', 'true');
    await cell.click();
    await expect(actor.page.getByRole('button', { name: 'Open full task', exact: true })).toBeVisible();
    const apiCall = (await actor.calls()).find(call => call.method === 'getTaskCalendarTasks');
    assert.equal(apiCall.args[0].startDate, '2026-10-22');
    assert.equal(apiCall.args[0].timezone, options.zone);
    assert.deepEqual(actor.exports, []);
    passed('Calendar local-day selection and profile timezone: ' + options.zone + ' with browser ' + options.browserZone, apiCall.args[0]);
    await actor.page.getByRole('button', { name: 'Close day details', exact: true }).click();
    await actor.page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(actor.page.locator('[data-calendar-date]')).toHaveCount(7);
    await expect(actor.page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
    await actor.page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(actor.page.locator('[data-calendar-date]')).toHaveCount(1);
    await expect(actor.page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
    await actor.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(actor.page.locator('[data-calendar-date="2026-10-23"]')).toBeVisible();
    await actor.page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(actor.page.locator('[data-calendar-date="2026-10-22"]')).toBeVisible();
    await actor.page.getByRole('button', { name: 'Month', exact: true }).click();
    await actor.page.locator('[data-calendar-date="2026-10-22"]').click();
    await actor.page.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(actor.page.locator('#dueDate')).toHaveValue('2026-10-22');
    await actor.page.getByPlaceholder('Name your quest...', { exact: true }).fill('Zoned calendar task');
    await actor.page.locator('#projectId').click();
    await actor.page.getByText('Verification project', { exact: true }).last().click();
    await actor.page.locator('#dueTime').fill('00:30');
    await actor.page.getByRole('button', { name: 'Create quest', exact: true }).click();
    await expect.poll(async () => (await actor.calls()).filter(call => call.method === 'createTask').length).toBe(1);
    const created = (await actor.calls()).find(call => call.method === 'createTask').args[0];
    assert.equal(created.dueAt, options.zone === 'Asia/Tokyo' ? '2026-10-21T15:30:00.000Z' : '2026-10-21T19:00:00.000Z');
    passed('Calendar creation submits an explicit UTC instant from ' + options.zone, { dueAt: created.dueAt });
    await actor.context.close();
  }

  const legacy = await setup();
  const taskId = '2ad039ec-1f32-4f05-87ab-76cdeec7a991';
  await legacy.go('/tasks/' + taskId + '?priority=HIGH');
  await expect(legacy.page).toHaveURL(new RegExp('#/tasks\\?priority=HIGH&taskId=' + taskId));
  await expect(legacy.page.getByRole('heading', { name: 'Navigation task 0', exact: true })).toBeVisible();
  passed('Legacy notification task UUID opens the existing Task Details dialog with filters preserved', { taskId });
  await legacy.context.close();
  assert.deepEqual(errors, []);
  await writeFile(new URL('../../docs/centralized-tasks/validation/browser-extended.json', import.meta.url), JSON.stringify({ results, errors, environment: 'Loopback Chrome; synthetic service data, controlled socket wire messages' }, null, 2));
} finally { await browser.close(); }
