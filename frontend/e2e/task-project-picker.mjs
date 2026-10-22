import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_PROJECT_PICKER_TEST_URL || 'http://127.0.0.1:16309';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../docs/task-project-picker/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const cssRuntime = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const calls = [], writes = [], errors = [], results = [];
const projects = Array.from({ length: 131 }, (_, index) => ({ id: `project-${index}`, tenant_id: 'picker-tenant',
  name: `Project ${String(index).padStart(3, '0')}`, normalized_name: `project ${index}`, description: `Design brief ${index}`,
  status: index === 130 ? 'ARCHIVED' : 'ACTIVE', client_id: `client-${index}`,
  client: { id: `client-${index}`, company_name: index === 120 ? 'Late Client Company' : `Company ${index}`, status: 'ACTIVE' },
  members: [{ id: `member-${index}`, user_id: index === 120 ? 'picker-worker' : 'picker-owner', name: 'Project member',
    email: 'member@example.test', role: 'MEMBER', user_role: 'user', status: 'ACTIVE' }], task_count: 0,
  created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: cssRuntime });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__project-picker') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/linkedClientsFixture.tsx"') });
  }
  if (url.pathname === '/api/projects') {
    calls.push(Object.fromEntries(url.searchParams));
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (q === 'failure') return route.fulfill({ status: 503, json: { detail: 'Project search unavailable' } });
    const single = new URL(request.frame().url()).searchParams.has('single');
    const matches = (single ? projects.slice(0, 1) : projects).filter(project => project.status === url.searchParams.get('status')
      && [project.name, project.description, project.client.company_name].some(value => value.toLowerCase().includes(q)));
    const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('page_size'));
    return route.fulfill({ json: { items: matches.slice((page - 1) * size, page * size), page, page_size: size,
      total: matches.length, total_pages: Math.max(1, Math.ceil(matches.length / size)) } });
  }
  if (url.pathname === '/api/tasks' && request.method() === 'POST') {
    writes.push(request.postDataJSON()); return route.fulfill({ json: [] });
  }
  if (url.pathname === '/api/clients') return route.fulfill({ json: { items: [], page: 1, page_size: 10, total: 0, total_pages: 1 } });
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const pass = name => { results.push(name); console.log('PASS: ' + name); };
const trigger = () => page.getByRole('button', { name: 'Project', exact: true });
const search = () => page.getByRole('combobox', { name: 'Search by project or client name...' });
const list = () => page.getByRole('listbox', { name: 'Project', exact: true });
const option = name => list().getByRole('option', { name: new RegExp(name) });
try {
  await page.goto(base + '/__project-picker?projects=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open task selector' }).click();
  await trigger().click(); await expect(search()).toBeFocused();
  await expect(list().getByRole('option')).toHaveCount(25); await expect(list()).toHaveAttribute('aria-multiselectable', 'false');
  await expect(option('Project 000')).toContainText('Company 0');
  await expect(option('Project 000')).toContainText('ACTIVE'); await expect(option('Project 000').getByRole('img')).toContainText('P0');
  await page.screenshot({ path: new URL('desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(list().getByRole('option')).toHaveCount(50);
  pass('Shared dropdown style, search focus, project avatars/client details/status and pagination');
  await search().fill('LATE CLIENT COMPANY'); await expect(option('Project 120')).toBeVisible();
  await option('Project 120').click(); await expect(search()).toHaveCount(0); await expect(trigger()).toBeFocused();
  await expect(trigger()).toContainText('Project 120 - Late Client Company');
  await trigger().press('ArrowDown'); await expect(option('Project 120')).toHaveAttribute('aria-selected', 'true');
  await search().press('Enter'); await expect(trigger()).toContainText('Project 120'); await expect(search()).toHaveCount(0);
  pass('Case-insensitive client search finds projects beyond the former first 100; single selection closes and retains the project');
  await trigger().click(); await search().fill('no-match'); await expect(page.getByText('No projects match your search.')).toBeVisible();
  await search().press('Enter'); await expect(page.getByRole('heading', { name: 'Create Task', exact: true })).toBeVisible();
  await expect(trigger()).toContainText('Project 120');
  await search().fill('failure'); await expect(page.getByRole('alert')).toContainText('Project search unavailable');
  await expect(trigger()).toContainText('Project 120'); await search().press('Escape'); await expect(trigger()).toBeFocused();
  const assignees = page.getByRole('button', { name: 'Assignees', exact: true });
  await assignees.click(); await expect(page.getByRole('listbox', { name: 'Assignees' }).getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('listbox', { name: 'Assignees' })).toContainText('Dev Kumar');
  await page.getByRole('listbox', { name: 'Assignees' }).getByRole('option').click();
  await expect(assignees).toContainText('1 selected');
  await page.getByRole('combobox', { name: 'Search by name, role, email, team...' }).press('Escape');
  await trigger().click(); await search().fill('Project 121'); await expect(option('Project 121')).toBeVisible();
  await search().press('ArrowDown'); await search().press('ArrowUp'); await search().press('Enter');
  await expect(trigger()).toContainText('Project 121 - Company 121'); await expect(assignees).toContainText('0 selected');
  pass('Empty/error searches preserve selected metadata; changing project still enforces project membership');
  await page.locator('#title').fill('Project picker browser verification');
  await page.getByRole('button', { name: 'Create quest', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1); assert.equal(writes[0].project_id, 'project-121');
  assert.equal(writes[0].subtask_approval_required, null);
  pass('Task creation saves the selected project through the unchanged API contract');
  await page.goto(base + '/__project-picker?projects=1&single=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open task selector' }).click(); await expect(trigger()).toContainText('Project 000 - Company 0');
  await page.setViewportSize({ width: 390, height: 844 }); await trigger().click(); await expect(option('Project 000')).toBeVisible();
  const box = await list().locator('..').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
  await page.screenshot({ path: new URL('mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await page.getByRole('heading', { name: 'Create Task', exact: true }).click(); await expect(search()).toHaveCount(0);
  pass('Only-project preselection, mobile layout and outside-click dismissal');
  assert.ok(calls.every(call => call.page_size === '25' && call.status === 'ACTIVE')); assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ results, calls, writes, errors }, null, 2));
} finally { await browser.close(); }
