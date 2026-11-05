// Actual HashRouter/Layout/TaskDetailModal/TicketPage/TicketDetailDrawer.
// Synthetic APIs only; no push provider calls or live data changes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_PUSH_TEST_URL || 'http://127.0.0.1:6302';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const output = new URL('../../docs/push-notifications/checks/', import.meta.url);
const tailwind = await readFile(new URL('tailwind-test-runtime.js', output), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
const requests = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const stamp = '2026-10-20T08:00:00Z';
const user = { id: 'push-link-user', tenant_id: 'push-link-tenant', role: 'user', status: 'ACTIVE',
  name: 'Link User', email: 'links@example.com', claimed_reward_ids: [], unlocked_achievement_ids: [] };
let slowTicketStarted;
const slowRequest = new Promise(resolve => { slowTicketStarted = resolve; });
await context.addInitScript(() => localStorage.setItem('vee_access_token', 'synthetic-click-test-token'));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname === '/__push-links-tailwind.js') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
  if (url.pathname === '/__push-links') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/__push-links-tailwind.js"></script></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/pushLinksFixture.tsx"></script></body></html>` });
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ method: route.request().method(), path: url.pathname });
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
  if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ status: 503, json: { detail: 'Synthetic realtime disabled' } });
  if (url.pathname === '/api/time-entries/work/active') return route.fulfill({ json: {
    items: [], user_id: user.id, tenant_id: user.tenant_id, server_time: stamp, limit: 3, running_count: 0, next_offset: null,
  } });
  if (url.pathname === '/api/users') return route.fulfill({ json: [user] });
  if (/^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/').at(-1);
    if (id === 'forbidden-task') return route.fulfill({ status: 404, json: { detail: 'Task not found' } });
    return route.fulfill({ json: { id, title: `Authorized task ${id}`, description: 'Synthetic notification target',
      status: 'TODO', priority: 'MEDIUM', assigned_to_ids: [user.id], created_by_id: user.id,
      created_at: stamp, updated_at: stamp, subtasks: [], recurrence_rule: 'NONE', task_group_id: null } });
  }
  if (url.pathname === '/api/tickets') return route.fulfill({ json: { data: [], total: 0 } });
  if (/^\/api\/tickets\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/').at(-1);
    if (id === 'forbidden-ticket') return route.fulfill({ status: 404, json: { detail: 'Ticket not found' } });
    if (id === 'slow-ticket') {
      slowTicketStarted();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return route.fulfill({ json: { id, tenant_id: user.tenant_id, title: `Authorized ticket ${id}`, description: 'Synthetic ticket',
      status: 'OPEN', priority: 'MEDIUM', created_at: stamp, updated_at: stamp, created_by: user.id,
      owner_id: user.id, assigned_user_id: user.id, approval_enabled: false, approval_status: 'none', followers: [],
      attachments: [], task_summary: { total: 0, completed: 0, open: 0 } } }).catch(() => undefined);
  }
  if (url.pathname.includes('release-notes')) return route.fulfill({ json: { version_label: 'Test', sections: [] } });
  if (url.pathname.includes('points-table')) return route.fulfill({ json: {} });
  if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { detail: 'Synthetic writes disabled' } });
  return route.fulfill({ json: [] });
});

try {
  await page.goto(`${base}/__push-links#/tasks?taskId=task-one`);
  await expect(page.getByText('Authorized task task-one', { exact: true }).first()).toBeVisible();
  assert(requests.some(row => row.path === '/api/tasks/task-one'));
  await page.getByRole('button', { name: 'Close modal', exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks$/);
  await expect(page.getByText('Authorized task task-one', { exact: true })).toHaveCount(0);
  results.push('Task hash deep link opens existing modal with authorized API request; close clears query');

  await page.evaluate(() => { location.hash = '#/tasks?taskId=forbidden-task'; });
  await expect(page.getByText('Failed to load task', { exact: true })).toBeVisible();
  await expect(page.getByText('Authorized task task-one', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close modal', exact: true }).click();
  results.push('Forbidden task link displays existing error and never retains previous private task');

  await page.evaluate(() => { location.hash = '#/tickets?ticketId=ticket-one'; });
  await expect(page.getByText('Authorized ticket ticket-one', { exact: true }).first()).toBeVisible();
  assert(requests.filter(row => row.path === '/api/tickets/ticket-one').length >= 2);
  await page.locator('button[aria-label="Close ticket details"]').click();
  await expect(page).toHaveURL(/#\/tickets$/);
  results.push('Ticket hash deep link opens existing drawer using fresh API reads; close clears query');

  await page.evaluate(() => { location.hash = '#/tickets?ticketId=forbidden-ticket'; });
  await expect(page.getByRole('alert')).toHaveText(/Unable to open this ticket/);
  await expect(page.getByText('Authorized ticket ticket-one', { exact: true })).toHaveCount(0);
  results.push('Forbidden ticket uses an accessible error state and no old detail drawer');

  await page.evaluate(() => { location.hash = '#/tickets?ticketId=slow-ticket'; });
  await slowRequest;
  await page.evaluate(() => { location.hash = '#/tickets?ticketId=ticket-two'; });
  await expect(page.getByText('Authorized ticket ticket-two', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByText('Authorized ticket slow-ticket', { exact: true })).toHaveCount(0);
  results.push('Navigation cancels slow ticket request and ignores its late response');
  assert.deepEqual(errors, []);
  await writeFile(new URL('click-browser.json', output), JSON.stringify({ passed: true, scenarios: results, page_errors: errors, requests }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios: results.length, page_errors: errors }));
} catch (error) {
  await writeFile(new URL('click-browser.json', output), JSON.stringify({ passed: false, scenarios: results, page_errors: errors, requests, error: error.message }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
