import React, { useEffect, useMemo, useState } from 'react';
import { BoltIcon } from '@heroicons/react/24/solid';
import api from '../../services/api';
import { Ticket, TicketApprovalCycle, TicketStatus, TicketTimeline, User } from '../../types';
import { getUserAvatarUrl } from '../../utils/userAvatar';

interface TicketStatusTimelineProps {
  ticket: Ticket;
  approvals: TicketApprovalCycle[];
}

const STAGES = [
  { key: 'CREATED', label: 'Created' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'APPROVAL', label: 'Approval' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
];

const stageFromStatus = (status: TicketStatus) => {
  if (status === TicketStatus.WAITING) return 'APPROVAL';
  if (status === TicketStatus.IN_PROGRESS) return 'IN_PROGRESS';
  if (status === TicketStatus.RESOLVED) return 'RESOLVED';
  if (status === TicketStatus.CLOSED) return 'CLOSED';
  return 'ASSIGNED';
};

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : '');
const formatDuration = (seconds?: number | null) => {
  if (!seconds) return 'In progress';
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours) {
    return `${hours}h ${remainder}m`;
  }
  return `${minutes}m`;
};
const TicketStatusTimeline: React.FC<TicketStatusTimelineProps> = ({ ticket, approvals }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [timeline, setTimeline] = useState<TicketTimeline | null>(null);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ticket.id) return;
    api.getTicketTimeline(ticket.id).then(setTimeline).catch(() => {});
  }, [ticket.id]);

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const latestApproval = approvals[0];
  const history = ticket.statusHistory ?? [];

  const stageMeta = useMemo(() => {
    const entries = new Map(history.map((item) => [item.toStatus, item]));
    const orderedEntries = history
      .slice()
      .sort((a, b) => new Date(a.movedAtUtc).getTime() - new Date(b.movedAtUtc).getTime());
    const stageTimes: Record<string, { enteredAt?: string | null; completedAt?: string | null; movedBy?: string | null }> = {};

    STAGES.forEach((stage) => {
      const entry = entries.get(stage.key);
      if (entry) {
        stageTimes[stage.key] = {
          enteredAt: entry.movedAtUtc,
          movedBy: entry.actorUserId ?? null,
        };
      }
    });

    orderedEntries.forEach((entry, index) => {
      const next = orderedEntries[index + 1];
      if (!stageTimes[entry.toStatus]) return;
      stageTimes[entry.toStatus].completedAt = next?.movedAtUtc ?? null;
    });

    if (latestApproval) {
      stageTimes.APPROVAL = {
        enteredAt: latestApproval.requestedAtUtc,
        completedAt: latestApproval.completedAtUtc ?? null,
        movedBy: latestApproval.requestedBy,
      };
    }

    if (!stageTimes.CREATED) {
      stageTimes.CREATED = { enteredAt: ticket.createdAt, completedAt: null, movedBy: ticket.createdBy };
    }
    return stageTimes;
  }, [history, latestApproval, ticket.createdAt, ticket.createdBy]);

  const currentStage = stageFromStatus(ticket.status);
  const activeIndex = Math.max(0, STAGES.findIndex((stage) => stage.key === currentStage));

  const stageAvatars = (stageKey: string) => {
    if (stageKey === 'APPROVAL' && latestApproval) {
      return latestApproval.approvers.map((item) => item.approverUserId);
    }
    if (stageKey === 'CREATED') return ticket.createdBy ? [ticket.createdBy] : [];
    return ticket.assignedUserId ? [ticket.assignedUserId] : [];
  };

  const renderAvatar = (userId: string, size: string) => {
    const info = userMap.get(userId);
    const avatarUrl = getUserAvatarUrl(info);
    if (avatarUrl) {
      return <img src={avatarUrl} alt={info?.name} className={`${size} rounded-full object-cover`} />;
    }
    return (
      <div className={`${size} rounded-full bg-white/10 flex items-center justify-center text-[10px] font-semibold text-white`}>
        {(info?.name || '?').slice(0, 2).toUpperCase()}
      </div>
    );
  };
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 px-3 py-4 sm:px-5 sm:py-5">
      <div className="relative overflow-x-auto pb-2">
        <div className="relative min-w-[720px] sm:min-w-0">
          <div className="absolute left-0 right-0 top-9 h-0.5 bg-white/10" />
          <div className="relative flex items-start justify-between gap-4">
          {STAGES.map((stage, index) => {
            const isCompleted = history.some((item) => item.toStatus === stage.key) && index < activeIndex;
            const isCurrent = index === activeIndex;
            const avatars = stageAvatars(stage.key);
            const stacked = avatars.slice(0, 3);
            const extra = avatars.length - stacked.length;
            const meta = stageMeta[stage.key];
            const movedByName = meta?.movedBy ? userMap.get(meta.movedBy)?.name : 'System';
            const durationMs = meta?.enteredAt && meta?.completedAt
              ? new Date(meta.completedAt).getTime() - new Date(meta.enteredAt).getTime()
              : null;
            const durationLabel = durationMs
              ? `${Math.max(1, Math.round(durationMs / 60000))} min`
              : 'In progress';

            return (
              <div key={stage.key} className="group flex flex-col items-center">
                <div
                  className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition ${
                    isCurrent
                      ? 'border-cyan-300 bg-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.7)]'
                      : isCompleted
                        ? 'border-emerald-300 bg-emerald-400/20 shadow-[0_0_16px_rgba(34,197,94,0.5)]'
                        : 'border-white/20 bg-black/40'
                  }`}
                >
                  <div className="flex -space-x-2">
                    {stacked.map((userId) => (
                      <div key={userId} className="border border-black/60 rounded-full">
                        {renderAvatar(userId, 'h-6 w-6')}
                      </div>
                    ))}
                    {extra > 0 && (
                      <div className="h-6 w-6 rounded-full border border-white/20 bg-black/60 text-[10px] text-white/70 flex items-center justify-center">
                        +{extra}
                      </div>
                    )}
                  </div>
                  {isCurrent && (
                    <div className="absolute -top-6 flex items-center gap-1 rounded-full border border-primary/50 bg-primary/20 px-2 py-0.5 text-[10px] text-primary">
                      <BoltIcon className="h-3 w-3" />
                      Train
                    </div>
                  )}
                </div>
                <span className={`mt-2 text-[11px] ${isCurrent || isCompleted ? 'text-white' : 'text-white/50'}`}>
                  {stage.label}
                </span>

                <div className="pointer-events-none absolute z-10 mt-4 w-56 rounded-xl border border-white/10 bg-black/80 p-3 text-xs text-white/70 opacity-0 shadow-lg transition group-hover:opacity-100">
                  <div className="text-sm font-semibold text-white">{stage.label}</div>
                  <div className="mt-2">Moved by: {movedByName || 'System'}</div>
                  {meta?.enteredAt && <div className="mt-1">Requested: {formatDate(meta.enteredAt)}</div>}
                  {meta?.completedAt && <div className="mt-1">Completed: {formatDate(meta.completedAt)}</div>}
                  <div className="mt-1">Duration: {durationLabel}</div>
                </div>

                {index < STAGES.length - 1 && (
                  <div
                    className={`absolute top-9 left-[calc(50%+40px)] h-0.5 w-[calc(100%/5-16px)] ${
                      isCompleted
                        ? 'bg-emerald-400'
                        : isCurrent
                          ? 'bg-cyan-400/60 animate-pulse'
                          : 'border-t border-dashed border-white/20'
                    }`}
                  />
                )}
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {timeline && (
        <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-white/50">Stage timeline</p>
              {timeline.totalResolutionLabel && (
                <p className="mt-1 text-sm font-semibold text-white">
                  Total resolution: {timeline.totalResolutionLabel}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                const data = await api.exportTicketTimelineCsv(ticket.id);
                if (!data) return;
                const url = window.URL.createObjectURL(data.blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = data.filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
              }}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white hover:bg-white/20"
            >
              Export CSV
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {timeline.stages.map((stage) => (
              <div key={stage.stage} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">{stage.stage}</p>
                <p className="mt-1 text-sm text-white">{formatDuration(stage.timeSpentSeconds)}</p>
                {stage.entryTime && (
                  <p className="mt-1 text-[11px] text-white/50">Entered {formatDate(stage.entryTime)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketStatusTimeline;
