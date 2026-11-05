import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskStatus } from '../types';
import { previousReportingPeriod, reportingDates, reportingDuration, reportingFiltersFromUrl, reportingSearchParams, reportingTaskLink, reportTimezone, validateReportingDates } from '../utils/reporting';

test('reporting presets use profile calendar dates including UTC crossover and leap years', () => {
  const now = new Date('2026-10-19T20:00:00Z');
  assert.deepEqual(reportingDates('today', 'Asia/Kolkata', now), { from: '2026-10-20', to: '2026-10-20' });
  assert.deepEqual(reportingDates('yesterday', 'Asia/Kolkata', now), { from: '2026-10-19', to: '2026-10-19' });
  assert.deepEqual(reportingDates('last7', 'Asia/Kolkata', now), { from: '2026-10-14', to: '2026-10-20' });
  assert.deepEqual(reportingDates('week', 'Asia/Kolkata', now), { from: '2026-10-19', to: '2026-10-20' });
  assert.deepEqual(reportingDates('lastMonth', 'UTC', new Date('2024-03-15T00:00:00Z')), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(reportTimezone('invalid'), 'UTC');
});

test('custom calendar dates remain inclusive and valid across daylight saving changes', () => {
  assert.equal(validateReportingDates('2026-03-08', '2026-03-08', 'America/New_York'), null);
  assert.ok(validateReportingDates('2026-03-09', '2026-03-08', 'America/New_York'));
  assert.ok(validateReportingDates('2026-02-30', '2026-03-08', 'UTC'));
  assert.ok(validateReportingDates('', '2026-03-08', 'UTC'));
});

test('URL roundtrip preserves combined report filters and current parent status', () => {
  const filters = { from: '2026-10-01', to: '2026-10-20', timezone: 'Asia/Kolkata',
    employee_id: 'person-a', project_id: 'project-a', status: TaskStatus.FAILED, search: 'release & support' };
  const url = reportingSearchParams({ ...filters, page: 2, page_size: 25, sort: 'name', direction: 'desc' }, 'employees', 'custom');
  assert.deepEqual(reportingFiltersFromUrl(url, 'UTC'), filters);
  assert.equal(url.get('page'), '2');
  assert.equal(url.get('tab'), 'employees');
  assert.equal(reportingFiltersFromUrl(new URLSearchParams('status=COMPLETED&timezone=invalid'), 'UTC').status, undefined);
});

test('recorded effort durations do not wrap after 24 hours', () => {
  assert.equal(reportingDuration(49 * 3600 + 120), '49h 2m');
  assert.equal(reportingDuration(-10), '0h 0m');
});

test('previous period compares the same number of local calendar days across DST', () => {
  const filters = { from: '2026-03-07', to: '2026-03-09', timezone: 'America/New_York', employee_id: 'person-a' };
  assert.deepEqual(previousReportingPeriod(filters), { ...filters, from: '2026-03-04', to: '2026-03-06' });
});

test('subtask detail opens its actual parent and child without losing report filters', () => {
  const child = reportingTaskLink('project_id=project-a&status=DONE', { id: 'child-a', task_id: 'parent-a' });
  assert.equal(child.pathname, '/reports');
  const params = new URLSearchParams(child.search);
  assert.equal(params.get('taskId'), 'parent-a');
  assert.equal(params.get('subtaskId'), 'child-a');
  assert.equal(params.get('status'), 'DONE');
  assert.equal(params.get('project_id'), 'project-a');
  const parent = reportingTaskLink(child.search, { id: 'parent-b' });
  assert.equal(new URLSearchParams(parent.search).get('taskId'), 'parent-b');
  assert.equal(new URLSearchParams(parent.search).has('subtaskId'), false);
});
