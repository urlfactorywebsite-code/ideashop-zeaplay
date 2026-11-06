import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, Filter, ListChecks, Trash2, X } from 'lucide-react';
import type { Notification } from '../types';
import { timeAgo } from '../utils';
import { defaultNotificationFilters, filterNotifications, MAX_NOTIFICATION_SELECTION,
  notificationCategories, type NotificationFilters } from '../utils/notificationFilters';

type Props = {
  notifications: Notification[];
  renderIcon: (notification: Notification) => React.ReactNode;
  onOpen: (notification: Notification) => void;
  onDelete: (ids: string[]) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onClose: () => void;
  compact?: boolean;
};
const control = 'rounded-lg border border-sky-400/30 px-2 py-1.5 text-xs text-text-primary transition hover:bg-sky-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50';

export default function NotificationInbox({ notifications, renderIcon, onOpen, onDelete, onMarkAllRead, onClose, compact = false }: Props) {
  const id = useId();
  const [filters, setFilters] = useState<NotificationFilters>(defaultNotificationFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [working, setWorking] = useState<'read' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const restoreActionFocus = useRef(false);
  const visible = useMemo(() => filterNotifications(notifications, filters), [notifications, filters]);
  const unread = notifications.filter(item => !item.isRead).length;
  const filterCount = Number(filters.read !== 'all') + Number(filters.category !== 'all') + Number(!!filters.search.trim());

  useEffect(() => {
    const existing = new Set(visible.map(item => item.id));
    setSelected(previous => {
      const next = new Set([...previous].filter(value => existing.has(value)));
      return next.size === previous.size ? previous : next;
    });
    setConfirmIds(previous => previous?.some(value => !existing.has(value)) ? null : previous);
  }, [visible]);
  useEffect(() => { if (filtersOpen) searchInput.current?.focus(); }, [filtersOpen]);
  useEffect(() => { if (confirmIds) cancelButton.current?.focus(); }, [confirmIds]);
  useEffect(() => {
    if (!working && restoreActionFocus.current) {
      restoreActionFocus.current = false;
      filterButton.current?.focus();
    }
  }, [working]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (confirmIds) { setConfirmIds(null); deleteButton.current?.focus(); }
      else if (filtersOpen) { setFiltersOpen(false); filterButton.current?.focus(); }
      else onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [confirmIds, filtersOpen, onClose]);

  const updateFilters = (next: NotificationFilters) => {
    setFilters(next);
    setSelected(new Set());
    setConfirmIds(null);
    setError('');
    setNotice('');
  };
  const toggle = (value: string) => {
    if (busy.current) return;
    setSelecting(true);
    setNotice('');
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(value)) next.delete(value);
      else if (next.size < MAX_NOTIFICATION_SELECTION) next.add(value);
      return next;
    });
  };
  const run = async (action: 'read' | 'delete', ids: string[] = []) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(action);
    setError('');
    setNotice('');
    try {
      if (action === 'read') await onMarkAllRead();
      else await onDelete(ids);
      setNotice(action === 'read' ? 'All notifications marked as read.' : `${ids.length} notification${ids.length === 1 ? '' : 's'} deleted.`);
      if (action === 'delete') {
        setSelected(previous => new Set([...previous].filter(value => !ids.includes(value))));
        setConfirmIds(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update notifications. Please try again.');
    } finally {
      busy.current = false;
      restoreActionFocus.current = true;
      setWorking(null);
    }
  };
  const cancelDeletion = () => { setConfirmIds(null); deleteButton.current?.focus(); };

  const content = <section id="notification-inbox" aria-labelledby={`${id}-heading`} aria-busy={!!working}
    className={`${compact ? 'fixed right-4 top-20' : 'absolute right-0 mt-2'} z-[80] flex max-h-[min(36rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-sky-400/40 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 shadow-[0_20px_60px_rgba(56,189,248,0.25),0_0_0_1px_rgba(59,130,246,0.35),inset_0_0_0_1px_rgba(236,72,153,0.25)] backdrop-blur`}>
    <div className="shrink-0 border-b border-sky-400/30 bg-gradient-to-r from-sky-500/10 via-fuchsia-500/10 to-indigo-500/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div><h3 id={`${id}-heading`} className="font-semibold text-text-primary">Notifications</h3>
          <p className="text-xs text-text-muted">{unread} unread · {notifications.length} total</p></div>
        <div className="flex items-center gap-1">
          <button type="button" ref={filterButton} className={`${control} ${filterCount ? 'bg-sky-500/20 ring-1 ring-sky-300/60' : ''}`} disabled={!!working}
            aria-label={`Filter notifications${filterCount ? ` (${filterCount} active)` : ''}`} title="Filter notifications"
            aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(value => !value)}>
            <Filter className="h-4 w-4" aria-hidden="true" />{filterCount > 0 && <span className="sr-only">Filters active</span>}
          </button>
          <button type="button" className={control} aria-label="Close notifications" title="Close notifications" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${control} inline-flex items-center gap-1.5`} disabled={!!working || unread === 0}
          title="Mark all notifications as read, including filtered notifications" onClick={() => void run('read')}>
          <CheckCheck className="h-4 w-4" aria-hidden="true" />{working === 'read' ? 'Marking as read…' : 'Mark all as read'}</button>
        <button type="button" className={`${control} inline-flex items-center gap-1.5`} disabled={!!working || (!selecting && !notifications.length)}
          aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setSelected(new Set()); setConfirmIds(null); }}>
          <ListChecks className="h-4 w-4" aria-hidden="true" />{selecting ? 'Done selecting' : 'Select'}</button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {filtersOpen && <fieldset id={`${id}-filters`} className="shrink-0 space-y-2 border-b border-sky-400/20 bg-slate-950/60 p-3" disabled={!!working}>
      <legend className="sr-only">Notification filters</legend>
      <label className="block text-xs text-text-secondary">Search notifications
        <input ref={searchInput} type="search" value={filters.search} maxLength={200} onChange={event => updateFilters({ ...filters, search: event.target.value })}
          placeholder="Search notifications…" className="mt-1 w-full rounded-lg border border-sky-400/30 bg-slate-900 p-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-sky-300" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-text-secondary">Read status<select value={filters.read} onChange={event => updateFilters({ ...filters, read: event.target.value as NotificationFilters['read'] })}
          className="mt-1 w-full rounded-lg border border-sky-400/30 bg-slate-900 p-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-sky-300">
          <option value="all">All notifications</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
        <label className="min-w-0 text-xs text-text-secondary">Category<select value={filters.category} onChange={event => updateFilters({ ...filters, category: event.target.value as NotificationFilters['category'] })}
          className="mt-1 w-full rounded-lg border border-sky-400/30 bg-slate-900 p-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-sky-300">
          <option value="all">All categories</option>{notificationCategories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <button type="button" className={control} onClick={() => updateFilters(defaultNotificationFilters)} disabled={!filterCount}>Reset filters</button>
    </fieldset>}
    {selecting && <div className="shrink-0 space-y-2 border-b border-sky-400/20 bg-sky-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-primary" role="status">{selected.size} selected</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={control} disabled={!!working || !visible.length}
            onClick={() => { setConfirmIds(null); setSelected(new Set(visible.slice(0, MAX_NOTIFICATION_SELECTION).map(item => item.id))); }}>
            {visible.length > MAX_NOTIFICATION_SELECTION ? `Select first ${MAX_NOTIFICATION_SELECTION}` : 'Select all shown'}</button>
          <button type="button" className={control} disabled={!!working || !selected.size} onClick={() => { setConfirmIds(null); setSelected(new Set()); }}>Clear selection</button>
          <button type="button" ref={deleteButton} className={`${control} inline-flex items-center gap-1 text-rose-300`} disabled={!!working || !selected.size}
            onClick={() => setConfirmIds([...selected])}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete selected</button>
        </div>
      </div>
      <p className="text-xs text-text-muted">Ctrl+click or Cmd+click to select. Up to {MAX_NOTIFICATION_SELECTION} at a time.</p>
    </div>}
    {confirmIds && <div role="group" aria-label="Confirm notification deletion" className="shrink-0 border-b border-rose-400/30 bg-rose-500/10 p-3">
      <p className="text-sm text-text-primary">Delete {confirmIds.length} selected notification{confirmIds.length === 1 ? '' : 's'}? This cannot be undone.</p>
      <div className="mt-2 flex gap-2"><button type="button" ref={cancelButton} className={control} disabled={!!working} onClick={cancelDeletion}>Cancel deletion</button>
        <button type="button" className={`${control} text-rose-300`} disabled={!!working} onClick={() => void run('delete', confirmIds)}>{working === 'delete' ? 'Deleting…' : 'Confirm delete'}</button></div>
    </div>}
    {error && <p role="alert" className="shrink-0 break-words border-b border-rose-400/20 p-3 text-xs text-rose-300">{error}</p>}
    <p role="status" className={notice ? 'shrink-0 px-3 py-2 text-xs text-sky-200' : 'sr-only'}>{notice}</p>
    <div>
      <ul aria-label="Notification list" className="divide-y divide-sky-400/20">
        {visible.map(item => <li key={item.id} data-notification-id={item.id}
          className={`flex items-start gap-2 p-3 transition ${selected.has(item.id) ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-300/50' : 'hover:bg-sky-500/10'}`}>
          {selecting && <input type="checkbox" aria-label={`Select notification: ${item.message}`} checked={selected.has(item.id)}
            disabled={!!working || (!!confirmIds) || (!selected.has(item.id) && selected.size >= MAX_NOTIFICATION_SELECTION)}
            onChange={() => toggle(item.id)} className="mt-2 h-4 w-4 shrink-0 accent-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" />}
          <button type="button" disabled={!!working || !!confirmIds}
            aria-pressed={selecting ? selected.has(item.id) : undefined}
            onClick={event => { if (event.ctrlKey || event.metaKey || selecting) toggle(item.id); else onOpen(item); }}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-wait">
            <span className="shrink-0" aria-hidden="true">{renderIcon(item)}</span>
            <span className="min-w-0 flex-1"><span className={`block break-words text-sm ${item.isRead ? 'text-text-muted' : 'text-text-primary'}`}>{item.message}</span>
              <span className="mt-1 block text-xs text-text-muted">{timeAgo(item.createdAt)}</span>
              {!item.isRead && <span className="sr-only">Unread</span>}</span>
          </button>
          <button type="button" disabled={!!working || !!confirmIds} aria-label="Delete notification" title="Delete notification"
            onClick={() => void run('delete', [item.id])} className={`${control} shrink-0 rounded-full p-1.5 text-rose-300`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </li>)}
      </ul>
      {!visible.length && <p className="p-6 text-center text-sm text-text-muted">{notifications.length ? 'No notifications match your filters.' : 'No notifications yet.'}</p>}
    </div>
    </div>
    <p className="shrink-0 border-t border-sky-400/20 px-3 py-2 text-xs text-text-muted">Showing {visible.length} of {notifications.length} · Ctrl+click to select</p>
  </section>;
  return compact && typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
