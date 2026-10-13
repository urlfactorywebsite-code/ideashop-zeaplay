import React, { useMemo, useRef, useState } from 'react';
import { ChatConversation, ChatPinnedMessage } from '../types';
import { getConversationTitle, initials } from '../utils/conversation';
import { MagnifyingGlassIcon, XMarkIcon } from '../../../components/icons';
import { User } from '../../../types';

type Props = {
  conversation: ChatConversation | null;
  currentUser?: User | null;
  open: boolean;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  pinnedMessages: ChatPinnedMessage[];
  onClose: () => void;
};

const presenceClass = {
  ONLINE: 'bg-emerald-500 text-emerald-700',
  AWAY: 'bg-amber-500 text-amber-700',
  OFFLINE: 'bg-slate-400 text-slate-500',
};

const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-black text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
        {title}
        <span className="text-slate-400">{open ? '-' : '+'}</span>
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
};

const MemberPanel: React.FC<Props> = ({ conversation, currentUser, open, presenceByUserId, pinnedMessages, onClose }) => {
  const [memberQuery, setMemberQuery] = useState('');
  const memberSearchRef = useRef<HTMLInputElement | null>(null);
  const members = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    return (conversation?.members ?? []).filter((member) => !needle || `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(needle));
  }, [conversation?.members, memberQuery]);

  if (!open) return null;
  const title = conversation ? getConversationTitle(conversation, currentUser) : 'Details';
  const sharedFiles = conversation?.lastMessage?.attachments ?? [];

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[320px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl transition lg:static lg:z-auto lg:w-[300px] lg:shadow-none">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-violet-600">Details</p>
          <h3 className="truncate text-base font-black text-slate-950">{title}</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Search members"
            onClick={() => memberSearchRef.current?.focus()}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            <MagnifyingGlassIcon className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Close details" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Section title={conversation?.type === 'DIRECT' ? 'Profile' : 'Overview'}>
          <p className="text-sm leading-6 text-slate-600">
            {conversation?.description || (conversation?.type === 'SPACE' ? 'This is the beginning of this space.' : conversation?.type === 'GROUP' ? 'Group conversation' : 'Direct conversation')}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="font-bold text-slate-400">Privacy</p>
              <p className="mt-1 font-black text-slate-900">{conversation?.isPrivate ? 'Private' : 'Public'}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="font-bold text-slate-400">Members</p>
              <p className="mt-1 font-black text-slate-900">{conversation?.members.length ?? 0}</p>
            </div>
          </div>
        </Section>

        <Section title="Members">
          <input ref={memberSearchRef} value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search members" className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {members.map((member) => {
              const status = presenceByUserId[member.userId] ?? 'OFFLINE';
              return (
                <div key={member.userId} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <span className="relative grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-xs font-black text-white">
                    {initials(member.name)}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${presenceClass[status].split(' ')[0]}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{member.name}</p>
                    <p className={`text-xs ${presenceClass[status].split(' ')[1]}`}>{member.role} · {status.toLowerCase()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Pinned messages" defaultOpen={false}>
          {pinnedMessages.length === 0 ? (
            <p className="text-sm text-slate-500">No pinned messages yet.</p>
          ) : (
            <div className="space-y-2">
              {pinnedMessages.slice(0, 5).map((pin) => (
                <div key={pin.id} className="rounded-2xl bg-amber-50 p-3 text-sm text-slate-700">
                  <p className="font-bold text-slate-900">{pin.message.senderName}</p>
                  <p className="mt-1 line-clamp-3">{pin.message.content || 'Attachment'}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Shared media and files" defaultOpen={false}>
          {sharedFiles.length === 0 ? (
            <p className="text-sm text-slate-500">Media, files, and links will appear as messages are shared.</p>
          ) : (
            <div className="space-y-2">
              {sharedFiles.map((file) => (
                <a key={file.storageKey} href={file.url ?? '#'} target="_blank" rel="noreferrer" className="block truncate rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-sky-200">
                  {file.originalFileName}
                </a>
              ))}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
};

export default MemberPanel;
