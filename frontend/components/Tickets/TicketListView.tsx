import React from 'react';
import { Ticket, TicketPriority, TicketStatus } from '../../types';
import { ClockIcon, UserIcon, ChatBubbleLeftIcon, PaperClipIcon } from '@heroicons/react/24/outline';

interface TicketListViewProps {
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

const TicketListView: React.FC<TicketListViewProps> = ({
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
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Ticket
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Priority
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Created By
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => onSelectTicket?.(ticket)}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        #{ticket.id.slice(-6)}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 max-w-xs">
                        {ticket.title}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusColors[ticket.status]}`}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                  {isOverdue(ticket) && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Overdue
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${priorityColors[ticket.priority]}`}>
                    {ticket.priority}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {ticket.createdBy}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {formatDate(ticket.createdAt)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center space-x-2">
                    <ChatBubbleLeftIcon className="h-4 w-4 text-gray-400" />
                    <PaperClipIcon className="h-4 w-4 text-gray-400" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tickets.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No tickets found</p>
        </div>
      )}
    </div>
  );
};

export default TicketListView;
