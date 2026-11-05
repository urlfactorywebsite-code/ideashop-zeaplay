// Real browser -> Vite proxy -> rebuilt Linux API -> isolated PostgreSQL.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const runtime = process.env.ZEAPLAY_RESTORE_RUNTIME;
if (!runtime) throw new Error('Caller-owned synthetic runtime directory required');
const ready = JSON.parse(await readFile(`${runtime}/ready.json`, 'utf8'));
if (!ready.schema.startsWith('restore_browser_')) throw new Error('Synthetic schema required');
const base = 'http://127.0.0.1:6302', backend = 'http://127.0.0.1:6315';
const output = new URL('../../docs/archive-restore-audit/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(`${runtime}/tailwind.js`, 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [], errors = [], requests = [], results = [];
const headers = role => ({ Authorization: `Bearer ${ready.tokens[role]}` });
async function context(role, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(ctx);
  await ctx.addInitScript(token => { localStorage.clear(); localStorage.setItem('vee_access_token', token); }, ready.tokens[role]);
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__audit-tailwind.js') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
    if (url.pathname === '/__restore-e2e') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/__audit-tailwind.js"></script><script>tailwind.config={darkMode:'class'}</script><style>html,body,#root{height:100%;margin:0}body{background:#030712}</style></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/archiveRestoreFixture.tsx"></script></body></html>` });
    // API calls continue to the real local proxy. No API response is mocked.
    return route.continue();
  });
  return ctx;
}
async function open(ctx, kind) {
  const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) requests.push({ method: response.request().method(), path: url.pathname, status: response.status() }); });
  await page.goto(`${base}/__restore-e2e?module=${kind}s`);
  await page.getByRole('heading', { name: kind === 'project' ? 'Projects' : 'Clients', exact: true }).waitFor();
  return page;
}
async function filter(page, kind, value) { await page.getByRole('combobox', { name: kind === 'project' ? 'Project status' : 'Client status' }).selectOption(value); }
async function restore(page, kind) {
  const title = kind === 'project' ? 'Project' : 'Client';
  await page.getByRole('button', { name: `Restore ${title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Restore ${title}?` });
  await dialog.locator('.restore-panel').waitFor();
  await dialog.getByRole('button', { name: `Restore ${title}`, exact: true }).click();
  await page.getByRole('status').filter({ hasText: `${title} restored.` }).waitFor();
}
async function archive(page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
}
const snapshot = async ctx => {
  const response = await ctx.request.get(`${backend}/__audit__/snapshot`, { headers: headers('owner') });
  assert.equal(response.status(), 200); return response.json();
};
function preserve(before, after) {
  for (const [name, rows] of Object.entries(before.tables)) {
    if (name === 'audit_events') continue;
    const clean = data => ['clients', 'projects'].includes(name)
      ? data.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['updated_at', 'updated_by_id'].includes(key)))) : data;
    assert.deepEqual(clean(after.tables[name]), clean(rows), `Preserved ${name}`);
  }
  assert.equal(after.blob_sha256, before.blob_sha256);
}
try {
  const owner = await context('owner');
  const before = await snapshot(owner);
  await writeFile(new URL('live-before.json', output), JSON.stringify(before, null, 2));
  const p = await open(owner, 'project');
  await p.getByRole('heading', { name: 'Audit Project', exact: true }).waitFor();
  await archive(p);
  await p.getByRole('status').filter({ hasText: 'Project archived.' }).waitFor(); await p.close();
  const c = await open(owner, 'client');
  await c.getByRole('heading', { name: 'Audit Client 1', exact: true }).waitFor();
  await c.getByText('Audit Contact 1', { exact: true }).waitFor();
  await archive(c);
  await c.getByRole('heading', { name: 'Audit Client 2', exact: true }).waitFor();
  await c.getByText('Audit Contact 2', { exact: true }).waitFor();
  assert.equal(await c.getByText('Audit Contact 1', { exact: true }).count(), 0); await c.close();
  results.push('Real archive operations and correct next-client contact association');
  const blocked = await open(owner, 'project'); await filter(blocked, 'project', 'ARCHIVED');
  await blocked.getByRole('button', { name: 'Restore Project', exact: true }).click();
  await blocked.getByRole('dialog').getByRole('button', { name: 'Restore Project', exact: true }).click();
  await blocked.getByRole('alert').filter({ hasText: 'Restore the linked client before restoring this project.' }).waitFor();
  assert.equal(await blocked.getByText('Project restored.', { exact: true }).count(), 0);
  await blocked.keyboard.press('Escape'); await blocked.close();
  results.push('Real 409 dependency response without premature success');
  const client = await open(owner, 'client'); await filter(client, 'client', 'ARCHIVED');
  await client.getByRole('button', { name: 'Restore Client', exact: true }).click();
  assert.equal(await client.getByRole('dialog').evaluate(node => (node.getAttribute('aria-describedby') || '').split(/\s+/)
    .map(id => document.getElementById(id)?.textContent || '').join(' ').includes('Audit Client 1')), true);
  for (let index = 0; index < 5; index++) {
    await client.keyboard.press('Tab');
    await client.waitForFunction(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  }
  await client.keyboard.press('Escape');
  await client.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Restore Client');
  await restore(client, 'client');
  await filter(client, 'client', 'ACTIVE');
  await client.getByPlaceholder('Search clients').fill('Audit Client 1');
  await client.getByRole('heading', { name: 'Audit Client 1', exact: true }).waitFor();
  const midway = await snapshot(owner);
  assert.equal(midway.tables.projects[0].status, 'ARCHIVED');
  assert.equal(midway.tables.clients.find(row => row.id === ready.client_id).status, 'ACTIVE');
  await client.close();
  results.push('Owner client restore end to end, Active filter, focus recovery and no cascading project restore');
  const project = await open(owner, 'project'); await filter(project, 'project', 'ARCHIVED');
  await restore(project, 'project'); await filter(project, 'project', 'ACTIVE');
  await project.getByRole('heading', { name: 'Audit Project', exact: true }).waitFor();
  await project.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  const dashboardResponse = await owner.request.get(`${backend}/api/projects/${ready.project_id}/task-dashboard`, { headers: headers('owner') });
  assert.equal(dashboardResponse.status(), 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.task_total, 1);
  assert.equal(dashboard.summary.subtask_total, 2);
  assert.equal(dashboard.summary.completed_subtasks, 1);
  assert.equal(dashboard.summary.total_tracked_seconds, 45);
  assert.equal(dashboard.summary.active_timer_count, 0);
  results.push('Real restored dashboard counts: one task, two subtasks, one complete, 45 tracked seconds, no restarted timer');
  await project.screenshot({ path: new URL('live-project-desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await project.close();
  const after = await snapshot(owner); preserve(before, after);
  assert.equal(after.tables.audit_events.filter(row => row.event_type.endsWith('.restored')).length, 2);
  for (const kind of ['client', 'project']) {
    const history = after.tables.audit_events.filter(row => row.entity_type === kind).sort((a, b) => a.created_at.localeCompare(b.created_at));
    assert.deepEqual(history.map(row => row.event_type), [`${kind}.archived`, `${kind}.restored`]);
    assert.ok(history.every(row => row.actor_id && row.payload.tenant_id === before.tables.clients[0].tenant_id));
    assert.equal(history[0].payload.previous_state.status, 'ACTIVE');
    assert.equal(history[1].payload.previous_state.status, 'ARCHIVED');
  }
  await writeFile(new URL('live-after-owner.json', output), JSON.stringify(after, null, 2));
  results.push('Owner project restore end to end and exact related-record/attachment-byte preservation');
  for (const [kind, id] of [['clients', ready.client_id], ['projects', ready.project_id]]) {
    const url = `${backend}/api/${kind}/${id}/restore`;
    assert.equal((await owner.request.post(url)).status(), 401);
    assert.equal((await owner.request.post(url, { headers: headers('user') })).status(), 403);
    assert.equal((await owner.request.post(url, { headers: headers('foreign') })).status(), 404);
    for (let i = 0; i < 3; i++) assert.equal((await owner.request.post(url, { headers: headers('owner') })).status(), 200);
  }
  assert.equal((await snapshot(owner)).tables.audit_events.length, after.tables.audit_events.length);
  results.push('Real unauthorized, foreign-tenant and repeated idempotent API requests');
  const manager = await context('manager', true);
  await owner.request.post(`${backend}/api/projects/${ready.project_id}/archive`, { headers: headers('owner') });
  const mp = await open(manager, 'project'); await filter(mp, 'project', 'ARCHIVED');
  await restore(mp, 'project'); await mp.close();
  await owner.request.post(`${backend}/api/clients/${ready.client_id}/archive`, { headers: headers('owner') });
  const userContext = await context('user'); const userPage = await open(userContext, 'client'); await filter(userPage, 'client', 'ARCHIVED');
  await userPage.getByRole('heading', { name: 'Audit Client 1', exact: true }).waitFor();
  assert.equal(await userPage.getByRole('button', { name: 'Restore Client', exact: true }).count(), 0); await userPage.close();
  const mc = await open(manager, 'client'); await filter(mc, 'client', 'ARCHIVED');
  await mc.getByRole('button', { name: 'Restore Client', exact: true }).click();
  const modal = mc.getByRole('dialog');
  assert.equal(await modal.locator('.restore-panel').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
  await mc.screenshot({ path: new URL('live-client-mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await modal.getByRole('button', { name: 'Restore Client', exact: true }).click();
  await mc.getByRole('status').filter({ hasText: 'Client restored.' }).waitFor(); await mc.close();
  preserve(before, await snapshot(owner));
  results.push('Assigned manager project and client restores on 390px mobile; ordinary-user actions hidden');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('live-browser.json', output), JSON.stringify({ results, errors, requests,
    api_mocked: false, backend: 'rebuilt Linux API', database: 'isolated PostgreSQL', style: 'existing Tailwind runtime plus application components' }, null, 2));
  for (const ctx of contexts) await ctx.close(); await browser.close();
}
for (const result of results) console.log(`PASS ${result}`);
