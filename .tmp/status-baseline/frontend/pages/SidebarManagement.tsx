import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useBlocker } from 'react-router-dom';
import { useNavigation, NAVIGATION_UPDATED } from '../hooks/useNavigation';
import { http } from '../services/mockApi';
import SidebarEditor, { type EditorItem } from '../components/SidebarEditor';
import type { NavigationDocument, NavigationUpdate } from '../types/navigation';

export default function SidebarManagement() {
  const navigation = useNavigation();
  const config = navigation.configuration!;
  const makeDraft = () => config.pages.map((page, index) => ({ ...page, defaultIndex: index, label: navigation.preferences.labels[page.id] || page.defaultLabel }))
    .sort((a, b) => {
      const rank = (id: string, fallback: number) => { const index = navigation.preferences.order.indexOf(id); return index >= 0 ? index : navigation.preferences.order.length + fallback; };
      return rank(a.id, a.sortOrder) - rank(b.id, b.sortOrder);
    });
  const [draft, setDraft] = useState<EditorItem[]>(makeDraft);
  const [revision, setRevision] = useState(config.revision);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const blocker = useBlocker(() => dirtyRef.current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'save' | 'discard' | 'leave' | null>(null);
  useEffect(() => {
    if (blocker.state === 'blocked') setConfirm('leave');
  }, [blocker.state]);
  const cancelConfirmation = () => { if (blocker.state === 'blocked') blocker.reset(); setConfirm(null); };
  const leaveWithoutSaving = () => { dirtyRef.current = false; setConfirm(null); if (blocker.state === 'blocked') blocker.proceed(); };
  useEffect(() => {
    if (!dirty) { setDraft(makeDraft()); setRevision(config.revision); }
  }, [config, navigation.preferences]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const policy = (items: typeof config.pages) => items.map(({ id, enabled, hidden, allowedRoles, sortOrder }) => ({ id, enabled, hidden, allowedRoles, sortOrder }));
  const policyChanged = JSON.stringify(policy([...draft].sort((a, b) => a.id.localeCompare(b.id)))) !== JSON.stringify(policy([...config.pages].sort((a, b) => a.id.localeCompare(b.id))));
  const discard = () => { setDraft(makeDraft()); setRevision(config.revision); dirtyRef.current = false; setDirty(false); setError(''); setMessage('Changes discarded. Latest workspace configuration loaded.'); setConfirm(null); };
  const save = async () => {
    setConfirm(null); setSaving(true); setError(''); setMessage('');
    if (draft.some(item => !item.label.trim() || item.label.trim().length > 48)) { setError('Each page needs a name of 1–48 characters.'); setSaving(false); return; }
    let globalSaved = false;
    try {
      if (policyChanged) {
        const { data } = await http.put<NavigationDocument>('/navigation', { revision, pages: policy(draft) } satisfies NavigationUpdate);
        globalSaved = true; setRevision(data.revision); navigation.accept(data);
        window.dispatchEvent(new Event(NAVIGATION_UPDATED));
      }
      navigation.savePersonal({ order: [...draft.map(item => item.id), ...navigation.preferences.order.filter(id => !draft.some(item => item.id === id))],
        labels: { ...navigation.preferences.labels, ...Object.fromEntries(draft.map(item => [item.id, item.label.trim()])) } });
      dirtyRef.current = false; setDirty(false); setMessage(policyChanged ? 'Workspace access rules and personal layout saved.' : 'Personal layout saved for this account in this browser.');
    } catch (failure: any) {
      setError(globalSaved ? 'Workspace rules were saved, but personal browser storage failed. Retry saving your personal layout.' : failure.response?.status === 409 ? 'Another owner saved a newer configuration. Discard changes to load it before editing again.' : typeof failure.response?.data?.detail === 'string' ? failure.response.data.detail : failure.message || 'Unable to save changes.');
    } finally { setSaving(false); }
  };
  if (!config.canManagePersonal) return <p role="alert">You are not authorized to manage navigation.</p>;
  return <section className="min-w-0 space-y-5 rounded-2xl border border-border-color bg-surface p-4 sm:p-6">
    <header><h2 className="text-xl font-bold">Sidebar Management</h2><p className="mt-2 text-text-secondary">Customize navigation, control page visibility, and manage role-based access.</p></header>
    <div className="rounded-xl border border-border-color bg-background p-4 text-sm text-text-secondary">
      <p>Display names and drag/arrow ordering apply to your account in this browser. Enabled, hidden, and role rules apply to the whole workspace.</p>
      <p className="mt-2">{config.canManageGlobal ? 'Only owners can change workspace access policies.' : 'Admin layout access: workspace access policies are read-only. Ask an owner to change them.'}</p>
      <p className="mt-2">Active sessions revalidate on navigation, focus, and every 15 seconds while visible.</p>
    </div>
    {dirty && <p role="status" className="text-sm text-amber-500">Unsaved changes</p>}
    {dirty && revision !== config.revision && <p role="alert" className="text-sm text-amber-500">A newer workspace configuration is available. Discard changes to load it; saving this version will be rejected.</p>}
    {error && <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-primary p-3 text-sm">{message}</p>}
    <SidebarEditor items={draft} roles={config.roles} canManageGlobal={config.canManageGlobal} disabled={saving} onChange={value => { setDraft(value); dirtyRef.current = true; setDirty(true); setMessage(''); }} />
    <div className="sticky bottom-0 flex flex-wrap gap-3 rounded-xl border border-border-color bg-surface p-3 shadow-lg">
      <button type="button" disabled={saving} onClick={() => {
        setDraft(config.pages.map((page, index) => ({ ...page, label: page.defaultLabel, defaultIndex: index,
          ...(config.canManageGlobal ? { enabled: true, hidden: false, allowedRoles: page.permittedRoles, sortOrder: index } : {}) })));
        dirtyRef.current = true; setDirty(true); setMessage('Defaults staged. Save Changes to apply them.');
      }} className="rounded-lg border border-border-color px-4 py-2">Reset Defaults</button>
      <button type="button" disabled={!dirty || saving} onClick={() => setConfirm('discard')} className="rounded-lg border border-border-color px-4 py-2 disabled:opacity-40">Discard Changes</button>
      <button type="button" disabled={!dirty || saving} onClick={() => { if (policyChanged) setConfirm('save'); else void save(); }} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
    <p className="text-xs text-text-secondary">Workspace revision {revision}{config.updatedAt ? ` · Updated ${new Date(config.updatedAt).toLocaleString()}` : ' · Default configuration'}{config.updatedBy ? ` · By ${config.updatedBy}` : ''}</p>
    <Dialog open={confirm !== null} onClose={cancelConfirmation} className="relative z-[100]">
      <DialogBackdrop className="fixed inset-0 bg-black/60" /><div className="fixed inset-0 flex items-center justify-center p-4"><DialogPanel className="w-full max-w-md rounded-2xl border border-border-color bg-surface p-6 text-text-primary">
        <DialogTitle className="text-lg font-bold">{confirm === 'save' ? 'Apply workspace access changes?' : confirm === 'leave' ? 'Leave without saving?' : 'Discard unsaved changes?'}</DialogTitle>
        <p className="mt-3 text-sm text-text-secondary">{confirm === 'save' ? 'Disabled modules and removed roles will lose direct access across this workspace. Hidden-only pages remain independently accessible. Existing data is preserved.' : confirm === 'leave' ? 'Your unsaved navigation changes will be discarded if you leave this page.' : 'Your draft will be replaced with the latest saved workspace rules and personal layout.'}</p>
        <div className="mt-5 flex justify-end gap-3"><button onClick={cancelConfirmation} className="rounded-lg border border-border-color px-4 py-2">Cancel</button><button onClick={() => confirm === 'save' ? void save() : confirm === 'leave' ? leaveWithoutSaving() : discard()} className="rounded-lg bg-primary px-4 py-2 text-white">{confirm === 'save' ? 'Apply changes' : confirm === 'leave' ? 'Leave without saving' : 'Discard changes'}</button></div>
      </DialogPanel></div>
    </Dialog>
  </section>;
}
