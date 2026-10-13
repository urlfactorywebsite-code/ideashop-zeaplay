import React, { useMemo, useRef, useState } from 'react';
import { PaperAirplaneIcon, SignalIcon } from '@heroicons/react/24/outline';
import { Ticket, User } from '../../types';
import { TicketChatMessage } from '../../hooks/useTicketChat';
import MentionPicker from '../ui/MentionPicker';
import { applyMention, getMentionMatch, MentionMatch } from '../../utils/mentionUtils';

interface TicketChatPanelProps {
  ticket: Ticket;
  messages: TicketChatMessage[];
  onSendComment: () => void;
  commentText: string;
  setCommentText: (text: string) => void;
  connected: boolean;
  isInternal: boolean;
  setIsInternal: (value: boolean) => void;
  onTyping?: (body?: string) => void;
  mentionUsers: User[];
}

const TicketChatPanel: React.FC<TicketChatPanelProps> = ({
  ticket,
  messages,
  onSendComment,
  commentText,
  setCommentText,
  connected,
  isInternal,
  setIsInternal,
  onTyping,
  mentionUsers,
}) => {
  const lastTyping = useMemo(
    () => [...messages].reverse().find((message) => message.type === 'typing'),
    [messages],
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);

  const handleCommentChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    setCommentText(nextValue);
    onTyping?.(nextValue);
    const cursor = event.target.selectionStart ?? nextValue.length;
    setMentionMatch(getMentionMatch(nextValue, cursor));
  };

  const handleMentionSelect = (user: User) => {
    if (!mentionMatch) return;
    const mentionLabel = user.name.replace(/\s+/g, '');
    const nextValue = applyMention(commentText, mentionMatch, mentionLabel);
    setCommentText(nextValue);
    setMentionMatch(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const cursorPosition = mentionMatch.start + mentionLabel.length + 2;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Ticket Chat</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            #{ticket.id.slice(-6)} - {ticket.title}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <SignalIcon className="h-4 w-4" />
          <span>{connected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>

      <div className="h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-4">
        {messages
          .filter((message) => message.type === 'comment')
          .map((message) => {
            if (message.type !== 'comment') {
              return null;
            }
            const comment = message.comment;
            return (
              <div key={comment.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{comment.user_id}</span>
                  <span>{new Date(comment.created_at).toLocaleString()}</span>
                </div>
                <div className={`rounded-lg px-3 py-2 text-sm ${
                  comment.is_internal
                    ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                    : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                }`}>
                  {comment.body}
                </div>
              </div>
            );
          })}

        {messages.some((message) => message.type === 'error') && (
          <div className="text-xs text-red-600 dark:text-red-400">
            {messages
              .filter((message) => message.type === 'error')
              .map((message, index) => (
                <div key={`error-${index}`}>
                  {(message as { type: 'error'; message: string }).message}
                </div>
              ))}
          </div>
        )}

        {lastTyping && lastTyping.type === 'typing' && (
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {lastTyping.user_id} is typing...
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-12">
            No chat messages yet.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={commentText}
            onChange={handleCommentChange}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMentionMatch(null);
              }
            }}
            rows={3}
            placeholder="Write a comment..."
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <MentionPicker
            users={mentionUsers}
            query={mentionMatch?.query ?? ''}
            isOpen={!!mentionMatch}
            onSelect={handleMentionSelect}
            onClose={() => setMentionMatch(null)}
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(event) => setIsInternal(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Internal note
          </label>
          <button
            onClick={onSendComment}
            disabled={!commentText.trim() || !connected}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PaperAirplaneIcon className="h-4 w-4" />
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketChatPanel;
