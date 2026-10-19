import type { TimeMetrics } from './taskLifecycle';

export interface ReportPerson { id: string; name: string | null }
export interface ExecutionEntity {
  id: string; title: string | null; status: string | null;
  creator: ReportPerson | null; assignee: ReportPerson | null;
  created_at: string | null; creation_source: 'task_record' | 'captured_event' | 'not_recorded';
  first_started_at: string | null; first_session_started_at: string | null;
  last_completed_at: string | null; final_completed_at: string | null;
  final_completion_source: 'captured_event' | 'task_record' | 'not_recorded';
  completion_count: number; reopened_count: number; event_counts: Record<string, number>;
  time: TimeMetrics; linked_paused_seconds: number; unresolved_pause_count: number; deleted: boolean;
}
export interface ExecutionReport {
  task_id: string; as_of: string; history_complete: boolean; capture_started_at: string;
  retained_sessions_only: boolean; deleted_session_count: number;
  task: ExecutionEntity; subtasks: ExecutionEntity[];
  direct: TimeMetrics; children: TimeMetrics; aggregate: TimeMetrics;
}
export interface ReportCompletion {
  id: string; task_id: string; subtask_id: string; attempt_number: number;
  description: string; status: string; approval_required: boolean;
  submitted_by: ReportPerson | null; created_at: string;
  reviewed_by: ReportPerson | null; reviewed_at: string | null; review_reason: string | null;
}
export type EvidenceSource = 'completion' | 'media' | 'media_file' | 'unverified';
export interface ReportEvidence {
  id: string; source: EvidenceSource; task_id: string; subtask_id: string | null;
  submission_id: string | null; filename: string | null; mime_type: string | null; size_bytes: number | null;
  uploaded_by: ReportPerson | null; uploaded_at: string | null;
  availability: 'available' | 'missing' | 'deleted' | 'unverified' | 'provider_check_required';
  can_preview: boolean; can_download: boolean;
}
export interface ReportPage<T> { items: T[]; next_after_id: string | null }
export type ReportPageKind = 'completions' | 'completion' | 'linked';
