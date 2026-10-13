import React from 'react';
import { ChatConversation } from '../types';
import { User } from '../../../types';
import { getConversationSubtitle, getConversationTitle, initials } from '../utils/conversation';
import { timeAgo } from '../../../utils';

type Props = {
  conversation: ChatConversation;
  currentUser?: User | null;
  selected: boolean;
  presence?: 'ONLINE' | 'AWAY' | 'OFFLINE';
  onSelect: () => void;
};

const presenceClass = {
  ONLINE: 'bg-emerald-500',
  AWAY: 'bg-amber-500',
  OFFLINE: 'bg-slate-400',
};

const ConversationListItem: React.FC<Props> = ({ conversation, currentUser, selected, presence, onSelect }) => {
  const title = getConversationTitle(conversation, currentUser);
  const preview = conversation.lastMessage?.deletedAt
    ? 'Message deleted'
    : conversation.lastMessage?.content || getConversationSubtitle(conversation);
  const muted = conversation.members.some((member) => member.userId === currentUser?.id && member.isMuted);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      className={[
        'group w-full rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500',
        selected
          ? 'border-violet-200 bg-gradient-to-r from-violet-50 to-sky-50 text-slate-950 shadow-[0_12px_30px_rgba(124,58,237,0.16)]'
          : 'border-slate-200 bg-white text-slate-800 hover:border-sky-200 hover:bg-white',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-blue-500 to-cyan-500 text-sm font-bold text-white shadow-sm">
          {initials(title)}
          {presence && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${presenceClass[presence]}`} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-sm font-bold">{title}</span>
            {muted && <span className="text-[10px] text-slate-400" aria-label="Muted">Mute</span>}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {preview}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[10px] font-semibold text-slate-400">{conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : ''}</span>
          {conversation.unreadCount > 0 && (
            <span className="min-w-5 rounded-full bg-pink-500 px-1.5 py-0.5 text-center text-[11px] font-black text-white shadow-sm shadow-pink-500/20">
              {conversation.unreadCount}
            </span>
          )}
        </span>
      </div>
    </button>
  );
};

export default ConversationListItem;
