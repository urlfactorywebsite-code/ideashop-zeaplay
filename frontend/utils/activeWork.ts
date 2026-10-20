import type { WorkSession } from '../types/activeWork';
import { DateTime } from 'luxon';

export function workDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function sessionSeconds(session: WorkSession, elapsedSinceSnapshot: number): number {
  return session.active_seconds + (session.status === 'RUNNING' ? Math.max(0, elapsedSinceSnapshot) : 0);
}
export function workTimezone(preferred?: string): string {
  try { if (preferred) { new Intl.DateTimeFormat(undefined, { timeZone: preferred }); return preferred; } } catch { /* Legacy invalid profile timezone. */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function workRange(preset: string, from: string, to: string, now = new Date(), timezone = workTimezone()) {
  let start = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  let end = start.plus({ days: 1 });
  if (preset === 'yesterday') { end = start; start = start.minus({ days: 1 }); }
  if (preset === 'week') start = start.startOf('week');
  if (preset === 'custom') {
    if (!from || !to) throw new Error('Choose a start and end date.');
    start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
    end = DateTime.fromISO(to, { zone: timezone }).startOf('day').plus({ days: 1 });
  }
  if (!start.isValid || !end.isValid || start >= end) throw new Error('End date must be on or after start date.');
  return { from_at: start.toUTC().toISO(), to_at: end.toUTC().toISO() };
}
