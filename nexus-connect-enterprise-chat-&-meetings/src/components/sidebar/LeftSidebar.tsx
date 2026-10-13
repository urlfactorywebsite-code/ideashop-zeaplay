import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useCall } from '../../context/CallContext';
import { ConversationItem } from './ConversationItem';
import { Avatar } from '../common/Avatar';
import {
  Search,
  Plus,
  Video,
  Users,
  Settings,
  Hash,
  MessageSquare,
  ChevronDown,
  LogOut,
  UserCheck,
  Calendar,
  Sparkles,
  PhoneCall,
} from 'lucide-react';

interface LeftSidebarProps {
  onOpenNewConversation: () => void;
  onOpenContacts: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenAuth: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  onOpenNewConversation,
  onOpenContacts,
  onOpenSettings,
  onOpenProfile,
  onOpenAuth,
}) => {
  const { user, logout, switchUser, demoUsers } = useAuth();
  const {
    conversations,
    activeConversationId,
    selectConversation,
    filterTab,
    setFilterTab,
    searchQuery,
    setSearchQuery,
    onlineUserIds,
  } = useChat();
  const { startMeeting, joinMeeting } = useCall();

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSwitchUserOpen, setIsSwitchUserOpen] = useState(false);

  // Filter conversations
  const filteredConversations = conversations.filter(c => {
    // Search query filter
    if (searchQuery.trim()) {
      const matchName = c.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTopic = c.topic?.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchName && !matchTopic) return false;
    }

    // Category filter
    if (filterTab === 'dms') return c.type === 'dm';
    if (filterTab === 'channels') return c.type === 'channel';
    if (filterTab === 'groups') return c.type === 'group';
    return true;
  });

  const channels = filteredConversations.filter(c => c.type === 'channel');
  const dms = filteredConversations.filter(c => c.type === 'dm');
  const groups = filteredConversations.filter(c => c.type === 'group');

  return (
    <div className="w-80 h-full bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 select-none">
      {/* 1. User Header & Workspace Profile */}
      <div className="p-3.5 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/90 relative">
        <div className="flex items-center justify-between">
          <div
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center gap-2.5 cursor-pointer p-1 -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors flex-1 min-w-0"
          >
            <Avatar
              name={user?.displayName || 'User'}
              avatarUrl={user?.avatarUrl}
              status={user?.status || 'online'}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {user?.displayName || 'Welcome'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {user?.title || 'Enterprise Member'}
              </p>
            </div>
          </div>

          {/* Quick Action Icons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => startMeeting()}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
              title="Start Instant Personal Meeting"
            >
              <Video className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenNewConversation}
              className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-colors"
              title="New Message or Space"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Custom Status snippet if set */}
        {user?.customStatus && (
          <div
            onClick={onOpenProfile}
            className="mt-2 text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30 px-2.5 py-1 rounded-lg border border-blue-200/50 dark:border-blue-900/50 truncate cursor-pointer hover:underline"
          >
            💬 {user.customStatus}
          </div>
        )}

        {/* Profile Dropdown Menu */}
        {isProfileMenuOpen && (
          <div className="absolute top-16 left-3 right-3 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
            <button
              onClick={() => {
                setIsProfileMenuOpen(false);
                onOpenProfile();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
            >
              <UserCheck className="w-4 h-4 text-blue-500" />
              Edit Profile & Custom Status
            </button>
            <button
              onClick={() => {
                setIsProfileMenuOpen(false);
                setIsSwitchUserOpen(true);
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
            >
              <Users className="w-4 h-4 text-emerald-500" />
              Switch Colleague Persona
            </button>
            <button
              onClick={() => {
                setIsProfileMenuOpen(false);
                onOpenSettings();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
            >
              <Settings className="w-4 h-4 text-slate-500" />
              Settings & Hardware Devices
            </button>
            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
            <button
              onClick={() => {
                setIsProfileMenuOpen(false);
                logout();
                onOpenAuth();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="p-3 space-y-2 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/50 dark:bg-slate-900/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search conversations, teams..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/50"
          />
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-200/60 dark:bg-slate-800/60 rounded-xl">
          {[
            { id: 'all', label: 'All' },
            { id: 'channels', label: 'Channels' },
            { id: 'dms', label: 'Direct' },
            { id: 'groups', label: 'Groups' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id as any)}
              className={`flex-1 py-1 rounded-lg text-[11px] font-medium transition-all ${
                filterTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Conversation & Meetings Lists */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Quick Enterprise Contacts Button */}
        <button
          onClick={onOpenContacts}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span>Colleague Directory</span>
          </div>
          <span className="text-[10px] text-slate-400">View All</span>
        </button>

        {/* Channels Section */}
        {(filterTab === 'all' || filterTab === 'channels') && channels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Channels
              </span>
              <span className="text-[10px] font-semibold text-slate-400">{channels.length}</span>
            </div>
            <div className="space-y-0.5">
              {channels.map(c => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeConversationId}
                  currentUser={user}
                  onlineUserIds={onlineUserIds}
                  onClick={() => selectConversation(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Direct Messages Section */}
        {(filterTab === 'all' || filterTab === 'dms') && dms.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Direct Messages
              </span>
              <span className="text-[10px] font-semibold text-slate-400">{dms.length}</span>
            </div>
            <div className="space-y-0.5">
              {dms.map(c => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeConversationId}
                  currentUser={user}
                  onlineUserIds={onlineUserIds}
                  onClick={() => selectConversation(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Group Spaces Section */}
        {(filterTab === 'all' || filterTab === 'groups') && groups.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Group Spaces
              </span>
              <span className="text-[10px] font-semibold text-slate-400">{groups.length}</span>
            </div>
            <div className="space-y-0.5">
              {groups.map(c => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeConversationId}
                  currentUser={user}
                  onlineUserIds={onlineUserIds}
                  onClick={() => selectConversation(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Active Meeting Room Shortcut */}
        <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-600/10 to-indigo-600/10 border border-blue-500/20 dark:border-blue-500/20">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Personal Meeting Room
            </span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
            Instant WebRTC video conference space with screen sharing
          </p>
          <button
            onClick={() => startMeeting()}
            className="w-full py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs"
          >
            <Video className="w-3.5 h-3.5" />
            Start Video Meeting
          </button>
        </div>
      </div>

      {/* 4. Bottom Utility Bar & Persona Switcher */}
      <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/90 flex items-center justify-between">
        <button
          onClick={() => setIsSwitchUserOpen(true)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Switch Colleague Persona for instant testing"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Switch Persona</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Persona Switcher Dialog */}
      {isSwitchUserOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Switch Active Persona
              </h3>
              <button
                onClick={() => setIsSwitchUserOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Switch immediately to test real-time two-way messaging, typing indicators, and WebRTC calls.
            </p>
            <div className="space-y-1.5">
              {demoUsers.map(u => (
                <button
                  key={u.id}
                  onClick={async () => {
                    await switchUser(u.id);
                    setIsSwitchUserOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-colors ${
                    user?.id === u.id
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size="sm" showStatus={false} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {u.displayName}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {u.title} • {u.department}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
