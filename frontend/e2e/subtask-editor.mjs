import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_SUBTASK_TEST_URL || 'http://127.0.0.1:16319';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const errors = [], writes = [];
let fail = false;
let children = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**/api/ws/**', socket => socket.close());
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ body: tailwind, contentType: 'text/javascript' });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__subtasks') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/subtaskEditorFixture.tsx"') });
  }
  if (/\/api\/tasks\/subtask-parent\/subtasks/.test(url.pathname)) {
    const body = route.request().postDataJSON();
    writes.push({ method: route.request().method(), body });
    if (fail) return route.fulfill({ status: 500, json: { detail: 'Synthetic save failure' } });
    if (route.request().method() === 'POST') children.push({ id: 'child-1', ...body, completed: false, status: 'TODO', sort_order: 0 });
    else children = children.map(child => child.id === url.pathname.split('/').at(-1) ? { ...child, ...body } : child);
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: {
      id: 'subtask-parent', title: 'Subtask editor review', description: 'Synthetic task', status: 'TODO', priority: 'LOW',
      assigned_to_id: 'reviewer', created_by_id: 'reviewer', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
      subtasks: children, attachments: [], tags: [], can_edit: true, can_manage_subtasks: true, can_review_subtasks: true,
    } });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const add = () => page.getByRole('button', { name: 'Add subtask', exact: true });
const title = () => page.getByRole('textbox', { name: 'Subtask title' });
try {
  await page.goto(base + '/__subtasks');
  await add().click();
  assert.equal(await title().inputValue(), '');
  assert.equal(await page.getByLabel('Assignee', { exact: true }).inputValue(), 'reviewer');
  await title().fill('   ');
  assert.equal(await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).isDisabled(), true);
  await title().fill('  Added after task creation  ');
  await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).click();
  const edit = () => page.getByRole('button', { name: 'Edit subtask: Added after task creation', exact: true });
  await edit().waitFor();
  assert.deepEqual(writes[0], { method: 'POST', body: { title: 'Added after task creation', assigned_to_id: 'reviewer' } });
  await edit().click();
  await title().fill('Renamed work');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit subtask: Renamed work', exact: true }).waitFor();
  assert.deepEqual(writes[1], { method: 'PATCH', body: { title: 'Renamed work' } });
  await page.setViewportSize({ width: 390, height: 700 });
  await add().click();
  await title().fill('Keep draft on error');
  fail = true;
  await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await title().inputValue(), 'Keep draft on error');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await title().count(), 0);
  assert.equal(writes.length, 3);
  await page.goto(base + '/__subtasks?readOnly');
  await page.getByRole('heading', { name: 'Subtasks', exact: true }).waitFor();
  assert.equal(await add().count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: add, edit, trimmed titles, default assignee, narrow PATCH, mobile error retention, cancel, read-only permissions, no runtime errors');
} finally { await browser.close(); }
