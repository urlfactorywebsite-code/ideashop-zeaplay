import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw Error('Set ZEAPLAY_PLAYWRIGHT_MODULE');
const { chromium, expect: baseExpect } = await import(pathToFileURL(modulePath).href);
const expect = baseExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16300';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = path.join(tmpdir(), 'zeaplay-task-navigation');
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function setup(role = 'owner', width = 1440, rules = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  let taskSockets = 0;
  await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => { taskSockets++; socket.onMessage(() => {}); });
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__task-navigation') {
      const response = await route.fetch({ url: base + '/' });
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument(role, rules) });
    if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
      ? { contentType: 'text/event-stream', body: '' } : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR: ' + error.message); });
  const entry = `${base}/__task-navigation?role=${role}`;
  const go = target => page.goto(entry + '#' + target, { waitUntil: 'domcontentloaded' });
  return { context, page, go, sockets: () => taskSockets,
    calls: () => page.evaluate(() => window.taskNavigationAudit.calls) };
}
const passed = [];
const check = label => { passed.push(label); console.log('PASS: ' + label); };
try {
  const owner = await setup(); const { page } = owner;
  await owner.go('/tasks');
  await expect(page.getByRole('heading', { name: 'All Tasks', exact: true })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Task views' });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  await expect(sidebar.getByRole('link', { name: 'All Tasks', exact: true })).toHaveCount(1);
  for (const name of ['Kanban Board', 'Gantt Chart']) await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open calendar', exact: true })).toHaveCount(0);
  await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  assert.equal((await owner.calls()).filter(call => call.method === 'getTasksKanban').length, 0);
  assert.equal((await owner.calls()).filter(call => call.method === 'getTaskCalendarSummary').length, 0);
  check('one task sidebar entry, four route tabs, existing list and lazy loading');
  for (const [label, heading] of [['Kanban Board', 'Battle Board ⚔️'], ['Gantt Chart', 'Gantt Raid Map'], ['Calendar', 'Calendar']]) {
    await tabs.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'All Tasks', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await expect(tabs.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Gantt Chart', exact: true }).click();
  await page.getByRole('button', { name: '90d', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.goBack(); await expect(tabs.getByRole('tab', { name: 'Gantt Chart', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/ganttRange=90/);
  await page.goForward(); await expect(tabs.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Gantt Chart', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Gantt Chart', exact: true }).press('Home');
  await expect(tabs.getByRole('tab', { name: 'All Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
  check('view reuse, active sidebar, full-page Calendar, refresh, history and keyboard navigation');
  for (const [old, canonical] of [['/kanban', '/tasks/kanban'], ['/gantt', '/tasks/gantt'], ['/calendar', '/tasks/calendar']]) {
    await owner.go(old + '?priority=HIGH');
    await expect(page).toHaveURL(new RegExp('#' + canonical + '\\?priority=HIGH$'));
  }
  await owner.go('/tasks/kanban?priority=HIGH&status=TODO');
  await tabs.getByRole('tab', { name: 'All Tasks', exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\?priority=HIGH&status=TODO$/);
  await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
  assert.ok((await owner.calls()).some(call => call.method === 'getTasksPage' && call.args[0].status === 'TODO' && call.args[0].priority === 'HIGH'));
  check('legacy redirects and shared filter URL/query preservation');
  await owner.go('/tasks/gantt');
  await expect(page.getByRole('heading', { name: 'Gantt Raid Map' })).toBeVisible();
  const before = (await owner.calls()).filter(call => call.method === 'getTasks').length;
  await expect.poll(owner.sockets).toBeGreaterThan(0);
  const socketsBefore = owner.sockets();
  await page.evaluate(() => window.taskNavigationAudit.move());
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'getTasks').length).toBeGreaterThan(before);
  const workReads = (await owner.calls()).filter(call => call.method === 'getActiveWork').length;
  for (const label of ['All Tasks', 'Kanban Board', 'Calendar', 'Gantt Chart']) await tabs.getByRole('tab', { name: label, exact: true }).click();
  assert.equal(owner.sockets(), socketsBefore);
  assert.equal((await owner.calls()).filter(call => call.method === 'getActiveWork').length, workReads);
  check('shared task update invalidation and one persistent task socket/Active Work provider');
  await page.getByRole('button', { name: 'Open Active Work', exact: true }).click();
  const timerBefore = await page.locator('.work-duration').innerText();
  await page.getByRole('button', { name: 'Close Active Work', exact: true }).click();
  await tabs.getByRole('tab', { name: 'All Tasks', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Kanban Board', exact: true }).click();
  await page.getByRole('button', { name: 'Open Active Work', exact: true }).click();
  assert.ok((await page.locator('.work-duration').innerText()) >= timerBefore);
  await page.getByRole('button', { name: 'Close Active Work', exact: true }).click();
  assert.equal((await owner.calls()).filter(call => /startWork|pauseWork|stopWork|resumeWork/.test(call.method)).length, 0);
  await page.locator('.kanban-board-scroll').evaluate(element => { element.scrollLeft = 0; });
  const card = page.locator('[draggable="true"]').filter({ hasText: 'Navigation task 1' });
  await card.dragTo(page.locator('[data-task-status="TODO"]'), { targetPosition: { x: 100, y: 120 } });
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'updateTask' && call.args[0] === 'task-1' && call.args[1].status === 'TODO').length).toBe(1);
  await expect(page.locator('[data-task-status="TODO"]').getByText('Navigation task 1', { exact: true })).toBeVisible();
  await page.evaluate(() => window.taskNavigationAudit.rejectNextUpdate());
  await card.dragTo(page.locator('[data-task-status="IN_PROGRESS"]'), { targetPosition: { x: 100, y: 120 } });
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'updateTask').length).toBe(2);
  await expect(page.locator('[data-task-status="TODO"]').getByText('Navigation task 1', { exact: true })).toBeVisible();
  check('Kanban drag-and-drop, rejected-transition rollback and active timer continuity');
  await tabs.getByRole('tab', { name: 'Calendar', exact: true }).click();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await page.locator(`[data-calendar-date="${tomorrow.toISOString().slice(0, 10)}"]`).click();
  await page.getByRole('button', { name: 'Open full task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Navigation task 0', exact: true })).toBeVisible();
  for (let index = 0; index < 5; index++) await page.getByRole('heading', { name: 'Navigation task 0', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByPlaceholder('Quest title', { exact: true }).fill('Updated navigation task');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated navigation task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close modal', exact: true }).click();
  await page.getByRole('button', { name: 'Close day details', exact: true }).click();
  check('Calendar date/task selection opens existing Task Details and task editing works');
  await tabs.getByRole('tab', { name: 'All Tasks', exact: true }).click();
  await page.getByRole('button', { name: '+ Create Task', exact: true }).click();
  await page.getByPlaceholder('Name your quest...', { exact: true }).fill('Created navigation task');
  await page.locator('#projectId').click();
  await page.getByText('Verification project', { exact: true }).last().click();
  await page.locator('#dueDate').fill(tomorrow.toISOString().slice(0, 10));
  await page.locator('#dueTime').fill('12:00');
  await page.getByRole('button', { name: 'Create quest', exact: true }).click();
  await expect.poll(async () => (await owner.calls()).filter(call => call.method === 'createTask').length).toBe(1);
  await expect(page.getByText('Created navigation task', { exact: true }).first()).toBeVisible();
  check('existing task creation controls and service payload remain functional');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Sidebar Management', exact: true }).click();
  await page.getByRole('button', { name: 'All Tasks Page Tabs', exact: true }).click();
  await expect(page.getByRole('list', { name: 'All Tasks tab pages' }).locator('[data-page-id]')).toHaveCount(4);
  check('Sidebar Management exposes four task tabs in their own group');
  await owner.context.close();
  for (const role of ['user', 'manager', 'admin']) {
    const actor = await setup(role); await actor.go('/tasks');
    await expect(actor.page.getByRole('tab', { name: 'Calendar', exact: true })).toBeVisible();
    await expect(actor.page.getByRole('tab', { name: 'Gantt Chart', exact: true })).toHaveCount(role === 'user' ? 0 : 1);
    if (role === 'user') {
      await actor.go('/tasks/gantt');
      await expect(actor.page.getByRole('heading', { name: 'Access forbidden', exact: true })).toBeVisible();
      assert.equal((await actor.calls()).filter(call => call.method === 'getTasks').length, 0);
    }
    await actor.context.close();
  }
  const restricted = await setup('manager', 1440, { kanban: { enabled: false }, calendar: { hidden: true } });
  await restricted.go('/tasks/kanban');
  await expect(restricted.page.getByRole('heading', { name: 'Module disabled', exact: true })).toBeVisible();
  await restricted.go('/tasks/calendar');
  await expect(restricted.page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(restricted.page.getByRole('tab', { name: 'Calendar', exact: true })).toHaveCount(0);
  await restricted.go('/tasks/not-a-tab');
  await expect(restricted.page.getByRole('heading', { name: 'Page Not Found', exact: true })).toBeVisible();
  await restricted.context.close();
  check('role ceilings, direct-route denial, disabled versus hidden-only policies');
  for (const width of [360, 768, 1440]) {
    const actor = await setup('owner', width);
    for (const view of ['', '/kanban', '/gantt', '/calendar']) {
      await actor.go('/tasks' + view);
      await expect(actor.page.getByRole('tablist', { name: 'Task views' })).toBeVisible();
      await expect(actor.page.getByRole('tabpanel')).toBeVisible();
      await expect(actor.page.getByRole('heading', { name: view === '/calendar' ? 'Calendar' : view === '/gantt' ? 'Gantt Raid Map' : view === '/kanban' ? 'Battle Board ⚔️' : 'Tasks *', exact: true })).toBeVisible();
      assert.ok(await actor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document overflow at ${width}: ${view}`);
    }
    await actor.page.screenshot({ path: path.join(output, `calendar-${width}.png`), fullPage: true });
    await actor.context.close();
  }
  check('desktop/tablet/mobile tab and view layouts contain horizontal scrolling');
  assert.deepEqual(errors, []);
  await writeFile(new URL('../../docs/centralized-tasks/checks/browser.json', import.meta.url), JSON.stringify({ passed, errors, widths: [360, 768, 1440], environment: 'Loopback Chrome; synthetic API data and socket ticket/transport' }, null, 2));
} finally { await browser.close(); }
