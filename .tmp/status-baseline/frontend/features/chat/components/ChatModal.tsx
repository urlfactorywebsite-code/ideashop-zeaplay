import React, { useEffect, useMemo, useRef, useState } from 'react';
import { XMarkIcon } from '../../../components/icons';
import { User } from '../../../types';
import { ChatConversationType, ChatDirectoryUser } from '../types';

type Mode = 'DIRECT' | 'GROUP' | 'SPACE';

type Props = {
  open: boolean;
  mode: Mode;
  users: ChatDirectoryUser[];
  currentUser?: User | null;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onClose: () => void;
  onStartDirect: (userId: string) => void;
  onCreateConversation: (payload: {
    type: Exclude<ChatConversationType, 'DIRECT'>;
    name: string;
    description?: string | null;
    memberIds: string[];
    isPrivate: boolean;
    teamId?: string | null;
    projectId?: string | null;
  }) => void;
};

const presenceClass = {
  ONLINE: 'bg-emerald-500',
  AWAY: 'bg-amber-500',
  OFFLINE: 'bg-slate-400',
};

const ChatModal: React.FC<Props> = ({
  open,
  mode,
  users,
  currentUser,
  presenceByUserId,
  onClose,
  onStartDirect,
  onCreateConversation,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE');
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setName('');
    setDescription('');
    setPrivacy(mode === 'SPACE' ? 'PUBLIC' : 'PRIVATE');
    setTeamId('');
    setProjectId('');
    setMemberIds([]);
    setError(null);
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus(), 0);
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])'),
      ).filter((item) => !item.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((user) => user.id !== currentUser?.id)
      .filter((user) => {
        if (!needle) return true;
        return [user.name, user.email, user.teamName, user.title, user.roleName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .slice(0, 12);
  }, [currentUser?.id, query, users]);

  if (!open) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'DIRECT') return;
    if (!name.trim()) {
      setError(`${mode === 'GROUP' ? 'Group' : 'Space'} name is required.`);
      return;
    }
    onCreateConversation({
      type: mode,
      name: name.trim(),
      description: description.trim() || null,
      memberIds,
      isPrivate: privacy === 'PRIVATE',
      teamId: teamId.trim() || null,
      projectId: projectId.trim() || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-modal-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 via-sky-50 to-cyan-50 px-6 py-5">
          <div>
            <h2 id="chat-modal-title" className="text-lg font-bold text-slate-950">
              {mode === 'DIRECT' ? 'New message' : mode === 'GROUP' ? 'Create group' : 'Create space'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {mode === 'DIRECT' ? 'Search people by name, email, or team.' : 'Invite collaborators and set the right privacy.'}
            </p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-full p-2 text-slate-500 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="max-h-[calc(90vh-96px)] overflow-y-auto p-6">
          {error && <p className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

          {mode !== 'DIRECT' && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">{mode === 'GROUP' ? 'Group name' : 'Space name'}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              <label className="md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              <label>
                <span className="text-sm font-semibold text-slate-700">Privacy</span>
                <select value={privacy} onChange={(event) => setPrivacy(event.target.value as 'PUBLIC' | 'PRIVATE')} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100">
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </label>
              <label>
                <span className="text-sm font-semibold text-slate-700">Team</span>
                <input value={teamId} onChange={(event) => setTeamId(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              <label>
                <span className="text-sm font-semibold text-slate-700">Project</span>
                <input value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
            </div>
          )}

          <div className="mt-5">
            <label>
              <span className="text-sm font-semibold text-slate-700">Members</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
            </label>
            <div className="mt-3 grid gap-2">
              {filteredUsers.map((candidate) => {
                const checked = memberIds.includes(candidate.id);
                const status = presenceByUserId[candidate.id] ?? 'OFFLINE';
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      if (mode === 'DIRECT') {
                        onStartDirect(candidate.id);
                        onClose();
                        return;
                      }
                      setMemberIds((current) => checked ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]);
                    }}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${checked ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50'}`}
                  >
                    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-sm font-bold text-white">
                      {candidate.name.slice(0, 2).toUpperCase()}
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${presenceClass[status]}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950">{candidate.name}</span>
                      <span className="block truncate text-xs text-slate-500">{candidate.teamName || candidate.title || candidate.email}</span>
                    </span>
                    {mode !== 'DIRECT' && <span className={`h-5 w-5 rounded-full border ${checked ? 'border-violet-500 bg-violet-500' : 'border-slate-300'}`} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          {mode !== 'DIRECT' && (
            <footer className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">Cancel</button>
              <button type="submit" className="rounded-2xl bg-gradient-to-r from-violet-600 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
                {mode === 'GROUP' ? 'Create group' : 'Create space'}
              </button>
            </footer>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatModal;
