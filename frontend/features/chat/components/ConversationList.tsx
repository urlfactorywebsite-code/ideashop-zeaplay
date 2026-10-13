import React from 'react';
import { ChatConversation } from '../types';
import { User } from '../../../types';
import ConversationListItem from './ConversationListItem';

type Props = {
  conversations: ChatConversation[];
  currentUser?: User | null;
  selectedConversationId: string | null;
  loading: boolean;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelect: (id: string) => void;
  sectionIcons?: {
    pinned?: React.ReactNode;
    direct?: React.ReactNode;
    group?: React.ReactNode;
  };
};

const Section: React.FC<{
  title: string;
  icon?: React.ReactNode;
  conversations: ChatConversation[];
  currentUser?: User | null;
  selectedConversationId: string | null;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelect: (id: string) => void;
}> = ({ title, icon, conversations, currentUser, selectedConversationId, presenceByUserId, onSelect }) => {
  if (!conversations.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
        {icon}
        {title}
      </h2>
      <div className="space-y-1.5">
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            currentUser={currentUser}
            selected={conversation.id === selectedConversationId}
            presence={conversation.type === 'DIRECT' ? presenceByUserId[conversation.members.find((member) => member.userId !== currentUser?.id)?.userId || ''] ?? 'OFFLINE' : undefined}
            onSelect={() => onSelect(conversation.id)}
          />
        ))}
      </div>
    </section>
  );
};

const ConversationSkeleton = () => (
  <div className="space-y-2 px-1" aria-label="Loading conversations">
    {[0, 1, 2, 3].map((item) => (
      <div key={item} className="flex animate-pulse items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
        <div className="h-10 w-10 rounded-2xl bg-slate-200" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-28 rounded bg-slate-200" />
          <div className="h-2 w-40 rounded bg-slate-100" />
        </div>
      </div>
    ))}
  </div>
);

const ConversationList: React.FC<Props> = ({ conversations, currentUser, selectedConversationId, loading, presenceByUserId, onSelect, sectionIcons }) => {
  const pinned = conversations.filter((conversation) => conversation.members.some((member) => member.userId === currentUser?.id && member.isPinned));
  const direct = conversations.filter((conversation) => conversation.type === 'DIRECT' && !pinned.includes(conversation));
  const groups = conversations.filter((conversation) => conversation.type === 'GROUP' && !pinned.includes(conversation));
  const spaces = conversations.filter((conversation) => conversation.type === 'SPACE' && !pinned.includes(conversation));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-slate-50/80 p-3">
      {loading && <ConversationSkeleton />}
      {!loading && conversations.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          No conversations match this view.
        </p>
      )}
      <Section title="Pinned" icon={sectionIcons?.pinned} conversations={pinned} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelect={onSelect} />
      <Section title="Direct messages" icon={sectionIcons?.direct} conversations={direct} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelect={onSelect} />
      <Section title="Groups" icon={sectionIcons?.group} conversations={groups} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelect={onSelect} />
      <Section title="Spaces" icon={sectionIcons?.group} conversations={spaces} currentUser={currentUser} selectedConversationId={selectedConversationId} presenceByUserId={presenceByUserId} onSelect={onSelect} />
    </div>
  );
};

export default ConversationList;
