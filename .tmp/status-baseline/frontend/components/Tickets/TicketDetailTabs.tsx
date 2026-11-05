import React from 'react';
import { Ticket, User } from '../../types';
import { TicketChatMessage } from '../../hooks/useTicketChat';
import TicketChatPanel from './TicketChatPanel';
import TicketTasksPanel from './TicketTasksPanel';
import TicketLogsPanel from './TicketLogsPanel';

interface TicketDetailTabsProps {
  ticket: Ticket;
  activeTab: 'chat' | 'tasks' | 'logs';
  messages: TicketChatMessage[];
  onSendComment: () => void;
  commentText: string;
  setCommentText: (text: string) => void;
  chatConnected: boolean;
  isInternal: boolean;
  setIsInternal: (value: boolean) => void;
  onTyping?: (body?: string) => void;
  mentionUsers: User[];
  canCreateTask: boolean;
}

const TicketDetailTabs: React.FC<TicketDetailTabsProps> = ({
  ticket,
  activeTab,
  messages,
  onSendComment,
  commentText,
  setCommentText,
  chatConnected,
  isInternal,
  setIsInternal,
  onTyping,
  mentionUsers,
  canCreateTask,
}) => {
  return (
    <div className="px-6 py-4">
      {activeTab === 'chat' && (
        <TicketChatPanel
          ticket={ticket}
          messages={messages}
          onSendComment={onSendComment}
          commentText={commentText}
          setCommentText={setCommentText}
          connected={chatConnected}
          isInternal={isInternal}
          setIsInternal={setIsInternal}
          onTyping={onTyping}
          mentionUsers={mentionUsers}
        />
      )}

      {activeTab === 'tasks' && (
        <TicketTasksPanel ticketId={ticket.id} ticket={ticket} canCreate={canCreateTask} />
      )}

      {activeTab === 'logs' && (
        <TicketLogsPanel ticketId={ticket.id} />
      )}
    </div>
  );
};

export default TicketDetailTabs;
