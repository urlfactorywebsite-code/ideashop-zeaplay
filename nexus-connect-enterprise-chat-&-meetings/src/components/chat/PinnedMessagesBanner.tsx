import React, { useState } from 'react';
import { Message, User } from '../../types';
import { Pin, ChevronRight, X, ChevronLeft } from 'lucide-react';
import { useChat } from '../../context/ChatContext';

interface PinnedMessagesBannerProps {
  pinnedMessages: Message[];
  usersMap: Map<string, User>;
  onJumpToMessage: (id: string) => void;
}

export const PinnedMessagesBanner: React.FC<PinnedMessagesBannerProps> = ({
  pinnedMessages,
  usersMap,
  onJumpToMessage,
}) => {
  const { togglePin } = useChat();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!pinnedMessages || pinnedMessages.length === 0) return null;

  const currentMsg = pinnedMessages[currentIndex] || pinnedMessages[0];
  const sender = currentMsg ? usersMap.get(currentMsg.senderId) : null;

  return (
    <div className="bg-amber-500/10 dark:bg-amber-500/15 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs select-none">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
          <Pin className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="font-bold text-amber-900 dark:text-amber-200 shrink-0">
            Pinned ({currentIndex + 1}/{pinnedMessages.length}):
          </span>
          <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">
            {sender?.displayName || 'User'}:
          </span>
          <p
            onClick={() => onJumpToMessage(currentMsg.id)}
            className="truncate text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
          >
            {currentMsg.content || (currentMsg.attachments?.length ? 'Attachment' : 'Message')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-3">
        {pinnedMessages.length > 1 && (
          <div className="flex items-center gap-0.5 mr-2">
            <button
              onClick={() => setCurrentIndex(prev => (prev > 0 ? prev - 1 : pinnedMessages.length - 1))}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-amber-500/20"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCurrentIndex(prev => (prev < pinnedMessages.length - 1 ? prev + 1 : 0))}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-amber-500/20"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={() => togglePin(currentMsg.id)}
          className="p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-amber-500/20"
          title="Unpin message"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
