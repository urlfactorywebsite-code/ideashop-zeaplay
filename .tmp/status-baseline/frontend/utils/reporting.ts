import { DateTime } from 'luxon';
import { TaskStatus } from '../types';
import type { ReportingFilters, ReportingQuery, ReportPreset, ReportSection } from '../types/reporting';

export const reportSections: ReportSection[] = ['overview', 'employees', 'tasks', 'statuses', 'projects', 'activity', 'time'];
export const reportTimezone = (preferred?: string): string => {
  try {
    if (preferred && DateTime.now().setZone(preferred).isValid) return preferred;
  } catch { /* Invalid legacy timezone uses the documented fallback. */ }
  return 'UTC';
};

export function reportingDates(preset: ReportPreset, timezone: string, now = new Date()) {
  const today = DateTime.fromJSDate(now, { zone: reportTimezone(timezone) }).startOf('day');
  let from = today;
  let to = today;
  if (preset === 'yesterday') from = to = today.minus({ days: 1 });
  if (preset === 'last7') from = today.minus({ days: 6 });
  if (preset === 'week') from = today.startOf('week');
  if (preset === 'month') from = today.startOf('month');
  if (preset === 'lastMonth') { from = today.minus({ months: 1 }).startOf('month'); to = from.endOf('month'); }
  return { from: from.toISODate()!, to: to.toISODate()! };
}

export function validateReportingDates(from: string, to: string, timezone: string): string | null {
  const start = DateTime.fromISO(from, { zone: timezone });
  const end = DateTime.fromISO(to, { zone: timezone });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !start.isValid || !end.isValid)
    return 'Choose a valid start and end date.';
  if (end < start) return 'End date must be on or after start date.';
  return null;
}

export function previousReportingPeriod(filters: ReportingFilters): ReportingFilters {
  const start = DateTime.fromISO(filters.from, { zone: filters.timezone }).startOf('day');
  const end = DateTime.fromISO(filters.to, { zone: filters.timezone }).startOf('day');
  const days = Math.round(end.diff(start, 'days').days) + 1;
  return { ...filters, from: start.minus({ days }).toISODate()!, to: start.minus({ days: 1 }).toISODate()! };
}

export function reportingFiltersFromUrl(params: URLSearchParams, timezone: string, now = new Date()): ReportingFilters {
  const zone = reportTimezone(params.get('timezone') || timezone);
  const defaults = reportingDates('month', zone, now);
  const status = params.get('status') as TaskStatus;
  return {
    from: params.get('from') || defaults.from,
    to: params.get('to') || defaults.to,
    timezone: zone,
    employee_id: params.get('employee_id') || undefined,
    project_id: params.get('project_id') || undefined,
    status: Object.values(TaskStatus).includes(status) ? status : undefined,
    search: params.get('search') || undefined,
  };
}

export function reportingSearchParams(query: ReportingQuery, section: ReportSection, preset: ReportPreset) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  params.set('tab', section);
  params.set('preset', preset);
  return params;
}

export function reportingDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 3600)}h ${Math.floor(total / 60) % 60}m`;
}

export function reportError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  if ([401, 403, 404].includes(response?.status || 0)) return 'This report is not accessible with your current permissions.';
  if (typeof response?.data?.detail === 'string') return response.data.detail;
  return 'Unable to load the report. Please try again.';
}

export const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function reportingTaskLink(search: string, row: { id?: unknown; task_id?: unknown }) {
  const params = new URLSearchParams(search);
  params.set('taskId', String(row.task_id || row.id));
  if (row.task_id) params.set('subtaskId', String(row.id));
  else params.delete('subtaskId');
  return { pathname: '/reports', search: params.toString() };
}
