import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, DialogDescription } from '@headlessui/react';
import { GripVertical, LockKeyhole, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { http } from '../services/mockApi';
import Tooltip from './ui/Tooltip';
import KanbanPreview from './KanbanPreview';
import { useAuth } from '../hooks/useAuth';
import { announceConfiguration, configurationStorageKey, STATUS_CONFIGURATION_EVENT, defaultArrangement, moveStatus, type StatusConfiguration as Status } from '../utils/kanbanConfiguration';

export const SYSTEM_STATUS_TOOLTIP = 'This is a core ZeaPlay system status. Its internal identity and workflow behavior are protected because they control task creation, progress, overdue calculations, penalty points, and completion rewards. You can customize its Kanban display label and position separately.';
type Document = { revision: number; can_manage: boolean; statuses: Status[]; hold_reason_required?: boolean };
const icons = ['default', 'circle', 'flag', 'play', 'pause', 'check', 'star', 'bolt', 'clock'];
const input = 'w-full rounded-lg border border-border-color bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
const button = 'rounded-lg border border-border-color px-3 py-2 text-sm transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40';
const errorText = (error: any) => typeof error.response?.data?.detail === 'string'
  ? error.response.data.detail : error.response?.status === 422 ? 'Review names, labels, colors and icons. Names and labels must be unique and contain 1–80 visible characters.' : error.message || 'Unable to save status configuration.';

export default function StatusManagement({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Document | null>(null);
  const [draft, setDraft] = useState<Status[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [holdReasonRequired, setHoldReasonRequired] = useState(false);
  const [removal, setRemoval] = useState<{ row: Status; action: 'archive' | 'delete' } | null>(null);
  const [destination, setDestination] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const dragId = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const dirty = !!saved && (JSON.stringify(draft) !== JSON.stringify(saved.statuses) || holdReasonRequired !== !!saved.hold_reason_required);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const accept = (document: Document) => {
    setStale(false);
    setHoldReasonRequired(!!document.hold_reason_required);
    const statuses = document.statuses.map(row => row.is_system ? { ...row, kanban_visible: true } : row);
    setSaved({ ...document, statuses }); setDraft(statuses);
  };
  const load = async () => {
    setBusy(true); setError('');
    try { accept((await http.get<Document>('/task-statuses')).data); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!saved || busy) return;
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const incoming = (await http.get<Document>('/task-statuses')).data;
        if (stopped) return;
        if (incoming.revision !== saved.revision && (dirty || removal)) setStale(true);
        else if (!dirty && !removal) {
          accept(incoming);
          if (incoming.revision !== saved.revision) setMessage('Latest workspace status configuration loaded.');
        }
      } catch { /* Explicit reads/saves still surface errors; drafts stay intact. */ }
      finally { refreshing = false; }
    };
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.tenantId === user?.tenantId) void refresh(); };
    const stored = (event: StorageEvent) => { if (user?.tenantId && event.key === configurationStorageKey(user.tenantId)) void refresh(); };
    const focused = () => void refresh();
    const timer = window.setInterval(focused, 30_000);
    window.addEventListener(STATUS_CONFIGURATION_EVENT, changed);
    window.addEventListener('storage', stored);
    window.addEventListener('focus', focused);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener(STATUS_CONFIGURATION_EVENT, changed); window.removeEventListener('storage', stored); window.removeEventListener('focus', focused); };
  }, [saved?.revision, busy, dirty, removal, user?.tenantId]);
  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    if (user?.tenantId) announceConfiguration(user.tenantId);
  };
  const update = (id: string, patch: Partial<Status>) => {
    setDraft(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row)); setMessage('');
  };
  const move = (id: string, target: number) => {
    const source = draft.findIndex(row => row.id === id);
    const next = moveStatus(draft, source, target);
    if (next === draft) return;
    setDraft(next);
    setMessage(`Moved ${draft[source].display_label || "new status"} to column ${target + 1}.`);
  };
  const save = async () => {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const statuses = draft.map(({ id, isNew, system_name, display_label, description, color, icon, is_active, kanban_visible, workflow_behavior }) =>
        ({ id: isNew ? null : id, system_name, display_label, description, color, icon, is_active, kanban_visible, workflow_behavior }));
      accept((await http.put<Document>('/task-statuses', { revision: saved.revision, statuses, hold_reason_required:holdReasonRequired })).data);
      refreshBoard(); setMessage('Status configuration saved for this workspace.');
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!saved || !removal) return;
    setBusy(true); setError('');
    try {
      const { row, action } = removal;
      accept((await http.post<Document>(`/task-statuses/${row.id}/remove`, {
        revision: saved.revision, action, destination_id: destination || null,
        confirmation, expected_task_count: row.task_count,
      })).data);
      setRemoval(null); refreshBoard(); setMessage(action === 'archive' ? 'Custom status archived.' : 'Custom status deleted. Audit history retained.');
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const canEdit = !!saved?.can_manage && !busy;
  const destinations = saved?.statuses.filter(row => row.is_active && row.id !== removal?.row.id
    && row.workflow_behavior !== 'HOLD' && (!row.is_system || row.legacy_status === 'IN_PROGRESS')) || [];
  return <section aria-busy={busy} aria-labelledby="status-management-heading" className="space-y-4 border-t border-border-color pt-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 id="status-management-heading" className="text-xl font-bold">Status Management</h3>
        <p className="mt-1 text-sm text-text-secondary">Workspace task statuses, Kanban labels and column order.</p></div>
      {saved?.can_manage && <button className={button} disabled={!canEdit || draft.length >= 100} onClick={() => setDraft(previous => [...previous, {
        id: crypto.randomUUID(), code: '', system_name: '', display_label: '', description: '', color: '#6366f1', icon: 'circle',
        is_system: false, is_active: true, kanban_visible: true, sort_order: previous.length, task_count: 0, legacy_status: null, isNew: true,
      }])}><Plus className="mr-1 inline h-4 w-4" />Add Custom Status</button>}
    </header>
    <p className="text-sm text-text-secondary">Custom statuses default to Active behavior. Pending and Hold use the protected core rules; completion rewards continue through Conquered. Reassign tasks before changing an assigned status's behavior.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={holdReasonRequired} disabled={!canEdit}
      onChange={event => setHoldReasonRequired(event.target.checked)} />Require a reason when placing a task On Hold</label>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {message && <p role="status" className="text-sm text-primary">{message}</p>}
    {stale && <p role="alert" className="text-sm text-amber-500">Status configuration changed in another session. Your draft is preserved. Reset unsaved changes to load the latest version; a stale save will be rejected.</p>}
    {!saved && <button className={button} disabled={busy} onClick={() => void load()}>{busy ? 'Loading statuses…' : 'Retry loading statuses'}</button>}
    {saved && <>
      {dirty && <p role="status" className="text-sm text-amber-500">Unsaved status changes</p>}
      <section aria-labelledby="kanban-customization-heading" className="space-y-5 rounded-2xl border border-cyan-400/20 bg-slate-950/5 p-3 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h4 id="kanban-customization-heading" className="text-lg font-bold">Kanban Board Customization</h4>
            <p className="mt-1 text-sm text-text-secondary">Arrange your guild's columns, labels, colors and icons. Protected system columns always remain visible.</p></div>
          {saved.can_manage && <button type="button" className={button} disabled={!canEdit} onClick={() => {
            setDraft(defaultArrangement(draft)); setError(''); setMessage('Default Kanban arrangement staged. Save Status Changes to apply it.');
          }}>Reset to default arrangement</button>}
        </header>
      <div role="region" aria-label="Task status configuration table" tabIndex={0} className="overflow-x-auto rounded-xl border border-border-color focus-visible:ring-2 focus-visible:ring-primary">
        <table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-background"><tr>
          {['Order', 'Status name', 'Kanban display label', 'Description / Behavior', 'Color / Icon', 'Tasks', 'Visibility', 'Actions'].map(title => <th key={title} scope="col" className="p-3">{title}</th>)}
        </tr></thead><tbody>
          {draft.map((row, index) => <tr key={row.id} data-status-code={row.code || 'custom-draft'} className="border-t border-border-color align-top"
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (canEdit && dragId.current) move(dragId.current, index); dragId.current = null; }}>
            <td className="p-3"><button draggable={canEdit} disabled={!canEdit} aria-label={`Drag ${row.display_label || 'new status'}`} onDragStart={event => { dragId.current = row.id; event.dataTransfer.setData('text/plain', row.id); }} onDragEnd={() => { dragId.current = null; }} className={button}><GripVertical className="h-4 w-4" /></button>
              <div className="mt-1 flex gap-1"><button className={button} disabled={!canEdit || index === 0} aria-label={`Move ${row.display_label} left`} title="Move Left" onClick={() => move(row.id, index - 1)}>&larr;</button><button className={button} disabled={!canEdit || index === draft.length - 1} aria-label={`Move ${row.display_label} right`} title="Move Right" onClick={() => move(row.id, index + 1)}>&rarr;</button></div></td>
            <td className="min-w-[160px] p-3"><input aria-label={`Status name ${index + 1}`} className={input} maxLength={80} disabled={!canEdit || row.is_system} value={row.system_name} onChange={event => update(row.id, { system_name: event.target.value })} />
              {row.is_system && <span onKeyDown={event => { if (event.key === "Escape") (event.target as HTMLElement).blur(); }}><Tooltip dismissOnEscape text={SYSTEM_STATUS_TOOLTIP} className="w-80 max-w-[calc(100vw-2rem)] max-sm:!left-1/2 [&>span.relative]:whitespace-normal"><span className="mt-2 inline-flex items-center gap-1 text-xs"><LockKeyhole className="h-3 w-3" />System Status</span></Tooltip></span>}
              <p className="mt-1 break-all text-xs text-text-secondary">{row.code || 'Code assigned when saved'}</p></td>
            <td className="min-w-[170px] p-3"><input aria-label={`Display label ${index + 1}`} className={input} maxLength={80} disabled={!canEdit} value={row.display_label} onChange={event => update(row.id, { display_label: event.target.value })} /></td>
            <td className="min-w-[180px] p-3"><textarea aria-label={`Description ${index + 1}`} className={input} rows={2} maxLength={500} disabled={!canEdit} value={row.description} onChange={event => update(row.id, { description: event.target.value })} />
              <label className="mt-2 block text-xs">Workflow behavior<select aria-label={`Workflow behavior ${index+1}`} className={input}
                disabled={!canEdit || row.is_system || row.task_count>0} value={row.workflow_behavior || 'ACTIVE'}
                onChange={event => update(row.id, {workflow_behavior:event.target.value as Status['workflow_behavior']})}>
                <option value="PENDING">Pending</option><option value="ACTIVE">Active</option><option value="HOLD">Hold</option>
                <option value="COMPLETED" disabled>Completed (protected core only)</option>
              </select></label></td>
            <td className="p-3"><input type="color" aria-label={`Color ${index + 1}`} disabled={!canEdit} value={row.color} onChange={event => update(row.id, { color: event.target.value })} /><select aria-label={`Icon ${index + 1}`} className={input} disabled={!canEdit} value={row.icon} onChange={event => update(row.id, { icon: event.target.value })}>{icons.map(icon => <option key={icon}>{icon}</option>)}</select></td>
            <td className="p-3 tabular-nums">{row.task_count}</td>
            <td className="p-3"><label className="flex gap-2"><input type="checkbox" aria-label={`Show ${row.display_label || "new status"} on Kanban`} checked={row.is_system || row.kanban_visible} disabled={!canEdit || row.is_system} onChange={event => update(row.id, { kanban_visible: event.target.checked })} />{row.is_system ? "Always on Kanban" : "Kanban"}</label><p className="mt-2 text-xs">{row.is_active ? 'Active' : 'Archived'}</p>
              {!row.is_system && !row.is_active && <button className={button} disabled={!canEdit} onClick={() => update(row.id, { is_active: true })}>Restore</button>}</td>
            <td className="space-y-2 p-3">{!row.is_system && saved.can_manage && (row.isNew
              ? <button className={button} disabled={!canEdit} onClick={() => setDraft(previous => previous.filter(item => item.id !== row.id))}>Remove draft</button>
              : <>{(['archive', 'delete'] as const).filter(action => action !== 'archive' || row.is_active).map(action => <button key={action} className={button} disabled={!canEdit || dirty} title={dirty ? 'Save or cancel unsaved changes first' : undefined} onClick={() => { setRemoval({ row, action }); setDestination(''); setConfirmation(''); setError(''); }}>{action === 'archive' ? 'Archive' : 'Delete'}</button>)}</>)}</td>
          </tr>)}
        </tbody></table>
      </div>
      <p className="text-xs text-text-secondary">Hiding a custom status retains its quests. They remain available in All Tasks and the board's hidden-status task list.</p>
      <KanbanPreview statuses={draft} disabled={!canEdit} onMove={move} />
      {saved.can_manage && <div className="flex flex-wrap gap-3">
        <button className={button} disabled={busy || !dirty} onClick={() => { setDraft(saved.statuses); setHoldReasonRequired(!!saved.hold_reason_required); setError(''); setMessage('Unsaved status changes cancelled.'); }}>Cancel</button>
        <button className={button} disabled={busy} onClick={() => { void load(); setMessage(''); }}>Reset unsaved changes</button>
        <button className={`${button} bg-primary text-white`} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Status Changes'}</button>
        <span className="self-center text-xs text-text-secondary">Workspace status revision {saved.revision}</span>
      </div>}
      </section>
    </>}
    <Dialog open={removal !== null} onClose={() => { if (!busy) setRemoval(null); }} className="relative z-[110]">
      <DialogBackdrop className="fixed inset-0 bg-black/60" /><div className="fixed inset-0 flex items-center justify-center p-4"><DialogPanel className="w-full max-w-lg space-y-4 rounded-2xl border border-border-color bg-surface p-6 text-text-primary">
        <DialogTitle className="text-lg font-bold">{removal?.action === 'archive' ? 'Archive' : 'Delete'} custom status “{removal?.row.display_label}”?</DialogTitle>
        <DialogDescription>{removal?.row.task_count || 0} tasks reference this status. Reassignment and removal are saved together and recorded in the audit log. Task IDs, history and points are preserved.</DialogDescription>
        {!!removal?.row.task_count && <label className="block">Reassign all tasks to<select aria-label="Reassignment destination" className={input} value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose a destination</option>{destinations.map(row => <option key={row.id} value={row.id}>{row.display_label}</option>)}</select></label>}
        <label className="block">Type “{removal?.row.display_label}” to confirm<input aria-label="Confirm status removal" className={input} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-3"><button className={button} disabled={busy} onClick={() => setRemoval(null)}>Cancel</button><button className={`${button} bg-primary text-white`} disabled={busy || confirmation !== removal?.row.display_label || (!!removal?.row.task_count && !destination)} onClick={() => void remove()}>Confirm {removal?.action}</button></div>
      </DialogPanel></div>
    </Dialog>
  </section>;
}
