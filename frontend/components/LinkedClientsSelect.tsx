import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { Client, ClientStatus, ContactClientSummary } from '../types';
import Avatar from './Avatar';
import SearchableMultiSelect, { SearchableMultiSelectOption } from './ui/SearchableMultiSelect';

type ClientOption = Pick<Client, 'id' | 'companyName' | 'status'> & Partial<Pick<Client, 'email' | 'phone'>>;
interface Props {
  initialClients: (Client | ContactClientSummary)[];
  value: string[];
  primaryClientId?: string | null;
  onChange: (ids: string[]) => void;
  onPrimaryChange: (id: string) => void;
}

const toOption = (client: ClientOption): SearchableMultiSelectOption => ({
  id: client.id, name: client.companyName, description: client.email || client.phone || 'No primary contact detail',
  active: client.status === ClientStatus.ACTIVE, statusLabel: client.status,
});

export default function LinkedClientsSelect({ initialClients, value, primaryClientId, onChange, onPrimaryChange }: Props) {
  const [knownClients, setKnownClients] = useState<Record<string, ClientOption>>(() => Object.fromEntries(initialClients.map(client => [client.id, client])));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Client[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    // Contact summaries preserve every link immediately; fetch only their missing details.
    for (const client of initialClients) {
      if ('email' in client) continue;
      void api.getClient(client.id).then(detail => {
        if (active) setKnownClients(current => ({ ...current, [detail.id]: detail }));
      }).catch(() => { /* Keep the authorized contact summary if detail loading fails. */ });
    }
    return () => { active = false; };
  }, [initialClients]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.getClients({ page, pageSize: 25, q: search.trim(), status: '', sortBy: 'company_name', sortOrder: 'asc' });
        if (!active) return;
        setItems(current => page === 1 ? response.items : Array.from(new Map([...current, ...response.items].map(client => [client.id, client])).values()));
        setKnownClients(current => ({ ...current, ...Object.fromEntries(response.items.map(client => [client.id, client])) }));
        setHasMore(response.page < response.totalPages);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load clients.');
      } finally {
        if (active) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, page, retry]);

  const selected = useMemo(() => value.map(id => knownClients[id]).filter((client): client is ClientOption => !!client), [value, knownClients]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(current => current !== id) : [...new Set([...value, id])]);

  return <>
    <SearchableMultiSelect id="linkedClients" label="Linked clients" avoidClipping className="rounded-2xl bg-slate-950/95 text-slate-50 dark:bg-transparent"
      options={items.map(toOption)} selectedOptions={selected.map(toOption)} value={value} onToggle={toggle}
      search={search} onSearchChange={next => { setSearch(next); setPage(1); setItems([]); setHasMore(false); setLoading(true); }}
      placeholder="Search and select clients..." searchPlaceholder="Search by company name, email, phone..."
      emptyMessage="No clients match your search." loadingMessage="Loading clients..."
      loading={loading} error={error} onRetry={() => setRetry(current => current + 1)}
      hasMore={hasMore} onLoadMore={() => { setLoading(true); setPage(current => current + 1); }}
      renderAvatar={(option, size) => <Avatar user={{ name: option.name, avatarUrl: null }} size={size} />} />
    {selected.length > 0 && <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected clients">
      {selected.map(client => <label key={client.id} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-gray-700">
        <span className="truncate">{client.companyName}</span>
        <input type="radio" name="primaryClient" checked={primaryClientId === client.id} onChange={() => onPrimaryChange(client.id)} />
        Primary
        <button type="button" aria-label={`Unlink ${client.companyName}`} onClick={() => toggle(client.id)} className="px-1 text-gray-500 hover:text-rose-500">×</button>
      </label>)}
    </div>}
  </>;
}
