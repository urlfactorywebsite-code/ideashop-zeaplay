import React, { useId } from 'react';
import { ArrowUpRight, RefreshCw, UsersRound } from 'lucide-react';
import { Task, User } from '../types';
import Avatar, { useAvatarIdentity } from './Avatar';
import TaskStatusBadge from './ui/TaskStatusBadge';
import { calculateTaskPoints, formatPointsValue, summarizeTaskPoints } from '../utils/taskPoints';
import { loadPointsConfig, type PointsConfig } from '../utils/pointsConfigStorage';
import { assignmentMember } from '../utils/taskGroups';
import { taskPermissions } from '../utils/taskPermissions';

type QuestPartyProps = {
  assignments: Task[];
  usersMap: Map<string, User>;
  currentUser: User | null;
  currentTaskId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenAssignment: (id: string) => void;
  busy?: boolean;
};

/** Uses only permission-filtered group results; mutations stay in the existing assignment editor. */
function QuestParty({ assignments, usersMap, currentUser, currentTaskId, loading, error, onRetry, onOpenAssignment, busy = false }: QuestPartyProps) {
  const headingId = useId();
  const config = loadPointsConfig();
  return <section className="quest-party-panel" aria-labelledby={headingId} aria-busy={loading}>
    <div className="quest-party-heading">
      <div><p className="quest-party-label"><UsersRound size={15} aria-hidden="true" /> Assigned Members</p>
        <h3 id={headingId} className="mt-1 text-base font-semibold">Quest Party</h3></div>
      <span className="quest-overall-status">{assignments.length} {assignments.length === 1 ? 'assignment' : 'assignments'}</span>
    </div>
    <p className="quest-party-help">Each member has independent progress and rewards. Open an assignment to use its permitted status, timer and task actions.</p>
    {loading && <p role="status" className="quest-party-help">Loading quest party...</p>}
    {error && <div role="alert" className="quest-party-error"><p>{error}</p>
      <button type="button" className="quest-party-action quest-focus" disabled={loading} onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Retry party</button>
    </div>}
    {!loading && !error && assignments.length === 0 && <p className="quest-party-help">No visible member assignments.</p>}
    {!error && <ul className="quest-party-list">
      {assignments.map(assignment => <QuestPartyMember key={assignment.id} assignment={assignment} usersMap={usersMap} currentUser={currentUser}
        currentTaskId={currentTaskId} busy={busy || loading} onOpenAssignment={onOpenAssignment} config={config} />)}
    </ul>}
  </section>;
}

function QuestPartyMember({ assignment, usersMap, currentUser, currentTaskId, busy, onOpenAssignment, config }: Pick<QuestPartyProps, 'usersMap' | 'currentUser' | 'currentTaskId' | 'busy' | 'onOpenAssignment'> & { assignment: Task; config: PointsConfig }) {
  const { person } = useAvatarIdentity(assignmentMember(assignment, usersMap));
  const member = person ?? { name: 'Unassigned', avatarUrl: null };
  const points = summarizeTaskPoints(calculateTaskPoints(assignment, config));
  const canEdit = taskPermissions(assignment, currentUser).canEdit;
  return <li key={assignment.id} className="quest-party-member" data-party-assignment-id={assignment.id}>
    <div className="quest-party-member-heading"><Avatar user={member} size={36} />
      <div className="min-w-0 flex-1"><p className="font-semibold break-words [overflow-wrap:anywhere]">{member.name}</p>
        {assignment.id === currentTaskId && <span className="quest-current-assignment">Current assignment</span>}
      </div>
    </div>
    <div className="mt-2 flex flex-wrap gap-2"><TaskStatusBadge status={assignment.status} customStatusId={assignment.customStatusId} statusTitle={assignment.statusTitle} /></div>
    <p className="quest-member-xp" data-tone={points.tone}>XP estimate: {points.label}: {formatPointsValue(points.value)}</p>
    <p className="quest-party-help">{points.detail}</p>
    <button type="button" className="quest-party-action quest-focus" disabled={busy} onClick={() => onOpenAssignment(assignment.id)}
      aria-label={`${canEdit ? 'Manage' : 'View'} assignment for ${member.name}`}>
      {canEdit ? 'Manage assignment' : 'View assignment'} <ArrowUpRight size={13} aria-hidden="true" />
    </button>
  </li>;

}

export default React.memo(QuestParty);
