import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_WORK_TEST_URL || 'http://127.0.0.1:6302';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback tests only');
const output = new URL('../../docs/active-work/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata' });
const pages = []; const sessions = []; let id = 0; const sockets = new Set(); const requests = []; const errors = []; let opens = 0;
let mismatchedScope = false;
let accessDenied = false;
await context.addInitScript(() => localStorage.setItem('vee_access_token', 'local-synthetic-token'));
await context.routeWebSocket('**/ws/tasks?*', socket => {
  opens++; sockets.add(socket); socket.onClose(() => sockets.delete(socket)); socket.send(JSON.stringify({ type: 'realtime:ready' }));
});
const notify = () => { for (const socket of sockets) socket.send(JSON.stringify({ type: 'timer.changed', user_id: 'worker' })); };
const snapshot = history => ({ user_id: 'worker', tenant_id: mismatchedScope ? 'foreign-tenant' : 'tenant', items: sessions.filter(s => history || s.status !== 'STOPPED'), server_time: new Date().toISOString(), limit: 3,
  running_count: sessions.filter(s => s.status === 'RUNNING').length, next_offset: null });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname === '/__active-work-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#050b18;color:#e2e8f0;font:14px Arial}*{box-sizing:border-box}h1,h2,h3,p{margin:0}main{padding:20px}section{margin:20px 0}button{color:inherit;background:#14243b}button,input,select{font:inherit}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/activeWorkFixture.tsx"></script></body></html>` });
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push(url.pathname);
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'worker', name: 'Worker', email: 'worker@example.test', role: 'user', tenant_id: 'tenant', status: 'ACTIVE', unlocked_achievement_ids: [], claimed_reward_ids: [] } });
  if (url.pathname === '/api/auth/websocket-ticket') return route.fulfill({ json: { access_token: 'synthetic-ws-token' } });
  if (accessDenied && url.pathname.startsWith('/api/time-entries/')) return route.fulfill({ status: 403, json: { detail: 'User is inactive' } });
  if (url.pathname.endsWith('/work/active')) return route.fulfill({ json: snapshot(false) });
  if (url.pathname.endsWith('/work/history')) return route.fulfill({ json: snapshot(true) });
  if (url.pathname.endsWith('/time-entries/start')) {
    const target = route.request().postDataJSON().subtask_id;
    if (snapshot(false).running_count >= 3) return route.fulfill({ status: 409, json: { detail: { code: 'ACTIVE_TIMER_LIMIT', message: 'You have reached your active timer limit (3/3). Pause or stop one of your running subtasks to start another.' } } });
    const row = { id: `session-${++id}`, entry_id: `entry-${id}`, status: 'RUNNING', task_id: 'task-a', subtask_id: target,
      project_name: 'Platform Engineering', task_title: 'Release the project dashboard', subtask_title: `Subtask ${target.split('-')[1]}`, subtask_status: 'IN_PROGRESS',
      started_at: new Date(Date.now() - 3600000).toISOString(), stopped_at: null, running_since: new Date(Date.now() - 3600000).toISOString(),
      active_seconds: 3600, paused_seconds: 0, range_active_seconds: 3600, range_paused_seconds: 0, subtask_total_seconds: 3600, intervals: [], timeline: [{ event: 'Started', at: new Date().toISOString() }] };
    sessions.push(row); notify();
    return route.fulfill({ json: { id: row.entry_id, tenant_id: 'tenant', user_id: 'worker', subtask_id: target, started_at: row.started_at, status: 'ACTIVE' } });
  }
  const action = url.pathname.match(/\/time-entries\/([^/]+)\/(pause|resume|stop)$/);
  if (action) {
    const row = sessions.find(s => s.entry_id === action[1]);
    row.status = { pause: 'PAUSED', resume: 'RUNNING', stop: 'STOPPED' }[action[2]];
    row.timeline.push({ event: { pause: 'Paused', resume: 'Resumed', stop: 'Stopped' }[action[2]], at: new Date().toISOString() });
    if (action[2] === 'stop') row.stopped_at = new Date().toISOString();
    notify(); return route.fulfill({ json: {} });
  }
  return route.fulfill({ status: 404, json: { detail: 'No fixture route' } });
});
const result = [];
try {
  for (let i = 0; i < 2; i++) { const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${base}/__active-work-test`); await page.getByRole('button', { name: 'Start timer', exact: true }).first().waitFor(); }
  const [a, b] = pages;
  for (let i = 0; i < 3; i++) await a.locator('section').nth(i).getByRole('button', { name: 'Start timer', exact: true }).click();
  await a.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '3/3' }).waitFor();
  await b.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '3/3' }).waitFor();
  result.push('three starts and cross-tab invalidation');
  const readsBefore = requests.filter(path => path.endsWith('/work/active')).length;
  await a.waitForTimeout(2100);
  assert.equal(requests.filter(path => path.endsWith('/work/active')).length, readsBefore);
  result.push('elapsed display uses a local clock without per-second requests');
  await a.locator('section').nth(3).getByRole('button', { name: 'Start timer', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'active timer limit (3/3)' }).waitFor();
  const panel = a.getByRole('dialog');
  assert.equal(await panel.locator('.work-card').count(), 3);
  await context.setOffline(true);
  const writesBeforeOffline = requests.length;
  await panel.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await a.getByRole('alert').filter({ hasText: 'Reconnect to control timers' }).waitFor();
  assert.equal(sessions.filter(row => row.status === 'RUNNING').length, 3);
  await context.setOffline(false);
  await panel.getByRole('button', { name: 'Refresh Active Work' }).click();
  result.push('offline controls preserve running sessions and recover online');
  await panel.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await b.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '2/3' }).waitFor();
  await panel.getByRole('button', { name: 'Resume', exact: true }).click();
  await b.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '3/3' }).waitFor();
  result.push('capacity error, independent pause and resume');
  await a.screenshot({ path: new URL('desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await a.getByRole('button', { name: 'Close Active Work' }).click();
  await a.reload();
  await a.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '3/3' }).waitFor();
  result.push('refresh recovery');
  const beforeReconnect = opens;
  for (const socket of [...sockets]) { sockets.delete(socket); socket.close({ code: 1012, reason: 'test reconnect' }); }
  await a.waitForFunction(() => true);
  for (let attempt = 0; opens < beforeReconnect + 2 && attempt < 30; attempt++) await a.waitForTimeout(100);
  assert.ok(opens >= beforeReconnect + 2);
  await a.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '3/3' }).waitFor();
  result.push('socket reconnect triggers backend reconciliation');
  await a.getByRole('button', { name: 'Open Active Work' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Stop', exact: true }).first().click();
  await b.getByRole('button', { name: 'Open Active Work' }).filter({ hasText: '2/3' }).waitFor();
  await a.getByRole('button', { name: 'Work history', exact: true }).click();
  await a.locator('.work-state').filter({ hasText: /^STOPPED$/ }).waitFor();
  await a.getByText('View session details', { exact: false }).first().click();
  await a.locator('.work-timeline').first().waitFor();
  result.push('stop synchronization and chronological history');
  await a.setViewportSize({ width: 390, height: 844 }); await a.emulateMedia({ reducedMotion: 'reduce' });
  const box = await a.locator('.work-panel').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.equal(await a.locator('.work-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
  await a.screenshot({ path: new URL('mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  result.push('mobile drawer and reduced motion');
  await a.getByRole('button', { name: 'Close Active Work' }).click();
  assert.equal(await a.getByRole('dialog').count(), 0);
  mismatchedScope = true;
  await a.getByRole('button', { name: 'Open Active Work' }).click();
  await a.getByRole('button', { name: 'Refresh Active Work' }).click();
  await a.getByRole('alert').filter({ hasText: 'does not match your signed-in account' }).waitFor();
  assert.equal(await a.locator('.work-card').count(), 0);
  result.push('mismatched tenant responses clear private state');
  mismatchedScope = false;
  await a.getByRole('button', { name: 'Refresh Active Work' }).click();
  await a.waitForFunction(() => document.querySelector('.work-trigger')?.textContent?.includes('2/3'));
  accessDenied = true;
  await a.getByRole('button', { name: 'Refresh Active Work' }).click();
  await a.getByRole('alert').filter({ hasText: 'access is no longer available' }).waitFor();
  await a.waitForFunction(() => document.querySelectorAll('.work-card').length === 0);
  result.push('revoked account access clears previously loaded work');
  await a.evaluate(() => window.hideWorkFixture());
  await b.evaluate(() => window.hideWorkFixture());
  await a.waitForTimeout(100);
  assert.equal(sockets.size, 0);
  await a.close(); await b.close();
  assert.equal(sockets.size, 0);
  result.push('unmount closes shared sockets');
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser.json', output), JSON.stringify({ passed: result, errors, activeConnections: sockets.size, requests: requests.length, note: 'Mocked API/WebSocket component integration; database and real transport tested separately.' }, null, 2));
  console.log(JSON.stringify({ passed: result, errors }));
} finally { await browser.close(); }
