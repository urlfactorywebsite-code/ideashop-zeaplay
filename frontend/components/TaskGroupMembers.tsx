import React from 'react';
import { CheckCheck, Sparkles, UsersRound } from 'lucide-react';
import { Task, TaskStatus, User } from '../types';
import Avatar, { useAvatarIdentity, type AvatarPerson } from './Avatar';
import Tooltip from './ui/Tooltip';
import TaskStatusBadge from './ui/TaskStatusBadge';
import { assignmentMember, taskGroupSummary, visibleAssignments } from '../utils/taskGroups';
import { formatPointsValue } from '../utils/taskPoints';

export function GroupQuestIndicator() {
  return <span className="quest-party-label"><UsersRound size={14} aria-hidden="true" /> Group Quest</span>;
}

// A representative member's status must never masquerade as the whole party's status.
export function GroupQuestStatus({ task }: { task: Task }) {
  const assignments = visibleAssignments(task);
  const first = assignments[0];
  const uniform = first && assignments.every(member => (member.customStatusId || member.status) === (first.customStatusId || first.status));
  if (uniform) return <TaskStatusBadge status={first.status} customStatusId={first.customStatusId} statusTitle={first.statusTitle} />;
  const complete = assignments.length > 0 && assignments.every(member => member.status === TaskStatus.DONE || member.status === TaskStatus.DEPLOYED);
  return <span className="quest-overall-status" aria-label={`Overall status: ${complete ? 'Party complete' : first ? 'Mixed statuses' : 'No assignments'}`}>
    {complete ? <CheckCheck size={15} aria-hidden="true" /> : <UsersRound size={15} aria-hidden="true" />}
    {complete ? 'Party complete' : first ? 'Mixed statuses' : 'No assignments'}
  </span>;
}

function TaskGroupMembers({ task, onOpenAssignment, usersMap, compact = false }: {
  task: Task; onOpenAssignment: (id: string) => void; usersMap?: Map<string, User>; compact?: boolean;
}) {
  const summary = taskGroupSummary(task, undefined, usersMap);
  return <div className={`quest-group-members ${compact ? 'quest-group-members--compact' : ''}`} onClick={event => event.stopPropagation()}>
    <div className="quest-party-roster">
      <div className="quest-avatar-stack" role="group" aria-label="Assigned members">
        {summary.members.slice(0, 6).map((member, index) => <span key={member.id} className={index >= 4 ? 'quest-avatar-extra' : undefined}>
          <MemberAvatar member={member} />
        </span>)}
        {summary.members.length > 6 && <span role="img" className="quest-avatar-overflow quest-avatar-overflow--wide"
          aria-label={`${summary.members.length - 6} more members`}>+{summary.members.length - 6}</span>}
        {summary.members.length > 4 && <span role="img" className="quest-avatar-overflow quest-avatar-overflow--compact"
          aria-label={`${summary.members.length - 4} more members`}>+{summary.members.length - 4}</span>}
      </div>
      <span className="quest-member-count">{summary.members.length} assigned {summary.members.length === 1 ? 'member' : 'members'}</span>
    </div>
    <div className="quest-progress-heading"><span>Quest progress</span><span>{summary.progress}% ({summary.complete}/{summary.total} complete)</span></div>
    <progress className="quest-progress" max={Math.max(1, summary.total)} value={summary.complete}
      aria-label={`Overall progress for ${task.title}`} aria-valuetext={`${summary.complete} of ${summary.total} assignments complete (${summary.progress}%)`} />
    <div className="quest-rewards" title="Display estimate using the existing points configuration. Rewards remain independent for each assignment.">
      <Sparkles size={15} aria-hidden="true" />
      <span><span className="font-semibold">XP estimate:</span> {formatPointsValue(summary.awarded)} completed <span aria-hidden="true">/</span> {formatPointsValue(summary.potential)} potential remaining</span>
    </div>
    <details className="quest-assignment-details">
      <summary className="quest-focus">View {summary.total} {summary.total === 1 ? 'assignment' : 'assignments'}</summary>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {summary.assignments.map(assignment => <AssignmentLink key={assignment.id} assignment={assignment} usersMap={usersMap} onOpenAssignment={onOpenAssignment} />)}
      </ul>
    </details>
  </div>;
}

function MemberAvatar({ member }: { member: AvatarPerson }) {
  const { person } = useAvatarIdentity(member);
  return <Tooltip text={person?.name || 'Assigned member'} dismissOnEscape constrainToViewport hoverable className="quest-member-tooltip" triggerClassName="rounded-full">
    <Avatar user={person} size={32} />
  </Tooltip>;
}

function AssignmentLink({ assignment, usersMap, onOpenAssignment }: { assignment: Task; usersMap?: Map<string, User>; onOpenAssignment: (id: string) => void }) {
  const { person } = useAvatarIdentity(assignmentMember(assignment, usersMap));
  const name = person?.name || 'Unassigned';
  return <li><button type="button" onClick={() => onOpenAssignment(assignment.id)} className="quest-assignment-link quest-focus" aria-label={`Open assignment for ${name}`}>
    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{name}</span>
    <TaskStatusBadge status={assignment.status} customStatusId={assignment.customStatusId} statusTitle={assignment.statusTitle} />
  </button></li>;
}

export default React.memo(TaskGroupMembers);
