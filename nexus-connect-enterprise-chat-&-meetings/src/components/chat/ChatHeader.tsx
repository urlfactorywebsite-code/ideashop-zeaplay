import React, { useState } from 'react';
import { Conversation, User } from '../../types';
import { Avatar } from '../common/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useCall } from '../../context/CallContext';
import {
  Phone,
  Video,
  Pin,
  Search,
  PanelRight,
  MoreVertical,
  Bell,
  BellOff,
  Hash,
  Lock,
  Users,
  UserPlus,
  Share2,
} from 'lucide-react';

interface ChatHeaderProps {
  conversation: Conversation;
  onOpenAddMember: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ conversation, onOpenAddMember }) => {
  const { user } = useAuth();
  const {
    isRightSidebarOpen,
    toggleRightSidebar,
    isSearchInChatOpen,
    setIsSearchInChatOpen,
    toggleMute,
    onlineUserIds,
  } = useChat();
  const { initiateCall, startMeeting } = useCall();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  const isDm = conversation.type === 'dm';
  const isChannel = conversation.type === 'channel';
  const isGroup = conversation.type === 'group';

  // For DM, find the target user
  const otherMember = isDm
    ? conversation.members.find(m => m.userId !== user?.id)
    : null;

  const title = isDm && otherMember?.user ? otherMember.user.displayName : conversation.name;
  const isOnline = isDm && otherMember ? onlineUserIds.includes(otherMember.userId) : false;

  const currentMember = conversation.members.find(m => m.userId === user?.id);
  const isMuted = currentMember?.isMuted;

  const handleStartCall = (type: 'audio' | 'video') => {
    if (isDm && otherMember?.user) {
      initiateCall(
        {
          id: otherMember.user.id,
          displayName: otherMember.user.displayName,
          avatarUrl: otherMember.user.avatarUrl,
          title: otherMember.user.title,
        },
        type,
        conversation.id
      );
    } else {
      // For channel or group, start instant space meeting!
      startMeeting(
        `${conversation.name} Live Meeting`,
        conversation.id
      );
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
    setIsMenuOpen(false);
  };

  return (
    <div className="h-14 px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 z-10 select-none">
      {/* Left: Info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">
          {isChannel ? (
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold">
              {conversation.isPrivate ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
            </div>
          ) : isGroup ? (
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Users className="w-4 h-4" />
            </div>
          ) : (
            <Avatar
              name={title}
              avatarUrl={otherMember?.user?.avatarUrl}
              status={isOnline ? 'online' : (otherMember?.user?.status || 'offline')}
              size="md"
            />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {isChannel && '#'}
              {title}
            </h1>
            {isMuted && (
              <span className="p-0.5 text-slate-400" title="Notifications muted">
                <BellOff className="w-3 h-3" />
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-md">
            {isDm
              ? otherMember?.user?.customStatus || otherMember?.user?.title || 'Direct Conversation'
              : conversation.topic || `${conversation.members.length} members`}
          </p>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Audio Call */}
        <button
          onClick={() => handleStartCall('audio')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isDm ? 'Start One-on-One Audio Call' : 'Start Space Audio Call'}
        >
          <Phone className="w-4 h-4" />
        </button>

        {/* Video Call */}
        <button
          onClick={() => handleStartCall('video')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isDm ? 'Start One-on-One Video Call' : 'Start Space Video Conference'}
        >
          <Video className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 mx-1" />

        {/* Search in chat toggle */}
        <button
          onClick={() => setIsSearchInChatOpen(!isSearchInChatOpen)}
          className={`p-2 rounded-xl transition-colors ${
            isSearchInChatOpen
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title="Search in this conversation"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Add Member button (for group or channel) */}
        {!isDm && (
          <button
            onClick={onOpenAddMember}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Add Member to Space"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        )}

        {/* Toggle Right Sidebar */}
        <button
          onClick={toggleRightSidebar}
          className={`p-2 rounded-xl transition-colors ${
            isRightSidebarOpen
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title="Conversation Details & Files"
        >
          <PanelRight className="w-4 h-4" />
        </button>

        {/* More Options Menu */}
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="More Options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-11 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  toggleMute();
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
              >
                {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
              </button>
              <button
                onClick={handleCopyLink}
                className="w-full text-left px-3 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
              >
                <Share2 className="w-3.5 h-3.5" />
                {showCopied ? 'Link Copied!' : 'Copy Space Link'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
