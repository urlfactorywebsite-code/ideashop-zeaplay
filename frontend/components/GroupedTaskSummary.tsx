import React from 'react';
import type { Task, User } from '../types';
import { TaskStatus } from '../types';
import { assignmentMembers, visibleAssignments } from '../utils/taskGroups';
import { useTaskStatusLabels } from '../hooks/useTaskStatusLabels';
import { TaskAssigneeRoster } from './TaskGroupMembers';

export default function GroupedTaskSummary({ task, usersMap, compact = false }: { task: Task; usersMap?: Map<string, User>; compact?: boolean }) {
  const { label } = useTaskStatusLabels();
  const assignments = visibleAssignments(task);
  const complete = assignments.filter(member => member.status === TaskStatus.DONE || member.status === TaskStatus.DEPLOYED).length;
  const progress = assignments.length ? Math.round(complete / assignments.length * 100) : 0;
  const statuses = new Map<string, { name: string; count: number }>();
  for (const member of assignments) {
    const key = member.customStatusId || member.status;
    const entry = statuses.get(key);
    if (entry) entry.count++;
    else statuses.set(key, { name: label(member.status, member.customStatusId, member.statusTitle), count: 1 });
  }
  return <div className="grouped-task-summary">
    <TaskAssigneeRoster members={assignmentMembers(task, usersMap)} compact={compact} showSingleName={compact} />
    <div className="grouped-task-summary-heading"><span>{assignments.length} {assignments.length === 1 ? 'task' : 'assignments'}</span><span>{progress}% complete</span></div>
    <progress className="quest-progress" max={Math.max(1, assignments.length)} value={complete} aria-label={`Assignment progress for ${task.title}`} />
    <p className="grouped-task-status-summary" aria-label="Assignment status summary">{[...statuses.values()].map(entry => `${entry.count} ${entry.name}`).join(' · ') || 'No assignments'}</p>
    <span className="grouped-task-open-hint">{assignments.length === 1 ? 'View task' : 'View assignments'} <span aria-hidden="true">→</span></span>
  </div>;
}
