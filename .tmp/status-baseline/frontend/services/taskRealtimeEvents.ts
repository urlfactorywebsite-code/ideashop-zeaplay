export const TASK_REALTIME_EVENT = 'zea:task-realtime';
export interface TaskRealtimeNotice {
  userId: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

// Reuse the task page's existing socket; local readers must not open another one.
export function publishTaskRealtime(notice: TaskRealtimeNotice) {
  window.dispatchEvent(new CustomEvent(TASK_REALTIME_EVENT, { detail: notice }));
}
