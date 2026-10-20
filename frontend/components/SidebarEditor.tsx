import React, { useState } from 'react';
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Reorder, useDragControls } from 'framer-motion';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import type { SidebarPreferences } from '../utils/sidebarPreferences';

type Item = { id: string; label: string; originalLabel: string; defaultIndex: number };
type Props = { items: Item[]; onClose: () => void; onSave: (value: SidebarPreferences) => void };

function EditorRow({ item, index, count, rename, move }: {
  item: Item; index: number; count: number; rename: (label: string) => void; move: (offset: number) => void;
}) {
  const controls = useDragControls();
  return <Reorder.Item value={item.id} dragListener={false} dragControls={controls}
    className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
    <span onPointerDown={event => { event.preventDefault(); controls.start(event); }}
      className="touch-none cursor-grab p-2 text-gray-500 active:cursor-grabbing" title={`Drag ${item.originalLabel}`} aria-hidden="true">
      <GripVertical className="h-5 w-5" />
    </span>
    <label className="min-w-0 flex-1 text-xs text-gray-500 dark:text-gray-400">
      {item.originalLabel}
      <input aria-label={`Name for ${item.originalLabel}`} value={item.label} maxLength={48}
        onChange={event => rename(event.target.value)} required
        className="mt-1 block w-full rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:text-white" />
    </label>
    <div className="flex flex-col">
      <button type="button" aria-label={`Move ${item.originalLabel} up`} disabled={index === 0} onClick={() => move(-1)} className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"><ArrowUp className="h-4 w-4" /></button>
      <button type="button" aria-label={`Move ${item.originalLabel} down`} disabled={index === count - 1} onClick={() => move(1)} className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"><ArrowDown className="h-4 w-4" /></button>
    </div>
  </Reorder.Item>;
}

export default function SidebarEditor({ items, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(items);
  const [error, setError] = useState('');
  const move = (id: string, offset: number) => setDraft(current => {
    const next = [...current], index = next.findIndex(item => item.id === id), target = index + offset;
    if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  return <Dialog open onClose={onClose} className="relative z-[100]">
    <DialogBackdrop className="fixed inset-0 bg-black/60" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white p-5 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="text-lg font-semibold">Edit sidebar</DialogTitle>
          <button type="button" onClick={onClose} aria-label="Close sidebar editor" className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <Description className="mb-4 text-sm text-gray-500 dark:text-gray-400">Rename pages and drag the handles to reorder them, or use the arrows. Saved for your owner account in this browser.</Description>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
          event.preventDefault();
          if (draft.some(item => !item.label.trim())) { setError('Each page needs a name.'); return; }
          try {
            onSave({ order: draft.map(item => item.id), labels: Object.fromEntries(draft.map(item => [item.id, item.label.trim()])) });
          } catch { setError('Unable to save sidebar changes. Check that browser storage is available and try again.'); }
        }}>
            <Reorder.Group axis="y" values={draft.map(item => item.id)} onReorder={ids => setDraft(current => ids.map(id => current.find(item => item.id === id)!))} className="min-h-0 space-y-2 overflow-y-auto pr-1" aria-label="Sidebar pages" layoutScroll>
              {draft.map((item, index) => <EditorRow key={item.id} item={item} index={index} count={draft.length}
                rename={label => setDraft(current => current.map(row => row.id === item.id ? { ...row, label } : row))}
                move={offset => move(item.id, offset)} />)}
            </Reorder.Group>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={() => { setDraft(items.map(item => ({ ...item, label: item.originalLabel })).sort((a, b) => a.defaultIndex - b.defaultIndex)); setError(''); }} className="mr-auto rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Reset defaults</button>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Save</button>
          </div>
        </form>
      </DialogPanel>
    </div>
  </Dialog>;
}
