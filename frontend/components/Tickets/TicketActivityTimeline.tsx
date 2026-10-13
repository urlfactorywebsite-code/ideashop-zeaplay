import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Ticket, TicketActivityItem, User } from '../../types';
import api from '../../services/api';
import { useTicketActivity } from '../../hooks/useTicketActivity';
import { timeAgo } from '../../utils';

interface TicketActivityTimelineProps {
  ticket: Ticket;
}

const formatValue = (value?: string | null) => {
  if (!value) return 'Unknown';
  return value
    .toString()
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const TicketActivityTimeline: React.FC<TicketActivityTimelineProps> = ({ ticket }) => {
  const { activity, loading, error } = useTicketActivity(ticket.id);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
  }, []);

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const resolveActor = (actorId?: string | null) => {
    if (!actorId) return 'System';
    return userMap.get(actorId)?.name || actorId;
  };

  const getActivityIcon = (eventType: string, payload?: Record<string, unknown> | null) => {
    switch (eventType) {
      case 'ticket.created':
        return <ClockIcon className="h-5 w-5 text-sky-400" />;
      case 'ticket.updated':
        return <ArrowPathIcon className="h-5 w-5 text-blue-400" />;
      case 'ticket.status_changed':
        return <ArrowPathIcon className="h-5 w-5 text-amber-400" />;
      case 'ticket.assigned':
        return <UserPlusIcon className="h-5 w-5 text-emerald-400" />;
      case 'ticket.participants.updated': {
        const removed = (payload?.removed as Array<Record<string, string>> | undefined) || [];
        return removed.length ? (
          <UserMinusIcon className="h-5 w-5 text-rose-400" />
        ) : (
          <UserPlusIcon className="h-5 w-5 text-emerald-400" />
        );
      }
      case 'ticket.approval.requested':
        return <ShieldCheckIcon className="h-5 w-5 text-cyan-400" />;
      case 'ticket.approval.decision': {
        const decision = (payload?.decision as string | undefined)?.toUpperCase();
        if (decision === 'APPROVED') {
          return <CheckCircleIcon className="h-5 w-5 text-emerald-400" />;
        }
        if (decision === 'REJECTED') {
          return <XCircleIcon className="h-5 w-5 text-rose-400" />;
        }
        return <ShieldCheckIcon className="h-5 w-5 text-cyan-400" />;
      }
      case 'ticket.approval.result': {
        const status = (payload?.status as string | undefined)?.toUpperCase();
        if (status === 'APPROVED') {
          return <CheckCircleIcon className="h-5 w-5 text-emerald-400" />;
        }
        if (status === 'REJECTED') {
          return <XCircleIcon className="h-5 w-5 text-rose-400" />;
        }
        if (status === 'EXPIRED') {
          return <ExclamationTriangleIcon className="h-5 w-5 text-amber-400" />;
        }
        return <ShieldCheckIcon className="h-5 w-5 text-cyan-400" />;
      }
      case 'ticket.approval.expired':
        return <ExclamationTriangleIcon className="h-5 w-5 text-amber-400" />;
      case 'ticket.transferred':
        return <ArrowRightIcon className="h-5 w-5 text-indigo-400" />;
      case 'ticket.deleted':
        return <TrashIcon className="h-5 w-5 text-rose-400" />;
      case 'ticket.closed':
      case 'ticket.auto_resolved':
        return <CheckCircleIcon className="h-5 w-5 text-emerald-400" />;
      case 'ticket.reopened':
        return <ArrowPathIcon className="h-5 w-5 text-amber-400" />;
      case 'ticket.task_linked':
        return <PaperClipIcon className="h-5 w-5 text-indigo-400" />;
      case 'ticket.task_split':
        return <DocumentDuplicateIcon className="h-5 w-5 text-indigo-400" />;
      case 'ticket.comment.created':
        return <ChatBubbleLeftIcon className="h-5 w-5 text-emerald-400" />;
      default:
        return <ClockIcon className="h-5 w-5 text-gray-400" />;
    }
  };

  const describeActivity = (item: TicketActivityItem) => {
    const payload = item.payload as Record<string, unknown> | null | undefined;
    switch (item.eventType) {
      case 'ticket.created':
        return {
          title: 'Ticket created',
          detail: payload?.priority ? `Priority ${formatValue(String(payload.priority))}` : null,
        };
      case 'ticket.updated': {
        const fields = payload ? Object.keys(payload) : [];
        if (!fields.length) {
          return { title: 'Ticket updated', detail: null };
        }
        const labels = fields.map((field) => formatValue(field));
        return { title: 'Ticket updated', detail: `Updated ${labels.join(', ')}` };
      }
      case 'ticket.status_changed':
        return {
          title: 'Status changed',
          detail:
            payload?.from_status && payload?.to_status
              ? `${formatValue(String(payload.from_status))} -> ${formatValue(String(payload.to_status))}`
              : null,
        };
      case 'ticket.assigned': {
        const assignees = (payload?.assignee_ids as string[] | undefined) || [];
        const names = assignees.map((id) => userMap.get(id)?.name || id);
        return {
          title: 'Assignment updated',
          detail: names.length ? `Assigned to ${names.join(', ')}` : null,
        };
      }
      case 'ticket.participants.updated': {
        const added = (payload?.added as Array<Record<string, string>> | undefined) || [];
        const removed = (payload?.removed as Array<Record<string, string>> | undefined) || [];
        const addedNames = added.map((entry) => userMap.get(entry.user_id)?.name || entry.user_id);
        const removedNames = removed.map((entry) => userMap.get(entry.user_id)?.name || entry.user_id);
        const detailParts = [];
        if (addedNames.length) detailParts.push(`Added ${addedNames.join(', ')}`);
        if (removedNames.length) detailParts.push(`Removed ${removedNames.join(', ')}`);
        return {
          title: 'Participants updated',
          detail: detailParts.length ? detailParts.join(' | ') : null,
        };
      }
      case 'ticket.approval.requested':
        return {
          title: 'Approval requested',
          detail: payload?.attempt_no ? `Attempt ${payload.attempt_no}` : null,
        };
      case 'ticket.approval.decision':
        return {
          title: 'Approval decision',
          detail: payload?.decision ? formatValue(String(payload.decision)) : null,
        };
      case 'ticket.approval.result':
        return {
          title: 'Approval result',
          detail: payload?.status ? formatValue(String(payload.status)) : null,
        };
      case 'ticket.approval.expired':
        return {
          title: 'Approval expired',
          detail: payload?.attempt_no ? `Attempt ${payload.attempt_no}` : null,
        };
      case 'ticket.transferred':
        return {
          title: 'Ticket transferred',
          detail: null,
        };
      case 'ticket.deleted':
        return {
          title: 'Ticket deleted',
          detail: null,
        };
      case 'ticket.closed':
        return {
          title: 'Ticket closed',
          detail: null,
        };
      case 'ticket.reopened':
        return {
          title: 'Ticket reopened',
          detail: null,
        };
      case 'ticket.task_linked':
        return {
          title: 'Task linked to ticket',
          detail: null,
        };
      case 'ticket.task_split':
        return {
          title: 'Ticket split into tasks',
          detail: null,
        };
      case 'ticket.auto_resolved':
        return {
          title: 'Ticket resolved automatically',
          detail: null,
        };
      case 'ticket.comment.created':
        return {
          title: 'Comment added',
          detail: payload?.body ? String(payload.body) : null,
        };
      default:
        return { title: formatValue(item.eventType), detail: null };
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading activity...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        Activity Timeline
      </h3>

      <div className="space-y-6">
        {activity.map((item, index) => {
          const content = describeActivity(item);
          return (
            <div key={item.id} className="flex space-x-4">
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-full">
                  {getActivityIcon(item.eventType, item.payload ?? null)}
                </div>
                {index < activity.length - 1 && (
                  <div className="w-0.5 h-16 bg-gray-200 dark:bg-gray-600 mt-2" />
                )}
              </div>

              <div className="flex-1 pb-6">
                <div className="flex items-center space-x-2 mb-1">
                  <UserIcon className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {resolveActor(item.actorId)}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {timeAgo(item.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{content.title}</p>
                {content.detail && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {content.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {activity.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No activity yet</p>
        </div>
      )}
    </div>
  );
};

export default TicketActivityTimeline;
