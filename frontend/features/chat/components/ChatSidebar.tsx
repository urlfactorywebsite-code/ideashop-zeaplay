import React, { useMemo, useState } from 'react';
import { BoltIcon, EllipsisVerticalIcon, FunnelIcon, MagnifyingGlassIcon, PlusIcon, StarIcon } from '../../../components/icons';
import { User } from '../../../types';
import { ChatConversation, ChatDirectoryUser } from '../types';
import { getConversationSubtitle, getConversationTitle, initials } from '../utils/conversation';
import { timeAgo } from '../../../utils';

type Props = {
  currentUser?: User | null;
  conversations: ChatConversation[];
  directoryUsers: ChatDirectoryUser[];
  selectedConversationId: string | null;
  loading: boolean;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelectConversation: (id: string) => void;
  onSelectUser: (userId: string) => void;
  onOpenCreate: (mode: 'DIRECT' | 'GROUP' | 'SPACE') => void;
  onOpenSearch: () => void;
};

type Row =
  | { kind: 'conversation'; id: string; conversation: ChatConversation; favorite: boolean; sortName: string }
  | { kind: 'user'; id: string; user: ChatDirectoryUser; favorite: boolean; sortName: string };

const presenceClass = {
  ONLINE: 'bg-emerald-400',
  AWAY: 'bg-zinc-500',
  OFFLINE: 'bg-zinc-500',
};

const presenceText = (status: 'ONLINE' | 'AWAY' | 'OFFLINE') => {
  if (status === 'ONLINE') return 'Available';
  if (status === 'AWAY') return 'Active 15 minutes ago';
  return 'Active 1 hour ago';
};

const RowButton: React.FC<{
  row: Row;
  currentUser?: User | null;
  selectedConversationId: string | null;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelectConversation: (id: string) => void;
  onSelectUser: (userId: string) => void;
}> = ({ row, currentUser, selectedConversationId, presenceByUserId, onSelectConversation, onSelectUser }) => {
  const conversation = row.kind === 'conversation' ? row.conversation : null;
  const directoryUser = row.kind === 'user' ? row.user : null;
  const directMember = conversation?.type === 'DIRECT'
    ? conversation.members.find((member) => member.userId !== currentUser?.id)
    : null;
  const title = conversation ? getConversationTitle(conversation, currentUser) : directoryUser?.name ?? 'Unknown';
  const avatarUrl = directMember?.avatarUrl ?? conversation?.avatarUrl ?? directoryUser?.avatarUrl ?? null;
  const presence = directMember
    ? presenceByUserId[directMember.userId] ?? 'OFFLINE'
    : directoryUser
      ? presenceByUserId[directoryUser.id] ?? directoryUser.presence
      : undefined;
  const selected = Boolean(conversation && conversation.id === selectedConversationId);
  const preview = conversation?.lastMessage?.deletedAt
    ? 'Message deleted'
    : conversation?.lastMessage?.content
      || directoryUser?.latestMessagePreview
      || directMember?.title
      || directMember?.departmentName
      || directoryUser?.title
      || directoryUser?.teamName
      || (presence ? presenceText(presence) : conversation ? getConversationSubtitle(conversation) : '');
  const unread = conversation?.unreadCount ?? directoryUser?.unreadCount ?? 0;
  const timeLabel = conversation?.lastMessageAt || directoryUser?.lastMessageAt;

  return (
    <button
      type="button"
      onClick={() => conversation ? onSelectConversation(conversation.id) : directoryUser && onSelectUser(directoryUser.id)}
      aria-current={selected ? 'page' : undefined}
      className={`chat-nav-row ${selected ? 'chat-nav-row-active' : ''}`}
    >
      <span className="chat-avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(title)}
        {presence && <span className={`chat-presence-dot ${presenceClass[presence]}`} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${unread > 0 ? 'font-semibold text-white' : 'font-medium'}`}>{title}</span>
        <span className={`block truncate text-xs ${unread > 0 ? 'font-semibold text-white' : 'text-zinc-300'}`}>{preview}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="h-4 text-[10px] font-semibold text-zinc-500">{timeLabel ? timeAgo(timeLabel) : ''}</span>
        {unread > 0 ? (
          <span className="chat-unread-dot">{unread}</span>
        ) : row.favorite ? (
          <StarIcon className="h-3.5 w-3.5 text-amber-400" />
        ) : (
          <EllipsisVerticalIcon className="h-4 w-4 opacity-0 transition group-hover:opacity-70" />
        )}
      </span>
    </button>
  );
};

const Section: React.FC<{
  title: string;
  rows: Row[];
  currentUser?: User | null;
  selectedConversationId: string | null;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelectConversation: (id: string) => void;
  onSelectUser: (userId: string) => void;
}> = ({ title, rows, currentUser, selectedConversationId, presenceByUserId, onSelectConversation, onSelectUser }) => {
  if (!rows.length) return null;
  return (
    <section className="space-y-1">
      <h2 className="chat-section-title">{title}</h2>
      {rows.map((row) => (
        <RowButton
          key={`${row.kind}:${row.id}`}
          row={row}
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

const ChatSidebar: React.FC<Props> = ({
  currentUser,
  conversations,
  directoryUsers,
  selectedConversationId,
  loading,
  presenceByUserId,
  onSelectConversation,
  onSelectUser,
  onOpenCreate,
  onOpenSearch,
}) => {
  const [tab, setTab] = useState<'ALL' | 'DIRECT' | 'SPACE'>('ALL');

  const rows = useMemo(() => {
    const directUserIds = new Set<string>();
    const conversationRows: Row[] = conversations.map((conversation) => {
      const title = getConversationTitle(conversation, currentUser);
      const selfMember = conversation.members.find((member) => member.userId === currentUser?.id);
      if (conversation.type === 'DIRECT') {
        const other = conversation.members.find((member) => member.userId !== currentUser?.id);
        if (other) directUserIds.add(other.userId);
      }
      return { kind: 'conversation', id: conversation.id, conversation, favorite: Boolean(selfMember?.isPinned), sortName: title };
    });

    const userRows: Row[] = directoryUsers
      .filter((directoryUser) => !directUserIds.has(directoryUser.id))
      .map((directoryUser) => ({
        kind: 'user',
        id: directoryUser.id,
        user: directoryUser,
        favorite: directoryUser.isFavorite,
        sortName: directoryUser.name,
      }));

    return [...conversationRows, ...userRows].filter((row) => {
      if (tab === 'ALL') return true;
      if (tab === 'DIRECT') return row.kind === 'user' || row.conversation.type === 'DIRECT';
      return row.kind === 'conversation' && row.conversation.type === 'SPACE';
    });
  }, [conversations, currentUser, directoryUsers, tab]);

  const favorites = rows.filter((row) => row.favorite);
  const unread = rows.filter((row) => !row.favorite && (row.kind === 'conversation' ? row.conversation.unreadCount : row.user.unreadCount) > 0);
  const recent = rows
    .filter((row) => !row.favorite && !unread.includes(row) && row.kind === 'conversation' && row.conversation.lastMessageAt)
    .sort((a, b) => new Date((b as Extract<Row, { kind: 'conversation' }>).conversation.lastMessageAt ?? 0).getTime() - new Date((a as Extract<Row, { kind: 'conversation' }>).conversation.lastMessageAt ?? 0).getTime());
  const other = rows
    .filter((row) => !row.favorite && !unread.includes(row) && !recent.includes(row))
    .sort((a, b) => a.sortName.localeCompare(b.sortName));

  const tabs = [
    ['ALL', 'All'],
    ['DIRECT', 'Direct'],
    ['SPACE', 'Spaces'],
  ] as const;

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-header">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-white">Messaging</h1>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Search messages" onClick={onOpenSearch} className="chat-icon-button">
              <MagnifyingGlassIcon className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Filter conversations" className="chat-icon-button">
              <FunnelIcon className="h-4 w-4" />
            </button>
            <button type="button" aria-label="New conversation" onClick={() => onOpenCreate('DIRECT')} className="chat-new-button">
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`chat-tab ${tab === value ? 'chat-tab-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="chat-sidebar-scroll">
        {loading && (
          <div className="space-y-2 p-2" aria-label="Loading messaging directory">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex animate-pulse items-center gap-3 rounded-3xl bg-zinc-800 p-2">
                <div className="h-9 w-9 rounded-full bg-zinc-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 rounded bg-zinc-700" />
                  <div className="h-2 w-36 rounded bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4">
            <p className="text-sm font-semibold text-zinc-200">No people or conversations match this view.</p>
            <button type="button" onClick={() => setTab('ALL')} className="text-xs font-semibold text-sky-300">Show all messages</button>
          </div>
        )}
        {!loading && (
          <>
            {tab === 'ALL' && (
              <section className="mb-3">
                <div className="chat-recommended">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-cyan-200 text-sky-700"><BoltIcon className="h-6 w-6" /></span>
                  <span className="font-semibold text-white">Recommended messages</span>
                  <span className="ml-auto h-3.5 w-3.5 rounded-full bg-sky-400" />
                </div>
              </section>
            )}
            <Section title="Favorites" rows={favorites} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelectConversation={onSelectConversation} onSelectUser={onSelectUser} />
            <Section title="Unread" rows={unread} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelectConversation={onSelectConversation} onSelectUser={onSelectUser} />
            <Section title="Recent" rows={recent} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelectConversation={onSelectConversation} onSelectUser={onSelectUser} />
            <Section title="Other" rows={other} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelectConversation={onSelectConversation} onSelectUser={onSelectUser} />
          </>
        )}
      </div>
    </aside>
  );
};

export default ChatSidebar;
