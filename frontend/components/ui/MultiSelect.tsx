import React, { useState, useRef, useEffect, useMemo } from 'react';
import { XMarkIcon } from '../icons';
import { getUserAvatarUrl } from '../../utils/userAvatar';

interface MultiSelectOption {
  id: string;
  name: string;
  avatarUrl?: string | null;
  description?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  size?: 'md' | 'lg';
  optionStatusMap?: Record<string, 'active' | 'inactive'>;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select options...',
  className = '',
  size = 'md',
  optionStatusMap = {},
}) => {
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const handleSelect = (optionId: string) => {
    if (value.includes(optionId)) {
      onChange(value.filter(id => id !== optionId));
    } else {
      onChange([...value, optionId]);
    }
  };

  const handleRemove = (optionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter(id => id !== optionId));
  };

  const selectedOptions = options.filter(option => value.includes(option.id));
  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter((option) => option.name.toLowerCase().includes(term));
  }, [options, search]);

  return (
    <div className={`relative ${className}`}>
      <div className="w-full overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-xl">
        <div className="border-b border-white/10 bg-black/50 px-3 py-2">
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search assignees..."
            className="w-full bg-transparent px-2 py-1 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filteredOptions.length > 0 ? filteredOptions.map(option => {
          const isSelected = value.includes(option.id);
          const status = optionStatusMap[option.id];
          const isActive = status === 'active';
          const isInactive = status === 'inactive';
          const avatarUrl = getUserAvatarUrl(option);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/10 ${
                  isSelected ? 'text-primary font-medium' : 'text-white/80'
                } ${isActive ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : ''} ${isInactive ? 'opacity-60' : ''}`}
            >
                <span className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border ${
                      isSelected
                        ? 'border-primary shadow-[0_0_10px_rgba(99,102,241,0.45)]'
                        : isActive
                          ? 'border-emerald-400/70 shadow-[0_0_10px_rgba(16,185,129,0.35)]'
                          : 'border-white/20'
                    } bg-black/40 text-xs font-semibold uppercase text-white/60`}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={option.name} className="h-full w-full object-cover" />
                    ) : (
                      option.name.slice(0, 2)
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2">
                      {option.name}
                      {status && (
                        <span
                          className={`rounded-full border px-2 text-[10px] uppercase tracking-[0.2em] ${
                            status === 'active'
                              ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
                              : 'border-white/20 bg-white/5 text-white/60'
                          }`}
                        >
                          {status === 'active' ? 'Assigned' : 'Available'}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="text-xs font-normal text-white/50">{option.description}</span>
                    )}
                  </span>
                </span>
            </button>
          );
        }) : (
            <div className="px-4 py-3 text-sm text-white/50">No assignees match your search.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiSelect;
