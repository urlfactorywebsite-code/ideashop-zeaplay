import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface SearchableMultiSelectOption {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  statusLabel: string;
}

interface Props {
  id: string;
  label: string;
  options: SearchableMultiSelectOption[];
  selectedOptions: SearchableMultiSelectOption[];
  value: string[];
  onToggle: (id: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  loadingMessage: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  renderAvatar: (option: SearchableMultiSelectOption, size: number) => React.ReactNode;
  selectedStatusLabel?: string;
  selectionMode?: 'multiple' | 'single';
  onOpenChange?: (open: boolean, id?: string) => void;
  avoidClipping?: boolean;
  className?: string;
}

// The Create Task assignee picker, shared without changing its visual classes.
export default function SearchableMultiSelect({ id, label, options, selectedOptions, value, onToggle,
  search, onSearchChange, placeholder, searchPlaceholder, emptyMessage, loadingMessage, loading,
  error, onRetry, hasMore, onLoadMore, renderAvatar, selectedStatusLabel, selectionMode = 'multiple', onOpenChange,
  avoidClipping = false, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const [listHeight, setListHeight] = useState(256);
  const listId = useId();
  const activeId = options[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => { onOpenChange?.(open, id); }, [open, id, onOpenChange]);

  useLayoutEffect(() => {
    if (!open || !avoidClipping) return;
    const position = () => {
      const root = rootRef.current;
      if (!root) return;
      const trigger = root.getBoundingClientRect();
      let top = 0, bottom = window.innerHeight;
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
        }
      }
      const below = bottom - trigger.bottom - 8;
      const before = trigger.top - top - 8;
      // Measure search and footer content: loading, pagination and wrapped errors
      // can all be present together. Keep the usual below-trigger position when
      // it has room for at least two rows, including while search results change.
      const overhead = (popupRef.current?.offsetHeight ?? 0) - (listRef.current?.offsetHeight ?? 0);
      const useAbove = below < overhead + 104 && before > below;
      setAbove(useAbove);
      setListHeight(Math.min(256, Math.max(0, Math.floor((useAbove ? before : below) - overhead))));
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [open, avoidClipping, options.length, loading, error, hasMore]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [search]);
  useEffect(() => { setActiveIndex(current => Math.min(current, Math.max(0, options.length - 1))); }, [options.length]);
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const select = (optionId: string) => {
    onToggle(optionId);
    if (selectionMode === 'single') close();
    else inputRef.current?.focus();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (options[activeIndex]) select(options[activeIndex].id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, options.length - 1));
    }
  };

  return <div ref={rootRef} className={`relative mt-2 ${className}`} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={triggerRef} id={id} type="button" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={() => setOpen(current => !current)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}
      className="modal-input flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:scale-[1.01]">
      <span className="flex min-w-0 flex-1 flex-wrap gap-2">
        {selectedOptions.length === 0 ? <span className="text-white/45">{loading ? loadingMessage : placeholder}</span>
          : selectedOptions.slice(0, 3).map(option => <span key={option.id} className="modal-chip inline-flex max-w-full items-center gap-2 px-2 py-1 text-xs">
            <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-black/40">{renderAvatar(option, 20)}</span>
            <span className="truncate">{option.name}</span>
          </span>)}
        {value.length > 3 && <span className="modal-chip px-2 py-1 text-xs">+{value.length - 3}</span>}
      </span>
      {selectionMode === 'multiple' ? <span className="shrink-0 text-xs uppercase tracking-[0.2em] modal-muted" aria-live="polite">{value.length} selected</span>
        : <svg aria-hidden="true" className={`h-4 w-4 shrink-0 modal-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>}
    </button>
    {open && <div ref={popupRef} className={`absolute left-0 right-0 z-[140] ${above ? 'bottom-full mb-2' : 'top-full mt-2'} overflow-hidden rounded-2xl border border-white/15 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl`}>
      <div className="border-b border-white/10 p-2">
        <input ref={inputRef} type="text" role="combobox" aria-label={searchPlaceholder} aria-expanded={open}
          aria-controls={listId} aria-activedescendant={activeId} aria-autocomplete="list"
          value={search} maxLength={120} onChange={event => onSearchChange(event.target.value)} onKeyDown={keyDown}
          placeholder={searchPlaceholder}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/60 focus:outline-none" />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={label} aria-multiselectable={selectionMode === 'multiple'} aria-busy={!!loading}
        style={avoidClipping ? { maxHeight: listHeight } : undefined} className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
        {options.map((option, index) => {
          const selected = value.includes(option.id);
          return <button id={`${listId}-${index}`} key={option.id} type="button" role="option" aria-selected={selected} tabIndex={-1}
            onMouseEnter={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()}
            onClick={() => select(option.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition duration-150 ${index === activeIndex ? 'bg-cyan-400/10' : 'hover:bg-white/10'} ${selected ? 'text-cyan-100' : 'text-white/80'}`}>
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/40">
              {renderAvatar(option, 36)}
              <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-slate-950 ${option.active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{option.name}</span>
              <span className="block truncate text-xs text-white/45">{option.description}</span>
            </span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${selected ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/40'}`}>
              {selected && selectedStatusLabel ? selectedStatusLabel : option.statusLabel}
            </span>
          </button>;
        })}
      </div>
      {loading && <div role="status" className="px-3 py-3 text-sm text-white/50">{loadingMessage}</div>}
      {!loading && !error && options.length === 0 && <div role="status" className="px-3 py-3 text-sm text-white/50">{emptyMessage}</div>}
      {error && <div role="alert" className="px-3 py-3 text-sm text-rose-200">{error} <button type="button" onClick={onRetry} className="underline">Retry</button></div>}
      {hasMore && !error && <button type="button" disabled={loading} onMouseDown={event => event.preventDefault()}
        onClick={() => { inputRef.current?.focus(); onLoadMore?.(); }}
        className="w-full px-3 py-2 text-sm text-cyan-100 hover:bg-white/10 disabled:opacity-50">Load more</button>}
    </div>}
  </div>;
}
