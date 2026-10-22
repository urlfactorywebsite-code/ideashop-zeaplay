export const TASK_SECTIONS = [
  { key: 'list', pageId: 'tasks.list', label: 'All Tasks', to: '/tasks' },
  { key: 'kanban', pageId: 'kanban', label: 'Kanban Board', to: '/tasks/kanban' },
  { key: 'gantt', pageId: 'gantt', label: 'Gantt Chart', to: '/tasks/gantt' },
  { key: 'calendar', pageId: 'calendar', label: 'Calendar', to: '/tasks/calendar' },
] as const;

export function taskSectionForPath(path: string) {
  return TASK_SECTIONS.find(section => section.to === path.replace(/\/+$/, ''));
}

export function updateTaskFilter(search: string, key: string, value: string) {
  const params = new URLSearchParams(search);
  if (!value || value === 'ALL') params.delete(key);
  else params.set(key, value);
  return params.toString();
}

export function legacyTaskDetailSearch(path: string, search: string): string | undefined {
  const match = /^\/tasks\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i.exec(path);
  if (!match) return undefined;
  const params = new URLSearchParams(search);
  params.set('taskId', match[1]);
  return params.toString();
}
