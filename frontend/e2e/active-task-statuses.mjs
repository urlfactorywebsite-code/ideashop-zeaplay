// Actual task views and HTTP adapters against a synthetic, tenant-scoped catalog.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';
const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16319';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../.tmp/active-task-statuses/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
await context.routeWebSocket('**/api/ws/**', socket => socket.close());
let catalog = [
  { id: 'IN_PROGRESS', title: 'Working', order: 2, is_active: true, kanban_visible: true },
  { id: 'BUG_FIXING', title: 'Retired quality', order: 0, is_active: false, kanban_visible: false },
  { id: 'old-review-column', custom_status_id: 'custom-review', title: 'Client review', order: 1, is_active: true, kanban_visible: false },
  { id: 'WAITING_FOR_REQUIREMENT', title: 'New Task', order: 3, is_active: true, kanban_visible: true },
];
let failCatalog = false;
const requests = [], results = [], errors = [];
const tasks = ['Native task', 'Custom task', 'Historical task'].map((title, index) => ({ id: 'active-task-' + index, title,
  status: index === 2 ? 'BUG_FIXING' : 'IN_PROGRESS', custom_status_id: index === 1 ? 'custom-review' : null,
  status_title: index === 2 ? 'Retired quality' : index === 1 ? 'Client review' : 'Working',
  priority: 'LOW', created_by_id: 'task-reviewer', assigned_to_id: 'task-reviewer',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), due_at: new Date(Date.now() + 86400000).toISOString(),
  attachments: [], subtasks: [], tags: [], follower_ids: [], recurrence_rule: 'NONE', dependencies: [] }));
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__active-statuses') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
  }
  if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
  if (url.pathname === '/api/kanban-columns') return failCatalog ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: catalog });
  if (url.pathname === '/api/tasks') return route.fulfill({ json: tasks });
  if (url.pathname === '/api/tasks/page') {
    const status = url.searchParams.get('status'); requests.push(Object.fromEntries(url.searchParams));
    const items = tasks.filter(task => !status || (task.custom_status_id || task.status) === status);
    const counts = key => Object.fromEntries([...new Set(items.map(key))].map(status => [status, items.filter(task => key(task) === status).length]));
    return route.fulfill({ json: { items, total: items.length, page: 1, page_size: 50, total_pages: 1,
      status_counts: counts(task => task.status), configured_status_counts: counts(task => task.custom_status_id || task.status) } });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const pass = label => { results.push(label); console.log('PASS: ' + label); };
const entry = base + '/__active-statuses?networkTaskPage=1&networkStatusFilters=1';
const panel = key => page.locator('#tasks-panel-' + key);
const tab = label => page.getByRole('tab', { name: label, exact: true });
const filter = key => panel(key).locator('button[aria-description="All Statuses"], button[aria-label="All Statuses"]');
const options = async key => { await filter(key).click(); return page.getByRole('listbox').getByRole('option').allTextContents(); };
const change = async (storage = false) => page.evaluate(storage => window.dispatchEvent(storage
  ? new StorageEvent('storage', { key: 'zea.kanban.configuration:task-fixture', newValue: 'test-change' })
  : new CustomEvent('task-statuses-updated', { detail: { tenantId: 'task-fixture' } })), storage);
try {
  await page.goto(entry + '#/tasks');
  const strip = panel('list').getByRole('region', { name: 'Task counts' });
  await expect.poll(() => strip.locator('[data-count-id]').evaluateAll(nodes => nodes.map(el => [el.dataset.countId, el.dataset.countValue]))).toEqual([
    ['total', '3'], ['custom-review', '1'], ['IN_PROGRESS', '1'], ['WAITING_FOR_REQUIREMENT', '0'],
  ]);
  assert.deepEqual(await options('list'), ['All Statuses', 'Client review', 'Working', 'New Task']);
  await page.getByRole('option', { name: 'Client review', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.status).toBe('custom-review');
  await expect(strip.locator('[data-count-id="total"]')).toHaveAttribute('data-count-value', '1');
  pass('Task counters and list filters use active configuration order, labels and custom identities; inactive counts are omitted');

  await tab('Kanban Board').click();
  assert.deepEqual(await options('kanban'), ['All Statuses', 'Client review', 'Working', 'New Task']);
  await page.getByRole('option', { name: 'All Statuses', exact: true }).click();
  await tab('Gantt Chart').click();
  await expect(panel('gantt').getByRole('button', { name: 'Working', exact: true })).toBeVisible();
  await expect(panel('gantt').getByRole('button', { name: 'Retired quality', exact: true })).toHaveCount(0);
  await panel('gantt').getByRole('button', { name: 'Client review', exact: true }).click();
  await expect(panel('gantt').getByText('Custom task', { exact: true }).first()).toBeVisible();
  await expect(panel('gantt').getByText('Native task', { exact: true })).toHaveCount(0);
  await tab('Calendar').click();
  const select = panel('calendar').locator('select').filter({ has: page.locator('option[value="custom-review"]') });
  await expect(select.locator('option')).toHaveText(['All statuses', 'Client review', 'Working', 'New Task']);
  await select.selectOption('IN_PROGRESS');
  pass('Kanban, Gantt and Calendar filters expose the same active statuses, including stages hidden on the board');

  catalog = catalog.map(row => row.id === 'IN_PROGRESS' ? { ...row, title: 'Renamed work', order: 0 } : row);
  await change(); await expect(select.locator('option[value="IN_PROGRESS"]')).toHaveText('Renamed work');
  await tab('All Tasks').click();
  await expect(filter('list')).toHaveText('Renamed work');
  await expect(strip.locator('[data-count-id]')).toHaveCount(4);
  catalog = catalog.map(row => row.id === 'IN_PROGRESS' ? { ...row, is_active: false } : row);
  await change(true);
  await expect(filter('list')).toHaveText('All Statuses');
  await expect.poll(() => new URL(page.url()).hash.includes('status=')).toBe(false);
  await expect(strip.locator('[data-count-id="IN_PROGRESS"]')).toHaveCount(0);
  await expect(strip.locator('[data-count-id="total"]')).toHaveAttribute('data-count-value', '3');
  await page.reload(); await expect(strip.locator('[data-count-id="IN_PROGRESS"]')).toHaveCount(0);
  assert.deepEqual(await options('list'), ['All Statuses', 'Client review', 'New Task']);
  await page.keyboard.press('Escape');
  pass('Renames/reorders update immediately; cross-session deactivation clears a selected filter, preserves total/history and survives reload');

  catalog = []; await change(); await expect(strip.locator('[data-count-id]')).toHaveCount(1);
  assert.deepEqual(await options('list'), ['All Statuses']); await page.keyboard.press('Escape');
  failCatalog = true; await page.reload();
  await expect(strip.locator('[data-count-id]')).toHaveCount(1);
  assert.deepEqual(await options('list'), ['All Statuses']); await page.keyboard.press('Escape');
  pass('Empty and failed configuration never introduce hard-coded fallback statuses');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('results.json', output), JSON.stringify({ results, errors, requests }, null, 2));
  await browser.close();
}
