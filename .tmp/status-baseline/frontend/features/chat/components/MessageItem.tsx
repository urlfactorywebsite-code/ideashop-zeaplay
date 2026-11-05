import React, { memo, useEffect, useMemo, useState } from 'react';
import { EllipsisVerticalIcon, PaperClipIcon, PencilIcon, SparklesIcon, TrashIcon } from '../../../components/icons';
import { User } from '../../../types';
import { ChatConversation, ChatMessage } from '../types';

type Props = {
  message: ChatMessage;
  currentUser?: User | null;
  conversation?: ChatConversation | null;
  grouped?: boolean;
  replyTo?: ChatMessage | null;
  onReply?: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onEdit?: (message: ChatMessage, content: string) => void;
  onDelete?: (message: ChatMessage) => void;
  canManage?: boolean;
  onPin?: (message: ChatMessage) => void;
};

const quickReactions = ['👍', '🎉', '✨', '✅', '👀', '💜'];

const MessageItem: React.FC<Props> = ({ message, currentUser, conversation, grouped, replyTo, onReply, onRetry, onToggleReaction, onEdit, onDelete, canManage = false, onPin }) => {
  const mine = message.senderId === currentUser?.id;
  const content = message.content ?? '';
  const senderName = mine ? 'You' : message.sender?.name ?? message.senderName ?? 'Unknown User';
  const senderInitials = senderName.slice(0, 2).toUpperCase() || '?';
  const createdAt = Number.isNaN(new Date(message.createdAt ?? '').getTime()) ? new Date() : new Date(message.createdAt);
  const reactions = message.reactions ?? [];
  const attachments = message.attachments ?? [];
  const replySenderName = replyTo?.sender?.name ?? replyTo?.senderName ?? 'Unknown User';
  const replyContent = replyTo?.content ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const groupedReactions = useMemo(() => reactions.reduce<Record<string, number>>((acc, reaction) => {
    acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
    return acc;
  }, {}), [reactions]);

  useEffect(() => {
    setDraft(content);
  }, [content, message.id]);

  if (message.messageType === 'SYSTEM') {
    return (
      <div className="flex justify-center py-1">
        <p className="rounded-full bg-slate-200/80 px-3 py-1 text-xs font-semibold text-slate-600">{content}</p>
      </div>
    );
  }

  const useBubble = false;
  const canModify = mine && !message.deletedAt;
  const rowClass = useBubble ? `flex ${mine ? 'justify-end' : 'justify-start'}` : 'group flex gap-3';
  const containerClass = useBubble
    ? `max-w-[82%] rounded-3xl px-4 py-3 shadow-sm ${mine ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700'}`
    : 'w-full rounded px-3 py-1.5 text-zinc-100 transition hover:bg-white/5';

  return (
    <div className={rowClass}>
      {!useBubble && !grouped && (
        <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-700 text-xs font-semibold text-white ring-1 ring-white/10">
          {senderInitials}
        </span>
      )}
      {!useBubble && grouped && <span className="w-9 shrink-0" />}
      <div className={`group/message relative ${containerClass}`}>
        {!grouped && (
          <div className="mb-1 flex items-center gap-2 text-xs opacity-75">
            <span className="font-semibold">{senderName}</span>
            <span className="text-zinc-400">{createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {message.editedAt && <span className="text-zinc-400">Edited</span>}
          </div>
        )}
        {replyTo && (
          <button type="button" className="mb-2 block max-w-full truncate rounded border-l-4 border-cyan-400 bg-zinc-900 px-3 py-2 text-left text-xs text-zinc-300 opacity-90">
            {replySenderName}: {replyContent.slice(0, 80)}
          </button>
        )}
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onEdit?.(message, draft);
              setEditing(false);
            }}
            className="space-y-2"
          >
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none focus:border-sky-400" />
            <div className="flex gap-2 text-xs">
              <button type="submit" className="rounded-full bg-sky-600 px-3 py-1 font-semibold text-white">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-full bg-zinc-800 px-3 py-1 text-zinc-300">Cancel</button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap break-words text-base leading-7">{message.deletedAt ? 'This message was deleted' : content}</p>
        )}
        {attachments.length > 0 && (
          <div className="mt-3 grid gap-2">
            {attachments.map((attachment) => {
              const fileName = attachment.originalFileName ?? attachment.fileName ?? 'Attachment';
              const fileSize = Number.isFinite(attachment.fileSize) ? attachment.fileSize : 0;
              const key = attachment.id || attachment.storageKey || attachment.url || fileName;
              const mimeType = attachment.mimeType ?? 'application/octet-stream';
              return mimeType.startsWith('image/') && attachment.url ? (
                <a key={key} href={attachment.url} target="_blank" rel="noreferrer">
                  <img src={attachment.url} alt={fileName} loading="lazy" className="max-h-64 rounded-lg border border-white/20 object-cover" />
                </a>
              ) : (
                <a key={key} href={attachment.url ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-sky-400">
                  <PaperClipIcon className="h-4 w-4 text-sky-500" />
                  <span className="min-w-0 flex-1 truncate">{fileName}</span>
                  <span className="text-zinc-500">{Math.ceil(fileSize / 1024)} KB</span>
                </a>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {Object.entries(groupedReactions).map(([emoji, count]) => (
            <button key={emoji} type="button" onClick={() => onToggleReaction?.(message, emoji)} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-200 shadow-sm transition hover:scale-105">
              {emoji} {count}
            </button>
          ))}
          {message.deliveryStatus === 'failed' && <button type="button" onClick={() => onRetry?.(message)} className="rounded-full bg-rose-500/20 px-2 py-0.5 font-semibold text-rose-200">Retry</button>}
          {message.deliveryStatus && <span className="text-zinc-500">{message.deliveryStatus}</span>}
        </div>
        {!message.deletedAt && (
          <div className="absolute -top-4 right-3 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-1 py-1 text-zinc-300 shadow-lg sm:hidden sm:group-hover/message:flex sm:group-focus-within/message:flex">
            <button type="button" aria-label="React" onClick={() => setReactionOpen((value) => !value)} className="rounded-full px-2 py-1 text-xs font-bold hover:bg-zinc-800 hover:text-white">React</button>
            <button type="button" aria-label="Reply" onClick={() => onReply?.(message)} className="rounded-full px-2 py-1 text-xs font-bold hover:bg-zinc-800 hover:text-white">Reply</button>
            <button type="button" aria-label="More message actions" onClick={() => setMenuOpen((value) => !value)} className="rounded-full p-1 hover:bg-zinc-800">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {reactionOpen && (
          <div className="absolute right-8 top-6 z-10 flex gap-1 rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
            {quickReactions.map((emoji) => (
              <button key={emoji} type="button" onClick={() => { onToggleReaction?.(message, emoji); setReactionOpen(false); }} className="grid h-8 w-8 place-items-center rounded-xl text-lg transition hover:scale-110 hover:bg-zinc-800">
                {emoji}
              </button>
            ))}
          </div>
        )}
        {menuOpen && (
          <div className="absolute right-3 top-6 z-10 w-36 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-xl">
            {canModify && <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800"><PencilIcon className="h-4 w-4" /> Edit</button>}
            {canModify && <button type="button" onClick={() => { onDelete?.(message); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/10"><TrashIcon className="h-4 w-4" /> Delete</button>}
            {canManage && <button type="button" onClick={() => { onPin?.(message); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-200 hover:bg-amber-500/10"><SparklesIcon className="h-4 w-4" /> Pin</button>}
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(content); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800">Copy</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MessageItem);
