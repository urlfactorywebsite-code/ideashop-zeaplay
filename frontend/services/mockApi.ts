 import axios, { AxiosInstance, AxiosHeaders } from 'axios';
import { TaskCategory } from '../types';
import type { PointsConfig } from '../utils/pointsConfigStorage';
import { normalizeMessage } from '../features/chat/utils/normalizeMessage';
import {
  User,
  Client,
  ClientCreatePayload,
  ClientListFilters,
  ClientListResponse,
  ClientStatus,
  ClientUpdatePayload,
  Contact,
  ContactCreatePayload,
  ContactListFilters,
  ContactListResponse,
  ContactStatus,
  ContactUpdatePayload,
  Project,
  ProjectCreatePayload,
  ProjectDashboardSubtask,
  ProjectDashboardTask,
  ProjectDashboardSummary,
  ProjectDashboardWorkload,
  ProjectListFilters,
  ProjectListResponse,
  ProjectMemberRole,
  ProjectTaskDashboardResponse,
  ProjectStatus,
  ProjectUpdatePayload,
  ProjectMembershipPayload,
  AvatarAsset,
  Task,
  Comment,
  Department,
  Role,
  UserStatus,
  Subtask,
  SubtaskDependency,
  SubtaskStatus,
  CompletionAttachment,
  CompletionSubmission,
  CompletionSubmissionStatus,
  SmtpConfig,
  KanbanColumn,
  ApiConfig,
  Achievement,
  Badge,
  BadgeProgress,
  BadgeRule,
  BadgeRuleConditions,
  BadgeRuleSet,
  Reward,
  Notification,
  TaskPriority,
  TaskStatus,
  Ticket,
  TicketApproval,
  TicketApprovalDecision,
  TicketApprovalStatus,
  TicketApprovalType,
  TicketApprovalActionPayload,
  TicketApprovalCycle,
  TicketApprovalCycleStatus,
  TicketApprovalItem,
  TicketApprovalItemStatus,
  TicketApprovalRequestPayload,
  TicketAuditLogPage,
  TicketClosePayload,
  TicketTimeline,
  PendingApprovalItem,
  TicketParticipant,
  TicketAttachment,
  TicketAttachmentConfirmRequest,
  TicketAttachmentPresignRequest,
  TicketAttachmentPresignResponse,
  TicketCreatePayload,
  TicketListFilters,
  TicketParticipantsUpdate,
  TicketPriority,
  TicketResolutionType,
  TicketStatus,
  TicketFollower,
  TicketStatusUpdatePayload,
  TicketStatusHistoryEntry,
  TicketTask,
  TicketTaskCreatePayload,
  TicketTaskPriority,
  TicketTaskStatus,
  TicketTaskUpdatePayload,
  TicketTaskSplitRequest,
  TicketTransferPayload,
  TicketUpdatePayload,
  TicketLinkedTask,
  TicketLinkedTaskCreatePayload,
  TicketLinkedTaskUpdatePayload,
  RecurrenceRule,
  NotificationType,
  NotificationEntityType,
  NotificationModule,
  NotificationPreference,
  DataExportScope,
  DataExportBundle,
  DataImportPayload,
    BackupUser,
  BackupTask,
  BackupTaskSubtask,
  BackupTaskComment,
  BackupNotification,
  BackupUserReward,
  BackupUserAchievement,
  BackupKanbanColumn,
  RewardIcon,
  RewardImageSource,
  RewardStatus,
  RewardListResponse,
  RewardClaim,
  RewardClaimStatus,
  RewardClaimListResponse,
  RewardLog,
  RewardLogListResponse,
  AuditActor,
  AuditEvent,
  AuditEventListResponse,
  AuditLog,
  AuditLogListResponse,
  AuditRetentionConfig,
  AuditRetentionApplyResponse,
  AchievementIcon,
  Level,
  Season,
  UserProgress,
  LevelNode,
  LevelEdge,
  LevelEvent,
  LevelPreviewResponse,
  LevelCreate,
  LevelUpdate,
  LevelRead,
  LevelNodeCreate,
  LevelNodeUpdate,
  LevelNodeRead,
  LevelEdgeCreate,
  LevelEdgeUpdate,
  LevelEdgeRead,
  LevelEventRead,
  RewardLogAction,
  RewardClaimUser,
  UserProgressCreate,
  UserProgressUpdate,
  UserProgressRead,
  TaskApprovalStatus,
  TaskPageResponse,
  TaskKanbanResponse,
  TaskSummary,
  TaskCalendarSummaryResponse,
  TaskTransferPayload,
  TaskTransferResponse,
  TaskTransferWorkflowDecision,
  TaskTransferWorkflowRead,
  TaskTransferWorkflowRequest,
  TimeEntry,
  TimeEntryStatus,
  ToolCategoryStatus,
  ToolCategory,
  ToolCategoryCreatePayload,
  ToolCategoryUpdatePayload,
  ToolCategoryListResponse,
  Tool,
  ToolCreatePayload,
  ToolUpdatePayload,
  ToolDecisionPayload,
  ToolListResponse,
  ToolFavoriteListResponse,
  ToolPricingType,
  ToolStatus,

  TaskTemplate,

  TaskTemplateAssignRequest,
  BearerTokenPreview,
  WebhookSubscription,
  WebhookCreatePayload,
  WebhookUpdatePayload,
  WebhookTestResult,
  MultipleSmtpConfig,
  EmailTemplate,
  OAuthConfig,
  ReleaseNotes,
  ReleaseNotesUpdate,
  FeatureFlag,
  FeatureFlagUpdate,
  ChatConversation,
  ChatConversationCreatePayload,
  ChatDirectoryPage,
  ChatDirectoryUser,
  ChatDirectCreatePayload,
  ChatAttachment,
  ChatMember,
  ChatMessage,
  ChatMessageCreatePayload,
  ChatMessagePage,
  ChatMessageSearchPage,
  ChatPinnedMessage,

  // Media types
  AvatarFinalizeRequest,
  AvatarFinalizeResponse,
  MediaConfirmRequest,
  MediaConfirmResponse,
  MediaItem,
  MediaListResponse,
  MediaPresignRequest,
  MediaPresignResponse,
  MediaProviderStatus,
  GoogleDriveOAuthStartResponse,
  MediaCategory,
  MediaSortOption,
  StorageProvider,
} from '../types';
import { storeTokens, getAccessToken, getRefreshToken, clearTokens } from './tokenStorage';
import { augmentTaskWithPoints } from '../utils/taskPoints';
import { AUTH_EXPIRED_EVENT } from '../utils/appEvents';
import {
  setProgress as setGlobalProgress,
  startProgressTask,
  startTask as startGlobalLoadingTask,
  stopTask as stopGlobalLoadingTask,
  updateProgressTask,
} from '../components/loading/loadingController';

declare module 'axios' {
  interface AxiosRequestConfig {
    showGlobalProgress?: boolean;
    globalProgressTaskId?: string;
  }

  interface InternalAxiosRequestConfig {
    showGlobalProgress?: boolean;
    globalProgressTaskId?: string;
  }
}

console.log('mockApi.ts: Setting API_BASE_URL');
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'https://todoplay.urlfactory.website/api'
).replace(/\/$/, '');
console.log('mockApi.ts: API_BASE_URL set to:', API_BASE_URL);
const NORMALIZED_API_BASE_URL = API_BASE_URL;
const TICKETS_BASE_PATH = '/tickets';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_CACHE_TTL_MS = 60000;
const DEFAULT_PERSISTED_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_STORAGE_PREFIX = `zea-play-cache:${encodeURIComponent(NORMALIZED_API_BASE_URL)}:`;
const responseCache = new Map<string, CacheEntry<unknown>>();
const storageAvailable =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

function buildStorageKey(key: string): string {
  return `${CACHE_STORAGE_PREFIX}${key}`;
}

function readPersistedCache<T>(key: string): CacheEntry<T> | null {
  if (!storageAvailable) {
    return null;
  }
  const storageKey = buildStorageKey(key);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.expiresAt !== 'number') {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return entry;
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
    }
    return null;
  }
}

function writePersistedCache<T>(key: string, value: T, ttlMs: number): void {
  if (!storageAvailable) {
    return;
  }
  const storageKey = buildStorageKey(key);
  try {
    const entry: CacheEntry<T> = { value, expiresAt: Date.now() + ttlMs };
    window.localStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
  }
}

function stableStringify(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  sortedKeys.forEach((key) => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}

function buildCacheKey(base: string, params?: Record<string, unknown>): string {
  if (!params) {
    return base;
  }
  return `${base}:${stableStringify(params)}`;
}

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) {
    const persisted = readPersistedCache<T>(key);
    if (!persisted) {
      return null;
    }
    responseCache.set(key, persisted);
    return persisted.value as T;
  }
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    const persisted = readPersistedCache<T>(key);
    if (!persisted) {
      return null;
    }
    responseCache.set(key, persisted);
    return persisted.value as T;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  const expiresAt = Date.now() + ttlMs;
  responseCache.set(key, { value, expiresAt });
  writePersistedCache(key, value, Math.max(ttlMs, DEFAULT_PERSISTED_CACHE_TTL_MS));
}

function invalidateCache(prefix: string): void {
  responseCache.forEach((_value, key) => {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  });
  if (!storageAvailable) {
    return;
  }
  const storagePrefix = buildStorageKey(prefix);
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey && storageKey.startsWith(storagePrefix)) {
        window.localStorage.removeItem(storageKey);
      }
    }
  } catch {
  }
}

type ApiUser = {
  id: string;
  name: string;
  email: string;
  employer_id?: string;
  role: Role;
  status: string;
  department?: { id: string; name: string } | null;
  department_id?: string | null;
  manager_id?: string | null;
  manager_email?: string | null;
  shift_name?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  morning_break_start?: string | null;
  morning_break_end?: string | null;
  lunch_break_start?: string | null;
  lunch_break_end?: string | null;
  evening_break_start?: string | null;
  evening_break_end?: string | null;
  title?: string | null;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
  notes?: string | null;
  skills?: string[] | null;
  projects?: string[] | null;
  avatar_asset_id?: string | null;
  avatar_frame?: string | null;
  avatar_asset?: ApiAvatarAsset | null;
  avatar_url?: string | null;
  profile_image_key?: string | null;
  profile_image_url?: string | null;
  points: number;
  overall_xp_points?: number;
  claimed_xp_points?: number;
  tasks_created: number;
  tasks_completed: number;
  clarity_scores: number[];
  claimed_reward_ids: string[];
  unlocked_achievement_ids: string[];
  created_at: string;
  updated_at: string;
};

type ApiClient = {
  id: string;
  tenant_id: string;
  company_name: string;
  normalized_company_name: string;
  gst_number?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  notes?: string | null;
  status: ClientStatus;
  created_by_id?: string | null;
  updated_by_id?: string | null;
  archived_by_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ApiClientListResponse = {
  items: ApiClient[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

type ApiContactClientSummary = {
  id: string;
  company_name: string;
  status: ClientStatus;
  is_primary: boolean;
};

type ApiContact = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name?: string | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  status: ContactStatus;
  clients: ApiContactClientSummary[];
  created_by_id?: string | null;
  updated_by_id?: string | null;
  archived_by_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ApiContactListResponse = {
  items: ApiContact[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

type ApiProjectClientSummary = {
  id: string;
  company_name: string;
  status: ClientStatus;
};

type ApiProjectMember = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: ProjectMemberRole;
  user_role: Role;
  status: UserStatus;
};

type ApiProject = {
  id: string;
  tenant_id: string;
  client_id: string;
  name: string;
  normalized_name: string;
  description?: string | null;
  status: ProjectStatus;
  start_date?: string | null;
  end_date?: string | null;
  client: ApiProjectClientSummary;
  members: ApiProjectMember[];
  task_count: number;
  subtask_approval_required_default?: boolean;
  created_by_id?: string | null;
  updated_by_id?: string | null;
  archived_by_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ApiProjectListResponse = {
  items: ApiProject[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

type ApiProjectDashboardSubtask = {
  id: string;
  title: string;
  completed: boolean;
  assigned_to_id?: string | null;
  assigned_user_name?: string | null;
  status: SubtaskStatus;
  sort_order: number;
  dependency_ids?: string[];
  dependent_ids?: string[];
  dependency_state?: 'READY' | 'WAITING' | 'BLOCKED';
  branch_key?: string | null;
  total_tracked_seconds: number;
  active_timer_user_ids?: string[];
  completion_approval_required: boolean;
  latest_submission_status?: CompletionSubmissionStatus | null;
  force_started: boolean;
};

type ApiProjectDashboardTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  derived_status: TaskStatus;
  status_source: 'manual_override' | 'subtask_rollup' | 'task_status';
  priority: TaskPriority;
  assigned_to_id?: string | null;
  assigned_user_name?: string | null;
  project_id: string;
  due_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  progress_percent: number;
  completed_subtasks: number;
  total_subtasks: number;
  total_tracked_seconds: number;
  active_timer_user_ids?: string[];
  subtasks: ApiProjectDashboardSubtask[];
};

type ApiProjectDashboardWorkload = {
  user_id: string;
  name: string;
  role: ProjectMemberRole;
  assigned_tasks: number;
  assigned_subtasks: number;
  actionable_subtasks: number;
  waiting_subtasks: number;
  blocked_subtasks: number;
  in_review_subtasks: number;
  completed_subtasks: number;
  total_tracked_seconds: number;
};

type ApiProjectDashboardSummary = {
  task_total: number;
  subtask_total: number;
  completed_subtasks: number;
  progress_percent: number;
  total_tracked_seconds: number;
  active_timer_count: number;
  status_counts: Record<string, number>;
  derived_status_counts: Record<string, number>;
  subtask_status_counts: Record<string, number>;
  priority_counts: Record<string, number>;
  workload: ApiProjectDashboardWorkload[];
};

type ApiProjectTaskDashboardResponse = {
  project: ApiProject;
  summary: ApiProjectDashboardSummary;
  items: ApiProjectDashboardTask[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  status_policy: string;
};

type ApiAvatarAsset = {
  id: string;
  name: string;
  storage_type: 'file' | 'data_url' | 'external_url';
  url?: string | null;
  data_url?: string | null;
  external_url?: string | null;
  is_default: boolean;
  mime_type?: string | null;
  created_by_id?: string | null;
  created_at: string;
  updated_at: string;
};

type ApiCompletionAttachment = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  checksum_sha256: string;
  created_at: string;
};

type ApiCompletionSubmission = {
  id: string;
  tenant_id: string;
  task_id: string;
  subtask_id: string;
  submitted_by_id?: string | null;
  description: string;
  description_word_count: number;
  status: CompletionSubmissionStatus;
  approval_required: boolean;
  attempt_number: number;
  reviewed_by_id?: string | null;
  reviewed_at?: string | null;
  review_reason?: string | null;
  created_at: string;
  attachments?: ApiCompletionAttachment[];
};

type ApiTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  project_id?: string | null;
  project?: {
    id: string;
    name: string;
    client_id: string;
    client_name?: string | null;
    status: ProjectStatus;
  } | null;
  assigned_to_ids?: string[] | null;
  assigned_to_id?: string | null;
  follower_ids?: string[] | null;
  task_group_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  completed_at?: string | null;
  recurrence_rule: RecurrenceRule;
  recurring_task_id: string | null;
  clarity_rating: number | null;
  attachments: string[];
  estimated_hours: number | null;
  tags: string[];
  total_tracked_seconds?: number;
  subtask_approval_required?: boolean | null;
  subtasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    assigned_to_id?: string | null;
    assigned_user?: User | null;
    status?: SubtaskStatus;
    sort_order?: number;
    total_tracked_seconds?: number;
    dependency_ids?: string[];
    dependent_ids?: string[];
    dependencies?: Array<{
      id: string;
      task_id: string;
      subtask_id: string;
      depends_on_subtask_id: string;
      dependency_order: number;
      branch_key?: string | null;
      created_at: string;
    }>;
    dependency_state?: 'READY' | 'WAITING' | 'BLOCKED';
    completion_approval_required?: boolean;
    latest_completion_submission?: ApiCompletionSubmission | null;
    completion_submissions?: ApiCompletionSubmission[];
  }>;
};

type ApiTaskPageResponse = {
  items: ApiTask[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  status_counts: Record<string, number>;
  next_cursor?: string | null;
  has_more?: boolean;
};

type ApiTimeEntry = {
  id: string;
  tenant_id: string;
  user_id: string;
  task_id?: string | null;
  subtask_id?: string | null;
  started_at: string;
  stopped_at?: string | null;
  duration_seconds?: number | null;
  status: TimeEntryStatus;
  note?: string | null;
  original_started_at?: string | null;
  original_stopped_at?: string | null;
  original_duration_seconds?: number | null;
  correction_reason?: string | null;
  corrected_by_id?: string | null;
  corrected_at?: string | null;
};

type ApiTaskCalendarDaySummary = {
  date: string;
  total: number;
  completed: number;
  overdue: number;
  urgent: number;
  high: number;
  medium: number;
  low: number;
  due_soon: number;
};

type ApiTaskCalendarSummaryResponse = {
  start_date: string;
  end_date: string;
  days: ApiTaskCalendarDaySummary[];
};

type ApiTaskSummaryResponse = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assigned_to_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
};

type ApiTaskKanbanColumn = {
  status: TaskStatus;
  title: string;
  order: number;
  count: number;
  items: ApiTask[];
};

type ApiTaskKanbanResponse = {
  columns: ApiTaskKanbanColumn[];
};

type ApiTaskTransferPayload = {
  from_user_id: string;
  to_user_id: string;
  statuses: TaskStatus[];
};

type ApiTaskTransferResponse = {
  from_user_id: string;
  to_user_id: string;
  statuses: TaskStatus[];
  updated_count: number;
};

type ApiTaskTransferWorkflowRequest = {
  to_user_id: string;
  note?: string | null;
};

type ApiTaskTransferWorkflowDecision = {
  decision: 'approved' | 'rejected';
  comment?: string | null;
};

type ApiTaskTransferWorkflowRead = {
  id: string;
  task_id: string;
  from_user_id?: string | null;
  to_user_id: string;
  requested_by_id: string;
  approved_by_id?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note?: string | null;
  created_at: string;
  acted_at?: string | null;
};

type ApiTicket = {
  id: string;
  tenant_id: string;
  department_id?: string | null;
  created_by: string;
  owner_id?: string | null;
  assigned_user_id?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  due_at?: string | null;
  sla_hours?: number | null;
  approval_status?: TaskApprovalStatus | null;
  approval_enabled?: boolean;
  approval_type?: string | null;
  min_approvals?: number | null;
  approval_deadline?: string | null;
  approval_approver_ids?: string[] | null;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
  first_response_due_at?: string | null;
  resolution_due_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  resolution_type?: TicketResolutionType | null;
  created_at: string;
  updated_at: string;
  status_history?: ApiTicketStatusHistory[];
  approval_cycles?: ApiTicketApprovalCycle[];
  tasks?: ApiTicketTask[];
};

type ApiTicketStatusHistory = {
  id: string;
  ticket_id: string;
  from_status?: string | null;
  to_status: string;
  actor_user_id?: string | null;
  moved_at_utc: string;
  metadata_json?: Record<string, unknown> | null;
};

type ApiTicketApprovalItem = {
  id: string;
  approver_user_id: string;
  message?: string | null;
  status: TicketApprovalItemStatus;
  acted_at_utc?: string | null;
  order_index?: number | null;
};

type ApiTicketApprovalCycle = {
  id: string;
  ticket_id: string;
  approval_type: TicketApprovalType;
  deadline_utc?: string | null;
  attempts_left: number;
  status: TicketApprovalCycleStatus;
  requested_by: string;
  requested_at_utc: string;
  completed_at_utc?: string | null;
  approvers: ApiTicketApprovalItem[];
};

type ApiTicketTask = {
  id: string;
  ticket_id: string;
  title: string;
  description: string;
  status: TicketTaskStatus;
  assigned_to?: string | null;
  created_by: string;
  due_at_utc?: string | null;
  priority: TicketTaskPriority;
  points: number;
  completed_at_utc?: string | null;
  created_at_utc: string;
  updated_at_utc: string;
};

type ApiTicketLinkedTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assigned_to_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
  completed_at?: string | null;
  ticket_id?: string | null;
  approval_required?: boolean;
  approval_status?: TaskApprovalStatus;
  approver_id?: string | null;
};

type ApiTicketAuditLog = {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_user_id?: string | null;
  created_at_utc: string;
  summary: string;
  payload_json?: Record<string, unknown> | null;
};

type ApiTicketAuditLogPage = {
  items: ApiTicketAuditLog[];
  total: number;
  page: number;
  page_size: number;
};

type ApiTicketTimelineStage = {
  stage: string;
  entry_time?: string | null;
  exit_time?: string | null;
  time_spent_seconds?: number | null;
};

type ApiTicketTimeline = {
  stages: ApiTicketTimelineStage[];
  total_resolution_seconds?: number | null;
  total_resolution_label?: string | null;
};

type ApiTicketFollower = {
  user_id: string;
};

type ApiTicketApprovalUser = {
  user_id: string;
  decision: TicketApprovalDecision;
  comment?: string | null;
  decided_at?: string | null;
  sequence_order?: number | null;
};

type ApiTicketApproval = {
  id: string;
  ticket_id: string;
  attempt_no: number;
  approval_type: TicketApprovalType;
  min_approvals: number;
  status: TicketApprovalStatus;
  requested_by: string;
  approval_deadline?: string | null;
  created_at: string;
  updated_at: string;
  approvers: ApiTicketApprovalUser[];
};

type ApiTicketActivity = {
  id: string;
  ticket_id: string;
  event_type: string;
  payload?: Record<string, unknown> | null;
  actor_id?: string | null;
  created_at: string;
};

type ApiTicketAttachment = {
  id: string;
  ticket_id: string;
  tenant_id: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
};

type ApiTicketParticipant = {
  user_id: string;
  role: string;
};

type ApiLeaderboardTask = {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assigned_to_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
  completed_at?: string | null;
  clarity_rating?: number | null;
};

type ApiComment = {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type ApiDepartment = {
  id: string;
  name: string;
};

type ApiKanbanColumn = {
  id: string;
  title: string;
  order: number;
  pipeline_id?: string;
};

type ApiSmtpConfig = {
  host: string;
  port: number;
  username: string;
  password?: string | null;
  encryption: string;
};

type ApiPointsTableConfig = {
  id: number;
  points_config?: PointsConfig | null;
  task_creation_points?: number | null;
  clarity_points_per_star?: number | null;
  manager_overdue_penalty?: number | null;
  created_at?: string;
  updated_at?: string;
};

type PointsTableConfig = {
  pointsConfig: PointsConfig | null;
  taskCreationPoints: number | null;
  clarityPointsPerStar: number | null;
  managerOverduePenalty: number | null;
};

type ApiTokenRequest = {
  label?: string | null;
  scopes?: string[];
  expires_in_minutes?: number | null;
};

type ApiTokenResponse = BearerTokenPreview;

type ApiWebhook = {
  id: string;
  name: string;
  url: string;
  subscribed_events: string[];
  is_enabled: boolean;
  secret?: string | null;
  custom_headers?: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

type ApiWebhookPayload = {
  name?: string;
  url?: string;
  subscribed_events?: string[];
  is_enabled?: boolean;
  custom_headers?: Record<string, string> | null;
};

type ApiWebhookTestResponse = {
  status_code?: number | null;
  response_body?: string | null;
  response_time_ms?: number | null;
  error_message?: string | null;
  delivered_at?: string | null;
};

type ApiBadgeRuleConditions = {
  priority?: string[] | null;
  assigned_to?: string | null;
  created_by?: string | null;
  project_id?: string | null;
  pipeline_id?: string | null;
};

type ApiBadgeRuleCount = {
  type: string;
  value: number;
};

type ApiBadgeRuleTimeWindow = {
  value: number;
  unit: string;
};

type ApiBadgeRule = {
  entity: string;
  event: string;
  conditions?: ApiBadgeRuleConditions | null;
  count: ApiBadgeRuleCount;
  time_window?: ApiBadgeRuleTimeWindow | null;
  negative?: boolean;
};

type ApiBadgeRuleSet = {
  operator: 'AND' | 'OR';
  rules: ApiBadgeRule[];
};

type ApiBadge = {
  id: string;
  name: string;
  description: string;
  tier: string;
  tier_group?: string | null;
  tier_order: number;
  bonus_xp: number;
  image_url?: string | null;
  image_asset_path?: string | null;
  state: string;
  is_system: boolean;
  rules?: ApiBadgeRuleSet | null;
  created_at: string;
  updated_at: string;
};

type ApiBadgeProgress = {
  id: string;
  name: string;
  description: string;
  tier: string;
  tier_group?: string | null;
  tier_order: number;
  bonus_xp: number;
  image_url?: string | null;
  state: string;
  is_system: boolean;
  status: string;
  progress_percent: number;
  earned_at?: string | null;
};

type ApiReward = {
  id?: string;
  title: string;
  description: string;
  image_source: RewardImageSource;
  image_ref?: string | null;
  image_url?: string | null;
  xp_required: number;
  dept_whitelist?: string[] | null;
  auto_redeem: boolean;
  allow_multiple_claims?: boolean;
  expires_at?: string | null;
  status?: RewardStatus;
  created_by_id?: string | null;
  updated_by_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ApiRewardListResponse = {
  items: ApiReward[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
};

type ApiRewardIcon = {
  id: string;
  key: string;
  url: string;
  label: string;
};

type ApiRewardClaimUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  department_id?: string | null;
};

type ApiRewardClaim = {
  id: string;
  reward_id: string;
  user_id: string;
  status: RewardClaimStatus;
  xp_spent?: number;
  claimed_at: string;
  resolved_at?: string | null;
  approver_id?: string | null;
  reward: ApiReward;
  user: ApiRewardClaimUser;
};

type ApiRewardClaimListResponse = {
  items: ApiRewardClaim[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
};

type ApiRewardLog = {
  id: string;
  actor_id?: string | null;
  subject_type: string;
  subject_id: string;
  action: RewardLogAction;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

type ApiRewardLogListResponse = {
  items: ApiRewardLog[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
};

type ApiAuditActor = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: Role | null;
};

type ApiAuditEvent = {
  id: string;
  actor_id?: string | null;
  actor?: ApiAuditActor | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

type ApiAuditEventListResponse = {
  items: ApiAuditEvent[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
};

type ApiAuditLog = {
  id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  actor?: ApiAuditActor | null;
  action: string;
  category: string;
  entity_type?: string | null;
  entity_id?: string | null;
  target_user_id?: string | null;
  approval_id?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  source: string;
  severity: string;
  status: string;
  reason?: string | null;
  trigger?: string | null;
  route?: string | null;
  method?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type ApiAuditLogListResponse = {
  items: ApiAuditLog[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
};

type ApiAuditRetentionConfig = {
  id: number;
  retention_days: number;
  created_at: string;
  updated_at: string;
  last_applied_at?: string | null;
};

type ApiAuditRetentionApplyResponse = {
  updated: number;
  cutoff_at: string;
  retention_days: number;
};

type RewardImageUploadResponse = {
  image_ref: string;
  image_url: string;
  mime_type: string;
  size: number;
};

type RewardEditorPayload = {
  title: string;
  description: string;
  imageSource: RewardImageSource;
  imageRef?: string | null;
  xpRequired: number;
  deptWhitelist?: string[] | null;
  autoRedeem: boolean;
  allowMultipleClaims: boolean;
  expiresAt?: string | null;
};

type BadgeEditorPayload = {
  name: string;
  description: string;
  tier: string;
  tierGroup?: string | null;
  tierOrder: number;
  bonusXp: number;
  state: string;
  isSystem?: boolean;
  rules: BadgeRuleSet;
};

type BadgeUpdatePayload = Partial<BadgeEditorPayload> & {
  rules?: BadgeRuleSet;
};

type BadgeImagePayload = {
  file?: File;
  imageUrl?: string;
};

type ApiLevel = {
  id?: string;
  name: string;
  bg_image?: string;
  is_active: boolean;
  created_by_id: string;
  created_at?: string;
  updated_at?: string;
};

type ApiLevelNode = {
  id?: string;
  level_id: string;
  type: 'CHECKPOINT' | 'TOWER' | 'DECOR' | 'GIFT';
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  description?: string;
  xp_threshold: number;
  reward_id?: string;
  require_confirm: boolean;
  animation_key?: string;
  created_at?: string;
  updated_at?: string;
};

type ApiLevelEdge = {
  id?: string;
  level_id: string;
  from_node: string;
  to_node: string;
  path?: any;
  created_at?: string;
  updated_at?: string;
};

type ApiLevelEvent = {
  id?: string;
  level_id: string;
  node_id?: string;
  event_type: 'REACHED' | 'CLAIMED' | 'ANIM_SHOWN';
  user_id: string;
  created_at?: string;
};

type ApiLevelPreviewResponse = {
  level: ApiLevel;
  nodes: ApiLevelNode[];
  edges: ApiLevelEdge[];
  user_xp: number;
  reachable_nodes: string[];
};

type ApiUserProgress = {
  id?: string;
  user_id: string;
  level_id: string;
  season_id?: string;
  current_points: number;
  total_points_earned: number;
  level_unlocked_at?: string;
  created_at?: string;
  updated_at?: string;
  user?: ApiUser;
  level?: ApiLevel;
  season?: ApiSeason;
};

type ApiSeason = {
  id?: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  theme: string;
  bonus_multiplier: number;
  created_at?: string;
  updated_at?: string;
};

type ApiNotification = {
  id: string;
  tenant_id?: string | null;
  user_id: string;
  dedupe_key?: string | null;
  type: NotificationType;
  title?: string | null;
  body?: string | null;
  message: string;
  entity_type?: NotificationEntityType | null;
  entity_id?: string | null;
  deep_link?: string | null;
  is_read: boolean;
  related_task_id: string | null;
  related_reward_id: string | null;
  related_chat_id?: string | null;
  created_at: string;
};

type ApiNotificationPreference = {
  module: NotificationModule;
  push_enabled: boolean;
  updated_at?: string | null;
};

type ApiVapidPublicKey = {
  public_key: string;
};

type ApiPushTestResult = {
  delivered: number;
};

type ApiPushSubscriptionCreate = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  user_agent?: string | null;
  device_label?: string | null;
};

type OAuthConfigCreatePayload = {
  name: string;
  redirect_url: string;
  scopes: string[];
  n8n_integration: boolean;
  client_id?: string;
  client_secret?: string;
  api_key?: string;
};

type OAuthConfigUpdatePayload = Partial<OAuthConfigCreatePayload>;

type OAuthCredentialRotatePayload = {
  rotate_client_id?: boolean;
  rotate_client_secret?: boolean;
  rotate_api_key?: boolean;
};



type ApiUserBackup = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  department_id?: string | null;
  manager_id?: string | null;
  manager_email?: string | null;
  shift_name?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  morning_break_start?: string | null;
  morning_break_end?: string | null;
  lunch_break_start?: string | null;
  lunch_break_end?: string | null;
  evening_break_start?: string | null;
  evening_break_end?: string | null;
  title?: string | null;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
  notes?: string | null;
  skills?: string[] | null;
  projects?: string[] | null;
  points: number;
  tasks_created: number;
  tasks_completed: number;
  clarity_scores: number[];
  claimed_reward_ids: string[];
  unlocked_achievement_ids: string[];
  hashed_password: string;
  created_at: string;
  updated_at: string;
};

type ApiTaskSubtaskBackup = {
  id?: string;
  title: string;
  completed: boolean;
};

type ApiTaskCommentBackup = {
  id?: string;
  user_id: string;
  content: string;
  created_at: string;
};

type ApiTaskBackup = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assigned_to_ids?: string[] | null;
  assigned_to_id?: string | null;
  task_group_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  due_at?: string | null;
  completed_at?: string | null;
  recurrence_rule: RecurrenceRule;
  recurring_task_id?: string | null;
  clarity_rating?: number | null;
  attachments: string[];
  estimated_hours?: number | null;
  tags: string[];
  subtasks: ApiTaskSubtaskBackup[];
  comments: ApiTaskCommentBackup[];
  dependencies: string[];
};

type ApiNotificationBackup = {
  id: string;
  user_id: string;
  type: NotificationType;
  message: string;
  is_read: boolean;
  related_task_id?: string | null;
  related_reward_id?: string | null;
  related_chat_id?: string | null;
  created_at: string;
};

type ApiUserRewardBackup = {
  id: string;
  user_id: string;
  reward_id: string;
  status: RewardClaimStatus;
  xp_spent?: number;
  claimed_at: string;
  resolved_at?: string | null;
  approver_id?: string | null;
};

type ApiUserAchievementBackup = {
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
};

type ApiDataExportBundle = {
  scope: DataExportScope;
  generated_at: string;
  departments: ApiDepartment[];
  users: ApiUserBackup[];
  tasks: ApiTaskBackup[];
  achievements: any[];
  rewards: ApiReward[];
  kanban_columns: ApiKanbanColumn[];
  notifications: ApiNotificationBackup[];
  user_rewards: ApiUserRewardBackup[];
  user_achievements: ApiUserAchievementBackup[];
};

type ApiDataImportPayload = {
  scope: DataExportScope;
  departments: ApiDepartment[];
  users: ApiUserBackup[];
  tasks: ApiTaskBackup[];
  achievements: any[];
  rewards: ApiReward[];
  kanban_columns: ApiKanbanColumn[];
  notifications: ApiNotificationBackup[];
  user_rewards: ApiUserRewardBackup[];
  user_achievements: ApiUserAchievementBackup[];
};

type ApiStatusResponse = {
  status: string;
};

type ApiReleaseNotes = {
  id: number;
  version_label: string;
  content_mode: 'text' | 'code';
  details_text?: string | null;
  html?: string | null;
  css?: string | null;
  js?: string | null;
  updated_by_id?: string | null;
  created_at: string;
  updated_at: string;
};

type ApiMediaPresignResponse = {
  upload_url: string;
  bucket: string;
  object_key: string;
  file_id: string;
  expires_in: number;
};

type ApiMediaConfirmResponse = {
  file_id: string;
  status: string;
};

type ApiMediaFileListItem = {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  read_url: string;
};

type ApiMediaFileListResponse = {
  items: ApiMediaFileListItem[];
  page: number;
  page_size: number;
  total: number;
};

type ApiAvatarFinalizeResponse = {
  file_id: string;
  profile_image_key: string;
  profile_image_url: string;
};

type AuthResponse = {
  token: {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
  user: ApiUser;
};

type ApiChatMember = {
  id: string;
  conversation_id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  title?: string | null;
  department_name?: string | null;
  account_status?: UserStatus;
  app_role: Role;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joined_at: string;
  last_read_message_id?: string | null;
  last_read_at?: string | null;
  is_muted: boolean;
  is_pinned: boolean;
};

type ApiChatReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type ApiChatAttachment = {
  id: string;
  message_id: string;
  file_name: string;
  original_file_name: string;
  mime_type: string;
  file_size: number;
  storage_key: string;
  url?: string | null;
  created_at: string;
};

type ApiChatMessage = Record<string, unknown>;

type ApiChatConversation = {
  id: string;
  tenant_id: string;
  type: 'DIRECT' | 'GROUP' | 'SPACE';
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  project_id?: string | null;
  team_id?: string | null;
  is_private: boolean;
  is_archived: boolean;
  created_by_id?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
  members?: ApiChatMember[];
  unread_count: number;
  last_message?: ApiChatMessage | null;
};

type ApiChatMessagePage = {
  items: ApiChatMessage[];
  next_cursor?: string | null;
  has_more: boolean;
};

type ApiChatPinnedMessage = {
  id: string;
  conversation_id: string;
  message_id: string;
  pinned_by: string;
  created_at: string;
  message: ApiChatMessage;
};

type ApiChatMessageSearchResult = {
  message: ApiChatMessage;
  conversation: ApiChatConversation;
};

type ApiChatMessageSearchPage = {
  items: ApiChatMessageSearchResult[];
  next_cursor?: string | null;
  has_more: boolean;
};

type ApiChatDirectoryUser = {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  presence: 'ONLINE' | 'AWAY' | 'OFFLINE';
  last_seen_at?: string | null;
  role_name?: string | null;
  team_name?: string | null;
  title?: string | null;
  existing_conversation_id?: string | null;
  is_favorite: boolean;
  unread_count: number;
  latest_message_preview?: string | null;
  last_message_at?: string | null;
};

type ApiChatDirectoryPage = {
  items: ApiChatDirectoryUser[];
  next_cursor?: string | null;
};

const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    if (!config.headers) {
      config.headers = new AxiosHeaders();
    }
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (!isFormData && !config.headers['Content-Type'] && config.method && config.method !== 'get') {
    config.headers['Content-Type'] = 'application/json';
  }
  if (config.showGlobalProgress !== false && !config.globalProgressTaskId) {
    config.globalProgressTaskId = startGlobalLoadingTask();
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

function notifyAuthExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    notifyAuthExpired();
    return null;
  }
  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refresh_token: refreshToken,
    });
    storeTokens(data.access_token, data.refresh_token);
    return data.access_token as string;
  } catch (error) {
    clearTokens();
    notifyAuthExpired();
    return null;
  }
}

http.interceptors.response.use(
  (response) => {
    stopGlobalLoadingTask(response.config.globalProgressTaskId);
    return response;
  },
  async (error) => {
    const { response, config } = error;
    stopGlobalLoadingTask(config?.globalProgressTaskId);
    if (response?.status === 401 && !config.__isRetryRequest) {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken();
      }
      const newToken = await refreshPromise;
      refreshPromise = null;
      if (newToken) {
        config.__isRetryRequest = true;
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${newToken}`;
        return http(config);
      }
      clearTokens();
      notifyAuthExpired();
    }
    return Promise.reject(error);
  }
);

function mapAxiosError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const responseData = err.response?.data as any;
    const detail = responseData?.detail ?? responseData?.message;
    if (Array.isArray(detail)) {
      throw new Error(detail.map((item) => item.msg ?? String(item)).join(', '));
    }
    throw new Error(typeof detail === 'string' ? detail : err.message);
  }
  throw err;
}

function mapAvatarAsset(asset?: ApiAvatarAsset | null): AvatarAsset | null {
  if (!asset) {
    return null;
  }
  return {
    id: asset.id,
    name: asset.name,
    storageType: asset.storage_type,
    url: asset.url ?? null,
    dataUrl: asset.data_url ?? null,
    externalUrl: asset.external_url ?? null,
    isDefault: asset.is_default,
    mimeType: asset.mime_type ?? null,
    createdById: asset.created_by_id ?? null,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

function mapUser(user: ApiUser): User {
  const avatarAsset = mapAvatarAsset(user.avatar_asset);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    employerId: user.employer_id || '',
    role: user.role,
    department: user.department?.name ?? '',
    departmentId: user.department_id ?? null,
    managerId: user.manager_id ?? null,
    managerEmail: user.manager_email ?? undefined,
    shiftName: user.shift_name ?? undefined,
    shiftStart: user.shift_start ?? undefined,
    shiftEnd: user.shift_end ?? undefined,
    morningBreakStart: user.morning_break_start ?? undefined,
    morningBreakEnd: user.morning_break_end ?? undefined,
    lunchBreakStart: user.lunch_break_start ?? undefined,
    lunchBreakEnd: user.lunch_break_end ?? undefined,
    eveningBreakStart: user.evening_break_start ?? undefined,
    eveningBreakEnd: user.evening_break_end ?? undefined,
    title: user.title ?? undefined,
    phone: user.phone ?? undefined,
    location: user.location ?? undefined,
    timezone: user.timezone ?? undefined,
    notes: user.notes ?? undefined,
    skills: user.skills ?? undefined,
    projects: user.projects ?? undefined,
    avatarAssetId: user.avatar_asset_id ?? null,
    avatarFrame: user.avatar_frame ?? null,
    avatarAsset,
    avatarUrl: user.profile_image_url ?? user.avatar_url ?? avatarAsset?.url ?? null,
    profileImageKey: user.profile_image_key ?? null,
    profileImageUrl: user.profile_image_url ?? null,
    status: user.status as UserStatus,
    points: user.points ?? 0,
    overallXpPoints: user.overall_xp_points ?? user.points ?? 0,
    claimedXpPoints: user.claimed_xp_points ?? 0,
    unlockedAchievementIds: user.unlocked_achievement_ids ?? [],
    tasksCreated: user.tasks_created ?? 0,
    tasksCompleted: user.tasks_completed ?? 0,
    clarityScores: user.clarity_scores ?? [],
    claimedRewardIds: user.claimed_reward_ids ?? [],
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function mapClient(client: ApiClient): Client {
  return {
    id: client.id,
    tenantId: client.tenant_id,
    companyName: client.company_name,
    normalizedCompanyName: client.normalized_company_name,
    gstNumber: client.gst_number ?? null,
    email: client.email ?? null,
    phone: client.phone ?? null,
    website: client.website ?? null,
    addressLine1: client.address_line1 ?? null,
    addressLine2: client.address_line2 ?? null,
    city: client.city ?? null,
    state: client.state ?? null,
    postalCode: client.postal_code ?? null,
    country: client.country ?? null,
    notes: client.notes ?? null,
    status: client.status,
    createdById: client.created_by_id ?? null,
    updatedById: client.updated_by_id ?? null,
    archivedById: client.archived_by_id ?? null,
    archivedAt: client.archived_at ?? null,
    createdAt: client.created_at,
    updatedAt: client.updated_at,
  };
}

function toApiClientPayload(payload: ClientCreatePayload | ClientUpdatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (payload.companyName !== undefined) body.company_name = payload.companyName;
  if (payload.gstNumber !== undefined) body.gst_number = payload.gstNumber || null;
  if (payload.email !== undefined) body.email = payload.email || null;
  if (payload.phone !== undefined) body.phone = payload.phone || null;
  if (payload.website !== undefined) body.website = payload.website || null;
  if (payload.addressLine1 !== undefined) body.address_line1 = payload.addressLine1 || null;
  if (payload.addressLine2 !== undefined) body.address_line2 = payload.addressLine2 || null;
  if (payload.city !== undefined) body.city = payload.city || null;
  if (payload.state !== undefined) body.state = payload.state || null;
  if (payload.postalCode !== undefined) body.postal_code = payload.postalCode || null;
  if (payload.country !== undefined) body.country = payload.country || null;
  if (payload.notes !== undefined) body.notes = payload.notes || null;
  return body;
}

function mapContact(contact: ApiContact): Contact {
  return {
    id: contact.id,
    tenantId: contact.tenant_id,
    firstName: contact.first_name,
    lastName: contact.last_name ?? null,
    displayName: contact.display_name,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    title: contact.title ?? null,
    notes: contact.notes ?? null,
    status: contact.status,
    clients: (contact.clients ?? []).map((client) => ({
      id: client.id,
      companyName: client.company_name,
      status: client.status,
      isPrimary: client.is_primary,
    })),
    createdById: contact.created_by_id ?? null,
    updatedById: contact.updated_by_id ?? null,
    archivedById: contact.archived_by_id ?? null,
    archivedAt: contact.archived_at ?? null,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
  };
}

function toApiContactPayload(payload: ContactCreatePayload | ContactUpdatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (payload.firstName !== undefined) body.first_name = payload.firstName;
  if (payload.lastName !== undefined) body.last_name = payload.lastName || null;
  if (payload.email !== undefined) body.email = payload.email || null;
  if (payload.phone !== undefined) body.phone = payload.phone || null;
  if (payload.title !== undefined) body.title = payload.title || null;
  if (payload.notes !== undefined) body.notes = payload.notes || null;
  if (payload.clientLinks !== undefined) {
    body.client_links = payload.clientLinks.map((link) => ({
      client_id: link.clientId,
      is_primary: Boolean(link.isPrimary),
    }));
  }
  return body;
}

function mapProject(project: ApiProject): Project {
  return {
    id: project.id,
    tenantId: project.tenant_id,
    clientId: project.client_id,
    name: project.name,
    normalizedName: project.normalized_name,
    description: project.description ?? null,
    status: project.status,
    startDate: project.start_date ?? null,
    endDate: project.end_date ?? null,
    client: {
      id: project.client.id,
      companyName: project.client.company_name,
      status: project.client.status,
    },
    members: (project.members ?? []).map((member) => ({
      id: member.id,
      userId: member.user_id,
      name: member.name,
      email: member.email,
      role: member.role,
      userRole: member.user_role,
      status: member.status,
    })),
    taskCount: project.task_count ?? 0,
    subtaskApprovalRequiredDefault: project.subtask_approval_required_default ?? false,
    createdById: project.created_by_id ?? null,
    updatedById: project.updated_by_id ?? null,
    archivedById: project.archived_by_id ?? null,
    archivedAt: project.archived_at ?? null,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function mapProjectDashboardSubtask(subtask: ApiProjectDashboardSubtask): ProjectDashboardSubtask {
  return {
    id: subtask.id,
    title: subtask.title,
    completed: subtask.completed,
    assignedToId: subtask.assigned_to_id ?? null,
    assignedUserName: subtask.assigned_user_name ?? null,
    status: subtask.status,
    sortOrder: subtask.sort_order ?? 0,
    dependencyIds: subtask.dependency_ids ?? [],
    dependentIds: subtask.dependent_ids ?? [],
    dependencyState: subtask.dependency_state ?? 'READY',
    branchKey: subtask.branch_key ?? null,
    totalTrackedSeconds: subtask.total_tracked_seconds ?? 0,
    activeTimerUserIds: subtask.active_timer_user_ids ?? [],
    completionApprovalRequired: subtask.completion_approval_required ?? false,
    latestSubmissionStatus: subtask.latest_submission_status ?? null,
    forceStarted: subtask.force_started ?? false,
  };
}

function mapProjectDashboardTask(task: ApiProjectDashboardTask): ProjectDashboardTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    derivedStatus: task.derived_status,
    statusSource: task.status_source,
    priority: task.priority,
    assignedToId: task.assigned_to_id ?? null,
    assignedUserName: task.assigned_user_name ?? null,
    projectId: task.project_id,
    dueAt: task.due_at ?? null,
    completedAt: task.completed_at ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    progressPercent: task.progress_percent ?? 0,
    completedSubtasks: task.completed_subtasks ?? 0,
    totalSubtasks: task.total_subtasks ?? 0,
    totalTrackedSeconds: task.total_tracked_seconds ?? 0,
    activeTimerUserIds: task.active_timer_user_ids ?? [],
    subtasks: (task.subtasks ?? []).map(mapProjectDashboardSubtask),
  };
}

function mapProjectDashboardWorkload(item: ApiProjectDashboardWorkload): ProjectDashboardWorkload {
  return {
    userId: item.user_id,
    name: item.name,
    role: item.role,
    assignedTasks: item.assigned_tasks ?? 0,
    assignedSubtasks: item.assigned_subtasks ?? 0,
    actionableSubtasks: item.actionable_subtasks ?? 0,
    waitingSubtasks: item.waiting_subtasks ?? 0,
    blockedSubtasks: item.blocked_subtasks ?? 0,
    inReviewSubtasks: item.in_review_subtasks ?? 0,
    completedSubtasks: item.completed_subtasks ?? 0,
    totalTrackedSeconds: item.total_tracked_seconds ?? 0,
  };
}

function mapProjectDashboardSummary(summary: ApiProjectDashboardSummary): ProjectDashboardSummary {
  return {
    taskTotal: summary.task_total ?? 0,
    subtaskTotal: summary.subtask_total ?? 0,
    completedSubtasks: summary.completed_subtasks ?? 0,
    progressPercent: summary.progress_percent ?? 0,
    totalTrackedSeconds: summary.total_tracked_seconds ?? 0,
    activeTimerCount: summary.active_timer_count ?? 0,
    statusCounts: summary.status_counts as Record<TaskStatus, number>,
    derivedStatusCounts: summary.derived_status_counts as Record<TaskStatus, number>,
    subtaskStatusCounts: summary.subtask_status_counts as Record<SubtaskStatus, number>,
    priorityCounts: summary.priority_counts as Record<TaskPriority, number>,
    workload: (summary.workload ?? []).map(mapProjectDashboardWorkload),
  };
}

function mapProjectTaskDashboard(data: ApiProjectTaskDashboardResponse): ProjectTaskDashboardResponse {
  return {
    project: mapProject(data.project),
    summary: mapProjectDashboardSummary(data.summary),
    items: (data.items ?? []).map(mapProjectDashboardTask),
    page: data.page,
    pageSize: data.page_size,
    total: data.total,
    totalPages: data.total_pages,
    statusPolicy: data.status_policy,
  };
}

function toApiProjectPayload(payload: ProjectCreatePayload | ProjectUpdatePayload | ProjectMembershipPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ('name' in payload && payload.name !== undefined) body.name = payload.name;
  if ('clientId' in payload && payload.clientId !== undefined) body.client_id = payload.clientId;
  if ('description' in payload && payload.description !== undefined) body.description = payload.description || null;
  if ('startDate' in payload && payload.startDate !== undefined) body.start_date = payload.startDate || null;
  if ('endDate' in payload && payload.endDate !== undefined) body.end_date = payload.endDate || null;
  if ('subtaskApprovalRequiredDefault' in payload && payload.subtaskApprovalRequiredDefault !== undefined) {
    body.subtask_approval_required_default = payload.subtaskApprovalRequiredDefault;
  }
  if (payload.managerIds !== undefined) body.manager_ids = payload.managerIds;
  if (payload.memberIds !== undefined) body.member_ids = payload.memberIds;
  return body;
}

function mapChatMember(member: ApiChatMember): ChatMember {
  return {
    id: member.id,
    conversationId: member.conversation_id,
    userId: member.user_id,
    name: member.name,
    email: member.email,
    avatarUrl: member.avatar_url ?? null,
    title: member.title ?? null,
    departmentName: member.department_name ?? null,
    accountStatus: (member.account_status ?? UserStatus.ACTIVE) as UserStatus,
    appRole: member.app_role,
    role: member.role,
    joinedAt: member.joined_at,
    lastReadMessageId: member.last_read_message_id ?? null,
    lastReadAt: member.last_read_at ?? null,
    isMuted: member.is_muted,
    isPinned: member.is_pinned,
  };
}

function mapChatDirectoryUser(user: ApiChatDirectoryUser): ChatDirectoryUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url ?? null,
    presence: user.presence ?? 'OFFLINE',
    lastSeenAt: user.last_seen_at ?? null,
    roleName: user.role_name ?? null,
    teamName: user.team_name ?? null,
    title: user.title ?? null,
    existingConversationId: user.existing_conversation_id ?? null,
    isFavorite: user.is_favorite,
    unreadCount: user.unread_count,
    latestMessagePreview: user.latest_message_preview ?? null,
    lastMessageAt: user.last_message_at ?? null,
  };
}

function mapChatMessage(message: ApiChatMessage): ChatMessage {
  return normalizeMessage(message);
}

function mapChatConversation(conversation: ApiChatConversation): ChatConversation {
  return {
    id: conversation.id,
    tenantId: conversation.tenant_id,
    type: conversation.type,
    name: conversation.name ?? null,
    description: conversation.description ?? null,
    avatarUrl: conversation.avatar_url ?? null,
    projectId: conversation.project_id ?? null,
    teamId: conversation.team_id ?? null,
    isPrivate: conversation.is_private,
    isArchived: conversation.is_archived,
    createdById: conversation.created_by_id ?? null,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    lastMessageAt: conversation.last_message_at ?? null,
    members: (conversation.members ?? []).map(mapChatMember),
    unreadCount: conversation.unread_count,
    lastMessage: conversation.last_message ? mapChatMessage(conversation.last_message) : null,
  };
}

function mapChatPinnedMessage(pin: ApiChatPinnedMessage): ChatPinnedMessage {
  return {
    id: pin.id,
    conversationId: pin.conversation_id,
    messageId: pin.message_id,
    pinnedBy: pin.pinned_by,
    createdAt: pin.created_at,
    message: mapChatMessage(pin.message),
  };
}

function toApiChatConversationPayload(payload: ChatConversationCreatePayload) {
  return {
    type: payload.type,
    name: payload.name ?? null,
    description: payload.description ?? null,
    avatar_url: payload.avatarUrl ?? null,
    project_id: payload.projectId ?? null,
    team_id: payload.teamId ?? null,
    is_private: payload.isPrivate ?? false,
    member_ids: payload.memberIds ?? [],
  };
}

function toApiChatMessagePayload(payload: ChatMessageCreatePayload) {
  return {
    content: payload.content,
    message_type: payload.messageType ?? 'TEXT',
    client_id: payload.clientId ?? null,
    reply_to_message_id: payload.replyToMessageId ?? null,
    attachments: (payload.attachments ?? []).map((attachment) => ({
      file_name: attachment.fileName,
      original_file_name: attachment.originalFileName,
      mime_type: attachment.mimeType,
      file_size: attachment.fileSize,
      storage_key: attachment.storageKey,
      url: attachment.url ?? null,
    })),
  };
}

function mapCompletionAttachment(attachment: ApiCompletionAttachment): CompletionAttachment {
  return {
    id: attachment.id,
    originalFilename: attachment.original_filename,
    mimeType: attachment.mime_type,
    fileSize: attachment.file_size,
    checksumSha256: attachment.checksum_sha256,
    createdAt: attachment.created_at,
  };
}

function mapCompletionSubmission(submission: ApiCompletionSubmission): CompletionSubmission {
  return {
    id: submission.id,
    tenantId: submission.tenant_id,
    taskId: submission.task_id,
    subtaskId: submission.subtask_id,
    submittedById: submission.submitted_by_id ?? null,
    description: submission.description,
    descriptionWordCount: submission.description_word_count,
    status: submission.status,
    approvalRequired: submission.approval_required,
    attemptNumber: submission.attempt_number,
    reviewedById: submission.reviewed_by_id ?? null,
    reviewedAt: submission.reviewed_at ?? null,
    reviewReason: submission.review_reason ?? null,
    createdAt: submission.created_at,
    attachments: (submission.attachments ?? []).map(mapCompletionAttachment),
  };
}

function mapSubtask(subtask: ApiTask['subtasks'][number]): Subtask {
  const submissions = (subtask.completion_submissions ?? []).map(mapCompletionSubmission);
  return {
    id: subtask.id,
    title: subtask.title,
    completed: subtask.completed,
    assignedToId: subtask.assigned_to_id ?? null,
    assignedUser: subtask.assigned_user ?? null,
    status: subtask.status ?? (subtask.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO),
    sortOrder: subtask.sort_order ?? 0,
    totalTrackedSeconds: subtask.total_tracked_seconds ?? 0,
    dependencyIds: subtask.dependency_ids ?? [],
    dependentIds: subtask.dependent_ids ?? [],
    dependencyState: subtask.dependency_state ?? 'READY',
    completionApprovalRequired: subtask.completion_approval_required ?? false,
    latestCompletionSubmission: subtask.latest_completion_submission
      ? mapCompletionSubmission(subtask.latest_completion_submission)
      : submissions[submissions.length - 1] ?? null,
    completionSubmissions: submissions,
    dependencies: (subtask.dependencies ?? []).map((dependency): SubtaskDependency => ({
      id: dependency.id,
      taskId: dependency.task_id,
      subtaskId: dependency.subtask_id,
      dependsOnSubtaskId: dependency.depends_on_subtask_id,
      dependencyOrder: dependency.dependency_order,
      branchKey: dependency.branch_key ?? null,
      createdAt: dependency.created_at,
    })),
  };
}

function mapTimeEntry(entry: ApiTimeEntry): TimeEntry {
  return {
    id: entry.id,
    tenantId: entry.tenant_id,
    userId: entry.user_id,
    taskId: entry.task_id ?? null,
    subtaskId: entry.subtask_id ?? null,
    startedAt: entry.started_at,
    stoppedAt: entry.stopped_at ?? null,
    durationSeconds: entry.duration_seconds ?? null,
    status: entry.status,
    note: entry.note ?? null,
    originalStartedAt: entry.original_started_at ?? null,
    originalStoppedAt: entry.original_stopped_at ?? null,
    originalDurationSeconds: entry.original_duration_seconds ?? null,
    correctionReason: entry.correction_reason ?? null,
    correctedById: entry.corrected_by_id ?? null,
    correctedAt: entry.corrected_at ?? null,
  };
}

function mapTask(task: ApiTask): Task {
  const assignedIds = task.assigned_to_ids ?? (task.assigned_to_id ? [task.assigned_to_id] : null);

  const mapped: Task = {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    category: TaskCategory.OTHER,
    team: task.team ?? '',
    projectId: task.project_id ?? task.project?.id ?? null,
    project: task.project
      ? {
          id: task.project.id,
          name: task.project.name,
          clientId: task.project.client_id,
          clientName: task.project.client_name ?? null,
          status: task.project.status,
        }
      : null,
    assignedTo: assignedIds && assignedIds.length > 0 ? assignedIds : null,
    followerIds: task.follower_ids ?? [],
    taskGroupId: task.task_group_id ?? null,
    createdBy: task.created_by_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    dueAt: task.due_at ?? null,
    completedAt: task.completed_at ?? null,
    subtasks: (task.subtasks ?? []).map(mapSubtask),
    recurrenceRule: task.recurrence_rule ?? RecurrenceRule.NONE,
    recurringTaskId: task.recurring_task_id ?? null,
    clarityRating: task.clarity_rating ?? null,
    attachments: task.attachments ?? [],
    estimatedHours: task.estimated_hours ?? null,
    tags: task.tags ?? [],
    totalTrackedSeconds: task.total_tracked_seconds ?? 0,
    subtaskApprovalRequired: task.subtask_approval_required ?? null,
  };

  return augmentTaskWithPoints(mapped);
}

function mapTaskCalendarSummary(data: ApiTaskCalendarSummaryResponse): TaskCalendarSummaryResponse {
  return {
    startDate: data.start_date,
    endDate: data.end_date,
    days: (data.days ?? []).map((day) => ({
      date: day.date,
      total: day.total,
      completed: day.completed,
      overdue: day.overdue,
      urgent: day.urgent,
      high: day.high,
      medium: day.medium,
      low: day.low,
      dueSoon: day.due_soon,
    })),
  };
}

function mapTicketStatusHistory(entry: ApiTicketStatusHistory): TicketStatusHistoryEntry {
  return {
    id: entry.id,
    ticketId: entry.ticket_id,
    fromStatus: entry.from_status ?? null,
    toStatus: entry.to_status,
    actorUserId: entry.actor_user_id ?? null,
    movedAtUtc: entry.moved_at_utc,
    metadataJson: entry.metadata_json ?? null,
  };
}

function mapTicketApprovalItem(entry: ApiTicketApprovalItem): TicketApprovalItem {
  return {
    id: entry.id,
    approverUserId: entry.approver_user_id,
    message: entry.message ?? null,
    status: entry.status,
    actedAtUtc: entry.acted_at_utc ?? null,
    orderIndex: entry.order_index ?? null,
  };
}

function mapTicketApprovalCycle(entry: ApiTicketApprovalCycle): TicketApprovalCycle {
  return {
    id: entry.id,
    ticketId: entry.ticket_id,
    approvalType: entry.approval_type,
    deadlineUtc: entry.deadline_utc ?? null,
    attemptsLeft: entry.attempts_left,
    status: entry.status,
    requestedBy: entry.requested_by,
    requestedAtUtc: entry.requested_at_utc,
    completedAtUtc: entry.completed_at_utc ?? null,
    approvers: (entry.approvers ?? []).map(mapTicketApprovalItem),
  };
}

function mapTicketTask(entry: ApiTicketTask): TicketTask {
  return {
    id: entry.id,
    ticketId: entry.ticket_id,
    title: entry.title,
    description: entry.description ?? '',
    status: entry.status,
    assignedTo: entry.assigned_to ?? null,
    createdBy: entry.created_by,
    dueAtUtc: entry.due_at_utc ?? null,
    priority: entry.priority,
    points: entry.points,
    completedAtUtc: entry.completed_at_utc ?? null,
    createdAtUtc: entry.created_at_utc,
    updatedAtUtc: entry.updated_at_utc,
  };
}

function mapTicketLinkedTask(entry: ApiTicketLinkedTask): TicketLinkedTask {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description ?? '',
    status: entry.status,
    priority: entry.priority,
    team: entry.team,
    assignedToId: entry.assigned_to_id ?? null,
    createdById: entry.created_by_id,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    dueAt: entry.due_at ?? null,
    completedAt: entry.completed_at ?? null,
    ticketId: entry.ticket_id ?? null,
    approvalRequired: entry.approval_required ?? false,
    approvalStatus: entry.approval_status ?? TaskApprovalStatus.NONE,
    approverId: entry.approver_id ?? null,
  };
}

function mapTicketTimeline(entry: ApiTicketTimeline): TicketTimeline {
  return {
    stages: entry.stages.map((stage) => ({
      stage: stage.stage,
      entryTime: stage.entry_time ?? null,
      exitTime: stage.exit_time ?? null,
      timeSpentSeconds: stage.time_spent_seconds ?? null,
    })),
    totalResolutionSeconds: entry.total_resolution_seconds ?? null,
    totalResolutionLabel: entry.total_resolution_label ?? null,
  };
}

function mapTicket(ticket: ApiTicket): Ticket {
  return {
    id: ticket.id,
    tenantId: ticket.tenant_id,
    departmentId: ticket.department_id ?? null,
    createdBy: ticket.created_by,
    ownerId: ticket.owner_id ?? null,
    assignedUserId: ticket.assigned_user_id ?? ticket.owner_id ?? null,
    title: ticket.title,
    description: ticket.description ?? '',
    dueAt: ticket.due_at ?? null,
    slaHours: ticket.sla_hours ?? null,
    approvalStatus: ticket.approval_status ?? null,
    approvalEnabled: ticket.approval_enabled ?? false,
    approvalType: (ticket.approval_type as Ticket['approvalType']) ?? null,
    minApprovals: ticket.min_approvals ?? null,
    approvalDeadline: ticket.approval_deadline ?? null,
    approvalApproverIds: ticket.approval_approver_ids ?? [],
    status: ticket.status,
    priority: ticket.priority,
    slaFirstResponseMinutes: ticket.sla_first_response_minutes ?? null,
    slaResolutionMinutes: ticket.sla_resolution_minutes ?? null,
    firstResponseDueAt: ticket.first_response_due_at ?? null,
    resolutionDueAt: ticket.resolution_due_at ?? null,
    firstResponseAt: ticket.first_response_at ?? null,
    resolvedAt: ticket.resolved_at ?? null,
    closedAt: ticket.closed_at ?? null,
    resolutionType: ticket.resolution_type ?? null,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    statusHistory: (ticket.status_history ?? []).map(mapTicketStatusHistory),
    approvalCycles: (ticket.approval_cycles ?? []).map(mapTicketApprovalCycle),
    tasks: (ticket.tasks ?? []).map(mapTicketTask),
  };
}

function mapTicketAttachment(attachment: ApiTicketAttachment): TicketAttachment {
  return {
    id: attachment.id,
    ticketId: attachment.ticket_id,
    tenantId: attachment.tenant_id,
    fileKey: attachment.file_key,
    fileName: attachment.file_name,
    mimeType: attachment.mime_type,
    sizeBytes: attachment.size_bytes,
    uploadedBy: attachment.uploaded_by,
    createdAt: attachment.created_at,
  };
}

function mapTicketParticipant(participant: ApiTicketParticipant): TicketParticipant {
  return {
    userId: participant.user_id,
    role: participant.role as TicketParticipant['role'],
  };
}

function mapTicketFollower(follower: ApiTicketFollower): TicketFollower {
  return {
    userId: follower.user_id,
  };
}

function mapTicketApproval(approval: ApiTicketApproval): TicketApproval {
  return {
    id: approval.id,
    ticketId: approval.ticket_id,
    attemptNo: approval.attempt_no,
    approvalType: approval.approval_type,
    minApprovals: approval.min_approvals,
    status: approval.status,
    requestedBy: approval.requested_by,
    approvalDeadline: approval.approval_deadline ?? null,
    createdAt: approval.created_at,
    updatedAt: approval.updated_at,
    approvers: (approval.approvers ?? []).map((approver) => ({
      userId: approver.user_id,
      decision: approver.decision,
      comment: approver.comment ?? null,
      decidedAt: approver.decided_at ?? null,
      sequenceOrder: approver.sequence_order ?? null,
    })),
  };
}

function mapTicketActivity(activity: ApiTicketActivity): TicketActivityItem {
  return {
    id: activity.id,
    ticketId: activity.ticket_id,
    eventType: activity.event_type,
    payload: activity.payload ?? null,
    actorId: activity.actor_id ?? null,
    createdAt: activity.created_at,
  };
}

function mapLeaderboardTask(task: ApiLeaderboardTask): Task {
  const assignedIds = task.assigned_to_id ? [task.assigned_to_id] : null;

  const mapped: Task = {
    id: task.id,
    title: 'Leaderboard task',
    description: '',
    status: task.status,
    priority: task.priority,
    category: TaskCategory.OTHER,
    team: task.team ?? '',
    assignedTo: assignedIds && assignedIds.length > 0 ? assignedIds : null,
    taskGroupId: null,
    createdBy: task.created_by_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    dueAt: task.due_at ?? null,
    completedAt: task.completed_at ?? null,
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: task.clarity_rating ?? null,
    attachments: [],
    estimatedHours: null,
    tags: [],
  };

  return augmentTaskWithPoints(mapped);
}

function mapComment(comment: ApiComment): Comment {
  return {
    id: comment.id,
    taskId: comment.task_id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
  };
}

function mapDepartment(department: ApiDepartment): Department {
  return {
    id: department.id,
    name: department.name,
  };
}

function mapKanbanColumn(column: ApiKanbanColumn): KanbanColumn {
  return {
    id: column.id,
    title: column.title,
    order: column.order,
    pipelineId: column.pipeline_id ?? '',
  };
}

function mapSmtpConfig(config: ApiSmtpConfig): SmtpConfig {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password ?? undefined,
    encryption: (config.encryption ?? 'tls') as 'none' | 'ssl' | 'tls',
  };
}

function mapApiConfig(config: { provider: string; api_key?: string | null }): ApiConfig {
  const dbApiKey = typeof config.api_key === 'string' ? config.api_key.trim() : '';
  const envApiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  const resolvedApiKey = dbApiKey || envApiKey || undefined;
  return {
    provider: config.provider,
    apiKey: resolvedApiKey,
  };
}

function mapPointsTableConfig(config: ApiPointsTableConfig): PointsTableConfig {
  return {
    pointsConfig: config.points_config ?? null,
    taskCreationPoints: config.task_creation_points ?? null,
    clarityPointsPerStar: config.clarity_points_per_star ?? null,
    managerOverduePenalty: config.manager_overdue_penalty ?? null,
  };
}

function mapReleaseNotes(notes: ApiReleaseNotes): ReleaseNotes {
  return {
    id: notes.id,
    versionLabel: notes.version_label,
    contentMode: notes.content_mode,
    detailsText: notes.details_text ?? null,
    html: notes.html ?? null,
    css: notes.css ?? null,
    js: notes.js ?? null,
    updatedById: notes.updated_by_id ?? null,
    createdAt: notes.created_at,
    updatedAt: notes.updated_at,
  };
}

function mapWebhook(webhook: ApiWebhook): WebhookSubscription {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    subscribedEvents: webhook.subscribed_events ?? [],
    isEnabled: webhook.is_enabled,
    secret: webhook.secret ?? null,
    customHeaders: webhook.custom_headers ?? null,
    createdAt: webhook.created_at,
    updatedAt: webhook.updated_at,
  };
}

function toApiWebhookPayload(payload: WebhookCreatePayload | WebhookUpdatePayload): ApiWebhookPayload {
  const apiPayload: ApiWebhookPayload = {};
  if (payload.name !== undefined) apiPayload.name = payload.name;
  if (payload.url !== undefined) apiPayload.url = payload.url;
  if (payload.subscribedEvents !== undefined) apiPayload.subscribed_events = payload.subscribedEvents;
  if (payload.isEnabled !== undefined) apiPayload.is_enabled = payload.isEnabled;
  if (payload.customHeaders !== undefined) apiPayload.custom_headers = payload.customHeaders;
  return apiPayload;
}

function mapAchievement(achievement: any): Achievement {
  return {
    id: achievement.id,
    title: achievement.title,
    description: achievement.description,
    points: achievement.points,
    icon: achievement.icon,
  };
}

function mapBadgeRuleConditions(conditions?: ApiBadgeRuleConditions | null): BadgeRuleConditions {
  return {
    priority: conditions?.priority ?? undefined,
    assignedTo: (conditions?.assigned_to as BadgeRuleConditions['assignedTo']) ?? undefined,
    createdBy: (conditions?.created_by as BadgeRuleConditions['createdBy']) ?? undefined,
    projectId: conditions?.project_id ?? null,
    pipelineId: conditions?.pipeline_id ?? null,
  };
}

function mapBadgeRule(rule: ApiBadgeRule): BadgeRule {
  return {
    entity: rule.entity as BadgeRule['entity'],
    event: rule.event as BadgeRule['event'],
    conditions: mapBadgeRuleConditions(rule.conditions),
    count: {
      type: rule.count.type as BadgeRule['count']['type'],
      value: rule.count.value,
    },
    timeWindow: rule.time_window
      ? { value: rule.time_window.value, unit: rule.time_window.unit as BadgeRule['timeWindow']['unit'] }
      : null,
    negative: Boolean(rule.negative),
  };
}

function mapBadgeRuleSet(ruleset?: ApiBadgeRuleSet | null): BadgeRuleSet | null {
  if (!ruleset) {
    return null;
  }
  return {
    operator: ruleset.operator,
    rules: ruleset.rules.map(mapBadgeRule),
  };
}

function mapBadge(badge: ApiBadge): Badge {
  return {
    id: badge.id,
    name: badge.name,
    description: badge.description,
    tier: badge.tier,
    tierGroup: badge.tier_group ?? null,
    tierOrder: badge.tier_order,
    bonusXp: badge.bonus_xp,
    imageUrl: badge.image_url ?? null,
    imageAssetPath: badge.image_asset_path ?? null,
    state: badge.state as Badge['state'],
    isSystem: badge.is_system,
    rules: mapBadgeRuleSet(badge.rules),
    createdAt: badge.created_at,
    updatedAt: badge.updated_at,
  };
}

function mapBadgeProgress(badge: ApiBadgeProgress): BadgeProgress {
  return {
    id: badge.id,
    name: badge.name,
    description: badge.description,
    tier: badge.tier,
    tierGroup: badge.tier_group ?? null,
    tierOrder: badge.tier_order,
    bonusXp: badge.bonus_xp,
    imageUrl: badge.image_url ?? null,
    state: badge.state as Badge['state'],
    isSystem: badge.is_system,
    status: badge.status as BadgeProgress['status'],
    progressPercent: badge.progress_percent,
    earnedAt: badge.earned_at ?? null,
  };
}

function toApiBadgeRuleConditions(conditions: BadgeRuleConditions): ApiBadgeRuleConditions {
  return {
    priority: conditions.priority ?? null,
    assigned_to: conditions.assignedTo ?? null,
    created_by: conditions.createdBy ?? null,
    project_id: conditions.projectId ?? null,
    pipeline_id: conditions.pipelineId ?? null,
  };
}

function toApiBadgeRule(rule: BadgeRule): ApiBadgeRule {
  return {
    entity: rule.entity,
    event: rule.event,
    conditions: toApiBadgeRuleConditions(rule.conditions),
    count: {
      type: rule.count.type,
      value: rule.count.value,
    },
    time_window: rule.timeWindow ? { value: rule.timeWindow.value, unit: rule.timeWindow.unit } : null,
    negative: Boolean(rule.negative),
  };
}

function toApiBadgeRuleSet(ruleset: BadgeRuleSet): ApiBadgeRuleSet {
  return {
    operator: ruleset.operator,
    rules: ruleset.rules.map(toApiBadgeRule),
  };
}

function toApiBadgePayload(payload: BadgeEditorPayload | BadgeUpdatePayload): Record<string, unknown> {
  const apiPayload: Record<string, unknown> = {};
  if (payload.name !== undefined) apiPayload.name = payload.name;
  if (payload.description !== undefined) apiPayload.description = payload.description;
  if (payload.tier !== undefined) apiPayload.tier = payload.tier;
  if (payload.tierGroup !== undefined) apiPayload.tier_group = payload.tierGroup;
  if (payload.tierOrder !== undefined) apiPayload.tier_order = payload.tierOrder;
  if (payload.bonusXp !== undefined) apiPayload.bonus_xp = payload.bonusXp;
  if (payload.state !== undefined) apiPayload.state = payload.state;
  if (payload.isSystem !== undefined) apiPayload.is_system = payload.isSystem;
  if (payload.rules !== undefined) apiPayload.rules = toApiBadgeRuleSet(payload.rules);
  return apiPayload;
}


function mapReward(reward: ApiReward): Reward {
  return {
    id: reward.id ?? '',
    title: reward.title,
    description: reward.description,
    imageSource: reward.image_source,
    imageRef: reward.image_ref ?? null,
    imageUrl: reward.image_url ?? null,
    xpRequired: reward.xp_required,
    deptWhitelist: reward.dept_whitelist ?? null,
    autoRedeem: reward.auto_redeem,
    allowMultipleClaims: reward.allow_multiple_claims ?? false,
    expiresAt: reward.expires_at ?? null,
    status: reward.status ?? RewardStatus.ACTIVE,
    createdAt: reward.created_at || new Date().toISOString(),
    updatedAt: reward.updated_at || new Date().toISOString(),
    createdById: reward.created_by_id ?? null,
    updatedById: reward.updated_by_id ?? null,
  };
}

function mapRewardIcon(icon: ApiRewardIcon): RewardIcon {
  return {
    id: icon.id,
    key: icon.key,
    url: icon.url,
    label: icon.label,
  };
}

function mapRewardClaimUser(user: ApiRewardClaimUser): RewardClaimUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: (user.role as Role) ?? Role.USER,
    departmentId: user.department_id ?? null,
  };
}

function mapRewardClaim(claim: ApiRewardClaim): RewardClaim {
  return {
    id: claim.id,
    rewardId: claim.reward_id,
    userId: claim.user_id,
    status: claim.status,
    xpSpent: claim.xp_spent ?? claim.reward?.xp_required ?? 0,
    claimedAt: claim.claimed_at,
    resolvedAt: claim.resolved_at ?? null,
    approverId: claim.approver_id ?? null,
    reward: mapReward(claim.reward),
    user: mapRewardClaimUser(claim.user),
  };
}

function mapRewardLog(log: ApiRewardLog): RewardLog {
  return {
    id: log.id,
    actorId: log.actor_id ?? null,
    subjectType: log.subject_type,
    subjectId: log.subject_id,
    action: log.action,
    meta: log.meta ?? null,
    createdAt: log.created_at,
  };
}

function mapAuditActor(actor?: ApiAuditActor | null): AuditActor | null {
  if (!actor) {
    return null;
  }
  return {
    id: actor.id,
    name: actor.name ?? null,
    email: actor.email ?? null,
    role: actor.role ?? undefined,
  };
}

function mapAuditEvent(entry: ApiAuditEvent): AuditEvent {
  return {
    id: entry.id,
    actorId: entry.actor_id ?? null,
    actor: mapAuditActor(entry.actor),
    eventType: entry.event_type,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    payload: entry.payload ?? null,
    createdAt: entry.created_at,
  };
}

function mapAuditLog(entry: ApiAuditLog): AuditLog {
  return {
    id: entry.id,
    actorId: entry.actor_id ?? null,
    actorRole: entry.actor_role ?? null,
    actor: mapAuditActor(entry.actor),
    action: entry.action,
    category: entry.category as AuditLog['category'],
    entityType: entry.entity_type ?? null,
    entityId: entry.entity_id ?? null,
    targetUserId: entry.target_user_id ?? null,
    approvalId: entry.approval_id ?? null,
    oldValue: entry.old_value ?? null,
    newValue: entry.new_value ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipAddress: entry.ip_address ?? null,
    userAgent: entry.user_agent ?? null,
    source: entry.source as AuditLog['source'],
    severity: entry.severity as AuditLog['severity'],
    status: entry.status as AuditLog['status'],
    reason: entry.reason ?? null,
    trigger: entry.trigger ?? null,
    route: entry.route ?? null,
    method: entry.method ?? null,
    metadata: entry.metadata ?? null,
    createdAt: entry.created_at,
  };
}

function mapAuditRetention(config: ApiAuditRetentionConfig): AuditRetentionConfig {
  return {
    id: config.id,
    retentionDays: config.retention_days,
    createdAt: config.created_at,
    updatedAt: config.updated_at,
    lastAppliedAt: config.last_applied_at ?? null,
  };
}



function mapNotification(notification: ApiNotification): Notification {
  return {
    id: notification.id,
    tenantId: notification.tenant_id ?? null,
    userId: notification.user_id,
    dedupeKey: notification.dedupe_key ?? null,
    type: notification.type,
    title: notification.title ?? null,
    body: notification.body ?? null,
    message: notification.message,
    entityType: notification.entity_type ?? null,
    entityId: notification.entity_id ?? null,
    deepLink: notification.deep_link ?? null,
    isRead: notification.is_read,
    relatedTaskId: notification.related_task_id,
    relatedRewardId: notification.related_reward_id,
    relatedChatId: notification.related_chat_id ?? null,
    createdAt: notification.created_at,
    source: 'api',
  };
}

function mapNotificationPreference(pref: ApiNotificationPreference): NotificationPreference {
  return {
    module: pref.module,
    pushEnabled: pref.push_enabled,
    updatedAt: pref.updated_at ?? null,
  };
}

function mapLevel(level: ApiLevel): Level {
  return {
    id: level.id,
    name: level.name,
    bgImage: level.bg_image,
    isActive: level.is_active,
    createdById: level.created_by_id,
    createdAt: level.created_at || new Date().toISOString(),
    updatedAt: level.updated_at,
  };
}

function mapSeason(season: ApiSeason): Season {
  return {
    id: season.id,
    name: season.name,
    description: season.description,
    startDate: season.start_date,
    endDate: season.end_date,
    isActive: season.is_active || false,
    theme: season.theme,
    bonusMultiplier: season.bonus_multiplier,
    createdAt: season.created_at || new Date().toISOString(),
    updatedAt: season.updated_at,
  };
}

function mapUserProgress(progress: ApiUserProgress): UserProgress {
  return {
    id: progress.id,
    userId: progress.user_id,
    levelId: progress.level_id,
    seasonId: progress.season_id,
    currentPoints: progress.current_points,
    totalPointsEarned: progress.total_points_earned,
    levelUnlockedAt: progress.level_unlocked_at || new Date().toISOString(),
    createdAt: progress.created_at || new Date().toISOString(),
    updatedAt: progress.updated_at,
  };
}

function mapLevelNode(node: ApiLevelNode): LevelNode {
  return {
    id: node.id,
    levelId: node.level_id,
    type: node.type as any,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    title: node.title,
    description: node.description,
    xpThreshold: node.xp_threshold,
    rewardId: node.reward_id,
    requireConfirm: node.require_confirm,
    animationKey: node.animation_key,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
  };
}

function mapLevelEdge(edge: ApiLevelEdge): LevelEdge {
  return {
    id: edge.id,
    levelId: edge.level_id,
    fromNode: edge.from_node,
    toNode: edge.to_node,
    path: edge.path,
    createdAt: edge.created_at,
    updatedAt: edge.updated_at,
  };
}

function mapLevelEvent(event: ApiLevelEvent): LevelEvent {
  return {
    id: event.id,
    levelId: event.level_id,
    nodeId: event.node_id,
    eventType: event.event_type as any,
    userId: event.user_id,
    createdAt: event.created_at,
  };
}

function mapLevelPreview(preview: ApiLevelPreviewResponse): LevelPreview {
  return {
    level: mapLevel(preview.level),
    nodes: preview.nodes.map(mapLevelNode),
    edges: preview.edges.map(mapLevelEdge),
    userXp: preview.user_xp,
    reachableNodes: preview.reachable_nodes,
  };
}

function mapUserBackup(user: ApiUserBackup): BackupUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    departmentId: user.department_id ?? null,
    managerId: user.manager_id ?? null,
    managerEmail: user.manager_email ?? undefined,
    shiftName: user.shift_name ?? undefined,
    shiftStart: user.shift_start ?? undefined,
    shiftEnd: user.shift_end ?? undefined,
    morningBreakStart: user.morning_break_start ?? undefined,
    morningBreakEnd: user.morning_break_end ?? undefined,
    lunchBreakStart: user.lunch_break_start ?? undefined,
    lunchBreakEnd: user.lunch_break_end ?? undefined,
    eveningBreakStart: user.evening_break_start ?? undefined,
    eveningBreakEnd: user.evening_break_end ?? undefined,
    title: user.title ?? undefined,
    phone: user.phone ?? undefined,
    location: user.location ?? undefined,
    timezone: user.timezone ?? undefined,
    notes: user.notes ?? undefined,
    skills: user.skills ?? undefined,
    projects: user.projects ?? undefined,
    points: user.points,
    tasksCreated: user.tasks_created,
    tasksCompleted: user.tasks_completed,
    clarityScores: user.clarity_scores ?? [],
    claimedRewardIds: user.claimed_reward_ids ?? [],
    unlockedAchievementIds: user.unlocked_achievement_ids ?? [],
    hashedPassword: user.hashed_password,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function mapTaskSubtaskBackup(subtask: ApiTaskSubtaskBackup): BackupTaskSubtask {
  return {
    id: subtask.id,
    title: subtask.title,
    completed: subtask.completed,
  };
}

function mapTaskCommentBackup(comment: ApiTaskCommentBackup): BackupTaskComment {
  return {
    id: comment.id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
  };
}

function mapTaskBackup(task: ApiTaskBackup): BackupTask {
  const assignedIds = task.assigned_to_ids ?? (task.assigned_to_id ? [task.assigned_to_id] : []);

  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    team: task.team,
    assignedToIds: assignedIds,
    taskGroupId: task.task_group_id ?? '',
    createdById: task.created_by_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    dueAt: task.due_at ?? null,
    completedAt: task.completed_at ?? null,
    recurrenceRule: task.recurrence_rule,
    recurringTaskId: task.recurring_task_id ?? null,
    clarityRating: task.clarity_rating ?? null,
    attachments: task.attachments ?? [],
    estimatedHours: task.estimated_hours ?? null,
    tags: task.tags ?? [],
    subtasks: (task.subtasks ?? []).map(mapTaskSubtaskBackup),
    comments: (task.comments ?? []).map(mapTaskCommentBackup),
    dependencies: task.dependencies ?? [],
  };
}

function mapNotificationBackup(notification: ApiNotificationBackup): BackupNotification {
  return {
    id: notification.id,
    userId: notification.user_id,
    type: notification.type,
    message: notification.message,
    isRead: notification.is_read,
    relatedTaskId: notification.related_task_id ?? null,
    relatedRewardId: notification.related_reward_id ?? null,
    relatedChatId: notification.related_chat_id ?? null,
    createdAt: notification.created_at,
  };
}

function mapUserRewardBackup(reward: ApiUserRewardBackup): BackupUserReward {
  return {
    id: reward.id,
    userId: reward.user_id,
    rewardId: reward.reward_id,
    status: reward.status,
    xpSpent: reward.xp_spent ?? 0,
    claimedAt: reward.claimed_at,
    resolvedAt: reward.resolved_at ?? null,
    approverId: reward.approver_id ?? null,
  };
}

function mapUserAchievementBackup(achievement: ApiUserAchievementBackup): BackupUserAchievement {
  return {
    userId: achievement.user_id,
    achievementId: achievement.achievement_id,
    unlockedAt: achievement.unlocked_at,
  };
}

function mapDataExportBundle(bundle: ApiDataExportBundle): DataExportBundle {
  return {
    scope: bundle.scope,
    generatedAt: bundle.generated_at,
    departments: (bundle.departments ?? []).map(mapDepartment),
    users: (bundle.users ?? []).map(mapUserBackup),
    tasks: (bundle.tasks ?? []).map(mapTaskBackup),
    achievements: (bundle.achievements ?? []).map(mapAchievement),
    rewards: (bundle.rewards ?? []).map(mapReward),
    kanbanColumns: (bundle.kanban_columns ?? []).map(mapKanbanColumn),
    notifications: (bundle.notifications ?? []).map(mapNotificationBackup),
    userRewards: (bundle.user_rewards ?? []).map(mapUserRewardBackup),
    userAchievements: (bundle.user_achievements ?? []).map(mapUserAchievementBackup),
  };
}

function toApiUserBackup(user: BackupUser): ApiUserBackup {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    department_id: user.departmentId ?? null,
    manager_id: user.managerId ?? null,
    manager_email: user.managerEmail ?? null,
    shift_name: user.shiftName ?? null,
    shift_start: user.shiftStart ?? null,
    shift_end: user.shiftEnd ?? null,
    morning_break_start: user.morningBreakStart ?? null,
    morning_break_end: user.morningBreakEnd ?? null,
    lunch_break_start: user.lunchBreakStart ?? null,
    lunch_break_end: user.lunchBreakEnd ?? null,
    evening_break_start: user.eveningBreakStart ?? null,
    evening_break_end: user.eveningBreakEnd ?? null,
    title: user.title ?? null,
    phone: user.phone ?? null,
    location: user.location ?? null,
    timezone: user.timezone ?? null,
    notes: user.notes ?? null,
    skills: user.skills ?? [],
    projects: user.projects ?? [],
    points: user.points,
    tasks_created: user.tasksCreated,
    tasks_completed: user.tasksCompleted,
    clarity_scores: user.clarityScores ?? [],
    claimed_reward_ids: user.claimedRewardIds ?? [],
    unlocked_achievement_ids: user.unlockedAchievementIds ?? [],
    hashed_password: user.hashedPassword,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

function toApiTaskSubtask(subtask: BackupTaskSubtask): ApiTaskSubtaskBackup {
  return {
    id: subtask.id,
    title: subtask.title,
    completed: subtask.completed,
  };
}

function toApiTaskComment(comment: BackupTaskComment): ApiTaskCommentBackup {
  return {
    id: comment.id,
    user_id: comment.userId,
    content: comment.content,
    created_at: comment.createdAt,
  };
}

function toApiTaskBackup(task: BackupTask): ApiTaskBackup {
  const normalizedAssigned = task.assignedToIds && task.assignedToIds.length > 0 ? task.assignedToIds : null;

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    team: task.team,
    assigned_to_ids: normalizedAssigned,
    assigned_to_id: normalizedAssigned ? normalizedAssigned[0] : null,
    task_group_id: task.taskGroupId ?? null,
    created_by_id: task.createdById,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    due_at: task.dueAt ?? null,
    completed_at: task.completedAt ?? null,
    recurrence_rule: task.recurrenceRule,
    recurring_task_id: task.recurringTaskId ?? null,
    clarity_rating: task.clarityRating ?? null,
    attachments: task.attachments ?? [],
    estimated_hours: task.estimatedHours ?? null,
    tags: task.tags ?? [],
    subtasks: (task.subtasks ?? []).map(toApiTaskSubtask),
    comments: (task.comments ?? []).map(toApiTaskComment),
    dependencies: task.dependencies ?? [],
  };
}


function toApiNotificationBackup(notification: BackupNotification): ApiNotificationBackup {
  return {
    id: notification.id,
    user_id: notification.userId,
    type: notification.type,
    message: notification.message,
    is_read: notification.isRead,
    related_task_id: notification.relatedTaskId ?? null,
    related_reward_id: notification.relatedRewardId ?? null,
    related_chat_id: notification.relatedChatId ?? null,
    created_at: notification.createdAt,
  };
}

function toApiUserRewardBackup(reward: BackupUserReward): ApiUserRewardBackup {
  return {
    id: reward.id,
    user_id: reward.userId,
    reward_id: reward.rewardId,
    status: reward.status,
    xp_spent: reward.xpSpent ?? 0,
    claimed_at: reward.claimedAt,
    resolved_at: reward.resolvedAt ?? null,
    approver_id: reward.approverId ?? null,
  };
}

function toApiUserAchievementBackup(achievement: BackupUserAchievement): ApiUserAchievementBackup {
  return {
    user_id: achievement.userId,
    achievement_id: achievement.achievementId,
    unlocked_at: achievement.unlockedAt,
  };
}

function toApiKanbanColumn(column: BackupKanbanColumn): ApiKanbanColumn {
  return {
    id: column.id,
    title: column.title,
    order: column.order,
  };
}

function toApiReward(reward: Reward): ApiReward {
  return {
    id: reward.id,
    title: reward.title,
    description: reward.description,
    image_source: reward.imageSource,
    image_ref: reward.imageRef ?? null,
    image_url: reward.imageUrl ?? null,
    xp_required: reward.xpRequired,
    dept_whitelist: reward.deptWhitelist ?? null,
    auto_redeem: reward.autoRedeem,
    allow_multiple_claims: reward.allowMultipleClaims,
    expires_at: reward.expiresAt ?? null,
    status: reward.status,
    created_by_id: reward.createdById ?? null,
    updated_by_id: reward.updatedById ?? null,
    created_at: reward.createdAt,
    updated_at: reward.updatedAt,
  };
}

function toApiImportPayload(payload: DataImportPayload): ApiDataImportPayload {
  return {
    scope: payload.scope ?? DataExportScope.ALL,
    departments: (payload.departments ?? []).map((department) => ({
      id: department.id,
      name: department.name,
    })),
    users: (payload.users ?? []).map(toApiUserBackup),
    tasks: (payload.tasks ?? []).map(toApiTaskBackup),
    achievements: payload.achievements ?? [],
    rewards: (payload.rewards ?? []).map(toApiReward),
    kanban_columns: (payload.kanbanColumns ?? []).map(toApiKanbanColumn),
    notifications: (payload.notifications ?? []).map(toApiNotificationBackup),
    user_rewards: (payload.userRewards ?? []).map(toApiUserRewardBackup),
    user_achievements: (payload.userAchievements ?? []).map(toApiUserAchievementBackup),
  };
}
let departmentCache: Department[] | null = null;

async function ensureDepartmentCache(): Promise<Department[]> {
  if (departmentCache) {
    return departmentCache;
  }
  const departments = await api.getDepartments();
  departmentCache = departments;
  return departments;
}

type CreateTaskPayload = {
  title: string;
  description: string;
  projectId?: string | null;
  assignedTo: string[] | null;
  followerIds?: string[] | null;
  taskGroupId?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  team: string;
  recurringTaskId: string | null;
  subtasks: Subtask[];
  attachments: string[];
  estimatedHours: number | null;
  recurrenceRule: RecurrenceRule;
  tags: string[];
  clarityRating?: number | null;
  subtaskApprovalRequired?: boolean | null;
};

type UpdateTaskPayload = Partial<CreateTaskPayload> & {
  completedAt?: string | null;
};

async function resolveDepartmentId(departmentName?: string | null): Promise<string | null> {
  if (!departmentName) {
    return null;
  }
  const departments = await ensureDepartmentCache();
  const match = departments.find((dept) => dept.name.toLowerCase() === departmentName.toLowerCase());
  return match ? match.id : null;
}

const api = {
  async login(email: string, pass: string): Promise<User> {
    try {
      const { data } = await http.post<AuthResponse>('/auth/login', { email, password: pass });
      storeTokens(data.token.access_token, data.token.refresh_token);
      return mapUser(data.user);
    } catch (error) {
      mapAxiosError(error);
    }
  },

    async getCurrentUser(): Promise<User | null> {
      try {
        const { data } = await http.get<ApiUser>('/auth/me', { timeout: 8000 });
        return mapUser(data);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.code === 'ECONNABORTED' || !error.response) {
            clearTokens();
            return null;
          }
          if (error.response?.status === 401) {
            clearTokens();
            notifyAuthExpired();
            return null;
          }
        }
        mapAxiosError(error);
      }
    },

    async getPresenceToken(): Promise<BearerTokenPreview> {
      try {
        const { data } = await http.get<BearerTokenPreview>('/auth/presence-token');
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getChatConversations(): Promise<ChatConversation[]> {
      try {
        const { data } = await http.get<ApiChatConversation[]>('/chat/conversations', { showGlobalProgress: false });
        return data.map(mapChatConversation);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getChatUsers(options?: { search?: string; cursor?: string | null; limit?: number; teamId?: string | null }): Promise<ChatDirectoryPage> {
      try {
        const { data } = await http.get<ApiChatDirectoryPage>('/chat/users', {
          params: {
            search: options?.search?.trim() || undefined,
            cursor: options?.cursor || undefined,
            limit: options?.limit ?? 100,
            team_id: options?.teamId || undefined,
          },
          showGlobalProgress: false,
        });
        return {
          items: data.items.map(mapChatDirectoryUser),
          nextCursor: data.next_cursor ?? null,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getChatConversation(conversationId: string): Promise<ChatConversation & { messages?: ChatMessage[] }> {
      try {
        const { data } = await http.get<ApiChatConversation & { messages?: ApiChatMessage[] }>(`/chat/conversations/${conversationId}`, { showGlobalProgress: false });
        return { ...mapChatConversation(data), messages: (data.messages ?? []).map(mapChatMessage) };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async createChatConversation(payload: ChatConversationCreatePayload): Promise<ChatConversation> {
      try {
        const { data } = await http.post<ApiChatConversation>('/chat/conversations', toApiChatConversationPayload(payload), { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatConversation(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async startDirectChat(payload: ChatDirectCreatePayload): Promise<ChatConversation> {
      try {
        const { data } = await http.post<ApiChatConversation>('/chat/direct', { user_id: payload.userId }, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatConversation(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getChatMessages(conversationId: string, options?: { cursor?: string | null; limit?: number }): Promise<ChatMessagePage> {
      try {
        const { data } = await http.get<ApiChatMessagePage>(`/chat/conversations/${conversationId}/messages`, {
          params: {
            cursor: options?.cursor || undefined,
            limit: options?.limit ?? 50,
          },
          showGlobalProgress: false,
        });
        return {
          items: data.items.map(mapChatMessage),
          nextCursor: data.next_cursor ?? null,
          hasMore: data.has_more,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async searchChatMessages(options: { q: string; conversationId?: string | null; senderId?: string | null; cursor?: string | null; limit?: number }): Promise<ChatMessageSearchPage> {
      try {
        const { data } = await http.get<ApiChatMessageSearchPage>('/chat/messages/search', {
          params: {
            q: options.q,
            conversation_id: options.conversationId || undefined,
            sender_id: options.senderId || undefined,
            cursor: options.cursor || undefined,
            limit: options.limit ?? 25,
          },
          showGlobalProgress: false,
        });
        return {
          items: data.items.map((item) => ({
            message: mapChatMessage(item.message),
            conversation: mapChatConversation(item.conversation),
          })),
          nextCursor: data.next_cursor ?? null,
          hasMore: data.has_more,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async sendChatMessage(conversationId: string, payload: ChatMessageCreatePayload): Promise<ChatMessage> {
      try {
        const { data } = await http.post<ApiChatMessage>(`/chat/conversations/${conversationId}/messages`, toApiChatMessagePayload(payload), { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMessage(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async updateChatMessage(messageId: string, content: string): Promise<ChatMessage> {
      try {
        const { data } = await http.patch<ApiChatMessage>(`/chat/messages/${messageId}`, { content }, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMessage(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async deleteChatMessage(messageId: string): Promise<void> {
      try {
        await http.delete(`/chat/messages/${messageId}`, { showGlobalProgress: false });
        invalidateCache('chat');
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async addChatMembers(conversationId: string, userIds: string[], role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER'): Promise<ChatMember[]> {
      try {
        const { data } = await http.post<ApiChatMember[]>(`/chat/conversations/${conversationId}/members`, {
          user_ids: userIds,
          role,
        }, { showGlobalProgress: false });
        invalidateCache('chat');
        return data.map(mapChatMember);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async updateChatMember(conversationId: string, userId: string, payload: { isPinned?: boolean; isMuted?: boolean }): Promise<ChatMember> {
      try {
        const { data } = await http.patch<ApiChatMember>(`/chat/conversations/${conversationId}/members/${userId}`, {
          is_pinned: payload.isPinned,
          is_muted: payload.isMuted,
        }, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMember(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async removeChatMember(conversationId: string, userId: string): Promise<void> {
      try {
        await http.delete(`/chat/conversations/${conversationId}/members/${userId}`, { showGlobalProgress: false });
        invalidateCache('chat');
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async markChatRead(conversationId: string, lastReadMessageId?: string | null): Promise<ChatMember> {
      try {
        const { data } = await http.post<ApiChatMember>(`/chat/conversations/${conversationId}/read`, {
          last_read_message_id: lastReadMessageId ?? null,
        }, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMember(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async addChatReaction(messageId: string, emoji: string): Promise<ChatMessage> {
      try {
        const { data } = await http.post<ApiChatMessage>(`/chat/messages/${messageId}/reactions`, { emoji }, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMessage(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async removeChatReaction(messageId: string, emoji: string): Promise<ChatMessage> {
      try {
        const { data } = await http.delete<ApiChatMessage>(`/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatMessage(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async uploadChatAttachment(conversationId: string, file: File, onProgress?: (progress: number) => void): Promise<ChatAttachment> {
      const progressTaskId = startProgressTask({ progress: 0 });
      try {
        const form = new FormData();
        form.append('file', file);
        const { data } = await http.post<Partial<ApiChatAttachment> & Pick<ApiChatAttachment, 'file_name' | 'original_file_name' | 'mime_type' | 'file_size' | 'storage_key'>>(`/chat/conversations/${conversationId}/attachments`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          showGlobalProgress: false,
          onUploadProgress: (event) => {
            if (event.total) {
              const percent = Math.round((event.loaded / event.total) * 100);
              updateProgressTask(progressTaskId, percent);
              onProgress?.(percent);
            }
          },
        });
        setGlobalProgress(100, progressTaskId);
        return {
          id: '',
          messageId: '',
          fileName: data.file_name,
          originalFileName: data.original_file_name,
          mimeType: data.mime_type,
          fileSize: data.file_size,
          storageKey: data.storage_key,
          url: data.url ?? null,
          createdAt: data.created_at ?? new Date().toISOString(),
        };
      } catch (error) {
        mapAxiosError(error);
      } finally {
        stopGlobalLoadingTask(progressTaskId);
      }
    },

    async getChatPinnedMessages(conversationId: string): Promise<ChatPinnedMessage[]> {
      try {
        const { data } = await http.get<ApiChatPinnedMessage[]>(`/chat/conversations/${conversationId}/pins`, { showGlobalProgress: false });
        return data.map(mapChatPinnedMessage);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async pinChatMessage(conversationId: string, messageId: string): Promise<ChatPinnedMessage> {
      try {
        const { data } = await http.post<ApiChatPinnedMessage>(`/chat/conversations/${conversationId}/messages/${messageId}/pin`, undefined, { showGlobalProgress: false });
        invalidateCache('chat');
        return mapChatPinnedMessage(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async unpinChatMessage(conversationId: string, messageId: string): Promise<void> {
      try {
        await http.delete(`/chat/conversations/${conversationId}/messages/${messageId}/pin`, { showGlobalProgress: false });
        invalidateCache('chat');
      } catch (error) {
        mapAxiosError(error);
      }
    },

  logout(): void {
    try {
      void http.post('/auth/logout', {});
    } catch {
    }
    clearTokens();
  },

  async forgotPassword(email: string): Promise<void> {
    try {
      await http.post('/auth/forgot-password', { email });
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getUsers(): Promise<User[]> {
    try {
      const cacheKey = 'users';
      const cached = getCached<User[]>(cacheKey);
      if (cached && cached.length > 0) {
        return cached;
      }
      const { data } = await http.get<ApiUser[]>('/users');
      const mapped = data.map(mapUser);
      if (mapped.length > 0) {
        setCached(cacheKey, mapped);
      }
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getClients(filters: ClientListFilters = {}): Promise<ClientListResponse> {
    try {
      const params = {
        page: filters.page ?? 1,
        page_size: filters.pageSize ?? 20,
        q: filters.q || undefined,
        status: filters.status || undefined,
        sort_by: filters.sortBy ?? 'company_name',
        sort_order: filters.sortOrder ?? 'asc',
      };
      const cacheKey = buildCacheKey('clients', params as Record<string, unknown>);
      const cached = getCached<ClientListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiClientListResponse>('/clients', { params });
      const mapped = {
        items: data.items.map(mapClient),
        page: data.page,
        pageSize: data.page_size,
        total: data.total,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getClient(clientId: string): Promise<Client> {
    try {
      const cacheKey = `client:${clientId}`;
      const cached = getCached<Client>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiClient>(`/clients/${clientId}`);
      const mapped = mapClient(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createClient(payload: ClientCreatePayload): Promise<Client> {
    try {
      const { data } = await http.post<ApiClient>('/clients', toApiClientPayload(payload));
      invalidateCache('clients');
      return mapClient(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateClient(clientId: string, payload: ClientUpdatePayload): Promise<Client> {
    try {
      const { data } = await http.patch<ApiClient>(`/clients/${clientId}`, toApiClientPayload(payload));
      invalidateCache('clients');
      invalidateCache(`client:${clientId}`);
      return mapClient(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async archiveClient(clientId: string, reason?: string): Promise<Client> {
    try {
      const { data } = await http.post<ApiClient>(`/clients/${clientId}/archive`, { reason: reason || null });
      invalidateCache('clients');
      invalidateCache(`client:${clientId}`);
      return mapClient(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getContacts(filters: ContactListFilters = {}): Promise<ContactListResponse> {
    try {
      const params = {
        page: filters.page ?? 1,
        page_size: filters.pageSize ?? 20,
        q: filters.q || undefined,
        client_id: filters.clientId || undefined,
        status: filters.status ?? undefined,
        sort_by: filters.sortBy ?? 'display_name',
        sort_order: filters.sortOrder ?? 'asc',
      };
      const cacheKey = `contacts:${JSON.stringify(params)}`;
      const cached = getCached<ContactListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiContactListResponse>('/contacts', { params });
      const mapped = {
        items: data.items.map(mapContact),
        page: data.page,
        pageSize: data.page_size,
        total: data.total,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getClientContacts(clientId: string): Promise<ContactListResponse> {
    try {
      const { data } = await http.get<ApiContactListResponse>(`/clients/${clientId}/contacts`, {
        params: { page_size: 100 },
      });
      return {
        items: data.items.map(mapContact),
        page: data.page,
        pageSize: data.page_size,
        total: data.total,
        totalPages: data.total_pages,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createContact(payload: ContactCreatePayload): Promise<Contact> {
    try {
      const { data } = await http.post<ApiContact>('/contacts', toApiContactPayload(payload));
      invalidateCache('contacts');
      return mapContact(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateContact(contactId: string, payload: ContactUpdatePayload): Promise<Contact> {
    try {
      const { data } = await http.patch<ApiContact>(`/contacts/${contactId}`, toApiContactPayload(payload));
      invalidateCache('contacts');
      return mapContact(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async archiveContact(contactId: string, reason?: string): Promise<Contact> {
    try {
      const { data } = await http.post<ApiContact>(`/contacts/${contactId}/archive`, { reason: reason || null });
      invalidateCache('contacts');
      return mapContact(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async linkContactToClient(contactId: string, clientId: string, isPrimary = false): Promise<Contact> {
    try {
      const { data } = await http.post<ApiContact>(`/contacts/${contactId}/clients/${clientId}`, { is_primary: isPrimary });
      invalidateCache('contacts');
      return mapContact(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async unlinkContactFromClient(contactId: string, clientId: string): Promise<void> {
    try {
      await http.delete(`/contacts/${contactId}/clients/${clientId}`);
      invalidateCache('contacts');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getProjects(filters: ProjectListFilters = {}): Promise<ProjectListResponse> {
    try {
      const params = {
        page: filters.page ?? 1,
        page_size: filters.pageSize ?? 20,
        q: filters.q || undefined,
        client_id: filters.clientId || undefined,
        status: filters.status || undefined,
        mine: filters.mine || undefined,
        sort_by: filters.sortBy ?? 'name',
        sort_order: filters.sortOrder ?? 'asc',
      };
      const cacheKey = buildCacheKey('projects', params as Record<string, unknown>);
      const cached = getCached<ProjectListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiProjectListResponse>('/projects', { params });
      const mapped = {
        items: data.items.map(mapProject),
        page: data.page,
        pageSize: data.page_size,
        total: data.total,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getProject(projectId: string): Promise<Project> {
    try {
      const cacheKey = `project:${projectId}`;
      const cached = getCached<Project>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiProject>(`/projects/${projectId}`);
      const mapped = mapProject(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createProject(payload: ProjectCreatePayload): Promise<Project> {
    try {
      const { data } = await http.post<ApiProject>('/projects', toApiProjectPayload(payload));
      invalidateCache('projects');
      return mapProject(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateProject(projectId: string, payload: ProjectUpdatePayload): Promise<Project> {
    try {
      const { data } = await http.patch<ApiProject>(`/projects/${projectId}`, toApiProjectPayload(payload));
      invalidateCache('projects');
      invalidateCache(`project:${projectId}`);
      return mapProject(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async replaceProjectMembers(projectId: string, payload: ProjectMembershipPayload): Promise<Project> {
    try {
      const { data } = await http.put<ApiProject>(`/projects/${projectId}/members`, toApiProjectPayload(payload));
      invalidateCache('projects');
      invalidateCache(`project:${projectId}`);
      return mapProject(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async archiveProject(projectId: string, reason?: string): Promise<Project> {
    try {
      const { data } = await http.post<ApiProject>(`/projects/${projectId}/archive`, { reason: reason || null });
      invalidateCache('projects');
      invalidateCache(`project:${projectId}`);
      return mapProject(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getProjectTaskDashboard(projectId: string, params: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: TaskStatus | '';
    priority?: TaskPriority | '';
    memberId?: string;
    signal?: AbortSignal;
  } = {}): Promise<ProjectTaskDashboardResponse> {
    try {
      const query = {
        page: params.page ?? 1,
        page_size: params.pageSize ?? 20,
        q: params.q || undefined,
        status: params.status || undefined,
        priority: params.priority || undefined,
        member_id: params.memberId || undefined,
      };
      const { data } = await http.get<ApiProjectTaskDashboardResponse>(`/projects/${projectId}/task-dashboard`, {
        params: query,
        signal: params.signal,
      });
      return mapProjectTaskDashboard(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async overrideProjectTaskStatus(projectId: string, taskId: string, status: TaskStatus, reason: string): Promise<ProjectDashboardTask> {
    try {
      const { data } = await http.patch<ApiProjectDashboardTask>(`/projects/${projectId}/tasks/${taskId}/status`, {
        status,
        reason,
      });
      invalidateCache('tasks');
      invalidateCache('projects');
      invalidateCache(`project:${projectId}`);
      return mapProjectDashboardTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createUser(
    userData: Omit<User, 'id' | 'passwordHash' | 'status' | 'points' | 'unlockedAchievementIds' | 'tasksCreated' | 'tasksCompleted' | 'clarityScores' | 'claimedRewardIds'> & { password: string },
    _currentUserId: string
  ): Promise<User> {
    try {
      const departmentId = await resolveDepartmentId(userData.department);
      const payload = {
        name: userData.name,
        email: userData.email,
        employer_id: userData.employerId || null,
        role: userData.role,
        password: userData.password,
        department_id: departmentId,
        avatar_asset_id: userData.avatarAssetId ?? null,
        avatar_frame: userData.avatarFrame ?? null,
      };
      const { data } = await http.post<ApiUser>('/users', payload);
      departmentCache = null;
      invalidateCache('users');
      return mapUser(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateUser(userId: string, updates: Partial<User>, _currentUserId: string): Promise<User> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.role !== undefined) body.role = updates.role;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.employerId !== undefined) body.employer_id = updates.employerId === '' ? null : updates.employerId;
      if (updates.department !== undefined) {
        body.department_id = await resolveDepartmentId(updates.department);
      }
      if (updates.managerId !== undefined) body.manager_id = updates.managerId || null;
      if (updates.managerEmail !== undefined) body.manager_email = updates.managerEmail || null;
      if (updates.shiftName !== undefined) body.shift_name = updates.shiftName || null;
      if (updates.shiftStart !== undefined) body.shift_start = updates.shiftStart || null;
      if (updates.shiftEnd !== undefined) body.shift_end = updates.shiftEnd || null;
      if (updates.morningBreakStart !== undefined) body.morning_break_start = updates.morningBreakStart || null;
      if (updates.morningBreakEnd !== undefined) body.morning_break_end = updates.morningBreakEnd || null;
      if (updates.lunchBreakStart !== undefined) body.lunch_break_start = updates.lunchBreakStart || null;
      if (updates.lunchBreakEnd !== undefined) body.lunch_break_end = updates.lunchBreakEnd || null;
      if (updates.eveningBreakStart !== undefined) body.evening_break_start = updates.eveningBreakStart || null;
      if (updates.eveningBreakEnd !== undefined) body.evening_break_end = updates.eveningBreakEnd || null;
      if (updates.title !== undefined) body.title = updates.title || null;
      if (updates.phone !== undefined) body.phone = updates.phone || null;
      if (updates.location !== undefined) body.location = updates.location || null;
      if (updates.timezone !== undefined) body.timezone = updates.timezone || null;
      if (updates.notes !== undefined) body.notes = updates.notes || null;
      if (updates.skills !== undefined) body.skills = updates.skills ?? [];
      if (updates.projects !== undefined) body.projects = updates.projects ?? [];
      if (updates.avatarAssetId !== undefined) body.avatar_asset_id = updates.avatarAssetId ?? null;
      if (updates.avatarFrame !== undefined) body.avatar_frame = updates.avatarFrame ?? null;
      if (updates.points !== undefined) body.points = updates.points;
      if (updates.tasksCreated !== undefined) body.tasks_created = updates.tasksCreated;
      if (updates.tasksCompleted !== undefined) body.tasks_completed = updates.tasksCompleted;
      if (updates.clarityScores !== undefined) body.clarity_scores = updates.clarityScores;
      if (updates.claimedRewardIds !== undefined) body.claimed_reward_ids = updates.claimedRewardIds;
      if (updates.unlockedAchievementIds !== undefined) body.unlocked_achievement_ids = updates.unlockedAchievementIds;
      if (Object.keys(body).length === 0) {
        const { data } = await http.get<ApiUser>(`/users/${userId}`);
        return mapUser(data);
      }
      const { data } = await http.patch<ApiUser>(`/users/${userId}`, body);
      if (updates.department !== undefined) {
        departmentCache = null;
      }
      invalidateCache('users');
      return mapUser(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },
  async deleteUser(userId: string, _requesterId: string): Promise<void> {
    try {
      await http.delete(`/users/${userId}`);
      invalidateCache('users');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateCurrentUserProfile(userId: string, updates: Partial<Pick<User, 'name' | 'department' | 'employerId' | 'avatarAssetId' | 'avatarFrame'>>): Promise<User> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.department !== undefined) {
        body.department_id = await resolveDepartmentId(updates.department);
      }
      if (updates.avatarAssetId !== undefined) body.avatar_asset_id = updates.avatarAssetId ?? null;
      if (updates.avatarFrame !== undefined) body.avatar_frame = updates.avatarFrame ?? null;
      if (updates.employerId !== undefined) body.employer_id = updates.employerId || null;
      const { data } = await http.patch<ApiUser>('/users/me', body);
      if (updates.department !== undefined) {
        departmentCache = null;
      }
      invalidateCache('users');
      return mapUser(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadUserAvatar(userId: string, dataUrl: string): Promise<User> {
    try {
      const { data } = await http.post<ApiUser>(`/users/${userId}/avatar`, { data_url: dataUrl });
      return mapUser(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadCurrentUserAvatar(dataUrl: string): Promise<User> {
    try {
      const { data } = await http.post<ApiUser>('/users/me/avatar', { data_url: dataUrl });
      return mapUser(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getAvatarAssets(): Promise<AvatarAsset[]> {
    try {
      const cacheKey = 'avatar-assets';
      const cached = getCached<AvatarAsset[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiAvatarAsset[]>('/avatars');
      const mapped = data.map((asset) => {
        const mapped = mapAvatarAsset(asset);
        if (!mapped) {
          throw new Error('Failed to map avatar asset');
        }
        return mapped;
      });
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createAvatarAsset(payload: { name: string; storageType: 'data_url' | 'external_url'; dataUrl?: string; externalUrl?: string }): Promise<AvatarAsset> {
    try {
      const body: Record<string, unknown> = {
        name: payload.name,
        storage_type: payload.storageType,
        data_url: payload.dataUrl ?? null,
        external_url: payload.externalUrl ?? null,
      };
      const { data } = await http.post<ApiAvatarAsset>('/avatars', body);
      const mapped = mapAvatarAsset(data);
      if (!mapped) {
        throw new Error('Failed to map avatar asset');
      }
      invalidateCache('avatar-assets');
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateAvatarAsset(avatarId: string, updates: { name?: string; dataUrl?: string; externalUrl?: string }): Promise<AvatarAsset> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.dataUrl !== undefined) body.data_url = updates.dataUrl;
      if (updates.externalUrl !== undefined) body.external_url = updates.externalUrl;
      const { data } = await http.patch<ApiAvatarAsset>(`/avatars/${avatarId}`, body);
      const mapped = mapAvatarAsset(data);
      if (!mapped) {
        throw new Error('Failed to map avatar asset');
      }
      invalidateCache('avatar-assets');
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteAvatarAsset(avatarId: string): Promise<void> {
    try {
      await http.delete(`/avatars/${avatarId}`);
      invalidateCache('avatar-assets');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async resetPassword(userId: string, newPass: string): Promise<void> {
    try {
      await http.post(`/users/${userId}/reset-password`, {
        new_password: newPass,
      });
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async changeCurrentUserPassword(userId: string, oldPass: string, newPass: string): Promise<void> {
    try {
      await http.post('/users/me/change-password', {
        old_password: oldPass,
        new_password: newPass,
      });
    } catch (error) {
      mapAxiosError(error);
    }
  },

    async getTasks(_userId: string, _userRole: Role): Promise<Task[]> {
      try {
      const cacheKey = buildCacheKey('tasks', { userId: _userId, role: _userRole });
      const cached = getCached<Task[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiTask[]>('/tasks');
      const mapped = data.map(mapTask);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getLeaderboardTasks(): Promise<Task[]> {
    try {
      const cacheKey = 'tasks:leaderboard';
      const cached = getCached<Task[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiLeaderboardTask[]>('/tasks/leaderboard');
      const mapped = data.map(mapLeaderboardTask);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },


  async getTask(taskId: string): Promise<Task> {
    try {
      const cacheKey = `task:${taskId}`;
      const cached = getCached<Task>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiTask>(`/tasks/${taskId}`);
      const mapped = mapTask(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getTaskGroup(taskId: string): Promise<Task[]> {
    try {
      const cacheKey = `task-group:${taskId}`;
      const cached = getCached<Task[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiTask[]>(`/tasks/${taskId}/group`);
      const mapped = (data ?? []).map(mapTask);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createTask(taskData: CreateTaskPayload, _creatorId: string): Promise<Task[]> {
    try {
      const normalizedAssignedTo = taskData.assignedTo && taskData.assignedTo.length > 0 ? taskData.assignedTo : null;
      const payload = {
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        priority: taskData.priority,
        team: taskData.team,
        project_id: taskData.projectId ?? null,
        assigned_to_ids: normalizedAssignedTo,
        assigned_to_id: normalizedAssignedTo ? normalizedAssignedTo[0] : null,
        follower_ids: taskData.followerIds ?? [],
        task_group_id: taskData.taskGroupId ?? null,
        due_at: taskData.dueAt,
        recurrence_rule: taskData.recurrenceRule,
        recurring_task_id: taskData.recurringTaskId,
        clarity_rating: taskData.clarityRating ?? null,
        attachments: taskData.attachments,
        estimated_hours: taskData.estimatedHours,
        tags: taskData.tags,
        subtask_approval_required: taskData.subtaskApprovalRequired ?? null,
        subtasks: taskData.subtasks.map((sub, index) => ({
          title: sub.title,
          completed: sub.completed,
          assigned_to_id: sub.assignedToId ?? null,
          status: sub.status ?? (sub.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO),
          sort_order: sub.sortOrder ?? index,
        })),
      };
      const { data } = await http.post<ApiTask[]>('/tasks', payload);
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      const mapped = (data ?? []).map(mapTask);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

    async updateTask(taskId: string, updates: UpdateTaskPayload, _updaterId: string): Promise<Task> {
      try {
      const body: Record<string, unknown> = {};
      if (updates.title !== undefined) body.title = updates.title;
      if (updates.description !== undefined) body.description = updates.description;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.priority !== undefined) body.priority = updates.priority;
      if (updates.team !== undefined) body.team = updates.team;
      if (updates.projectId !== undefined) body.project_id = updates.projectId ?? null;
      if (updates.assignedTo !== undefined) {
        const nextAssignee = updates.assignedTo && updates.assignedTo.length > 0 ? updates.assignedTo[0] : null;
        body.assigned_to_id = nextAssignee;
      }
      if (updates.followerIds !== undefined) body.follower_ids = updates.followerIds ?? [];
      if (updates.dueAt !== undefined) body.due_at = updates.dueAt;
      if (updates.completedAt !== undefined) body.completed_at = updates.completedAt;
      if (updates.recurrenceRule !== undefined) body.recurrence_rule = updates.recurrenceRule;
      if (updates.recurringTaskId !== undefined) body.recurring_task_id = updates.recurringTaskId;
      if (updates.clarityRating !== undefined) body.clarity_rating = updates.clarityRating;
      if (updates.attachments !== undefined) body.attachments = updates.attachments;
      if (updates.estimatedHours !== undefined) body.estimated_hours = updates.estimatedHours;
      if (updates.tags !== undefined) body.tags = updates.tags;
      if (updates.subtaskApprovalRequired !== undefined) {
        body.subtask_approval_required = updates.subtaskApprovalRequired;
      }
      if (updates.subtasks !== undefined) {
        body.subtasks = updates.subtasks.map((sub) => ({
          id: sub.id,
          title: sub.title,
          completed: sub.completed,
          assigned_to_id: sub.assignedToId ?? null,
          status: sub.status ?? (sub.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO),
          sort_order: sub.sortOrder ?? 0,
        }));
      }
      const { data } = await http.patch<ApiTask>(`/tasks/${taskId}`, body);
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      invalidateCache('comments:');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async submitSubtaskCompletion(taskId: string, subtaskId: string, description: string, files: File[] = []): Promise<Task> {
    try {
      const formData = new FormData();
      formData.append('description', description);
      files.forEach((file) => formData.append('files', file));
      const { data } = await http.post<ApiTask>(`/tasks/${taskId}/subtasks/${subtaskId}/completion-submissions`, formData);
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async approveSubtaskCompletion(taskId: string, subtaskId: string, submissionId: string): Promise<Task> {
    try {
      const { data } = await http.post<ApiTask>(
        `/tasks/${taskId}/subtasks/${subtaskId}/completion-submissions/${submissionId}/approve`,
      );
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async rejectSubtaskCompletion(taskId: string, subtaskId: string, submissionId: string, reviewReason: string): Promise<Task> {
    try {
      const { data } = await http.post<ApiTask>(
        `/tasks/${taskId}/subtasks/${subtaskId}/completion-submissions/${submissionId}/reject`,
        { review_reason: reviewReason },
      );
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },


  async deleteTask(taskId: string): Promise<void> {
    try {
      await http.delete(`/tasks/${taskId}`);
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      invalidateCache('comments:');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateSubtask(taskId: string, subtaskId: string, updates: Partial<Subtask>): Promise<Task> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.title !== undefined) body.title = updates.title;
      if (updates.completed !== undefined) body.completed = updates.completed;
      if (updates.assignedToId !== undefined) body.assigned_to_id = updates.assignedToId;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.sortOrder !== undefined) body.sort_order = updates.sortOrder;
      if (updates.forceStartReason !== undefined) body.force_start_reason = updates.forceStartReason;
      const { data } = await http.patch<ApiTask>(`/tasks/${taskId}/subtasks/${subtaskId}`, body);
      invalidateCache('tasks');
      invalidateCache('task:');
      invalidateCache('task-group:');
      invalidateCache('comments:');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getActiveTimeEntry(): Promise<TimeEntry | null> {
    try {
      const { data } = await http.get<{ active: ApiTimeEntry | null }>('/time-entries/active');
      return data.active ? mapTimeEntry(data.active) : null;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async startTimeEntry(target: { taskId?: string | null; subtaskId?: string | null; note?: string | null }): Promise<TimeEntry> {
    try {
      const { data } = await http.post<ApiTimeEntry>('/time-entries/start', {
        task_id: target.taskId ?? null,
        subtask_id: target.subtaskId ?? null,
        note: target.note ?? null,
      });
      invalidateCache('tasks');
      invalidateCache('task:');
      return mapTimeEntry(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async stopTimeEntry(entryId?: string | null): Promise<TimeEntry | null> {
    try {
      const { data } = await http.post<ApiTimeEntry | null>('/time-entries/stop', {
        entry_id: entryId ?? null,
      });
      invalidateCache('tasks');
      invalidateCache('task:');
      return data ? mapTimeEntry(data) : null;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async resumeTimeEntry(entryId: string): Promise<TimeEntry> {
    try {
      const { data } = await http.post<ApiTimeEntry>(`/time-entries/${entryId}/resume`);
      invalidateCache('tasks');
      invalidateCache('task:');
      return mapTimeEntry(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getTickets(filters: TicketListFilters = {}): Promise<Ticket[]> {
    const params = {
      status: filters.status ?? undefined,
      priority: filters.priority ?? undefined,
      department_id: filters.departmentId ?? undefined,
      assignee_id: filters.assigneeId ?? undefined,
      follower_id: filters.followerId ?? undefined,
      search: filters.search ?? undefined,
      myTickets: filters.myTickets ?? undefined,
    };
    try {
      const cacheKey = buildCacheKey('tickets', filters as Record<string, unknown>);
      const cached = getCached<Ticket[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const response = await http.get<{ success: boolean; data: ApiTicket[] }>(TICKETS_BASE_PATH, {
        params,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      });
      if (response.status === 404) {
        console.warn('Tickets API returned 404', {
          baseURL: http.defaults.baseURL,
          path: TICKETS_BASE_PATH,
          params,
        });
        setCached(cacheKey, []);
        return [];
      }
      const { data } = response;
      if (!data.success) {
        throw new Error('Ticket list fetch failed');
      }
      const mapped = (data.data ?? []).map(mapTicket);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getTicket(ticketId: string): Promise<Ticket> {
    try {
      const cacheKey = `ticket:${ticketId}`;
      const cached = getCached<Ticket>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}`);
      const mapped = mapTicket(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createTicket(payload: TicketCreatePayload): Promise<Ticket> {
    try {
      const approvalApprovers = payload.approvers ?? [];
      const body = {
        title: payload.title,
        description: payload.description,
        department_id: payload.departmentId ?? null,
        owner_id: payload.ownerId ?? null,
        assigned_user_id: payload.assignedUserId ?? null,
        priority: payload.priority ?? TicketPriority.MEDIUM,
        due_date: payload.dueDate ?? null,
        followers: payload.followers ?? [],
        approval_enabled: payload.approvalEnabled ?? false,
        approval_type: payload.approvalType ?? null,
        min_approvals: payload.minApprovals ?? null,
        approvers: approvalApprovers,
        approval_deadline: payload.approvalDeadline ?? null,
      };
      const { data } = await http.post<ApiTicket>(TICKETS_BASE_PATH, body);
      invalidateCache('tickets');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateTicket(ticketId: string, updates: TicketUpdatePayload): Promise<Ticket> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.title !== undefined) body.title = updates.title;
      if (updates.description !== undefined) body.description = updates.description;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.priority !== undefined) body.priority = updates.priority;
      if (updates.ownerId !== undefined) body.owner_id = updates.ownerId ?? null;
      if (updates.assignedUserId !== undefined) body.assigned_user_id = updates.assignedUserId ?? null;
      if (updates.dueDate !== undefined) body.due_date = updates.dueDate ?? null;
      if (updates.approvalEnabled !== undefined) body.approval_enabled = updates.approvalEnabled;
      if (updates.approvalType !== undefined) body.approval_type = updates.approvalType ?? null;
      if (updates.minApprovals !== undefined) body.min_approvals = updates.minApprovals ?? null;
      if (updates.approvalDeadline !== undefined) body.approval_deadline = updates.approvalDeadline ?? null;
      if (updates.approvers !== undefined) body.approvers = updates.approvers ?? [];
      const { data } = await http.patch<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}`, body);
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteTicket(ticketId: string): Promise<void> {
    try {
      await http.delete(`${TICKETS_BASE_PATH}/${ticketId}`);
      invalidateCache('tickets');
      invalidateCache('ticket:');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async transferTicket(ticketId: string, payload: TicketTransferPayload): Promise<Ticket> {
    try {
      const { data } = await http.post<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}/transfer`, {
        department_id: payload.departmentId,
      });
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateTicketParticipants(ticketId: string, payload: TicketParticipantsUpdate): Promise<Ticket> {
    try {
      const body = {
        add: payload.add.map((entry) => ({ user_id: entry.userId, role: entry.role })),
        remove: payload.remove.map((entry) => ({ user_id: entry.userId, role: entry.role })),
      };
      const { data } = await http.post<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}/participants`, body);
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketParticipants(ticketId: string): Promise<TicketParticipant[]> {
    try {
      const { data } = await http.get<ApiTicketParticipant[]>(`${TICKETS_BASE_PATH}/${ticketId}/participants`);
      return data.map(mapTicketParticipant);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketFollowers(ticketId: string): Promise<TicketFollower[]> {
    try {
      const { data } = await http.get<ApiTicketFollower[]>(`${TICKETS_BASE_PATH}/${ticketId}/followers`);
      return data.map(mapTicketFollower);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketActivity(ticketId: string): Promise<TicketActivityItem[]> {
    try {
      const { data } = await http.get<ApiTicketActivity[]>(`${TICKETS_BASE_PATH}/${ticketId}/activity`);
      return data.map(mapTicketActivity);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketApprovals(ticketId: string): Promise<TicketApprovalCycle[]> {
    try {
      const { data } = await http.get<ApiTicketApprovalCycle[]>(`${TICKETS_BASE_PATH}/${ticketId}/approvals`);
      return data.map(mapTicketApprovalCycle);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async requestTicketApproval(
    ticketId: string,
    payload: TicketApprovalRequestPayload,
  ): Promise<TicketApprovalCycle> {
    try {
      const { data } = await http.post<ApiTicketApprovalCycle>(`${TICKETS_BASE_PATH}/${ticketId}/approvals/request`, {
        approval_type: payload.approvalType,
        deadline_utc: payload.deadlineUtc ?? null,
        approvers: payload.approvers.map((item) => ({
          approver_user_id: item.approverUserId,
          message: item.message,
        })),
      });
      invalidateCache('ticket:');
      return mapTicketApprovalCycle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async approveTicketApproval(cycleId: string, payload: TicketApprovalActionPayload): Promise<TicketApprovalCycle> {
    try {
      const { data } = await http.post<ApiTicketApprovalCycle>(`/approvals/${cycleId}/approve`, {
        message: payload.message ?? null,
      });
      invalidateCache('ticket:');
      return mapTicketApprovalCycle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async rejectTicketApproval(cycleId: string, payload: TicketApprovalActionPayload): Promise<TicketApprovalCycle> {
    try {
      const { data } = await http.post<ApiTicketApprovalCycle>(`/approvals/${cycleId}/reject`, {
        message: payload.message ?? null,
      });
      invalidateCache('ticket:');
      return mapTicketApprovalCycle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async approveTicket(ticketId: string, payload: TicketApprovalActionPayload): Promise<TicketApprovalCycle> {
    try {
      const { data } = await http.post<ApiTicketApprovalCycle>(`${TICKETS_BASE_PATH}/${ticketId}/approve`, {
        message: payload.message ?? null,
      });
      invalidateCache('ticket:');
      return mapTicketApprovalCycle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async rejectTicket(ticketId: string, payload: TicketApprovalActionPayload): Promise<TicketApprovalCycle> {
    try {
      const { data } = await http.post<ApiTicketApprovalCycle>(`${TICKETS_BASE_PATH}/${ticketId}/reject`, {
        message: payload.message ?? null,
      });
      invalidateCache('ticket:');
      return mapTicketApprovalCycle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listPendingApprovals(includeAll = false): Promise<PendingApprovalItem[]> {
    try {
      const { data } = await http.get<PendingApprovalItem[]>('/approvals/pending', {
        params: { includeAll },
      });
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateTicketStatus(ticketId: string, payload: TicketStatusUpdatePayload): Promise<{ ticketId: string; status: TicketStatus }> {
    try {
      const { data } = await http.post<{ ticket_id: string; status: TicketStatus }>(`${TICKETS_BASE_PATH}/${ticketId}/status`, {
        status: payload.status,
      });
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return { ticketId: data.ticket_id, status: data.status };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketTasks(ticketId: string): Promise<TicketLinkedTask[]> {
    try {
      const { data } = await http.get<ApiTicketLinkedTask[]>(`${TICKETS_BASE_PATH}/${ticketId}/tasks`);
      return data.map(mapTicketLinkedTask);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createTicketTask(ticketId: string, payload: TicketLinkedTaskCreatePayload): Promise<TicketLinkedTask> {
    try {
      const { data } = await http.post<ApiTicketLinkedTask>(`${TICKETS_BASE_PATH}/${ticketId}/tasks`, {
        due_at: payload.dueAt ?? null,
        priority: payload.priority,
        approval_required: payload.approvalRequired,
        approver_id: payload.approverId ?? null,
      });
      invalidateCache('ticket:');
      return mapTicketLinkedTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateTicketTask(taskId: string, payload: TicketLinkedTaskUpdatePayload): Promise<TicketLinkedTask> {
    try {
      const { data } = await http.patch<ApiTicketLinkedTask>(`/tasks/${taskId}`, {
        due_at: payload.dueAt ?? undefined,
        priority: payload.priority ?? undefined,
        status: payload.status ?? undefined,
        approval_required: payload.approvalRequired ?? undefined,
        approver_id: payload.approverId ?? undefined,
      });
      invalidateCache('ticket:');
      return mapTicketLinkedTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async completeTicketTask(taskId: string): Promise<TicketLinkedTask> {
    try {
      const { data } = await http.post<ApiTicketLinkedTask>(`/tasks/${taskId}/complete`, {});
      invalidateCache('ticket:');
      return mapTicketLinkedTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketLogs(ticketId: string, page = 1, pageSize = 25): Promise<TicketAuditLogPage> {
    try {
      const { data } = await http.get<ApiTicketAuditLogPage>(`${TICKETS_BASE_PATH}/${ticketId}/logs`, {
        params: { page, page_size: pageSize },
      });
      return {
        items: data.items.map((item) => ({
          id: item.id,
          ticketId: item.ticket_id,
          eventType: item.event_type,
          actorUserId: item.actor_user_id ?? null,
          createdAtUtc: item.created_at_utc,
          summary: item.summary,
          payloadJson: item.payload_json ?? null,
        })),
        total: data.total,
        page: data.page,
        pageSize: data.page_size,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getTicketTimeline(ticketId: string): Promise<TicketTimeline> {
    try {
      const { data } = await http.get<ApiTicketTimeline>(`${TICKETS_BASE_PATH}/${ticketId}/timeline`);
      return mapTicketTimeline(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async exportTicketTimelineCsv(ticketId: string): Promise<{ blob: Blob; filename: string }> {
    try {
      const response = await http.get<Blob>(`${TICKETS_BASE_PATH}/${ticketId}/timeline.csv`, {
        responseType: 'blob',
      });
      const header = response.headers['content-disposition'] as string | undefined;
      const match = header?.match(/filename=\"?([^\";]+)\"?/);
      const filename = match?.[1] ?? `ticket-${ticketId}-timeline.csv`;
      return { blob: response.data, filename };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async closeTicket(ticketId: string, payload: TicketClosePayload): Promise<Ticket> {
    try {
      const { data } = await http.post<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}/close`, {
        resolution_type: payload.resolutionType,
        duplicate_ticket_id: payload.duplicateTicketId ?? undefined,
      });
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async reopenTicket(ticketId: string): Promise<Ticket> {
    try {
      const { data } = await http.post<ApiTicket>(`${TICKETS_BASE_PATH}/${ticketId}/reopen`, {});
      invalidateCache('tickets');
      invalidateCache('ticket:');
      return mapTicket(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createTaskFromTicket(ticketId: string): Promise<Task> {
    try {
      const { data } = await http.post<ApiTask>(`${TICKETS_BASE_PATH}/${ticketId}/tasks/create`, {});
      invalidateCache('tasks');
      return mapTask(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async splitTicketIntoTasks(ticketId: string, payload: TicketTaskSplitRequest): Promise<Task[]> {
    try {
      const { data } = await http.post<ApiTask[]>(`${TICKETS_BASE_PATH}/${ticketId}/tasks/split`, {
        tasks: payload.tasks,
      });
      invalidateCache('tasks');
      return (data ?? []).map(mapTask);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async presignTicketAttachment(
    ticketId: string,
    payload: TicketAttachmentPresignRequest,
  ): Promise<TicketAttachmentPresignResponse> {
    try {
      const { data } = await http.post<TicketAttachmentPresignResponse>(
        `${TICKETS_BASE_PATH}/${ticketId}/attachments/presign`,
        payload,
      );
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async confirmTicketAttachment(
    ticketId: string,
    payload: TicketAttachmentConfirmRequest,
  ): Promise<TicketAttachment> {
    try {
      const { data } = await http.post<ApiTicketAttachment>(
        `${TICKETS_BASE_PATH}/${ticketId}/attachments/confirm`,
        payload,
      );
      invalidateCache('ticket-attachments:');
      return mapTicketAttachment(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
    try {
      const cacheKey = `ticket-attachments:${ticketId}`;
      const cached = getCached<TicketAttachment[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiTicketAttachment[]>(`${TICKETS_BASE_PATH}/${ticketId}/attachments`);
      const mapped = data.map(mapTicketAttachment);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteTicketAttachment(ticketId: string, attachmentId: string): Promise<void> {
    try {
      await http.delete(`${TICKETS_BASE_PATH}/${ticketId}/attachments/${attachmentId}`);
      invalidateCache('ticket-attachments:');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getComments(taskId: string): Promise<Comment[]> {
    try {
      const cacheKey = `comments:${taskId}`;
      const cached = getCached<Comment[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiComment[]>(`/comments/task/${taskId}`);
      const mapped = data.map(mapComment);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async addComment(commentData: Omit<Comment, 'id' | 'createdAt'>): Promise<Comment> {
    try {
      const { data } = await http.post<ApiComment>('/comments', {
        task_id: commentData.taskId,
        user_id: commentData.userId,
        content: commentData.content,
      });
      invalidateCache('comments:');
      invalidateCache('task:');
      return mapComment(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getDepartments(): Promise<Department[]> {
    try {
      const cacheKey = 'departments';
      const cached = getCached<Department[]>(cacheKey);
      if (cached) {
        departmentCache = cached;
        return cached;
      }
      const { data } = await http.get<ApiDepartment[]>('/departments');
      const departments = data.map(mapDepartment);
      departmentCache = departments;
      setCached(cacheKey, departments);
      return departments;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async addDepartment(name: string): Promise<Department> {
    try {
      const { data } = await http.post<ApiDepartment>('/departments', { name });
      const department = mapDepartment(data);
      departmentCache = departmentCache ? [...departmentCache, department] : [department];
      invalidateCache('departments');
      invalidateCache('users');
      return department;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateDepartment(departmentId: string, name: string): Promise<Department> {
    try {
      const { data } = await http.patch<ApiDepartment>(`/departments/${departmentId}`, { name });
      const department = mapDepartment(data);
      if (departmentCache) {
        const exists = departmentCache.some((dept) => dept.id === departmentId);
        departmentCache = exists
          ? departmentCache.map((dept) => (dept.id === departmentId ? department : dept))
          : [...departmentCache, department];
      }
      invalidateCache('departments');
      invalidateCache('users');
      return department;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteDepartment(departmentId: string): Promise<void> {
    try {
      await http.delete(`/departments/${departmentId}`);
      if (departmentCache) {
        departmentCache = departmentCache.filter((dept) => dept.id !== departmentId);
      }
      invalidateCache('departments');
      invalidateCache('users');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getKanbanColumns(): Promise<KanbanColumn[]> {
    try {
      const cacheKey = 'kanban-columns';
      const cached = getCached<KanbanColumn[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiKanbanColumn[]>('/kanban-columns');
      const mapped = data.map(mapKanbanColumn);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createKanbanColumn(title: string): Promise<KanbanColumn> {
    try {
      const { data } = await http.post<ApiKanbanColumn>('/kanban-columns', { title, order: Date.now() });
      invalidateCache('kanban-columns');
      return mapKanbanColumn(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateKanbanColumn(columnId: string, updates: Partial<KanbanColumn>): Promise<KanbanColumn> {
    try {
      const payload: Record<string, unknown> = {};
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.order !== undefined) payload.order = updates.order;
      const { data } = await http.patch<ApiKanbanColumn>(`/kanban-columns/${columnId}`, payload);
      invalidateCache('kanban-columns');
      return mapKanbanColumn(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteKanbanColumn(columnId: string): Promise<void> {
    try {
      await http.delete(`/kanban-columns/${columnId}`);
      invalidateCache('kanban-columns');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getSmtpConfig(_currentUserId: string): Promise<SmtpConfig> {
    try {
      const cacheKey = 'smtp-config';
      const cached = getCached<SmtpConfig>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiSmtpConfig>('/config/smtp');
      const mapped = mapSmtpConfig(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateSmtpConfig(config: Partial<SmtpConfig>, _currentUserId: string): Promise<SmtpConfig> {
    try {
      const { data } = await http.patch<ApiSmtpConfig>('/config/smtp', {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        encryption: config.encryption,
      });
      invalidateCache('smtp-config');
      return mapSmtpConfig(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getApiConfig(): Promise<ApiConfig> {
    try {
      const cacheKey = 'api-config';
      const cached = getCached<ApiConfig>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<{ provider: string; api_key?: string | null }>('/config/api');
      const mapped = mapApiConfig(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateApiConfig(config: ApiConfig): Promise<ApiConfig> {
    try {
      const { data } = await http.patch<{ provider: string; api_key?: string | null }>('/config/api', {
        provider: config.provider,
        api_key: config.apiKey,
      });
      invalidateCache('api-config');
      return mapApiConfig(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getPointsTableConfig(): Promise<PointsTableConfig> {
    try {
      const cacheKey = 'points-table-config';
      const cached = getCached<PointsTableConfig>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiPointsTableConfig>('/config/points');
      const mapped = mapPointsTableConfig(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updatePointsTableConfig(updates: Partial<PointsTableConfig>): Promise<PointsTableConfig> {
    try {
      const payload: Record<string, unknown> = {};
      if (updates.pointsConfig !== undefined) payload.points_config = updates.pointsConfig;
      if (updates.taskCreationPoints !== undefined) payload.task_creation_points = updates.taskCreationPoints;
      if (updates.clarityPointsPerStar !== undefined) payload.clarity_points_per_star = updates.clarityPointsPerStar;
      if (updates.managerOverduePenalty !== undefined) payload.manager_overdue_penalty = updates.managerOverduePenalty;
      if (Object.keys(payload).length === 0) {
        const { data } = await http.get<ApiPointsTableConfig>('/config/points');
        const mapped = mapPointsTableConfig(data);
        setCached('points-table-config', mapped);
        return mapped;
      }
      const { data } = await http.patch<ApiPointsTableConfig>('/config/points', payload);
      invalidateCache('points-table-config');
      return mapPointsTableConfig(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getFeatureFlags(): Promise<FeatureFlag[]> {
    try {
      const cacheKey = 'feature-flags';
      const cached = getCached<FeatureFlag[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<FeatureFlag[]>('/feature-flags');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateFeatureFlags(flags: FeatureFlagUpdate[], _currentUserId?: string): Promise<FeatureFlag[]> {
    try {
      const { data } = await http.put<FeatureFlag[]>('/feature-flags', { flags });
      invalidateCache('feature-flags');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getReleaseNotes(): Promise<ReleaseNotes> {
    try {
      const cacheKey = 'release-notes';
      const cached = getCached<ReleaseNotes>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiReleaseNotes>('/updates/latest');
      const mapped = mapReleaseNotes(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateReleaseNotes(payload: ReleaseNotesUpdate): Promise<ReleaseNotes> {
    try {
      const apiPayload: Record<string, unknown> = {};
      if (payload.versionLabel !== undefined) apiPayload.version_label = payload.versionLabel;
      if (payload.contentMode !== undefined) apiPayload.content_mode = payload.contentMode;
      if (payload.detailsText !== undefined) apiPayload.details_text = payload.detailsText;
      if (payload.html !== undefined) apiPayload.html = payload.html;
      if (payload.css !== undefined) apiPayload.css = payload.css;
      if (payload.js !== undefined) apiPayload.js = payload.js;
      const { data } = await http.put<ApiReleaseNotes>('/updates/latest', apiPayload);
      invalidateCache('release-notes');
      return mapReleaseNotes(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async generateBearerToken(payload: ApiTokenRequest): Promise<BearerTokenPreview> {
    try {
      const { data } = await http.post<ApiTokenResponse>('/auth/generate-token', payload);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listWebhooks(): Promise<WebhookSubscription[]> {
    try {
      const { data } = await http.get<ApiWebhook[]>('/webhooks');
      return data.map(mapWebhook);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createWebhook(payload: WebhookCreatePayload): Promise<WebhookSubscription> {
    try {
      const { data } = await http.post<ApiWebhook>('/webhooks', toApiWebhookPayload(payload));
      return mapWebhook(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateWebhook(id: string, payload: WebhookUpdatePayload): Promise<WebhookSubscription> {
    try {
      const { data } = await http.put<ApiWebhook>(`/webhooks/${id}`, toApiWebhookPayload(payload));
      return mapWebhook(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteWebhook(id: string): Promise<void> {
    try {
      await http.delete(`/webhooks/${id}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async testWebhook(id: string, eventName?: string): Promise<WebhookTestResult> {
    try {
      const { data } = await http.post<ApiWebhookTestResponse>(`/webhooks/${id}/test`, {
        event_name: eventName ?? null,
      });
      return {
        statusCode: data.status_code ?? null,
        responseBody: data.response_body ?? null,
        responseTimeMs: data.response_time_ms ?? null,
        errorMessage: data.error_message ?? null,
        deliveredAt: data.delivered_at ?? null,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async exportData(scope: DataExportScope = DataExportScope.ALL): Promise<DataExportBundle> {
    try {
      const { data } = await http.get<ApiDataExportBundle>('/admin/data/export', {
        params: { scope },
      });
      return mapDataExportBundle(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async importData(payload: DataImportPayload): Promise<string> {
    try {
      const { data } = await http.post<ApiStatusResponse>('/admin/data/import', toApiImportPayload(payload));
      return data.status;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async requestFullResetOtp(): Promise<string> {
    try {
      const { data } = await http.post<ApiStatusResponse>('/admin/data/reset/request', {});
      return data.status;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async confirmFullReset(otp: string): Promise<string> {
    try {
      const { data } = await http.post<ApiStatusResponse>('/admin/data/reset/confirm', { otp });
      return data.status;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getAchievements(): Promise<Achievement[]> {
    try {
      const cacheKey = 'achievements';
      const cached = getCached<Achievement[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<Achievement[]>('/achievements');
      const mapped = data.map(mapAchievement);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getMyAchievements(): Promise<BadgeProgress[]> {
    try {
      const cacheKey = 'achievements-me';
      const cached = getCached<BadgeProgress[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiBadgeProgress[]>('/achievements/me');
      const mapped = data.map(mapBadgeProgress);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getBadges(params: { state?: string; includeRules?: boolean } = {}): Promise<Badge[]> {
    try {
      const cacheKey = buildCacheKey('badges', {
        state: params.state ?? '',
        includeRules: params.includeRules ?? false,
      });
      const cached = getCached<Badge[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiBadge[]>('/badges', {
        params: {
          state: params.state ?? undefined,
          include_rules: params.includeRules ?? undefined,
        },
      });
      const mapped = data.map(mapBadge);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createBadge(payload: BadgeEditorPayload): Promise<Badge> {
    try {
      const { data } = await http.post<ApiBadge>('/badges', toApiBadgePayload(payload));
      invalidateCache('badges');
      invalidateCache('achievements-me');
      return mapBadge(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateBadge(badgeId: string, payload: BadgeUpdatePayload): Promise<Badge> {
    try {
      const { data } = await http.put<ApiBadge>(`/badges/${badgeId}`, toApiBadgePayload(payload));
      invalidateCache('badges');
      invalidateCache('achievements-me');
      return mapBadge(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteBadge(badgeId: string): Promise<void> {
    try {
      await http.delete(`/badges/${badgeId}`);
      invalidateCache('badges');
      invalidateCache('achievements-me');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadBadgeImage(badgeId: string, payload: BadgeImagePayload): Promise<Badge> {
    try {
      const formData = new FormData();
      if (payload.file) {
        formData.append('file', payload.file);
      }
      if (payload.imageUrl) {
        formData.append('image_url', payload.imageUrl);
      }
      const { data } = await http.post<ApiBadge>(`/badges/${badgeId}/image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      invalidateCache('badges');
      invalidateCache('achievements-me');
      return mapBadge(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getRewards(): Promise<Reward[]> {
    const page = await this.getRewardPage({ tab: 'active', pageSize: 50 });
    return page?.items ?? [];
  },

  async getRewardPage(params: {
    tab?: 'active' | 'expired';
    search?: string;
    dept?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RewardListResponse> {
    try {
      const cacheKey = buildCacheKey('reward-page', {
        tab: params.tab ?? 'active',
        search: params.search ?? '',
        dept: params.dept ?? '',
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 12,
      });
      const cached = getCached<RewardListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiRewardListResponse>('/rewards', {
        params: {
          tab: params.tab ?? 'active',
          q: params.search ?? undefined,
          dept: params.dept ?? undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 12,
        },
      });
      const mapped: RewardListResponse = {
        items: data.items.map(mapReward),
        page: data.page,
        total: data.total,
        pageSize: data.page_size,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getReward(rewardId: string): Promise<Reward> {
    try {
      const cacheKey = `reward:${rewardId}`;
      const cached = getCached<Reward>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiReward>(`/rewards/${rewardId}`);
      const mapped = mapReward(data);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createReward(rewardData: RewardEditorPayload): Promise<Reward> {
    try {
      const payload = {
        title: rewardData.title,
        description: rewardData.description,
        image_source: rewardData.imageSource,
        image_ref: rewardData.imageRef ?? null,
        xp_required: rewardData.xpRequired,
        dept_whitelist: rewardData.deptWhitelist ?? null,
        auto_redeem: rewardData.autoRedeem,
        allow_multiple_claims: rewardData.allowMultipleClaims,
        expires_at: rewardData.expiresAt ?? null,
      };
      const { data } = await http.post<ApiReward>('/rewards', payload);
      invalidateCache('rewards');
      invalidateCache('reward-page');
      invalidateCache('reward:');
      invalidateCache('reward-logs');
      return mapReward(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateReward(
    rewardId: string,
    updates: Partial<RewardEditorPayload> & { status?: RewardStatus }
  ): Promise<Reward> {
    try {
      const payload: Record<string, unknown> = {};
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.imageSource !== undefined) payload.image_source = updates.imageSource;
      if (updates.imageRef !== undefined) payload.image_ref = updates.imageRef;
      if (updates.xpRequired !== undefined) payload.xp_required = updates.xpRequired;
      if (updates.deptWhitelist !== undefined) payload.dept_whitelist = updates.deptWhitelist;
      if (updates.autoRedeem !== undefined) payload.auto_redeem = updates.autoRedeem;
      if (updates.allowMultipleClaims !== undefined) payload.allow_multiple_claims = updates.allowMultipleClaims;
      if (updates.expiresAt !== undefined) payload.expires_at = updates.expiresAt;
      if (updates.status !== undefined) payload.status = updates.status;
      const { data } = await http.put<ApiReward>(`/rewards/${rewardId}`, payload);
      invalidateCache('rewards');
      invalidateCache('reward-page');
      invalidateCache('reward:');
      invalidateCache('reward-logs');
      return mapReward(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteReward(rewardId: string): Promise<void> {
    try {
      await http.delete(`/rewards/${rewardId}`);
      invalidateCache('rewards');
      invalidateCache('reward-page');
      invalidateCache('reward:');
      invalidateCache('reward-logs');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async expireReward(rewardId: string): Promise<Reward> {
    try {
      const { data } = await http.post<ApiReward>(`/rewards/${rewardId}/expire`, {});
      invalidateCache('rewards');
      invalidateCache('reward-page');
      invalidateCache('reward:');
      invalidateCache('reward-logs');
      return mapReward(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async clearExpiredRewards(): Promise<number> {
    try {
      const { data } = await http.post<{ deleted: number }>('/rewards/clear-expired', {});
      invalidateCache('rewards');
      invalidateCache('reward-page');
      invalidateCache('reward:');
      invalidateCache('reward-logs');
      return data.deleted;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getRewardIcons(): Promise<RewardIcon[]> {
    try {
      const cacheKey = 'reward-icons';
      const cached = getCached<RewardIcon[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiRewardIcon[]>('/rewards/icons');
      const mapped = data.map(mapRewardIcon);
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadRewardImage(file: File): Promise<{ imageRef: string; imageUrl: string; mimeType: string; size: number }> {
    const progressTaskId = startProgressTask({ progress: 0 });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await http.post<RewardImageUploadResponse>('/rewards/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        showGlobalProgress: false,
        onUploadProgress: (event) => {
          if (!event.total) return;
          updateProgressTask(progressTaskId, Math.round((event.loaded / event.total) * 100));
        },
      });
      setGlobalProgress(100, progressTaskId);
      return {
        imageRef: data.image_ref,
        imageUrl: data.image_url,
        mimeType: data.mime_type,
        size: data.size,
      };
    } catch (error) {
      mapAxiosError(error);
    } finally {
      stopGlobalLoadingTask(progressTaskId);
    }
  },

  async listRewardClaims(params: { status?: RewardClaimStatus; page?: number; pageSize?: number } = {}): Promise<RewardClaimListResponse> {
    try {
      const { data } = await http.get<ApiRewardClaimListResponse>('/claims', {
        params: {
          status_filter: params.status ?? undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 12,
        },
      });
      return {
        items: data.items.map(mapRewardClaim),
        page: data.page,
        total: data.total,
        pageSize: data.page_size,
        totalPages: data.total_pages,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async approveRewardClaim(claimId: string): Promise<RewardClaim> {
    try {
      const { data } = await http.post<ApiRewardClaim>(`/claims/${claimId}/approve`, {});
      return mapRewardClaim(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async rejectRewardClaim(claimId: string): Promise<RewardClaim> {
    try {
      const { data } = await http.post<ApiRewardClaim>(`/claims/${claimId}/reject`, {});
      return mapRewardClaim(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getRewardLogs(params: {
    subjectId?: string;
    action?: RewardLogAction;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RewardLogListResponse> {
    try {
      const cacheKey = buildCacheKey('reward-logs', {
        subjectId: params.subjectId ?? '',
        action: params.action ?? '',
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
      });
      const cached = getCached<RewardLogListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiRewardLogListResponse>('/logs', {
        params: {
          subject_type: 'reward',
          subject_id: params.subjectId ?? undefined,
          action: params.action ?? undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 20,
        },
      });
      const mapped: RewardLogListResponse = {
        items: data.items.map(mapRewardLog),
        page: data.page,
        total: data.total,
        pageSize: data.page_size,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getAuditLogs(params: {
    categories?: string[];
    entityTypes?: string[];
    actions?: string[];
    actorIds?: string[];
    severity?: string[];
    source?: string[];
    status?: string[];
    startAt?: string;
    endAt?: string;
    page?: number;
    pageSize?: number;
    includeDeleted?: boolean;
  } = {}): Promise<AuditLogListResponse> {
    try {
      const cacheKey = buildCacheKey('audit-logs', {
        categories: params.categories?.join(',') ?? '',
        entityTypes: params.entityTypes?.join(',') ?? '',
        actions: params.actions?.join(',') ?? '',
        actorIds: params.actorIds?.join(',') ?? '',
        severity: params.severity?.join(',') ?? '',
        source: params.source?.join(',') ?? '',
        status: params.status?.join(',') ?? '',
        startAt: params.startAt ?? '',
        endAt: params.endAt ?? '',
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 50,
        includeDeleted: params.includeDeleted ? '1' : '0',
      });
      const cached = getCached<AuditLogListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiAuditLogListResponse>('/logs/audit', {
        params: {
          category: params.categories?.join(',') || undefined,
          entity_type: params.entityTypes?.join(',') || undefined,
          action: params.actions?.join(',') || undefined,
          actor_id: params.actorIds?.join(',') || undefined,
          severity: params.severity?.join(',') || undefined,
          source: params.source?.join(',') || undefined,
          status: params.status?.join(',') || undefined,
          start_at: params.startAt || undefined,
          end_at: params.endAt || undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 50,
          include_deleted: params.includeDeleted ?? false,
        },
      });
      const mapped: AuditLogListResponse = {
        items: data.items.map(mapAuditLog),
        page: data.page,
        total: data.total,
        pageSize: data.page_size,
        totalPages: data.total_pages,
      };
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getAuditRetention(): Promise<AuditRetentionConfig> {
    try {
      const { data } = await http.get<ApiAuditRetentionConfig>('/logs/retention');
      return mapAuditRetention(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateAuditRetention(retentionDays: number): Promise<AuditRetentionConfig> {
    try {
      const { data } = await http.patch<ApiAuditRetentionConfig>('/logs/retention', {
        retention_days: retentionDays,
      });
      return mapAuditRetention(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async applyAuditRetention(): Promise<AuditRetentionApplyResponse> {
    try {
      const { data } = await http.post<ApiAuditRetentionApplyResponse>('/logs/retention/apply', {});
      return {
        updated: data.updated,
        cutoffAt: data.cutoff_at,
        retentionDays: data.retention_days,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async retryAuditLog(logId: string): Promise<void> {
    try {
      await http.post(`/logs/audit/${logId}/retry`, {});
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async exportAuditLogs(params: {
      format: 'csv' | 'json';
      categories?: string[];
      entityTypes?: string[];
      actions?: string[];
    actorIds?: string[];
    severity?: string[];
    source?: string[];
    status?: string[];
    startAt?: string;
    endAt?: string;
  }): Promise<Blob> {
    try {
      const response = await http.get('/logs/audit/export', {
        params: {
          format: params.format,
          category: params.categories?.join(',') || undefined,
          entity_type: params.entityTypes?.join(',') || undefined,
          action: params.actions?.join(',') || undefined,
          actor_id: params.actorIds?.join(',') || undefined,
          severity: params.severity?.join(',') || undefined,
          source: params.source?.join(',') || undefined,
          status: params.status?.join(',') || undefined,
          start_at: params.startAt || undefined,
          end_at: params.endAt || undefined,
        },
        responseType: 'blob',
      });
      return response.data as Blob;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getTasksPage(params: {
      page: number;
      pageSize: number;
      cursor?: string | null;
      search?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string;
      projectId?: string;
      team?: string;
      tag?: string;
      dueDate?: string;
      createdDate?: string;
      quickFilter?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      signal?: AbortSignal;
    }): Promise<TaskPageResponse> {
      try {
        const query: Record<string, unknown> = {
          page: params.page,
          page_size: params.pageSize,
        };
        if (params.cursor) query.cursor = params.cursor;
        if (params.search) query.search = params.search;
        if (params.status) query.status = params.status;
        if (params.priority) query.priority = params.priority;
        if (params.assigneeId) query.assignee_id = params.assigneeId;
        if (params.projectId) query.project_id = params.projectId;
        if (params.team) query.team = params.team;
        if (params.tag) query.tag = params.tag;
        if (params.dueDate) query.due_date = params.dueDate;
        if (params.createdDate) query.created_date = params.createdDate;
        if (params.quickFilter) query.quick_filter = params.quickFilter;
        if (params.sortBy) query.sort_by = params.sortBy;
        if (params.sortOrder) query.sort_order = params.sortOrder;

        const { data } = await http.get<ApiTaskPageResponse>('/tasks/page', {
          params: query,
          signal: params.signal,
        });
        const mapped = data.items.map(mapTask);
        const statusCounts = Object.entries(data.status_counts ?? {}).reduce((acc, [key, value]) => {
          acc[key as TaskStatus] = value;
          return acc;
        }, {} as Record<TaskStatus, number>);
        return {
          items: mapped,
          page: data.page,
          pageSize: data.page_size,
          total: data.total,
          totalPages: data.total_pages,
          statusCounts,
          nextCursor: data.next_cursor ?? null,
          hasMore: data.has_more ?? false,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getTaskCalendarSummary(params: {
      startDate: string;
      endDate: string;
      search?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string;
      projectId?: string;
      team?: string;
      tag?: string;
      dueDate?: string;
      createdDate?: string;
      quickFilter?: string;
      signal?: AbortSignal;
    }): Promise<TaskCalendarSummaryResponse> {
      try {
        const query: Record<string, unknown> = {
          start_date: params.startDate,
          end_date: params.endDate,
        };
        if (params.search) query.search = params.search;
        if (params.status) query.status = params.status;
        if (params.priority) query.priority = params.priority;
        if (params.assigneeId) query.assignee_id = params.assigneeId;
        if (params.projectId) query.project_id = params.projectId;
        if (params.team) query.team = params.team;
        if (params.tag) query.tag = params.tag;
        if (params.dueDate) query.due_date = params.dueDate;
        if (params.createdDate) query.created_date = params.createdDate;
        if (params.quickFilter) query.quick_filter = params.quickFilter;
        const { data } = await http.get<ApiTaskCalendarSummaryResponse>('/tasks/calendar/summary', {
          params: query,
          signal: params.signal,
        });
        return mapTaskCalendarSummary(data);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getTaskCalendarTasks(params: {
      startDate: string;
      endDate?: string;
      search?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string;
      projectId?: string;
      team?: string;
      tag?: string;
      dueDate?: string;
      createdDate?: string;
      quickFilter?: string;
      signal?: AbortSignal;
    }): Promise<Task[]> {
      try {
        const query: Record<string, unknown> = {
          start_date: params.startDate,
        };
        if (params.endDate) query.end_date = params.endDate;
        if (params.search) query.search = params.search;
        if (params.status) query.status = params.status;
        if (params.priority) query.priority = params.priority;
        if (params.assigneeId) query.assignee_id = params.assigneeId;
        if (params.projectId) query.project_id = params.projectId;
        if (params.team) query.team = params.team;
        if (params.tag) query.tag = params.tag;
        if (params.dueDate) query.due_date = params.dueDate;
        if (params.createdDate) query.created_date = params.createdDate;
        if (params.quickFilter) query.quick_filter = params.quickFilter;
        const { data } = await http.get<ApiTask[]>('/tasks/calendar/tasks', {
          params: query,
          signal: params.signal,
        });
        return (data ?? []).map(mapTask);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getTasksKanban(params: {
      pageSize?: number;
      search?: string;
      priority?: TaskPriority;
      assigneeId?: string;
      projectId?: string;
      team?: string;
      tag?: string;
      dueDate?: string;
      createdDate?: string;
      quickFilter?: string;
      signal?: AbortSignal;
    }): Promise<TaskKanbanResponse> {
      try {
        const query: Record<string, unknown> = {};
        if (params.pageSize) query.page_size = params.pageSize;
        if (params.search) query.search = params.search;
        if (params.priority) query.priority = params.priority;
        if (params.assigneeId) query.assignee_id = params.assigneeId;
        if (params.projectId) query.project_id = params.projectId;
        if (params.team) query.team = params.team;
        if (params.tag) query.tag = params.tag;
        if (params.dueDate) query.due_date = params.dueDate;
        if (params.createdDate) query.created_date = params.createdDate;
        if (params.quickFilter) query.quick_filter = params.quickFilter;

        const { data } = await http.get<ApiTaskKanbanResponse>('/tasks/kanban', {
          params: query,
          signal: params.signal,
        });

        return {
          columns: (data.columns ?? []).map((column) => ({
            status: column.status,
            title: column.title,
            order: column.order,
            count: column.count,
            items: column.items.map(mapTask),
          })),
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getTaskSummary(taskId: string, options?: { signal?: AbortSignal }): Promise<TaskSummary> {
      try {
        const { data } = await http.get<ApiTaskSummaryResponse>(`/tasks/${taskId}/summary`, {
          signal: options?.signal,
        });
        return {
          id: data.id,
          title: data.title,
          status: data.status,
          priority: data.priority,
          team: data.team,
          assignedToId: data.assigned_to_id ?? null,
          createdById: data.created_by_id,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          dueAt: data.due_at ?? null,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async transferUserTasks(payload: TaskTransferPayload): Promise<TaskTransferResponse> {
      try {
        const body: ApiTaskTransferPayload = {
          from_user_id: payload.fromUserId,
          to_user_id: payload.toUserId,
          statuses: payload.statuses,
        };
        const { data } = await http.post<ApiTaskTransferResponse>('/tasks/transfer', body);
        invalidateCache('tasks');
        invalidateCache('task:');
        return {
          fromUserId: data.from_user_id,
          toUserId: data.to_user_id,
          statuses: data.statuses,
          updatedCount: data.updated_count,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async createTaskTransferRequest(
      taskId: string,
      payload: TaskTransferWorkflowRequest,
    ): Promise<TaskTransferWorkflowRead> {
      try {
        const body: ApiTaskTransferWorkflowRequest = {
          to_user_id: payload.toUserId,
          note: payload.note ?? null,
        };
        const { data } = await http.post<ApiTaskTransferWorkflowRead>(`/tasks/${taskId}/transfer-requests`, body);
        invalidateCache(`task:${taskId}`);
        return {
          id: data.id,
          taskId: data.task_id,
          fromUserId: data.from_user_id ?? null,
          toUserId: data.to_user_id,
          requestedById: data.requested_by_id,
          approvedById: data.approved_by_id ?? null,
          status: data.status,
          note: data.note ?? null,
          createdAt: data.created_at,
          actedAt: data.acted_at ?? null,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async listTaskTransferRequests(taskId: string): Promise<TaskTransferWorkflowRead[]> {
      try {
        const { data } = await http.get<ApiTaskTransferWorkflowRead[]>(`/tasks/${taskId}/transfer-requests`);
        return data.map((item) => ({
          id: item.id,
          taskId: item.task_id,
          fromUserId: item.from_user_id ?? null,
          toUserId: item.to_user_id,
          requestedById: item.requested_by_id,
          approvedById: item.approved_by_id ?? null,
          status: item.status,
          note: item.note ?? null,
          createdAt: item.created_at,
          actedAt: item.acted_at ?? null,
        }));
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async approveTaskTransferRequest(
      requestId: string,
      payload: TaskTransferWorkflowDecision,
    ): Promise<TaskTransferWorkflowRead> {
      try {
        const body: ApiTaskTransferWorkflowDecision = {
          decision: payload.decision,
          comment: payload.comment ?? null,
        };
        const { data } = await http.post<ApiTaskTransferWorkflowRead>(`/tasks/transfer-requests/${requestId}/approve`, body);
        invalidateCache('tasks');
        invalidateCache('task:');
        return {
          id: data.id,
          taskId: data.task_id,
          fromUserId: data.from_user_id ?? null,
          toUserId: data.to_user_id,
          requestedById: data.requested_by_id,
          approvedById: data.approved_by_id ?? null,
          status: data.status,
          note: data.note ?? null,
          createdAt: data.created_at,
          actedAt: data.acted_at ?? null,
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async listToolLibraryCategories(params: {
      page?: number;
      pageSize?: number;
      status?: ToolCategoryStatus;
    } = {}): Promise<ToolCategoryListResponse> {
      try {
        const { data } = await http.get<ToolCategoryListResponse>('/tool-library/categories', {
          params: {
            page: params.page ?? 1,
            page_size: params.pageSize ?? 10,
            status: params.status ?? undefined,
          },
        });
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async createToolLibraryCategory(payload: ToolCategoryCreatePayload): Promise<ToolCategory> {
      try {
        const { data } = await http.post<ToolCategory>('/tool-library/categories', payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async updateToolLibraryCategory(categoryId: string, payload: ToolCategoryUpdatePayload): Promise<ToolCategory> {
      try {
        const { data } = await http.put<ToolCategory>(`/tool-library/categories/${categoryId}`, payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async archiveToolLibraryCategory(categoryId: string): Promise<void> {
      try {
        await http.delete(`/tool-library/categories/${categoryId}`);
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async listToolLibraryTools(params: {
      page?: number;
      pageSize?: number;
      q?: string;
      categoryId?: string;
      pricingType?: ToolPricingType;
      status?: ToolStatus;
      tags?: string[];
    } = {}): Promise<ToolListResponse> {
      try {
        const { data } = await http.get<ToolListResponse>('/tool-library/tools', {
          params: {
            page: params.page ?? 1,
            page_size: params.pageSize ?? 20,
            q: params.q ?? undefined,
            category_id: params.categoryId ?? undefined,
            pricing_type: params.pricingType ?? undefined,
            status: params.status ?? undefined,
            tags: params.tags?.length ? params.tags.join(',') : undefined,
          },
        });
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async createToolLibraryTool(payload: ToolCreatePayload): Promise<Tool> {
      try {
        const { data } = await http.post<Tool>('/tool-library/tools', payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async updateToolLibraryTool(toolId: string, payload: ToolUpdatePayload): Promise<Tool> {
      try {
        const { data } = await http.put<Tool>(`/tool-library/tools/${toolId}`, payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async approveToolLibraryTool(toolId: string, payload: ToolDecisionPayload = {}): Promise<Tool> {
      try {
        const { data } = await http.post<Tool>(`/tool-library/tools/${toolId}/approve`, payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async rejectToolLibraryTool(toolId: string, payload: ToolDecisionPayload = {}): Promise<Tool> {
      try {
        const { data } = await http.post<Tool>(`/tool-library/tools/${toolId}/reject`, payload);
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async toggleToolLibraryFavorite(toolId: string): Promise<Tool> {
      try {
        const { data } = await http.post<Tool>(`/tool-library/tools/${toolId}/favorite`, {});
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

    async getToolLibraryFavorites(): Promise<ToolFavoriteListResponse> {
      try {
        const { data } = await http.get<ToolFavoriteListResponse>('/tool-library/tools/favorites');
        return data;
      } catch (error) {
        mapAxiosError(error);
      }
    },

  async claimReward(rewardId: string): Promise<RewardClaim> {
    try {
      const { data } = await http.post<ApiRewardClaim>(`/rewards/${rewardId}/claim`, {});
      return mapRewardClaim(data);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getNotifications(userId: string): Promise<Notification[]> {
    try {
      const { data } = await http.get<ApiNotification[]>('/notifications');
      const mapped = data.map(mapNotification);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async markAllAsRead(userId: string): Promise<void> {
    try {
      await http.post('/notifications/read-all', {});
      invalidateCache(`notifications:${userId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    try {
      await http.post(`/notifications/${notificationId}/read`, {});
      invalidateCache(`notifications:${userId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await http.delete(`/notifications/${notificationId}`);
      invalidateCache('notifications:');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getVapidPublicKey(): Promise<{ publicKey: string }> {
    try {
      const { data } = await http.get<ApiVapidPublicKey>('/push/vapid-public-key');
      return { publicKey: data.public_key };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async subscribePush(payload: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
    deviceLabel?: string;
  }): Promise<void> {
    try {
      const body: ApiPushSubscriptionCreate = {
        endpoint: payload.endpoint,
        keys: payload.keys,
        user_agent: payload.userAgent,
        device_label: payload.deviceLabel,
      };
      await http.post('/push/subscribe', body);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async unsubscribePush(endpoint: string): Promise<void> {
    try {
      await http.post('/push/unsubscribe', { endpoint });
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getNotificationPreferences(): Promise<NotificationPreference[]> {
    try {
      const { data } = await http.get<ApiNotificationPreference[]>('/notification/preferences');
      return data.map(mapNotificationPreference);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateNotificationPreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
    try {
      const payload = {
        preferences: preferences.map((pref) => ({
          module: pref.module,
          push_enabled: pref.pushEnabled,
        })),
      };
      const { data } = await http.post<ApiNotificationPreference[]>('/notification/preferences', payload);
      return data.map(mapNotificationPreference);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async sendPushTest(): Promise<{ delivered: number }> {
    try {
      const { data } = await http.post<ApiPushTestResult>('/push/test', {});
      return { delivered: data.delivered };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getTaskTemplates(): Promise<TaskTemplate[]> {
    try {
      const cacheKey = 'task-templates';
      const cached = getCached<TaskTemplate[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<TaskTemplate[]>('/tasks/task-templates');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createTaskTemplate(template: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt' | 'creator' | 'department'>): Promise<TaskTemplate> {
    try {
      const formData = new FormData();
      formData.append('payload', JSON.stringify({
        title: template.title,
        description: template.description,
        priority: template.priority,
        team: template.team,
        subtasks: template.subtasks,
        attachments: template.attachments,
        estimated_hours: template.estimatedHours,
        tags: template.tags,
        department_id: template.departmentId,
      }));

      if (template.featuredImage) {
        // Assuming featuredImage is a File object
        formData.append('featured_image', template.featuredImage as any);
      }

      const { data } = await http.post<TaskTemplate>('/tasks/task-templates', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      invalidateCache('task-templates');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateTaskTemplate(templateId: string, updates: Partial<Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt' | 'creator' | 'department'>>): Promise<TaskTemplate> {
    try {
      const formData = new FormData();
      formData.append('payload', JSON.stringify({
        title: updates.title,
        description: updates.description,
        priority: updates.priority,
        team: updates.team,
        subtasks: updates.subtasks,
        attachments: updates.attachments,
        estimated_hours: updates.estimatedHours,
        tags: updates.tags,
        featured_image: updates.featuredImage,
        department_id: updates.departmentId,
      }));

      if (updates.featuredImage) {
        formData.append('featured_image', updates.featuredImage as any);
      }

      const { data } = await http.patch<TaskTemplate>(`/tasks/task-templates/${templateId}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      invalidateCache('task-templates');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteTaskTemplate(templateId: string): Promise<void> {
    try {
      await http.delete(`/tasks/task-templates/${templateId}`);
      invalidateCache('task-templates');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async assignTaskTemplate(templateId: string, request: TaskTemplateAssignRequest): Promise<Task[]> {
    try {
      const { data } = await http.post<Task[]>(`/tasks/task-templates/${templateId}/assign`, request);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  // Multiple SMTP Config CRUD
  async getMultipleSmtpConfigs(): Promise<MultipleSmtpConfig[]> {
    try {
      const cacheKey = 'smtp-multiple';
      const cached = getCached<MultipleSmtpConfig[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<MultipleSmtpConfig[]>('/config/smtp/multiple');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createMultipleSmtpConfig(config: Omit<MultipleSmtpConfig, 'id' | 'created_at' | 'updated_at'>): Promise<MultipleSmtpConfig> {
    try {
      const { data } = await http.post<MultipleSmtpConfig>('/config/smtp/multiple', config);
      invalidateCache('smtp-multiple');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateMultipleSmtpConfig(configId: string, updates: Partial<Omit<MultipleSmtpConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<MultipleSmtpConfig> {
    try {
      const { data } = await http.patch<MultipleSmtpConfig>(`/config/smtp/multiple/${configId}`, updates);
      invalidateCache('smtp-multiple');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteMultipleSmtpConfig(configId: string): Promise<void> {
    try {
      await http.delete(`/config/smtp/multiple/${configId}`);
      invalidateCache('smtp-multiple');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getEmailTemplates(): Promise<EmailTemplate[]> {
    try {
      const cacheKey = 'email-templates';
      const cached = getCached<EmailTemplate[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<EmailTemplate[]>('/config/email-templates');
      const mapped = data ?? [];
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateEmailTemplate(
    notificationType: string,
    updates: { subject?: string; body?: string },
  ): Promise<EmailTemplate> {
    try {
      const { data } = await http.put<EmailTemplate>(`/config/email-templates/${notificationType}`, updates);
      invalidateCache('email-templates');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async sendSmtpTestEmail(
    configId: string,
    payload: { notification_type: string; to_address: string; subject?: string; body?: string },
  ): Promise<{ status: string }> {
    try {
      const { data } = await http.post<{ status: string }>(`/config/smtp/multiple/${configId}/test`, payload);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  // OAuth Config CRUD
  async getOAuthConfigs(): Promise<OAuthConfig[]> {
    try {
      const cacheKey = 'oauth-configs';
      const cached = getCached<OAuthConfig[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<OAuthConfig[]>('/config/oauth');
      const mapped = data ?? [];
      setCached(cacheKey, mapped);
      return mapped;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createOAuthConfig(config: OAuthConfigCreatePayload): Promise<OAuthConfig> {
    try {
      const { data } = await http.post<OAuthConfig>('/config/oauth', config);
      invalidateCache('oauth-configs');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateOAuthConfig(configId: number, updates: OAuthConfigUpdatePayload): Promise<OAuthConfig> {
    try {
      const { data } = await http.patch<OAuthConfig>(`/config/oauth/${configId}`, updates);
      invalidateCache('oauth-configs');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async rotateOAuthConfig(configId: number, payload: OAuthCredentialRotatePayload): Promise<OAuthConfig> {
    try {
      const { data } = await http.post<OAuthConfig>(`/config/oauth/${configId}/rotate`, payload);
      invalidateCache('oauth-configs');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteOAuthConfig(configId: number): Promise<void> {
    try {
      await http.delete(`/config/oauth/${configId}`);
      invalidateCache('oauth-configs');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  // Levels API
  async getLevels(): Promise<LevelRead[]> {
    try {
      const cacheKey = 'levels';
      const cached = getCached<LevelRead[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<LevelRead[]>('/levels');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getLevel(levelId: string): Promise<LevelRead> {
    try {
      const cacheKey = `level:${levelId}`;
      const cached = getCached<LevelRead>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<LevelRead>(`/levels/${levelId}`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createLevel(level: LevelCreate): Promise<LevelRead> {
    try {
      const { data } = await http.post<LevelRead>('/levels', level);
      invalidateCache('level');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateLevel(levelId: string, updates: LevelUpdate): Promise<LevelRead> {
    try {
      const { data } = await http.patch<LevelRead>(`/levels/${levelId}`, updates);
      invalidateCache('level');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteLevel(levelId: string): Promise<void> {
    try {
      await http.delete(`/levels/${levelId}`);
      invalidateCache('level');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getLevelNodes(levelId: string): Promise<LevelNodeRead[]> {
    try {
      const cacheKey = `level-nodes:${levelId}`;
      const cached = getCached<LevelNodeRead[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<LevelNodeRead[]>(`/levels/${levelId}/nodes`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createLevelNode(levelId: string, node: LevelNodeCreate): Promise<LevelNodeRead> {
    try {
      const { data } = await http.post<LevelNodeRead>(`/levels/${levelId}/nodes`, node);
      invalidateCache('level');
      invalidateCache(`level-nodes:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateLevelNode(levelId: string, nodeId: string, updates: LevelNodeUpdate): Promise<LevelNodeRead> {
    try {
      const { data } = await http.patch<LevelNodeRead>(`/levels/${levelId}/nodes/${nodeId}`, updates);
      invalidateCache('level');
      invalidateCache(`level-nodes:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteLevelNode(levelId: string, nodeId: string): Promise<void> {
    try {
      await http.delete(`/levels/${levelId}/nodes/${nodeId}`);
      invalidateCache('level');
      invalidateCache(`level-nodes:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getLevelEdges(levelId: string): Promise<LevelEdgeRead[]> {
    try {
      const cacheKey = `level-edges:${levelId}`;
      const cached = getCached<LevelEdgeRead[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<LevelEdgeRead[]>(`/levels/${levelId}/edges`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createLevelEdge(levelId: string, edge: LevelEdgeCreate): Promise<LevelEdgeRead> {
    try {
      const { data } = await http.post<LevelEdgeRead>(`/levels/${levelId}/edges`, edge);
      invalidateCache('level');
      invalidateCache(`level-edges:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateLevelEdge(levelId: string, edgeId: string, updates: LevelEdgeUpdate): Promise<LevelEdgeRead> {
    try {
      const { data } = await http.patch<LevelEdgeRead>(`/levels/${levelId}/edges/${edgeId}`, updates);
      invalidateCache('level');
      invalidateCache(`level-edges:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteLevelEdge(levelId: string, edgeId: string): Promise<void> {
    try {
      await http.delete(`/levels/${levelId}/edges/${edgeId}`);
      invalidateCache('level');
      invalidateCache(`level-edges:${levelId}`);
      invalidateCache(`level-preview:${levelId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getLevelPreview(levelId: string): Promise<LevelPreview> {
    try {
      const cacheKey = `level-preview:${levelId}`;
      const cached = getCached<LevelPreview>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<LevelPreview>(`/levels/${levelId}/preview`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async recalculateLevel(levelId: string): Promise<void> {
    try {
      await http.post(`/levels/${levelId}/recalc`);
      invalidateCache('level');
      invalidateCache(`level-preview:${levelId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async claimLevelNode(levelId: string, nodeId: string): Promise<void> {
    try {
      await http.post(`/levels/${levelId}/nodes/${nodeId}/claim`);
      invalidateCache('level');
      invalidateCache(`level-preview:${levelId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getUserProgress(userId: string): Promise<UserProgressRead[]> {
    try {
      const cacheKey = `user-progress:${userId}`;
      const cached = getCached<UserProgressRead[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<UserProgressRead[]>(`/users/${userId}/progress`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createUserProgress(progress: UserProgressCreate): Promise<UserProgressRead> {
    try {
      const { data } = await http.post<UserProgressRead>('/progress', progress);
      invalidateCache('user-progress');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateUserProgress(progressId: string, updates: UserProgressUpdate): Promise<UserProgressRead> {
    try {
      const { data } = await http.patch<UserProgressRead>(`/progress/${progressId}`, updates);
      invalidateCache('user-progress');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getSeasons(): Promise<Season[]> {
    try {
      const cacheKey = 'seasons';
      const cached = getCached<Season[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<Season[]>('/seasons');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async createSeason(season: Omit<Season, 'id' | 'createdAt' | 'updatedAt'>): Promise<Season> {
    try {
      const { data } = await http.post<Season>('/seasons', season);
      invalidateCache('seasons');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateSeason(seasonId: string, updates: Partial<Omit<Season, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Season> {
    try {
      const { data } = await http.patch<Season>(`/seasons/${seasonId}`, updates);
      invalidateCache('seasons');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteSeason(seasonId: string): Promise<void> {
    try {
      await http.delete(`/seasons/${seasonId}`);
      invalidateCache('seasons');
    } catch (error) {
      mapAxiosError(error);
    }
  },

  // Media API functions
  async connectMediaProvider(provider: StorageProvider): Promise<MediaProviderStatus> {
    try {
      const { data } = await http.post<MediaProviderStatus>('/media/external/connect', {
        provider,
      });
      invalidateCache('media-providers');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async startGoogleDriveOAuth(): Promise<GoogleDriveOAuthStartResponse> {
    try {
      const { data } = await http.get<{ authorization_url: string; expires_in: number }>('/media/external/gdrive/oauth/start');
      return {
        authorizationUrl: data.authorization_url,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async presignMediaUpload(payload: MediaPresignRequest): Promise<MediaPresignResponse> {
    try {
      const { data } = await http.post<ApiMediaPresignResponse>('/media/presign', {
        purpose: payload.purpose,
        tab: payload.tab,
        file_name: payload.fileName,
        content_type: payload.contentType,
        size_bytes: payload.sizeBytes,
      });
      return {
        uploadUrl: data.upload_url,
        bucket: data.bucket,
        objectKey: data.object_key,
        fileId: data.file_id,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async confirmMediaUpload(payload: MediaConfirmRequest): Promise<MediaConfirmResponse> {
    try {
      const { data } = await http.post<ApiMediaConfirmResponse>('/media/confirm', {
        file_id: payload.fileId,
        crop: payload.crop,
      });
      invalidateCache('media-files');
      return {
        fileId: data.file_id,
        status: data.status,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadToPresignedUrl(
    uploadUrl: string,
    file: File,
    contentType: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const progressTaskId = startProgressTask({ progress: 0 });
    try {
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': contentType },
        onUploadProgress: (event) => {
          if (!event.total) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          updateProgressTask(progressTaskId, percent);
          onProgress?.(percent);
        },
      });
      setGlobalProgress(100, progressTaskId);
    } catch (error) {
      mapAxiosError(error);
    } finally {
      stopGlobalLoadingTask(progressTaskId);
    }
  },

  async listMediaFiles(params: {
    tab: MediaCategory;
    search?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MediaListResponse> {
    try {
      const cacheKey = buildCacheKey('media-files', {
        tab: params.tab,
        search: params.search ?? '',
        fromDate: params.fromDate ?? '',
        toDate: params.toDate ?? '',
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 24,
      });
      const cached = getCached<MediaListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<ApiMediaFileListResponse>('/media/list', {
        params: {
          tab: params.tab,
          search: params.search ?? undefined,
          from_date: params.fromDate ?? undefined,
          to_date: params.toDate ?? undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 24,
        },
      });
      const items = data.items.map((item) => ({
        id: item.id,
        filename: item.original_filename,
        contentType: item.content_type,
        sizeBytes: item.size_bytes,
        createdAt: item.created_at,
        readUrl: item.read_url,
        category: params.tab,
        ext: item.original_filename.split('.').pop()?.toLowerCase(),
      }));
      const response = {
        items,
        page: data.page,
        pageSize: data.page_size,
        total: data.total,
      };
      setCached(cacheKey, response);
      return response;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async finalizeAvatarUpload(payload: AvatarFinalizeRequest): Promise<AvatarFinalizeResponse> {
    try {
      const { data } = await http.post<ApiAvatarFinalizeResponse>('/media/avatar/finalize', {
        file_id: payload.fileId,
        crop: payload.crop,
      });
      return {
        fileId: data.file_id,
        profileImageKey: data.profile_image_key,
        profileImageUrl: data.profile_image_url,
      };
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async listMedia(params: {
    provider?: StorageProvider;
    category?: MediaCategory;
    search?: string;
    sort?: MediaSortOption;
    page?: number;
    pageSize?: number;
  } = {}): Promise<MediaListResponse> {
    try {
      const cacheKey = buildCacheKey('media-list', {
        provider: params.provider ?? '',
        category: params.category ?? '',
        search: params.search ?? '',
        sort: params.sort ?? '',
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
      });
      const cached = getCached<MediaListResponse>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<MediaListResponse>('/media', {
        params: {
          provider: params.provider ?? undefined,
          category: params.category ?? undefined,
          q: params.search ?? undefined,
          sort: params.sort ?? undefined,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 20,
        },
      });
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async uploadMedia(file: File, provider: StorageProvider, category?: MediaCategory): Promise<MediaItem> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);
      if (category) {
        formData.append('category', category);
      }
      const { data } = await http.post<MediaItem>('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      invalidateCache('media-list');
      invalidateCache('media:');
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async deleteMedia(mediaId: string): Promise<void> {
    try {
      await http.delete(`/media/${mediaId}`);
      invalidateCache('media-list');
      invalidateCache('media-files');
      invalidateCache(`media:${mediaId}`);
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getMedia(mediaId: string): Promise<MediaItem> {
    try {
      const cacheKey = `media:${mediaId}`;
      const cached = getCached<MediaItem>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<MediaItem>(`/media/${mediaId}`);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async updateMedia(mediaId: string, updates: Partial<MediaItem>): Promise<MediaItem> {
    try {
      const { data } = await http.patch<MediaItem>(`/media/${mediaId}`, updates);
      invalidateCache('media-list');
      invalidateCache(`media:${mediaId}`);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },

  async getMediaProviders(): Promise<MediaProviderStatus[]> {
    try {
      const cacheKey = 'media-providers';
      const cached = getCached<MediaProviderStatus[]>(cacheKey);
      if (cached) {
        return cached;
      }
      const { data } = await http.get<MediaProviderStatus[]>('/media/providers');
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  },


};

export default api;















