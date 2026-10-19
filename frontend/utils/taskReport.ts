import type { ExecutionEntity, ReportCompletion, ReportPerson } from '../types/taskReport';
import { timestamp } from './taskJourney';
import type { TimeEntry } from '../types';

export const reportName = (value: ReportPerson | null) => value ? value.name || `User ${value.id}` : 'Not recorded';
export const reportLabel = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
const fractionalPart = (value: string) => (value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0');
export const completionOrder = (rows: ReportCompletion[]) => [...rows].sort((a, b) =>
  (timestamp(a.created_at) ?? Infinity) - (timestamp(b.created_at) ?? Infinity) ||
  fractionalPart(a.created_at).localeCompare(fractionalPart(b.created_at)) || a.id.localeCompare(b.id));
export const safeFilename = (name: string | null) => name?.replace(/\\/g, '/').split('/').pop()?.replace(/[\r\n\x00-\x1f]/g, '') || 'evidence';
export const evidenceBytes = (bytes: number | null) => bytes === null ? 'Size not recorded'
  : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export function reportLifetime(row: Pick<ExecutionEntity, 'status' | 'created_at' | 'final_completed_at'>, asOf: string): number | null {
  const start = timestamp(row.created_at);
  const end = timestamp(['DONE', 'DEPLOYED'].includes(row.status || '') ? row.final_completed_at : asOf);
  return start !== null && end !== null && end >= start ? (end - start) / 1000 : null;
}

export function linkedPause(source: TimeEntry | undefined, next: TimeEntry, asOf: number): number | null {
  if (!source || source.stopReason !== 'paused' || source.userId !== next.userId || source.taskId !== next.taskId ||
    source.subtaskId !== next.subtaskId || !['resumed', 'restarted'].includes(next.startKind || '')) return null;
  const stop = timestamp(source.stoppedAt);
  const resume = timestamp(next.startedAt);
  return stop !== null && resume !== null && resume >= stop && resume <= asOf ? (resume - stop) / 1000 : null;
}
