import { DateTime } from 'luxon';

/** Task timestamps without an offset are stored as UTC by the existing API. */
export function taskInstant(value: string | Date): DateTime {
  return value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value.replace(' ', 'T'), { zone: 'utc' });
}

/** Grid dates represent civil dates, not instants in the browser's timezone. */
export function calendarDateKey(value: Date): string {
  return DateTime.fromJSDate(value).toISODate()!;
}

export function taskDateKey(value: string, zone: string): string {
  return taskInstant(value).setZone(zone).toISODate() || '';
}

export function calendarToday(zone: string, now = new Date()): Date {
  const day = DateTime.fromJSDate(now, { zone });
  return new Date(day.year, day.month - 1, day.day, 12);
}

export function calendarDateInstant(day: Date, zone: string): string {
  return taskDateTimeInstant(calendarDateKey(day), '00:00', zone);
}

/** A calendar form time belongs to the displayed calendar's timezone. */
export function taskDateTimeInstant(day: string, time: string, zone: string): string {
  return DateTime.fromISO(`${day}T${time}`, { zone }).toUTC().toISO()!;
}

/** Civil-day offsets stay integral across daylight-saving transitions. */
export function taskDayNumber(value: string | Date, zone: string): number {
  const day = taskInstant(value).setZone(zone);
  return Date.UTC(day.year, day.month - 1, day.day) / 86_400_000;
}

export function taskTimeline(task: { createdAt: string; dueAt?: string | null }, zone: string) {
  const start = taskDayNumber(task.createdAt, zone);
  const due = task.dueAt ? taskDayNumber(task.dueAt, zone) : start;
  return { start, end: Math.max(start, due), duration: Math.max(1, due - start + 1), reversed: due < start };
}
