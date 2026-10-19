import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { AlertTriangle, ArrowRight, Check, Clock3, History, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useJourneyClock, useTaskJourney, type JourneySnapshot } from '../hooks/useTaskJourney';
import type { LifecycleEvent } from '../types/taskLifecycle';
import { SubtaskStatus, type TimeEntry, type User } from '../types';
import { currentStageStart, duration, exactTimestamp, MAIN_STAGES, OTHER_STAGES, orderedSessions,
  prepareLiveMetrics, sessionSeconds, stageState, stageVisits, statusEvents, timestamp, type PreparedTimeMetrics } from '../utils/taskJourney';
import './TaskJourneyModal.css';
import { linkedPause } from '../utils/taskReport';

const TaskExecutionReport = React.lazy(() => import('./TaskExecutionReport'));

const label = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
const person = (id: string | null | undefined, users: Map<string, User>) => id ? users.get(id)?.name || `User ${id}` : 'Not recorded';
const Stamp = ({ value }: { value?: string | null }) => timestamp(value) === null
  ? <span className="journey-muted">Not recorded</span>
  : <time dateTime={value!} title={value!}>{exactTimestamp(value)}</time>;

const SUBTASK_STAGES = Object.values(SubtaskStatus);

const Roadmap = React.memo(function Roadmap({ current, events, stages }: { current: string; events: LifecycleEvent[]; stages: string[] }) {
  return <ol className="journey-roadmap">
    {stages.map(status => {
      const state = stageState(status, current, events);
      return <li key={status} className={`journey-stage journey-stage-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
        <span className="journey-stage-dot" aria-hidden="true">{state === 'visited' && <Check size={14} />}</span>
        <span>{label(status)}<small>{state === 'active' ? 'Current' : state === 'visited' ? 'Previously visited' : 'Not yet recorded'}</small></span>
      </li>;
    })}
  </ol>;
});

const TransitionRow = React.memo(function TransitionRow({ event, seconds, users }: {
  event: LifecycleEvent; seconds: number | null; users: Map<string, User>;
}) {
  return <li>
    <div className="journey-transition-heading">
      <span>{event.previous_status ? label(event.previous_status) : 'Created'} <ArrowRight size={13} aria-hidden="true" /> <strong>{label(event.new_status || 'Unknown')}</strong></span>
      <span className="journey-mono">{duration(seconds)}</span>
    </div>
    <div className="journey-event-meta"><Stamp value={event.occurred_at} /><span>{person(event.actor_id, users)}</span></div>
    <p className="journey-reason">Reason: {typeof event.details.reason === 'string' && event.details.reason.trim() ? event.details.reason : 'Not recorded'}</p>
  </li>;
});

function TransitionList({ events, current, now, complete, users }: {
  events: LifecycleEvent[]; current: string; now: number; complete: boolean; users: Map<string, User>;
}) {
  if (!events.length) return <p className="journey-muted">No recorded status transitions.</p>;
  return <ol className="journey-transitions">
    {stageVisits(events, current, now, complete).map(({ event, seconds }) => <TransitionRow key={event.id} event={event} seconds={seconds} users={users} />)}
  </ol>;
}

function SessionHistory({ entries, events, now, asOf, users }: {
  entries: TimeEntry[]; events: LifecycleEvent[]; now: number; asOf: number; users: Map<string, User>;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(25);
  const ordered = useMemo(() => orderedSessions(entries), [entries]);
  const byId = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  return <details className="journey-sessions" onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary><Clock3 size={15} aria-hidden="true" /> Timer sessions <span className="journey-muted">{entries.length} loaded</span></summary>
    {open && <>
    {!entries.length && <p className="journey-muted">No retained sessions loaded.</p>}
    {ordered.slice(0, visible).map(entry => <div className="journey-session" key={entry.id}>
      <div className="journey-transition-heading"><strong>{person(entry.userId, users)}</strong>
        <span className="journey-mono">{duration(sessionSeconds(entry, entry.stoppedAt ? asOf : now))}{!entry.stoppedAt && ' | Open'}</span></div>
      <p className="journey-id">Session {entry.id}</p>
      <dl className="journey-session-dates"><div><dt>Start</dt><dd><Stamp value={entry.startedAt} /></dd></div>
        <div><dt>{entry.stopReason === 'paused' ? 'Paused' : 'Stop'}</dt><dd>{entry.stoppedAt ? <Stamp value={entry.stoppedAt} /> : 'Running'}</dd></div></dl>
      {entry.continuedFromId && <p className="journey-muted">{label(entry.startKind || 'Continued')} from <span className="journey-id">{entry.continuedFromId}</span></p>}
      {entry.continuedFromId && <p className="journey-reason">Linked pause: {duration(linkedPause(byId.get(entry.continuedFromId), entry, asOf))}</p>}
      {entry.correctedAt && <p className="journey-reason">Correction: {entry.correctionReason || 'Not recorded'}<br />
        Original: <Stamp value={entry.originalStartedAt} /> to <Stamp value={entry.originalStoppedAt} /></p>}
    </div>)}
    {entries.length > visible && <button type="button" onClick={() => setVisible(value => value + 25)}>Show more loaded sessions</button>}
    <h5>Timer event ledger <span className="journey-muted">Recorded order</span></h5>
    {!events.length ? <p className="journey-muted">No recorded timer events loaded.</p> : <ol className="journey-timer-events">{events.slice(0, visible).map(event => <li key={event.id}>
      <strong>{label(event.event_type.replace('timer.', ''))}</strong><Stamp value={event.occurred_at} />
      <span>{person(event.actor_id, users)}</span><span className="journey-id">Session {event.time_entry_id}</span>
    </li>)}</ol>}
    {events.length > visible && <button type="button" onClick={() => setVisible(value => value + 25)}>Show more loaded timer events</button>}
    </>}
  </details>;
}

interface ChildJourneyView {
  id: string;
  title: string;
  assignee: string | null;
  status: string | null;
  changes: LifecycleEvent[];
  entries: TimeEntry[];
  timerEvents: LifecycleEvent[];
  time: PreparedTimeMetrics | null;
  firstWork?: string;
  completion?: string;
  firstSession?: string;
  lastStop?: string;
}

const ChildJourney = React.memo(function ChildJourney({ row, users, now, asOf, open, complete, onToggle }: {
  row: ChildJourneyView; users: Map<string, User>; now: number; asOf: number; open: boolean; complete: boolean;
  onToggle: (id: string, expanded: boolean) => void;
}) {
  return <details className="journey-child" onToggle={event => {
    if (event.target === event.currentTarget) onToggle(row.id, event.currentTarget.open);
  }}>
    <summary><span>{row.title}<small>{row.assignee || 'Not recorded'}</small></span>
      <span className="journey-status">{row.status ? label(row.status) : 'Removed'}</span>
      <span className="journey-mono">{duration(row.time?.at(now).person_seconds ?? null)}</span></summary>
    {open && <div className="journey-child-body">
      <dl className="journey-facts"><div><dt>First recorded active stage</dt><dd><Stamp value={row.firstWork} /></dd></div>
        <div><dt>Latest completion</dt><dd><Stamp value={row.completion} /></dd></div>
        <div><dt>First session start</dt><dd><Stamp value={row.firstSession} /></dd></div>
        <div><dt>Latest recorded stop</dt><dd><Stamp value={row.lastStop} /></dd></div></dl>
      {row.status && <Roadmap current={row.status} events={row.changes} stages={SUBTASK_STAGES} />}
      <TransitionList events={row.changes} current={row.status || ''} now={now} complete={complete} users={users} />
      <SessionHistory entries={row.entries} events={row.timerEvents} now={now} asOf={asOf} users={users} />
    </div>}
  </details>;
});

export function TaskJourneyContent({ data, users, now, clockStale, busy, loadMore }: {
  data: JourneySnapshot; users: Map<string, User>; now: number; clockStale: boolean; busy: boolean;
  loadMore: (kind: 'events' | 'sessions') => void;
}) {
  const { task, journey, analytics, sessions } = data;
  const [openChildren, setOpenChildren] = useState<Set<string>>(() => new Set());
  const toggleChild = useCallback((id: string, expanded: boolean) => setOpenChildren(previous => {
    if (previous.has(id) === expanded) return previous;
    const next = new Set(previous);
    if (expanded) next.add(id); else next.delete(id);
    return next;
  }), []);
  const asOf = timestamp(analytics.as_of)!;
  const allEvents = journey.next_after_id === null;
  const allSessions = sessions.next_after_id === null && sessions.items.length === analytics.aggregate.session_count;
  const transitions = useMemo(() => statusEvents(journey.items, null), [journey.items]);
  const byChild = useMemo(() => {
    const result = new Map<string | null, { events: LifecycleEvent[]; sessions: TimeEntry[] }>();
    result.set(null, { events: [], sessions: [] });
    for (const event of journey.items) {
      const bucket = result.get(event.subtask_id) ?? { events: [], sessions: [] };
      bucket.events.push(event);
      result.set(event.subtask_id, bucket);
    }
    for (const entry of sessions.items) {
      const id = entry.subtaskId || null;
      const bucket = result.get(id) ?? { events: [], sessions: [] };
      bucket.sessions.push(entry);
      result.set(id, bucket);
    }
    return result;
  }, [journey.items, sessions.items]);
  const parentEntries = byChild.get(null)!.sessions;
  const childEntries = useMemo(() => sessions.items.filter(entry => entry.subtaskId), [sessions.items]);
  const prepared = useMemo(() => {
    const aggregate = prepareLiveMetrics(analytics.aggregate, sessions.items, asOf, allSessions);
    return { aggregate,
      direct: prepareLiveMetrics(analytics.parent, parentEntries, asOf, aggregate.ready),
      children: prepareLiveMetrics(analytics.children, childEntries, asOf, aggregate.ready) };
  }, [analytics, sessions.items, asOf, allSessions, parentEntries, childEntries]);
  const canAdvance = prepared.aggregate.ready;
  const direct = prepared.direct.at(now);
  const children = prepared.children.at(now);
  const aggregate = prepared.aggregate.at(now);
  const stageStart = allEvents ? timestamp(currentStageStart(transitions, journey.status)) : null;
  const created = timestamp(journey.created_at);
  const childIds = useMemo(() => [...new Set([...journey.subtasks.map(child => child.id), ...byChild.keys()].filter((id): id is string => !!id))], [journey.subtasks, byChild]);
  const childTasks = useMemo(() => new Map(task.subtasks.map(child => [child.id, child])), [task.subtasks]);
  const childStates = useMemo(() => new Map(journey.subtasks.map(child => [child.id, child])), [journey.subtasks]);
  const childMetrics = useMemo(() => new Map(analytics.subtasks.map(child => [child.subtask_id, child])), [analytics.subtasks]);
  const parentTimerEvents = useMemo(() => byChild.get(null)!.events.filter(event => event.event_type.startsWith('timer.')), [byChild]);
  const childViews = useMemo(() => childIds.map((id): ChildJourneyView => {
    const subtask = childTasks.get(id);
    const current = childStates.get(id);
    const bucket = byChild.get(id) ?? { events: [], sessions: [] };
    const changes = statusEvents(bucket.events, id);
    const latest = changes.at(-1);
    const base = childMetrics.get(id);
    const ordered = allSessions ? orderedSessions(bucket.sessions) : [];
    const stopped = ordered.filter(row => row.stoppedAt && timestamp(row.stoppedAt) !== null);
    const last = stopped.reduce<TimeEntry | null>((previous, row) => !previous || timestamp(row.stoppedAt)! > timestamp(previous.stoppedAt)! ? row : previous, null);
    return { id, title: subtask?.title || `${current ? 'Subtask' : 'Removed subtask'} ${id}`,
      assignee: subtask?.assignedToId ? subtask.assignedUser?.name || person(subtask.assignedToId, users) : current && subtask ? 'Unassigned' : null,
      status: current?.status ?? null, changes, entries: bucket.sessions,
      timerEvents: bucket.events.filter(event => event.event_type.startsWith('timer.')),
      time: base ? prepareLiveMetrics(base, bucket.sessions, asOf, canAdvance) : null,
      firstWork: changes.find(event => event.new_status === SubtaskStatus.IN_PROGRESS)?.occurred_at,
      completion: allEvents && current?.status === SubtaskStatus.DONE && latest?.new_status === SubtaskStatus.DONE ? latest.occurred_at : undefined,
      firstSession: ordered[0]?.startedAt, lastStop: last?.stoppedAt ?? undefined,
    };
  }), [childIds, childTasks, childStates, childMetrics, byChild, users, asOf, canAdvance, allEvents, allSessions]);

  return <>
    <section className="journey-heading">
      <div className="journey-title-row"><h2>{task.title}</h2><span className="journey-status">{label(journey.status)}</span></div>
      <p className="journey-id">Task {task.id}</p>
      <dl className="journey-facts">
        <div><dt>Creator</dt><dd>{person(journey.created_by_id, users)}</dd></div>
        <div><dt>Assignees</dt><dd>{task.assignedTo?.length ? task.assignedTo.map(id => person(id, users)).join(', ') : 'Unassigned'}</dd></div>
        <div><dt>Created</dt><dd><Stamp value={journey.created_at} /></dd></div>
      </dl>
      {(!journey.history_complete || !analytics.history_complete) && <p className="journey-notice"><AlertTriangle size={16} aria-hidden="true" /> History incomplete. Capture began <Stamp value={journey.capture_started_at} />.</p>}
      <p className="journey-muted journey-sync">{clockStale ? 'Sync delayed' : 'Synced'} <Stamp value={analytics.as_of} />{!canAdvance ? ' | Time totals are a server snapshot' : clockStale ? ' | Live estimate paused' : ' | Live estimate'}</p>
    </section>

    <section className="journey-section" aria-label="Time summary">
      <dl className="journey-metrics">
        <div><dt>Task direct work</dt><dd>{duration(direct.person_seconds)}</dd></div>
        <div><dt>Subtask work</dt><dd>{duration(children.person_seconds)}</dd></div>
        <div><dt>Elapsed lifetime</dt><dd>{duration(created !== null && created <= now ? (now - created) / 1000 : null)}</dd></div>
        <div><dt>Current status duration</dt><dd>{duration(stageStart !== null && stageStart <= now ? (now - stageStart) / 1000 : null)}</dd></div>
      </dl>
      <p className="journey-totals">Combined active work <strong>{duration(aggregate.person_seconds)}</strong><span>Work elapsed <strong>{duration(aggregate.elapsed_seconds)}</strong></span><span>{analytics.aggregate.active_session_count} running sessions</span></p>
    </section>

    <section className="journey-section" aria-labelledby="journey-workflow-title">
      <h3 id="journey-workflow-title">Workflow</h3>
      <Roadmap current={journey.status} events={transitions} stages={MAIN_STAGES} />
      <h4>Alternate stages</h4>
      <Roadmap current={journey.status} events={transitions} stages={OTHER_STAGES} />
    </section>

    <section className="journey-section" aria-labelledby="journey-history-title">
      <div className="journey-section-title"><h3 id="journey-history-title">Task transitions</h3><span className="journey-muted">Recorded order</span></div>
      <TransitionList events={transitions} current={journey.status} now={now} complete={allEvents} users={users} />
      <SessionHistory entries={parentEntries} events={parentTimerEvents} now={now} asOf={asOf} users={users} />
    </section>

    <section className="journey-section" aria-labelledby="journey-subtasks-title">
      <h3 id="journey-subtasks-title">Subtask journeys <span className="journey-muted">{journey.subtasks.length}</span></h3>
      {!childIds.length && <p className="journey-muted">No subtasks.</p>}
      {childViews.map(row => <ChildJourney key={row.id} row={row} users={users} asOf={asOf}
        now={openChildren.has(row.id) || (row.time?.ready && row.time.running) ? now : asOf}
        open={openChildren.has(row.id)} complete={allEvents} onToggle={toggleChild} />)}
    </section>
    {(!allEvents || sessions.next_after_id !== null) && <footer className="journey-pagination">
      <span className="journey-muted">{journey.items.length} events | {sessions.items.length} sessions loaded</span>
      {!allEvents && <button type="button" disabled={busy} onClick={() => loadMore('events')}>Load more events</button>}
      {sessions.next_after_id !== null && <button type="button" disabled={busy} onClick={() => loadMore('sessions')}>Load more sessions</button>}
    </footer>}
  </>;
}

function JourneyLoader({ taskId, userId, tenantId, users }: { taskId: string; userId: string; tenantId: string | null; users: Map<string, User> }) {
  const { data, busy, error, refresh, loadMore } = useTaskJourney(taskId, userId, tenantId);
  const clock = useJourneyClock(data);
  const asOf = data ? timestamp(data.analytics.as_of) : null;
  const reportHistory = useMemo(() => {
    const buckets = new Map<string | null, { changes: LifecycleEvent[]; timers: LifecycleEvent[]; entries: TimeEntry[] }>();
    const bucket = (id: string | null) => {
      if (!buckets.has(id)) buckets.set(id, { changes: [], timers: [], entries: [] });
      return buckets.get(id)!;
    };
    for (const event of data?.journey.items ?? []) {
      if (event.event_type.startsWith('timer.')) bucket(event.subtask_id).timers.push(event);
      if (event.new_status && /^(task|subtask)\.(created|status_changed)$/.test(event.event_type)) bucket(event.subtask_id).changes.push(event);
    }
    for (const entry of data?.sessions.items ?? []) bucket(entry.subtaskId || null).entries.push(entry);
    return buckets;
  }, [data?.journey.items, data?.sessions.items]);
  const renderHistory = (id: string | null) => {
    if (!data || asOf === null) return null;
    const history = reportHistory.get(id);
    const state = id ? data.journey.subtasks.find(child => child.id === id)?.status || '' : data.journey.status;
    return <><TransitionList events={history?.changes ?? []} current={state} now={asOf + clock.advanceMs}
      complete={data.journey.next_after_id === null} users={users} />
      <SessionHistory entries={history?.entries ?? []} events={history?.timers ?? []} now={asOf + clock.advanceMs} asOf={asOf} users={users} /></>;
  };
  return <>
    <div className="journey-toolbar"><span className="journey-muted" role="status">{busy ? 'Loading journey...' : error ? 'Journey unavailable' : 'Task activity'}</span>
      <button type="button" className="journey-icon" aria-label="Refresh task journey" title="Refresh task journey" onClick={() => void refresh()} disabled={busy}><RefreshCw size={17} /></button></div>
    {error && <div className="journey-error" role="alert"><AlertTriangle size={24} aria-hidden="true" /><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></div>}
    {!error && !data && <div className="journey-loading" role="status"><Clock3 size={24} aria-hidden="true" /><p>Loading task history...</p></div>}
    {data && asOf !== null && <TabGroup>
      <TabList className="journey-tabs" aria-label="Task activity views"><Tab>Journey</Tab><Tab>Execution report</Tab></TabList>
      <TabPanels>
        <TabPanel><TaskJourneyContent data={data} users={users} now={asOf + clock.advanceMs} clockStale={clock.age >= 60000} busy={busy} loadMore={loadMore} /></TabPanel>
        <TabPanel><Suspense fallback={<p className="journey-loading" role="status">Loading report...</p>}>
          <TaskExecutionReport taskId={taskId} revision={data.receivedAt} expected={data.journey} renderHistory={renderHistory} historyFooter={
            <footer className="journey-pagination"><span className="journey-muted">{data.journey.items.length} events | {data.sessions.items.length} sessions loaded</span>
              {data.journey.next_after_id !== null && <button type="button" disabled={busy} onClick={() => void loadMore('events')}>Load more events</button>}
              {data.sessions.next_after_id !== null && <button type="button" disabled={busy} onClick={() => void loadMore('sessions')}>Load more sessions</button>}
            </footer>} />
        </Suspense></TabPanel>
      </TabPanels>
    </TabGroup>}
  </>;
}

export default function TaskJourneyModal({ taskId, usersMap, onClose }: { taskId: string; usersMap: Map<string, User>; onClose: () => void }) {
  const { user } = useAuth();
  return <Dialog open={Boolean(user)} onClose={onClose} className="task-journey">
    <DialogBackdrop className="journey-backdrop" />
    <div className="journey-position"><DialogPanel className="journey-panel">
      <header className="journey-modal-header"><DialogTitle><History size={19} aria-hidden="true" /> Task status journey</DialogTitle>
        <button type="button" className="journey-icon" aria-label="Close task journey" title="Close task journey" onClick={onClose} data-autofocus><X size={20} /></button></header>
      <div className="journey-scroll">{user && <JourneyLoader key={`${user.tenantId}:${user.id}:${taskId}`} taskId={taskId} userId={user.id} tenantId={user.tenantId ?? null} users={usersMap} />}</div>
    </DialogPanel></div>
  </Dialog>;
}
