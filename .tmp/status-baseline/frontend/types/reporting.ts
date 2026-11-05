import type { TaskStatus } from '../types';

export type ReportSection = 'overview' | 'employees' | 'tasks' | 'statuses' | 'projects' | 'activity' | 'time';
export type ReportPreset = 'today' | 'yesterday' | 'last7' | 'week' | 'month' | 'lastMonth' | 'custom';
export interface ReportingFilters {
  from: string;
  to: string;
  timezone: string;
  employee_id?: string;
  project_id?: string;
  status?: TaskStatus;
  search?: string;
}
export interface ReportingQuery extends ReportingFilters {
  page?: number;
  page_size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  grouping?: 'daily' | 'weekly' | 'monthly';
  group_by?: 'employee' | 'task' | 'subtask' | 'project' | 'daily';
}
export interface ReportingMeta {
  as_of: string;
  timezone: string;
  from: string;
  to: string;
  start_at?: string;
  end_at?: string;
  date_semantics: string;
  counting_unit?: string;
  filters?: Partial<ReportingFilters>;
  limitations?: string[];
}
export interface ReportingPerson { id: string; name: string }
export type ReportingValue = string | number | boolean | null | ReportingPerson[] | undefined;
export interface ReportingRow { [key: string]: ReportingValue }
export interface ReportingPage {
  items: ReportingRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  meta: ReportingMeta;
  summary?: Record<string, number>;
  totals?: Record<string, number>;
  series?: ReportingRow[];
}
export interface ReportingOptions {
  employees: { id: string; name: string; email: string; status: string }[];
  projects: { id: string; name: string; status: string }[];
  statuses: TaskStatus[];
  timezone: string;
  employees_total: number;
  projects_total: number;
  meta: ReportingMeta;
}
export interface ReportingOverview {
  metrics: Record<string, number>;
  status_distribution: { status: TaskStatus; count: number; percentage: number }[];
  employee_workload: { employee_id: string; name: string; assigned_parent_tasks: number }[];
  project_completion: { project_id: string; name: string; total_tasks: number; completed_tasks: number; completion_percentage: number }[];
  meta: ReportingMeta;
}
export interface ReportingDetail {
  employee?: ReportingRow;
  project?: ReportingRow;
  tasks: ReportingPage;
  subtasks?: ReportingPage;
  employees?: ReportingPage;
  projects?: ReportingRow[];
  statuses?: ReportingRow[];
  projects_total?: number;
  projects_truncated?: boolean;
  meta: ReportingMeta;
}
