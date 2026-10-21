import React, { useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { ArrowDown, ArrowUp, GripVertical, LayoutDashboard, Settings, ShieldCheck } from 'lucide-react';
import type { NavigationPage } from '../types/navigation';

export type EditorItem = NavigationPage & { label: string; defaultIndex: number };
type Props = { items: EditorItem[]; roles: string[]; canManageGlobal: boolean; disabled: boolean; onChange: (value: EditorItem[]) => void };

function EditorRow({ item, index, count, roles, canManageGlobal, disabled, canReorder, rename, move, patch }: {
  item: EditorItem; index: number; count: number; roles: string[]; canManageGlobal: boolean; disabled: boolean; canReorder: boolean;
  rename: (label: string) => void; move: (offset: number) => void; patch: (value: Partial<EditorItem>) => void;
}) {
  const controls = useDragControls();
  const locked = disabled || !canManageGlobal || item.isSystemProtected;
  const Icon = item.navigationLocation !== 'sidebar' ? Settings : LayoutDashboard;
  return <Reorder.Item value={item.id} dragListener={false} dragControls={controls}
    className="rounded-xl border border-border-color bg-surface p-3 sm:p-4" data-page-id={item.id}>
    <div className="flex items-center gap-2">
      <span onPointerDown={event => { if (!disabled && canReorder) { event.preventDefault(); controls.start(event); } }}
        className="touch-none cursor-grab p-2 text-text-secondary active:cursor-grabbing" title={`Drag ${item.defaultLabel}`} aria-hidden="true"><GripVertical className="h-5 w-5" /></span>
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1"><h3 className="font-semibold">{item.defaultLabel}</h3><p className="break-all text-xs text-text-secondary">{item.id} Â· {item.route}</p></div>
      <div className="flex shrink-0 flex-col">
        <button type="button" aria-label={`Move ${item.defaultLabel} up`} disabled={disabled || !canReorder || index === 0} onClick={() => move(-1)} className="rounded p-1 hover:bg-primary/10 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label={`Move ${item.defaultLabel} down`} disabled={disabled || !canReorder || index === count - 1} onClick={() => move(1)} className="rounded p-1 hover:bg-primary/10 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
      </div>
    </div>
    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm text-text-secondary">Display name (this browser)
        <input aria-label={`Name for ${item.defaultLabel}`} value={item.label} maxLength={48} disabled={disabled} onChange={event => rename(event.target.value)} required
          className="mt-1 block w-full min-w-0 rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label={`Enable ${item.defaultLabel}`} checked={item.enabled} disabled={locked} onChange={event => patch({ enabled: event.target.checked })} />{item.enabled ? 'Enabled' : 'Disabled'}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Hide ${item.defaultLabel} navigation only`} checked={item.hidden} disabled={locked || !item.enabled} onChange={event => patch({ hidden: event.target.checked })} />Hide navigation only</label>
      </div>
    </div>
    {item.isSystemProtected && <p className="mt-2 flex items-center gap-1 text-xs text-text-secondary"><ShieldCheck className="h-4 w-4 shrink-0" />Protected recovery page: access cannot be disabled, hidden, or narrowed.</p>}
    {!item.enabled && <p className="mt-2 text-sm text-amber-500">Disabled workspace module: direct access is blocked; data is preserved.</p>}
    {item.enabled && item.hidden && <p className="mt-2 text-sm text-text-secondary">Hidden from navigation. Independently authorized direct access remains available.</p>}
    <details className="mt-3 rounded-lg border border-border-color p-3">
      <summary className="cursor-pointer text-sm font-medium">Visible roles for {item.defaultLabel}</summary>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{roles.map(role => {
        const permitted = item.permittedRoles.includes(role);
        return <label key={role} className="flex items-center gap-2 text-sm" title={!permitted ? 'Existing application permissions do not allow this role.' : undefined}>
          <input type="checkbox" aria-label={`${item.defaultLabel}: ${role}`} checked={item.allowedRoles.includes(role)} disabled={locked || !permitted}
            onChange={event => patch({ allowedRoles: event.target.checked ? [...item.allowedRoles, role] : item.allowedRoles.filter(value => value !== role) })} />{role.toUpperCase()}{!permitted && <span className="text-xs text-text-secondary">restricted</span>}
        </label>;
      })}</div>
      <p className="mt-2 text-xs text-text-secondary">These rules can narrow existing permissions. They cannot grant new application permissions.</p>
    </details>
  </Reorder.Item>;
}

/** The existing editor, refactored into an inline controlled Settings form. */
export default function SidebarEditor({ items, roles, canManageGlobal, disabled, onChange }: Props) {
  const [section, setSection] = useState<NavigationPage['navigationLocation']>('sidebar');
  const [search, setSearch] = useState('');
  const group = items.filter(item => item.navigationLocation === section);
  const filtered = group.filter(item => `${item.defaultLabel} ${item.label} ${item.id}`.toLowerCase().includes(search.toLowerCase()));
  const patch = (id: string, value: Partial<EditorItem>) => onChange(items.map(item => item.id === id ? { ...item, ...value } : item));
  const reorder = (ids: string[]) => {
    const updated = ids.map(id => group.find(item => item.id === id)!);
    let index = 0;
    onChange(items.map(item => item.navigationLocation === section ? updated[index++] : item));
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2" aria-label="Navigation groups">{(['sidebar', 'management-tab', 'settings-tab'] as const).map(key => <button key={key} type="button" aria-pressed={section === key} onClick={() => { setSection(key); setSearch(''); }} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${section === key ? 'border-primary bg-primary text-white' : 'border-border-color text-text-secondary'}`}>{key === 'sidebar' ? 'Main Sidebar Pages' : key === 'management-tab' ? 'Management Page Tabs' : 'Settings Page Tabs'}</button>)}</div>
    <label className="block text-sm text-text-secondary">Search pages<input type="search" value={search} onChange={event => setSearch(event.target.value)} className="mt-1 block w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" /></label>
    {search && <p className="text-xs text-text-secondary">Clear search to reorder pages. Display names and policies can still be edited.</p>}
    <Reorder.Group axis="y" values={group.map(item => item.id)} onReorder={ids => { if (!search && !disabled) reorder(ids); }} className="space-y-3" aria-label={section === 'sidebar' ? 'Sidebar pages' : section === 'management-tab' ? 'Management tab pages' : 'Settings tab pages'}>
      {filtered.map(item => <EditorRow key={item.id} item={item} index={group.indexOf(item)} count={group.length} roles={roles} disabled={disabled} canReorder={!search} canManageGlobal={canManageGlobal}
        rename={label => patch(item.id, { label })} patch={value => patch(item.id, value)} move={offset => {
          const ids = group.map(row => row.id), index = ids.indexOf(item.id), target = index + offset;
          if (target >= 0 && target < ids.length) { [ids[index], ids[target]] = [ids[target], ids[index]]; reorder(ids); }
        }} />)}
    </Reorder.Group>
    {!filtered.length && <p className="p-6 text-center text-text-secondary">No matching pages.</p>}
  </div>;
}
