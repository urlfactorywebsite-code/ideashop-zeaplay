import type { SubtaskStatus, TaskStatus, TimeEntry } from '../types';

// Phase 1 read DTOs deliberately retain the server's wire names.
export interface LifecycleEvent {
  id: number;
  task_id: string;
  subtask_id: string | null;
  time_entry_id: string | null;
  event_type: string;
  previous_status: string | null;
  new_status: string | null;
  actor_id: string | null;
  occurred_at: string;
  recorded_at: string;
  details: Record<string, unknown>;
}

export interface TaskJourney {
  task_id: string;
  created_by_id: string;
  created_at: string;
  status: TaskStatus;
  subtasks: { id: string; status: SubtaskStatus }[];
  capture_started_at: string;
  history_complete: boolean;
  items: LifecycleEvent[];
  next_after_id: number | null;
}

export interface TimeMetrics {
  session_count: number;
  active_session_count: number;
  raw_session_seconds: number;
  person_seconds: number;
  elapsed_seconds: number;
}

export interface TaskAnalytics {
  task_id: string;
  status: TaskStatus;
  as_of: string;
  parent: TimeMetrics;
  children: TimeMetrics;
  aggregate: TimeMetrics;
  subtasks: (TimeMetrics & { subtask_id: string; status: SubtaskStatus })[];
  history_complete: boolean;
  capture_started_at: string;
}

export interface TaskExecutionSessions {
  task_id: string;
  items: TimeEntry[];
  next_after_id: string | null;
}
