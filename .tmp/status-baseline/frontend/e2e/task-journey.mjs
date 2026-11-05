import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Use an existing Playwright installation without adding an application dependency.
const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an existing Playwright index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.ZEAPLAY_JOURNEY_TEST_URL || 'http://127.0.0.1:6302';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Only loopback test targets are allowed');
const output = new URL(process.env.ZEAPLAY_JOURNEY_OUTPUT || '../../docs/task-lifecycle-phase2/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
const results = [];
const requests = [];
const pageErrors = [];
const sockets = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('websocket', socket => { const url = new URL(socket.url()); url.search = ''; sockets.push(url.toString()); });
const asOf = '2026-10-19T10:00:00.000Z';
const event = (id, previous, next, time, child = null) => ({ id, task_id: 'task-a', subtask_id: child,
  time_entry_id: null, event_type: `${child ? 'subtask' : 'task'}.${previous ? 'status_changed' : 'created'}`,
  previous_status: previous, new_status: next, actor_id: 'reviewer', occurred_at: time, recorded_at: time,
  details: id === 4 ? { reason: 'Returned after the acceptance review.' } : {} });
const events = [event(1, null, 'TODO', '2026-10-19T08:00:00.123456Z'),
  event(2, 'TODO', 'IN_PROGRESS', '2026-10-19T08:15:00Z'),
  event(3, 'IN_PROGRESS', 'DONE', '2026-10-19T09:00:00Z'),
  event(4, 'DONE', 'IN_PROGRESS', '2026-10-19T09:45:00Z'),
  event(5, null, 'TODO', '2026-10-19T08:00:01Z', 'child-a'),
  event(6, 'TODO', 'IN_PROGRESS', '2026-10-19T09:46:00Z', 'child-a')];
for (const [id, kind] of [[7, 'started'], [8, 'paused'], [9, 'resumed']]) events.push({ ...event(id, null, 'ACTIVE', asOf, 'child-a'),
  event_type: `timer.${kind}`, time_entry_id: 'session-a' });
const metric = (seconds, count, active) => ({ session_count: count, active_session_count: active,
  raw_session_seconds: seconds, person_seconds: seconds, elapsed_seconds: seconds });
function fixturePdf() {
  const text = 'BT /F1 18 Tf 40 140 Td (Synthetic execution evidence) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, content] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${content}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
let mode = 'normal';
let paginated = false;
let sessionsPaginated = false;
let longText = false;
let taskStatus = 'IN_PROGRESS';
let childCount = 1;
let sessionBatch = false;
let invalidClock = false;
let mismatchedStatus = false;
let reportPaged = false;
let reportError = false;
let reportMismatched = false;
let foreignEvent = false;
let foreignSession = false;
let foreignEvidence = false;
let staleTaskMetadata = false;
let fileDenied = false;
const measurements = {};
let delay = 0;
let analyticsInFlight = 0;
let peakAnalyticsInFlight = 0;
let sequence = 0;
const apiUser = { id: 'reviewer', name: 'Asha Reviewer', email: 'asha@example.test', role: 'owner', tenant_id: 'tenant-a',
  status: 'ACTIVE', points: 0, overall_xp_points: 0, claimed_xp_points: 0, unlocked_achievement_ids: [], claimed_reward_ids: [] };

await context.addInitScript(() => {
  if (window.top !== window) return;
  localStorage.setItem('vee_access_token', 'synthetic-local-test-token');
  const intervals = new Map();
  const notices = new Set();
  const start = window.setInterval.bind(window);
  const stop = window.clearInterval.bind(window);
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  window.setInterval = (callback, delay, ...args) => {
    const id = start(callback, delay, ...args); intervals.set(id, { callback, delay }); return id;
  };
  window.clearInterval = id => { intervals.delete(id); return stop(id); };
  window.addEventListener = (name, callback, options) => { if (name === 'zea:task-realtime') notices.add(callback); return add(name, callback, options); };
  window.removeEventListener = (name, callback, options) => { if (name === 'zea:task-realtime') notices.delete(callback); return remove(name, callback, options); };
  window.journeyProbe = { state: () => ({ intervals: [...intervals.values()].map(row => row.delay).sort(), notices: notices.size }),
    poll: () => { for (const row of intervals.values()) if (row.delay === 30000) row.callback(); } };
  const objectUrls = new Set();
  const createUrl = URL.createObjectURL.bind(URL);
  const revokeUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = value => { const url = createUrl(value); objectUrls.add(url); return url; };
  URL.revokeObjectURL = value => { objectUrls.delete(value); revokeUrl(value); };
  window.reportProbe = { objectUrls: () => objectUrls.size };
});
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.protocol === 'chrome-extension:' && url.hostname === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return route.continue();
  if (['chrome:', 'chrome-untrusted:'].includes(url.protocol)) return route.continue();
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname === '/__journey-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--color-bg-primary:#050b18;--color-surface:#0d1830;--color-border-color:#34435a;--color-text-primary:#eef2f6;--color-text-secondary:#aab6c9}
    body{margin:0;font:14px Arial;background:#050b18;color:#eef2f6}button{padding:12px}*{box-sizing:border-box}h1,h2,h3,h4,h5,p{margin:0}details>summary{list-style:none}
    </style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/taskJourneyFixture.tsx"></script></body></html>` });
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ path: url.pathname, search: url.search, method: route.request().method() });
  if (url.pathname === '/api/auth/logout' && route.request().method() === 'POST') return route.fulfill({ status: 204 });
  const statusEdit = route.request().method() === 'PATCH' && /^\/api\/tasks\/[^/]+$/.test(url.pathname);
  if (statusEdit) taskStatus = route.request().postDataJSON().status;
  if (route.request().method() !== 'GET' && !statusEdit) return route.abort();
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: apiUser });
  if (url.pathname === '/api/time-entries/work/active') return route.fulfill({ json: { items: [], user_id: apiUser.id, tenant_id: apiUser.tenant_id, server_time: asOf, limit: 5, running_count: 0, next_offset: null } });
  const capturedMode = mode;
  const capturedDelay = delay;
  const responseSequence = ++sequence;
  if (capturedDelay) {
    if (url.pathname.endsWith('/analytics')) {
      analyticsInFlight++;
      peakAnalyticsInFlight = Math.max(peakAnalyticsInFlight, analyticsInFlight);
    }
    await new Promise(resolve => setTimeout(resolve, capturedDelay));
    if (url.pathname.endsWith('/analytics')) analyticsInFlight--;
  }
  if (capturedMode === 'denied') return route.fulfill({ status: 403, json: { detail: 'Forbidden' } });
  if (capturedMode === 'unavailable') return route.fulfill({ status: 503, json: { detail: 'missing migration' } });
  const taskId = url.pathname.split('/')[3];
  const isB = taskId === 'task-b';
  const child = { id: 'child-a', title: 'Validate release package', assigned_to_id: 'worker', completed: false, status: 'IN_PROGRESS' };
  const children = [child, ...Array.from({ length: childCount - 1 }, (_, index) => ({ ...child,
    id: `child-${index}`, title: `Subtask ${index} ` + 'lengthy-unbroken-title'.repeat(4), status: 'TODO', assigned_to_id: null }))];
  const task = { id: taskId, title: isB ? 'Second authorized task' : 'Release review: acceptance and delivery',
    status: taskStatus, priority: 'HIGH', assigned_to_ids: ['worker'], created_by_id: 'reviewer', created_at: '2026-10-19T08:00:00.123456Z',
    updated_at: asOf, subtasks: children, recurrence_rule: 'NONE', task_group_id: null };
  if (longText) { task.title = 'UnbrokenLongTaskTitle'.repeat(35); child.title = 'LongChildTitle'.repeat(35); }
  if (/\/journey$/.test(url.pathname)) {
    const more = url.searchParams.get('after_id') !== '0';
    return route.fulfill({ json: { task_id: taskId, created_by_id: 'reviewer', created_at: task.created_at,
      status: taskStatus, subtasks: children.map(row => ({ id: row.id, status: row.status })), capture_started_at: '2026-10-19T07:00:00Z',
      history_complete: capturedMode !== 'legacy', items: (capturedMode === 'empty' ? [] : paginated ? more ? events.slice(3) : events.slice(0, 3) : events).map(row => ({ ...row, task_id: foreignEvent ? 'foreign' : taskId })),
      next_after_id: paginated && !more ? 3 : null, response_sequence: responseSequence } });
  }
  const time = sessionBatch ? { ...metric(2640, 30, 1), raw_session_seconds: 53040 } : metric(840, 1, 1);
  const reportBase = `/api/tasks/${taskId}/execution-report`;
  const actor = { id: 'reviewer', name: 'Asha Reviewer' };
  const worker = { id: 'worker', name: 'Dev Kumar' };
  const entity = (row, main = false) => ({ id: row.id, title: row.title, status: row.status,
    creator: main ? actor : null, assignee: worker, created_at: main ? task.created_at : null,
    creation_source: main ? 'task_record' : 'not_recorded', first_started_at: '2026-10-19T08:15:00Z',
    first_session_started_at: null, last_completed_at: main ? '2026-10-19T09:00:00Z' : null,
    final_completed_at: main && taskStatus === 'DONE' ? '2026-10-19T09:00:00Z' : null,
    final_completion_source: main && taskStatus === 'DONE' ? 'captured_event' : 'not_recorded',
    completion_count: main ? 1 : 0, reopened_count: main ? 1 : 0,
    event_counts: { 'timer.started': 3, 'timer.resumed': 2, 'timer.restarted': 1, 'timer.stopped': 2, 'timer.paused': 2 },
    time: main ? metric(0, 0, 0) : time, linked_paused_seconds: 600, unresolved_pause_count: 1, deleted: false });
  if (url.pathname === reportBase) return route.fulfill({ status: reportError ? 503 : 200, json: reportError ? { detail: 'unavailable' } : {
    task_id: taskId, as_of: asOf, history_complete: false, capture_started_at: '2026-10-19T07:00:00Z',
    retained_sessions_only: true, deleted_session_count: 1, task: { ...entity(task, true), status: reportMismatched ? 'BLOCKED' : taskStatus }, subtasks: children.map(row => entity(row)),
    direct: metric(0, 0, 0), children: time, aggregate: time,
  } });
  if (url.pathname === `${reportBase}/completions`) {
    const more = Boolean(url.searchParams.get('after_id'));
    const attempt = (id, number, status, at) => ({ id, task_id: taskId, subtask_id: 'child-a', attempt_number: number,
      description: 'Verified work against every requested acceptance criterion', status, approval_required: true,
      submitted_by: worker, created_at: at, reviewed_by: actor, reviewed_at: at, review_reason: status === 'REJECTED' ? 'Please include a clearer screenshot.' : null });
    const rows = [attempt('attempt-b', 2, 'APPROVED', '2026-10-19T09:50:00Z'), attempt('attempt-a', 1, 'REJECTED', '2026-10-19T09:00:00Z')];
    return route.fulfill({ json: { items: reportPaged ? more ? rows.slice(0, 1) : rows.slice(1) : rows, next_after_id: reportPaged && !more ? 'attempt-a' : null } });
  }
  if (url.pathname === `${reportBase}/evidence`) {
    const source = url.searchParams.get('source');
    const record = (id, mime, state = 'available') => ({ id, source: 'completion', task_id: taskId, subtask_id: foreignEvidence ? 'foreign-child' : 'child-a', submission_id: 'attempt-b',
      filename: `${id}.${mime === 'application/pdf' ? 'pdf' : 'png'}`, mime_type: mime, size_bytes: 1024,
      uploaded_by: worker, uploaded_at: '2026-10-19T09:50:00.123456Z', availability: state, can_preview: state === 'available', can_download: state === 'available' });
    const rows = source === 'completion' ? [record('screenshot', 'image/png'), record('acceptance', 'application/pdf'), record('missing-proof', 'image/png', 'missing')] : [
      { ...record('old-file', 'image/png', 'deleted'), source: 'media', subtask_id: null },
      { ...record('unknown', null, 'unverified'), source: 'unverified', subtask_id: null, filename: null, uploaded_by: null, uploaded_at: null },
    ];
    const more = Boolean(url.searchParams.get('after_id'));
    return route.fulfill({ json: { items: reportPaged && source === 'completion' ? more ? rows.slice(1) : rows.slice(0, 1) : rows,
      next_after_id: reportPaged && source === 'completion' && !more ? 'screenshot' : null } });
  }
  if (url.pathname.startsWith(`${reportBase}/evidence/`)) {
    if (fileDenied) return route.fulfill({ status: 404, json: { detail: 'File unavailable' } });
    if (url.pathname.endsWith('/screenshot')) return route.fulfill({ contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    return route.fulfill({ contentType: 'application/pdf', body: fixturePdf() });
  }
  if (/\/analytics$/.test(url.pathname)) return route.fulfill({ json: { task_id: taskId, status: mismatchedStatus ? 'BLOCKED' : taskStatus, as_of: invalidClock ? 'invalid' : asOf,
    capture_started_at: '2026-10-19T07:00:00Z', history_complete: capturedMode !== 'legacy', parent: metric(0, 0, 0),
    children: time, aggregate: time, subtasks: children.map((row, index) => ({ ...(index === 0 ? time : metric(0, 0, 0)), subtask_id: row.id, status: row.status })) } });
  if (/\/execution-sessions$/.test(url.pathname)) {
    const first = sessionsPaginated && !url.searchParams.get('after_id');
    const active = { id: 'session-a', tenant_id: foreignSession ? 'foreign-tenant' : 'tenant-a', user_id: 'worker', task_id: null, subtask_id: 'child-a',
      started_at: '2026-10-19T09:46:00Z', stopped_at: null, status: 'ACTIVE', continued_from_id: 'earlier-session', start_kind: 'resumed' };
    const rows = [active, ...(sessionBatch ? Array.from({ length: 29 }, (_, index) => ({ ...active,
      id: `history-${29 - index}`, started_at: '2026-10-19T09:00:00Z', stopped_at: '2026-10-19T09:30:00Z', status: 'CORRECTED',
      corrected_at: asOf, correction_reason: 'Corrected with preserved originals', original_started_at: '2026-10-19T08:59:00Z', original_stopped_at: '2026-10-19T09:30:00Z' })) : [])];
    return route.fulfill({ json: { task_id: taskId, next_after_id: first ? 'cursor-a' : null, items: first ? [] : rows } });
  }
  if (/\/tasks\/[^/]+$/.test(url.pathname)) return route.fulfill({ json: { ...task, status: staleTaskMetadata ? 'BLOCKED' : task.status } });
  return route.fulfill({ json: [] });
});

async function run(name, fn) {
  if (process.env.ZEAPLAY_JOURNEY_CASE && !name.includes(process.env.ZEAPLAY_JOURNEY_CASE)) return;
  try { await fn(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, result: 'FAIL', error: error.message }); failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
async function open() {
  await page.goto(`${base}/__journey-test`);
  await page.getByRole('button', { name: 'Open journey' }).click();
  await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).waitFor();
}
async function checkIndicatorContrast() {
  return page.locator('.journey-stage-active .journey-stage-dot').first().evaluate(el => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const a = luminance(getComputedStyle(el).borderTopColor);
    const b = luminance(getComputedStyle(document.querySelector('.journey-panel')).backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}
try {
  await run('heading, recorded transitions, reopens and exact timestamps', async () => {
    await open();
    assert.equal(await page.locator('.journey-transitions').first().locator('li').count(), 4);
    await page.getByText('Returned after the acceptance review.').waitFor();
    assert.ok((await page.locator('.journey-heading').innerText()).includes('.123456 UTC'));
    assert.equal(await page.locator('.journey-stage-active').first().getAttribute('aria-current'), 'step');
    assert.equal(await page.locator('[aria-labelledby="journey-workflow-title"] .journey-stage-upcoming').filter({ hasText: 'In Review' }).count(), 1);
  });
  await run('only the current task stage glows, and the normal-motion glow actually animates', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const active = page.locator('[aria-labelledby="journey-workflow-title"] .journey-stage-active .journey-stage-dot');
    assert.equal(await active.count(), 1);
    assert.equal(await active.evaluate(el => getComputedStyle(el).animationName), 'journey-glow');
    const before = await active.evaluate(el => getComputedStyle(el).boxShadow);
    await page.waitForTimeout(350);
    assert.notEqual(await active.evaluate(el => getComputedStyle(el).boxShadow), before);
    assert.equal(await page.locator('.journey-stage-upcoming .journey-stage-dot').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.ok(await checkIndicatorContrast() >= 3);
  });
  await run('subtask timeline and persisted timer actions', async () => {
    await page.locator('.journey-child > summary').click();
    await page.locator('.journey-child .journey-sessions > summary').click();
    await page.getByText('Resumed', { exact: true }).waitFor();
    await page.getByText('Paused', { exact: true }).waitFor();
    assert.ok((await page.locator('.journey-child').innerText()).includes('Dev Kumar'));
  });
  await run('live clocks advance independently of browser wall clock', async () => {
    const counter = page.locator('.journey-metrics dd').nth(1);
    const before = await counter.innerText();
    await page.evaluate(() => { Date.now = () => 0; });
    await page.waitForTimeout(1300);
    assert.notEqual(await counter.innerText(), before);
  });
  await run('desktop, mobile, light theme and reduced motion layout', async () => {
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.journey-scroll').evaluate(el => { el.scrollTop = 0; });
      const dimensions = await page.locator('.journey-scroll').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width + 1, JSON.stringify({ width, ...dimensions }));
      await page.screenshot({ path: new URL(`journey-${width}.png`, output).pathname.replace(/^\/(?=[A-Z]:)/, ''), fullPage: true });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.journey-stage-active .journey-stage-dot').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.evaluate(() => { for (const [key, value] of Object.entries({ '--color-bg-primary': '#fff', '--color-surface': '#f6f8fa', '--color-border-color': '#cbd5e1', '--color-text-primary': '#111827', '--color-text-secondary': '#475569' })) document.documentElement.style.setProperty(key, value); });
    assert.ok(await checkIndicatorContrast() >= 3);
    await page.screenshot({ path: new URL('journey-light-mobile.png', output).pathname.replace(/^\/(?=[A-Z]:)/, ''), fullPage: true });
  });
  await run('focus is trapped, Escape closes and focus returns to trigger', async () => {
    await page.getByRole('button', { name: 'Close task journey' }).focus();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator('[role="dialog"]').evaluate(el => el.contains(document.activeElement)));
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.locator('[role="dialog"]').evaluate(el => el.contains(document.activeElement)));
    }
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#open-journey').evaluate(el => el === document.activeElement), true);
    const before = requests.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: {} } })));
    await page.waitForTimeout(400);
    assert.equal(requests.length, before);
  });
  await run('paginated events do not imply a complete current duration', async () => {
    paginated = true;
    await open();
    assert.equal(await page.locator('.journey-metrics dd').nth(3).innerText(), 'Not recorded');
    await page.getByRole('button', { name: 'Load more events' }).click();
    await page.getByText('Returned after the acceptance review.').waitFor();
    assert.equal(await page.locator('.journey-transitions').first().locator('li').count(), 4);
    paginated = false;
  });
  await run('partial session pages retain snapshot totals until reconciliation', async () => {
    sessionsPaginated = true;
    await open();
    await page.getByText(/Time totals are a server snapshot/).waitFor();
    assert.equal(await page.locator('.journey-metrics dd').nth(1).innerText(), '14m 0s');
    await page.getByRole('button', { name: 'Load more sessions' }).click();
    await page.getByText(/Live estimate/).waitFor();
    sessionsPaginated = false;
  });
  await run('background invalidation preserves loaded event pages', async () => {
    paginated = true;
    await open();
    await page.getByRole('button', { name: 'Load more events' }).click();
    await page.getByText('Returned after the acceptance review.').waitFor();
    const count = requests.filter(row => row.path.endsWith('/analytics')).length;
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/tasks/task-a/analytics')),
      page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: {} } }))),
    ]);
    await page.waitForFunction(() => document.querySelector('.journey-toolbar [role="status"]')?.textContent === 'Task activity');
    assert.ok(requests.filter(row => row.path.endsWith('/analytics')).length > count);
    assert.equal(await page.locator('.journey-transitions').first().locator('li').count(), 4);
    paginated = false;
  });
  await run('event bursts during slow refresh coalesce without overlapping snapshots', async () => {
    delay = 900;
    peakAnalyticsInFlight = 0;
    const before = requests.filter(row => row.path.endsWith('/analytics')).length;
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.waitForTimeout(120);
    for (let index = 0; index < 3; index++) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: {} } })));
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2200);
    delay = 0;
    assert.equal(peakAnalyticsInFlight, 1);
    assert.equal(requests.filter(row => row.path.endsWith('/analytics')).length - before, 2);
    measurements.peakConcurrentAnalytics = peakAnalyticsInFlight;
    measurements.slowBurstSnapshotRequests = requests.filter(row => row.path.endsWith('/analytics')).length - before;
  });
  await run('many subtasks stay lazy, keep stable closed rows and do not add per-child requests', async () => {
    childCount = 250;
    const before = requests.length;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    assert.equal(await page.locator('.journey-child').count(), 250);
    assert.equal(await page.locator('.journey-child-body').count(), 0);
    const businessReads = requests.slice(before).filter(row => /\/tasks\//.test(row.path));
    assert.equal(businessReads.length, 4);
    measurements.readsFor250Subtasks = businessReads.length;
    await page.evaluate(() => {
      window.closedRowMutations = 0;
      window.closedRowObserver = new MutationObserver(records => { window.closedRowMutations += records.length; });
      document.querySelectorAll('.journey-child').forEach((row, index) => { if (index) window.closedRowObserver.observe(row, { subtree: true, childList: true, characterData: true }); });
    });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.closedRowMutations), 0);
    await page.evaluate(() => window.closedRowObserver.disconnect());
    const last = page.locator('.journey-child > summary').last();
    await last.focus();
    await page.keyboard.press('Enter');
    await page.locator('.journey-child-body').waitFor();
    assert.equal(await page.locator('.journey-child-body').count(), 1);
    await page.keyboard.press('Space');
    await page.locator('.journey-child-body').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 320, height: 740 });
    const bounds = await page.locator('.journey-scroll').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(bounds.content <= bounds.width + 1);
    childCount = 1;
  });
  await run('timer sessions are ordered by actual start, locally paged and retain correction evidence', async () => {
    sessionBatch = true;
    await open();
    await page.locator('.journey-child > summary').click();
    await page.locator('.journey-child .journey-sessions > summary').click();
    await page.waitForFunction(() => document.querySelectorAll('.journey-session').length === 25);
    assert.equal(await page.locator('.journey-session').count(), 25);
    const starts = await page.locator('.journey-session-dates > div:first-child time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')));
    assert.deepEqual(starts, [...starts].sort());
    await page.getByRole('button', { name: 'Show more loaded sessions' }).click();
    assert.equal(await page.locator('.journey-session').count(), 30);
    assert.ok((await page.locator('.journey-sessions').last().innerText()).includes('Corrected with preserved originals'));
    assert.ok((await page.locator('.journey-sessions').last().innerText()).includes('2026-10-19 08:59:00 UTC'));
    sessionBatch = false;
  });
  await run('all eleven backend statuses render exactly one active main-task stage', async () => {
    for (const status of ['WAITING_FOR_REQUIREMENT', 'TODO', 'IN_PROGRESS', 'BUG_FIXING', 'BLOCKED', 'IN_REVIEW', 'ON_HOLD', 'DONE', 'DEPLOYED', 'FAILED', 'GRAVEYARD']) {
      taskStatus = status;
      await page.getByRole('button', { name: 'Refresh task journey' }).click();
      const active = page.locator('[aria-labelledby="journey-workflow-title"] [aria-current="step"]');
      await page.waitForFunction(expected => document.querySelector('.journey-heading .journey-status')?.textContent?.replaceAll(' ', '_').toUpperCase() === expected, status);
      assert.equal(await active.count(), 1);
    }
    taskStatus = 'IN_PROGRESS';
  });
  await run('long unbroken titles remain inside the 320px popup', async () => {
    longText = true;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('heading', { name: 'UnbrokenLongTaskTitle'.repeat(35) }).waitFor();
    const dimensions = await page.locator('.journey-scroll').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.width + 1);
    longText = false;
  });
  await run('stale responses cannot replace a newer task scope', async () => {
    delay = 700;
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.evaluate(() => window.journeyFixture.setTask('task-b'));
    delay = 0;
    await page.getByRole('heading', { name: 'Second authorized task' }).waitFor();
    await page.waitForTimeout(900);
    assert.equal(await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).count(), 0);
  });
  await run('foreign realtime notices are ignored and scoped notices refresh', async () => {
    const before = requests.filter(row => row.path.endsWith('/analytics')).length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'foreign', payload: {} } })));
    await page.waitForTimeout(400);
    assert.equal(requests.filter(row => row.path.endsWith('/analytics')).length, before);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: { task_id: 'task-b' } } })));
    await page.waitForTimeout(600);
    assert.ok(requests.filter(row => row.path.endsWith('/analytics')).length > before);
  });
  await run('permission revocation clears already rendered private history', async () => {
    mode = 'denied';
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.journey-heading').count(), 0);
    assert.equal(await page.locator('.journey-transitions').count(), 0);
    const before = requests.length;
    await page.evaluate(() => { window.journeyProbe.poll(); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(400);
    assert.equal(requests.length, before);
    mode = 'normal';
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Second authorized task' }).waitFor();
  });
  await run('tenant switching never retains the previous scope history', async () => {
    mode = 'denied';
    await page.evaluate(() => window.journeyFixture.switchTenant());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.journey-heading').count(), 0);
  });
  await run('legacy, empty and unavailable states', async () => {
    mode = 'legacy'; await open();
    await page.getByText(/History incomplete/).waitFor();
    mode = 'empty';
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('region', { name: 'Task transitions' }).getByText('No recorded status transitions.').waitFor();
    mode = 'unavailable';
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByText('Task history is not available on this server yet.').waitFor();
  });
  await run('invalid server clock and conflicting status snapshots fail visibly instead of rendering blank data', async () => {
    mode = 'normal';
    invalidClock = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.journey-heading').count(), 0);
    invalidClock = false; mismatchedStatus = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.journey-heading').count(), 0);
    mismatchedStatus = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).waitFor();
  });
  await run('stale live estimates pause after 60 seconds without fabricating additional work', async () => {
    const normalNow = await page.evaluate(() => performance.now());
    await page.evaluate(() => { const actual = performance.now.bind(performance); Object.defineProperty(performance, 'now', { configurable: true, value: () => actual() + 70000 }); });
    await page.getByText(/Live estimate paused/).waitFor();
    const total = await page.locator('.journey-metrics dd').nth(1).innerText();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.journey-metrics dd').nth(1).innerText(), total);
    assert.ok(normalNow > 0);
  });
  await run('repeated open and close removes polling, clock intervals and scoped listeners', async () => {
    await page.goto(`${base}/__journey-test`);
    await page.getByRole('button', { name: 'Open journey' }).waitFor();
    const baseline = await page.evaluate(() => window.journeyProbe.state());
    for (let index = 0; index < 3; index++) {
      await page.getByRole('button', { name: 'Open journey' }).click();
      await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).waitFor();
      const active = await page.evaluate(() => window.journeyProbe.state());
      assert.equal(active.notices, baseline.notices + 1);
      assert.equal(active.intervals.length, baseline.intervals.length + 2);
      await page.getByRole('button', { name: 'Close task journey' }).click();
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => window.journeyProbe.state()), baseline);
    }
  });
  await run('closing during a queued slow refresh cannot start orphan requests', async () => {
    await page.getByRole('button', { name: 'Open journey' }).click();
    await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).waitFor();
    delay = 600;
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: {} } })));
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Close task journey' }).click();
    const before = requests.length;
    await page.waitForTimeout(1300);
    assert.equal(requests.length, before);
    delay = 0;
  });
  await run('task details opens the journey without replacing status editing', async () => {
    mode = 'normal';
    await page.goto(`${base}/__journey-test?details`);
    await page.getByRole('button', { name: 'Open task status journey' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Close task journey' }).click();
    assert.equal(await page.getByRole('button', { name: 'Open task status journey' }).count(), 1);
    const selector = page.getByRole('combobox', { name: 'Status', exact: true });
    assert.equal(await selector.locator('option').count(), 11);
    await selector.selectOption('BUG_FIXING');
    const update = page.getByRole('button', { name: 'Update Task', exact: true });
    assert.equal(await update.isEnabled(), true);
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/tasks/task-a')),
      update.click(),
    ]);
    assert.equal(await selector.inputValue(), 'BUG_FIXING');
    await page.getByRole('button', { name: 'Open task status journey' }).click();
    await page.waitForFunction(() => document.querySelector('.journey-heading .journey-status')?.textContent === 'Bug Fixing');
    await page.getByRole('button', { name: 'Close task journey' }).click();
    taskStatus = 'IN_PROGRESS';
  });
  await run('report: lazy loading, recorded identities and reopened completion metrics', async () => {
    mode = 'normal'; childCount = 1; longText = false; reportPaged = false;
    const start = requests.length;
    await open();
    assert.equal(requests.slice(start).filter(row => row.path.includes('/execution-report')).length, 0);
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    assert.equal(requests.slice(start).filter(row => row.path.includes('/execution-report')).length, 4);
    await page.waitForTimeout(1100);
    assert.equal(requests.slice(start).filter(row => row.path.includes('/execution-report')).length, 4);
    const facts = page.locator('.task-execution-report .journey-heading');
    assert.ok((await facts.innerText()).includes('Asha Reviewer'));
    assert.ok((await facts.innerText()).includes('Completions / Reopens\n1 / 1'));
    assert.ok((await facts.locator('.report-facts > div').filter({ hasText: 'Final completion' }).innerText()).includes('Not recorded'));
    await page.getByText('1 session deletion events recorded.', { exact: false }).waitFor();
    assert.equal(await page.locator('.report-evidence > li').count(), 5);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.journey-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: new URL('execution-summary-desktop.png', output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
  });
  await run('report: completion attempts preserve rejected history in chronological order', async () => {
    const rows = page.locator('.report-completions > li');
    assert.equal(await rows.count(), 2);
    assert.ok((await rows.nth(0).innerText()).includes('Attempt 1'));
    assert.ok((await rows.nth(1).innerText()).includes('Attempt 2'));
    await page.getByText('Review: Please include a clearer screenshot.').waitFor();
    await page.locator('.task-execution-report .journey-child > summary').click();
    const child = page.locator('.task-execution-report .journey-child');
    await child.locator('.journey-child-body').waitFor();
    assert.ok((await child.innerText()).includes('Creator\nNot recorded'));
    await child.locator('.journey-sessions > summary').click();
    await child.locator('.journey-session').first().waitFor();
    assert.equal(await child.locator('.journey-session').count(), 1);
    assert.ok((await child.innerText()).includes('Linked pause: Not recorded'));
  });
  await run('report: private image preview and object URL cleanup', async () => {
    await page.getByRole('button', { name: 'Preview screenshot.png', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'screenshot.png', exact: true });
    await preview.waitFor();
    await preview.locator('img').evaluate(async image => { await image.decode(); });
    assert.ok(await preview.locator('img').evaluate(image => image.naturalWidth > 0));
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 1);
    await page.screenshot({ path: new URL('report-image-preview.png', output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
    assert.equal(await page.getByRole('dialog').count(), 1);
  });
  await run('report: secure download and missing, deleted, unverified evidence states', async () => {
    for (const filename of ['missing-proof.png', 'old-file.png', 'Unverified attachment link']) {
      const row = page.locator('.report-evidence > li').filter({ hasText: filename });
      assert.equal(await row.locator('button').count(), 0);
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download screenshot.png', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'screenshot.png');
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
    fileDenied = true;
    await page.getByRole('button', { name: 'Preview screenshot.png', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The file is unavailable' }).waitFor();
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
    fileDenied = false;
  });
  await run('report: validated PDF opens in native viewer with no persistent object URLs', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Preview acceptance.pdf', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'acceptance.pdf', exact: true });
    await preview.waitFor();
    assert.equal(await preview.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
    assert.ok((await preview.locator('iframe').getAttribute('src')).startsWith('blob:'));
    await page.waitForTimeout(3000);
    measurements.pdfFrames = page.frames().map(frame => ({ url: frame.url().split('?')[0] }));
    const viewer = page.frames().find(frame => frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
    assert.ok(viewer, 'Native PDF viewer frame must exist');
    await viewer.locator('pdf-viewer').waitFor();
    await page.screenshot({ path: new URL('report-pdf-preview.png', output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
    await page.getByRole('button', { name: 'Close evidence preview' }).click();
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
  });
  await run('report: pagination and refresh preserve loaded evidence and completion attempts', async () => {
    reportPaged = true;
    await open();
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    assert.equal(await page.locator('.report-completions > li').count(), 1);
    await page.getByRole('button', { name: 'Load more completion attempts' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.report-completions > li').length === 2);
    await page.getByRole('button', { name: 'Load more proof files' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.report-evidence > li').length === 5);
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.report-completions > li').length === 2 && document.querySelectorAll('.report-evidence > li').length === 5);
    reportPaged = false;
  });
  await run('report: responsive large datasets, keyboard tabs and reduced motion', async () => {
    childCount = 250; longText = true;
    await page.goto(`${base}/__journey-test`);
    await page.getByRole('button', { name: 'Open journey' }).click();
    const tab = page.getByRole('tab', { name: 'Journey', exact: true });
    await tab.focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    assert.equal(await page.locator('.task-execution-report .journey-child').count(), 25);
    await page.getByRole('button', { name: 'Show more subtasks' }).click();
    assert.equal(await page.locator('.task-execution-report .journey-child').count(), 50);
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const dimensions = await page.locator('.journey-scroll').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width + 1, JSON.stringify({ width, ...dimensions }));
      await page.locator('.journey-scroll').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: new URL(`execution-report-${width}.png`, output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.task-execution-report').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    longText = false; childCount = 1;
  });
  await run('report: errors, recovery, realtime invalidation and close cleanup', async () => {
    reportError = true;
    await open();
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load the execution report.' }).waitFor();
    reportError = false;
    await page.getByRole('button', { name: 'Retry report' }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    reportMismatched = true;
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('alert').filter({ hasText: 'Task state changed while loading.' }).waitFor();
    assert.equal(await page.locator('.report-evidence').count(), 0);
    reportMismatched = false;
    await page.getByRole('button', { name: 'Retry report' }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    const start = requests.filter(row => row.path.endsWith('/execution-report')).length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'reviewer', tenantId: 'tenant-a', payload: { task_id: 'task-a' } } })));
    await page.waitForFunction(() => document.querySelector('.journey-toolbar [role="status"]')?.textContent === 'Task activity');
    await page.waitForTimeout(500);
    assert.ok(requests.filter(row => row.path.endsWith('/execution-report')).length > start);
    await page.getByRole('button', { name: 'Preview screenshot.png', exact: true }).click();
    await page.getByRole('dialog', { name: 'screenshot.png', exact: true }).waitFor();
    await page.evaluate(() => window.journeyFixture.close());
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
  });
  await run('report: normal summary and gallery fit mobile and light theme', async () => {
    await open();
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.journey-scroll').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: new URL(`execution-summary-${width}.png`, output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
      await page.getByRole('heading', { name: 'Evidence gallery', exact: true }).scrollIntoViewIfNeeded();
      const size = await page.locator('.journey-scroll').evaluate(el => [el.clientWidth, el.scrollWidth]);
      assert.ok(size[1] <= size[0] + 1);
      await page.screenshot({ path: new URL(`execution-evidence-${width}.png`, output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
    }
    await page.evaluate(() => { for (const [key, value] of Object.entries({ '--color-bg-primary': '#fff', '--color-surface': '#f6f8fa', '--color-border-color': '#cbd5e1', '--color-text-primary': '#111827', '--color-text-secondary': '#475569' })) document.documentElement.style.setProperty(key, value); });
    assert.ok((await page.locator('.report-evidence > li').first().innerText()).includes('Dev Kumar'));
    await page.screenshot({ path: new URL('execution-evidence-light.png', output).pathname.replace(/^\/(?=[A-Z]:)/, '') });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await run('report: revocation clears visible files and stale responses cannot cross task scope', async () => {
    await page.getByRole('button', { name: 'Preview screenshot.png', exact: true }).click();
    await page.getByRole('dialog', { name: 'screenshot.png', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close evidence preview' }).click();
    mode = 'denied';
    await page.getByRole('button', { name: 'Refresh task journey' }).click();
    await page.getByRole('alert').filter({ hasText: 'no longer accessible' }).waitFor();
    assert.equal(await page.locator('.report-evidence').count(), 0);
    assert.equal(await page.evaluate(() => window.reportProbe.objectUrls()), 0);
    mode = 'normal';
    await open();
    delay = 700;
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.waitForTimeout(50);
    await page.evaluate(() => window.journeyFixture.setTask('task-b'));
    await page.getByRole('heading', { name: 'Second authorized task' }).waitFor();
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
    assert.ok((await page.locator('.task-execution-report .journey-heading').innerText()).includes('Task task-b'));
    assert.equal(await page.getByRole('heading', { name: 'Release review: acceptance and delivery' }).count(), 0);
    delay = 0;
  });
  await run('review: forged event/session payloads and stale task metadata fail closed', async () => {
    for (const variant of ['event', 'session', 'metadata']) {
      foreignEvent = variant === 'event'; foreignSession = variant === 'session'; staleTaskMetadata = variant === 'metadata';
      await page.goto(`${base}/__journey-test`);
      await page.getByRole('button', { name: 'Open journey' }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.locator('.journey-heading').count(), 0);
    }
    foreignEvent = false; foreignSession = false; staleTaskMetadata = false;
  });
  await run('review: evidence with the wrong subtask association is never rendered', async () => {
    await open();
    foreignEvidence = true;
    await page.getByRole('tab', { name: 'Execution report', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to load the execution report.' }).waitFor();
    assert.equal(await page.locator('.report-evidence').count(), 0);
    foreignEvidence = false;
    await page.getByRole('button', { name: 'Retry report' }).click();
    await page.getByRole('heading', { name: 'Execution summary', exact: true }).waitFor();
  });
  await run('review: selected tab text retains readable light-theme contrast', async () => {
    await page.evaluate(() => { for (const [key, value] of Object.entries({ '--color-bg-primary': '#fff', '--color-surface': '#f6f8fa', '--color-border-color': '#cbd5e1', '--color-text-primary': '#111827', '--color-text-secondary': '#475569' })) document.documentElement.style.setProperty(key, value); });
    const ratio = await page.locator('[role="tab"][aria-selected="true"]').evaluate(element => {
      const luminance = value => {
        const [r, g, b] = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const style = getComputedStyle(element);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    assert.ok(ratio >= 4.5, `Selected tab text contrast ${ratio}`);
  });
  await run('logout closes the private popup and removes its history', async () => {
    await open();
    await page.evaluate(() => window.journeyFixture.logout());
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.journey-heading').count(), 0);
  });
  await run('no business writes or additional sockets, no browser exceptions', async () => {
    assert.ok(requests.every(row => row.method === 'GET' || row.path === '/api/auth/logout' || (row.method === 'PATCH' && row.path === '/api/tasks/task-a')));
    assert.equal(requests.filter(row => row.method === 'PATCH').length, 1);
    assert.equal(sockets.filter(url => /\/ws\/tasks|\/socket\.io/.test(url)).length, 0);
    assert.deepEqual(pageErrors, []);
  });
} finally {
  await writeFile(new URL(process.env.ZEAPLAY_JOURNEY_REPORT || 'browser-results.json', output), JSON.stringify({ results, measurements, pageErrors, sockets, requests }, null, 2));
  await browser.close();
}
if (failures.length) process.exitCode = 1;
