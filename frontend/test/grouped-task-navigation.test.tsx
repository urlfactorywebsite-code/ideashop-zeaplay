import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupedTaskSummary from '../components/GroupedTaskSummary';
import { Task, TaskStatus } from '../types';
import { formatAssignmentTime, logicalTaskKey, replaceAssignment, replaceVisibleGroup } from '../utils/taskGroups';
import { LRUCache } from '../utils/lruCache';

const assignment = (id: string, fields: Partial<Task> = {}): Task => ({
  id, title: 'Same task title', taskGroupId: 'group-one', projectId: 'project-one', createdBy: 'creator',
  status: TaskStatus.IN_PROGRESS, assignedTo: [id], ...fields,
} as Task);

test('confirmed updates replace only their authorized assignment and retain siblings by reference', () => {
  const first = assignment('a'), sibling = assignment('b');
  const group = { ...first, groupAssignments: [first, sibling] };
  const unrelated = assignment('other', { taskGroupId: 'other-group' });
  const updated = { ...sibling, status: TaskStatus.DONE, totalTrackedSeconds: 3700 };
  const result = replaceAssignment([group, unrelated], updated);
  assert.equal(result[0].groupAssignments?.[0], first);
  assert.equal(result[0].groupAssignments?.[1], updated);
  assert.equal(result[1], unrelated);
  assert.equal(group.groupAssignments[1], sibling);
  assert.equal(replaceAssignment([group], assignment('hidden'))[0], group);
});

test('group reconciliation uses stable identifiers and scope, including representative removal', () => {
  const first = assignment('a'), sibling = assignment('b');
  const group = { ...first, groupAssignments: [first, sibling] };
  const otherProject = { ...group, projectId: 'project-two' };
  const unrelated = { ...group, taskGroupId: 'other-group' };
  const result = replaceVisibleGroup([group, otherProject, unrelated], first, [sibling]);
  assert.equal(result[0].id, 'b');
  assert.equal(result[1], otherProject);
  assert.equal(result[2], unrelated);
  assert.equal(replaceVisibleGroup(result, first, []).length, 2);
  assert.notEqual(logicalTaskKey(assignment('x', { taskGroupId: null })), logicalTaskKey(assignment('y', { taskGroupId: null })));
  assert.notEqual(logicalTaskKey(assignment('x', { projectId: null })), logicalTaskKey(assignment('y', { projectId: null, createdBy: 'other' })));
});

test('group summary names each independent status without exposing missing assignments', () => {
  const html = renderToStaticMarkup(<GroupedTaskSummary task={{ ...assignment('a'), groupAssignments: [
    assignment('a'), assignment('b', { status: TaskStatus.DONE }), assignment('c', { status: TaskStatus.DONE }),
  ] }} />);
  assert.match(html, /3 assignments/);
  assert.match(html, /67% complete/);
  assert.match(html, /1 In Progress/);
  assert.match(html, /2 Conquered/);
  assert.match(html, /max="3" value="2"/);
  const personal = renderToStaticMarkup(<GroupedTaskSummary task={{ ...assignment('own'), groupAssignments: [assignment('own')] }} />);
  assert.match(personal, /1 task/);
  assert.match(personal, /View task/);
  assert.doesNotMatch(personal, /View assignments/);
  assert.doesNotMatch(personal, /3 assignments|Conquered/);
});

test('tracked time handles missing, negative and long-running assignment totals', () => {
  assert.equal(formatAssignmentTime(), '0h 0m');
  assert.equal(formatAssignmentTime(-20), '0h 0m');
  assert.equal(formatAssignmentTime(3665), '1h 1m');
  assert.equal(formatAssignmentTime(90000), '25h 0m');
});

test('reconciliation updates cached List and Grid pages within the same viewer scope', () => {
  const cache = new LRUCache<Task[]>();
  const original = assignment('own');
  const otherViewer = assignment('own', { description: 'Other viewer snapshot' });
  cache.set('viewer-one:list', [original], 60_000);
  cache.set('viewer-one:grid', [original], 60_000);
  cache.set('viewer-two:list', [otherViewer], 60_000);
  const updated = { ...original, status: TaskStatus.DONE };
  cache.updateMatching(key => key.startsWith('viewer-one:'), tasks => replaceAssignment(tasks, updated));
  assert.equal(cache.get('viewer-one:list')?.[0], updated);
  assert.equal(cache.get('viewer-one:grid')?.[0], updated);
  assert.equal(cache.get('viewer-two:list')?.[0], otherViewer);
});
