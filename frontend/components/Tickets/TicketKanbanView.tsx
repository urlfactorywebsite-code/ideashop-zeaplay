import React from 'react';
import { Ticket, TicketStatus } from '../../types';
import { TicketCard } from './TicketCard';

interface TicketKanbanViewProps {
  tickets: Ticket[];
  loading: boolean;
  onTicketUpdate: () => void;
  onSelectTicket?: (ticket: Ticket) => void;
}

const TicketKanbanView: React.FC<TicketKanbanViewProps> = ({
  tickets,
  loading,
  onTicketUpdate,
  onSelectTicket,
}) => {
  const columns = [
    { id: TicketStatus.OPEN, title: 'Open', color: 'bg-blue-100 dark:bg-blue-900' },
    { id: TicketStatus.IN_PROGRESS, title: 'In Progress', color: 'bg-yellow-100 dark:bg-yellow-900' },
    { id: TicketStatus.WAITING, title: 'Waiting', color: 'bg-orange-100 dark:bg-orange-900' },
    { id: TicketStatus.RESOLVED, title: 'Resolved', color: 'bg-green-100 dark:bg-green-900' },
    { id: TicketStatus.CLOSED, title: 'Closed', color: 'bg-gray-100 dark:bg-gray-900' },
  ];

  const getTicketsByStatus = (status: TicketStatus) => {
    return tickets.filter(ticket => ticket.status === status);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-full overflow-x-auto pb-6">
      {columns.map(column => {
        const columnTickets = getTicketsByStatus(column.id);
        return (
          <div key={column.id} className="flex-shrink-0 w-80">
            <div className={`${column.color} rounded-lg p-4 mb-4`}>
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center justify-between">
                {column.title}
                <span className="bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full text-sm">
                  {columnTickets.length}
                </span>
              </h3>
            </div>
            <div className="space-y-3 min-h-[400px]">
              {columnTickets.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onUpdate={onTicketUpdate}
                  onSelectTicket={onSelectTicket}
                />
              ))}
              {columnTickets.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No tickets
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TicketKanbanView;
