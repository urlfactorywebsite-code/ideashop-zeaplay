import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Clock3, Pause, Play, Square, X, ExternalLink, History, ChevronDown, RefreshCw } from 'lucide-react';
import api from '../services/mockApi';
import { useActiveWork } from '../hooks/useActiveWork';
import type { WorkSession, WorkSnapshot } from '../types/activeWork';
import { sessionSeconds, workDuration, workRange, workTimezone } from '../utils/activeWork';
import { useAuth } from '../hooks/useAuth';
import './ActiveWork.css';
import { SubtaskStatus } from '../types';


export function WorkTimerControls({ taskId, subtaskId, disabled = false, canForceStart = false }: { taskId?: string; subtaskId?: string; disabled?: boolean; canForceStart?: boolean }) {
  const work = useActiveWork();
  const [forceOpen, setForceOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [forceError, setForceError] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const session = work.snapshot?.items.find(row => subtaskId ? row.subtask_id === subtaskId : !row.subtask_id && row.task_id === taskId);
  const forceStart = async () => {
    if (!taskId || !subtaskId || reason.trim().length < 3) return;
    setForcing(true); setForceError(null);
    try {
      await api.updateSubtask(taskId, subtaskId, { status: SubtaskStatus.IN_PROGRESS, forceStartReason: reason.trim() });
      setForceOpen(false); setReason('');
      window.dispatchEvent(new Event('zea:work-updated'));
      await work.start({ subtaskId });
    } catch (error) { setForceError(error instanceof Error ? error.message : 'Unable to force-start subtask.'); }
    finally { setForcing(false); }
  };
  return <div className="work-inline">
    {session ? <><span className={`work-state work-${session.status.toLowerCase()}`}>{session.status} · {workDuration(sessionSeconds(session, work.advance))}</span>
      <button type="button" disabled={work.busy || (session.status === 'PAUSED' && (disabled || session.target_accessible === false))} onClick={() => void work.control(session, session.status === 'RUNNING' ? 'pause' : 'resume')}>{session.status === 'RUNNING' ? 'Pause' : 'Resume'}</button>
      <button type="button" disabled={work.busy} onClick={() => void work.control(session, 'stop')}>Stop</button></> :
      <button type="button" disabled={disabled || work.busy || !work.snapshot} onClick={() => void work.start(subtaskId ? { subtaskId } : { taskId })}>Start timer</button>}
    <button type="button" onClick={() => work.setOpen(true)}>Active Work</button>
    {canForceStart && !session && <button type="button" onClick={() => setForceOpen(true)}>Force start…</button>}
    {forceOpen && <div className="work-force"><p>Force-start this waiting subtask? Its unfinished dependencies will be recorded with your reason.</p>
      <label>Reason<input aria-label="Force-start reason" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {forceError && <p role="alert">{forceError}</p>}
      <button type="button" disabled={forcing || reason.trim().length < 3} onClick={() => void forceStart()}>Force start and track</button>
      <button type="button" disabled={forcing} onClick={() => setForceOpen(false)}>Cancel</button>
    </div>}
  </div>;
}

export default function ActiveWork({ onOpenTask }: { onOpenTask?: (taskId: string, subtaskId?: string | null) => void }) {
  const work = useActiveWork();
  const { user } = useAuth();
  const timezone = workTimezone(user?.timezone);
  const stamp = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'medium' }) : '—';
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<WorkSnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const request = useRef(0);
  const historyScope = useRef<string | null>(null);
  useEffect(() => { setOffset(0); }, [preset, from, to, search]);
  useEffect(() => {
    const generation = ++request.current;
    if (!work.open || tab !== 'history') return;
    const scope = JSON.stringify([user?.id, user?.tenantId, preset, from, to, search, offset, timezone]);
    if (historyScope.current !== scope || (!work.snapshot && work.error)) setHistory(null);
    historyScope.current = scope;
    setLoading(true); setHistoryError(null);
    const debounce = window.setTimeout(() => {
      void (async () => {
        try {
          const params = workRange(preset, from, to, new Date(), timezone);
          const result = await api.getWorkHistory({ ...params, search, offset });
          if (result.user_id !== user?.id || result.tenant_id !== user?.tenantId) throw new Error('History response does not match your signed-in account.');
          if (generation === request.current) setHistory(result);
        } catch (error) { if (generation === request.current) { setHistory(null); setHistoryError(error instanceof Error ? error.message : 'Unable to load history.'); } }
        finally { if (generation === request.current) setLoading(false); }
      })();
    }, 250);
    return () => { request.current++; window.clearTimeout(debounce); };
  }, [work.open, tab, preset, from, to, search, offset, timezone, work.snapshot?.server_time, work.error, user?.id, user?.tenantId]);
  const running = work.snapshot?.items.filter(row => row.status === 'RUNNING') ?? [];
  const paused = work.snapshot?.items.filter(row => row.status === 'PAUSED') ?? [];
  const total = running.reduce((sum, row) => sum + sessionSeconds(row, work.advance), 0);
  const openTask = (row: WorkSession) => { work.setOpen(false); onOpenTask?.(row.task_id, row.subtask_id); };
  const card = (row: WorkSession, historical = false) => <article className="work-card" key={row.id}>
    <div className="work-card-top"><span className={`work-state work-${row.status.toLowerCase()}`}>{row.status}</span><span>{row.project_name}</span></div>
    <h3>{row.subtask_title || row.task_title}</h3>
    <p>{row.subtask_title ? row.task_title : 'Main task'} · {row.subtask_status.replaceAll('_', ' ')}</p>
    <div className="work-duration">{workDuration(historical ? row.active_seconds : sessionSeconds(row, work.advance))}</div>
    <p>Started {stamp(row.started_at)}</p>
    {historical ? <>
      <p>Stopped {stamp(row.stopped_at)} · Paused {workDuration(row.paused_seconds)}</p>
      <p>Active time in selected range: {workDuration(row.range_active_seconds)}</p>
      <p>Your total on {row.subtask_title ? 'subtask' : 'task'}: {workDuration(row.subtask_total_seconds)}</p>
      <details><summary>View session details <ChevronDown size={14} /></summary>
        <p className="work-session-id">Session {row.id}</p>
        <ol className="work-timeline">{row.timeline.map((event, index) => <li key={index}><strong>{event.event}</strong><time dateTime={event.at}>{stamp(event.at)}</time></li>)}</ol>
        {row.intervals.map(interval => <React.Fragment key={interval.id}><p>{stamp(interval.started_at)} → {interval.ended_at ? stamp(interval.ended_at) : 'Running'} · {workDuration(interval.active_seconds)}{interval.corrected ? ' · Corrected (audit retained)' : ''}</p>
          {interval.paused_until && <p>Paused {stamp(interval.ended_at)} → {stamp(interval.paused_until)} · {workDuration(interval.paused_seconds ?? 0)}</p>}</React.Fragment>)}
      </details>
    </> : <div className="work-actions">
      <button type="button" disabled={work.busy || (row.status === 'PAUSED' && (row.target_accessible === false || ['DONE', 'DEPLOYED', 'FAILED', 'GRAVEYARD', 'WAITING'].includes(row.subtask_status)))} onClick={() => void work.control(row, row.status === 'RUNNING' ? 'pause' : 'resume')}>
        {row.status === 'RUNNING' ? <Pause size={14} /> : <Play size={14} />}{row.status === 'RUNNING' ? 'Pause' : 'Resume'}</button>
      <button type="button" disabled={work.busy} onClick={() => void work.control(row, 'stop')}><Square size={14} />Stop</button>
    </div>}
    <button type="button" className="work-open" disabled={row.target_accessible === false} title={row.target_accessible === false ? 'Access to this task has changed. You can still pause or stop your session.' : undefined} onClick={() => openTask(row)}><ExternalLink size={14} />Open {row.subtask_title ? 'subtask' : 'task'}</button>
  </article>;
  return <>
    <button type="button" className={`work-trigger ${running.length ? 'work-live' : ''}`} aria-label="Open Active Work" aria-haspopup="dialog" aria-expanded={work.open} onClick={() => work.setOpen(true)}>
      <Clock3 size={18} /><span>Active Work</span><b>{work.snapshot ? `${work.snapshot.running_count}/${work.snapshot.limit}` : '…'}</b>{running.length > 0 && <i aria-label="Work running" />}
    </button>
    <Dialog open={work.open} onClose={() => work.setOpen(false)} className="work-dialog">
      <div className="work-backdrop" aria-hidden="true" />
      <DialogPanel className="work-panel">
        <div className="work-heading"><div><DialogTitle>Active Work</DialogTitle><p>Independent timers. Your sessions continue until you pause or stop.</p></div>
          <button type="button" aria-label="Close Active Work" onClick={() => work.setOpen(false)}><X size={20} /></button></div>
        <div className="work-tabs"><button type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')}><Clock3 size={16} />Current work</button>
          <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}><History size={16} />Work history</button>
          <button type="button" aria-label="Refresh Active Work" onClick={() => void work.refresh()}><RefreshCw size={16} /></button></div>
        {work.error && <p role="alert" className="work-error">{work.error}</p>}
        {work.connectionStatus !== 'connected' && <p role="status" className="work-note" style={{ margin: '12px 22px 0' }}>Reconnecting · your running sessions continue.</p>}
        <div className="work-content">
          {tab === 'active' ? <><div className="work-summary"><strong>{work.snapshot?.running_count ?? '…'}/{work.snapshot?.limit ?? '…'} running</strong><span>Total Session Time <b>{workDuration(total)}</b></span></div>
            {work.snapshot && !running.length && !paused.length && <div className="work-empty"><Clock3 size={32} /><h3>No active work yet</h3><p>Start a timer on an assigned subtask to track your work here.</p></div>}
            {running.map(row => card(row))}
            {paused.length > 0 && <><h3 className="work-section">Paused · no running slots used</h3>{paused.map(row => card(row))}</>}
            {work.snapshot?.next_offset !== null && work.snapshot?.next_offset !== undefined && <p>Additional paused sessions are available in Work history.</p>}
          </> : <><div className="work-filters"><label>Period<select value={preset} onChange={e => setPreset(e.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="custom">Custom date range</option></select></label>
            {preset === 'custom' && <><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Through<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
            <label>Task or subtask<input type="search" placeholder="Search work history" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
            <p className="work-note">Timezone: {timezone}. Sessions intersecting the range appear once; range time is clipped to its boundaries. Overlapping sessions count separately.</p>
            {loading && <p role="status">Loading work history…</p>}{historyError && <p role="alert" className="work-error">{historyError}</p>}
            {!loading && history?.items.length === 0 && <p className="work-empty">No sessions in this period.</p>}
            {history?.items.map(row => card(row, true))}
            <div className="work-actions">{offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button>}
              {history?.next_offset != null && <button type="button" onClick={() => setOffset(history.next_offset!)}>Next</button>}</div>
          </>}
        </div>
      </DialogPanel>
    </Dialog>
  </>;
}
