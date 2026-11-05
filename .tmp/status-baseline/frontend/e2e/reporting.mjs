import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const base = process.env.ZEAPLAY_REPORTING_TEST_URL || 'http://127.0.0.1:6303';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Loopback test URL required');
const { chromium } = await import(pathToFileURL(modulePath).href);
const { expect } = await import(new URL('test.mjs', pathToFileURL(modulePath)).href);
const output = new URL('../../docs/advanced-reporting/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url), 'utf8');
const meta = { as_of: '2026-10-20T12:00:00Z', timezone: 'Asia/Kolkata', from: '2026-10-01', to: '2026-10-20', date_semantics: 'task.created_at', limitations: ['Legacy assignment history is not recorded.'] };
const person = { employee_id: 'user-a', name: 'Ada Analyst', email: 'ada@example.test', status: 'INACTIVE', assigned_parent_tasks: 3,
  assigned_subtasks: 2, completed_parent_tasks: 1, in_progress_parent_tasks: 1, pending_parent_tasks: 0, blocked_parent_tasks: 1,
  overdue_parent_tasks: 1, completion_percentage: 33.3, project_count: 1, active_assignments: 2, completed_assignments: 1, recorded_effort_seconds: 9000 };
const project = { project_id: 'project-a', name: 'Historical project', client_name: 'Sample company', status: 'ARCHIVED',
  start_date: '2026-01-01', end_date: '2026-10-31', managers: [{ id: 'manager-a', name: 'Manager' }], members: [{ id: 'user-a', name: 'Ada Analyst' }],
  manager_count: 1, member_count: 1, total_tasks: 3, completed_tasks: 1, in_progress_tasks: 1, pending_tasks: 0,
  blocked_tasks: 1, overdue_tasks: 1, completion_percentage: 33.3, total_subtasks: 2, completed_subtasks: 1, members_truncated: false, recorded_effort_seconds: 9000 };
const task = { id: 'task-a', title: 'Recorded parent task', status: 'BLOCKED', assignee_name: 'Ada Analyst', assigned_to_id: 'user-a',
  project_id: 'project-a', project_name: 'Historical project', project_status: 'ARCHIVED', created_at: '2026-10-01T10:00:00Z',
  assigned_at: null, due_at: '2026-10-10T10:00:00Z', completed_at: null, total_subtasks: 2, completed_subtasks: 1, overdue: true };
const status = { status: 'BLOCKED', count: 1, percentage: 33.3, project_count: 1, employee_count: 1, overdue_tasks: 1 };
const activity = { date: '2026-10-20', tasks_created: 3, tasks_started: 1, tasks_completed: 1, tasks_reopened: 0,
  subtasks_completed: 2, work_sessions_started: 3, work_intervals_started: 4, recorded_effort_seconds: 9000, unique_working_seconds: 3600 };
const time = { id: 'user-a', name: 'Ada Analyst', recorded_effort_seconds: 9000, unique_working_seconds: 3600,
  interval_count: 3, running_interval_count: 2, resumed_interval_count: 1, paused_interval_count: 1 };
const session = { id: 'session-a', user_id: 'user-a', employee_name: 'Ada Analyst', task_title: 'Recorded parent task',
  subtask_title: 'Workflow subtask', project_name: 'Historical project', state: 'RUNNING', started_at: '2026-10-20T10:00:00Z',
  stopped_at: null, recorded_effort_seconds: 3600, start_kind: 'resumed', stop_reason: null, resumed_at: '2026-10-20T10:00:00Z', paused_seconds: 600 };
const makePage = (items, url, total = items.length) => ({ items, total, page: Number(url.searchParams.get('page') || 1),
  page_size: Number(url.searchParams.get('page_size') || 25), total_pages: Math.ceil(total / Number(url.searchParams.get('page_size') || 25)), meta });
const requests = [];
const results = [];
const errors = [];
let failReport = '';
let emptyReport = '';
let failExport = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => { localStorage.setItem('vee_access_token', 'synthetic-report-test'); localStorage.setItem('zenith-task-theme', 'dark'); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ status: 200, contentType: 'application/javascript', body: tailwind });
    if (url.pathname.endsWith('/auth/me')) return respond({ id: 'user-a', tenant_id: 'tenant-a', name: 'Ada Analyst', email: 'ada@example.test', role: 'user', status: 'active', timezone: 'Asia/Kolkata' });
    if (url.pathname.includes('/reports/')) {
      const section = url.pathname.split('/reports/')[1];
      requests.push({ section, params: Object.fromEntries(url.searchParams) });
      if (section === failReport) return respond({ detail: 'Report denied for this test scope.' }, 403);
      if (section === 'options') return respond({ employees: [{ id: 'user-a', name: person.name, email: person.email, status: person.status }],
        projects: [{ id: 'project-a', name: project.name, status: project.status }], statuses: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'FAILED'],
        employees_total: 1, projects_total: 1, timezone: meta.timezone, meta });
      if (section === 'overview') return respond({ metrics: { total_tasks: 3, assigned_tasks: 3, unassigned_tasks: 0, completed_tasks: 1,
        in_progress_tasks: 1, pending_tasks: 0, blocked_tasks: 1, overdue_tasks: 1, completion_percentage: 33.3,
        total_projects: 1, employees_with_assigned_work: 1, assignment_count: 3, unique_task_groups: 3 },
        status_distribution: [status, { ...status, status: 'IN_PROGRESS', overdue_tasks: 0 }, { ...status, status: 'DONE', overdue_tasks: 0 }], employee_workload: [{ employee_id: 'user-a', name: person.name, assigned_parent_tasks: 3 }],
        project_completion: [project], meta });
      if (section === 'employees/user-a') return respond({ employee: person, tasks: makePage([task], url), subtasks: makePage([{ id: 'sub-a', task_id: task.id, title: 'Workflow subtask', task_title: task.title, status: 'DONE' }], url),
        projects: [{ id: 'project-a', name: project.name, status: project.status }], projects_total: 1, meta });
      if (section === 'projects/project-a') return respond({ project, tasks: makePage([task], url), employees: makePage([person], url), statuses: [status], meta });
      if (section === 'export' && failExport) return respond({ detail: 'Export exceeds the safe row limit. Narrow the date range.' }, 422);
      if (section === 'export') return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="zea-report.csv"' }, body: 'Task,Status\nRecorded parent task,BLOCKED' });
      const items = section === emptyReport ? [] : ({ tasks: [task], employees: [person], projects: [project], statuses: [status], activity: [activity], time: [time], 'time/sessions': [session] }[section] || []);
      return respond({ ...makePage(items, url, section === 'tasks' && items.length ? 26 : items.length),
        ...(section === 'time' ? { summary: time } : {}), ...(section === 'activity' ? { series: items, totals: activity } : {}) });
    }
    if (url.pathname.endsWith('/time-entries/work/active')) return respond({ user_id: 'user-a', tenant_id: 'tenant-a', items: [], running_count: 0, limit: 3, server_time: meta.as_of });
    if (url.pathname.endsWith('/updates/latest')) return respond({ version: '6.0.1', content: '', updated_at: meta.as_of });
    if (url.pathname.includes('/api/')) return respond([]);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto(`${base}/#/reports`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Reporting & Analytics', exact: true })).toBeVisible();
  await expect(page.getByText('Unique parent tasks', { exact: true })).toBeVisible();
  await expect(page.locator('.report-kpis').first().locator('article')).toHaveCount(12);
  results.push('PASS regular user can reach reporting and real API response metrics render');
  await page.screenshot({ path: fileURLToPath(new URL('reporting-desktop.png', output)), fullPage: true });
  await page.getByRole('heading', { name: 'Parent task status', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('reporting-charts.png', output)), fullPage: true });

  await page.getByLabel('Date range', { exact: true }).selectOption('custom');
  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Through', { exact: true }).fill('2026-10-20');
  await page.getByLabel('Employees', { exact: true }).selectOption('user-a');
  await page.getByRole('combobox', { name: 'Projects', exact: true }).selectOption('project-a');
  await page.getByLabel('Parent task status', { exact: true }).selectOption('BLOCKED');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect.poll(() => requests.filter(row => row.section === 'overview').at(-1)?.params.employee_id).toBe('user-a');
  const combined = requests.filter(row => row.section === 'overview').at(-1).params;
  for (const [key, value] of Object.entries({ from: '2026-10-01', to: '2026-10-20', timezone: 'Asia/Kolkata', employee_id: 'user-a', project_id: 'project-a', status: 'BLOCKED' })) assert.equal(combined[key], value);
  assert.match(page.url(), /employee_id=user-a/);
  results.push('PASS combined date, employee, archived project and persisted status filters reach APIs and URL');

  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Tasks & assignments', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Recorded parent task', exact: true })).toBeVisible();
  assert.match(await page.getByRole('link', { name: 'Recorded parent task', exact: true }).getAttribute('href'), /#\/reports\?.*taskId=task-a/);
  await page.getByRole('button', { name: 'Parent task', exact: false }).filter({ hasText: 'Parent task' }).first().click();
  await expect.poll(() => requests.filter(row => row.section === 'tasks').at(-1)?.params.sort).toBe('title');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => requests.filter(row => row.section === 'tasks').at(-1)?.params.page).toBe('2');
  await page.getByLabel('Export format').selectOption('csv');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tasks & assignments', exact: true }).click();
  assert.equal((await downloaded).suggestedFilename(), 'zea-report.csv');
  const exported = requests.filter(row => row.section === 'export').at(-1).params;
  assert.equal(exported.employee_id, 'user-a'); assert.equal(exported.project_id, 'project-a'); assert.equal(exported.status, 'BLOCKED'); assert.equal(exported.format, 'csv');
  failExport = true;
  await page.getByRole('button', { name: 'Export tasks & assignments', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Export exceeds the safe row limit. Narrow the date range.' })).toBeVisible();
  failExport = false;
  results.push('PASS task deep links, server sorting, pagination and filter-matched download requests');

  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Employees', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Ada Analyst', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Employee detail' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assigned subtasks · workflow status is separate' })).toBeVisible();
  const subtaskLink = await page.getByRole('link', { name: 'Workflow subtask', exact: true }).getAttribute('href');
  assert.match(subtaskLink, /taskId=task-a/); assert.match(subtaskLink, /subtaskId=sub-a/);
  await expect(page.getByRole('heading', { name: 'Work-session history' })).toBeVisible();
  await page.getByRole('button', { name: 'View date-wise activity', exact: true }).click();
  await expect.poll(() => requests.filter(row => row.section === 'activity' && row.params.employee_id === 'user-a').length).toBeGreaterThan(0);
  results.push('PASS employee detail keeps parent and subtask status separate and exposes session history');

  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Time tracking', exact: true }).click();
  await expect(page.getByText('2h 30m', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1h 0m', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Group work by').selectOption('project');
  await expect.poll(() => requests.filter(row => row.section === 'time').at(-1)?.params.group_by).toBe('project');
  await page.getByLabel('Active timers only').check();
  await expect.poll(() => requests.filter(row => row.section === 'time/sessions').at(-1)?.params.active).toBe('true');
  await page.getByRole('heading', { name: 'Time tracking', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('reporting-time.png', output)), fullPage: true });
  results.push('PASS recorded effort and unique working time remain distinct; grouping and active-session filter work');

  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Date-wise activity', exact: true }).click();
  await page.getByLabel('Group by', { exact: true }).selectOption('weekly');
  await expect.poll(() => requests.filter(row => row.section === 'activity' && row.params.grouping === 'weekly').length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Compared with the previous period' })).toBeVisible();
  results.push('PASS event grouping and previous-period trend comparison are populated from report APIs');

  failReport = 'projects';
  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not accessible' })).toBeVisible();
  await expect(page.locator('.report-table')).toHaveCount(0);
  failReport = '';
  emptyReport = 'projects';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('No records match these filters.', { exact: true })).toBeVisible();
  emptyReport = '';
  results.push('PASS forbidden responses clear old records; empty reports have explicit empty states');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => requests.filter(row => row.section === 'projects').at(-1)?.params.employee_id).toBeUndefined();
  await expect(page.getByLabel('Employees', { exact: true })).toHaveValue('');
  await page.getByLabel('From', { exact: true }).fill('2026-10-21');
  await page.getByLabel('Through', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'End date must be on or after start date.' })).toBeVisible();
  results.push('PASS reset removes prior filters and invalid date ranges are rejected before querying');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Date range', { exact: true })).toHaveValue('month');
  await expect(page.getByRole('alert').filter({ hasText: 'End date must be on or after start date.' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Reporting sections' }).getByRole('button', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Reporting & Analytics', exact: true })).toBeVisible();
  const bounds = await page.locator('.reports-page').evaluate(element => ({ width: element.getBoundingClientRect().width, overflow: element.scrollWidth > element.clientWidth }));
  assert.ok(bounds.width <= 390); assert.equal(bounds.overflow, false);
  await page.locator('.report-header').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: fileURLToPath(new URL('reporting-mobile.png', output)), fullPage: true });
  await page.getByRole('button', { name: 'Apply filters', exact: true }).focus();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Apply filters');
  results.push('PASS 390px responsive layout, keyboard focus and reduced-motion rendering');
  assert.deepEqual(errors, []);
  results.push('PASS no uncaught browser errors');
  await context.close();
} finally { await browser.close(); }
await writeFile(new URL('browser-results.json', output), JSON.stringify({ results, scope: 'Deterministic intercepted API UI tests; no production or live database proof.' }, null, 2));
for (const result of results) console.log(result);
