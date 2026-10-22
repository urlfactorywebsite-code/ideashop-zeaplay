import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateKey, calendarDateInstant, calendarToday, taskDateKey, taskDateTimeInstant, taskTimeline } from '../utils/taskDates';
import { legacyTaskDetailSearch } from '../utils/taskNavigation';

test('UTC storage is grouped by the selected timezone, including timestamps without offsets', () => {
  assert.equal(taskDateKey('2026-10-21T18:45:00', 'Asia/Kolkata'), '2026-10-22');
  assert.equal(taskDateKey('2026-10-22T04:00:00Z', 'America/Los_Angeles'), '2026-10-21');
  assert.equal(taskDateKey('2026-10-22T00:30:00+05:30', 'UTC'), '2026-10-21');
  assert.equal(calendarDateKey(calendarToday('Asia/Tokyo', new Date('2026-10-21T16:00:00Z'))), '2026-10-22');
});

test('calendar drops use midnight in the profile timezone and respect DST', () => {
  const start = calendarDateInstant(new Date(2026, 2, 8, 12), 'America/New_York');
  const end = calendarDateInstant(new Date(2026, 2, 9, 12), 'America/New_York');
  assert.equal(start, '2026-03-08T05:00:00.000Z');
  assert.equal(end, '2026-03-09T04:00:00.000Z');
  assert.equal((Date.parse(end) - Date.parse(start)) / 3_600_000, 23);
  assert.equal(taskDateTimeInstant('2026-10-22', '00:30', 'Asia/Tokyo'), '2026-10-21T15:30:00.000Z');
});

test('timeline geometry counts civil days without inventing deadlines', () => {
  assert.equal(taskTimeline({ createdAt: '2026-03-07T16:00:00Z', dueAt: '2026-03-09T16:00:00Z' }, 'America/New_York').duration, 3);
  assert.equal(taskTimeline({ createdAt: '2026-10-21T12:00:00' }, 'Asia/Kolkata').duration, 1);
  const invalid = taskTimeline({ createdAt: '2026-10-22T12:00:00Z', dueAt: '2026-10-20T12:00:00Z' }, 'UTC');
  assert.equal(invalid.duration, 1);
  assert.equal(invalid.reversed, true);
});

test('stored notification task links open the existing details flow and retain filters', () => {
  const id = '2ad039ec-1f32-4f05-87ab-76cdeec7a991';
  const query = new URLSearchParams(legacyTaskDetailSearch('/tasks/' + id, '?priority=HIGH&subtaskId=child'));
  assert.equal(query.get('taskId'), id);
  assert.equal(query.get('priority'), 'HIGH');
  assert.equal(query.get('subtaskId'), 'child');
  assert.equal(legacyTaskDetailSearch('/tasks/not-a-tab', ''), undefined);
});
