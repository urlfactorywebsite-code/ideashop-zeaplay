import { Task, TaskStatus, User } from '../types';
import { calculateTaskPoints, summarizeTaskPoints } from './taskPoints';
import { loadPointsConfig } from './pointsConfigStorage';

export const visibleAssignments = (task: Task): Task[] => task.groupAssignments ?? [task];
export const assignmentIds = (task: Task): string[] => visibleAssignments(task).map(member => member.id);

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
    members: [...new Map(assignments.flatMap(assignment => {
      const member = assignmentMember(assignment, usersMap);
      return member ? [[member.id, member] as const] : [];
    })).values()],
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
