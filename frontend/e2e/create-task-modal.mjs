import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pickDate, pickSubtaskDate, pickTime } from './subtask-date-helpers.mjs';
const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_CREATE_TASK_TEST_URL || 'http://127.0.0.1:16319';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../.tmp/create-task-modal-redesign/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], results = [], writes = [], uploads = [];
let rejectCreate = false, rejectUpload = false, rejectSubtask = false, rejectGeneric = false;
const defaultStatuses = [
  { id: 'WAITING_FOR_REQUIREMENT', title: 'New Task', order: 0, is_active: true },
  { id: 'TODO', title: 'Todo', order: 1, is_active: true },
  { id: 'ON_HOLD', title: 'On Hold', order: 2, is_active: true, workflow_behavior: 'HOLD', hold_reason_required: true },
];
let configuredStatuses = defaultStatuses, rejectStatuses = false, statusDelay = 0;
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
await context.routeWebSocket('**/api/ws/**', socket => socket.close());
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.hostname === 'generativelanguage.googleapis.com') {
    await new Promise(resolve => setTimeout(resolve, 500));
    const asksQuestions = !!request.postDataJSON()?.generationConfig?.responseSchema?.properties?.questions;
    return route.fulfill({ json: {
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(asksQuestions ? { questions: ['Goal?', 'Audience?', 'Deadline?'] }
      : { title: 'AI draft', description: 'Generated description', priority: 'HIGH', subtasks: ['AI first step', 'AI second step'] }) }] }, finishReason: 'STOP' }],
    } });
  }
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ body: tailwind, contentType: 'text/javascript' });
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__create-task') {
    const response = await route.fetch({ url: base + '/' });
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/createTaskModalFixture.tsx"') });
  }
  if (url.pathname === '/api/media/upload') {
    uploads.push(request.postDataBuffer().toString());
    await new Promise(resolve => setTimeout(resolve, 250));
    return rejectUpload ? route.fulfill({ status: 400, json: { detail: 'Unsupported attachment type' } })
      : route.fulfill({ status: 201, json: { public_url: '/media/verification.pdf' } });
  }
  if (url.pathname === '/api/kanban-columns') {
    const statuses = configuredStatuses;
    if (statusDelay) await new Promise(resolve => setTimeout(resolve, statusDelay));
    return rejectStatuses ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: statuses });
  }
  if (request.method() === 'POST' && (url.pathname === '/api/tasks' || /\/tickets\/ticket-1\/tasks$/.test(url.pathname))) {
    const body = request.postDataJSON(); writes.push({ path: url.pathname, body });
    await new Promise(resolve => setTimeout(resolve, 250));
    if (rejectGeneric) return route.fulfill({ status: 503, json: { detail: 'Temporarily unavailable; try again.' } });
    if (rejectSubtask) return route.fulfill({ status: 422, json: { detail: [{ loc: ['body', 'subtasks', 1, 'title'], msg: 'Invalid child title', type: 'value_error' }] } });
    if (rejectCreate) return route.fulfill({ status: 422, json: { detail: [{ loc: ['body', 'estimated_hours'], msg: 'Input should be greater than or equal to 0', type: 'greater_than_equal' }] } });
    const task = { id: 'created-task', title: body.title || 'Ticket task', description: body.description || '', status: 'TODO', priority: 'LOW',
      created_at: '2026-11-16T12:00:00Z', updated_at: '2026-11-16T12:00:00Z', subtasks: [], attachments: [], tags: [] };
    return route.fulfill({ status: 201, json: url.pathname === '/api/tasks' ? [task] : task });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-11-16T12:00:00Z'));
const dialog = () => page.getByRole('dialog', { name: 'Create task', exact: true });
const additional = () => page.getByRole('button', { name: /Additional options/ });
const submit = () => page.getByRole('button', { name: 'Create task', exact: true });
const pass = name => { results.push(name); console.log('PASS: ' + name); };
const screenshot = name => page.screenshot({ path: new URL(name + '.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
async function choose(id, name) {
  const trigger = page.locator('#' + id);
  await trigger.click();
  await trigger.locator('..').getByRole('option', id === 'projectId' ? { name: new RegExp('^' + name) } : { name, exact: true }).click();
}
try {
  await page.goto(base + '/__create-task');
  await expect(dialog()).toBeVisible();
  await expect(page.locator('#title')).toBeFocused();
  await expect(additional()).toHaveAttribute('aria-expanded', 'false');
  assert.ok((await page.locator('.create-task-modal').boundingBox()).width <= 900);
  await submit().click(); await expect(page.locator('#title')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('Task title');
  await page.locator('#title').fill('Website refresh');
  await page.locator('#description').fill('Build and review the homepage design.');
  await expect(page.locator('#projectId')).toContainText('Website refresh');
  await page.getByRole('button', { name: 'Assignees', exact: true }).click();
  for (const name of ['Dev Kumar', 'Leena Shah']) await page.getByRole('listbox', { name: 'Assignees', exact: true }).getByRole('option', { name: new RegExp(name) }).click();
  await page.getByRole('combobox', { name: 'Search by name, role, email, team...' }).press('Escape');
  await expect(dialog()).toBeVisible();
  await choose('status', 'Todo');
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subtask 1 title', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Subtask 1 title', exact: true }).fill('Prepare homepage design');
  const row = page.locator('.create-task-subtask').first();
  await expect(row.getByLabel('Set due date', { exact: true })).not.toBeChecked();
  await expect(row.getByLabel('Subtask due date', { exact: true })).toHaveCount(0);
  await expect(row.getByLabel('Subtask 1 assignee')).toHaveValue('worker-a');
  await screenshot('desktop-default');
  pass('Reference layout, 900px width, default focus, required title, project default and inherited subtask assignee');

  await row.getByLabel('Set due date', { exact: true }).check();
  await pickSubtaskDate(page, row.getByLabel('Subtask due date', { exact: true }), '2026-11-18');
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  const cleared = page.locator('.create-task-subtask').nth(1);
  await cleared.getByRole('textbox').fill('Review layout');
  await cleared.getByLabel('Set due date', { exact: true }).check();
  await pickSubtaskDate(page, cleared.getByLabel('Subtask due date', { exact: true }), '2026-11-19');
  await cleared.getByLabel('Set due date', { exact: true }).uncheck();
  await expect(cleared.getByLabel('Subtask due date', { exact: true })).toHaveCount(0);
  await cleared.getByLabel('Mark subtask 2 complete').check();
  await expect(cleared.getByLabel('Subtask 2 status')).toHaveValue('DONE');
  await page.locator('#taskDueToggle').click();
  await page.locator('#dueDate').click({ position: { x: 12, y: 18 } });
  const dueCalendar = page.getByRole('dialog', { name: 'Choose due date', exact: true });
  await expect(dueCalendar).toBeVisible();
  assert.equal(await dueCalendar.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 26, 44)');
  await expect(dueCalendar.getByRole('button', { name: 'Clear date', exact: true })).toHaveCount(0);
  await screenshot('main-due-calendar');
  await dueCalendar.getByRole('button', { name: 'Today', exact: true }).click();
  await pickDate(page, page.locator('#dueDate'), '2026-11-18');
  await expect(page.locator('#taskDueToggle')).toContainText('Nov 18, 2026');
  await pickDate(page, page.locator('#dueDate'), '2026-11-16');
  await page.locator('#dueTime').click({ position: { x: 12, y: 18 } });
  const timePicker = page.getByRole('dialog', { name: 'Choose due time', exact: true });
  await expect(timePicker).toBeVisible();
  assert.equal(await timePicker.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 26, 44)');
  await timePicker.getByLabel('Hours', { exact: true }).fill('25');
  await timePicker.getByLabel('Minutes', { exact: true }).fill('60');
  await expect(timePicker.getByRole('button', { name: 'Apply time', exact: true })).toBeDisabled();
  await expect(timePicker.getByRole('alert')).toContainText('hours 0');
  await timePicker.getByLabel('Hours', { exact: true }).fill('23');
  await timePicker.getByLabel('Minutes', { exact: true }).fill('07');
  await screenshot('main-due-time');
  await timePicker.getByLabel('Minutes', { exact: true }).press('Enter');
  await expect(timePicker).toHaveCount(0);
  await expect(page.locator('#dueTime')).toContainText('11:07');
  await expect(page.locator('#dueTime')).toBeFocused();
  assert.equal(writes.length, 0);
  await page.locator('#dueTime').click();
  await timePicker.getByLabel('Hours', { exact: true }).fill('00');
  await page.keyboard.press('Escape');
  await expect(timePicker).toHaveCount(0);
  await expect(page.locator('#dueTime')).toContainText('11:07');
  await expect(page.locator('#dueTime')).toBeFocused();
  await page.getByRole('button', { name: 'Morning', exact: true }).click();
  await expect(page.locator('#dueTime')).toContainText('10:00');
  await pickTime(page, page.locator('#dueTime'), '20:00');
  await page.locator('#dueTime').press('Escape');
  await expect(page.locator('#taskDueToggle')).toBeFocused();
  pass('Subtask dates are optional and clear to null; completion is distinct; due-date controls handle Escape');
  pass('Main date and time use matching full-field popovers; required date, arbitrary minutes, invalid input, Enter apply, Escape cancellation and presets preserve API behavior');

  await additional().click();
  await page.getByLabel('Hours', { exact: true }).fill('2');
  await page.getByLabel('Minutes', { exact: true }).fill('15');
  await choose('recurrence', 'Daily');
  await page.getByLabel('Repeat interval', { exact: true }).fill('2');
  await page.getByLabel('Repeat end date', { exact: true }).fill('2026-12-16');
  await page.getByRole('button', { name: 'Urgent', exact: true }).click();
  await page.getByRole('button', { name: 'Followers', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search followers...', exact: true }).fill('Nila');
  await page.getByRole('listbox', { name: 'Followers', exact: true }).getByRole('option', { name: /Nila Rao/ }).click();
  await page.getByRole('combobox', { name: 'Search followers...', exact: true }).press('Escape');
  await page.getByLabel('Subtask completion approval', { exact: true }).selectOption('required');
  await screenshot('desktop-expanded');
  await additional().click();
  await expect(page.getByLabel('Hours', { exact: true })).toBeHidden();
  assert.equal(await page.getByLabel('Hours', { exact: true }).inputValue(), '2');
  assert.equal(await page.getByLabel('Minutes', { exact: true }).inputValue(), '15');
  await additional().click();
  await page.getByLabel('Minutes', { exact: true }).fill('70');
  await additional().click();
  await submit().click();
  await expect(additional()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Minutes', { exact: true })).toBeFocused();
  await page.getByLabel('Minutes', { exact: true }).fill('15');
  await additional().click();
  pass('Additional options retain values, searchable followers and recurrence options; hidden invalid field expands and receives focus');

  await page.getByLabel('Attachment link', { exact: true }).fill('https://example.test/brief');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  rejectUpload = true;
  await page.locator('input[type=file]').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 verification') });
  await expect(page.getByRole('status')).toContainText('Uploading');
  await expect(submit()).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Unsupported attachment type' })).toBeVisible();
  rejectUpload = false;
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(page.getByText('brief.pdf', { exact: true })).toBeVisible();
  await expect(page.locator('.create-task-upload-progress')).toHaveCount(0);
  assert.ok(uploads[0].includes('name="file"') && uploads[0].includes('brief.pdf'));
  pass('Attachment links, real multipart adapter, loading/progress, failure and retry; pending uploads cannot be submitted');

  rejectCreate = true;
  await submit().click();
  await expect(page.getByRole('alert')).toContainText('Input should be greater than or equal to 0');
  await expect(additional()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Hours', { exact: true })).toBeFocused();
  assert.equal(await page.locator('#title').inputValue(), 'Website refresh');
  await additional().click(); rejectCreate = false;
  rejectSubtask = true;
  await submit().click();
  await expect(page.getByRole('alert')).toContainText('Invalid child title');
  await expect(page.getByRole('textbox', { name: 'Subtask 2 title', exact: true })).toBeFocused();
  rejectSubtask = false;
  rejectGeneric = true;
  await submit().click();
  await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(submit()).toBeEnabled();
  assert.equal(await page.locator('#title').inputValue(), 'Website refresh');
  rejectGeneric = false;
  await page.locator('form[aria-label="Create task"]').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(dialog()).toHaveCount(0);
  assert.equal(writes.length, 4);
  const body = writes.at(-1).body;
  assert.equal(body.project_id, 'project-1');
  assert.deepEqual(body.assigned_to_ids, ['worker-a', 'worker-b']);
  assert.ok(body.task_group_id);
  assert.equal(body.status, 'TODO');
  assert.equal(body.priority, 'LOW');
  assert.equal(body.due_at, '2026-11-16T14:30:00.000Z');
  assert.equal(body.estimated_hours, 2.25);
  assert.equal(body.recurrence_rule, 'DAILY');
  assert.deepEqual(body.tags, ['Urgent']);
  assert.deepEqual(body.follower_ids, ['follower']);
  assert.equal(body.subtask_approval_required, true);
  assert.deepEqual(body.subtasks.map(child => child.due_date), ['2026-11-18', null]);
  assert.equal(body.subtasks[1].status, 'DONE');
  assert.deepEqual(body.attachments, ['https://example.test/brief', '/media/verification.pdf']);
  pass('API errors preserve drafts and focus advanced fields; duplicate submits make one request; complete API payload matches existing contract');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/__create-task?user=1');
    await expect(dialog()).toBeVisible();
    await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
    await page.getByRole('textbox', { name: 'Subtask 1 title', exact: true }).fill('A long subtask title that wraps neatly');
    await page.locator('.create-task-subtask').getByLabel('Set due date', { exact: true }).check();
    await page.locator('.create-task-subtask').getByLabel('Subtask due date', { exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose subtask due date', exact: true });
    await expect(calendar).toBeVisible();
    const calendarBounds = await calendar.boundingBox();
    assert.ok(calendarBounds.x >= 0 && calendarBounds.x + calendarBounds.width <= width && calendarBounds.y >= 0 && calendarBounds.y + calendarBounds.height <= 844, JSON.stringify(calendarBounds));
    await calendar.getByRole('button', { name: 'Go to the Next Month', exact: true }).click();
    await expect(calendar).toContainText('December 2026');
    await calendar.getByRole('button', { name: 'Go to the Previous Month', exact: true }).click();
    await expect(calendar).toContainText('November 2026');
    await screenshot('create-calendar-mobile-' + width);
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await expect(dialog()).toBeVisible();
    await page.locator('#taskDueToggle').click();
    for (const [id, name] of [['dueDate', 'Choose due date'], ['dueTime', 'Choose due time']]) {
      await page.locator('#' + id).click();
      const popup = page.getByRole('dialog', { name, exact: true });
      await expect(popup).toBeVisible();
      const popupBox = await popup.boundingBox();
      assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= width && popupBox.y >= 0 && popupBox.y + popupBox.height <= 844, JSON.stringify(popupBox));
      await screenshot(`${id}-mobile-${width}`);
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
      await expect(page.locator('#' + id)).toBeFocused();
    }
    await page.locator('#dueTime').press('Escape');
    await expect(page.locator('#taskDueToggle')).toBeFocused();
    const bounds = await page.locator('.create-task-body').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(bounds.content <= bounds.width + 1, JSON.stringify(bounds));
    const header = await page.locator('.create-task-header').boundingBox(), footer = await page.locator('.create-task-footer').boundingBox();
    await additional().click();
    await page.locator('.create-task-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.deepEqual(await page.locator('.create-task-header').boundingBox(), header);
    assert.deepEqual(await page.locator('.create-task-footer').boundingBox(), footer);
    await page.locator('#team').click();
    const menu = page.locator('#team').locator('..').getByRole('listbox');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844);
    await page.locator('#team').press('Escape');
    await expect(dialog()).toBeVisible();
    await screenshot('mobile-' + width);
    await page.getByRole('button', { name: 'Create task', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.create-task-modal')), true);
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0);
  }
  pass('390px and 320px: stacked fields, wrapping subtasks, viewport-safe dropdowns, fixed header/footer, Tab containment and Escape');

  for (const [width, height] of [[601, 768], [720, 600], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + '/__create-task');
    await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
    const bounds = await page.locator('.create-task-subtask-main').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(bounds.content <= bounds.width + 1, `${width}x${height}: ${JSON.stringify(bounds)}`);
    const footer = await page.locator('.create-task-footer').boundingBox();
    assert.ok(footer.y >= 0 && footer.y + footer.height <= height);
    assert.ok((await page.locator('.create-task-body').boundingBox()).height > 80);
    await page.locator('#projectId').click();
    const list = page.getByRole('listbox', { name: 'Project', exact: true });
    await expect(list).toBeVisible();
    assert.ok((await list.boundingBox()).height >= 40, `Project options unusable at ${width}x${height}`);
    const popup = await list.locator('..').boundingBox();
    const bodyBounds = await page.locator('.create-task-body').boundingBox();
    assert.ok(popup.y >= bodyBounds.y - 1 && popup.y + popup.height <= bodyBounds.y + bodyBounds.height + 1,
      `Project popup clipped at ${width}x${height}: ${JSON.stringify({ popup, bodyBounds })}`);
    await page.keyboard.press('Escape');
  }
  pass('Intermediate widths and short landscape preserve subtask controls and a usable scrolling body');

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(base + '/__create-task?projects=1');
  await choose('projectId', 'Website refresh');
  await page.getByRole('button', { name: 'Assignees', exact: true }).click();
  await page.getByRole('listbox', { name: 'Assignees', exact: true }).getByRole('option', { name: /Dev Kumar/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await page.getByLabel('Subtask 1 title', { exact: true }).fill('   ');
  await page.locator('#title').fill('Membership test');
  await submit().click();
  await expect(page.getByRole('alert')).toContainText('Enter a title');
  await expect(page.getByLabel('Subtask 1 title', { exact: true })).toBeFocused();
  await page.getByLabel('Subtask 1 title', { exact: true }).fill('Child');
  await choose('projectId', 'Leena project');
  await expect(page.getByLabel('Subtask 1 assignee')).toHaveValue('');
  assert.deepEqual(await page.getByLabel('Subtask 1 assignee').locator('option').allTextContents(), ['Unassigned', 'Leena Shah']);
  await choose('projectId', 'Empty project');
  assert.deepEqual(await page.getByLabel('Subtask 1 assignee').locator('option').allTextContents(), ['Unassigned']);
  await additional().click();
  await expect(page.locator('#team')).toContainText('Management');
  await page.locator('#team').focus(); await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await page.getByRole('button', { name: 'Open create task' }).click();
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await page.getByRole('button', { name: 'Remove subtask 1', exact: true }).click();
  await expect(page.getByLabel('Subtask 1 title', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove subtask 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add subtask', exact: true })).toBeFocused();
  await page.locator('#priority').focus(); await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Urgent', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: 'Low', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#priority')).toBeFocused();
  pass('Project switches enforce membership including empty projects; team default remains; whitespace titles, add/remove focus and dropdown Home/End work');

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(base + '/__create-task');
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generate Task with AI', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Generate Task with AI', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate with AI', exact: true })).toBeFocused();
  await page.evaluate(() => localStorage.setItem('gemini-api-keys', JSON.stringify(['synthetic-test-key'])));
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await page.getByRole('button', { name: /^Detail\b/ }).click();
  await page.getByLabel('Type Your Prompt').fill('Draft a website launch plan');
  await page.getByLabel('Ask 3 to 7 questions before generating the task').check();
  await page.getByRole('button', { name: 'Generate Questions', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal?', exact: true }).fill('Launch the website');
  await page.getByRole('textbox', { name: 'Audience?', exact: true }).fill('Customers');
  await page.getByRole('textbox', { name: 'Deadline?', exact: true }).fill('Next week');
  await page.getByRole('button', { name: 'Generate Task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generate Task with AI', exact: true })).toHaveCount(0);
  await expect(page.locator('#title')).toHaveValue('AI draft');
  await expect(page.locator('#priority')).toContainText('High');
  await expect(page.getByLabel('Subtask 1 title', { exact: true })).toHaveValue('AI first step');
  pass('AI dialog focus returns on Escape; mocked provider generation populates task fields and detailed subtasks');

  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await page.getByLabel('Type Your Prompt').fill('This request will be cancelled');
  const pendingGeneration = page.waitForRequest(request => new URL(request.url()).hostname === 'generativelanguage.googleapis.com');
  await page.getByRole('button', { name: 'Generate Task', exact: true }).click();
  await pendingGeneration;
  await page.getByRole('dialog', { name: 'Generate Task with AI', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#title').fill('Keep my manual draft');
  await page.waitForTimeout(800);
  await expect(page.locator('#title')).toHaveValue('Keep my manual draft');
  pass('Cancelling an in-flight AI request cannot overwrite the draft with a late response');

  await page.goto(base + '/__create-task?ticket=1');
  await expect(page.locator('#title')).toHaveValue('Existing ticket task');
  await expect(page.locator('#title')).toHaveAttribute('readonly', '');
  await additional().click();
  await page.getByLabel('Require approval', { exact: true }).check();
  await additional().click();
  await submit().click();
  await expect(page.getByLabel('Approver', { exact: true })).toBeFocused();
  await page.getByLabel('Approver', { exact: true }).selectOption('creator');
  await submit().click();
  await expect(dialog()).toHaveCount(0);
  assert.equal(writes.at(-1).path, '/api/tickets/ticket-1/tasks');
  assert.equal(writes.at(-1).body.approval_required, true);
  assert.equal(writes.at(-1).body.approver_id, 'creator');
  pass('Ticket mode preserves locked content, approval validation and its existing API payload');

  configuredStatuses = [
    { id: 'TODO', title: 'Inactive todo', order: 0, is_active: false },
    { id: 'IN_PROGRESS', title: 'Active work', order: 3, is_active: true },
    { id: 'custom-review', custom_status_id: 'custom-review', title: 'Review ready', order: 1, is_active: true, kanban_visible: false },
  ];
  statusDelay = 700;
  await page.goto(base + '/__create-task');
  await expect(page.locator('#status')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Loading statuses');
  await expect(submit()).toBeDisabled();
  await expect(page.locator('#status')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Review ready');
  statusDelay = 0;
  await page.locator('#status').click();
  assert.deepEqual(await page.locator('#status').locator('..').getByRole('option').allTextContents(), ['Review ready', 'Active work']);
  await page.keyboard.press('Escape');
  await page.locator('#title').fill('Active status contract');
  await submit().click();
  await expect(dialog()).toHaveCount(0);
  assert.equal(writes.at(-1).body.custom_status_id, 'custom-review');
  assert.equal(writes.at(-1).body.status, undefined);
  pass('Status dropdown uses active configured labels/order, includes active hidden-on-board statuses, blocks loading and saves custom status identity');

  await page.goto(base + '/__create-task');
  await expect(page.locator('#status')).toContainText('Review ready');
  configuredStatuses = [{ id: 'IN_PROGRESS', title: 'Active work renamed', order: 3, is_active: true }];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('task-statuses-updated', { detail: { tenantId: 'modal-fixture' } })));
  await expect(page.locator('#status')).toContainText('Active work renamed');
  await page.locator('#status').click();
  assert.deepEqual(await page.locator('#status').locator('..').getByRole('option').allTextContents(), ['Active work renamed']);
  await page.keyboard.press('Escape');
  pass('Status Management changes refresh an open modal and replace a deactivated selection with an active status');

  rejectStatuses = true;
  await page.goto(base + '/__create-task');
  await expect(page.getByRole('alert')).toContainText('Unable to load active task statuses');
  await expect(page.locator('#status')).toBeDisabled();
  await expect(submit()).toBeDisabled();
  rejectStatuses = false;
  configuredStatuses = [];
  await page.getByRole('button', { name: 'Retry loading statuses' }).click();
  await expect(page.getByRole('alert')).toContainText('No active task statuses');
  await expect(submit()).toBeDisabled();
  configuredStatuses = defaultStatuses;
  await page.getByRole('button', { name: 'Retry loading statuses' }).click();
  await expect(page.locator('#status')).toContainText('New Task');
  await expect(submit()).toBeEnabled();
  pass('Status failures and empty configuration never expose built-in or inactive fallbacks; retry restores active options');
  for (const [zone, day, time, expected] of [
    ['Asia/Tokyo', '2026-10-22', '00:30', '2026-10-21T15:30:00.000Z'],
    ['Asia/Kolkata', '2026-10-22', '00:30', '2026-10-21T19:00:00.000Z'],
    ['America/New_York', '2026-03-08', '03:15', '2026-03-08T07:15:00.000Z'],
  ]) {
    await page.goto(base + '/__create-task?zone=' + encodeURIComponent(zone));
    await page.locator('#title').fill('Zoned date and time');
    await page.locator('#taskDueToggle').click();
    await pickDate(page, page.locator('#dueDate'), day);
    await pickTime(page, page.locator('#dueTime'), time);
    await submit().click();
    await expect(dialog()).toHaveCount(0);
    assert.equal(writes.at(-1).body.due_at, expected);
  }
  pass('Date/time payload uses the displayed timezone across different browser zones, midnight and DST');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('results.json', output), JSON.stringify({ results, errors, writes, uploadRequests: uploads.length }, null, 2));
  await browser.close();
}
