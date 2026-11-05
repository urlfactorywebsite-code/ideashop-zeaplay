import { TaskStatus, type TimeEntry } from '../types';
import type { LifecycleEvent, TaskJourney, TimeMetrics } from '../types/taskLifecycle';

export const MAIN_STAGES = [TaskStatus.WAITING_FOR_REQUIREMENT, TaskStatus.TODO,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.DONE, TaskStatus.DEPLOYED];
export const OTHER_STAGES = [TaskStatus.BUG_FIXING, TaskStatus.BLOCKED,
  TaskStatus.ON_HOLD, TaskStatus.FAILED, TaskStatus.GRAVEYARD];

export function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : null;
}

export function exactTimestamp(value?: string | null): string {
  if (timestamp(value) === null) return 'Not recorded';
  return value!.replace('T', ' ').replace(/Z$/i, ' UTC') +
    (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value!) ? '' : ' UTC');
}

export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Not recorded';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h > 0 ? `${h}h ` : ''}${m}m ${total % 60}s`;
}

export function mergeEvents(current: LifecycleEvent[], incoming: LifecycleEvent[]): LifecycleEvent[] {
  return [...new Map([...current, ...incoming].map(event => [event.id, event])).values()]
    .sort((a, b) => a.id - b.id);
}

export function stageState(status: string, current: string, events: LifecycleEvent[]) {
  if (status === current) return 'active';
  // Roadmap position is not evidence that work passed through that stage.
  return events.some(event => event.previous_status === status) ? 'visited' : 'upcoming';
}

export function currentStageStart(events: LifecycleEvent[], current: string): string | null {
  const latest = events.at(-1);
  return latest?.new_status === current ? latest.occurred_at : null;
}

export function stageVisits(events: LifecycleEvent[], current: string, now: number, complete: boolean) {
  return events.map((event, index) => {
    const start = timestamp(event.occurred_at);
    const next = events[index + 1];
    const end = next?.previous_status === event.new_status ? timestamp(next.occurred_at) : null;
    const isCurrent = index === events.length - 1 && event.new_status === current && complete;
    const right = end ?? (isCurrent ? now : null);
    return { event, seconds: start !== null && right !== null && right >= start && right <= now ? (right - start) / 1000 : null };
  });
}

function unionMilliseconds(intervals: [number, number][]): number {
  let end = -Infinity;
  let total = 0;
  for (const [left, right] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, right - Math.max(left, end));
    end = Math.max(end, right);
  }
  return total;
}

function sessionSummary(entries: TimeEntry[], now: number) {
  const intervals: [number, number][] = [];
  const byUser = new Map<string, [number, number][]>();
  let raw = 0;
  for (const entry of entries) {
    const left = timestamp(entry.startedAt);
    const stop = timestamp(entry.stoppedAt);
    if (entry.stoppedAt && stop === null) continue;
    const right = Math.min(stop ?? now, now);
    if (left === null || right <= left) continue;
    const interval: [number, number] = [left, right];
    intervals.push(interval);
    const user = byUser.get(entry.userId) ?? [];
    user.push(interval);
    byUser.set(entry.userId, user);
    raw += right - left;
  }
  const personMs = [...byUser.values()].reduce((sum, rows) => sum + unionMilliseconds(rows), 0);
  const elapsedMs = unionMilliseconds(intervals);
  const metrics: TimeMetrics = {
    session_count: entries.length,
    active_session_count: entries.filter(entry => !entry.stoppedAt).length,
    raw_session_seconds: Math.floor(raw / 1000),
    person_seconds: Math.floor(personMs / 1000),
    elapsed_seconds: Math.floor(elapsedMs / 1000),
  };
  return { metrics, personMs, elapsedMs };
}

export function sessionMetrics(entries: TimeEntry[], now: number): TimeMetrics {
  return sessionSummary(entries, now).metrics;
}

export interface PreparedTimeMetrics {
  ready: boolean;
  running: boolean;
  at: (now: number) => TimeMetrics;
}

// Parse/sort history once per snapshot, not on every animation/clock tick. After
// as_of, only genuinely open rows can accrue time; stopped legacy rows cannot.
export function prepareLiveMetrics(base: TimeMetrics, entries: TimeEntry[], asOf: number, complete: boolean): PreparedTimeMetrics {
  const before = sessionSummary(entries, asOf);
  const observed = before.metrics;
  const ready = complete && observed.session_count === base.session_count && observed.person_seconds === base.person_seconds &&
    observed.elapsed_seconds === base.elapsed_seconds && observed.active_session_count === base.active_session_count;
  const byUser = new Map<string, number>();
  for (const entry of entries) {
    const start = timestamp(entry.startedAt);
    if (entry.stoppedAt || start === null) continue;
    byUser.set(entry.userId, Math.min(byUser.get(entry.userId) ?? Infinity, Math.max(asOf, start)));
  }
  const starts = [...byUser.values()];
  const earliest = Math.min(...starts);
  return { ready, running: starts.length > 0, at(now) {
    if (!ready || !starts.length) return base;
    const advance = starts.reduce((sum, start) => sum + Math.max(0, now - start), 0);
    const elapsed = Math.max(0, now - earliest);
    return { ...base,
      person_seconds: base.person_seconds + Math.floor((before.personMs + advance) / 1000) - observed.person_seconds,
      elapsed_seconds: base.elapsed_seconds + Math.floor((before.elapsedMs + elapsed) / 1000) - observed.elapsed_seconds,
    };
  } };
}

export function liveMetrics(base: TimeMetrics, entries: TimeEntry[], asOf: number, now: number, complete: boolean): TimeMetrics {
  return prepareLiveMetrics(base, entries, asOf, complete).at(now);
}

export function canAdvanceMetrics(base: TimeMetrics, entries: TimeEntry[], asOf: number, complete: boolean) {
  return prepareLiveMetrics(base, entries, asOf, complete).ready;
}

export function sessionSeconds(entry: TimeEntry, now: number): number | null {
  const start = timestamp(entry.startedAt);
  const stop = entry.stoppedAt ? timestamp(entry.stoppedAt) : now;
  if (start === null || stop === null || stop < start) return null;
  return Math.max(0, (Math.min(stop, now) - start) / 1000);
}

export function orderedSessions(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => (timestamp(a.startedAt) ?? Infinity) - (timestamp(b.startedAt) ?? Infinity) || a.id.localeCompare(b.id));
}

export function sameSubtaskStates(a: { id: string; status: string }[], b: { id: string; status: string }[]) {
  if (a.length !== b.length) return false;
  const states = new Map(b.map(row => [row.id, row.status]));
  return states.size === b.length && new Set(a.map(row => row.id)).size === a.length && a.every(row => states.get(row.id) === row.status);
}

export const statusEvents = (events: LifecycleEvent[], subtaskId: string | null) => events.filter(event =>
  event.subtask_id === subtaskId && (event.event_type === (subtaskId ? 'subtask.created' : 'task.created') ||
    event.event_type === (subtaskId ? 'subtask.status_changed' : 'task.status_changed')));

export function journeyMatchesTarget(page: TaskJourney, taskId: string) {
  return page.task_id === taskId && page.items.every(event => event.task_id === taskId);
}

export function sessionsMatchTarget(entries: TimeEntry[], taskId: string, tenantId: string | null, childIds: Set<string>) {
  return entries.every(entry => entry.tenantId === tenantId && (
    entry.taskId === taskId && !entry.subtaskId || !entry.taskId && Boolean(entry.subtaskId && childIds.has(entry.subtaskId))));
}
