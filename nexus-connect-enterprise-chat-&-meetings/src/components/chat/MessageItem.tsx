import React, { useState } from 'react';
import { Message, User } from '../../types';
import { Avatar } from '../common/Avatar';
import { FileAttachmentPreview } from '../common/FileAttachmentPreview';
import { EmojiPicker } from '../common/EmojiPicker';
import {
  Smile,
  Reply,
  Pin,
  Copy,
  Edit2,
  Trash2,
  Check,
  CheckCheck,
  MoreHorizontal,
  CornerDownRight,
  Sparkles,
} from 'lucide-react';

interface MessageItemProps {
  message: Message;
  sender: User | null;
  currentUser: User | null;
  replyToMessage?: Message | null;
  replyToSender?: User | null;
  searchHighlight?: string;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onTogglePin: (messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🚀', '👀'];

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  sender,
  currentUser,
  replyToMessage,
  replyToSender,
  searchHighlight,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onTogglePin,
  onJumpToMessage,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const isSelf = message.senderId === currentUser?.id;
  const isDeleted = message.isDeleted;

  const formatTimestamp = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Simple rich text formatting (bold, italic, code snippet, code block, links)
  const renderFormattedContent = (content: string) => {
    if (isDeleted) {
      return <span className="italic text-slate-400">This message was deleted</span>;
    }

    // Check code blocks
    if (content.startsWith('```') && content.endsWith('```')) {
      const code = content.slice(3, -3).replace(/^[a-z]+\n/i, '');
      return (
        <pre className="my-1.5 p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto border border-slate-800">
          <code>{code}</code>
        </pre>
      );
    }

    // Split paragraphs or lines
    const lines = content.split('\n');
    return lines.map((line, lIdx) => {
      // Inline markdown replacements
      let formatted = line;

      // Handle search highlight
      if (searchHighlight && searchHighlight.trim()) {
        const parts = formatted.split(new RegExp(`(${searchHighlight})`, 'gi'));
        return (
          <p key={lIdx} className="leading-relaxed">
            {parts.map((p, pIdx) =>
              p.toLowerCase() === searchHighlight.toLowerCase() ? (
                <mark key={pIdx} className="bg-yellow-300 dark:bg-yellow-500/50 text-black dark:text-white rounded-xs px-0.5 font-semibold">
                  {p}
                </mark>
              ) : (
                renderInlineFormatting(p, pIdx)
              )
            )}
          </p>
        );
      }

      return (
        <p key={lIdx} className="leading-relaxed">
          {renderInlineFormatting(line, lIdx)}
        </p>
      );
    });
  };

  const renderInlineFormatting = (text: string, keyPrefix: any) => {
    // Regex for bold **text**, code `text`
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${keyPrefix}-${idx}`} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={`${keyPrefix}-${idx}`} className="italic">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={`${keyPrefix}-${idx}`} className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-mono text-[11px] border border-slate-200/60 dark:border-slate-700/60">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <div
      id={`msg-${message.id}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowEmojiPicker(false);
      }}
      className={`group relative flex gap-3 px-4 py-2 transition-colors ${
        message.isPinned ? 'bg-amber-500/5 dark:bg-amber-500/10' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
      }`}
    >
      {/* Sender Avatar */}
      <div className="shrink-0 pt-0.5">
        <Avatar
          name={sender?.displayName || 'User'}
          avatarUrl={sender?.avatarUrl}
          status={sender?.status}
          size="md"
        />
      </div>

      {/* Main message body */}
      <div className="flex-1 min-w-0">
        {/* Reply Quote Banner if replying to another message */}
        {replyToMessage && (
          <div
            onClick={() => onJumpToMessage && onJumpToMessage(replyToMessage.id)}
            className="flex items-center gap-2 mb-1.5 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100/70 dark:bg-slate-800/50 px-2.5 py-1 rounded-lg border-l-2 border-blue-500 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors w-fit max-w-lg"
          >
            <CornerDownRight className="w-3 h-3 text-blue-500 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {replyToSender?.displayName || 'Colleague'}:
            </span>
            <span className="truncate max-w-xs">{replyToMessage.content}</span>
          </div>
        )}

        {/* Sender Name, Timestamp, Edited */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold text-slate-900 dark:text-white">
            {sender?.displayName || 'Team Member'}
          </span>
          {sender?.title && (
            <span className="text-[10px] text-slate-400 hidden sm:inline truncate max-w-xs">
              {sender.title}
            </span>
          )}
          <span className="text-[10px] text-slate-400">
            {formatTimestamp(message.createdAt)}
          </span>
          {message.isEdited && !isDeleted && (
            <span className="text-[10px] text-slate-400 italic">(edited)</span>
          )}
          {message.isPinned && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              <Pin className="w-3 h-3" /> Pinned
            </span>
          )}

          {/* Delivery & Read Receipts (for self messages) */}
          {isSelf && !isDeleted && (
            <span className="text-slate-400 ml-auto flex items-center gap-0.5 text-[10px]" title="Delivered & Read">
              {message.readBy && message.readBy.length > 1 ? (
                <CheckCheck className="w-3.5 h-3.5 text-blue-500" />
              ) : (
                <Check className="w-3.5 h-3.5 text-slate-400" />
              )}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="text-xs text-slate-800 dark:text-slate-200 break-words select-text">
          {renderFormattedContent(message.content)}
        </div>

        {/* Attachments */}
        {!isDeleted && message.attachments && message.attachments.length > 0 && (
          <FileAttachmentPreview attachments={message.attachments} />
        )}

        {/* Reactions Pills */}
        {!isDeleted && message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {message.reactions.map(r => {
              const hasReacted = currentUser ? r.userIds.includes(currentUser.id) : false;
              return (
                <button
                  key={r.emoji}
                  onClick={() => onToggleReaction(message.id, r.emoji)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all border ${
                    hasReacted
                      ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500/60 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                      : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                  title={`${r.userIds.length} reaction${r.userIds.length > 1 ? 's' : ''}`}
                >
                  <span>{r.emoji}</span>
                  <span className="text-[10px]">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Action Bar on Hover */}
      {!isDeleted && isHovered && (
        <div className="absolute right-4 -top-3 z-20 flex items-center gap-0.5 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg animate-in fade-in zoom-in-95 duration-100">
          {/* Quick Emojis */}
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => onToggleReaction(message.id, emoji)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}

          {/* More Emojis */}
          <div className="relative">
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Add reaction"
            >
              <Smile className="w-3.5 h-3.5" />
            </button>

            {showEmojiPicker && (
              <div className="absolute right-0 top-8 z-50">
                <EmojiPicker
                  onSelect={emoji => {
                    onToggleReaction(message.id, emoji);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

          {/* Reply */}
          <button
            onClick={() => onReply(message)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Reply quote"
          >
            <Reply className="w-3.5 h-3.5" />
          </button>

          {/* Pin */}
          <button
            onClick={() => onTogglePin(message.id)}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              message.isPinned
                ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/30'
                : 'text-slate-500 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title={message.isPinned ? 'Unpin message' : 'Pin message'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title={copied ? 'Copied!' : 'Copy text'}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* Edit (if self) */}
          {isSelf && (
            <button
              onClick={() => onEdit(message)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Edit message"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Delete (if self or admin) */}
          {isSelf && (
            <button
              onClick={() => onDelete(message.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Delete message"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
