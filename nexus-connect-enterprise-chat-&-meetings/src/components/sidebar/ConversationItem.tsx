import React from 'react';
import { Conversation, User } from '../../types';
import { Avatar } from '../common/Avatar';
import { Hash, Lock, Users, BellOff } from 'lucide-react';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  currentUser: User | null;
  onlineUserIds: string[];
  onClick: () => void;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  currentUser,
  onlineUserIds,
  onClick,
}) => {
  const isChannel = conversation.type === 'channel';
  const isDm = conversation.type === 'dm';
  const isGroup = conversation.type === 'group';

  // For DMs, find the other member to show their avatar & name & presence
  const otherMember = isDm
    ? conversation.members.find(m => m.userId !== currentUser?.id)
    : null;

  const displayName = isDm && otherMember?.user
    ? otherMember.user.displayName
    : conversation.name;

  const isOnline = isDm && otherMember
    ? onlineUserIds.includes(otherMember.userId)
    : false;

  const currentMember = conversation.members.find(m => m.userId === currentUser?.id);
  const isMuted = currentMember?.isMuted;

  // Format last timestamp
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const lastMsg = conversation.lastMessage;
  const snippet = lastMsg
    ? lastMsg.isDeleted
      ? 'This message was deleted'
      : lastMsg.content || (lastMsg.attachments?.length ? 'Shared an attachment' : '')
    : conversation.topic || (isChannel ? 'No messages yet' : '');

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 select-none ${
        isActive
          ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 font-medium'
          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
      }`}
    >
      {/* Icon / Avatar */}
      <div className="shrink-0 relative">
        {isChannel ? (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              isActive
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
            }`}
          >
            {conversation.isPrivate ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
          </div>
        ) : isGroup ? (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              isActive
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
            }`}
          >
            <Users className="w-4 h-4" />
          </div>
        ) : (
          <Avatar
            name={displayName}
            avatarUrl={otherMember?.user?.avatarUrl}
            status={isOnline ? 'online' : (otherMember?.user?.status || 'offline')}
            size="sm"
            showStatus={true}
          />
        )}
      </div>

      {/* Title & snippet */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span
            className={`truncate text-xs ${
              isActive
                ? 'font-semibold text-blue-900 dark:text-blue-100'
                : conversation.unreadCount
                ? 'font-semibold text-slate-900 dark:text-white'
                : 'text-slate-800 dark:text-slate-200'
            }`}
          >
            {displayName}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
            {formatTime(lastMsg?.createdAt || conversation.updatedAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-[11px] ${
              conversation.unreadCount
                ? 'text-slate-900 dark:text-slate-100 font-medium'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {snippet}
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            {isMuted && <BellOff className="w-3 h-3 text-slate-400 shrink-0" />}
            {Boolean(conversation.unreadCount && conversation.unreadCount > 0) && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-600 text-white min-w-4 text-center shadow-xs animate-in zoom-in-75">
                {conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
