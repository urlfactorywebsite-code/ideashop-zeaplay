import React from 'react';
import { UserIcon } from '@heroicons/react/24/outline';
import { TicketParticipantRole } from '../../types';
import { useTicketParticipants } from '../../hooks/useTicketParticipants';

interface TicketParticipantsSummaryProps {
  ticketId: string;
}

const roleBadge: Record<TicketParticipantRole, string> = {
  [TicketParticipantRole.OWNER]: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  [TicketParticipantRole.ASSIGNEE]: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  [TicketParticipantRole.FOLLOWER]: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-200',
};

const TicketParticipantsSummary: React.FC<TicketParticipantsSummaryProps> = ({ ticketId }) => {
  const { participants, users, loading } = useTicketParticipants(ticketId);

  const entries = participants.map((participant) => ({
    ...participant,
    user: users.find((user) => user.id === participant.userId),
  }));

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gray-400">Participants</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {participants.length} people
          </p>
        </div>
      </div>

      {loading && (
        <div className="mt-3 flex items-center justify-center rounded-lg border border-gray-200/60 bg-white/70 py-6 dark:border-gray-700/60 dark:bg-gray-900/60">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      )}

      {!loading && entries.length === 0 && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No participants yet.</p>
      )}

      {!loading && entries.length > 0 && (
        <div className="mt-3 space-y-2">
          {entries.slice(0, 5).map((participant) => (
            <div key={participant.userId} className="flex items-center gap-3 rounded-xl border border-gray-200/50 bg-white/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-900/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <UserIcon className="h-4 w-4 text-gray-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                  {participant.user?.name || participant.userId}
                </p>
                <p className="text-[11px] text-gray-400">
                  {participant.user?.email || 'No email'}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleBadge[participant.role]}`}>
                {participant.role.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketParticipantsSummary;
