import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_SECTIONS, taskSectionForPath, updateTaskFilter } from '../utils/taskNavigation';
import { pageIdForPath } from '../utils/navigationPreferences';
import { navigationDocument } from '../e2e/navigation-fixture.mjs';

test('task tabs resolve canonical paths and existing policy IDs', () => {
  assert.deepEqual(TASK_SECTIONS.map(tab => tab.to), ['/tasks', '/tasks/kanban', '/tasks/gantt', '/tasks/calendar']);
  for (const tab of TASK_SECTIONS) {
    assert.equal(taskSectionForPath(tab.to + '/')?.key, tab.key);
    if (tab.key !== 'list') assert.equal(pageIdForPath(tab.to), tab.pageId);
  }
  assert.equal(taskSectionForPath('/tasks/not-a-tab'), undefined);
  assert.equal(pageIdForPath('/kanban'), 'kanban');
  assert.equal(pageIdForPath('/gantt'), 'gantt');
  assert.equal(pageIdForPath('/calendar'), 'calendar');
  assert.equal(pageIdForPath('/tasks'), 'tasks'); // Parent sidebar retains its own policy and label.
});

test('shared filter updates preserve deep-link arguments and view-specific state', () => {
  let search = '?taskId=task-1&ganttRange=90&priority=HIGH&projectId=project-1';
  search = updateTaskFilter(search, 'status', 'IN_PROGRESS');
  search = updateTaskFilter(search, 'assigneeId', 'member-1');
  search = updateTaskFilter(search, 'priority', 'ALL');
  const params = new URLSearchParams(search);
  assert.equal(params.get('taskId'), 'task-1');
  assert.equal(params.get('ganttRange'), '90');
  assert.equal(params.get('status'), 'IN_PROGRESS');
  assert.equal(params.get('assigneeId'), 'member-1');
  assert.equal(params.get('projectId'), 'project-1');
  assert.equal(params.has('priority'), false);
});

test('task registry keeps role ceilings and old rules restrictive', () => {
  for (const role of ['user', 'manager', 'admin', 'owner']) {
    const doc = navigationDocument(role);
    const tabs = doc.pages.filter(page => page.navigationLocation === 'task-tab');
    assert.equal(tabs.length, 4);
    assert.ok(tabs.every(page => page.parentId === 'tasks'));
    assert.equal(tabs.find(page => page.id === 'gantt')?.access, role === 'user' ? 'forbidden' : 'allowed');
    assert.ok(doc.pages.filter(page => ['kanban', 'gantt', 'calendar'].includes(page.id)).every(page => page.navigationLocation !== 'sidebar'));
  }
  const restricted = navigationDocument('manager', { kanban: { allowedRoles: ['owner'] }, calendar: { hidden: true } });
  assert.equal(restricted.pages.find(page => page.id === 'kanban')?.access, 'forbidden');
  assert.equal(restricted.pages.find(page => page.id === 'calendar')?.access, 'hidden');
});
