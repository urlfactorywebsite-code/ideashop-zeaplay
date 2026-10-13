import React from 'react';
import { Bars3Icon, StarIcon } from '../../../components/icons';
import { User } from '../../../types';
import { ChatConversation } from '../types';
import { getConversationTitle } from '../utils/conversation';

type Props = {
  conversation: ChatConversation | null;
  currentUser?: User | null;
  presence?: 'ONLINE' | 'AWAY' | 'OFFLINE';
  detailsOpen: boolean;
  onOpenSidebar: () => void;
  onToggleDetails: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
};

const presenceText = {
  ONLINE: 'Available',
  AWAY: 'Active 15 minutes ago',
  OFFLINE: 'Active 1 hour ago',
};

const ChatHeader: React.FC<Props> = ({
  conversation,
  currentUser,
  presence = 'OFFLINE',
  detailsOpen,
  onOpenSidebar,
  onToggleDetails,
  favorite = false,
  onToggleFavorite,
}) => {
  if (!conversation) {
    return (
      <div className="chat-room-header">
        <button type="button" aria-label="Open conversations" onClick={onOpenSidebar} className="chat-icon-button lg:hidden">
          <Bars3Icon className="h-5 w-5" />
        </button>
        <span className="text-sm text-zinc-400">Select a conversation</span>
      </div>
    );
  }

  const title = getConversationTitle(conversation, currentUser);
  const subtitle = conversation.type === 'DIRECT'
    ? presenceText[presence]
    : `${conversation.members.length} members`;

  return (
    <div className="chat-room-header">
      <button type="button" aria-label="Open conversations" onClick={onOpenSidebar} className="chat-icon-button lg:hidden">
        <Bars3Icon className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-xl font-semibold text-white">{title}</h2>
          <button type="button" aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={onToggleFavorite}>
            <StarIcon className={`h-4 w-4 shrink-0 ${favorite ? 'text-amber-400' : 'text-zinc-500 hover:text-amber-400'}`} />
          </button>
        </div>
        <p className="truncate text-sm text-zinc-300">{subtitle}</p>
      </div>

      <div className="hidden shrink-0 items-center gap-6 px-2 text-sm text-zinc-300 md:flex">
        <button type="button" className="chat-header-tab chat-header-tab-active">
          Messages
        </button>
        <button
          type="button"
          onClick={onToggleDetails}
          className={`chat-header-tab ${detailsOpen ? 'chat-header-tab-active' : ''}`}
        >
          Profile
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;
