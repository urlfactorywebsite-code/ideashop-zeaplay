import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_RESTORE_TEST_URL || 'http://127.0.0.1:6302';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const output = new URL(process.env.ZEAPLAY_RESTORE_OUTPUT || '../../docs/archive-restore/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const results = [], errors = [], writes = [], authRoles = [];
let clients = [], projects = [], restoreFailure = null, restoreDelay = 0, listDelay = 0, dashboardDelay = {};
let onDelayedList = null;
let contactScenario = false;
const stamp = '2026-10-20T05:00:00Z';
const customer = (i, status = 'ACTIVE') => ({ id: `client-${i}`, tenant_id: 'tenant', company_name: `Client ${i}`, normalized_company_name: `client ${i}`,
  status, notes: 'Retained company notes', created_at: stamp, updated_at: stamp, archived_at: status === 'ARCHIVED' ? stamp : null });
const project = (i, status = 'ACTIVE', manager = 'actor') => ({ id: `project-${i}`, tenant_id: 'tenant', client_id: 'client-1', name: `Project ${i}`, normalized_name: `project ${i}`,
  description: 'Retained project details', status, client: { id: 'client-1', company_name: 'Client 1', status: 'ACTIVE' },
  members: [{ id: `membership-${i}`, user_id: manager, name: 'Assigned manager', email: 'manager@example.test', role: 'MANAGER', user_role: 'manager', status: 'ACTIVE' }],
  task_count: 1, created_at: stamp, updated_at: stamp, archived_at: status === 'ARCHIVED' ? stamp : null });
const reset = () => { clients = [customer(1), customer(2, 'ARCHIVED')]; projects = [project(1), project(2, 'ARCHIVED')]; restoreFailure = null; restoreDelay = 0; listDelay = 0; dashboardDelay = {}; };
reset();
await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('vee_access_token', 'synthetic-local-token'); });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname === '/__restore-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#030712;color:#e5e7eb;font:14px Arial}button,input,select,textarea{font:inherit}button{cursor:pointer}svg{width:20px;height:20px}#root{height:100vh}h1,h2,h3,p{margin-top:0}td,th{padding:8px}input,select,textarea{max-width:100%}</style></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/archiveRestoreFixture.tsx"></script></body></html>` });
  if (!url.pathname.startsWith('/api/')) return route.continue();
  const method = route.request().method();
  const role = new URL(route.request().frame().page().url()).searchParams.get('role') || 'owner';
  if (url.pathname === '/api/auth/me') { authRoles.push(role); return route.fulfill({ json: { id: 'actor', tenant_id: 'tenant', name: 'Actor', email: 'actor@example.test', status: 'ACTIVE', role, unlocked_achievement_ids: [], claimed_reward_ids: [] } }); }
  if (url.pathname === '/api/users') return route.fulfill({ json: [{ id: 'actor', tenant_id: 'tenant', name: 'Actor', email: 'actor@example.test', role: 'manager', status: 'ACTIVE' }] });
  if (url.pathname.match(/\/clients\/[^/]+\/contacts$/)) {
    if (!contactScenario) return route.fulfill({ json: { items: [], total: 0, total_pages: 1 } });
    const id = url.pathname.split('/')[3];
    if (id === 'client-1' && clients[0].status === 'ARCHIVED') await new Promise(resolve => setTimeout(resolve, 300));
    return route.fulfill({ json: { items: [{ id: `contact-${id}`, first_name: id, display_name: `Contact for ${id}`,
      status: 'ACTIVE', created_at: stamp, updated_at: stamp, clients: [] }], total: 1, total_pages: 1 } });
  }
  if (url.pathname.endsWith('/task-dashboard')) {
    const record = projects.find(p => url.pathname.includes(p.id));
    if (dashboardDelay[record.id]) await new Promise(resolve => setTimeout(resolve, dashboardDelay[record.id]));
    return route.fulfill({ json: { project: record, summary: { status_counts: {}, derived_status_counts: {}, subtask_status_counts: {}, priority_counts: {}, workload: [] }, items: [], total: 0, page: 1, page_size: 10, total_pages: 1, status_policy: `Policy for ${record.id}` } });
  }
  const transition = url.pathname.match(/^\/api\/(clients|projects)\/([^/]+)\/(restore|archive)$/);
  if (transition) {
    writes.push({ path: url.pathname, method });
    if (restoreDelay) await new Promise(resolve => setTimeout(resolve, restoreDelay));
    if (restoreFailure?.network) return route.abort('failed');
    if (transition[3] === 'restore' && restoreFailure) return route.fulfill({ status: restoreFailure.status, json: { detail: restoreFailure.message } });
    const record = (transition[1] === 'clients' ? clients : projects).find(row => row.id === transition[2]);
    record.status = transition[3] === 'restore' ? 'ACTIVE' : 'ARCHIVED';
    record.archived_at = record.status === 'ACTIVE' ? null : stamp;
    return route.fulfill({ json: record });
  }
  const detail = url.pathname.match(/^\/api\/(clients|projects)\/([^/]+)$/);
  if (detail && method === 'PATCH') {
    writes.push({ path: url.pathname, method });
    const row = (detail[1] === 'clients' ? clients : projects).find(row => row.id === detail[2]);
    Object.assign(row, route.request().postDataJSON());
    return route.fulfill({ json: row });
  }
  if (['/api/clients', '/api/projects'].includes(url.pathname)) {
    let rows = structuredClone(url.pathname.endsWith('clients') ? clients : projects);
    const status = url.searchParams.get('status'), q = url.searchParams.get('q')?.toLowerCase();
    rows = rows.filter(row => (!status || row.status === status) && (!q || (row.company_name || row.name).toLowerCase().includes(q)));
    const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('page_size') || 10), total = rows.length;
    const response = { items: rows.slice((page - 1) * size, page * size), total, page, page_size: size, total_pages: Math.max(1, Math.ceil(total / size)) };
    if (listDelay) { onDelayedList?.(); await new Promise(resolve => setTimeout(resolve, listDelay)); }
    return route.fulfill({ json: response });
  }
  return route.fulfill({ status: 404, json: { detail: 'No fixture route' } });
});
const open = async (kind, role = 'owner') => {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/__restore-test?module=${kind}s&role=${role}`);
  await page.getByRole('heading', { name: `${kind[0].toUpperCase()+kind.slice(1)}s`, exact: true }).waitFor();
  await page.getByRole('combobox', { name: `${kind[0].toUpperCase()+kind.slice(1)} status` }).waitFor();
  return page;
};
const filter = (page, kind, status) => page.getByRole('combobox', { name: `${kind[0].toUpperCase()+kind.slice(1)} status` }).selectOption(status);
try {
  for (const kind of ['client', 'project']) {
    reset();
    const writesBefore = writes.length;
    const page = await open(kind), title = kind === 'client' ? 'Client' : 'Project', name = `Restore ${title}`;
    await page.getByRole('button', { name: 'Archive', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
    await filter(page, kind, 'ARCHIVED');
    await page.getByRole('button', { name, exact: true }).waitFor();
    if (kind === 'client') assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0);
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${name}?` });
    await dialog.getByText(`${title} 2`, { exact: true }).waitFor();
    assert.equal(await dialog.evaluate((node, name) => (node.getAttribute('aria-describedby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ').includes(name), `${title} 2`), true);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(writes.length, writesBefore);
    await page.getByRole('button', { name, exact: true }).click();
    restoreDelay = 300;
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Restoring…' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Restoring…' }).isDisabled(), true);
    await page.getByText(`${title} restored.`, { exact: true }).waitFor();
    await page.getByText(kind === 'project' ? 'No projects found.' : 'No clients found', { exact: true }).waitFor();
    assert.equal(writes.slice(writesBefore).filter(row => row.path.endsWith('/restore')).length, 1);
    await filter(page, kind, 'ACTIVE');
    const search = page.getByPlaceholder(kind === 'client' ? 'Search clients' : 'Search projects or clients');
    await search.fill(`${title} 2`);
    await page.getByRole('heading', { name: `${title} 2`, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
    results.push(`${title}: archived discovery, named confirmation, cancel, loading, restore, active filter and search`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('heading', { name: `Edit ${title}`, exact: true }).waitFor();
    await page.getByRole('button', { name: kind === 'project' ? 'Save Project' : 'Save Changes', exact: true }).click();
    await page.getByText(`${title} updated.`, { exact: true }).waitFor();
    results.push(`${title}: existing Edit and save work on the restored record`);
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByText(`${title} archived.`, { exact: true }).waitFor();
    await filter(page, kind, 'ARCHIVED');
    await page.getByRole('button', { name, exact: true }).waitFor();
    results.push(`${title}: existing Archive action still works after restoration`);
    await page.close();
  }
  for (const kind of ['client', 'project']) {
    reset(); const page = await open(kind); const title = kind === 'client' ? 'Client' : 'Project';
    await filter(page, kind, 'ARCHIVED');
    await page.getByRole('button', { name: `Restore ${title}`, exact: true }).click();
    for (const failure of [{ status: 403, message: 'Management access required' }, { status: 404, message: `${title} not found` },
      { status: 409, message: kind === 'client' ? 'An active client with this company name already exists' : 'Restore the linked client before restoring this project.' },
      { status: 503, message: 'Temporary network failure' }]) {
      restoreFailure = failure;
      await page.getByRole('dialog').getByRole('button', { name: `Restore ${title}`, exact: true }).click();
      await page.getByRole('alert').filter({ hasText: failure.message }).waitFor();
      assert.equal(await page.getByText(`${title} restored.`, { exact: true }).count(), 0);
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.getByRole('dialog').locator('.restore-panel').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
    await page.screenshot({ path: new URL(`${kind}-mobile.png`, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.waitForFunction(text => document.activeElement?.textContent?.trim() === text, `Restore ${title}`);
    results.push(`${title}: denied/missing/conflict/network errors, no premature success, 320px dialog, keyboard focus recovery`);
    await page.close();
  }
  for (const kind of ['client', 'project']) {
    reset(); const page = await open(kind, 'user'); await filter(page, kind, 'ARCHIVED');
    await page.getByRole('heading', { name: `${kind === 'client' ? 'Client' : 'Project'} 2`, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Restore|Archive|Edit/ }).count(), 0);
    results.push(`${kind}: regular-user restore actions hidden`); await page.close();
  }
  reset(); projects[1].members[0].user_id = 'other-manager';
  const unassigned = await open('project', 'manager'); await filter(unassigned, 'project', 'ARCHIVED');
  await unassigned.getByRole('heading', { name: 'Project 2', exact: true }).waitFor();
  assert.equal(await unassigned.getByRole('button', { name: 'Restore Project', exact: true }).count(), 0);
  results.push('Project: manager without project-manager membership cannot restore'); await unassigned.close();
  for (const kind of ['client', 'project']) {
    reset(); const collection = kind === 'client' ? clients : projects;
    collection.splice(0, collection.length, ...Array.from({ length: 11 }, (_, i) => kind === 'client' ? customer(i + 1, 'ARCHIVED') : project(i + 1, 'ARCHIVED')));
    const page = await open(kind); await filter(page, kind, 'ARCHIVED');
    await page.getByRole('button', { name: 'Next', exact: true }).first().click();
    await page.getByText('Page 2 of 2', { exact: true }).waitFor();
    await page.getByRole('button', { name: `Restore ${kind === 'client' ? 'Client' : 'Project'}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Restore (Client|Project)$/, exact: true }).click();
    await page.getByText('Page 1 of 1', { exact: true }).waitFor();
    results.push(`${kind}: restoring last row on last page clamps pagination without reload`); await page.close();
  }
  for (const kind of ['client', 'project']) {
    reset(); const page = await open(kind); listDelay = 350;
    const oldRequest = page.waitForRequest(request => request.url().includes(`/${kind}s?`) && request.url().includes('status=ARCHIVED'));
    await filter(page, kind, 'ARCHIVED'); await oldRequest; listDelay = 0;
    await filter(page, kind, 'ACTIVE');
    await page.getByRole('heading', { name: `${kind === 'client' ? 'Client' : 'Project'} 1`, exact: true }).waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.getByRole('button', { name: /^Restore (Client|Project)$/ }).count(), 0);
    results.push(`${kind}: delayed filter response cannot replace the current active selection`); await page.close();
  }
  reset(); dashboardDelay = { 'project-1': 650 };
  const dashboard = await open('project'); await filter(dashboard, 'project', 'ARCHIVED');
  await dashboard.getByText('Policy for project-2', { exact: true }).waitFor();
  await dashboard.waitForTimeout(850);
  assert.equal(await dashboard.getByText('Policy for project-1', { exact: true }).count(), 0);
  results.push('Project: stale task dashboard cannot cross the selected project'); await dashboard.close();
  for (const kind of ['client', 'project']) {
    reset(); const page = await open(kind); await filter(page, kind, 'ARCHIVED');
    const name = `Restore ${kind === 'client' ? 'Client' : 'Project'}`;
    await page.getByRole('button', { name, exact: true }).waitFor();
    listDelay = 450;
    const oldStarted = new Promise(resolve => { onDelayedList = resolve; });
    await filter(page, kind, ''); await oldStarted; listDelay = 0; onDelayedList = null;
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
    await page.getByText(`${kind === 'client' ? 'Client' : 'Project'} restored.`, { exact: true }).waitFor();
    await page.waitForTimeout(550);
    await filter(page, kind, 'ACTIVE');
    await page.getByRole('heading', { name: `${kind === 'client' ? 'Client' : 'Project'} 2`, exact: true }).waitFor();
    await filter(page, kind, ''); await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
    results.push(`${kind}: pre-restore requests cannot repopulate invalidated list caches`); await page.close();
  }
  reset(); const offline = await open('client'); await filter(offline, 'client', 'ARCHIVED');
  await offline.getByRole('button', { name: 'Restore Client', exact: true }).click(); restoreFailure = { network: true };
  const failed = offline.waitForEvent('requestfailed', request => request.url().endsWith('/restore'));
  await offline.getByRole('dialog').getByRole('button', { name: 'Restore Client', exact: true }).click(); await failed;
  await offline.getByRole('alert').waitFor();
  assert.equal(await offline.getByText('Client restored.', { exact: true }).count(), 0);
  results.push('Client: transport disconnect retains the confirmation and offers a safe retry'); await offline.close();
  reset(); contactScenario = true; clients = [customer(1), customer(2)];
  const contacts = await open('client'); await contacts.getByText('Contact for client-1', { exact: true }).waitFor();
  contacts.once('dialog', dialog => dialog.accept());
  await contacts.getByRole('button', { name: 'Archive', exact: true }).last().click();
  await contacts.getByRole('heading', { name: 'Client 2', exact: true }).waitFor();
  await contacts.waitForTimeout(500);
  assert.equal(await contacts.getByText('Contact for client-1', { exact: true }).count(), 0);
  await contacts.getByText('Contact for client-2', { exact: true }).waitFor();
  results.push('Client: archive selection changes cannot display another client contacts'); await contacts.close();
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('browser.json', output), JSON.stringify({ results, errors, writes, transport: 'Mocked HTTP with real pages, adapter and Headless UI dialog' }, null, 2));
  await browser.close();
}
for (const result of results) console.log(`PASS ${result}`);
