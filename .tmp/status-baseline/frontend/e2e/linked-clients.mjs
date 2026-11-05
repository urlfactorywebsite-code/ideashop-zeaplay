import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_LINKED_CLIENTS_TEST_URL || 'http://127.0.0.1:16309';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../docs/linked-clients/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const cssRuntime = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const calls = [], writes = [], errors = [], results = [];
let failSearch = true;
let clientRowStyles;
let clientVisual;
let emptyTriggerVisual;
const visualComparisons = [];
const styleKeys = ["height", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderRadius", "columnGap", "fontSize"];
const rowStyles = async locator => locator.evaluate((el, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(el)[key]])), styleKeys);
const clients = Array.from({ length: 82 }, (_, index) => ({ id: `client-${index}`, tenant_id: 'picker-tenant',
  company_name: `Company ${String(index).padStart(3, '0')}`, email: `office${index}@example.test`, phone: `987654${String(index).padStart(4, '0')}`,
  normalized_company_name: `company ${index}`, status: index >= 80 ? 'ARCHIVED' : 'ACTIVE', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }));
clients[78].company_name += ' International Services and Consulting '.repeat(4);
clients[78].email = 'office78' + 'long-address'.repeat(6) + '@example.test';
const summary = (id, primary = false) => { const client = clients.find(client => client.id === id); return { id, company_name: client.company_name, status: client.status, is_primary: primary }; };
let contacts = [{ id: 'contact-original', tenant_id: 'picker-tenant', first_name: 'Priya', last_name: 'Shah', display_name: 'Priya Shah',
  email: 'priya@example.test', status: 'ACTIVE', clients: [summary('client-0', true), summary('client-76'), summary('client-81', true)] }];
const pageResponse = (items, page = 1, size = 25) => ({ items: items.slice((page - 1) * size, page * size), page, page_size: size, total: items.length, total_pages: Math.max(1, Math.ceil(items.length / size)) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: cssRuntime });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__linked-clients') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/linkedClientsFixture.tsx"') });
  }
  if (url.pathname === '/api/clients') {
    calls.push(Object.fromEntries(url.searchParams));
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (q === 'failure' && failSearch) { failSearch = false; return route.fulfill({ status: 503, json: { detail: 'Search temporarily unavailable' } }); }
    if (q === 'company 070') await new Promise(resolve => setTimeout(resolve, 500));
    const matches = clients.filter(client => (!url.searchParams.get('status') || client.status === url.searchParams.get('status'))
      && [client.company_name, client.email, client.phone].some(value => value.toLowerCase().includes(q)));
    return route.fulfill({ json: pageResponse(matches, Number(url.searchParams.get('page')), Number(url.searchParams.get('page_size'))) });
  }
  const detail = url.pathname.match(/^\/api\/clients\/(client-\d+)$/);
  if (detail) return route.fulfill({ json: clients.find(client => client.id === detail[1]) });
  if (/^\/api\/clients\/[^/]+\/contacts$/.test(url.pathname)) return route.fulfill({ json: pageResponse(contacts, 1, 100) });
  if (url.pathname === '/api/contacts' || /^\/api\/contacts\/contact-/.test(url.pathname)) {
    const body = request.postDataJSON(); writes.push({ method: request.method(), body });
    const contact = { ...contacts[0], ...body, id: url.pathname === '/api/contacts' ? 'contact-created' : 'contact-original',
      display_name: body.first_name, clients: body.client_links.map(link => summary(link.client_id, link.is_primary)) };
    contacts = [contact]; return route.fulfill({ json: contact });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const pass = name => { results.push(name); console.log('PASS: ' + name); };
const trigger = () => page.getByRole('button', { name: 'Linked clients', exact: true });
const search = () => page.getByRole('combobox', { name: 'Search by company name, email, phone...' });
const list = () => page.getByRole('listbox', { name: 'Linked clients', exact: true });
const option = name => list().getByRole('option', { name: new RegExp(name) });
const sharedStyles = ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'columnGap',
  'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'backgroundColor', 'color', 'fontFamily', 'fontSize',
  'fontWeight', 'lineHeight', 'letterSpacing', 'boxShadow', 'backdropFilter', 'transitionProperty',
  'transitionDuration', 'transitionTimingFunction', 'animationName', 'animationDuration'];
const styles = locator => locator.evaluate((element, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(element)[key]])), sharedStyles);
async function visualSnapshot(button, dropdown, input) {
  await page.mouse.move(0, 0); await input.focus(); await page.waitForTimeout(220);
  const row = dropdown.getByRole('option').first();
  const result = {
    trigger: await styles(button), counter: await styles(button.locator('[aria-live]')),
    search: await styles(input), popup: await styles(dropdown.locator('..')), row: await styles(row),
    avatar: await styles(row.locator(':scope > span').first()), avatarImage: await styles(row.getByRole('img')),
    badge: await styles(row.locator(':scope > span').last()), chip: await styles(button.locator('.modal-chip').first()),
    chipAvatar: await styles(button.getByRole('img').first()),
    truncate: await row.locator('span.truncate').first().evaluate(el => {
      const css = getComputedStyle(el); return { overflow: css.overflow, textOverflow: css.textOverflow, whiteSpace: css.whiteSpace };
    }),
    scrollbar: await dropdown.evaluate(el => Object.fromEntries(['::-webkit-scrollbar', '::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb'].map(pseudo => {
      const css = getComputedStyle(el, pseudo); return [pseudo, { width: css.width, height: css.height, backgroundColor: css.backgroundColor, borderRadius: css.borderRadius }];
    }))),
    sizes: await row.evaluate(el => ({ row: el.offsetHeight, avatar: el.querySelector('[role="img"]').getBoundingClientRect().width })),
    triggerHeight: await button.evaluate(el => el.offsetHeight),
  };
  await button.focus(); await page.waitForTimeout(220); result.triggerFocus = await styles(button);
  await button.hover(); await page.waitForTimeout(220); result.triggerHover = await styles(button);
  await input.focus(); await dropdown.getByRole('option').nth(1).hover(); await page.waitForTimeout(180);
  result.rowHover = await styles(dropdown.getByRole('option').nth(1)); result.selectedAway = await styles(row);
  await row.hover(); await page.waitForTimeout(180); await page.mouse.move(0, 0);
  return result;
}

try {
  await page.goto(base + '/__linked-clients', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(trigger()).toContainText('1 selected');
  await trigger().click(); await expect(search()).toBeFocused();
  await expect(list().getByRole('option')).toHaveCount(25);
  await expect(option('Company 000')).toHaveAttribute('aria-selected', 'true');
  await expect(option('Company 000')).toContainText('ACTIVE');
  await expect(option('Company 000')).toContainText('office0@example.test');
  await expect(option('Company 000').getByRole('img')).toContainText('C0');
  clientRowStyles = await rowStyles(option('Company 000'));
  clientVisual = await visualSnapshot(trigger(), list(), search());
  clientVisual.label = await styles(page.locator('label[for="linkedClients"]'));
  const popupBounds = await list().locator('..').evaluate(el => {
    const popup = el.getBoundingClientRect(), form = el.closest('form').getBoundingClientRect();
    return { top: popup.top, bottom: popup.bottom, formTop: form.top, formBottom: form.bottom };
  });
  assert.ok(popupBounds.top >= popupBounds.formTop && popupBounds.bottom <= popupBounds.formBottom);
  await page.screenshot({ path: new URL('desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  pass('Client preselection, count, initials, email, active status and selected row');
  await option('Company 000').click(); await expect(trigger()).toContainText('0 selected');
  await expect(trigger()).toContainText('Search and select clients...');
  await page.mouse.move(0, 0); await page.waitForTimeout(220);
  emptyTriggerVisual = { styles: await styles(trigger()), height: await trigger().evaluate(el => el.offsetHeight) };
  await option('Company 000').click(); await expect(trigger()).toContainText('1 selected');
  await option('Company 001').click(); await expect(trigger()).toContainText('2 selected'); await expect(search()).toBeVisible();
  await option('Company 001').click(); await expect(trigger()).toContainText('1 selected');
  await search().fill('OFFICE76@EXAMPLE.TEST'); await expect(list().getByRole('option')).toHaveCount(1);
  await option('Company 076').click(); await expect(trigger()).toContainText('2 selected');
  await search().fill('9876540077'); await expect(option('Company 077')).toBeVisible();
  await search().press('Enter'); await expect(trigger()).toContainText('3 selected');
  pass('Toggle, immediate count, multi-select, case-insensitive email/phone search and selection retention');
  await search().fill('no-matching-company'); await expect(page.getByText('No clients match your search.')).toBeVisible();
  await search().press('Enter'); await expect(page.getByRole('heading', { name: 'Create Contact' })).toBeVisible();
  await search().press('Escape'); await expect(trigger()).toBeFocused(); await expect(search()).toHaveCount(0);
  await trigger().click(); await search().fill(''); await expect(list().getByRole('option')).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(list().getByRole('option')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more', exact: true }).focus();
  await page.keyboard.press('Escape'); await expect(trigger()).toBeFocused(); await expect(search()).toHaveCount(0);
  await trigger().press('ArrowDown'); await expect(search()).toBeFocused();
  await search().press('End');
  const geometry = await list().evaluate(el => ({ scroll: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }));
  assert.ok(geometry.scroll > 0 && geometry.height <= 256 && geometry.total > geometry.height);
  await search().press('Enter'); await expect(trigger()).toContainText('4 selected');
  await search().press('Escape');
  pass('Empty search, safe Enter/Escape, pagination and keyboard scrolling');
  await page.getByText('First name', { exact: true }).locator('..').getByRole('textbox').fill('New Contact');
  await page.getByRole('button', { name: 'Create Contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create Contact' })).toHaveCount(0);
  assert.equal(writes[0].method, 'POST'); assert.deepEqual(writes[0].body.client_links.map(link => link.client_id).sort(), ['client-0', 'client-49', 'client-76', 'client-77'].sort());
  pass('Create Contact submits selected IDs through the existing API contract');
  // Restore a contact with links beyond page one and an archived primary relationship.
  contacts = [{ ...contacts[0], id: 'contact-original', display_name: 'Priya Shah', first_name: 'Priya', clients: [summary('client-0', true), summary('client-76'), summary('client-81', true)] }];
  await page.reload(); await page.getByText('Companies: Company 000, Company 076, Company 081', { exact: true }).locator('..').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(trigger()).toContainText('3 selected'); await expect(trigger()).toContainText('Company 081');
  await trigger().click(); await search().fill('company 081'); await expect(option('Company 081')).toContainText('ARCHIVED');
  await expect(option('Company 081')).toHaveAttribute('aria-selected', 'true');
  await search().fill('failure'); await expect(page.getByRole('alert')).toContainText('Search temporarily unavailable');
  await expect(trigger()).toContainText('3 selected');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No clients match your search.')).toBeVisible();
  await expect(trigger()).toContainText('3 selected');
  await search().fill('Company 070'); await page.waitForTimeout(300); await search().fill('Company 071');
  await expect(option('Company 071')).toBeVisible(); await page.waitForTimeout(600); await expect(list().getByRole('option')).toHaveCount(1);
  await expect(option('Company 071')).toBeVisible();
  await search().fill('office78'); await expect(option('Company 078')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const longRow = option('Company 078');
  const truncation = await longRow.locator('span.truncate').evaluateAll(elements => elements.map(el => ({
    overflow: getComputedStyle(el).textOverflow, clipped: el.scrollWidth > el.clientWidth,
  })));
  assert.ok(truncation.every(item => item.overflow === 'ellipsis' && item.clipped));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await search().press('Escape'); await page.getByRole('button', { name: 'Save Contact', exact: true }).click();
  assert.deepEqual(writes.at(-1).body.client_links, [{ client_id: 'client-0', is_primary: true }, { client_id: 'client-76', is_primary: false }, { client_id: 'client-81', is_primary: true }]);
  pass('Editing retains all links and primary flags, including archived/off-page clients; failures and stale results preserve selections');
  await page.getByText('Companies: Company 000, Company 076, Company 081', { exact: true }).locator('..').getByRole('button', { name: 'Edit', exact: true }).click();
  await trigger().click(); await search().fill('company 081'); await option('Company 081').click();
  await expect(trigger()).toContainText('2 selected'); await search().fill('company 077');
  await expect(option('Company 077')).toBeVisible(); await search().press('ArrowDown'); await search().press('ArrowUp'); await search().press('Enter');
  await expect(trigger()).toContainText('3 selected'); await search().press('Escape');
  await page.getByRole('button', { name: 'Save Contact', exact: true }).click();
  assert.deepEqual(writes.at(-1).body.client_links, [{ client_id: 'client-0', is_primary: true }, { client_id: 'client-76', is_primary: false }, { client_id: 'client-77', is_primary: false }]);
  await page.getByText('Companies: Company 000, Company 076, Company 077', { exact: true }).locator('..').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(trigger()).toContainText('3 selected'); await expect(trigger()).toContainText('Company 077');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  pass('Editing explicitly adds/removes client links, preserves untouched links and reloads the saved selection');
  await page.getByRole('button', { name: 'Open task selector' }).click();
  const assignees = page.getByRole('button', { name: 'Assignees', exact: true });
  await assignees.click();
  const assigneeSearch = page.getByRole('combobox', { name: 'Search by name, role, email, team...' });
  await expect(page.getByRole('listbox', { name: 'Assignees' }).getByRole('option')).toHaveCount(2);
  assert.deepEqual(await rowStyles(page.getByRole('listbox', { name: 'Assignees' }).getByRole('option').first()), clientRowStyles);
  await page.mouse.move(0, 0); await page.waitForTimeout(220);
  assert.deepEqual({ styles: await styles(assignees), height: await assignees.evaluate(el => el.offsetHeight) }, emptyTriggerVisual);
  await page.getByRole('listbox', { name: 'Assignees' }).getByRole('option').first().click();
  const assigneeVisual = await visualSnapshot(assignees, page.getByRole('listbox', { name: 'Assignees' }), assigneeSearch);
  assigneeVisual.label = await styles(page.locator('label[for="assignedTo"]'));
  for (const key of Object.keys(clientVisual)) {
    // Avatar fill is derived from identity; its frame, dimensions and typography must match.
    const actual = { ...clientVisual[key] }, expected = { ...assigneeVisual[key] };
    if (key === 'avatarImage' || key === 'chipAvatar') { delete actual.backgroundColor; delete expected.backgroundColor; }
    assert.deepEqual(actual, expected, `Visual mismatch: ${key}`);
    visualComparisons.push(key);
  }
  await page.getByRole('listbox', { name: 'Assignees' }).getByRole('option').first().click();
  pass('Computed trigger, search, counter, avatars, chips, truncation, selected/hover states, badge, border/shadow, scrollbar and animation match Assignees');
  await page.screenshot({ path: new URL('assignees.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await assigneeSearch.fill('DEV@EXAMPLE.TEST');
  await page.getByRole('listbox', { name: 'Assignees' }).getByRole('option').click();
  await expect(assignees).toContainText('1 selected'); await expect(assignees).toContainText('Dev Kumar');
  await expect(assigneeSearch).toBeVisible(); await assigneeSearch.press('Enter'); await expect(assignees).toContainText('0 selected');
  await assigneeSearch.press('Escape'); await expect(assignees).toBeFocused();
  pass('Existing task Assignees keeps avatars, search, multi-selection and keyboard behavior');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await trigger().click(); await search().fill('Company 081');
  await expect(option('Company 081')).toBeVisible(); await option('Company 081').click();
  const box = await list().boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391);
  await page.screenshot({ path: new URL('mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.getByRole('heading', { name: 'Create Contact' }).click(); await expect(search()).toHaveCount(0);
  await trigger().click(); await search().press('Tab');
  pass('Mobile dropdown remains within the viewport and supports selection; outside click closes it');
  await page.evaluate(() => localStorage.setItem('zenith-task-theme', 'light'));
  await page.setViewportSize({ width: 320, height: 740 }); await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await trigger().click();
  await expect(list().getByRole('option')).toHaveCount(25);
  const narrow = await list().locator('..').boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 321 && narrow.y >= 0 && narrow.y + narrow.height <= 741);
  await option('Company 001').click(); await expect(trigger()).toContainText('2 selected');
  pass('Narrow 320px layout and light theme retain visible search, rows and selection');
  assert.ok(calls.filter(call => call.page_size === '25').length > 0);
  assert.ok(calls.every(call => Number(call.page_size) <= 25));
  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ results, clientRowStyles, visualComparisons, clientVisual, calls, writes, errors }, null, 2));
} finally { await browser.close(); }
