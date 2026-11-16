import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pickSubtaskDate } from './subtask-date-helpers.mjs';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_SUBTASK_TEST_URL || 'http://127.0.0.1:16319';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
const output = new URL('../../.tmp/subtask-calendar/', import.meta.url);
await mkdir(output, { recursive: true });
const screenshot = name => page.screenshot({ path: new URL(name + '.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
const calendar = () => page.getByRole('dialog', { name: 'Choose subtask due date', exact: true });
await page.clock.setFixedTime(new Date('2026-11-16T12:00:00Z'));
const errors = [], writes = [];
let fail = false;
let children = [];
const task = () => ({
  id: 'subtask-parent', title: 'Subtask editor review', description: 'Synthetic task', status: 'TODO', priority: 'LOW',
  assigned_to_id: 'reviewer', created_by_id: 'reviewer', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  subtasks: children, attachments: [], tags: [], can_edit: !page.url().includes('readOnly'),
  can_manage_subtasks: !page.url().includes('readOnly'), can_review_subtasks: !page.url().includes('readOnly'),
});
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
  if (url.pathname === '/api/tasks/subtask-parent' && route.request().method() === 'GET') return route.fulfill({ json: task() });
  if (url.pathname === '/api/tasks' && route.request().method() === 'POST') {
    const body = route.request().postDataJSON();
    writes.push({ method: 'CREATE_TASK', body });
    children = body.subtasks.map((child, index) => ({ ...child, id: `created-${index}` }));
    return route.fulfill({ status: 201, json: [task()] });
  }
  if (/\/api\/tasks\/subtask-parent\/subtasks/.test(url.pathname)) {
    const body = route.request().postDataJSON();
    writes.push({ method: route.request().method(), body });
    if (fail) return route.fulfill({ status: 500, json: { detail: 'Synthetic save failure' } });
    if (route.request().method() === 'POST') children.push({ id: `child-${children.length + 1}`, ...body, completed: false, status: 'TODO', sort_order: 0 });
    else children = children.map(child => child.id === url.pathname.split('/').at(-1) ? { ...child, ...body } : child);
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: task() });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const add = () => page.getByRole('button', { name: 'Add subtask', exact: true });
const title = () => page.getByRole('textbox', { name: 'Subtask title' });
const undated = () => page.locator('[id^="work-subtask-"]').getByText('No due date', { exact: true });
try {
  await page.goto(base + '/__subtasks');
  await add().click();
  assert.equal(await page.getByLabel('Set due date', { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('Subtask due date', { exact: true }).count(), 0);
  assert.equal(await title().inputValue(), '');
  assert.equal(await page.getByLabel('Assignee', { exact: true }).inputValue(), 'reviewer');
  await title().fill('   ');
  assert.equal(await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).isDisabled(), true);
  await title().fill('  Added after task creation  ');
  await page.getByLabel('Set due date', { exact: true }).check();
  const dateField = page.getByLabel('Subtask due date', { exact: true });
  await dateField.click({ position: { x: 12, y: 18 } });
  await expect(calendar()).toBeVisible();
  assert.equal(await calendar().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 26, 44)');
  assert.equal(await calendar().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await screenshot('detail-desktop');
  await page.keyboard.press('Escape');
  await expect(calendar()).toHaveCount(0);
  await expect(dateField).toBeFocused();
  await expect(title()).toBeVisible();
  await dateField.press('Enter');
  await expect(calendar()).toBeVisible();
  await expect(calendar().locator('[data-day="2026-11-16"] button')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(calendar().locator('[data-day="2026-11-17"] button')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  await expect(calendar()).toHaveCount(0);
  await expect(dateField).toContainText('Nov 16, 2026');
  await dateField.click({ position: { x: (await dateField.boundingBox()).width - 15, y: 18 } });
  await calendar().getByRole('button', { name: 'Clear date', exact: true }).click();
  await expect(dateField).toContainText('Select due date');
  await expect(page.getByLabel('Set due date', { exact: true })).toBeChecked();
  await pickSubtaskDate(page, page.getByLabel('Subtask due date', { exact: true }), '2026-11-16');
  await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).click();
  const edit = () => page.getByRole('button', { name: 'Edit subtask: Added after task creation', exact: true });
  await edit().waitFor();
  assert.deepEqual(writes[0], { method: 'POST', body: { title: 'Added after task creation', assigned_to_id: 'reviewer', due_date: '2026-11-16' } });
  await page.getByText('Due today', { exact: true }).waitFor();
  await page.reload();
  await edit().click();
  assert.equal(await page.getByLabel('Set due date', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Subtask due date', { exact: true }).textContent(), 'Nov 16, 2026');
  await title().fill('Renamed work');
  await pickSubtaskDate(page, page.getByLabel('Subtask due date', { exact: true }), '2026-11-15');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit subtask: Renamed work', exact: true }).waitFor();
  assert.deepEqual(writes[1], { method: 'PATCH', body: { title: 'Renamed work', due_date: '2026-11-15' } });
  await page.getByText('Overdue', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit subtask: Renamed work', exact: true }).click();
  await page.getByLabel('Set due date', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('Subtask due date', { exact: true }).count(), 0);
  await page.getByLabel('Set due date', { exact: true }).check();
  assert.equal(await page.getByLabel('Subtask due date', { exact: true }).textContent(), 'Select due date');
  await page.getByLabel('Set due date', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await undated().waitFor();
  assert.equal(writes[2].body.due_date, null);
  await page.reload();
  await undated().waitFor();
  await page.getByRole('button', { name: 'Edit subtask: Renamed work', exact: true }).click();
  assert.equal(await page.getByLabel('Set due date', { exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 700 });
  await add().click();
  await title().fill('Keep draft on error');
  await page.getByLabel('Set due date', { exact: true }).check();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dateField.click();
  await expect(calendar()).toBeVisible();
  assert.ok((await calendar().evaluate(el => getComputedStyle(el).transitionDuration)).includes('0.16s'));
  await calendar().evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const calendarBox = await calendar().boundingBox();
  assert.ok(calendarBox.x >= 0 && calendarBox.x + calendarBox.width <= 390 && calendarBox.y >= 0 && calendarBox.y + calendarBox.height <= 700, JSON.stringify(calendarBox));
  await screenshot('detail-mobile');
  await title().click();
  await expect(calendar()).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Set due date', { exact: true }).uncheck();
  fail = true;
  await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await title().inputValue(), 'Keep draft on error');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await title().count(), 0);
  assert.equal(writes.length, 4);
  await page.goto(base + '/__subtasks?readOnly');
  await page.getByRole('heading', { name: 'Subtasks', exact: true }).waitFor();
  assert.equal(await add().count(), 0);
  children = [
    { id: 'future', title: 'Upcoming work', due_date: '2026-11-17', completed: false, status: 'TODO' },
    { id: 'done', title: 'Finished work', due_date: '2026-11-15', completed: true, status: 'DONE' },
    { id: 'legacy', title: 'Legacy undated', completed: false, status: 'TODO' },
  ];
  await page.goto(base + '/__subtasks');
  await page.getByText('Upcoming', { exact: true }).waitFor();
  await page.getByText('Nov 15, 2026', { exact: true }).waitFor();
  assert.equal(await page.getByText('Overdue', { exact: true }).count(), 0);
  await undated().waitFor();
  fail = false;
  await page.goto(base + '/__subtasks?create');
  await page.locator('#title').fill('Parent with optional dates');
  for (const [index, name] of ['Dated', 'Cleared', 'Undated'].entries()) {
    await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
    await page.getByRole('textbox', { name: `Subtask ${index + 1} title`, exact: true }).fill(name);
  }
  const rows = page.locator('.create-task-subtask');
  await rows.nth(0).getByLabel('Set due date', { exact: true }).check();
  await pickSubtaskDate(page, rows.nth(0).getByLabel('Subtask due date', { exact: true }), '2026-11-17');
  await rows.nth(1).getByLabel('Set due date', { exact: true }).check();
  await pickSubtaskDate(page, rows.nth(1).getByLabel('Subtask due date', { exact: true }), '2026-11-15');
  await rows.nth(1).getByLabel('Set due date', { exact: true }).uncheck();
  assert.equal(await rows.nth(1).getByLabel('Subtask due date', { exact: true }).count(), 0);
  assert.equal(await rows.nth(2).getByLabel('Set due date', { exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Task created successfully.'));
  assert.deepEqual(writes.at(-1).body.subtasks.map(child => child.due_date), ['2026-11-17', null, null]);
  await page.goto(base + '/__subtasks');
  await page.getByText('Upcoming', { exact: true }).waitFor();
  assert.equal(await undated().count(), 2);
  await page.clock.setFixedTime(new Date('2026-11-16T21:00:00Z'));
  await add().click(); await title().fill('Profile timezone today');
  await page.getByLabel('Set due date', { exact: true }).check();
  await dateField.click();
  await calendar().getByRole('button', { name: 'Today', exact: true }).click();
  await expect(dateField).toContainText('Nov 17, 2026');
  await page.getByRole('form', { name: 'Add subtask' }).getByRole('button', { name: 'Add subtask' }).click();
  await expect(page.getByRole('button', { name: 'Edit subtask: Profile timezone today', exact: true })).toBeVisible();
  assert.equal(writes.at(-1).body.due_date, '2026-11-17');
  assert.deepEqual(errors, []);
  console.log('PASS: full-field and icon clicks; themed calendar; keyboard selection/Escape/focus; clear; viewport positioning; animated and reduced motion; Today respects profile timezone across browser zones');
  console.log('PASS: create-task dates/nulls; detail add/edit/clear; refresh/prepopulation; due today/upcoming/overdue; completed/legacy dates; mobile errors; permissions; no runtime errors (synthetic HTTP harness)');
} finally { await browser.close(); }
