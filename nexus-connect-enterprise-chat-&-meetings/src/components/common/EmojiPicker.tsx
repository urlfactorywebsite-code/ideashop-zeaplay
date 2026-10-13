import React, { useState } from 'react';
import { Smile, Heart, ThumbsUp, Sparkles, Flag, Search, X } from 'lucide-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    id: 'frequent',
    name: 'Frequent & Popular',
    emojis: ['👍', '❤️', '🎉', '🚀', '🔥', '👀', '🙌', '👏', '✅', '💯', '😊', '💡'],
  },
  {
    id: 'smileys',
    name: 'Smileys & People',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😎', '🤓', '🧐', '🤔', '🤫', '🫡', '🤝', '👋', '✌️', '💪', '🙏'],
  },
  {
    id: 'work',
    name: 'Work & Collaboration',
    emojis: ['📊', '📈', '📉', '💻', '🖥️', '⌨️', '📁', '📄', '📝', '📅', '📆', '⏰', '⏱️', '📌', '📍', '🎯', '🔒', '🔑', '💡', '⚡', '🛠️', '⚙️', '💬', '📢'],
  },
  {
    id: 'symbols',
    name: 'Symbols & Indicators',
    emojis: ['✨', '⭐', '🌟', '💥', '🔥', '🚀', '🎉', '🎊', '🏆', '🥇', '🟢', '🟡', '🔴', '🔵', '✔️', '❌', '⚠️', '❗', '❓', '➕', '➖', '🔔', '🔕'],
  },
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('frequent');

  const filteredCategories = EMOJI_CATEGORIES.map(cat => ({
    ...cat,
    emojis: cat.emojis.filter(e => {
      if (!searchTerm) return true;
      return true;
    }),
  }));

  return (
    <div className="w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col z-50 animate-in fade-in zoom-in-95 duration-100">
      {/* Search Header */}
      <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search emojis..."
          className="w-full text-xs bg-transparent border-none focus:outline-hidden text-slate-800 dark:text-slate-100 placeholder-slate-400"
          autoFocus
        />
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 px-2 py-1 gap-1 bg-slate-50/50 dark:bg-slate-950/40">
        {EMOJI_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              activeCategory === cat.id
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {cat.name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Emoji Grid */}
      <div className="p-2 overflow-y-auto max-h-56 space-y-3">
        {filteredCategories
          .filter(cat => cat.id === activeCategory || searchTerm)
          .map(cat => (
            <div key={cat.id}>
              <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1 px-1">
                {cat.name}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cat.emojis.map((emoji, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      onSelect(emoji);
                      onClose();
                    }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-120 transition-transform active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};
