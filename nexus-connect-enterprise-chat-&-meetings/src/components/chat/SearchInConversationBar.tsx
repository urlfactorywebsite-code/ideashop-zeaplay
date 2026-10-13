import React from 'react';
import { useChat } from '../../context/ChatContext';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';

interface SearchInConversationBarProps {
  matchCount: number;
}

export const SearchInConversationBar: React.FC<SearchInConversationBarProps> = ({ matchCount }) => {
  const {
    isSearchInChatOpen,
    setIsSearchInChatOpen,
    searchInChatTerm,
    setSearchInChatTerm,
  } = useChat();

  if (!isSearchInChatOpen) return null;

  return (
    <div className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/60 px-4 py-2 flex items-center justify-between text-xs animate-in slide-in-from-top-2 duration-150 select-none">
      <div className="flex items-center gap-2 flex-1 max-w-md">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={searchInChatTerm}
          onChange={e => setSearchInChatTerm(e.target.value)}
          placeholder="Find in this chat..."
          className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
        {searchInChatTerm && (
          <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            setSearchInChatTerm('');
            setIsSearchInChatOpen(false);
          }}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
          title="Close search"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
