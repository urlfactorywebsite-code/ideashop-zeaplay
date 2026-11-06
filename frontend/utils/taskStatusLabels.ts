import { CUSTOM_STATUS_NAMES, TaskStatus } from '../types';

export type StatusLabelEntry = {
  id: string; custom_status_id?: string | null; title: string; order: number;
  is_active?: boolean; kanban_visible?: boolean;
};

export function createStatusLabels(entries: StatusLabelEntry[] = []) {
  const names = new Map<string, string>();
  for (const entry of entries) {
    names.set(entry.id, entry.title);
    if (entry.custom_status_id) names.set(entry.custom_status_id, entry.title);
  }
  return (status: string, customStatusId?: string | null, fallback?: string | null): string => {
    if (customStatusId) return names.get(customStatusId) || fallback || customStatusId;
    return names.get(status) || fallback || CUSTOM_STATUS_NAMES[status as TaskStatus]?.name || status.replace(/_/g, ' ') || 'Unknown';
  };
}
