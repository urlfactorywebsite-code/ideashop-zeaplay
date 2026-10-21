import SharedAvatar from '../../components/Avatar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  Bell,
  BellOff,
  Bold,
  Check,
  CheckCheck,
  Code,
  Copy,
  CornerDownRight,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Hash,
  Image as ImageIcon,
  Info,
  Italic,
  List,
  Loader2,
  Lock,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MoreVertical,
  PanelRight,
  Paperclip,
  Palette,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Quote,
  Radio,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  Smile,
  Star,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { User } from '../../types';
import ChatErrorBoundary from './components/ChatErrorBoundary';
import ChatModal from './components/ChatModal';
import ChatSearchModal from './components/ChatSearchModal';
import { useChat } from './hooks/useChat';
import { useNexusCalls, NexusCallPeer } from './hooks/useNexusCalls';
import { chatService } from './services/chatService';
import { ChatAttachment, ChatConversation, ChatDirectoryUser, ChatMember, ChatMessage, ChatPinnedMessage } from './types';
import { getConversationTitle } from './utils/conversation';

type Presence = 'ONLINE' | 'AWAY' | 'OFFLINE';
type FilterTab = 'all' | 'channels' | 'direct' | 'groups';
type ContactMode = 'contacts' | 'add-member';

const presenceTone: Record<Presence, string> = {
  ONLINE: 'bg-emerald-500',
  AWAY: 'bg-amber-500',
  OFFLINE: 'bg-slate-400 dark:bg-slate-500',
};

const quickReactions = ['+1', 'done', 'seen', 'ship', 'idea'];
const CHAT_BACKGROUND_STORAGE_KEY = 'zea-play-chat-background-color';
const DEFAULT_CHAT_BACKGROUND = '#0f172a';

const initials = (value?: string | null) => {
  if (!value) return '?';
  const parts = value.trim().split(/\s+/);
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
};

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateHeader = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent';
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
};

const formatFileSize = (bytes?: number | null) => {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const isImageAttachment = (attachment: ChatAttachment) => {
  const name = attachment.originalFileName || attachment.fileName || '';
  return attachment.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);
};

const getOtherMember = (conversation: ChatConversation | null | undefined, currentUser?: User | null) => {
  if (!conversation || conversation.type !== 'DIRECT') return null;
  return conversation.members.find((member) => member.userId !== currentUser?.id) ?? null;
};

const memberToPeer = (member: ChatMember): NexusCallPeer => ({
  id: member.userId,
  name: member.name,
  avatarUrl: member.avatarUrl,
  title: member.title,
});

const Avatar: React.FC<{
  userId?: string;
  name?: string | null;
  avatarUrl?: string | null;
  presence?: Presence;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showPresence?: boolean;
  className?: string;
}> = ({ userId, name, avatarUrl, presence, size = 'md', showPresence = true, className = '' }) => {
  const [failed, setFailed] = useState(false);
  const sizeClass = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-12 w-12 text-base',
    xl: 'h-16 w-16 text-xl',
  }[size];
  const dotClass = {
    xs: 'h-1.5 w-1.5 ring-1',
    sm: 'h-2 w-2 ring-2',
    md: 'h-2.5 w-2.5 ring-2',
    lg: 'h-3 w-3 ring-2',
    xl: 'h-4 w-4 ring-2',
  }[size];

  return (
    <span className={`relative inline-flex shrink-0 select-none ${className}`}>
      <SharedAvatar user={{ id: userId, name: name || undefined, avatarUrl }} size={{ xs: 24, sm: 32, md: 40, lg: 48, xl: 64 }[size]} />
      {showPresence && presence && (
        <span className={`absolute bottom-0 right-0 rounded-full ring-white dark:ring-slate-900 ${dotClass} ${presenceTone[presence]}`} />
      )}
    </span>
  );
};

const ConversationRow: React.FC<{
  conversation?: ChatConversation;
  directoryUser?: ChatDirectoryUser;
  currentUser?: User | null;
  selectedConversationId: string | null;
  presenceByUserId: Record<string, Presence>;
  onSelectConversation: (id: string) => void;
  onSelectUser: (id: string) => void;
}> = ({ conversation, directoryUser, currentUser, selectedConversationId, presenceByUserId, onSelectConversation, onSelectUser }) => {
  const directMember = getOtherMember(conversation, currentUser);
  const title = conversation ? getConversationTitle(conversation, currentUser) : directoryUser?.name || 'Unknown user';
  const avatarUrl = directMember?.avatarUrl || conversation?.avatarUrl || directoryUser?.avatarUrl || null;
  const presence = directMember ? presenceByUserId[directMember.userId] || 'OFFLINE' : directoryUser ? presenceByUserId[directoryUser.id] || directoryUser.presence : undefined;
  const unread = conversation?.unreadCount ?? directoryUser?.unreadCount ?? 0;
  const selected = Boolean(conversation && conversation.id === selectedConversationId);
  const preview = conversation?.lastMessage?.deletedAt
    ? 'Message deleted'
    : conversation?.lastMessage?.content || directoryUser?.latestMessagePreview || directMember?.title || directMember?.departmentName || directoryUser?.title || directoryUser?.teamName || 'Start a secure Zeaplay conversation';

  return (
    <button
      type="button"
      onClick={() => conversation ? onSelectConversation(conversation.id) : directoryUser && onSelectUser(directoryUser.id)}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        selected ? 'bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950/40 dark:text-blue-300' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
      }`}
    >
      {conversation?.type === 'SPACE' ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {conversation.isPrivate ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
        </span>
      ) : conversation?.type === 'GROUP' ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
          <Users className="h-4 w-4" />
        </span>
      ) : (
        <Avatar userId={directMember?.userId || directoryUser?.id} name={title} avatarUrl={avatarUrl} presence={presence} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs ${unread > 0 ? 'font-bold' : 'font-semibold'}`}>{conversation?.type === 'SPACE' ? `# ${title}` : title}</span>
        <span className={`block truncate text-[11px] ${unread > 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{preview}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="h-4 text-[10px] text-slate-400">{formatTime(conversation?.lastMessageAt || directoryUser?.lastMessageAt)}</span>
        {unread > 0 ? (
          <span className="min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{unread}</span>
        ) : conversation?.members.find((member) => member.userId === currentUser?.id)?.isPinned || directoryUser?.isFavorite ? (
          <Star className="h-3.5 w-3.5 text-amber-500" />
        ) : (
          <MoreVertical className="h-4 w-4 opacity-0 transition group-hover:opacity-60" />
        )}
      </span>
    </button>
  );
};

const NexusSidebar: React.FC<{
  currentUser?: User | null;
  conversations: ChatConversation[];
  directoryUsers: ChatDirectoryUser[];
  selectedConversationId: string | null;
  loading: boolean;
  presenceByUserId: Record<string, Presence>;
  filterTab: FilterTab;
  searchQuery: string;
  onFilterChange: (tab: FilterTab) => void;
  onSearchChange: (query: string) => void;
  onSelectConversation: (id: string) => void;
  onSelectUser: (id: string) => void;
  onOpenCreate: (mode: 'DIRECT' | 'GROUP' | 'SPACE') => void;
  onOpenContacts: () => void;
  onOpenSettings: () => void;
  onStartMeeting: () => void;
}> = ({
  currentUser,
  conversations,
  directoryUsers,
  selectedConversationId,
  loading,
  presenceByUserId,
  filterTab,
  searchQuery,
  onFilterChange,
  onSearchChange,
  onSelectConversation,
  onSelectUser,
  onOpenCreate,
  onOpenContacts,
  onOpenSettings,
  onStartMeeting,
}) => {
  const directUserIds = useMemo(() => {
    const ids = new Set<string>();
    conversations.forEach((conversation) => {
      if (conversation.type !== 'DIRECT') return;
      const other = getOtherMember(conversation, currentUser);
      if (other) ids.add(other.userId);
    });
    return ids;
  }, [conversations, currentUser]);

  const query = searchQuery.trim().toLowerCase();
  const filteredConversations = conversations.filter((conversation) => {
    const title = getConversationTitle(conversation, currentUser).toLowerCase();
    const haystack = [title, conversation.description, conversation.teamId, conversation.projectId, ...conversation.members.map((member) => `${member.name} ${member.email} ${member.departmentName || ''}`)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filterTab === 'channels') return conversation.type === 'SPACE';
    if (filterTab === 'groups') return conversation.type === 'GROUP';
    if (filterTab === 'direct') return conversation.type === 'DIRECT';
    return true;
  });

  const filteredUsers = directoryUsers
    .filter((user) => !directUserIds.has(user.id))
    .filter((user) => filterTab === 'all' || filterTab === 'direct')
    .filter((user) => {
      if (!query) return true;
      return [user.name, user.email, user.teamName, user.title, user.roleName].filter(Boolean).join(' ').toLowerCase().includes(query);
    });

  const channels = filteredConversations.filter((conversation) => conversation.type === 'SPACE');
  const dms = filteredConversations.filter((conversation) => conversation.type === 'DIRECT');
  const groups = filteredConversations.filter((conversation) => conversation.type === 'GROUP');

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'channels', label: 'Channels' },
    { id: 'direct', label: 'Direct' },
    { id: 'groups', label: 'Groups' },
  ];

  const renderSection = (title: string, items: ChatConversation[], users: ChatDirectoryUser[] = []) => {
    if (items.length === 0 && users.length === 0) return null;
    return (
      <section className="space-y-1">
        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
          <span className="text-[10px] font-semibold text-slate-400">{items.length + users.length}</span>
        </div>
        {items.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            currentUser={currentUser}
            selectedConversationId={selectedConversationId}
            presenceByUserId={presenceByUserId}
            onSelectConversation={onSelectConversation}
            onSelectUser={onSelectUser}
          />
        ))}
        {users.map((directoryUser) => (
          <ConversationRow
            key={directoryUser.id}
            directoryUser={directoryUser}
            currentUser={currentUser}
            selectedConversationId={selectedConversationId}
            presenceByUserId={presenceByUserId}
            onSelectConversation={onSelectConversation}
            onSelectUser={onSelectUser}
          />
        ))}
      </section>
    );
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 lg:w-80">
      <div className="border-b border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onOpenSettings} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
            <Avatar userId={currentUser?.id} name={currentUser?.name || 'User'} avatarUrl={currentUser?.avatarUrl || currentUser?.profileImageUrl} presence="ONLINE" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold">{currentUser?.name || 'Zeaplay'}</span>
              <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{currentUser?.title || currentUser?.role || 'Enterprise member'}</span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onStartMeeting} className="rounded-xl p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-blue-950/40" title="Start meeting">
              <Video className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onOpenCreate('DIRECT')} className="rounded-xl bg-blue-600 p-2 text-white shadow-sm hover:bg-blue-500" title="New message">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-b border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
        <label className="relative block">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations, teams..."
            className="w-full rounded-xl border-0 bg-slate-100 py-2 pl-8 pr-3 text-xs text-slate-900 outline-none ring-1 ring-transparent placeholder:text-slate-400 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
          />
        </label>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-0.5 dark:bg-slate-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onFilterChange(tab.id)}
              className={`rounded-lg py-1 text-[11px] font-semibold transition ${filterTab === tab.id ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-950 dark:text-blue-300' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        <button type="button" onClick={onOpenContacts} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-500" /> Colleague Directory</span>
          <span className="text-[10px] text-slate-400">View all</span>
        </button>
        {loading && (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex animate-pulse items-center gap-3 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-2 w-36 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && (
          <>
            {renderSection('Channels', channels)}
            {renderSection('Direct Messages', dms, filteredUsers)}
            {renderSection('Group Spaces', groups)}
            {channels.length === 0 && dms.length === 0 && groups.length === 0 && filteredUsers.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                No conversations match this view.
              </div>
            )}
            <div className="rounded-2xl border border-blue-500/20 bg-blue-50 p-3 dark:bg-blue-950/20">
              <div className="mb-1 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Personal Meeting Room</span>
              </div>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">Authenticated WebRTC meeting space with screen sharing.</p>
              <button type="button" onClick={onStartMeeting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500">
                <Video className="h-3.5 w-3.5" /> Start Video Meeting
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
        <button type="button" onClick={onOpenContacts} className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <UserCheck className="h-3.5 w-3.5 text-emerald-500" /> Contacts
        </button>
        <button type="button" onClick={onOpenSettings} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200" title="Chat settings">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
};

const ChatTopbar: React.FC<{
  conversation: ChatConversation | null;
  currentUser?: User | null;
  presence: Presence;
  detailsOpen: boolean;
  favorite: boolean;
  muted: boolean;
  onOpenSidebar: () => void;
  onToggleDetails: () => void;
  onToggleFavorite: () => void;
  onToggleMute: () => void;
  onOpenSearch: () => void;
  onOpenAddMember: () => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onStartMeeting: () => void;
  chatBackgroundColor: string;
  onChatBackgroundColorChange: (color: string) => void;
}> = ({ conversation, currentUser, presence, detailsOpen, favorite, muted, onOpenSidebar, onToggleDetails, onToggleFavorite, onToggleMute, onOpenSearch, onOpenAddMember, onStartCall, onStartMeeting, chatBackgroundColor, onChatBackgroundColorChange }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const otherMember = getOtherMember(conversation, currentUser);
  const title = conversation ? getConversationTitle(conversation, currentUser) : 'No conversation selected';
  const isDirect = conversation?.type === 'DIRECT';
  const isSpace = conversation?.type === 'SPACE';

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
    setMenuOpen(false);
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onOpenSidebar} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" aria-label="Open conversations">
          <Menu className="h-5 w-5" />
        </button>
        {conversation ? (
          isSpace ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {conversation.isPrivate ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
            </span>
          ) : conversation.type === 'GROUP' ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
              <Users className="h-4 w-4" />
            </span>
          ) : (
            <Avatar userId={otherMember?.userId} name={title} avatarUrl={otherMember?.avatarUrl} presence={presence} size="md" />
          )
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><MessageSquare className="h-4 w-4" /></span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xs font-bold text-slate-950 dark:text-white">{isSpace ? '# ' : ''}{title}</h1>
            {muted && <BellOff className="h-3 w-3 text-slate-400" />}
          </div>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {!conversation ? 'Choose a chat or start a new one' : isDirect ? otherMember?.title || (presence === 'ONLINE' ? 'Available' : 'Direct conversation') : conversation.description || `${conversation.members.length} members`}
          </p>
        </div>
      </div>
      {conversation && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => onStartCall('audio')} className="rounded-xl p-2 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 dark:text-slate-300 dark:hover:bg-emerald-950/40" title={isDirect ? 'Start audio call' : 'Start space audio'}>
            <Phone className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onStartCall('video')} className="rounded-xl p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-blue-950/40" title={isDirect ? 'Start video call' : 'Start space meeting'}>
            <Video className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-800" />
          <button type="button" onClick={onOpenSearch} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Search in chat">
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => colorInputRef.current?.click()}
            className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Change chat background"
            aria-label="Change chat background"
          >
            <Palette className="h-4 w-4" />
            <span
              className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: chatBackgroundColor }}
              aria-hidden="true"
            />
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={chatBackgroundColor}
            onChange={(event) => onChatBackgroundColorChange(event.target.value)}
            className="sr-only"
            aria-label="Select chat background color"
          />
          {!isDirect && (
            <button type="button" onClick={onOpenAddMember} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="Add member">
              <UserPlus className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onToggleDetails} className={`rounded-xl p-2 ${detailsOpen ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} title="Conversation details">
            <PanelRight className="h-4 w-4" />
          </button>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((value) => !value)} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" title="More options">
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 w-52 rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <button type="button" onClick={() => { onToggleFavorite(); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Star className="h-3.5 w-3.5" /> {favorite ? 'Remove favorite' : 'Add favorite'}
                </button>
                <button type="button" onClick={() => { onToggleMute(); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  {muted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />} {muted ? 'Unmute notifications' : 'Mute notifications'}
                </button>
                <button type="button" onClick={copyLink} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Share2 className="h-3.5 w-3.5" /> {copied ? 'Link copied' : 'Copy chat link'}
                </button>
                <button type="button" onClick={() => { onStartMeeting(); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Video className="h-3.5 w-3.5" /> Start meeting room
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

const PinnedBanner: React.FC<{
  pins: ChatPinnedMessage[];
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}> = ({ pins, onJump, onUnpin }) => {
  const [index, setIndex] = useState(0);
  if (pins.length === 0) return null;
  const pin = pins[index] || pins[0];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs dark:border-amber-500/20 dark:bg-amber-950/30">
      <button type="button" onClick={() => onJump(pin.messageId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="rounded-lg bg-amber-500/15 p-1.5 text-amber-700 dark:text-amber-300"><Pin className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
          <strong>Pinned {index + 1}/{pins.length}:</strong> {pin.message.senderName}: {pin.message.content || 'Attachment'}
        </span>
      </button>
      <div className="flex items-center gap-1">
        {pins.length > 1 && (
          <button type="button" onClick={() => setIndex((value) => (value + 1) % pins.length)} className="rounded-lg px-2 py-1 font-semibold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50">Next</button>
        )}
        <button type="button" onClick={() => onUnpin(pin.messageId)} className="rounded-lg p-1 text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
};

const SearchInConversation: React.FC<{
  open: boolean;
  term: string;
  matchCount: number;
  onChange: (value: string) => void;
  onClose: () => void;
}> = ({ open, term, matchCount, onChange, onClose }) => {
  if (!open) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-800">
      <div className="flex max-w-md flex-1 items-center gap-2">
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <input value={term} onChange={(event) => onChange(event.target.value)} autoFocus placeholder="Find in this chat..." className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        {term && <span className="whitespace-nowrap text-[10px] text-slate-400">{matchCount} {matchCount === 1 ? 'match' : 'matches'}</span>}
      </div>
      <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
    </div>
  );
};

const MessageRow: React.FC<{
  message: ChatMessage;
  replyTo?: ChatMessage | null;
  currentUser?: User | null;
  pinned: boolean;
  searchTerm: string;
  canManage: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, content: string) => void;
  onDelete: (message: ChatMessage) => void;
  onToggleReaction: (message: ChatMessage, reaction: string) => void;
  onPin: (message: ChatMessage) => void;
}> = ({ message, replyTo, currentUser, pinned, searchTerm, canManage, onReply, onEdit, onDelete, onToggleReaction, onPin }) => {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || '');
  const [copied, setCopied] = useState(false);
  const isSelf = message.senderId === currentUser?.id;
  const isDeleted = Boolean(message.deletedAt);
  const groupedReactions = useMemo(() => {
    return (message.reactions || []).reduce<Record<string, string[]>>((acc, reaction) => {
      acc[reaction.emoji] = acc[reaction.emoji] || [];
      acc[reaction.emoji].push(reaction.userId);
      return acc;
    }, {});
  }, [message.reactions]);

  useEffect(() => setDraft(message.content || ''), [message.content, message.id]);

  const renderContent = () => {
    if (isDeleted) return <span className="italic text-slate-400">This message was deleted</span>;
    if (!searchTerm.trim()) return <span>{message.content}</span>;
    const parts = (message.content || '').split(new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, index) => (
      part.toLowerCase() === searchTerm.toLowerCase()
        ? <mark key={`${part}-${index}`} className="rounded bg-yellow-300 px-0.5 text-black">{part}</mark>
        : <span key={`${part}-${index}`}>{part}</span>
    ));
  };
  const rowTone = pinned
    ? 'bg-amber-50/70 dark:bg-amber-950/20'
    : 'hover:bg-white/5';
  const actionRailPosition = isSelf ? 'left-4' : 'right-4';

  return (
    <div
      id={`msg-${message.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative flex px-4 py-2 transition ${isSelf ? 'justify-end' : 'justify-start'} ${rowTone}`}
    >
      <div className={`flex max-w-[min(78%,44rem)] gap-3 ${isSelf ? 'flex-row-reverse' : ''}`}>
        <Avatar userId={message.senderId} name={message.sender?.name || message.senderName} avatarUrl={message.sender?.avatarUrl} size="md" showPresence={false} className="pt-0.5" />
        <div className={`min-w-0 ${isSelf ? 'text-right' : 'text-left'}`}>
          <div className={`rounded-2xl px-3.5 py-2.5 shadow-sm ring-1 ${
            isSelf
              ? 'rounded-tr-md bg-blue-600 text-white ring-blue-400/30'
              : 'rounded-tl-md bg-slate-900/90 text-slate-100 ring-white/10'
          }`}>
            {replyTo && (
              <button type="button" onClick={() => document.getElementById(`msg-${replyTo.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={`mb-1.5 flex max-w-xl items-center gap-2 rounded-lg border-l-2 border-blue-300 px-2.5 py-1 text-left text-[11px] ${isSelf ? 'bg-blue-500/40 text-blue-50 hover:bg-blue-500/60' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'}`}>
                <CornerDownRight className="h-3 w-3 shrink-0 text-blue-200" />
                <strong>{replyTo.senderName}:</strong>
                <span className="truncate">{replyTo.content}</span>
              </button>
            )}
            <div className={`mb-0.5 flex items-center gap-2 ${isSelf ? 'justify-end' : ''}`}>
              <span className="text-xs font-bold">{isSelf ? 'You' : message.sender?.name || message.senderName}</span>
              <span className={isSelf ? 'text-[10px] text-blue-100/75' : 'text-[10px] text-slate-400'}>{formatTime(message.createdAt)}</span>
              {message.editedAt && !isDeleted && <span className={isSelf ? 'text-[10px] italic text-blue-100/75' : 'text-[10px] italic text-slate-400'}>edited</span>}
              {pinned && <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-200"><Pin className="h-3 w-3" /> Pinned</span>}
              {isSelf && !isDeleted && <span className="text-blue-100/80">{message.deliveryStatus === 'read' ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}</span>}
            </div>
            {editing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onEdit(message, draft);
                  setEditing(false);
                }}
                className="space-y-2"
              >
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                <div className="flex gap-2">
                  <button type="submit" className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white">Save</button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="whitespace-pre-wrap break-words text-xs leading-6">{renderContent()}</div>
            )}
            {!isDeleted && message.attachments?.length > 0 && (
              <div className={`mt-2 flex flex-wrap gap-2 ${isSelf ? 'justify-end' : ''}`}>
                {message.attachments.map((attachment) => {
                  const fileName = attachment.originalFileName || attachment.fileName || 'Attachment';
                  const key = attachment.id || attachment.storageKey || attachment.url || fileName;
                  if (isImageAttachment(attachment) && attachment.url) {
                    return (
                      <a key={key} href={attachment.url} target="_blank" rel="noreferrer" className="group/attachment relative block max-w-xs overflow-hidden rounded-xl border border-white/20 bg-slate-900">
                        <img src={attachment.url} alt={fileName} loading="lazy" className="max-h-56 object-cover transition group-hover/attachment:scale-[1.02]" />
                        <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover/attachment:flex"><ExternalLink className="h-5 w-5" /></span>
                      </a>
                    );
                  }
                  return (
                    <a key={key} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="flex max-w-sm items-center gap-3 rounded-xl border border-white/20 bg-black/20 p-3 text-xs hover:border-blue-300">
                      <span className="rounded-lg bg-white/10 p-2 text-blue-100"><FileText className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{fileName}</span>
                        <span className="text-[10px] opacity-70">{formatFileSize(attachment.fileSize)}</span>
                      </span>
                      <Download className="h-4 w-4 opacity-70" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
          {Object.keys(groupedReactions).length > 0 && (
          <div className={`mt-2 flex flex-wrap gap-1.5 ${isSelf ? 'justify-end' : ''}`}>
            {Object.entries(groupedReactions).map(([reaction, userIds]) => (
              <button key={reaction} type="button" onClick={() => onToggleReaction(message, reaction)} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${userIds.includes(currentUser?.id || '') ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {reaction} {userIds.length}
              </button>
            ))}
          </div>
          )}
        </div>
      </div>
      {!isDeleted && hovered && (
        <div className={`absolute ${actionRailPosition} -top-3 z-20 flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800`}>
          {quickReactions.map((reaction) => (
            <button key={reaction} type="button" onClick={() => onToggleReaction(message, reaction)} className="rounded-lg px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">{reaction}</button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <button type="button" onClick={() => onReply(message)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-700"><CornerDownRight className="h-3.5 w-3.5" /></button>
          {canManage && <button type="button" onClick={() => onPin(message)} className={`rounded-lg p-1.5 ${pinned ? 'text-amber-500' : 'text-slate-500 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-700'}`}><Pin className="h-3.5 w-3.5" /></button>}
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(message.content || ''); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-200" title={copied ? 'Copied' : 'Copy'}><Copy className="h-3.5 w-3.5" /></button>
          {isSelf && <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-700"><Edit2 className="h-3.5 w-3.5" /></button>}
          {isSelf && <button type="button" onClick={() => onDelete(message)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      )}
    </div>
  );
};

const MessageTimeline: React.FC<{
  conversation: ChatConversation;
  messages: ChatMessage[];
  currentUser?: User | null;
  loading: boolean;
  hasMore: boolean;
  pinnedIds: Set<string>;
  searchTerm: string;
  typingUsers: string[];
  canManage: boolean;
  onLoadMore: () => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, content: string) => void;
  onDelete: (message: ChatMessage) => void;
  onToggleReaction: (message: ChatMessage, reaction: string) => void;
  onPin: (message: ChatMessage) => void;
  backgroundColor: string;
}> = ({ conversation, messages, currentUser, loading, hasMore, pinnedIds, searchTerm, typingUsers, canManage, onLoadMore, onReply, onEdit, onDelete, onToggleReaction, onPin, backgroundColor }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const filteredMessages = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return term ? messages.filter((message) => (message.content || '').toLowerCase().includes(term)) : messages;
  }, [messages, searchTerm]);

  useEffect(() => {
    if (scrollRef.current && !showScrollBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages.length, showScrollBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 180);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative min-h-0 flex-1 overflow-y-auto px-1 py-4 transition-colors duration-200"
      style={{ backgroundColor }}
    >
      {hasMore && (
        <div className="mb-4 flex justify-center">
          <button type="button" onClick={onLoadMore} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">Load older messages</button>
        </div>
      )}
      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Loading secure message history...</div>
      ) : filteredMessages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center p-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><MessageSquare className="h-6 w-6" /></div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{searchTerm ? 'No matching messages found' : `Welcome to ${getConversationTitle(conversation, currentUser)}`}</h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{searchTerm ? `No messages matched "${searchTerm}".` : 'Send a message, share files, pin important context, or start a call.'}</p>
        </div>
      ) : (
        filteredMessages.map((message, index) => {
          const previous = index > 0 ? filteredMessages[index - 1] : null;
          const showHeader = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          return (
            <React.Fragment key={message.id}>
              {showHeader && (
                <div className="my-4 flex items-center px-4">
                  <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                  <span className="mx-3 rounded-full border border-slate-100 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900">{formatDateHeader(message.createdAt)}</span>
                  <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                </div>
              )}
              <MessageRow
                message={message}
                replyTo={message.replyToMessageId ? messagesById.get(message.replyToMessageId) : null}
                currentUser={currentUser}
                pinned={pinnedIds.has(message.id)}
                searchTerm={searchTerm}
                canManage={canManage}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
                onPin={onPin}
              />
            </React.Fragment>
          );
        })
      )}
      {typingUsers.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs italic text-slate-500 dark:text-slate-400">
          <span className="flex gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" /></span>
          {typingUsers.length === 1 ? `${typingUsers[0]} is typing...` : 'Several colleagues are typing...'}
        </div>
      )}
      {showScrollBottom && (
        <button type="button" onClick={() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }} className="fixed bottom-28 right-8 z-20 flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-xl">
          <ArrowDown className="h-4 w-4" /> New messages
        </button>
      )}
    </div>
  );
};

const NexusComposer: React.FC<{
  disabled?: boolean;
  disabledReason?: string;
  conversationName: string;
  replyTo?: ChatMessage | null;
  editingMessage?: ChatMessage | null;
  onSend: (content: string, options?: { replyToMessageId?: string | null; attachments?: ChatAttachment[] }) => Promise<void> | void;
  onEdit: (message: ChatMessage, content: string) => Promise<void> | void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTyping: (typing: boolean) => void;
  onUploadAttachment: (file: File, onProgress?: (progress: number) => void) => Promise<ChatAttachment>;
}> = ({ disabled, disabledReason, conversationName, replyTo, editingMessage, onSend, onEdit, onCancelReply, onCancelEdit, onTyping, onUploadAttachment }) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formatMenuOpen, setFormatMenuOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingMessage) {
      setContent(editingMessage.content || '');
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  useEffect(() => () => {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
  }, []);

  const applyFormatting = (prefix: string, suffix = prefix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end);
    const next = `${content.slice(0, start)}${prefix}${selected}${suffix}${content.slice(end)}`;
    setContent(next);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const handleInput = (value: string) => {
    setContent(value);
    onTyping(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => onTyping(false), 1400);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (disabled) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const attachment = await onUploadAttachment(file);
        setAttachments((current) => [...current, attachment]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (disabled || uploading || (!content.trim() && attachments.length === 0)) return;
    const body = content.trim();
    const files = attachments;
    setContent('');
    setAttachments([]);
    onTyping(false);
    if (editingMessage) {
      await onEdit(editingMessage, body);
      onCancelEdit();
    } else {
      await onSend(body, { replyToMessageId: replyTo?.id ?? null, attachments: files });
      onCancelReply();
    }
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void uploadFiles(event.dataTransfer.files);
      }}
      className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
    >
      {replyTo && !editingMessage && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
          <span className="truncate"><strong>Replying:</strong> {replyTo.content}</span>
          <button type="button" onClick={onCancelReply} className="rounded-lg p-1 hover:bg-blue-100 dark:hover:bg-blue-900"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {editingMessage && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="flex items-center gap-2"><Edit2 className="h-3.5 w-3.5" /> Editing message</span>
          <button type="button" onClick={onCancelEdit} className="rounded-lg p-1 hover:bg-amber-100 dark:hover:bg-amber-900"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            <span key={attachment.id || attachment.storageKey || index} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {isImageAttachment(attachment) ? <ImageIcon className="h-3.5 w-3.5 text-blue-500" /> : <FileText className="h-3.5 w-3.5 text-indigo-500" />}
              <span className="max-w-[160px] truncate">{attachment.originalFileName || attachment.fileName}</span>
              <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-rose-500"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {uploadError && <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">{uploadError}</div>}
      {disabledReason && <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">{disabledReason}</div>}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-slate-800 dark:bg-slate-900/50">
        {formatMenuOpen && (
          <div className="flex items-center gap-0.5 border-b border-slate-200/70 px-3 py-1.5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <button type="button" onClick={() => applyFormatting('**')} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800" title="Bold"><Bold className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => applyFormatting('*')} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800" title="Italic"><Italic className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => applyFormatting('`')} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800" title="Code"><Code className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => applyFormatting('- ', '')} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800" title="List"><List className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => applyFormatting('> ', '')} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800" title="Quote"><Quote className="h-3.5 w-3.5" /></button>
            <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-800" />
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => event.target.files && void uploadFiles(event.target.files)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || disabled} className="rounded-lg p-1.5 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-slate-800" title="Attach file">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : <Paperclip className="h-3.5 w-3.5" />}</button>
            <button type="button" onClick={() => setContent((value) => `${value}@`)} disabled={disabled} className="rounded-lg px-2 py-1 text-xs font-black hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-slate-800" title="Mention">@</button>
            <button type="button" onClick={() => setContent((value) => `${value}+1`)} disabled={disabled} className="rounded-lg p-1.5 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-slate-800" title="Insert reaction text"><Smile className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => handleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? 'Select a conversation' : `Message ${conversationName}...`}
            className="max-h-44 w-full resize-none border-0 bg-transparent text-xs leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <button type="button" onClick={() => setFormatMenuOpen((value) => !value)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" title="Formatting toolbar"><Bold className="h-4 w-4" /></button>
          <button type="button" onClick={() => void submit()} disabled={disabled || uploading || (!content.trim() && attachments.length === 0)} className="rounded-xl bg-blue-600 p-2 text-white shadow-sm hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40" title="Send message">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const ContactModal: React.FC<{
  open: boolean;
  mode: ContactMode;
  users: ChatDirectoryUser[];
  currentUser?: User | null;
  presenceByUserId: Record<string, Presence>;
  onClose: () => void;
  onStartDirect: (userId: string) => void;
  onAddMember: (userId: string) => void;
}> = ({ open, mode, users, currentUser, presenceByUserId, onClose, onStartDirect, onAddMember }) => {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  if (!open) return null;
  const filtered = users
    .filter((user) => user.id !== currentUser?.id)
    .filter((user) => [user.name, user.email, user.teamName, user.title, user.roleName].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 80);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-950 dark:text-white">{mode === 'add-member' ? 'Add member' : 'Colleague Directory'}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{mode === 'add-member' ? 'Add Zeaplay users to this chat space.' : 'Start direct messages with Zeaplay users.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </header>
        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          <label className="relative block">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Search users..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-2">
            {filtered.map((candidate) => {
              const status = presenceByUserId[candidate.id] || candidate.presence || 'OFFLINE';
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    mode === 'add-member' ? onAddMember(candidate.id) : onStartDirect(candidate.id);
                    onClose();
                  }}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
                >
                  <Avatar userId={candidate.id} name={candidate.name} avatarUrl={candidate.avatarUrl} presence={status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-slate-900 dark:text-white">{candidate.name}</span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{candidate.teamName || candidate.title || candidate.email}</span>
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{mode === 'add-member' ? 'Add' : 'Message'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const RightDetails: React.FC<{
  conversation: ChatConversation;
  currentUser?: User | null;
  messages: ChatMessage[];
  pins: ChatPinnedMessage[];
  presenceByUserId: Record<string, Presence>;
  canManage: boolean;
  onClose: () => void;
  onOpenAddMember: () => void;
  onRemoveMember: (userId: string) => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}> = ({ conversation, currentUser, messages, pins, presenceByUserId, canManage, onClose, onOpenAddMember, onRemoveMember, onJumpToMessage, onUnpin }) => {
  const [tab, setTab] = useState<'members' | 'pinned' | 'files' | 'info'>('members');
  const attachments = messages.flatMap((message) => (message.deletedAt ? [] : (message.attachments || []).map((attachment) => ({ attachment, message }))));
  const isDirect = conversation.type === 'DIRECT';
  const tabs = [
    { id: 'members', label: 'Members', icon: Users, count: conversation.members.length },
    { id: 'pinned', label: 'Pins', icon: Pin, count: pins.length },
    { id: 'files', label: 'Files', icon: FileText, count: attachments.length },
    { id: 'info', label: 'Info', icon: Info },
  ] as const;
  return (
    <aside className="hidden h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 xl:flex">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-950 dark:text-white">Space Details</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
      </header>
      <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-white/60 p-2 dark:border-slate-800 dark:bg-slate-900/50">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold ${tab === item.id ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}>
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
              {'count' in item && item.count > 0 && <span className="rounded-full bg-slate-200 px-1 text-[9px] dark:bg-slate-800">{item.count}</span>}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'members' && (
          <div className="space-y-3">
            {!isDirect && canManage && (
              <button type="button" onClick={onOpenAddMember} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/30">
                <UserPlus className="h-4 w-4" /> Add Member
              </button>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {conversation.members.map((member) => {
                const isSelf = member.userId === currentUser?.id;
                return (
                  <div key={member.userId} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar userId={member.userId} name={member.name} avatarUrl={member.avatarUrl} presence={presenceByUserId[member.userId] || 'OFFLINE'} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{member.name}{isSelf ? ' (You)' : ''}</span>
                          {['OWNER', 'ADMIN'].includes(member.role) && <Shield className="h-3 w-3 text-blue-500" />}
                        </span>
                        <span className="block truncate text-[10px] text-slate-400">{member.title || member.departmentName || member.email}</span>
                      </span>
                    </div>
                    {!isDirect && (canManage || isSelf) && (
                      <button type="button" onClick={() => onRemoveMember(member.userId)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" title={isSelf ? 'Leave space' : 'Remove member'}>
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === 'pinned' && (
          <div className="space-y-2">
            {pins.length === 0 ? <EmptyDetail icon={Pin} label="No pinned messages yet" /> : pins.map((pin) => (
              <button key={pin.id} type="button" onClick={() => onJumpToMessage(pin.messageId)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{pin.message.senderName}</span>
                  {canManage && <span onClick={(event) => { event.stopPropagation(); onUnpin(pin.messageId); }} className="rounded p-0.5 text-slate-400 hover:text-rose-500"><X className="h-3 w-3" /></span>}
                </div>
                <p className="line-clamp-3 text-xs text-slate-600 dark:text-slate-300">{pin.message.content || 'Attachment'}</p>
              </button>
            ))}
          </div>
        )}
        {tab === 'files' && (
          <div className="space-y-2">
            {attachments.length === 0 ? <EmptyDetail icon={FileText} label="No shared files yet" /> : attachments.map(({ attachment, message }, index) => (
              <a key={`${attachment.id || attachment.storageKey}-${index}`} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">{isImageAttachment(attachment) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-200">{attachment.originalFileName || attachment.fileName}</span>
                    <span className="text-[10px] text-slate-400">{formatFileSize(attachment.fileSize)} | {formatDateHeader(message.createdAt)}</span>
                  </span>
                </span>
                <Download className="h-4 w-4 text-slate-400" />
              </a>
            ))}
          </div>
        )}
        {tab === 'info' && (
          <div className="space-y-3 text-xs">
            <InfoCard label="Topic & Purpose">{conversation.description || 'No topic has been set for this space yet.'}</InfoCard>
            <InfoCard label="Details">
              <div className="space-y-1.5">
                <div className="flex justify-between"><span>Type</span><strong>{conversation.type}</strong></div>
                <div className="flex justify-between"><span>Privacy</span><strong>{conversation.isPrivate ? 'Private' : 'Public'}</strong></div>
                <div className="flex justify-between"><span>Created</span><strong>{new Date(conversation.createdAt).toLocaleDateString()}</strong></div>
                <div className="truncate font-mono text-[10px] text-slate-400">{conversation.id}</div>
              </div>
            </InfoCard>
          </div>
        )}
      </div>
    </aside>
  );
};

const EmptyDetail: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string }> = ({ icon: Icon, label }) => (
  <div className="py-8 text-center text-slate-400">
    <Icon className="mx-auto mb-2 h-6 w-6 opacity-50" />
    <p className="text-xs">{label}</p>
  </div>
);

const InfoCard: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
    <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
    {children}
  </div>
);

const CallLayers: React.FC<{
  call: ReturnType<typeof useNexusCalls>;
  currentUser?: User | null;
}> = ({ call, currentUser }) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const meetingVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream;
    if (meetingVideoRef.current) meetingVideoRef.current.srcObject = call.localStream;
  }, [call.localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call.remoteStream;
  }, [call.remoteStream]);

  if (call.activeCall?.state === 'incoming') {
    const isVideo = call.activeCall.callType === 'video';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
        <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-blue-500/20 blur-2xl" />
          <div className="relative z-10">
            <div className="mb-4 inline-block"><Avatar name={call.activeCall.remoteUserName} avatarUrl={call.activeCall.remoteUserAvatar} size="xl" showPresence={false} /></div>
            <h3 className="mb-1 text-base font-bold text-white">{call.activeCall.remoteUserName}</h3>
            <p className="mb-6 text-xs text-slate-400">Incoming {isVideo ? 'video' : 'audio'} call</p>
            <div className="flex items-center justify-center gap-4">
              <button type="button" onClick={call.declineCall} className="rounded-full bg-rose-600 p-4 text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500" title="Decline"><PhoneOff className="h-5 w-5" /></button>
              <button type="button" onClick={() => void call.acceptCall('audio')} className="rounded-full bg-emerald-600 p-4 text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500" title="Accept audio"><Phone className="h-5 w-5" /></button>
              {isVideo && <button type="button" onClick={() => void call.acceptCall('video')} className="rounded-full bg-blue-600 p-4 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500" title="Accept video"><Video className="h-5 w-5" /></button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (call.activeCall) {
    const connected = call.activeCall.state === 'connected';
    const showVideo = call.activeCall.callType === 'video' && call.remoteStream;
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950 p-6 text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={call.activeCall.remoteUserName} avatarUrl={call.activeCall.remoteUserAvatar} size="md" showPresence={false} />
            <div>
              <h2 className="text-sm font-bold">{call.activeCall.remoteUserName}</h2>
              <p className="flex items-center gap-2 text-xs text-slate-400"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />{connected ? `Connected ${formatDuration(call.callDuration)}` : 'Calling...'}</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-mono text-emerald-400"><Radio className="h-3.5 w-3.5" /> WebRTC Direct</span>
        </div>
        <div className="relative mx-auto my-4 flex w-full max-w-5xl flex-1 items-center justify-center overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
          {showVideo ? <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" /> : (
            <div className="text-center">
              <Avatar name={call.activeCall.remoteUserName} avatarUrl={call.activeCall.remoteUserAvatar} size="xl" showPresence={false} />
              <h3 className="mt-4 text-base font-bold">{call.activeCall.remoteUserName}</h3>
              <p className="text-xs text-slate-400">{connected ? 'Audio connected' : 'Connecting peer stream...'}</p>
            </div>
          )}
          {call.localStream && (
            <div className="absolute bottom-4 right-4 h-36 w-48 overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-800">
              {call.isVideoOff ? <div className="flex h-full flex-col items-center justify-center text-xs text-slate-400"><VideoOff className="mb-1 h-5 w-5" /> Camera off</div> : <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />}
              <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px]">You {call.isMuted ? 'Muted' : ''}</span>
            </div>
          )}
        </div>
        <MediaControls isMuted={call.isMuted} isVideoOff={call.isVideoOff} isScreenSharing={call.isScreenSharing} onToggleMute={call.toggleMute} onToggleVideo={call.toggleVideo} onToggleScreenShare={() => void call.toggleScreenShare()} onEnd={() => call.endCall()} />
      </div>
    );
  }

  if (call.activeMeetingId) {
    const others = call.meetingParticipants.filter((participant) => participant.userId !== currentUser?.id);
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950 p-4 text-white">
        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-600/20 p-2 text-blue-300"><Users className="h-4 w-4" /></span>
            <div>
              <h2 className="text-xs font-bold">{call.activeMeetingTitle}</h2>
              <p className="text-[10px] font-mono text-slate-400">Meeting ID: {call.activeMeetingId} | {call.meetingParticipants.length || 1} connected</p>
            </div>
          </div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(window.location.href)} className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"><Copy className="h-3.5 w-3.5" /> Copy Invite Link</button>
        </div>
        <div className="my-3 grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-2">
          <div className="relative flex items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {call.isVideoOff ? <div className="text-center"><Avatar userId={currentUser?.id} name={currentUser?.name || 'You'} avatarUrl={currentUser?.avatarUrl || currentUser?.profileImageUrl} size="xl" showPresence={false} /><p className="mt-2 text-xs font-bold">{currentUser?.name || 'You'} (Host)</p></div> : <video ref={meetingVideoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />}
            <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-1 text-xs">{currentUser?.name || 'You'} (You)</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Participants</h3>
            <div className="space-y-2">
              {others.length === 0 ? (
                <div className="rounded-xl bg-slate-800/60 p-4 text-center text-xs text-slate-400">Waiting for participants to join.</div>
              ) : others.map((participant) => (
                <div key={participant.socketId} className="flex items-center justify-between rounded-xl bg-slate-800/60 p-2">
                  <span className="flex items-center gap-2"><Avatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" showPresence={false} /> <span className="text-xs">{participant.displayName}</span></span>
                  {participant.audioEnabled ? <Mic className="h-3.5 w-3.5 text-emerald-400" /> : <MicOff className="h-3.5 w-3.5 text-rose-400" />}
                </div>
              ))}
            </div>
          </div>
        </div>
        <MediaControls isMuted={call.isMuted} isVideoOff={call.isVideoOff} isScreenSharing={call.isScreenSharing} onToggleMute={call.toggleMute} onToggleVideo={call.toggleVideo} onToggleScreenShare={() => void call.toggleScreenShare()} onEnd={call.leaveMeeting} />
      </div>
    );
  }

  return null;
};

const MediaControls: React.FC<{
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onEnd: () => void;
}> = ({ isMuted, isVideoOff, isScreenSharing, onToggleMute, onToggleVideo, onToggleScreenShare, onEnd }) => (
  <div className="mx-auto flex w-fit items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-2 shadow-2xl">
    <button type="button" onClick={onToggleMute} className={`rounded-full p-3.5 ${isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`} title={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
    <button type="button" onClick={onToggleVideo} className={`rounded-full p-3.5 ${isVideoOff ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`} title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}>{isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}</button>
    <button type="button" onClick={onToggleScreenShare} className={`rounded-full p-3.5 ${isScreenSharing ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`} title="Share screen"><Monitor className="h-5 w-5" /></button>
    <button type="button" onClick={onEnd} className="ml-2 rounded-full bg-rose-600 p-3.5 text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500" title="Leave"><PhoneOff className="h-5 w-5" /></button>
  </div>
);

const ChatApp: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const chat = useChat(conversationId ?? null);
  const calls = useNexusCalls(user);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [creationMode, setCreationMode] = useState<'DIRECT' | 'GROUP' | 'SPACE' | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState<ContactMode | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [conversationSearch, setConversationSearch] = useState('');
  const [searchInChatOpen, setSearchInChatOpen] = useState(false);
  const [searchInChatTerm, setSearchInChatTerm] = useState('');
  const [pins, setPins] = useState<ChatPinnedMessage[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [chatBackgroundColor, setChatBackgroundColor] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_CHAT_BACKGROUND;
    return window.localStorage.getItem(CHAT_BACKGROUND_STORAGE_KEY) || DEFAULT_CHAT_BACKGROUND;
  });

  useEffect(() => {
    if (chat.selectedConversationId && chat.selectedConversationId !== conversationId) {
      navigate(`/chat/${chat.selectedConversationId}`, { replace: !conversationId });
    }
  }, [chat.selectedConversationId, conversationId, navigate]);

  useEffect(() => {
    const unread = chat.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
    const baseTitle = document.title.replace(/^\(\d+\)\s+/, '');
    document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
  }, [chat.conversations]);

  const refreshPins = async () => {
    if (!chat.selectedConversationId) {
      setPins([]);
      return;
    }
    setPinsLoading(true);
    try {
      setPins(await chatService.listPins(chat.selectedConversationId));
    } finally {
      setPinsLoading(false);
    }
  };

  useEffect(() => {
    void refreshPins();
  }, [chat.selectedConversationId]);

  const handleChatBackgroundColorChange = (color: string) => {
    setChatBackgroundColor(color);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHAT_BACKGROUND_STORAGE_KEY, color);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setReplyTo(null);
        setEditingMessage(null);
        setCreationMode(null);
        setSearchInChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectConversation = (id: string) => {
    chat.setSelectedConversationId(id);
    navigate(`/chat/${id}`);
    setSidebarOpen(false);
  };

  const selectedOtherMember = getOtherMember(chat.selectedConversation, user);
  const selectedPresence = selectedOtherMember ? chat.presenceByUserId[selectedOtherMember.userId] ?? 'OFFLINE' : 'OFFLINE';
  const currentMember = chat.selectedConversation?.members.find((member) => member.userId === user?.id) ?? null;
  const canManageSelected = Boolean(currentMember && ['OWNER', 'ADMIN'].includes(currentMember.role));
  const selectedDirectInactive = Boolean(chat.selectedConversation?.type === 'DIRECT' && selectedOtherMember?.accountStatus === 'DEACTIVATED');
  const selectedTitle = chat.selectedConversation ? getConversationTitle(chat.selectedConversation, user) : 'this chat';
  const pinnedIds = useMemo(() => new Set(pins.map((pin) => pin.messageId)), [pins]);
  const searchMatchCount = useMemo(() => {
    const term = searchInChatTerm.trim().toLowerCase();
    return term ? chat.messages.filter((message) => (message.content || '').toLowerCase().includes(term)).length : 0;
  }, [chat.messages, searchInChatTerm]);

  const pinMessage = async (message: ChatMessage) => {
    if (!chat.selectedConversationId) return;
    if (pinnedIds.has(message.id)) {
      await chat.unpinMessage(message.id);
    } else {
      await chat.pinMessage(message);
    }
    await refreshPins();
  };

  const unpinMessage = async (messageId: string) => {
    await chat.unpinMessage(messageId);
    await refreshPins();
  };

  const startDirect = async (userId: string) => {
    await chat.startDirect(userId);
    setSidebarOpen(false);
  };

  const addMember = async (userId: string) => {
    if (!chat.selectedConversationId) return;
    await chat.addMembers(chat.selectedConversationId, [userId]);
  };

  const removeMember = async (userId: string) => {
    if (!chat.selectedConversationId) return;
    await chat.removeMember(chat.selectedConversationId, userId);
  };

  const toggleMute = async () => {
    if (!chat.selectedConversationId || !user?.id || !currentMember) return;
    await chat.toggleMute(chat.selectedConversationId, user.id, !currentMember.isMuted);
  };

  const startConversationCall = (type: 'audio' | 'video') => {
    if (!chat.selectedConversation) return;
    if (chat.selectedConversation.type === 'DIRECT' && selectedOtherMember) {
      void calls.initiateCall(memberToPeer(selectedOtherMember), type, chat.selectedConversation.id);
      return;
    }
    void calls.startMeeting(`${selectedTitle} Live Meeting`, chat.selectedConversation.id);
  };

  const startMeeting = () => {
    void calls.startMeeting(chat.selectedConversation ? `${selectedTitle} Live Meeting` : undefined, chat.selectedConversation?.id ?? null);
  };

  return (
    <div className="h-[calc(100vh-5rem)] min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 lg:rounded-none lg:border-0 lg:shadow-none">
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className={`${sidebarOpen ? 'fixed inset-0 z-40 block bg-black/60 p-3 backdrop-blur-sm' : 'hidden'} lg:static lg:block lg:bg-transparent lg:p-0 lg:backdrop-blur-0`}>
          <div className="h-full overflow-hidden rounded-2xl lg:rounded-none">
            <NexusSidebar
              currentUser={user}
              conversations={chat.conversations}
              directoryUsers={chat.directoryUsers}
              selectedConversationId={chat.selectedConversationId}
              loading={chat.loadingConversations || chat.loadingDirectory}
              presenceByUserId={chat.presenceByUserId}
              filterTab={filterTab}
              searchQuery={conversationSearch}
              onFilterChange={setFilterTab}
              onSearchChange={setConversationSearch}
              onSelectConversation={selectConversation}
              onSelectUser={(userId) => void startDirect(userId)}
              onOpenCreate={setCreationMode}
              onOpenContacts={() => setContactsOpen('contacts')}
              onOpenSettings={() => navigate('/settings')}
              onStartMeeting={startMeeting}
            />
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-slate-900/60">
          <ChatTopbar
            conversation={chat.selectedConversation}
            currentUser={user}
            presence={selectedPresence}
            detailsOpen={detailsOpen}
            favorite={Boolean(currentMember?.isPinned)}
            muted={Boolean(currentMember?.isMuted)}
            onOpenSidebar={() => setSidebarOpen(true)}
            onToggleDetails={() => setDetailsOpen((value) => !value)}
            onToggleFavorite={() => chat.selectedConversationId && user?.id && void chat.toggleFavorite(chat.selectedConversationId, user.id, !currentMember?.isPinned)}
            onToggleMute={() => void toggleMute()}
            onOpenSearch={() => setSearchInChatOpen((value) => !value)}
            onOpenAddMember={() => setContactsOpen('add-member')}
            onStartCall={startConversationCall}
            onStartMeeting={startMeeting}
            chatBackgroundColor={chatBackgroundColor}
            onChatBackgroundColorChange={handleChatBackgroundColorChange}
          />
          {chat.error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">{chat.error}</div>}
          {pinsLoading ? null : <PinnedBanner pins={pins} onJump={(messageId) => document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} onUnpin={(messageId) => void unpinMessage(messageId)} />}
          <SearchInConversation open={searchInChatOpen} term={searchInChatTerm} matchCount={searchMatchCount} onChange={setSearchInChatTerm} onClose={() => { setSearchInChatOpen(false); setSearchInChatTerm(''); }} />

          {chat.selectedConversation ? (
            <ChatErrorBoundary resetKey={chat.selectedConversationId}>
              <MessageTimeline
                conversation={chat.selectedConversation}
                messages={chat.messages}
                currentUser={user}
                loading={chat.loadingMessages}
                hasMore={chat.hasMore}
                pinnedIds={pinnedIds}
                searchTerm={searchInChatTerm}
                typingUsers={chat.typingUsers.filter((name) => name !== user?.name)}
                canManage={canManageSelected}
                onLoadMore={() => void chat.loadMoreMessages()}
                onReply={(message) => { setReplyTo(message); setEditingMessage(null); }}
                onEdit={(message, content) => chat.editMessage(message, content)}
                onDelete={(message) => chat.deleteMessage(message)}
                onToggleReaction={(message, reaction) => chat.toggleReaction(message, reaction, user?.id)}
                onPin={(message) => void pinMessage(message)}
                backgroundColor={chatBackgroundColor}
              />
              <NexusComposer
                disabled={!chat.selectedConversation || selectedDirectInactive}
                disabledReason={selectedDirectInactive ? 'This user is no longer active. You can view previous messages but cannot send new messages.' : undefined}
                conversationName={chat.selectedConversation.type === 'DIRECT' ? selectedTitle : `#${selectedTitle.toLowerCase().replace(/\s+/g, '-')}`}
                replyTo={replyTo}
                editingMessage={editingMessage}
                onSend={chat.sendMessage}
                onEdit={chat.editMessage}
                onCancelReply={() => setReplyTo(null)}
                onCancelEdit={() => setEditingMessage(null)}
                onTyping={chat.setTyping}
                onUploadAttachment={(file, onProgress) => chat.uploadAttachment(chat.selectedConversationId!, file, onProgress)}
              />
            </ChatErrorBoundary>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-blue-600 shadow-lg shadow-blue-500/10 dark:bg-blue-950/40 dark:text-blue-300">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">No Conversation Selected</h2>
              <p className="mb-4 mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">Choose a channel or direct message from the sidebar, or create a new communication space.</p>
              <button type="button" onClick={() => setCreationMode('SPACE')} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500"><Plus className="h-4 w-4" /> Create Space</button>
            </div>
          )}
        </main>

        {detailsOpen && chat.selectedConversation && (
          <RightDetails
            conversation={chat.selectedConversation}
            currentUser={user}
            messages={chat.messages}
            pins={pins}
            presenceByUserId={chat.presenceByUserId}
            canManage={canManageSelected}
            onClose={() => setDetailsOpen(false)}
            onOpenAddMember={() => setContactsOpen('add-member')}
            onRemoveMember={(userId) => void removeMember(userId)}
            onJumpToMessage={(messageId) => document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            onUnpin={(messageId) => void unpinMessage(messageId)}
          />
        )}
      </div>

      <ChatModal
        open={Boolean(creationMode)}
        mode={creationMode ?? 'DIRECT'}
        users={chat.directoryUsers}
        currentUser={user}
        presenceByUserId={chat.presenceByUserId}
        onClose={() => setCreationMode(null)}
        onStartDirect={(userId) => void startDirect(userId)}
        onCreateConversation={(payload) => void chat.createConversation(payload)}
      />
      <ContactModal
        open={Boolean(contactsOpen)}
        mode={contactsOpen ?? 'contacts'}
        users={chat.directoryUsers}
        currentUser={user}
        presenceByUserId={chat.presenceByUserId}
        onClose={() => setContactsOpen(null)}
        onStartDirect={(userId) => void startDirect(userId)}
        onAddMember={(userId) => void addMember(userId)}
      />
      <ChatSearchModal open={globalSearchOpen} conversationId={chat.selectedConversationId} onClose={() => setGlobalSearchOpen(false)} onSelectConversation={selectConversation} />
      <CallLayers call={calls} currentUser={user} />
    </div>
  );
};

export default ChatApp;
