// Actual Header/AuthProvider/Layout/TaskDetail. Synthetic APIs and SSE only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_NOTIFICATION_TEST_URL || 'http://127.0.0.1:6349';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const output = new URL('../../docs/notification-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const errors = [];
try {
  for (const role of ['user', 'manager', 'admin', 'owner']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
    let account = 'first';
    let items = [];
    let taskDone = false;
    let taskReads = 0;
    let readWrites = 0;
    let capabilities = { can_edit: true, can_manage_subtasks: role !== 'user', can_review_subtasks: role !== 'user' };
    const user = () => ({ id: `${account}-${role}`, tenant_id: 'synthetic-tenant', role, status: 'ACTIVE',
      name: `${account} ${role}`, email: `${account}-${role}@example.com`, claimed_reward_ids: [], unlocked_achievement_ids: [] });
    const stamp = '2026-10-20T08:00:00Z';
    await context.addInitScript(() => {
      localStorage.setItem('vee_access_token', 'synthetic-first-token');
      const nativeFetch = window.fetch.bind(window);
      window.__notificationStreams = [];
      window.fetch = (input, options) => {
        if (!String(input).endsWith('/notifications/stream')) return nativeFetch(input, options);
        const stream = { aborted: false, headers: options.headers, controller: null };
        const body = new ReadableStream({
          start(controller) {
            stream.controller = controller;
            options.signal.addEventListener('abort', () => {
              stream.aborted = true;
              try { controller.close(); } catch {}
            });
          },
        });
        window.__notificationStreams.push(stream);
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
      };
      window.__emitNotification = () => {
        const stream = window.__notificationStreams.filter(item => !item.aborted).at(-1);
        stream?.controller.enqueue(new TextEncoder().encode('event: notifications.changed\ndata: {"type":"notifications.changed"}\n\n'));
      };
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === '/__notification-tailwind.js') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
      if (url.pathname === '/__notification-check') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><script src="/__notification-tailwind.js"></script></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/pushLinksFixture.tsx"></script></body></html>` });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: user() });
      if (url.pathname.startsWith('/api/auth/websocket-ticket')) return route.fulfill({ status: 503, json: {} });
      if (url.pathname === '/api/notifications') return route.fulfill({ json: items });
      if (/^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
        readWrites++;
        items = items.map(item => ({ ...item, is_read: true }));
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === '/api/time-entries/work/active') return route.fulfill({ json: {
        items: [], user_id: user().id, tenant_id: user().tenant_id, server_time: stamp, limit: 3, running_count: 0, next_offset: null,
      } });
      if (url.pathname === '/api/users') return route.fulfill({ json: [user()] });
      if (url.pathname === '/api/tasks/notification-parent') {
        taskReads++;
        return route.fulfill({ json: { id: 'notification-parent', title: 'Realtime parent', description: 'Synthetic task',
          ...capabilities,
          status: taskDone ? 'DONE' : 'IN_PROGRESS', priority: 'MEDIUM', assigned_to_ids: [user().id], created_by_id: 'other-user',
          created_at: stamp, updated_at: stamp, recurrence_rule: 'NONE', task_group_id: null,
          subtasks: [1, 2, 3].map(number => ({ id: `child-${number}`, title: `Step ${number}`,
            status: taskDone || number === 1 ? 'DONE' : number === 2 ? 'TODO' : 'WAITING',
            completed: taskDone || number === 1, assigned_to_id: number === 2 ? user().id : 'other-user',
            sort_order: number, dependency_state: number === 3 && !taskDone ? 'WAITING' : 'READY', dependency_ids: [] })) } });
      }
      if (url.pathname.includes('release-notes')) return route.fulfill({ json: { version_label: 'Test', sections: [] } });
      if (url.pathname.includes('points-table')) return route.fulfill({ json: {} });
      if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { detail: 'Unexpected synthetic write' } });
      return route.fulfill({ json: [] });
    });
    await page.goto(`${base}/__notification-check#/tasks`);
    await expect(page.getByRole('button', { name: 'Notifications, 0 unread', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__notificationStreams.filter(item => !item.aborted).length)).toBe(1);
    const emitAt = Date.now();
    items = [{ id: 'notice-1', tenant_id: user().tenant_id, user_id: user().id, type: 'SUBTASK_ACTIVATED',
      message: 'Alice completed Step 1. You can start Step 2.', title: 'Ready to start',
      entity_type: 'subtask', entity_id: 'child-2', related_task_id: 'notification-parent',
      deep_link: '/#/tasks?taskId=notification-parent&subtaskId=child-2', is_read: false, created_at: stamp }];
    await page.evaluate(() => window.__emitNotification());
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible({ timeout: 5000 });
    const deliveredMs = Date.now() - emitAt;
    assert(deliveredMs < 5000);
    await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click();
    await page.getByRole('button', { name: /Alice completed Step 1/ }).click();
    await expect(page).toHaveURL(/taskId=notification-parent&subtaskId=child-2/);
    await expect(page.locator('#work-subtask-child-2')).toBeFocused();
    await expect.poll(() => readWrites).toBe(1);
    await expect(page.getByRole('button', { name: 'Notifications, 0 unread', exact: true })).toBeVisible();
    const child = page.locator('#work-subtask-child-2');
    await child.getByRole('checkbox', { name: 'Complete Step 2' }).click();
    await expect(page.getByRole('heading', { name: 'Complete subtask', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (role === 'user') {
      await expect(page.locator('#work-subtask-child-1').getByRole('combobox', { name: 'Subtask status' })).toBeDisabled();
      await expect(child.getByRole('combobox', { name: 'Subtask assignee' })).toBeDisabled();
    }
    const before = taskReads;
    taskDone = true;
    await page.evaluate(() => window.__emitNotification());
    await expect.poll(() => taskReads).toBeGreaterThan(before);
    await expect(child.getByRole('combobox', { name: 'Subtask status' })).toHaveValue('DONE');
    await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('DONE');
    capabilities = { can_edit: false, can_manage_subtasks: false, can_review_subtasks: false };
    await page.evaluate(() => window.__emitNotification());
    await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeDisabled();
    await expect(child.getByRole('combobox', { name: 'Subtask assignee' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete Task', exact: true })).toHaveCount(0);
    capabilities = { can_edit: true, can_manage_subtasks: true, can_review_subtasks: true };
    await page.evaluate(() => window.__emitNotification());
    await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeEnabled();
    await expect(child.getByRole('combobox', { name: 'Subtask assignee' })).toBeEnabled();
    await page.getByRole('button', { name: 'Close modal', exact: true }).click();
    account = 'second';
    items = [];
    await page.evaluate(() => {
      localStorage.setItem('vee_access_token', 'synthetic-second-token');
      window.dispatchEvent(new StorageEvent('storage', { key: 'vee_access_token', newValue: 'synthetic-second-token' }));
    });
    await expect(page.getByRole('button', { name: 'Notifications, 0 unread', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__notificationStreams[0].aborted)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__notificationStreams.filter(item => !item.aborted).length)).toBe(1);
    await page.getByRole('button', { name: 'Notifications, 0 unread', exact: true }).click();
    await expect(page.getByText('Alice completed Step 1. You can start Step 2.', { exact: true })).toHaveCount(0);
    results.push({ role, delivered_ms: deliveredMs, unread_live: true, subtask_focus: true, evidence_dialog: true,
      parent_and_child_live: true, server_capabilities_honored: true, account_switch_isolated: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('frontend-browser.json', output), JSON.stringify({ passed: true, scenarios: results, page_errors: errors,
    scope: 'Actual React components and browser fetch-stream consumer; synthetic APIs/SSE. No live database/provider writes.' }, null, 2));
  console.log(JSON.stringify({ passed: true, roles: results.length, scenarios: results, page_errors: errors }));
} catch (error) {
  await writeFile(new URL('frontend-browser.json', output), JSON.stringify({ passed: false, scenarios: results, page_errors: errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
