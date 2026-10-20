import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import PageLoader from '../components/loading/PageLoader';
import RestoreConfirmation from '../components/RestoreConfirmation';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  Client,
  ClientCreatePayload,
  ClientListFilters,
  ClientStatus,
  ClientUpdatePayload,
  Contact,
  ContactCreatePayload,
  ContactUpdatePayload,
  Role,
} from '../types';
import {
  ClientDraft,
  emptyClientDraft,
  normalizeClientPayload,
  validateClientDraft,
  ClientValidationErrors,
} from '../utils/clientValidation';
import {
  ContactDraft,
  emptyContactDraft,
  normalizeContactDraft,
  toContactPayload,
  validateContactDraft,
  ContactValidationErrors,
} from '../utils/contactValidation';

type ClientFormModalProps = {
  client: Client | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ClientCreatePayload | ClientUpdatePayload) => Promise<void>;
};

type ContactFormModalProps = {
  contact: Contact | null;
  clients: Client[];
  defaultClientId?: string | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ContactCreatePayload | ContactUpdatePayload) => Promise<void>;
};

const statusTone: Record<ClientStatus, string> = {
  [ClientStatus.ACTIVE]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  [ClientStatus.ARCHIVED]: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

const toDraft = (client: Client | null): ClientDraft => ({
  ...emptyClientDraft(),
  companyName: client?.companyName ?? '',
  gstNumber: client?.gstNumber ?? '',
  email: client?.email ?? '',
  phone: client?.phone ?? '',
  website: client?.website ?? '',
  addressLine1: client?.addressLine1 ?? '',
  addressLine2: client?.addressLine2 ?? '',
  city: client?.city ?? '',
  state: client?.state ?? '',
  postalCode: client?.postalCode ?? '',
  country: client?.country ?? '',
  notes: client?.notes ?? '',
});

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : 'Not archived');

const toContactDraft = (contact: Contact | null, defaultClientId?: string | null): ContactDraft => {
  const base = emptyContactDraft();
  const linkedClientIds = contact?.clients.map((client) => client.id) ?? (defaultClientId ? [defaultClientId] : []);
  const primaryClient = contact?.clients.find((client) => client.isPrimary)?.id ?? defaultClientId ?? null;
  return {
    ...base,
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    title: contact?.title ?? '',
    notes: contact?.notes ?? '',
    clientIds: linkedClientIds,
    primaryClientId: primaryClient,
  };
};

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-300">{message}</p> : null;

const ClientFormModal: React.FC<ClientFormModalProps> = ({ client, saving, error, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<ClientDraft>(() => toDraft(client));
  const [errors, setErrors] = useState<ClientValidationErrors>({});

  useEffect(() => {
    setDraft(toDraft(client));
    setErrors({});
  }, [client]);

  const update = (field: keyof ClientDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateClientDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    await onSubmit(normalizeClientPayload(draft));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {client ? 'Edit Client' : 'Create Client'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Tenant-scoped client record</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Company name</span>
            <input
              value={draft.companyName}
              onChange={(event) => update('companyName', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              autoFocus
            />
            <FieldError message={errors.companyName} />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">GST</span>
            <input
              value={draft.gstNumber ?? ''}
              onChange={(event) => update('gstNumber', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm uppercase dark:border-gray-700 dark:bg-gray-950"
            />
            <FieldError message={errors.gstNumber} />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Phone</span>
            <input
              value={draft.phone ?? ''}
              onChange={(event) => update('phone', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
            <FieldError message={errors.phone} />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Email</span>
            <input
              value={draft.email ?? ''}
              onChange={(event) => update('email', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              type="email"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Website</span>
            <input
              value={draft.website ?? ''}
              onChange={(event) => update('website', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Address line 1</span>
            <input
              value={draft.addressLine1 ?? ''}
              onChange={(event) => update('addressLine1', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
            <FieldError message={errors.addressLine1} />
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Address line 2</span>
            <input
              value={draft.addressLine2 ?? ''}
              onChange={(event) => update('addressLine2', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
            <FieldError message={errors.addressLine2} />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">City</span>
            <input value={draft.city ?? ''} onChange={(event) => update('city', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">State</span>
            <input value={draft.state ?? ''} onChange={(event) => update('state', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Postal code</span>
            <input value={draft.postalCode ?? ''} onChange={(event) => update('postalCode', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            <FieldError message={errors.postalCode} />
          </label>

          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Country</span>
            <input value={draft.country ?? ''} onChange={(event) => update('country', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            <FieldError message={errors.country} />
          </label>

          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Notes</span>
            <textarea
              value={draft.notes ?? ''}
              onChange={(event) => update('notes', event.target.value)}
              className="mt-1 min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
          </label>

          {error && <div className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving...' : client ? 'Save Changes' : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
};

const ContactFormModal: React.FC<ContactFormModalProps> = ({ contact, clients, defaultClientId, saving, error, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<ContactDraft>(() => toContactDraft(contact, defaultClientId));
  const [errors, setErrors] = useState<ContactValidationErrors>({});

  useEffect(() => {
    setDraft(toContactDraft(contact, defaultClientId));
    setErrors({});
  }, [contact, defaultClientId]);

  const update = (field: keyof ContactDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const toggleClient = (clientId: string) => {
    setDraft((prev) => {
      const hasClient = prev.clientIds.includes(clientId);
      const clientIds = hasClient ? prev.clientIds.filter((id) => id !== clientId) : [...prev.clientIds, clientId];
      return {
        ...prev,
        clientIds,
        primaryClientId: clientIds.includes(prev.primaryClientId ?? '') ? prev.primaryClientId : clientIds[0] ?? null,
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateContactDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    await onSubmit(toContactPayload(normalizeContactDraft(draft)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <form onSubmit={handleSubmit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{contact ? 'Edit Contact' : 'Create Contact'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Shared contact identity</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">First name</span>
            <input value={draft.firstName} onChange={(event) => update('firstName', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" autoFocus />
            <FieldError message={errors.firstName} />
          </label>
          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Last name</span>
            <input value={draft.lastName ?? ''} onChange={(event) => update('lastName', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>
          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Email</span>
            <input value={draft.email ?? ''} onChange={(event) => update('email', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" type="email" />
            <FieldError message={errors.email} />
          </label>
          <label>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Phone</span>
            <input value={draft.phone ?? ''} onChange={(event) => update('phone', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            <FieldError message={errors.phone} />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Title</span>
            <input value={draft.title ?? ''} onChange={(event) => update('title', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>
          <div className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Linked clients</span>
            <div className="mt-2 max-h-44 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {clients.map((client) => (
                <label key={client.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.clientIds.includes(client.id)} onChange={() => toggleClient(client.id)} />
                    {client.companyName}
                  </span>
                  {draft.clientIds.includes(client.id) && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <input type="radio" name="primaryClient" checked={draft.primaryClientId === client.id} onChange={() => setDraft((prev) => ({ ...prev, primaryClientId: client.id }))} />
                      Primary
                    </span>
                  )}
                </label>
              ))}
              {clients.length === 0 && <p className="text-sm text-gray-500">No active clients available.</p>}
            </div>
          </div>
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Notes</span>
            <textarea value={draft.notes ?? ''} onChange={(event) => update('notes', event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>
          {error && <div className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving...' : contact ? 'Save Contact' : 'Create Contact'}
          </button>
        </div>
      </form>
    </div>
  );
};

const Clients: React.FC = () => {
  const { user } = useAuth();
  const canManage = user?.role === Role.OWNER || user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const [filters, setFilters] = useState<ClientListFilters>({ page: 1, pageSize: 10, sortBy: 'company_name', sortOrder: 'asc', status: ClientStatus.ACTIVE });
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Client | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoring = useRef(false);
  const listGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formClient, setFormClient] = useState<Client | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientContacts, setClientContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [availableClients, setAvailableClients] = useState<Client[]>([]);
  const [contactFormContact, setContactFormContact] = useState<Contact | null>(null);
  const [isContactFormOpen, setContactFormOpen] = useState(false);
  const [contactFormError, setContactFormError] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getClients(filters);
      if (generation !== listGeneration.current) return;
      if ((filters.page ?? 1) > response.totalPages) {
        setFilters(prev => ({ ...prev, page: response.totalPages }));
        return;
      }
      setClients(response.items);
      setTotalPages(response.totalPages);
      setTotal(response.total);
      setSelectedClient((current) => {
        if (!current) return response.items[0] ?? null;
        return response.items.find((client) => client.id === current.id) ?? response.items[0] ?? null;
      });
    } catch (err) {
      if (generation !== listGeneration.current) return;
      setError(err instanceof Error ? err.message : 'Unable to load clients.');
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => () => { listGeneration.current++; }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (!selectedClient) {
      setClientContacts([]);
      return;
    }
    let cancelled = false;
    const loadContacts = async () => {
      setContactsLoading(true);
      try {
        const response = await api.getClientContacts(selectedClient.id);
        if (!cancelled) {
          setClientContacts(response.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load contacts.');
        }
      } finally {
        if (!cancelled) {
          setContactsLoading(false);
        }
      }
    };
    loadContacts();
    return () => {
      cancelled = true;
    };
  }, [selectedClient?.id]);

  const handleSearch = (value: string) => {
    setFilters((prev) => ({ ...prev, q: value, page: 1 }));
  };

  const openCreate = () => {
    setFormClient(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setFormClient(client);
    setFormError(null);
    setFormOpen(true);
  };

  const ensureAvailableClients = async () => {
    const response = await api.getClients({ page: 1, pageSize: 100, status: '', sortBy: 'company_name', sortOrder: 'asc' });
    setAvailableClients(response.items);
    return response.items;
  };

  const openCreateContact = async () => {
    setContactFormContact(null);
    setContactFormError(null);
    await ensureAvailableClients();
    setContactFormOpen(true);
  };

  const openEditContact = async (contact: Contact) => {
    setContactFormContact(contact);
    setContactFormError(null);
    await ensureAvailableClients();
    setContactFormOpen(true);
  };

  const handleSubmit = async (payload: ClientCreatePayload | ClientUpdatePayload) => {
    setActionLoading(true);
    setFormError(null);
    try {
      const saved = formClient
        ? await api.updateClient(formClient.id, payload)
        : await api.createClient(payload as ClientCreatePayload);
      setSuccess(formClient ? 'Client updated.' : 'Client created.');
      setFormOpen(false);
      setSelectedClient(saved);
      await fetchClients();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save client.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async (client: Client) => {
    if (!window.confirm(`Archive ${client.companyName}?`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const archived = await api.archiveClient(client.id);
      setSelectedClient(archived);
      setSuccess('Client archived.');
      await fetchClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive client.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget || restoring.current) return;
    restoring.current = true;
    setActionLoading(true); setRestoreError(null); setSuccess(null);
    try {
      const restored = await api.restoreClient(restoreTarget.id);
      setSelectedClient(restored);
      if (filters.status && filters.status !== restored.status) setTotal(count => Math.max(0, count - 1));
      setClients(rows => rows.flatMap(row => row.id !== restored.id ? [row]
        : !filters.status || filters.status === restored.status ? [restored] : []));
      setSuccess('Client restored.');
      setRestoreTarget(null);
      await fetchClients();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Unable to restore client.');
    } finally { restoring.current = false; setActionLoading(false); }
  };

  const handleContactSubmit = async (payload: ContactCreatePayload | ContactUpdatePayload) => {
    setActionLoading(true);
    setContactFormError(null);
    try {
      const saved = contactFormContact
        ? await api.updateContact(contactFormContact.id, payload)
        : await api.createContact(payload as ContactCreatePayload);
      setSuccess(contactFormContact ? 'Contact updated.' : 'Contact created.');
      setContactFormOpen(false);
      if (selectedClient) {
        const response = await api.getClientContacts(selectedClient.id);
        setClientContacts(response.items);
      }
      setContactFormContact(saved);
    } catch (err) {
      setContactFormError(err instanceof Error ? err.message : 'Unable to save contact.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchiveContact = async (contact: Contact) => {
    if (!window.confirm(`Archive ${contact.displayName}?`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await api.archiveContact(contact.id);
      setSuccess('Contact archived.');
      if (selectedClient) {
        const response = await api.getClientContacts(selectedClient.id);
        setClientContacts(response.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive contact.');
    } finally {
      setActionLoading(false);
    }
  };

  const activeCount = useMemo(() => clients.filter((client) => client.status === ClientStatus.ACTIVE).length, [clients]);

  if (loading && clients.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Clients</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{total} records, {activeCount} visible active clients</p>
          </div>
          {canManage && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <PlusIcon className="h-4 w-4" />
              New Client
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            <input
              value={filters.q ?? ''}
              onChange={(event) => handleSearch(event.target.value)}
              placeholder="Search clients"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm dark:border-gray-700 dark:bg-gray-950"
            />
          </div>
          <select
            aria-label="Client status" value={filters.status ?? ''}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as ClientStatus | '', page: 1 }))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          >
            <option value="">All statuses</option>
            <option value={ClientStatus.ACTIVE}>Active</option>
            <option value={ClientStatus.ARCHIVED}>Archived</option>
          </select>
          <select
            value={filters.sortBy}
            onChange={(event) => setFilters((prev) => ({ ...prev, sortBy: event.target.value as ClientListFilters['sortBy'], page: 1 }))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          >
            <option value="company_name">Company</option>
            <option value="updated_at">Updated</option>
            <option value="created_at">Created</option>
            <option value="country">Country</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      {(error || success) && (
        <div role={error ? "alert" : "status"} className={`mx-6 mt-4 shrink-0 rounded-lg px-4 py-3 text-sm ${error ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
          {error || success}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="h-full min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {clients.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
              <BuildingOffice2Icon className="h-10 w-10 text-gray-400" />
              <h2 className="mt-3 text-lg font-semibold">No clients found</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Adjust the filters or create the first client.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">GST</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
                    className={`cursor-pointer transition hover:bg-blue-50 dark:hover:bg-gray-800 ${selectedClient?.id === client.id ? 'bg-blue-50 dark:bg-gray-800' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{client.companyName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{client.gstNumber || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{client.phone || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{client.country || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone[client.status]}`}>{client.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="h-full min-h-0 overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          {selectedClient ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{selectedClient.companyName}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedClient.email || selectedClient.website || 'No primary contact detail'}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[selectedClient.status]}`}>{selectedClient.status}</span>
              </div>

              <dl className="grid gap-3 text-sm">
                <div><dt className="text-gray-500">GST</dt><dd>{selectedClient.gstNumber || '-'}</dd></div>
                <div><dt className="text-gray-500">Phone</dt><dd>{selectedClient.phone || '-'}</dd></div>
                <div><dt className="text-gray-500">Address</dt><dd>{[selectedClient.addressLine1, selectedClient.addressLine2, selectedClient.city, selectedClient.state, selectedClient.postalCode, selectedClient.country].filter(Boolean).join(', ') || '-'}</dd></div>
                <div><dt className="text-gray-500">Archived</dt><dd>{formatDate(selectedClient.archivedAt)}</dd></div>
                <div><dt className="text-gray-500">Notes</dt><dd className="whitespace-pre-wrap">{selectedClient.notes || '-'}</dd></div>
              </dl>

              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Contacts</h3>
                  {canManage && selectedClient.status === ClientStatus.ACTIVE && (
                    <button onClick={openCreateContact} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold dark:border-gray-700">
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add
                    </button>
                  )}
                </div>
                {contactsLoading ? (
                  <p className="mt-3 text-sm text-gray-500">Loading contacts...</p>
                ) : clientContacts.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">No contacts linked.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {clientContacts.map((contact) => (
                      <div key={contact.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{contact.displayName}</p>
                            <p className="text-gray-500">{contact.email || contact.phone || contact.title || 'No contact detail'}</p>
                          </div>
                          {contact.clients.some((linked) => linked.id === selectedClient.id && linked.isPrimary) && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">Primary</span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Companies: {contact.clients.map((linked) => linked.companyName).join(', ') || '-'}
                        </p>
                        {canManage && selectedClient.status === ClientStatus.ACTIVE && (
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => openEditContact(contact)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold dark:border-gray-700">Edit</button>
                            <button onClick={() => handleArchiveContact(contact)} className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:text-amber-300">Archive</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {selectedClient.status === ClientStatus.ACTIVE && <button onClick={() => openEdit(selectedClient)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-700">
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit
                  </button>}
                  {selectedClient.status !== ClientStatus.ARCHIVED && (
                    <button disabled={actionLoading} onClick={() => handleArchive(selectedClient)} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-700 dark:text-amber-300">
                      <ArchiveBoxIcon className="h-4 w-4" />
                      Archive
                    </button>
                  )}
                  {selectedClient.status === ClientStatus.ARCHIVED && (
                    <button disabled={actionLoading} onClick={() => { setRestoreError(null); setRestoreTarget(selectedClient); }} className="inline-flex items-center gap-2 rounded-lg border border-teal-500 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950">
                      <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />Restore Client
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center text-sm text-gray-500">Select a client</div>
          )}
        </aside>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col gap-3 border-t border-gray-200 bg-white px-6 py-3 text-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <span>Page {filters.page ?? 1} of {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={(filters.page ?? 1) <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max((prev.page ?? 1) - 1, 1) }))} className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700">Previous</button>
          <button disabled={(filters.page ?? 1) >= totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))} className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700">Next</button>
        </div>
      </div>

      {restoreTarget && canManage && <RestoreConfirmation kind="Client" name={restoreTarget.companyName} busy={actionLoading}
        error={restoreError} onClose={() => setRestoreTarget(null)} onConfirm={() => void handleRestore()} />}
      {isFormOpen && (
        <ClientFormModal
          client={formClient}
          saving={actionLoading}
          error={formError}
          onClose={() => setFormOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
      {isContactFormOpen && (
        <ContactFormModal
          contact={contactFormContact}
          clients={availableClients}
          defaultClientId={selectedClient?.id ?? null}
          saving={actionLoading}
          error={contactFormError}
          onClose={() => setContactFormOpen(false)}
          onSubmit={handleContactSubmit}
        />
      )}
    </div>
  );
};

export default Clients;
