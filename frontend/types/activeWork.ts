export interface WorkSession {
  id: string; entry_id: string; status: 'RUNNING' | 'PAUSED' | 'STOPPED';
  task_id: string; subtask_id: string | null; project_name: string; task_title: string;
  subtask_title: string | null; subtask_status: string; started_at: string; stopped_at: string | null;
  running_since: string | null; active_seconds: number; paused_seconds: number;
  range_active_seconds: number; range_paused_seconds: number; subtask_total_seconds: number;
  intervals: { id: string; started_at: string; ended_at: string | null; active_seconds: number; corrected: boolean; paused_seconds?: number; paused_until?: string | null }[];
  timeline: { event: string; at: string }[];
}
export interface WorkSnapshot {
  user_id: string; tenant_id: string;
  items: WorkSession[]; server_time: string; limit: number; running_count: number; next_offset: number | null;
}
