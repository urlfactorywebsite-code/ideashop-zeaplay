import React from 'react';
import { columnAppearance, type ResolvedTheme } from '../utils/kanbanAppearance';

export default function KanbanColumnFrame({ statusKey, label, color, icon, count, theme = 'dark', compact = false,
  children, controls, className = '', ...props }: React.HTMLAttributes<HTMLElement> & {
  statusKey: string; label: string; color?: string; icon?: string; count: number; theme?: ResolvedTheme;
  compact?: boolean; controls?: React.ReactNode;
}) {
  const { accent, Icon, style } = columnAppearance(statusKey, color, icon, theme);
  const bright = theme !== 'dark';
  return <section {...props} aria-label={props['aria-label'] || `${label} quests`}
    className={`relative flex-shrink-0 overflow-hidden rounded-3xl border p-5 backdrop-blur transition duration-200 hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-cyan-400/60 ${compact ? 'w-60' : 'w-72'} ${className}`}
    style={{ ...style, ...props.style }}>
    <div className="pointer-events-none absolute inset-x-5 top-0 h-1 rounded-b-full" style={{ backgroundColor: accent }} />
    <div className="relative flex flex-col gap-4">
      {controls}
      <div className="flex items-center justify-between gap-2">
        <h3 className={`flex min-w-0 flex-1 items-center gap-2 font-semibold ${bright ? 'text-slate-950' : 'text-slate-100'}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border shadow-sm"
            style={{ borderColor: accent, color: accent, background: bright ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.58)' }}>
            <Icon aria-hidden="true" className="h-4 w-4" />
          </span><span className="min-w-0 [overflow-wrap:anywhere]">{label || 'Untitled status'}</span>
        </h3>
        <span aria-label={`${count} tasks`} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${bright ? 'text-slate-600' : 'text-slate-200/80'}`}
          style={{ borderColor: bright ? 'rgba(148,163,184,0.22)' : 'rgba(255,255,255,0.1)', background: bright ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.06)' }}>{count}</span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  </section>;
}

export function EmptyQuestColumn({ theme = 'dark', hasTasks = false }: { theme?: ResolvedTheme; hasTasks?: boolean }) {
  return <div className={`rounded-2xl border border-dashed py-6 text-center text-xs ${theme !== 'dark' ? 'border-indigo-200/90 bg-white/50 text-slate-500' : 'border-white/20 bg-white/5 text-white/60'}`}>{hasTasks ? 'No quests on this page.' : 'Drop quests here'}</div>;
}
