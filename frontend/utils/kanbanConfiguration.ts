export const STATUS_CONFIGURATION_EVENT = 'task-statuses-updated';
export const configurationStorageKey = (tenantId: string) => `zea.kanban.configuration:${tenantId}`;

export function groupKanbanTasks<T extends { status: string; customStatusId?: string | null }>(tasks: T[]) {
  const grouped = new Map<string, T[]>();
  for (const task of tasks) {
    const key = task.customStatusId || task.status;
    const items = grouped.get(key);
    if (items) items.push(task); else grouped.set(key, [task]);
  }
  return grouped;
}

export type StatusConfiguration = {
  workflow_behavior?: 'PENDING' | 'ACTIVE' | 'HOLD' | 'COMPLETED';
  id: string; code: string; system_name: string; display_label: string; description: string;
  color: string; icon: string; is_system: boolean; is_active: boolean; kanban_visible: boolean;
  sort_order: number; legacy_status: string | null; task_count: number; isNew?: boolean;
  default_sort_order?: number; default_display_label?: string; default_color?: string; default_icon?: string;
};

export const onBoard = (status: StatusConfiguration) => status.is_system || (status.is_active && status.kanban_visible);

export function moveStatus<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

// Reset presentation only. Internal identities, names, descriptions, activation
// and task references are retained, including unsaved custom status drafts.
export function defaultArrangement(statuses: StatusConfiguration[]): StatusConfiguration[] {
  return statuses.map(status => ({ ...status,
    display_label: status.is_system ? status.default_display_label || status.system_name : status.system_name,
    color: status.default_color || '#6366f1', icon: status.default_icon || (status.is_system ? 'default' : 'circle'),
    kanban_visible: true,
  })).sort((a, b) => (a.default_sort_order ?? 1000 + a.sort_order) - (b.default_sort_order ?? 1000 + b.sort_order));
}

export function announceConfiguration(tenantId: string) {
  window.dispatchEvent(new CustomEvent(STATUS_CONFIGURATION_EVENT, { detail: { tenantId } }));
  try { localStorage.setItem(configurationStorageKey(tenantId), `${Date.now()}:${crypto.randomUUID()}`); }
  catch { /* Local refetch remains available when browser storage is unavailable. */ }
}

// These example cards never use task IDs, counts, titles or assignees from the API.
export const sampleQuests = (index: number) => [
  { title: 'Scout the crystal caverns', description: 'Chart a safe route for your guild.', priority: 'High' },
  { title: 'Restore the watchtower', description: 'Gather supplies before the next expedition.', priority: 'Medium' },
].slice(0, index % 3 === 0 ? 2 : index % 3 === 1 ? 1 : 0);
