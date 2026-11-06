import React, { useRef, useState } from 'react';
import { GripVertical, LockKeyhole, Monitor, Smartphone } from 'lucide-react';
import KanbanColumnFrame, { EmptyQuestColumn } from './KanbanColumnFrame';
import { onBoard, isCoreStatus, sampleQuests, type StatusConfiguration } from '../utils/kanbanConfiguration';
import { questCardSurface } from '../utils/kanbanAppearance';

export default function KanbanPreview({ statuses, disabled, onMove }: {
  statuses: StatusConfiguration[]; disabled: boolean; onMove: (id: string, target: number) => void;
}) {
  const [compact, setCompact] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const columns = statuses.filter(onBoard);
  return <section aria-labelledby="kanban-preview-heading" className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-4 text-slate-100 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 id="kanban-preview-heading" className="text-lg font-bold">Live Battle Board preview</h4>
        <p className="mt-1 text-xs text-slate-300">Synthetic example quests and counts. Draft changes appear immediately; no task data is loaded.</p></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preview width">
        {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={compact === value} onClick={() => setCompact(value)}
          className="flex items-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-2 text-sm transition hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 aria-pressed:bg-cyan-400/20">
          {value ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : <Monitor className="h-4 w-4" aria-hidden="true" />}{value ? 'Compact preview' : 'Desktop preview'}</button>)}
      </div>
    </header>
    <div role="region" aria-label={compact ? 'Compact Kanban preview' : 'Desktop Kanban preview'} tabIndex={0}
      className={`max-w-full overflow-x-auto rounded-3xl border border-cyan-400/15 bg-slate-950/50 p-4 shadow-[0_20px_52px_rgba(2,6,23,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${compact ? 'w-[375px]' : 'w-full'}`}>
      <div className="flex items-start gap-6" data-preview-columns>
        {columns.map((status, index) => {
          const examples = sampleQuests(index);
          const originalIndex = statuses.findIndex(row => row.id === status.id);
          return <KanbanColumnFrame key={status.id} data-preview-status={status.id} data-preview-code={status.code}
            statusKey={status.legacy_status || status.id} label={status.display_label} color={status.color} icon={status.icon}
            count={examples.length} compact={compact} className={dragging === status.id ? 'scale-[0.98] opacity-50 ring-2 ring-cyan-300' : ''}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled && dragId.current) onMove(dragId.current, originalIndex); dragId.current = null; setDragging(null); }}
            controls={<div className="flex items-center justify-between text-xs text-slate-300">
              <button type="button" draggable={!disabled} disabled={disabled} aria-label={`Drag preview column ${status.display_label || 'new status'}`}
                className="cursor-grab rounded-lg p-1 transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-300 active:cursor-grabbing"
                onDragStart={event => { dragId.current = status.id; setDragging(status.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', status.id); }}
                onDragEnd={() => { dragId.current = null; setDragging(null); }}><GripVertical className="h-4 w-4" aria-hidden="true" /></button>
              {isCoreStatus(status) && <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" aria-hidden="true" />Protected</span>}
              <span>Sample</span>
            </div>}>
            {examples.map(example => <article key={example.title} className={`relative overflow-hidden rounded-2xl border p-4 ${questCardSurface('dark')}`}>
              <span className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ backgroundColor: status.color }} />
              <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{example.title}</p><span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">{example.priority}</span></div>
              <p className="mt-3 text-xs leading-5 text-slate-300">{example.description}</p>
              <p className="mt-4 text-[11px] text-slate-400">Assigned to: Guild member</p>
            </article>)}
            {!examples.length && <EmptyQuestColumn />}
          </KanbanColumnFrame>;
        })}
      </div>
    </div>
    <p className="text-xs text-slate-400">Drag a column handle or use Move Left / Move Right in the table. Hidden or archived custom statuses are excluded.</p>
  </section>;
}
