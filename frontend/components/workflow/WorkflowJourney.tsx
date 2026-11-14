import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Activity, ArrowLeft, ArrowRight, Bug, Check, ChevronRight, Clock3, createLucideIcon, Crown, FileCheck2, Flame, Flag, GitBranch, Milestone, Pause, Rocket, ShieldCheck, Sparkles, TriangleAlert, Trophy, type LucideIcon } from 'lucide-react';
import { exactTimestamp } from '../../utils/taskJourney';
import { stageStateName, stageTime, workflowCompletion, type WorkflowIcon, type WorkflowStage } from '../../utils/workflowJourney';
import './WorkflowJourney.css';

export type { WorkflowStage } from '../../utils/workflowJourney';
type Track = 'main' | 'alternate';
const Tombstone = createLucideIcon('Tombstone', [
  ['path', { d: 'M6 21V9a6 6 0 0 1 12 0v12M4 21h16M9 10h6M12 7v6', key: 'grave' }],
]);
const ICONS: Record<WorkflowIcon, LucideIcon> = { rocket: Rocket, file: FileCheck2, activity: Activity, review: ShieldCheck,
  trophy: Trophy, deploy: Flag, bug: Bug, crown: Crown, pause: Pause, warning: TriangleAlert, grave: Tombstone, checkpoint: Milestone };
const FLOAT = { y: [0, -5, 0] };
const HOVER = { scale: 1.06 };
const PRESS = { scale: .94 };
const STILL = { y: 0 };

export function ProgressIndicator({ stages }: { stages: WorkflowStage[] }) {
  const reduce = useReducedMotion();
  const { completed, total, percentage } = workflowCompletion(stages);
  return <div className="wf-progress">
    <div className="flex items-center justify-between gap-3 wf-progress-caption"><span><Trophy size={15} aria-hidden="true" /> {completed} / {total} stages completed</span><strong>{percentage}%</strong></div>
    <div className="wf-progress-rail" role="progressbar" aria-label="Main workflow completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
      aria-valuetext={`${completed} of ${total} enabled main stages completed`}>
      <motion.div initial={false} animate={{ width: `${percentage}%` }} transition={{ duration: reduce ? 0 : .2 }} />
    </div>
  </div>;
}

export function WorkflowHeader({ stages, focus, onFocus, titleId }: { stages: WorkflowStage[]; focus: Track; onFocus: (track: Track) => void; titleId?: string }) {
  const generatedId = useId();
  return <header className="wf-header flex flex-wrap items-center justify-between gap-5">
    <div className="wf-brand flex items-center gap-3"><span className="wf-brand-icon"><Rocket size={23} aria-hidden="true" /></span>
      <div><h3 id={titleId || generatedId}>Workflow Progress</h3><p>Track the task from creation to deployment</p></div></div>
    <div className="wf-header-tools"><div className="wf-flow-controls" role="group" aria-label="Focus workflow track">
      <button type="button" aria-pressed={focus === 'main'} onClick={() => onFocus('main')}><Rocket size={14} aria-hidden="true" /> Main Flow</button>
      <button type="button" aria-pressed={focus === 'alternate'} onClick={() => onFocus('alternate')}><GitBranch size={14} aria-hidden="true" /> Alternate Flow</button>
    </div><ProgressIndicator stages={stages} /></div>
  </header>;
}

export function StageTooltip({ stage, id, style }: { stage: WorkflowStage; id: string; style?: React.CSSProperties }) {
  return <span role="tooltip" id={id} className="wf-tooltip" style={style}><strong>{stage.label}</strong><span>{stageStateName(stage)}{stage.recorded ? ' · Recorded' : ' · Not yet recorded'}</span>
    <span>Recorded time: {stageTime(stage)}</span>{stage.lastChangedAt && <time dateTime={stage.lastChangedAt}>{exactTimestamp(stage.lastChangedAt)}</time>}</span>;
}

export const WorkflowCheckpoint = React.memo(function WorkflowCheckpoint({ stage, selected, onSelect, x, y }: {
  stage: WorkflowStage; selected: boolean; onSelect: (id: string) => void; x: number; y: number;
}) {
  const [tooltip, setTooltip] = useState(false);
  const reduce = useReducedMotion();
  const tooltipId = useId();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(false);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [tooltip]);
  const tooltipRoot = button.current?.closest('.workflow-journey');
  const bounds = tooltip ? button.current?.getBoundingClientRect() : undefined;
  const clip = button.current?.closest('.wf-track-viewport')?.getBoundingClientRect();
  const panel = button.current?.closest('.journey-scroll')?.getBoundingClientRect();
  const anchorVisible = bounds && clip && bounds.right > clip.left && bounds.left < clip.right &&
    (!panel || bounds.top >= panel.top && bounds.top < panel.bottom);
  const Icon = ICONS[stage.icon || 'checkpoint'];
  const state = stage.isCurrent ? 'current' : stage.completed ? 'completed' : 'pending';
  return <li className={`wf-checkpoint wf-${state} wf-icon-${stage.icon || 'checkpoint'} journey-stage-${stage.isCurrent ? 'active' : stage.completed ? 'visited' : 'upcoming'}`}
    data-stage-id={stage.id} style={{ left: `${x}%`, top: y - 23 }}>
    <motion.button ref={button} type="button" className="wf-checkpoint-button" aria-label={`${stage.label}: ${stageStateName(stage)}. View stage details`}
      aria-current={stage.isCurrent ? 'step' : undefined} aria-pressed={selected} aria-describedby={tooltip ? tooltipId : undefined}
      onClick={() => onSelect(stage.id)} onMouseEnter={() => setTooltip(true)} onMouseMove={() => setTooltip(true)} onMouseLeave={() => setTooltip(false)}
      onFocus={() => setTooltip(true)} onBlur={() => setTooltip(false)} onKeyDown={event => { if (event.key === 'Escape' && tooltip) { event.stopPropagation(); setTooltip(false); } }}
      whileHover={reduce ? undefined : HOVER} whileTap={reduce ? undefined : PRESS} transition={{ duration: .15 }}>
      <span className="wf-checkpoint-ring journey-stage-dot">{stage.completed && !stage.isCurrent ? <Check size={21} aria-hidden="true" /> : <Icon size={21} aria-hidden="true" />}</span>
      <span className="wf-stage-label">{stage.label}</span>
      <span className={`wf-badge wf-badge-${state}`}>{stage.isCurrent ? 'Current' : stage.completed ? 'Completed' : stage.pending ? 'Pending' : 'Not recorded'}</span>
      <span className="wf-stage-caption">{stage.recorded ? `Recorded time: ${stageTime(stage)}` : 'Not yet recorded'}</span>
    </motion.button>
    {tooltip && bounds && anchorVisible && tooltipRoot && createPortal(<StageTooltip stage={stage} id={tooltipId}
      style={{ left: Math.max(10, Math.min(bounds.left + bounds.width / 2 - 100, window.innerWidth - 210)), top: Math.max(panel ? panel.top + 8 : 10, bounds.top - 110) }} />, tooltipRoot)}
  </li>;
});

function TrackArtwork() {
  return <svg className="wf-landscape" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <circle className="wf-moon-halo" cx="1020" cy="70" r="55" /><circle className="wf-moon" cx="1020" cy="70" r="27" />
    <path className="wf-mountain-back" d="M0 220 100 133 190 192 315 112 440 211 580 141 705 222 850 126 990 215 1100 149 1200 213V260H0Z" />
    <path className="wf-mountain-front" d="M0 250 120 205 240 249 360 179 510 244 665 202 810 252 945 191 1080 246 1200 203V260H0Z" />
  </svg>;
}

const pointsFor = (stages: WorkflowStage[]) => stages.map((_, index) => ({ x: stages.length === 1 ? 50 : 10 + index * 80 / (stages.length - 1), y: [112, 91, 116, 87, 108, 85][index % 6] }));
const segmentPath = (a: { x: number; y: number }, b: { x: number; y: number }) => `M ${a.x * 10} ${a.y} C ${(a.x + (b.x - a.x) / 2) * 10} ${a.y - 20}, ${(a.x + (b.x - a.x) / 2) * 10} ${b.y + 20}, ${b.x * 10} ${b.y}`;

export function RocketProgressTrack({ stages, track = 'main', focused, onFocus, selectedId, onSelect }: {
  stages: WorkflowStage[]; track?: Track; focused: boolean; onFocus: () => void; selectedId?: string; onSelect: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const currentId = stages.find(stage => stage.isCurrent)?.id;
  const currentIndex = stages.findIndex(stage => stage.isCurrent);
  const navigationIndex = useRef(Math.max(0, currentIndex));
  const points = useMemo(() => pointsFor(stages), [stages.length]);
  const title = track === 'main' ? 'Main workflow' : 'Alternate stages';
  const ensureVisible = (id: string, smooth = true) => {
    const view = viewport.current;
    const checkpoint = view?.querySelector<HTMLElement>(`[data-stage-id="${CSS.escape(id)}"]`);
    if (view && checkpoint) view.scrollTo({ left: Math.max(0, checkpoint.offsetLeft - view.clientWidth / 2), behavior: smooth && !reduce ? 'smooth' : 'instant' });
  };
  useEffect(() => { if (currentId) { navigationIndex.current = currentIndex; ensureVisible(currentId); } }, [currentId, reduce]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(() => { if (currentId) ensureVisible(currentId, false); });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [currentId]);
  const move = (direction: number) => {
    const view = viewport.current;
    if (!view) return;
    const buttons = [...view.querySelectorAll<HTMLButtonElement>('.wf-checkpoint-button')];
    const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = Math.max(0, Math.min(buttons.length - 1, (active < 0 ? navigationIndex.current : active) + direction));
    buttons[next]?.focus({ preventScroll: true });
    if (stages[next]) ensureVisible(stages[next].id);
  };
  return <section className={`wf-track wf-track-${track} ${focused ? 'wf-track-focused' : ''}`} aria-label={title} onFocus={onFocus}>
    <div className="wf-track-heading flex items-center justify-between gap-3"><h4>{track === 'main' ? <Rocket size={14} aria-hidden="true" /> : <GitBranch size={14} aria-hidden="true" />}{title}</h4>
      <span>{track === 'main' ? 'Enabled main stages' : 'Optional routes · excluded from main progress'}</span>
      <div className="wf-track-navigation" role="group" aria-label={`${title} navigation`}>
        <button type="button" aria-label={`Previous ${title.toLowerCase()} checkpoint`} disabled={!stages.length} onClick={() => move(-1)}><ArrowLeft size={14} /></button>
        <button type="button" aria-label={`Next ${title.toLowerCase()} checkpoint`} disabled={!stages.length} onClick={() => move(1)}><ArrowRight size={14} /></button>
      </div>
    </div>
    {!stages.length ? <p className="wf-empty">No enabled {track === 'main' ? 'main' : 'alternate'} stages.</p> : <div className="wf-track-viewport" ref={viewport} onFocusCapture={event => {
      const id = (event.target as HTMLElement).closest('[data-stage-id]')?.getAttribute('data-stage-id');
      const index = stages.findIndex(stage => stage.id === id);
      if (index >= 0) navigationIndex.current = index;
    }}>
      <div className="wf-track-canvas" style={{ minWidth: Math.max(track === 'main' ? 700 : 640, stages.length * 116) }}>
        <TrackArtwork />
        <svg className="wf-route" viewBox="0 0 1000 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {points.slice(1).map((point, index) => <React.Fragment key={`${stages[index].id}-${stages[index + 1].id}`}>
            <path className="wf-route-pending" d={segmentPath(points[index], point)} />
            {track === 'main' && stages[index].completed && stages[index + 1].recorded &&
              <motion.path className="wf-route-completed" d={segmentPath(points[index], point)} initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : .2 }} />}
          </React.Fragment>)}
        </svg>
        <ol className="wf-checkpoints" aria-label={`${title} checkpoints`} onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); const id = event.key === 'Home' ? stages[0].id : stages.at(-1)!.id;
            viewport.current?.querySelector<HTMLButtonElement>(`[data-stage-id="${CSS.escape(id)}"] button`)?.focus({ preventScroll: true }); ensureVisible(id);
          }
        }}>{stages.map((stage, index) => <WorkflowCheckpoint key={stage.id} stage={stage} x={points[index].x} y={points[index].y}
          selected={selectedId === stage.id} onSelect={onSelect} />)}</ol>
        {currentIndex >= 0 && <motion.div className="wf-rocket-position" aria-hidden="true" initial={false}
          animate={{ left: `${points[currentIndex].x}%`, top: points[currentIndex].y - 69 }} transition={{ duration: reduce ? 0 : .2 }}>
          <motion.span className="wf-rocket" animate={reduce ? STILL : FLOAT} transition={reduce ? { duration: 0 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
            <Rocket size={31} /><Flame className="wf-rocket-flame" size={16} />
          </motion.span></motion.div>}
      </div>
    </div>}
  </section>;
}

export function AlternateStageTrack(props: Omit<React.ComponentProps<typeof RocketProgressTrack>, 'track'>) {
  return <RocketProgressTrack {...props} track="alternate" />;
}

export interface WorkflowJourneyProps {
  mainStages: WorkflowStage[];
  alternateStages: WorkflowStage[];
  historyComplete?: boolean;
  className?: string;
  titleId?: string;
}

export default function WorkflowJourney({ mainStages, alternateStages, historyComplete = true, className = '', titleId }: WorkflowJourneyProps) {
  const generatedId = useId();
  const headingId = titleId || generatedId;
  const all = [...mainStages, ...alternateStages];
  const current = all.find(stage => stage.isCurrent);
  const currentTrack: Track = current && alternateStages.some(stage => stage.id === current.id) ? 'alternate' : 'main';
  const [focus, setFocus] = useState<Track>(currentTrack);
  const [selectedId, setSelectedId] = useState<string | undefined>(current?.id);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelectedId(current?.id); setFocus(currentTrack); }, [current?.id, currentTrack]);
  const selected = all.find(stage => stage.id === selectedId) || current || all[0];
  const select = (id: string) => setSelectedId(id);
  const focusTrack = (track: Track) => {
    setFocus(track);
    root.current?.querySelector<HTMLElement>(`.wf-track-${track}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  };
  return <div ref={root} role="region" aria-labelledby={headingId} className={`workflow-journey relative w-full overflow-hidden rounded-2xl ${className}`}>
    <WorkflowHeader stages={mainStages} focus={focus} onFocus={focusTrack} titleId={headingId} />
    <RocketProgressTrack stages={mainStages} focused={focus === 'main'} onFocus={() => setFocus('main')} selectedId={selected?.id} onSelect={select} />
    <AlternateStageTrack stages={alternateStages} focused={focus === 'alternate'} onFocus={() => setFocus('alternate')} selectedId={selected?.id} onSelect={select} />
    <div className="wf-footer">
      {selected && <section className="wf-stage-details" aria-label="Selected stage details">
        <div className="wf-details-heading"><span><Sparkles size={15} aria-hidden="true" /> Stage intel</span><strong>{selected.label}</strong><span className={`wf-detail-state ${selected.isCurrent ? 'wf-detail-current' : ''}`}>{stageStateName(selected)}</span></div>
        <dl className="wf-detail-facts"><div><dt><Clock3 size={12} aria-hidden="true" /> Recorded time</dt><dd>{stageTime(selected)}</dd></div>
          <div><dt>First recorded entry</dt><dd>{exactTimestamp(selected.enteredAt)}</dd></div><div><dt>Latest recorded entry</dt><dd>{exactTimestamp(selected.lastChangedAt)}</dd></div>
          {Object.entries(selected.metadata || {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value ?? 'Not recorded'}</dd></div>)}</dl>
      </section>}
      <div className="wf-legend"><span><i className="wf-legend-completed" />Completed stage</span><span><i className="wf-legend-current" />Current stage</span><span><i />Not yet recorded</span>
        <span className="wf-readonly"><ChevronRight size={12} aria-hidden="true" />Select a checkpoint to inspect</span></div>
      <p className="wf-history-note">Only enabled statuses are shown. Completion uses recorded stage exits and the current completed status; skipped stages are never assumed complete.{!historyComplete && ' History is incomplete; unrecorded time remains unavailable.'}</p>
    </div>
  </div>;
}
