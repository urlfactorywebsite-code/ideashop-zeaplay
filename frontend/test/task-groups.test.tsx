import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskGroupMembers, { GroupQuestStatus } from '../components/TaskGroupMembers';
import QuestParty from '../components/QuestParty';
import { Task, TaskPriority, TaskStatus, TaskCategory, RecurrenceRule, User, Role } from '../types';
import { assignmentIds, assignmentMember, taskSelectionState, settleAssignmentActions, taskGroupSummary, visibleAssignments, removeTaskAssignments } from '../utils/taskGroups';
import { calculateTaskPoints, summarizeTaskPoints } from '../utils/taskPoints';
import { buildTaskListKey } from '../hooks/useTaskCache';

const member = (index: number): Task => ({
  id: `assignment-${index}`, title: 'Shared mission', description: 'Existing task',
  taskGroupId: 'stable-group', status: index < 2 ? TaskStatus.DONE : TaskStatus.IN_PROGRESS,
  priority: TaskPriority.LOW, category: TaskCategory.OTHER, team: 'Other',
  assignedTo: [`member-${index}`], assignedMember: { id: `member-${index}`, name: `Member ${index}`, avatarUrl: null },
  createdBy: 'owner', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  dueAt: null, subtasks: [], recurrenceRule: RecurrenceRule.NONE, recurringTaskId: null,
  clarityRating: null, attachments: [], estimatedHours: null, tags: [],
});
const grouped = (): Task => ({ ...member(7), groupAssignments: Array.from({ length: 8 }, (_, index) => member(index)) });

test('server-filtered personal group renders only own identity, status, rewards and progress', () => {
  const own = member(2);
  const task = { ...own, groupAssignments: [own] };
  const currentUser = { id: 'member-2', role: Role.USER } as User;
  // Directory profiles must never expand assignment membership.
  const usersMap = new Map(Array.from({ length: 8 }, (_, index) => [`member-${index}`, {
    id: `member-${index}`, name: `Member ${index}`, role: Role.USER,
  } as User]));
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(<TaskGroupMembers task={task} currentUser={currentUser}
      usersMap={usersMap} compact={compact} onOpenAssignment={() => {}} />);
    assert.match(html, /Your assignment/); assert.match(html, /Your progress/);
    assert.match(html, /0\/1 complete/);
    assert.equal((html.match(/Open assignment for Member/g) || []).length, 1);
    for (const index of [0, 1, 3, 4, 5, 6, 7]) assert(!html.includes(`Member ${index}`));
    assert(!html.includes('Overall progress') && !html.includes('8 assigned members'));
  }
  const party = renderToStaticMarkup(<QuestParty assignments={[own]} usersMap={usersMap} currentUser={currentUser}
    currentTaskId={own.id} loading={false} error={null} onRetry={() => {}} onOpenAssignment={() => {}} />);
  assert.match(party, /Your assignment/); assert.match(party, /Your progress and rewards/);
  assert.equal((party.match(/data-party-assignment-id=/g) || []).length, 1);
  for (const index of [0, 1, 3, 4, 5, 6, 7]) assert(!party.includes(`Member ${index}`));
  assert.deepEqual(assignmentIds(task), [own.id]);
});

test('creator still renders the complete grouped card and party', () => {
  const creator = { id: 'owner', role: Role.USER } as User;
  const task = grouped();
  const html = renderToStaticMarkup(<TaskGroupMembers task={task} currentUser={creator} onOpenAssignment={() => {}} />);
  assert.match(html, /8 assigned members/); assert.match(html, /2\/8 complete/);
  assert.match(html, /Quest progress/); assert(!html.includes('Your progress'));
  const party = renderToStaticMarkup(<QuestParty assignments={task.groupAssignments!} usersMap={new Map()} currentUser={creator}
    currentTaskId={task.id} loading={false} error={null} onRetry={() => {}} onOpenAssignment={() => {}} />);
  assert.match(party, /Quest Party/);
  assert.equal((party.match(/data-party-assignment-id=/g) || []).length, 8);
});

test('group progress and XP are display aggregates while every assignment ID/status is preserved', () => {
  const task = grouped(), before = structuredClone(task);
  const summary = taskGroupSummary(task, new Date('2026-01-02T00:00:00Z'));
  assert.equal(summary.total, 8); assert.equal(summary.complete, 2); assert.equal(summary.progress, 25);
  assert(summary.mixed); assert.equal(summary.members.length, 8);
  assert.deepEqual(assignmentIds(task), Array.from({ length: 8 }, (_, index) => `assignment-${index}`));
  assert.equal(summary.awarded, taskGroupSummary(member(0)).awarded * 2);
  assert.equal(summary.potential, taskGroupSummary(member(7)).potential * 6);
  assert.deepEqual(task, before);
});

test('legacy standalone records stay individual even when titles match', () => {
  const first = member(1), second = { ...member(2), taskGroupId: null };
  assert.deepEqual(visibleAssignments(first), [first]);
  assert.deepEqual(visibleAssignments(second), [second]);
  assert.notDeepEqual(assignmentIds(first), assignmentIds(second));
});

test('member display caps avatars, exposes every assignment and names progress accessibly', () => {
  const html = renderToStaticMarkup(<TaskGroupMembers task={grouped()} onOpenAssignment={() => {}} />);
  assert.equal((html.match(/role="img"/g) || []).length, 8);
  assert.match(html, /\+2/); assert.match(html, /8 assigned members/);
  assert.match(html, /25%/); assert.match(html, /2\/8 complete/);
  assert.match(html, /aria-label="Overall progress for Shared mission"/);
  assert.equal((html.match(/Open assignment for Member/g) || []).length, 8);
  assert.match(html, /XP estimate:/); assert.match(html, /Quest progress/);
  assert.match(html, /aria-valuetext="2 of 8 assignments complete \(25%\)"/);
  assert.match(html, /4 more members/);
});

test('missing assignees, mixed custom statuses and long names remain visible without unsafe markup', () => {
  const task = grouped();
  task.groupAssignments = [{ ...member(0), assignedMember: null, assignedTo: null },
    { ...member(1), customStatusId: 'custom-1', assignedTo: ['one'], assignedMember: { id: 'one', name: '<script>' + 'x'.repeat(300), avatarUrl: null } }];
  const html = renderToStaticMarkup(<TaskGroupMembers task={task} onOpenAssignment={() => {}} />);
  assert.match(html, /Unassigned/); assert.match(html, /&lt;script&gt;/); assert(!html.includes('<script>'));
  assert.match(html, /View 2 assignments/); assert.match(html, /break-words/);
});

test('all complete and failed groups show correct aggregate progress and remaining potential', () => {
  const task = grouped(); task.groupAssignments = [member(0), member(1)];
  assert.equal(taskGroupSummary(task).progress, 100); assert.equal(taskGroupSummary(task).potential, 0);
  task.groupAssignments = [{ ...member(7), status: TaskStatus.FAILED }];
  assert.equal(taskGroupSummary(task).progress, 0); assert.equal(taskGroupSummary(task).potential, 0);
});

test('grouped and assignment responses have separate client cache entries', () => {
  const params = { viewMode: 'list' as const, page: 1, pageSize: 20 };
  assert.notEqual(buildTaskListKey(params), buildTaskListKey({ ...params, grouped: true }));
});


test('empty groups never resurrect a deleted representative or produce NaN progress', () => {
  const task = { ...grouped(), groupAssignments: [] };
  assert.deepEqual(visibleAssignments(task), []);
  assert.deepEqual(assignmentIds(task), []);
  assert.equal(taskGroupSummary(task).progress, 0);
  assert.equal(taskGroupSummary(task).awarded, 0);
});

test('deletion reconciles standalone tasks and promotes a surviving representative without touching members', () => {
  const task = grouped(), independent = { ...member(9), taskGroupId: null }, before = structuredClone(task);
  const remaining = removeTaskAssignments([task, independent], new Set([task.id, independent.id]));
  assert.equal(remaining.length, 1); assert.equal(remaining[0].id, 'assignment-0');
  assert.equal(remaining[0].groupAssignments?.length, 7);
  assert.deepEqual(task, before);
  assert.deepEqual(removeTaskAssignments([task], new Set(assignmentIds(task))), []);
  assert.equal(removeTaskAssignments([task], new Set(['unknown']))[0].groupAssignments?.length, 8);
});

test('grouped caches cannot reuse another tenant or account response', () => {
  const params = { grouped: true, viewMode: 'list' as const, page: 1, pageSize: 20 };
  assert.notEqual(buildTaskListKey({ ...params, accountScope: 'tenant-a:user-1' }), buildTaskListKey({ ...params, accountScope: 'tenant-b:user-1' }));
  assert.notEqual(buildTaskListKey({ ...params, accountScope: 'tenant-a:user-1' }), buildTaskListKey({ ...params, accountScope: 'tenant-a:user-2' }));
});


test('overall party status uses all immutable status identities, never just the representative label', () => {
  const task = grouped();
  assert.match(renderToStaticMarkup(<GroupQuestStatus task={task} />), /Overall status: Mixed statuses/);
  task.groupAssignments = [member(0), { ...member(1), status: TaskStatus.DEPLOYED }];
  assert.match(renderToStaticMarkup(<GroupQuestStatus task={task} />), /Overall status: Party complete/);
  task.groupAssignments = [{ ...member(7), customStatusId: 'custom-one', statusTitle: 'Shared label' }, { ...member(6), customStatusId: 'custom-two', statusTitle: 'Shared label' }];
  assert.match(renderToStaticMarkup(<GroupQuestStatus task={task} />), /Mixed statuses/);
  task.groupAssignments = [];
  assert.match(renderToStaticMarkup(<GroupQuestStatus task={task} />), /No assignments/);
});

test('quest party preserves every member, independent rewards and server edit permissions', () => {
  const tasks = grouped().groupAssignments!.map((task, index) => ({ ...task, canEdit: index === 3 }));
  const html = renderToStaticMarkup(<QuestParty assignments={tasks} usersMap={new Map()} currentUser={{ id: 'owner', role: 'owner' } as any}
    currentTaskId="assignment-3" loading={false} error={null} onRetry={() => {}} onOpenAssignment={() => {}} />);
  assert.equal((html.match(/data-party-assignment-id=/g) || []).length, 8);
  assert.equal((html.match(/Manage assignment for/g) || []).length, 1);
  assert.equal((html.match(/View assignment for/g) || []).length, 7);
  assert.equal((html.match(/XP estimate:/g) || []).length, 8);
  assert.match(html, /Current assignment/);
  assert.match(html, /Quest Party/);
});

test('quest party has explicit loading, empty, error and disabled refresh states', () => {
  const props = { assignments: [], usersMap: new Map(), currentUser: null, currentTaskId: 'one', onRetry: () => {}, onOpenAssignment: () => {} };
  assert.match(renderToStaticMarkup(<QuestParty {...props} loading error={null} />), /role="status"/);
  assert.match(renderToStaticMarkup(<QuestParty {...props} loading={false} error={null} />), /No visible member assignments/);
  const html = renderToStaticMarkup(<QuestParty {...props} loading error="Party unavailable" />);
  assert.match(html, /role="alert"/); assert.match(html, /Retry party/); assert.match(html, /disabled=""/);
});


test('party avatars reuse directory profile frames and readable fallback names', () => {
  const task = grouped();
  const directory = new Map([['member-0', { id: 'member-0', name: 'Current member profile', avatarFrame: 'emerald', avatarUrl: null } as any]]);
  const html = renderToStaticMarkup(<TaskGroupMembers task={task} usersMap={directory} onOpenAssignment={() => {}} />);
  assert.match(html, /ring-emerald-400/);
  assert.match(html, /Current member profile&#x27;s avatar/);
});


test('missing snapshots retain actual member counts; current directory names win consistently', () => {
  const task = grouped(); task.groupAssignments = task.groupAssignments!.map(task => ({ ...task, assignedMember: null }));
  const directory = new Map([['member-0', { id: 'member-0', name: 'Renamed member', avatarUrl: null } as any]]);
  const summary = taskGroupSummary(task, undefined, directory);
  assert.equal(summary.members.length, 8);
  assert.equal(summary.members[0].name, 'Renamed member');
  const html = renderToStaticMarkup(<TaskGroupMembers task={task} usersMap={directory} onOpenAssignment={() => {}} />);
  assert.match(html, /8 assigned members/); assert.match(html, /Open assignment for Renamed member/);
  const mismatch = { ...member(0), assignedMember: { id: 'unrelated-user', name: 'Wrong person', avatarUrl: null } };
  assert.equal(assignmentMember(mismatch)?.id, 'member-0');
  assert.equal(assignmentMember(mismatch)?.name, 'Assigned member');
  assert.equal(assignmentMember({ ...member(0), assignedTo: null }), null);
});

test('group reward estimates match individual pending, overdue, held and completed projections', () => {
  const now = new Date('2026-01-03T00:00:00Z');
  const tasks = [{ ...member(0), dueAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z' },
    { ...member(2), dueAt: '2026-01-01T00:00:00Z' },
    { ...member(3), dueAt: '2026-01-05T00:00:00Z' },
    { ...member(4), status: TaskStatus.ON_HOLD, dueAt: '2026-01-02T00:00:00Z', holdStartedAt: '2026-01-01T00:00:00Z' },
    { ...member(5), status: TaskStatus.FAILED }];
  const points = tasks.map(task => calculateTaskPoints(task, undefined, now));
  const summary = taskGroupSummary({ ...member(7), groupAssignments: tasks }, now);
  assert.notEqual(points[1].potentialEarlyTotal, points[1].potentialLateTotal);
  assert.equal(summary.potential, points.slice(1).reduce((sum, point) => sum + summarizeTaskPoints(point).value, 0));
  assert.equal(summary.awarded, points[0].totalAwarded);
  assert.equal(summary.complete, 1); assert.equal(summary.progress, 20);
});

test('group selection exposes partial state without selecting hidden or unrelated IDs', () => {
  const task = grouped();
  assert.deepEqual(taskSelectionState(task, new Set(['unrelated'])), { checked: false, indeterminate: false });
  assert.deepEqual(taskSelectionState(task, new Set(['assignment-3'])), { checked: false, indeterminate: true });
  assert.deepEqual(taskSelectionState(task, new Set(assignmentIds(task))), { checked: true, indeterminate: false });
  assert.deepEqual(taskSelectionState({ ...task, groupAssignments: [] }, new Set()), { checked: false, indeterminate: false });
});


test('bulk assignment actions bound concurrency and preserve input identity across independent failures', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => 'member-task-' + index);
  const calls: string[] = [];
  let active = 0, peak = 0;
  const results = await settleAssignmentActions(ids, async id => {
    calls.push(id); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    if (id === ids[2]) throw new Error('Forbidden assignment');
    return id;
  });
  assert.equal(peak, 4); assert.equal(new Set(calls).size, 12);
  assert.equal(results[2].status, 'rejected');
  for (let index = 0; index < ids.length; index++) {
    const result = results[index];
    if (result.status === 'fulfilled') assert.equal(result.value, ids[index]);
  }
  assert.deepEqual(await settleAssignmentActions([], async () => { throw Error('Must not run'); }), []);
});
