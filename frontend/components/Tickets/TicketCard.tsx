import React from 'react';
import { Ticket, TicketPriority, TicketStatus } from '../../types';
import { ClockIcon, UserIcon, ChatBubbleLeftIcon, PaperClipIcon } from '@heroicons/react/24/outline';

interface TicketCardProps {
  ticket: Ticket;
  onUpdate: () => void;
  onSelectTicket?: (ticket: Ticket) => void;
}

const priorityColors = {
  [TicketPriority.LOW]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  [TicketPriority.MEDIUM]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketPriority.HIGH]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketPriority.CRITICAL]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const statusColors = {
  [TicketStatus.OPEN]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  [TicketStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketStatus.WAITING]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketStatus.RESOLVED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  [TicketStatus.CLOSED]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, onUpdate, onSelectTicket }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const isOverdue = ticket.resolutionDueAt && new Date(ticket.resolutionDueAt) < new Date();

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onSelectTicket?.(ticket)}
    >
      <div className="flex items-start justify-between mb-3">
        <h4 className="font-medium text-gray-900 dark:text-white text-sm line-clamp-2">
          {ticket.title}
        </h4>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[ticket.priority]}`}>
          {ticket.priority}
        </span>
      </div>

      <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">
        {ticket.description}
      </p>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-3">
        <div className="flex items-center space-x-3">
          <span className={`px-2 py-1 rounded-full ${statusColors[ticket.status]}`}>
            {ticket.status.replace('_', ' ')}
          </span>
          {isOverdue && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              Overdue
            </span>
          )}
        </div>
        <span>#{ticket.id.slice(-6)}</span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <UserIcon className="h-3 w-3" />
            <span>{ticket.createdBy}</span>
          </div>
          <div className="flex items-center space-x-1">
            <ClockIcon className="h-3 w-3" />
            <span>{formatDate(ticket.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {/* Placeholder for chat/attachment indicators */}
          <ChatBubbleLeftIcon className="h-3 w-3" />
          <PaperClipIcon className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
};
