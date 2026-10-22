import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_PROJECT_FORM_TEST_URL || 'http://127.0.0.1:16309';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../docs/project-form-pickers/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const cssRuntime = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const calls = [], writes = [], errors = [], results = [];
const clients = Array.from({ length: 132 }, (_, index) => ({ id: `client-${index}`, tenant_id: 'project-form-tenant',
  company_name: `Company ${String(index).padStart(3, '0')}`, email: `office${index}@example.test`, phone: `987654${String(index).padStart(4, '0')}`,
  normalized_company_name: `company ${index}`, status: index >= 130 ? 'ARCHIVED' : 'ACTIVE', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }));
const people = {
  bob: { name: 'Bob Williams', email: 'bob@example.test', user_role: 'admin' },
  alice: { name: 'Alice Johnson', email: 'alice@example.test', user_role: 'owner' },
  maya: { name: 'Maya Lead', email: 'maya@example.test', user_role: 'manager' },
  charlie: { name: 'Charlie Brown', email: 'charlie@example.test', user_role: 'user' },
  dana: { name: 'Dana Davis', email: 'dana@example.test', user_role: 'user' },
  retired: { name: 'Retired Member', email: 'retired@example.test', user_role: 'user', status: 'DEACTIVATED' },
};
let saved = null;
const member = (id, role) => ({ ...people[id], id: `link-${id}`, user_id: id, role, status: people[id]?.status || 'ACTIVE' });
const responsePage = (items, page = 1, size = 25) => ({ items: items.slice((page - 1) * size, page * size), page,
  page_size: size, total: items.length, total_pages: Math.max(1, Math.ceil(items.length / size)) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: cssRuntime });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__project-form') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/projectFormFixture.tsx"') });
  }
  if (url.pathname === '/api/clients') {
    calls.push(Object.fromEntries(url.searchParams));
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (new URL(request.frame().url()).searchParams.has('delayed') && url.searchParams.get('page_size') === '100') {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    if (q === 'failure') return route.fulfill({ status: 503, json: { detail: 'Client search unavailable' } });
    const matches = clients.filter(client => client.status === url.searchParams.get('status')
      && [client.company_name, client.email, client.phone].some(value => value.toLowerCase().includes(q)));
    return route.fulfill({ json: responsePage(matches, Number(url.searchParams.get('page')), Number(url.searchParams.get('page_size'))) });
  }
  const detail = url.pathname.match(/^\/api\/clients\/(client-\d+)$/);
  if (detail) return route.fulfill({ json: clients.find(client => client.id === detail[1]) });
  if ((url.pathname === '/api/projects' && request.method() === 'POST') || (url.pathname === '/api/projects/project-test' && request.method() === 'PATCH')) {
    const body = request.postDataJSON(); writes.push({ method: request.method(), body });
    const client = clients.find(client => client.id === body.client_id);
    saved = { ...saved, ...body, id: 'project-test', tenant_id: 'project-form-tenant', status: 'ACTIVE', normalized_name: body.name.toLowerCase(),
      client: { id: client.id, company_name: client.company_name, status: client.status },
      members: [...body.manager_ids.map(id => member(id, 'MANAGER')), ...body.member_ids.map(id => member(id, 'MEMBER'))],
      created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' };
    return route.fulfill({ json: saved });
  }
  if (url.pathname === '/api/projects') return route.fulfill({ json: responsePage(saved ? [saved] : [], 1, 10) });
  if (url.pathname.endsWith('/task-dashboard')) return route.fulfill({ json: { ...responsePage([], 1, 10), project: saved,
    summary: { status_counts: {}, derived_status_counts: {}, subtask_status_counts: {}, priority_counts: {}, workload: [] }, status_policy: 'Synthetic dashboard' } });
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const pass = name => { results.push(name); console.log('PASS: ' + name); };
const trigger = label => page.getByRole('button', { name: label, exact: true });
const list = label => page.getByRole('listbox', { name: label, exact: true });
const search = label => page.getByRole('combobox', { name: label === 'Client' ? 'Search by company name, email, phone...' : `Search ${label.toLowerCase()} by name, role, email, team...` });
const option = (label, name) => list(label).getByRole('option', { name: new RegExp(name) });
try {
  await page.goto(base + '/__project-form', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await expect(trigger('Client')).toContainText('Company 000');
  await expect(trigger('Managers')).toContainText('0 selected'); await expect(trigger('Members')).toContainText('0 selected');
  await trigger('Client').click(); await expect(search('Client')).toBeFocused();
  await expect(list('Client').getByRole('option')).toHaveCount(25); await expect(list('Client')).toHaveAttribute('aria-multiselectable', 'false');
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(list('Client').getByRole('option')).toHaveCount(50);
  await search('Client').fill('OFFICE120@EXAMPLE.TEST'); await expect(option('Client', 'Company 120')).toBeVisible();
  await option('Client', 'Company 120').click(); await expect(search('Client')).toHaveCount(0); await expect(trigger('Client')).toBeFocused();
  await expect(trigger('Client')).toContainText('Company 120');
  await trigger('Client').click(); await search('Client').fill('9876540121'); await expect(option('Client', 'Company 121')).toBeVisible();
  await search('Client').press('Escape'); await expect(trigger('Client')).toContainText('Company 120');
  pass('Client single select, avatars/details, paginated name/email/phone search and preserved selection beyond page one');
  await trigger('Managers').click(); await expect(list('Managers').getByRole('option')).toHaveCount(3);
  await expect(list('Managers')).not.toContainText('Charlie Brown');
  await search('Managers').fill('BOB@EXAMPLE.TEST'); await option('Managers', 'Bob Williams').click();
  await expect(trigger('Managers')).toContainText('1 selected'); await expect(search('Managers')).toBeVisible();
  await search('Managers').fill(''); await option('Managers', 'Alice Johnson').click(); await expect(trigger('Managers')).toContainText('2 selected');
  await option('Managers', 'Alice Johnson').click(); await expect(trigger('Managers')).toContainText('1 selected');
  await option('Managers', 'Alice Johnson').click(); await expect(trigger('Managers')).toContainText('2 selected');
  await search('Managers').fill('no-one'); await expect(page.getByText('No managers match your search.')).toBeVisible();
  await expect(trigger('Managers')).toContainText('2 selected'); await search('Managers').press('Escape');
  pass('Managers retain role eligibility, case-insensitive search, multi-selection, toggling, counts and empty state');
  await trigger('Members').click(); await option('Members', 'Alice Johnson').click();
  await expect(trigger('Managers')).toContainText('1 selected'); await expect(trigger('Members')).toContainText('1 selected');
  await search('Members').fill('dana@'); await expect(option('Members', 'Dana Davis')).toBeVisible();
  await search('Members').press('ArrowDown'); await search('Members').press('ArrowUp'); await search('Members').press('Enter');
  await expect(trigger('Members')).toContainText('2 selected'); await search('Members').press('Escape'); await expect(trigger('Members')).toBeFocused();
  pass('Members multi-select and keyboard controls work; moving a person between fields prevents duplicate roles');
  await page.screenshot({ path: new URL('desktop-selected.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await trigger('Managers').click(); await search('Managers').fill('');
  const row = option('Managers', 'Bob Williams');
  assert.deepEqual(await row.evaluate(el => ({ height: el.offsetHeight, gap: getComputedStyle(el).columnGap,
    avatar: el.querySelector('[role="img"]').getBoundingClientRect().width })), { height: 52, gap: '12px', avatar: 36 });
  await page.screenshot({ path: new URL('desktop-managers.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await search('Managers').press('Escape');
  await page.getByText('Project name', { exact: true }).locator('..').getByRole('textbox').fill('Searchable project form');
  await page.getByLabel('Require approval for subtask completions by default').check();
  await trigger('Managers').click(); await option('Managers', 'Bob Williams').click(); await search('Managers').press('Escape');
  await page.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByText('Select at least one project manager.')).toBeVisible(); assert.equal(writes.length, 0);
  await trigger('Managers').click(); await option('Managers', 'Bob Williams').click(); await search('Managers').press('Escape');
  await page.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  assert.equal(writes[0].body.client_id, 'client-120'); assert.deepEqual(writes[0].body.manager_ids, ['bob']);
  assert.deepEqual(writes[0].body.member_ids, ['alice', 'dana']); assert.equal(writes[0].body.subtask_approval_required_default, true);
  pass('Matching avatar/row spacing, required-manager validation and correct project creation payload');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(trigger('Client')).toContainText('Company 120'); await expect(trigger('Managers')).toContainText('1 selected');
  await expect(trigger('Members')).toContainText('2 selected');
  await trigger('Client').click(); await search('Client').fill('failure'); await expect(page.getByRole('alert')).toContainText('Client search unavailable');
  await expect(trigger('Client')).toContainText('Company 120'); await search('Client').press('Escape');
  await page.getByRole('button', { name: 'Save Project', exact: true }).click(); await expect.poll(() => writes.length).toBe(2);
  assert.deepEqual(writes[1].body.manager_ids, ['bob']); assert.deepEqual(writes[1].body.member_ids, ['alice', 'dana']);
  assert.equal(writes[1].body.client_id, 'client-120');
  pass('Editing preloads and preserves client, manager and member selections through searches and save');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const label of ['Client', 'Managers', 'Members']) {
    await trigger(label).click(); if (label === 'Client') await search(label).fill('Company 120');
    await expect(list(label)).toBeVisible();
    const box = await list(label).locator('..').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, `${label} clipped`);
    if (label === 'Members') await page.screenshot({ path: new URL('mobile-members.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    await search(label).press('Escape');
  }
  pass('All three pickers fit the mobile viewport and support keyboard dismissal');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  saved.members.push(member('retired', 'MEMBER'));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(trigger('Members')).toContainText('3 selected'); await expect(trigger('Members')).toContainText('Retired Member');
  await trigger('Members').click(); await search('Members').fill('retired');
  await expect(option('Members', 'Retired Member')).toHaveAttribute('aria-selected', 'true');
  await expect(option('Members', 'Retired Member')).toContainText('Added');
  await option('Members', 'Retired Member').click(); await expect(trigger('Members')).toContainText('2 selected');
  await expect(page.getByText('No members match your search.')).toBeVisible(); await search('Members').press('Escape');
  await page.getByRole('button', { name: 'Save Project', exact: true }).click(); await expect.poll(() => writes.length).toBe(3);
  assert.deepEqual(writes[2].body.member_ids, ['alice', 'dana']);
  pass('Historical users missing from lookups remain selected until explicitly removed and cannot be newly reselected');
  saved = null;
  await page.goto(base + '/__project-form?delayed=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const nameField = page.getByText('Project name', { exact: true }).locator('..').getByRole('textbox');
  await nameField.fill('Keep this draft'); await expect(trigger('Client')).toContainText('Company 000');
  await expect(nameField).toHaveValue('Keep this draft');
  pass('Late lookup responses preselect the initial client without resetting entered form values');
  await page.goto(base + '/__project-form?shell=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Project', exact: true });
  const title = dialog.getByRole('heading', { name: 'Create Project', exact: true });
  const close = dialog.getByRole('button', { name: 'Close project form' });
  const submit = dialog.getByRole('button', { name: 'Create Project', exact: true });
  const body = dialog.getByRole('region', { name: 'Project details' });
  const onTop = locator => locator.evaluate(el => {
    const box = el.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return target === el || el.contains(target);
  });
  for (const [width, height] of [[1920, 930], [1366, 768], [1280, 600], [1024, 600], [390, 640]]) {
    await page.setViewportSize({ width, height });
    await expect(dialog).toBeVisible(); await expect(close).toBeInViewport({ ratio: 1 }); await expect(submit).toBeInViewport({ ratio: 1 });
    const bounds = await dialog.locator('form').boundingBox();
    assert.ok(bounds.y >= 15 && bounds.y + bounds.height <= height - 15);
    assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
    assert.ok(await onTop(title) && await onTop(close) && await onTop(submit), `Header obscures dialog at ${width}x${height}`);
    const before = { title: (await title.boundingBox()).y, submit: (await submit.boundingBox()).y };
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal((await title.boundingBox()).y, before.title); assert.equal((await submit.boundingBox()).y, before.submit);
    await trigger('Members').click();
    const popup = await list('Members').locator('..').boundingBox(), bodyBox = await body.boundingBox();
    assert.ok(popup.y >= bodyBox.y - 1 && popup.y + popup.height <= bodyBox.y + bodyBox.height + 1);
    await search('Members').press('Escape');
    if (width === 1366 || width === 390) await page.screenshot({ path: new URL(`modal-${width}x${height}.png`, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  }
  await close.click(); await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  pass('100% zoom: modal clears z-70 header/transformed scroll container; title/close/actions stay visible across five desktop/mobile viewports');
  assert.ok(calls.some(call => call.page_size === '25'));
  assert.ok(calls.every(call => ['25', '100'].includes(call.page_size) && call.status === 'ACTIVE')); assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ results, calls, writes, errors }, null, 2));
} finally { await browser.close(); }
