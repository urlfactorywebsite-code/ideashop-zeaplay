import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Client, ClientStatus, ProjectClientSummary } from '../types';
import Avatar from './Avatar';
import SearchableMultiSelect from './ui/SearchableMultiSelect';

type ClientSummary = ProjectClientSummary & Partial<Pick<Client, 'email' | 'phone'>>;

export default function ClientSelect({ value, initialClient, onChange }: {
  value: string;
  initialClient?: ClientSummary | null;
  onChange: (id: string) => void;
}) {
  const [known, setKnown] = useState<Record<string, ClientSummary>>(() => initialClient ? { [initialClient.id]: initialClient } : {});
  const [items, setItems] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (initialClient) setKnown(current => ({ ...current, [initialClient.id]: initialClient }));
  }, [initialClient]);

  useEffect(() => {
    if (!value || known[value]) return;
    let active = true;
    void api.getClient(value).then(client => {
      if (active) setKnown(current => ({ ...current, [client.id]: client }));
    }).catch(() => { /* Preserve the selected ID if its details cannot be refreshed. */ });
    return () => { active = false; };
  }, [value, known]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.getClients({ page, pageSize: 25, q: search.trim(), status: ClientStatus.ACTIVE,
          sortBy: 'company_name', sortOrder: 'asc' });
        if (!active) return;
        const available = response.items.filter(client => client.status === ClientStatus.ACTIVE);
        setItems(current => page === 1 ? available : Array.from(new Map([...current, ...available].map(client => [client.id, client])).values()));
        setKnown(current => ({ ...current, ...Object.fromEntries(available.map(client => [client.id, client])) }));
        setHasMore(response.page < response.totalPages);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load clients.');
      } finally {
        if (active) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, page, retry]);

  const option = (client: ClientSummary) => ({ id: client.id, name: client.companyName,
    description: client.email || client.phone || 'No primary contact detail',
    active: client.status === ClientStatus.ACTIVE, statusLabel: client.status });

  return <SearchableMultiSelect id="projectClient" label="Client" selectionMode="single" avoidClipping
    className="rounded-2xl bg-slate-950/95 text-slate-50 dark:bg-transparent"
    options={items.map(option)} selectedOptions={value && known[value] ? [option(known[value])] : []}
    value={value ? [value] : []} onToggle={onChange} search={search}
    onSearchChange={next => { setSearch(next); setPage(1); setItems([]); setHasMore(false); setLoading(true); }}
    placeholder="Search and select a client..." searchPlaceholder="Search by company name, email, phone..."
    emptyMessage="No clients match your search." loadingMessage="Loading clients..."
    loading={loading} error={error} onRetry={() => setRetry(current => current + 1)}
    hasMore={hasMore} onLoadMore={() => { setLoading(true); setPage(current => current + 1); }}
    renderAvatar={(client, size) => <Avatar user={{ name: client.name, avatarUrl: null }} size={size} />} />;
}
