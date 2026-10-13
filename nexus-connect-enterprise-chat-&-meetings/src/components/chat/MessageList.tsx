import React, { useEffect, useRef, useState } from 'react';
import { Conversation, Message, User } from '../../types';
import { MessageItem } from './MessageItem';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { ArrowDown, MessageSquare, Loader2 } from 'lucide-react';

interface MessageListProps {
  conversation: Conversation;
  messages: Message[];
  users: User[];
  isLoading: boolean;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onTogglePin: (messageId: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  conversation,
  messages,
  users,
  isLoading,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onTogglePin,
}) => {
  const { user } = useAuth();
  const { typingUsers, searchInChatTerm } = useChat();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const usersMap = new Map<string, User>(users.map(u => [u.id, u]));
  const messagesMap = new Map<string, Message>(messages.map(m => [m.id, m]));

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current && !showScrollBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showScrollBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
    setShowScrollBottom(!isNearBottom);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setShowScrollBottom(false);
    }
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-blue-500/20');
      setTimeout(() => el.classList.remove('bg-blue-500/20'), 1500);
    }
  };

  // Group messages by date
  const formatDateHeader = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Filter messages if search active
  const filteredMessages = searchInChatTerm.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchInChatTerm.toLowerCase()))
    : messages;

  // Typing status string
  const typingList = Object.values(typingUsers);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-1 py-4 space-y-2 relative"
    >
      {isLoading ? (
        <div className="h-full flex items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span className="text-xs">Loading secure message history...</span>
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-8">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            {searchInChatTerm ? 'No matching messages found' : `Welcome to ${conversation.name}`}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">
            {searchInChatTerm
              ? `No messages matched "${searchInChatTerm}" in this conversation.`
              : 'This is the start of the message history. Send a message, share documents, or start a call.'}
          </p>
        </div>
      ) : (
        <>
          {filteredMessages.map((msg, index) => {
            const sender = usersMap.get(msg.senderId) || null;
            const replyToMsg = msg.replyToId ? messagesMap.get(msg.replyToId) : null;
            const replyToSender = replyToMsg ? usersMap.get(replyToMsg.senderId) : null;

            // Date separator check
            const prevMsg = index > 0 ? filteredMessages[index - 1] : null;
            const showDateHeader =
              !prevMsg ||
              new Date(prevMsg.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();

            return (
              <React.Fragment key={msg.id}>
                {showDateHeader && (
                  <div className="flex items-center my-4 px-4 select-none">
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                    <span className="mx-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-slate-100 dark:border-slate-800">
                      {formatDateHeader(msg.createdAt)}
                    </span>
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                  </div>
                )}

                <MessageItem
                  message={msg}
                  sender={sender}
                  currentUser={user}
                  replyToMessage={replyToMsg}
                  replyToSender={replyToSender}
                  searchHighlight={searchInChatTerm}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleReaction={onToggleReaction}
                  onTogglePin={onTogglePin}
                  onJumpToMessage={jumpToMessage}
                />
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* Typing indicator wave */}
      {typingList.length > 0 && (
        <div className="px-4 py-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 animate-in fade-in duration-150">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
          </div>
          <span className="text-[11px] italic">
            {typingList.length === 1
              ? `${typingList[0]} is typing...`
              : typingList.length === 2
              ? `${typingList[0]} and ${typingList[1]} are typing...`
              : 'Several colleagues are typing...'}
          </span>
        </div>
      )}

      {/* Scroll to bottom button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-28 right-8 z-30 p-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-xl shadow-blue-500/30 flex items-center gap-1.5 text-xs font-semibold animate-in fade-in zoom-in-95 transition-all"
        >
          <ArrowDown className="w-4 h-4" />
          <span>New messages</span>
        </button>
      )}
    </div>
  );
};
