import React, { useEffect } from 'react';
import { SparklesIcon } from '../../../components/icons';
import { ChatPinnedMessage } from '../types';

type Props = {
  open: boolean;
  loading: boolean;
  pins: ChatPinnedMessage[];
  canManage?: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
};

const PinnedMessagesPanel: React.FC<Props> = ({ open, loading, pins, canManage, onClose, onJump, onUnpin }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed bottom-0 right-0 top-5 z-50 flex w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 text-white shadow-2xl">
      <header className="relative flex min-h-16 items-center gap-3 border-b border-zinc-800 bg-zinc-900 py-3 pl-4 pr-14">
        <SparklesIcon className="h-5 w-5 text-amber-400" />
        <h2 className="flex-1 text-base font-black text-white">Pinned messages</h2>
        <button
          type="button"
          aria-label="Close pinned messages"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-white text-lg font-black leading-none text-zinc-950 shadow-lg hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <span aria-hidden="true">X</span>
          <span className="sr-only">Close</span>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-4">
        {loading && <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-zinc-900" />)}</div>}
        {!loading && pins.length === 0 && <p className="px-2 py-2 text-sm text-zinc-400">No pinned messages yet.</p>}
        {!loading && pins.map((pin) => (
          <article key={pin.id} className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-black text-white">{pin.message.senderName}</p>
              <p className="text-xs text-zinc-500">{new Date(pin.createdAt).toLocaleDateString()}</p>
            </div>
            <p className="mt-2 line-clamp-4 text-sm leading-6 text-zinc-300">{pin.message.content || 'Attachment'}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => onJump(pin.messageId)} className="rounded-full bg-sky-500 px-3 py-1.5 text-xs font-black text-white hover:bg-sky-400">Jump</button>
              {canManage && <button type="button" onClick={() => onUnpin(pin.messageId)} className="rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-black text-zinc-200 hover:bg-zinc-700">Unpin</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default PinnedMessagesPanel;
