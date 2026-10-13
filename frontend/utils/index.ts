import { RecurrenceRule } from '../types';

/**
 * Formats an ISO date string into a more readable format (e.g., "Oct 1, 2023" or "Oct 1, 2023 at 3:30 PM").
 * @param dateString The date string to format.
 * @param includeTime Whether to include time in the format.
 * @returns A formatted date string or 'N/A' if the input is invalid.
 */
const hasTimezoneInfo = (value: string) => /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);

const parseDateString = (dateString?: string | null) => {
  if (!dateString) {
    return null;
  }
  const trimmed = dateString.trim();
  if (!trimmed) {
    return null;
  }
  const withT = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const normalized = hasTimezoneInfo(withT) ? withT : `${withT}Z`;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return new Date(dateString);
};

export const formatDate = (dateString: string | null | undefined, includeTime: boolean = false): string => {
  if (!dateString) {
    return 'N/A';
  }
  try {
    const date = parseDateString(dateString);
    if (!date) {
      return 'Invalid Date';
    }
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    if (includeTime) {
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  } catch (error) {
    console.error("Error formatting date:", error);
    return 'Invalid Date';
  }
};

/**
 * Converts a RecurrenceRule enum value into a human-readable string.
 * @param rule The recurrence rule.
 * @returns A formatted string (e.g., "After Completion").
 */
export const formatRecurrenceRule = (rule: RecurrenceRule): string => {
    if (!rule || rule === RecurrenceRule.NONE) return 'None';
    return rule.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

/**
 * Converts a TaskStatus string value into a human-readable string.
 * @param status The task status.
 * @returns A formatted string (e.g., "In Progress").
 */
// FIX: Changed parameter type from the non-existent 'TaskStatus' to 'string' to fix the compilation error.
export const formatTaskStatus = (status: string): string => {
    if (!status) return 'Unknown';
    return status
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

/**
 * Returns a human-readable string representing how long ago a date occurred.
 * @param dateString The date string to compare.
 * @returns A string like "2 hours ago" or "just now".
 */
export const timeAgo = (dateString: string): string => {
    const now = new Date();
    const date = parseDateString(dateString);
    if (!date || Number.isNaN(date.getTime())) {
        return 'unknown';
    }
    const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

    if (diffInSeconds < 60) return 'just now';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
};



