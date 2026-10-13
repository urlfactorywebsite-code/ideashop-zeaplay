import React, { useEffect, useMemo, useRef } from 'react';
import { User } from '../../../types';
import { ChatConversation, ChatMessage } from '../types';
import EmptyChatState from './EmptyChatState';
import MessageItem from './MessageItem';

type Props = {
  messages: ChatMessage[];
  currentUser?: User | null;
  conversation?: ChatConversation | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  typingUsers?: string[];
  onReply?: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onEdit?: (message: ChatMessage, content: string) => void;
  onDelete?: (message: ChatMessage) => void;
  canManage?: boolean;
  onPin?: (message: ChatMessage) => void;
};

const MessageList: React.FC<Props> = ({ messages, currentUser, conversation, loading, hasMore, onLoadMore, typingUsers = [], onReply, onRetry, onToggleReaction, onEdit, onDelete, canManage = false, onPin }) => {
  const endRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = conversation?.unreadCount ?? 0;
  const firstUnreadIndex = useMemo(() => unreadCount > 0 ? Math.max(messages.length - unreadCount, 0) : -1, [messages.length, unreadCount]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  return (
    <div className="chat-message-list">
      {hasMore && (
        <button type="button" onClick={onLoadMore} className="mx-auto mb-4 block rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-bold text-zinc-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
          Load older messages
        </button>
      )}

      {loading && messages.length === 0 && (
        <div className="space-y-4" aria-label="Loading messages">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex animate-pulse gap-3">
              <div className="h-9 w-9 rounded-full bg-zinc-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 rounded bg-zinc-800" />
                <div className="h-14 max-w-xl rounded-2xl bg-zinc-900" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && messages.length === 0 && <EmptyChatState conversation={conversation} currentUser={currentUser} />}

      <div className="space-y-2">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const messageDate = Number.isNaN(new Date(message.createdAt ?? '').getTime()) ? new Date() : new Date(message.createdAt);
          const previousDate = previous && !Number.isNaN(new Date(previous.createdAt ?? '').getTime()) ? new Date(previous.createdAt) : null;
          const grouped = Boolean(previous && previous.senderId === message.senderId && previousDate && messageDate.getTime() - previousDate.getTime() < 5 * 60 * 1000);
          const showDate = !previousDate || previousDate.toDateString() !== messageDate.toDateString();
          const replyTo = message.replyToMessageId ? messages.find((item) => item.id === message.replyToMessageId) ?? null : null;
          return (
            <React.Fragment key={message.id}>
              {showDate && <div className="py-2 text-center text-xs font-semibold text-zinc-500">{messageDate.toLocaleDateString()}</div>}
              {index === firstUnreadIndex && unreadCount > 0 && (
                <div className="flex items-center gap-3 py-2">
                  <span className="h-px flex-1 bg-sky-500/50" />
                  <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-black text-sky-300">New messages</span>
                  <span className="h-px flex-1 bg-sky-500/50" />
                </div>
              )}
              <MessageItem message={message} conversation={conversation} currentUser={currentUser} grouped={grouped} replyTo={replyTo} onReply={onReply} onRetry={onRetry} onToggleReaction={onToggleReaction} onEdit={onEdit} onDelete={onDelete} canManage={canManage} onPin={onPin} />
            </React.Fragment>
          );
        })}
      </div>

      {typingUsers.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-zinc-400">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:240ms]" />
          </span>
          {typingUsers.length === 1 ? `${typingUsers[0]} is typing...` : `${typingUsers[0]} and ${typingUsers.length - 1} others are typing...`}
        </div>
      )}

      {unreadCount > 0 && (
        <button type="button" onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })} className="sticky bottom-3 mx-auto mt-3 flex rounded-full bg-sky-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-sky-500/20">
          Down {unreadCount} new messages
        </button>
      )}
      <div ref={endRef} />
    </div>
  );
};

export default MessageList;
