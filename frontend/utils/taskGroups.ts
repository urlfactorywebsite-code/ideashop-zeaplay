import { Task, TaskStatus, User } from '../types';
import { calculateTaskPoints, summarizeTaskPoints } from './taskPoints';
import { loadPointsConfig } from './pointsConfigStorage';

export const visibleAssignments = (task: Task): Task[] => task.groupAssignments ?? [task];
export const assignmentIds = (task: Task): string[] => visibleAssignments(task).map(member => member.id);

// Reconcile by assignment ID only. Never add a row that was not in this authorized group.
export const replaceAssignment = (tasks: Task[], updated: Task): Task[] => tasks.map(task => {
  if (!task.groupAssignments) return task.id === updated.id ? updated : task;
  if (!task.groupAssignments.some(member => member.id === updated.id)) return task;
  return { ...(task.id === updated.id ? updated : task),
    groupAssignments: task.groupAssignments.map(member => member.id === updated.id ? updated : member) };
});

export const logicalTaskKey = (task: Task): string => JSON.stringify([
  !!task.taskGroupId, task.taskGroupId || task.id, task.projectId ?? null, task.projectId ? '' : task.createdBy,
]);

export const replaceVisibleGroup = (tasks: Task[], reference: Task, assignments: Task[]): Task[] => tasks.flatMap(task => {
  if (logicalTaskKey(task) !== logicalTaskKey(reference)) return [task];
  if (!assignments.length) return [];
  return [{ ...(assignments.find(member => member.id === task.id) ?? assignments[0]), groupAssignments: assignments }];
});

export const formatAssignmentTime = (seconds = 0): string => {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

// The API owns authorization; this only names a server-filtered personal view.
export const isOwnAssignmentView = (assignments: Task[], user?: User | null): boolean =>
  !!user && assignments.length === 1 && assignments[0].createdBy !== user.id &&
  assignments[0].assignedTo?.[0] === user.id;

export const taskSelectionState = (task: Task, selected: ReadonlySet<string>) => {
  const ids = assignmentIds(task);
  const count = ids.filter(id => selected.has(id)).length;
  return { checked: ids.length > 0 && count === ids.length, indeterminate: count > 0 && count < ids.length };
};

// Assignment IDs own membership. Profile metadata can be absent or stale on legacy records.
export const assignmentMember = (task: Task, usersMap?: ReadonlyMap<string, User>) => {
  const id = task.assignedTo?.[0];
  if (!id) return null;
  const snapshot = task.assignedMember?.id === id ? task.assignedMember : null;
  const profile = usersMap?.get(id);
  return { ...snapshot, ...profile, id, name: profile?.name || snapshot?.name || 'Assigned member',
    avatarUrl: profile ? profile.avatarUrl ?? null : snapshot?.avatarUrl ?? null };
};

// Membership comes only from the server-filtered assignments, never the directory.
export const assignmentMembers = (task: Task, usersMap?: ReadonlyMap<string, User>) =>
  [...new Map(visibleAssignments(task).flatMap(assignment => {
    const member = assignmentMember(assignment, usersMap);
    return member ? [[member.id, member] as const] : [];
  })).values()];

// Display-only aggregation. XP awards, timers and mutations continue to use assignment IDs.
export const taskGroupSummary = (task: Task, now = new Date(), usersMap?: ReadonlyMap<string, User>) => {
  const assignments = visibleAssignments(task);
  const complete = assignments.filter(member => member.status === TaskStatus.DONE || member.status === TaskStatus.DEPLOYED).length;
  const config = loadPointsConfig();
  const points = assignments.map(member => calculateTaskPoints(member, config, now));
  return {
    assignments, complete, total: assignments.length,
    progress: assignments.length ? Math.round(complete / assignments.length * 100) : 0,
    awarded: points.reduce((sum, item) => sum + item.totalAwarded, 0),
    potential: points.reduce((sum, item) => sum + (item.isCompleted || item.status === 'failed' ? 0 : summarizeTaskPoints(item).value), 0),
    mixed: new Set(assignments.map(member => member.customStatusId || member.status)).size > 1,
    members: assignmentMembers(task, usersMap),
  };
};

// Remove only acknowledged deletions; never turn an empty group back into its old representative.
export const removeTaskAssignments = (tasks: Task[], deleted: ReadonlySet<string>): Task[] => tasks.flatMap(task => {
  if (!task.groupAssignments) return deleted.has(task.id) ? [] : [task];
  const remaining = task.groupAssignments.filter(member => !deleted.has(member.id));
  if (!remaining.length) return [];
  const representative = deleted.has(task.id) ? remaining[0] : task;
  return [{ ...representative, groupAssignments: remaining }];
});

// Keep large selections from issuing hundreds of simultaneous assignment mutations.
export const settleAssignmentActions = async (ids: readonly string[], action: (id: string) => Promise<unknown>) => {
  const results: PromiseSettledResult<unknown>[] = new Array(ids.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await action(ids[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
};
