import React from 'react';
import { Ticket, TicketPriority, TicketStatus } from '../../types';
import { ClockIcon, UserIcon, ChatBubbleLeftIcon, PaperClipIcon } from '@heroicons/react/24/outline';

interface TicketGridViewProps {
  tickets: Ticket[];
  loading: boolean;
  onTicketUpdate: () => void;
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

const TicketGridView: React.FC<TicketGridViewProps> = ({
  tickets,
  loading,
  onTicketUpdate,
  onSelectTicket,
}) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const isOverdue = (ticket: Ticket) => {
    return ticket.resolutionDueAt && new Date(ticket.resolutionDueAt) < new Date();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {tickets.map((ticket) => (
        <div
          key={ticket.id}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => onSelectTicket?.(ticket)}
        >
          <div className="flex items-start justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-2 flex-1">
              #{ticket.id.slice(-6)} - {ticket.title}
            </h3>
            <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${priorityColors[ticket.priority]}`}>
              {ticket.priority}
            </span>
          </div>

          <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 line-clamp-3">
            {ticket.description}
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[ticket.status]}`}>
                {ticket.status.replace('_', ' ')}
              </span>
              {isOverdue(ticket) && (
                <span className="text-red-600 dark:text-red-400 text-xs font-medium">
                  Overdue
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center space-x-1">
                <UserIcon className="h-3 w-3" />
                <span>{ticket.createdBy}</span>
              </div>
              <div className="flex items-center space-x-1">
                <ClockIcon className="h-3 w-3" />
                <span>{formatDate(ticket.createdAt)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ChatBubbleLeftIcon className="h-4 w-4 text-gray-400" />
                <PaperClipIcon className="h-4 w-4 text-gray-400" />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                SLA: {ticket.slaFirstResponseMinutes ? `${ticket.slaFirstResponseMinutes}m` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      ))}

      {tickets.length === 0 && (
        <div className="col-span-full flex items-center justify-center py-12">
          <div className="text-center">
            <p className="text-gray-500 dark:text-gray-400">No tickets found</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketGridView;
