import React, { useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '../../../components/icons';
import { ChatMessageSearchResult } from '../types';
import { chatService } from '../services/chatService';

type Props = {
  open: boolean;
  conversationId?: string | null;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
};

const highlight = (text: string, query: string) => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-200 px-0.5 text-slate-950">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
};

const ChatSearchModal: React.FC<Props> = ({ open, conversationId, onClose, onSelectConversation }) => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [results, setResults] = useState<ChatMessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await chatService.searchMessages({
          q: query.trim(),
          conversationId: scope === 'current' ? conversationId : null,
          limit: 25,
        });
        setResults(page.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [conversationId, open, query, scope]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-slate-950/30 p-4 pt-[10vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search chat" className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]">
        <div className="flex items-center gap-3 border-b border-slate-200 p-4">
          <MagnifyingGlassIcon className="h-5 w-5 text-violet-600" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages, people, spaces..." className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400" />
          <select value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'current')} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-600">
            <option value="all">All chats</option>
            <option value="current">This chat</option>
          </select>
          <button type="button" aria-label="Close search" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          )}
          {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
          {!loading && !error && query.trim().length >= 2 && results.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No results found.</p>}
          {!loading && results.map((result) => (
            <button
              key={result.message.id}
              type="button"
              onClick={() => {
                onSelectConversation(result.conversation.id);
                onClose();
              }}
              className="mb-2 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-black text-slate-950">{result.conversation.name || result.message.senderName}</p>
                <p className="text-xs text-slate-400">{new Date(result.message.createdAt).toLocaleDateString()}</p>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{highlight(result.message.content || 'Attachment', query.trim())}</p>
            </button>
          ))}
          {query.trim().length < 2 && <p className="p-6 text-center text-sm text-slate-500">Type at least two characters to search.</p>}
        </div>
      </div>
    </div>
  );
};

export default ChatSearchModal;
