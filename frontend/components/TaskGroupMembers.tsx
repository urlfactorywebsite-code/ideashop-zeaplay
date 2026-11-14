import React from 'react';
import { CheckCheck, Sparkles, UsersRound } from 'lucide-react';
import { Task, TaskStatus, User } from '../types';
import Avatar, { useAvatarIdentity, type AvatarPerson } from './Avatar';
import Tooltip from './ui/Tooltip';
import TaskStatusBadge from './ui/TaskStatusBadge';
import { assignmentMember, isOwnAssignmentView, taskGroupSummary, visibleAssignments } from '../utils/taskGroups';
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

export function TaskAssigneeRoster({ members, compact = false, label, showSingleName = false }: {
  members: AvatarPerson[]; compact?: boolean; label?: string; showSingleName?: boolean;
}) {
  const limit = compact ? 4 : 6;
  return <div className={`quest-party-roster task-assignee-roster${compact ? ' task-assignee-roster--compact' : ''}`}>
    {members.length > 0 && <div className="quest-avatar-stack" role="group" aria-label="Assigned members">
      {members.slice(0, limit).map((member, index) => <span key={member.id} className={!compact && index >= 4 ? 'quest-avatar-extra' : undefined}>
        <MemberAvatar member={member} size={compact ? 28 : 32} />
      </span>)}
      {members.length > limit && <span role="img" className={`quest-avatar-overflow${compact ? '' : ' quest-avatar-overflow--wide'}`}
        aria-label={`${members.length - limit} more members`}>+{members.length - limit}</span>}
      {!compact && members.length > 4 && <span role="img" className="quest-avatar-overflow quest-avatar-overflow--compact"
        aria-label={`${members.length - 4} more members`}>+{members.length - 4}</span>}
    </div>}
    <span className="quest-member-count">{label || (members.length === 0 ? 'Unassigned'
      : showSingleName && members.length === 1 ? <MemberName member={members[0]} />
      : `${members.length} assigned ${members.length === 1 ? 'member' : 'members'}`)}</span>
  </div>;
}

function MemberName({ member }: { member: AvatarPerson }) {
  const { person } = useAvatarIdentity(member);
  return <>{person?.name || 'Assigned member'}</>;
}

function TaskGroupMembers({ task, onOpenAssignment, usersMap, currentUser, compact = false }: {
  task: Task; onOpenAssignment: (id: string) => void; usersMap?: Map<string, User>; currentUser?: User | null; compact?: boolean;
}) {
  const summary = taskGroupSummary(task, undefined, usersMap);
  const ownView = isOwnAssignmentView(summary.assignments, currentUser);
  return <div className={`quest-group-members ${compact ? 'quest-group-members--compact' : ''}`} onClick={event => event.stopPropagation()}>
    <TaskAssigneeRoster members={summary.members} label={ownView ? 'Your assignment' : undefined} />
    <div className="quest-progress-heading"><span>{ownView ? 'Your progress' : 'Quest progress'}</span><span>{summary.progress}% ({summary.complete}/{summary.total} complete)</span></div>
    <progress className="quest-progress" max={Math.max(1, summary.total)} value={summary.complete}
      aria-label={`${ownView ? 'Your' : 'Overall'} progress for ${task.title}`} aria-valuetext={`${summary.complete} of ${summary.total} assignments complete (${summary.progress}%)`} />
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

function MemberAvatar({ member, size = 32 }: { member: AvatarPerson; size?: number }) {
  const { person } = useAvatarIdentity(member);
  return <Tooltip text={person?.name || 'Assigned member'} dismissOnEscape constrainToViewport hoverable className="quest-member-tooltip" triggerClassName="rounded-full">
    <Avatar user={person} size={size} />
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
