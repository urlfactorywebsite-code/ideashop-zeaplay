// FIX: Removed self-import of 'RecurrenceRule' which was causing a circular dependency and declaration conflicts.




export interface MultipleSmtpConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  encryption: string;
  notification_types: string[];
  created_at: string;
  updated_at: string;
}

export interface EmailTemplate {
  id: string;
  notification_type: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthConfig {
  id: number;
  name: string;
  client_id: string;
  client_secret: string;
  api_key?: string;
  scopes: string[];
  n8n_integration: boolean;
  redirect_url: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthApp {
  id: string;
  name: string;
  description: string;
  client_id: string;
  client_secret: string;
  redirect_urls: string[];
  website?: string;
  logo_url?: string;
  owner_id: string;
  status: 'active' | 'revoked';
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  user_id: string;
  scopes: string[];
  expires_at?: string;
  last_used?: string;
  status: 'active' | 'revoked';
  created_at: string;
  usage_count: number;
}

export interface Scope {
  id: string;
  name: string;
  description: string;
  category: string;
  access_level: 'read' | 'write' | 'admin';
  required_permissions?: string[];
}

export interface BearerTokenPreview {
  access_token: string;
  token_type: string;
  scopes: string[];
  issued_at: string;
  expires_at: string;
  subject: string;
  label?: string | null;
}

export interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  subscribedEvents: string[];
  isEnabled: boolean;
  secret?: string | null;
  customHeaders?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookCreatePayload {
  name: string;
  url: string;
  subscribedEvents: string[];
  isEnabled: boolean;
  customHeaders?: Record<string, string> | null;
}

export interface WebhookUpdatePayload {
  name?: string;
  url?: string;
  subscribedEvents?: string[];
  isEnabled?: boolean;
  customHeaders?: Record<string, string> | null;
}

export interface WebhookTestResult {
  statusCode?: number | null;
  responseBody?: string | null;
  responseTimeMs?: number | null;
  errorMessage?: string | null;
  deliveredAt?: string | null;
}

export interface ApiUsageStats {
  total_calls: number;
  calls_today: number;
  last_used: string;
  rate_limit_remaining: number;
}

export type ReleaseNotesMode = 'text' | 'code';

export interface ReleaseNotes {
  id: number;
  versionLabel: string;
  contentMode: ReleaseNotesMode;
  detailsText?: string | null;
  html?: string | null;
  css?: string | null;
  js?: string | null;
  updatedById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseNotesUpdate {
  versionLabel?: string;
  contentMode?: ReleaseNotesMode;
  detailsText?: string | null;
  html?: string | null;
  css?: string | null;
  js?: string | null;
}

export enum ClientStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export interface Client {
  id: string;
  tenantId: string;
  companyName: string;
  normalizedCompanyName: string;
  gstNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
  status: ClientStatus;
  createdById?: string | null;
  updatedById?: string | null;
  archivedById?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientListResponse {
  items: Client[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ClientListFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: ClientStatus | '';
  sortBy?: 'company_name' | 'created_at' | 'updated_at' | 'country' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export type ClientCreatePayload = Pick<
  Client,
  | 'companyName'
  | 'gstNumber'
  | 'email'
  | 'phone'
  | 'website'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'notes'
>;

export type ClientUpdatePayload = Partial<ClientCreatePayload>;

export enum ContactStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export interface ContactClientSummary {
  id: string;
  companyName: string;
  status: ClientStatus;
  isPrimary: boolean;
}

export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName?: string | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  status: ContactStatus;
  clients: ContactClientSummary[];
  createdById?: string | null;
  updatedById?: string | null;
  archivedById?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactClientLinkPayload {
  clientId: string;
  isPrimary?: boolean;
}

export interface ContactListResponse {
  items: Contact[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContactListFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  clientId?: string;
  status?: ContactStatus | '';
  sortBy?: 'display_name' | 'created_at' | 'updated_at' | 'email' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface ContactCreatePayload {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  clientLinks?: ContactClientLinkPayload[];
}

export type ContactUpdatePayload = Partial<ContactCreatePayload>;

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum ProjectMemberRole {
  MANAGER = 'MANAGER',
  MEMBER = 'MEMBER',
}

export interface ProjectClientSummary {
  id: string;
  companyName: string;
  status: ClientStatus;
}

export interface ProjectMember {
  id: string;
  tenantId?: string | null;
  userId: string;
  dedupeKey?: string | null;
  name: string;
  email: string;
  role: ProjectMemberRole;
  userRole: Role;
  status: UserStatus;
}

export interface Project {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  normalizedName: string;
  description?: string | null;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  client: ProjectClientSummary;
  members: ProjectMember[];
  taskCount: number;
  subtaskApprovalRequiredDefault?: boolean;
  createdById?: string | null;
  updatedById?: string | null;
  archivedById?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListResponse {
  items: Project[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProjectListFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  clientId?: string;
  status?: ProjectStatus | '';
  mine?: boolean;
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'status' | 'client';
  sortOrder?: 'asc' | 'desc';
}

export interface ProjectMembershipPayload {
  managerIds: string[];
  memberIds: string[];
}

export interface ProjectCreatePayload extends ProjectMembershipPayload {
  name: string;
  clientId: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  subtaskApprovalRequiredDefault?: boolean;
}

export type ProjectUpdatePayload = Partial<ProjectCreatePayload>;

export interface TaskProjectSummary {
  id: string;
  name: string;
  clientId: string;
  clientName?: string | null;
  status: ProjectStatus;
}

export interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  team: string;
  subtasks: string[];
  attachments: string[];
  estimatedHours: number | null;
  tags: string[];
  featuredImage: string | null;
  departmentId: string | null;
  recurrenceRule: RecurrenceRule;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  department?: Department;
  creator?: User;
}

export enum TaskTemplateAssignmentType {
  SINGLE = 'single',
  MULTIPLE = 'multiple',
  DEPARTMENT = 'department',
}

export interface TaskTemplateAssignRequest {
  assignmentType: TaskTemplateAssignmentType;
  userIds?: string[];
  departmentId?: string;
}

export enum Role {
  USER = 'user',
  ADMIN = 'admin',
  MANAGER = 'manager',
  OWNER = 'owner',
}

export enum UserStatus {
    ACTIVE = 'ACTIVE',
    DEACTIVATED = 'DEACTIVATED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskApprovalStatus {
  NONE = 'none',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// ---------------------------------------------------------------------------
// Tool Library
// ---------------------------------------------------------------------------

export enum ToolCategoryStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum ToolPricingType {
  FREE = 'free',
  PAID = 'paid',
  TRIAL = 'trial',
}

export enum ToolStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface ToolCategory {
  id: string;
  name: string;
  description?: string | null;
  display_order: number;
  status: ToolCategoryStatus;
  created_at: string;
  updated_at: string;
}

export interface ToolCategoryCreatePayload {
  name: string;
  description?: string | null;
  display_order?: number;
  status?: ToolCategoryStatus;
}

export interface ToolCategoryUpdatePayload {
  name?: string;
  description?: string | null;
  display_order?: number;
  status?: ToolCategoryStatus;
}

export interface ToolCategoryListResponse {
  items: ToolCategory[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  website_url?: string | null;
  preview_image_url?: string | null;
  category_id?: string | null;
  tags: string[];
  pricing_type: ToolPricingType;
  is_internal: boolean;
  status: ToolStatus;
  created_by: string;
  approved_by?: string | null;
  review_reason?: string | null;
  created_at: string;
  updated_at: string;
  category?: ToolCategory | null;
  is_favorite: boolean;
}

export interface ToolCreatePayload {
  name: string;
  description: string;
  website_url?: string | null;
  preview_image_url?: string | null;
  category_id?: string | null;
  tags?: string[];
  pricing_type?: ToolPricingType;
  is_internal?: boolean;
}

export interface ToolUpdatePayload {
  name?: string;
  description?: string;
  website_url?: string | null;
  preview_image_url?: string | null;
  category_id?: string | null;
  tags?: string[];
  pricing_type?: ToolPricingType;
  is_internal?: boolean;
  status?: ToolStatus;
}

export interface ToolDecisionPayload {
  reason?: string | null;
}

export interface ToolListResponse {
  items: Tool[];
  page: number;
  total: number;
  page_size: number;
  total_pages: number;
}

export interface ToolFavoriteListResponse {
  items: Tool[];
}

// ---------------------------------------------------------------------------
// Media Library
// ---------------------------------------------------------------------------

export enum MediaCategory {
  IMAGE = 'images',
  VIDEO = 'videos',
  DOCUMENT = 'documents',
  ZIP = 'zip',
}

export type MediaSortOption = 'created_desc' | 'created_asc' | 'size_desc' | 'size_asc';

export type StorageProvider = 'local' | 'supabase' | 'gdrive';

export interface MediaItem {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  readUrl: string;
  category: MediaCategory;
  ext?: string;
}

export interface MediaListResponse {
  items: MediaItem[];
  page: number;
  pageSize: number;
  total: number;
}

export type MediaUploadPurpose = 'library' | 'avatar';

export interface AvatarCropMetadata {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotate: number;
}

export interface MediaPresignRequest {
  purpose: MediaUploadPurpose;
  tab?: MediaCategory;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface MediaPresignResponse {
  uploadUrl: string;
  bucket: string;
  objectKey: string;
  fileId: string;
  expiresIn: number;
}

export interface MediaConfirmRequest {
  fileId: string;
  crop?: AvatarCropMetadata;
}

export interface MediaConfirmResponse {
  fileId: string;
  status: string;
}

export interface AvatarFinalizeRequest {
  fileId: string;
  crop: AvatarCropMetadata;
}

export interface AvatarFinalizeResponse {
  fileId: string;
  profileImageKey: string;
  profileImageUrl: string;
}

export interface MediaProviderStatus {
  provider: StorageProvider;
  status: 'connected' | 'missing_env' | 'error';
  details?: string;
}

export interface GoogleDriveOAuthStartResponse {
  authorizationUrl: string;
  expiresIn: number;
}

export interface MediaUploadTask {
  id: string;
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export enum TaskStatus {
    WAITING_FOR_REQUIREMENT = 'WAITING_FOR_REQUIREMENT',
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    BUG_FIXING = 'BUG_FIXING',
    BLOCKED = 'BLOCKED',
    IN_REVIEW = 'IN_REVIEW',
    ON_HOLD = 'ON_HOLD',
    DONE = 'DONE',
    DEPLOYED = 'DEPLOYED',
    FAILED = 'FAILED',
    GRAVEYARD = 'GRAVEYARD'
}

// ---------------------------------------------------------------------------
// Ticket System
// ---------------------------------------------------------------------------

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING = 'WAITING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TicketParticipantRole {
  OWNER = 'OWNER',
  ASSIGNEE = 'ASSIGNEE',
  FOLLOWER = 'FOLLOWER',
}

export enum TicketApprovalType {
  SEQUENTIAL = 'SEQUENTIAL',
  PARALLEL = 'PARALLEL',
}

export enum TicketApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum TicketApprovalDecision {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum TicketResolutionType {
  ISSUE_RESOLVED = 'ISSUE_RESOLVED',
  DUPLICATE_ISSUE = 'DUPLICATE_ISSUE',
  ISSUE_NOT_SOLVED = 'ISSUE_NOT_SOLVED',
}

export enum TicketApprovalCycleStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  OVERDUE = 'OVERDUE',
  ESCALATED = 'ESCALATED',
}

export enum TicketApprovalItemStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  OVERDUE = 'OVERDUE',
}

export enum TicketTaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum TicketTaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface Ticket {
  id: string;
  tenantId: string;
  departmentId?: string | null;
  createdBy: string;
  ownerId?: string | null;
  assignedUserId?: string | null;
  title: string;
  description: string;
  dueAt?: string | null;
  slaHours?: number | null;
  approvalStatus?: TaskApprovalStatus | null;
  approvalEnabled?: boolean;
  approvalType?: TicketApprovalType | null;
  minApprovals?: number | null;
  approvalDeadline?: string | null;
  approvalApproverIds?: string[];
  status: TicketStatus;
  priority: TicketPriority;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  firstResponseDueAt?: string | null;
  resolutionDueAt?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  resolutionType?: TicketResolutionType | null;
  createdAt: string;
  updatedAt: string;
  statusHistory?: TicketStatusHistoryEntry[];
  approvalCycles?: TicketApprovalCycle[];
  tasks?: TicketTask[];
}

export interface TicketAttachment {
  id: string;
  ticketId: string;
  tenantId: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export interface TicketParticipant {
  userId: string;
  role: TicketParticipantRole;
}

export interface TicketActivityItem {
  id: string;
  ticketId: string;
  eventType: string;
  payload?: Record<string, unknown> | null;
  actorId?: string | null;
  createdAt: string;
}

export interface TicketFollower {
  userId: string;
}

export interface TicketApprovalUser {
  userId: string;
  decision: TicketApprovalDecision;
  comment?: string | null;
  decidedAt?: string | null;
  sequenceOrder?: number | null;
}

export interface TicketApproval {
  id: string;
  ticketId: string;
  attemptNo: number;
  approvalType: TicketApprovalType;
  minApprovals: number;
  status: TicketApprovalStatus;
  requestedBy: string;
  approvalDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
  approvers: TicketApprovalUser[];
}

export interface TicketStatusHistoryEntry {
  id: string;
  ticketId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string | null;
  movedAtUtc: string;
  metadataJson?: Record<string, unknown> | null;
}

export interface TicketApprovalItem {
  id: string;
  approverUserId: string;
  message?: string | null;
  status: TicketApprovalItemStatus;
  actedAtUtc?: string | null;
  orderIndex?: number | null;
}

export interface TicketApprovalCycle {
  id: string;
  ticketId: string;
  approvalType: TicketApprovalType;
  deadlineUtc?: string | null;
  attemptsLeft: number;
  status: TicketApprovalCycleStatus;
  requestedBy: string;
  requestedAtUtc: string;
  completedAtUtc?: string | null;
  approvers: TicketApprovalItem[];
}

export interface TicketTask {
  id: string;
  ticketId: string;
  title: string;
  description: string;
  status: TicketTaskStatus;
  assignedTo?: string | null;
  createdBy: string;
  dueAtUtc?: string | null;
  priority: TicketTaskPriority;
  points: number;
  completedAtUtc?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface TicketLinkedTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  team?: string;
  assignedToId?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  dueAt?: string | null;
  completedAt?: string | null;
  ticketId?: string | null;
  approvalRequired: boolean;
  approvalStatus: TaskApprovalStatus;
  approverId?: string | null;
}

export interface TicketAuditLog {
  id: string;
  ticketId: string;
  eventType: string;
  actorUserId?: string | null;
  createdAtUtc: string;
  summary: string;
  payloadJson?: Record<string, unknown> | null;
}

export interface TicketAuditLogPage {
  items: TicketAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PendingApprovalItem {
  cycleId: string;
  ticketId: string;
  ticketTitle: string;
  ticketNumber: string;
  requestedBy: string;
  requestedAtUtc: string;
  deadlineUtc?: string | null;
  status: TicketApprovalItemStatus;
  approverUserId: string;
  message?: string | null;
  orderIndex?: number | null;
}

export interface TicketListFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  departmentId?: string;
  assigneeId?: string;
  followerId?: string;
  search?: string;
  myTickets?: boolean;
}

export interface TicketCreatePayload {
  title: string;
  description: string;
  departmentId?: string | null;
  ownerId?: string | null;
  assignedUserId?: string | null;
  priority?: TicketPriority;
  dueDate?: string | null;
  followers?: string[];
  approvalEnabled?: boolean;
  approvalType?: TicketApprovalType | null;
  minApprovals?: number | null;
  approvers?: string[];
  approvalDeadline?: string | null;
}

export interface TicketUpdatePayload {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  ownerId?: string | null;
  assignedUserId?: string | null;
  dueDate?: string | null;
  approvalEnabled?: boolean;
  approvalType?: TicketApprovalType | null;
  minApprovals?: number | null;
  approvalDeadline?: string | null;
  approvers?: string[];
}

export interface TicketTransferPayload {
  departmentId: string;
}

export interface TicketParticipantChange {
  userId: string;
  role: TicketParticipantRole;
}

export interface TicketParticipantsUpdate {
  add: TicketParticipantChange[];
  remove: TicketParticipantChange[];
}

export interface TicketTaskSplitItem {
  title: string;
  description?: string;
}

export interface TicketTaskSplitRequest {
  tasks: TicketTaskSplitItem[];
}

export interface TicketApprovalMessagePayload {
  approverUserId: string;
  message: string;
}

export interface TicketApprovalRequestPayload {
  approvalType: TicketApprovalType;
  approvers: TicketApprovalMessagePayload[];
  deadlineUtc?: string | null;
}

export interface TicketApprovalActionPayload {
  message?: string | null;
}

export interface TicketTaskCreatePayload {
  title: string;
  description: string;
  dueAtUtc?: string | null;
  priority: TicketTaskPriority;
  points: number;
  assignedTo?: string | null;
}

export interface TicketLinkedTaskCreatePayload {
  dueAt?: string | null;
  priority: TaskPriority;
  approvalRequired: boolean;
  approverId?: string | null;
}

export interface TicketLinkedTaskUpdatePayload {
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  dueAt?: string | null;
  approvalRequired?: boolean | null;
  approverId?: string | null;
}

export interface TicketTaskUpdatePayload {
  title?: string | null;
  description?: string | null;
  dueAtUtc?: string | null;
  priority?: TicketTaskPriority | null;
  points?: number | null;
  assignedTo?: string | null;
  status?: TicketTaskStatus | null;
}

export interface TicketStatusUpdatePayload {
  status: TicketStatus;
}

export interface TicketClosePayload {
  resolutionType: TicketResolutionType;
  duplicateTicketId?: string | null;
}

export interface TicketTimelineStage {
  stage: string;
  entryTime?: string | null;
  exitTime?: string | null;
  timeSpentSeconds?: number | null;
}

export interface TicketTimeline {
  stages: TicketTimelineStage[];
  totalResolutionSeconds?: number | null;
  totalResolutionLabel?: string | null;
}

export interface TicketAttachmentPresignRequest {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface TicketAttachmentPresignResponse {
  uploadUrl: string;
  fileKey: string;
  headers: Record<string, string>;
}

export interface TicketAttachmentConfirmRequest {
  fileKey: string;
}

export const CUSTOM_STATUS_NAMES: Record<TaskStatus, { name: string; tooltip: string }> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: { name: 'Battle Plan', tooltip: 'New / Ready' },
    [TaskStatus.TODO]: { name: 'Case Filed', tooltip: 'Assigned / To Do' },
    [TaskStatus.IN_PROGRESS]: { name: 'In Progress', tooltip: 'In Progress' },
    [TaskStatus.BUG_FIXING]: { name: 'Bug Fixing', tooltip: 'Fixing defects before review' },
    [TaskStatus.BLOCKED]: { name: 'Boss Encounter', tooltip: 'Blocked / Critical' },
    [TaskStatus.IN_REVIEW]: { name: 'Tactical Shift', tooltip: 'Manager Review / QA' },
    [TaskStatus.ON_HOLD]: { name: 'On Hold', tooltip: 'Paused / Waiting' },
    [TaskStatus.DONE]: { name: 'Conquered', tooltip: 'Done / Complete - level rewards' },
    [TaskStatus.DEPLOYED]: { name: 'Deployed', tooltip: 'Released / Live - level rewards' },
    [TaskStatus.FAILED]: { name: 'Fallen', tooltip: 'Mission Failed - Couldn\'t complete' },
    [TaskStatus.GRAVEYARD]: { name: 'Graveyard', tooltip: 'for tasks no longer active' },
};

export enum RecurrenceRule {
    NONE = 'NONE',
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    AFTER_COMPLETION = 'AFTER_COMPLETION',
}

export enum TaskCategory {
    WORK = 'WORK',
    PERSONAL = 'PERSONAL',
    HEALTH = 'HEALTH',
    EDUCATION = 'EDUCATION',
    TRAVEL = 'TRAVEL',
     OTHER = 'OTHER',
}

export enum RewardImageSource {
    LIBRARY = 'LIBRARY',
    UPLOAD = 'UPLOAD',
}

export enum RewardStatus {
    ACTIVE = 'ACTIVE',
    EXPIRED = 'EXPIRED',
    DELETED = 'DELETED',
}

export enum RewardClaimStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    REDEEMED = 'REDEEMED',
}

export enum RewardLogAction {
    CREATED = 'CREATED',
    EDITED = 'EDITED',
    DELETED = 'DELETED',
    CLAIMED = 'CLAIMED',
    EXPIRED = 'EXPIRED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    AUTO_ASSIGNED = 'AUTO_ASSIGNED',
    IMAGE_DELETED = 'IMAGE_DELETED',
    AUTO_REDEEMED = 'AUTO_REDEEMED',
}

export interface RewardIcon {
    id: string;
    key: string;
    url: string;
    label: string;
}


export interface AvatarAsset {
  id: string;
  name: string;
  storageType: 'file' | 'data_url' | 'external_url';
  url?: string | null;
  dataUrl?: string | null;
  externalUrl?: string | null;
  isDefault: boolean;
  mimeType?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface User {
  id: string;
  tenantId?: string | null;
  name: string;
  email: string;
  employerId?: string;
  role: Role;
  department?: string;
  departmentId?: string | null;
  managerId?: string | null;
  managerEmail?: string;
  shiftName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  morningBreakStart?: string;
  morningBreakEnd?: string;
  lunchBreakStart?: string;
  lunchBreakEnd?: string;
  eveningBreakStart?: string;
  eveningBreakEnd?: string;
  title?: string;
  phone?: string;
  location?: string;
  timezone?: string;
  notes?: string;
  skills?: string[];
  projects?: string[];
  avatarAssetId?: string | null;
  avatarFrame?: string | null;
  avatarAsset?: AvatarAsset | null;
  avatarUrl?: string | null;
  profileImageKey?: string | null;
  profileImageUrl?: string | null;
  passwordHash?: string;
  status: UserStatus;
  points: number;
  overallXpPoints: number;
  claimedXpPoints: number;
  unlockedAchievementIds: string[];
  tasksCreated: number;

  tasksCompleted: number;
  clarityScores: number[];
  claimedRewardIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Level {
  id: string;
  name: string;
  bgImage?: string;
  isActive: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  theme: string;
  bonusMultiplier: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProgress {
  id: string;
  userId: string;
  levelId: string;
  seasonId?: string;
  currentPoints: number;
  totalPointsEarned: number;
  levelUnlockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Levels Module
// ---------------------------------------------------------------------------

export enum LevelEventType {
  REACHED = 'REACHED',
  CLAIMED = 'CLAIMED',
  ANIM_SHOWN = 'ANIM_SHOWN',
}

export interface LevelNodeRead {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export interface LevelNodeCreate {
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
}

export interface LevelNodeUpdate {
  type?: 'CHECKPOINT' | 'TOWER' | 'DECOR' | 'GIFT';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
  xp_threshold?: number;
  reward_id?: string;
  require_confirm?: boolean;
  animation_key?: string;
}

export interface LevelEdge {
  id: string;
  levelId: string;
  fromNode: string;
  toNode: string;
  path?: any;
  createdAt: string;
  updatedAt: string;
}

export interface LevelEvent {
  id: string;
  levelId: string;
  nodeId?: string;
  eventType: 'REACHED' | 'CLAIMED' | 'ANIM_SHOWN';
  userId: string;
  createdAt: string;
}

export interface LevelCreate {
  name: string;
  bgImage?: string;
  isActive?: boolean;
  seasonId?: string;
}

export interface LevelUpdate {
  name?: string;
  bgImage?: string;
  isActive?: boolean;
  seasonId?: string;
}

export interface LevelRead {
  id: string;
  name: string;
  bgImage?: string;
  isActive: boolean;
  seasonId?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  season?: Season;
}



export interface LevelEdgeCreate {
  fromNode: string;
  toNode: string;
  path?: any;
}

export interface LevelEdgeUpdate {
  fromNode?: string;
  toNode?: string;
  path?: any;
}

export interface LevelEdgeRead {
  id: string;
  levelId: string;
  fromNode: string;
  toNode: string;
  path?: any;
  createdAt: string;
  updatedAt: string;
}

export interface LevelEventRead {
  id: string;
  levelId: string;
  nodeId?: string;
  eventType: 'REACHED' | 'CLAIMED' | 'ANIM_SHOWN';
  userId: string;
  createdAt: string;
}

export interface LevelPreviewResponse {
  level: LevelRead;
  nodes: LevelNodeRead[];
  edges: LevelEdgeRead[];
  userXp: number;
  reachableNodes: string[];
}

export type LevelNode = LevelNodeRead;
export type LevelPreview = LevelPreviewResponse;

export interface UserProgressCreate {
  userId: string;
  levelId: string;
  seasonId?: string;
  currentPoints?: number;
  totalPointsEarned?: number;
}

export interface UserProgressUpdate {
  currentPoints?: number;
  totalPointsEarned?: number;
}

export interface UserProgressRead {
  id: string;
  userId: string;
  levelId: string;
  seasonId?: string;
  currentPoints: number;
  totalPointsEarned: number;
  levelUnlockedAt: string;
  createdAt: string;
  updatedAt: string;
  user?: User;
  level?: LevelRead;
  season?: Season;
}



export interface Subtask {
    id: string;
    title: string;
    completed: boolean;
    assignedToId?: string | null;
    assignedUser?: User | null;
    status?: SubtaskStatus;
    sortOrder?: number;
    dependencyIds?: string[];
    dependentIds?: string[];
    dependencies?: SubtaskDependency[];
    dependencyState?: SubtaskDependencyState;
    forceStartReason?: string;
    totalTrackedSeconds?: number;
    completionApprovalRequired?: boolean;
    latestCompletionSubmission?: CompletionSubmission | null;
    completionSubmissions?: CompletionSubmission[];
}

export enum SubtaskStatus {
    WAITING = 'WAITING',
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    BLOCKED = 'BLOCKED',
    IN_REVIEW = 'IN_REVIEW',
    DONE = 'DONE',
}

export type SubtaskDependencyState = 'READY' | 'WAITING' | 'BLOCKED';

export enum CompletionSubmissionStatus {
    PENDING_REVIEW = 'PENDING_REVIEW',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    COMPLETED = 'COMPLETED',
}

export interface CompletionAttachment {
    id: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    checksumSha256: string;
    createdAt: string;
}

export interface CompletionSubmission {
    id: string;
    tenantId: string;
    taskId: string;
    subtaskId: string;
    submittedById?: string | null;
    description: string;
    descriptionWordCount: number;
    status: CompletionSubmissionStatus;
    approvalRequired: boolean;
    attemptNumber: number;
    reviewedById?: string | null;
    reviewedAt?: string | null;
    reviewReason?: string | null;
    createdAt: string;
    attachments: CompletionAttachment[];
}

export interface SubtaskDependency {
    id: string;
    taskId: string;
    subtaskId: string;
    dependsOnSubtaskId: string;
    dependencyOrder: number;
    branchKey?: string | null;
    createdAt: string;
}

export type TaskPointsStatus = 'pending' | 'pending-overdue' | 'completed-on-time' | 'completed-early' | 'completed-late' | 'failed' | 'unconfigured';

export interface TaskPointsBreakdown {
  originalDepartment: string;
  matchedDepartment: string;
  priority: TaskPriority;
  basePoints: number;
  beforeDueBonus: number;
  overduePenalty: number;
  awardedBase: number;
  awardedBonus: number;
  awardedPenalty: number;
  totalAwarded: number;
  potentialEarlyTotal: number;
  potentialLateTotal: number;
  status: TaskPointsStatus;
  isCompleted: boolean;
  bonusEligible: boolean;
  hasDueDate: boolean;
  isBonusApplied: boolean;
  isPenaltyApplied: boolean;
  notes: string[];
  calculatedAt: string; // ISO string
}

export interface Task {
  id: string;
  title: string;
  description: string;
  // FIX: Changed status from string to the new TaskStatus enum.
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  team: string;
  projectId?: string | null;
  project?: TaskProjectSummary | null;
  assignedTo: string[] | null;
  followerIds?: string[];
  taskGroupId: string | null;
  createdBy: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  dueAt: string | null; // ISO string
  completedAt?: string | null; // ISO string
  subtasks: Subtask[];
  recurrenceRule: RecurrenceRule;
  recurringTaskId: string | null; // ID of the original recurring task if this is an instance
  clarityRating: number | null;
  attachments: string[];
  estimatedHours: number | null;
  tags: string[];
  pointsBreakdown?: TaskPointsBreakdown;
  totalTrackedSeconds?: number;
  subtaskApprovalRequired?: boolean | null;
  timeZone?: string; // e.g., 'America/New_York'
}

export enum TimeEntryStatus {
  ACTIVE = 'ACTIVE',
  STOPPED = 'STOPPED',
  CORRECTED = 'CORRECTED',
}

export interface TimeEntry {
  id: string;
  tenantId: string;
  userId: string;
  taskId?: string | null;
  subtaskId?: string | null;
  startedAt: string;
  stoppedAt?: string | null;
  durationSeconds?: number | null;
  status: TimeEntryStatus;
  note?: string | null;
  originalStartedAt?: string | null;
  originalStoppedAt?: string | null;
  originalDurationSeconds?: number | null;
  correctionReason?: string | null;
  correctedById?: string | null;
  correctedAt?: string | null;
  continuedFromId?: string | null;
  startKind?: string | null;
  stopReason?: string | null;
}

export interface TaskTransferPayload {
  fromUserId: string;
  toUserId: string;
  statuses: TaskStatus[];
}

export interface TaskTransferResponse {
  fromUserId: string;
  toUserId: string;
  statuses: TaskStatus[];
  updatedCount: number;
}

export type TaskTransferStatus = 'pending' | 'approved' | 'rejected';

export interface TaskTransferWorkflowRequest {
  toUserId: string;
  note?: string;
}

export interface TaskTransferWorkflowDecision {
  decision: 'approved' | 'rejected';
  comment?: string;
}

export interface TaskTransferWorkflowRead {
  id: string;
  taskId: string;
  fromUserId: string | null;
  toUserId: string;
  requestedById: string;
  approvedById: string | null;
  status: TaskTransferStatus;
  note?: string | null;
  createdAt: string;
  actedAt: string | null;
}

export interface TaskPageResponse {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<TaskStatus, number>;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export type ProjectDashboardStatusSource = 'manual_override' | 'subtask_rollup' | 'task_status';

export interface ProjectDashboardSubtask {
  id: string;
  title: string;
  completed: boolean;
  assignedToId?: string | null;
  assignedUserName?: string | null;
  status: SubtaskStatus;
  sortOrder: number;
  dependencyIds: string[];
  dependentIds: string[];
  dependencyState: SubtaskDependencyState;
  branchKey?: string | null;
  totalTrackedSeconds: number;
  activeTimerUserIds: string[];
  completionApprovalRequired: boolean;
  latestSubmissionStatus?: CompletionSubmissionStatus | null;
  forceStarted: boolean;
}

export interface ProjectDashboardTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  derivedStatus: TaskStatus;
  statusSource: ProjectDashboardStatusSource;
  priority: TaskPriority;
  assignedToId?: string | null;
  assignedUserName?: string | null;
  projectId: string;
  dueAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  completedSubtasks: number;
  totalSubtasks: number;
  totalTrackedSeconds: number;
  activeTimerUserIds: string[];
  subtasks: ProjectDashboardSubtask[];
}

export interface ProjectDashboardWorkload {
  userId: string;
  name: string;
  role: ProjectMemberRole;
  assignedTasks: number;
  assignedSubtasks: number;
  actionableSubtasks: number;
  waitingSubtasks: number;
  blockedSubtasks: number;
  inReviewSubtasks: number;
  completedSubtasks: number;
  totalTrackedSeconds: number;
}

export interface ProjectDashboardSummary {
  taskTotal: number;
  subtaskTotal: number;
  completedSubtasks: number;
  progressPercent: number;
  totalTrackedSeconds: number;
  activeTimerCount: number;
  statusCounts: Record<TaskStatus, number>;
  derivedStatusCounts: Record<TaskStatus, number>;
  subtaskStatusCounts: Record<SubtaskStatus, number>;
  priorityCounts: Record<TaskPriority, number>;
  workload: ProjectDashboardWorkload[];
}

export interface ProjectTaskDashboardResponse {
  project: Project;
  summary: ProjectDashboardSummary;
  items: ProjectDashboardTask[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusPolicy: string;
}

export interface TaskCalendarDaySummary {
  date: string;
  total: number;
  completed: number;
  overdue: number;
  urgent: number;
  high: number;
  medium: number;
  low: number;
  dueSoon: number;
}

export interface TaskCalendarSummaryResponse {
  startDate: string;
  endDate: string;
  days: TaskCalendarDaySummary[];
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assignedToId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
}

export interface TaskKanbanColumn {
  status: TaskStatus;
  title: string;
  order: number;
  count: number;
  items: Task[];
}

export interface TaskKanbanResponse {
  columns: TaskKanbanColumn[];
}

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string; // ISO string
}

export interface Department {
    id: string;
    name: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  encryption: 'none' | 'ssl' | 'tls';
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  stages: KanbanColumn[];
  assignedDepartments: string[];
  assignedUsers: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  order: number;
  pipelineId: string;
}

export interface ApiConfig {
  provider: string;
  apiKey?: string;
}

export type AchievementIcon = 'RocketLaunch' | 'Bolt' | 'AcademicCap' | 'Fire' | 'Clipboard' | 'Sparkles' | 'Image';

export interface Achievement {
    id: string;
    title: string;
    description: string;
    points: number;
    icon: AchievementIcon;
    imageUrl?: string | null;
    custom?: boolean;
}

export type BadgeState = 'draft' | 'active' | 'archived';
export type BadgeStatus = 'locked' | 'in_progress' | 'earned';
export type BadgeOperator = 'AND' | 'OR';
export type BadgeEntity = 'task' | 'ticket' | 'subtask' | 'comment' | 'project' | 'time' | 'manual';
export type BadgeEvent =
  | 'created'
  | 'completed'
  | 'updated'
  | 'reopened'
  | 'deleted'
  | 'assigned'
  | 'priority_changed'
  | 'status_changed'
  | 'overdue';
export type BadgeCountType = '>=' | '==' | '<=';
export type BadgeTimeWindowUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
export type BadgeScope = 'self' | 'team' | 'any';

export interface BadgeRuleConditions {
  priority?: string[];
  assignedTo?: BadgeScope;
  createdBy?: BadgeScope;
  projectId?: string | null;
  pipelineId?: string | null;
}

export interface BadgeRuleCount {
  type: BadgeCountType;
  value: number;
}

export interface BadgeRuleTimeWindow {
  value: number;
  unit: BadgeTimeWindowUnit;
}

export interface BadgeRule {
  entity: BadgeEntity;
  event: BadgeEvent;
  conditions: BadgeRuleConditions;
  count: BadgeRuleCount;
  timeWindow?: BadgeRuleTimeWindow | null;
  negative?: boolean;
}

export interface BadgeRuleSet {
  operator: BadgeOperator;
  rules: BadgeRule[];
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  tier: string;
  tierGroup?: string | null;
  tierOrder: number;
  bonusXp: number;
  imageUrl?: string | null;
  imageAssetPath?: string | null;
  state: BadgeState;
  isSystem: boolean;
  rules?: BadgeRuleSet | null;
  createdAt: string;
  updatedAt: string;
}

export interface BadgeProgress {
  id: string;
  name: string;
  description: string;
  tier: string;
  tierGroup?: string | null;
  tierOrder: number;
  bonusXp: number;
  imageUrl?: string | null;
  state: BadgeState;
  isSystem: boolean;
  status: BadgeStatus;
  progressPercent: number;
  earnedAt?: string | null;
}

export interface SeasonalChallengeConfig {
    id: string;
    title: string;
    description: string;
    rewardLabel: string;
    xpReward: number;
    accent: string;
    icon: AchievementIcon;
    expiresAt?: string | null;
}

export interface CustomBadge {
    id: string;
    title: string;
    description: string;
    points: number;
    imageUrl: string | null;
}

export interface Reward {
    id: string;
    title: string;
    description: string;
    imageSource: RewardImageSource;
    imageRef?: string | null;
    imageUrl?: string | null;
    xpRequired: number;
    deptWhitelist?: string[] | null;
    autoRedeem: boolean;
    allowMultipleClaims: boolean;
    expiresAt?: string | null;
    status: RewardStatus;
    createdAt: string;
    updatedAt: string;
    createdById?: string | null;
    updatedById?: string | null;
}

export interface RewardListResponse {
    items: Reward[];
    page: number;
    total: number;
    pageSize: number;
    totalPages: number;
}

export interface RewardClaimUser {
    id: string;
    name: string;
    email: string;
    role: Role;
    departmentId?: string | null;
}

export interface RewardClaim {
    id: string;
    rewardId: string;
    userId: string;
    status: RewardClaimStatus;
    xpSpent: number;
    claimedAt: string;
    resolvedAt?: string | null;
    approverId?: string | null;
    reward: Reward;
    user: RewardClaimUser;
}

export interface RewardClaimListResponse {
    items: RewardClaim[];
    page: number;
    total: number;
    pageSize: number;
    totalPages: number;
}

export interface RewardLog {
    id: string;
    actorId?: string | null;
    subjectType: string;
    subjectId: string;
    action: RewardLogAction;
    meta?: Record<string, unknown> | null;
    createdAt: string;
}

export interface RewardLogListResponse {
    items: RewardLog[];
    page: number;
    total: number;
    pageSize: number;
    totalPages: number;
}

export interface AuditActor {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: Role;
}

export interface AuditEvent {
    id: string;
    actorId?: string | null;
    actor?: AuditActor | null;
    eventType: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown> | null;
    createdAt: string;
}

export interface AuditEventListResponse {
    items: AuditEvent[];
    page: number;
    total: number;
    pageSize: number;
    totalPages: number;
}

export type AuditLogSource = 'manual' | 'automation' | 'api' | 'system';
export type AuditLogSeverity = 'info' | 'warning' | 'critical';
export type AuditLogStatus = 'success' | 'failed';
export type AuditLogCategory =
    | 'user'
    | 'task'
    | 'ticket'
    | 'approval'
    | 'automation'
    | 'notification'
    | 'security'
    | 'system';

export interface AuditLog {
    id: string;
    actorId?: string | null;
    actorRole?: string | null;
    actor?: AuditActor | null;
    action: string;
    category: AuditLogCategory;
    entityType?: string | null;
    entityId?: string | null;
    targetUserId?: string | null;
    approvalId?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    source: AuditLogSource;
    severity: AuditLogSeverity;
    status: AuditLogStatus;
    reason?: string | null;
    trigger?: string | null;
    route?: string | null;
    method?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
}

export interface AuditLogListResponse {
    items: AuditLog[];
    page: number;
    total: number;
    pageSize: number;
    totalPages: number;
}

export interface AuditRetentionConfig {
    id: number;
    retentionDays: number;
    createdAt: string;
    updatedAt: string;
    lastAppliedAt?: string | null;
}

export interface AuditRetentionApplyResponse {
    updated: number;
    cutoffAt: string;
    retentionDays: number;
}

export enum NotificationType {
  TASK_CREATED = 'TASK_CREATED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_DELETED = 'TASK_DELETED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_OVERDUE = 'TASK_OVERDUE',
  COMMENT_ADDED = 'COMMENT_ADDED',
  ACHIEVEMENT_UNLOCKED = 'ACHIEVEMENT_UNLOCKED',
  REWARD_CLAIMED = 'REWARD_CLAIMED',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  TICKET_CREATED = 'TICKET_CREATED',
  TICKET_UPDATED = 'TICKET_UPDATED',
  TICKET_DELETED = 'TICKET_DELETED',
  TICKET_ASSIGNED = 'TICKET_ASSIGNED',
  TICKET_CLOSED = 'TICKET_CLOSED',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  DEPARTMENT_CREATED = 'DEPARTMENT_CREATED',
  DEPARTMENT_UPDATED = 'DEPARTMENT_UPDATED',
  DEPARTMENT_DELETED = 'DEPARTMENT_DELETED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_ACTED = 'APPROVAL_ACTED',
  SLA_BREACH = 'SLA_BREACH',
  SUBTASK_ACTIVATED = 'SUBTASK_ACTIVATED',
  SUBTASK_REASSIGNED = 'SUBTASK_REASSIGNED',
  SUBTASK_APPROVED = 'SUBTASK_APPROVED',
  SUBTASK_REJECTED = 'SUBTASK_REJECTED',
  SUBTASK_FORCE_STARTED = 'SUBTASK_FORCE_STARTED',
  SUBTASK_REVIEW_REQUIRED = 'SUBTASK_REVIEW_REQUIRED',
  MENTION = 'MENTION',
}

export enum NotificationEntityType {
  TICKET = 'ticket',
  TASK = 'task',
  SUBTASK = 'subtask',
  APPROVAL = 'approval',
  USER = 'user',
  DEPARTMENT = 'department',
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title?: string | null;
  body?: string | null;
  message: string;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  deepLink?: string | null;
  isRead: boolean;
  relatedTaskId: string | null;
  relatedRewardId: string | null;
  relatedChatId?: string | null;
  createdAt: string; // ISO string
  source?: 'api' | 'local';
}

export type NotificationModule = 'tasks' | 'tickets' | 'users' | 'departments' | 'comments' | 'chat';

export type ChatConversationType = 'DIRECT' | 'GROUP' | 'SPACE';
export type ChatMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type ChatMessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';

export interface ChatMember {
  id: string;
  conversationId: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  title?: string | null;
  departmentName?: string | null;
  accountStatus: UserStatus;
  appRole: Role;
  role: ChatMemberRole;
  joinedAt: string;
  lastReadMessageId?: string | null;
  lastReadAt?: string | null;
  isMuted: boolean;
  isPinned: boolean;
}

export interface ChatReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface ChatAttachment {
  id: string;
  messageId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  url?: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  clientId?: string | null;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: Role;
  sender?: { id: string; name: string; avatarUrl?: string | null };
  messageType: ChatMessageType;
  content: string;
  replyToMessageId?: string | null;
  replyPreview?: { id: string; senderName: string; content: string } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  reactions: ChatReaction[];
  attachments: ChatAttachment[];
  mentions?: string[];
}

export interface ChatConversation {
  id: string;
  tenantId: string;
  type: ChatConversationType;
  name?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  projectId?: string | null;
  teamId?: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  members: ChatMember[];
  unreadCount: number;
  lastMessage?: ChatMessage | null;
}

export interface ChatDirectoryUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  presence: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastSeenAt?: string | null;
  roleName?: string | null;
  teamName?: string | null;
  title?: string | null;
  existingConversationId?: string | null;
  isFavorite: boolean;
  unreadCount: number;
  latestMessagePreview?: string | null;
  lastMessageAt?: string | null;
}

export interface ChatDirectoryPage {
  items: ChatDirectoryUser[];
  nextCursor?: string | null;
}

export interface ChatConversationCreatePayload {
  type: Exclude<ChatConversationType, 'DIRECT'>;
  name?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  projectId?: string | null;
  teamId?: string | null;
  isPrivate?: boolean;
  memberIds?: string[];
}

export interface ChatDirectCreatePayload {
  userId: string;
}

export interface ChatMessageCreatePayload {
  content: string;
  messageType?: ChatMessageType;
  clientId?: string | null;
  replyToMessageId?: string | null;
  attachments?: Omit<ChatAttachment, 'id' | 'messageId' | 'createdAt'>[];
}

export interface ChatMessagePage {
  items: ChatMessage[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface ChatPinnedMessage {
  id: string;
  conversationId: string;
  messageId: string;
  pinnedBy: string;
  createdAt: string;
  message: ChatMessage;
}

export interface ChatMessageSearchResult {
  message: ChatMessage;
  conversation: ChatConversation;
}

export interface ChatMessageSearchPage {
  items: ChatMessageSearchResult[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface NotificationPreference {
  module: NotificationModule;
  pushEnabled: boolean;
  updatedAt?: string | null;
}



export enum DataExportScope {
  USERS = 'users',
  TASKS = 'tasks',
  DEPARTMENTS = 'departments',
  ALL = 'all',
}

export interface BackupTaskSubtask {
  id?: string;
  title: string;
  completed: boolean;
}

export interface BackupTaskComment {
  id?: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface BackupTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  team: string;
  assignedToIds: string[] | null;
  taskGroupId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  dueAt?: string | null;
  completedAt?: string | null;
  recurrenceRule: RecurrenceRule;
  recurringTaskId?: string | null;
  clarityRating?: number | null;
  attachments: string[];
  estimatedHours?: number | null;
  tags: string[];
  subtasks: BackupTaskSubtask[];
  comments: BackupTaskComment[];
  dependencies: string[];
}

export interface BackupUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  departmentId?: string | null;
  managerId?: string | null;
  managerEmail?: string;
  shiftName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  morningBreakStart?: string;
  morningBreakEnd?: string;
  lunchBreakStart?: string;
  lunchBreakEnd?: string;
  eveningBreakStart?: string;
  eveningBreakEnd?: string;
  title?: string;
  phone?: string;
  location?: string;
  timezone?: string;
  notes?: string;
  skills?: string[];
  projects?: string[];
  points: number;
  tasksCreated: number;
  tasksCompleted: number;
  clarityScores: number[];
  claimedRewardIds: string[];
  unlockedAchievementIds: string[];
  hashedPassword: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupNotification {
  id: string;
  userId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  relatedTaskId?: string | null;
  relatedRewardId?: string | null;
  relatedChatId?: string | null;
  createdAt: string;
}

export interface BackupUserReward {
  id: string;
  userId: string;
  rewardId: string;
  status: RewardClaimStatus;
  xpSpent: number;
  claimedAt: string;
  resolvedAt?: string | null;
  approverId?: string | null;
}

export interface BackupUserAchievement {
  userId: string;
  achievementId: string;
  unlockedAt: string;
}

export interface BackupKanbanColumn {
  id: string;
  title: string;
  order: number;
}

export interface DataExportBundle {
  scope: DataExportScope;
  generatedAt: string;
  departments: Department[];
  users: BackupUser[];
  tasks: BackupTask[];
  achievements: Achievement[];
  rewards: Reward[];
  kanbanColumns: BackupKanbanColumn[];
  notifications: BackupNotification[];
  userRewards: BackupUserReward[];
  userAchievements: BackupUserAchievement[];
}

export interface DataImportPayload {
  scope: DataExportScope;
  departments?: Department[];
  users?: BackupUser[];
  tasks?: BackupTask[];
  achievements?: Achievement[];
  rewards?: Reward[];
  kanbanColumns?: BackupKanbanColumn[];
  notifications?: BackupNotification[];
  userRewards?: BackupUserReward[];
  userAchievements?: BackupUserAchievement[];
}

export interface FeatureFlag {
  key: string;
  label: string;
  group: string;
  description?: string | null;
  enabled: boolean;
}

export interface FeatureFlagUpdate {
  key: string;
  enabled: boolean;
}

export interface ReportingSession {
  id: string;
  tenant_id: string;
  employee_id: string;
  manager_id?: string | null;
  department_id?: string | null;
  report_date: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HourlyReportSlot {
  id: string;
  tenant_id: string;
  session_id: string;
  slot_hour: number;
  status: string;
  reminder_state: string;
  last_reminder_at?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SalesVisit {
  id: string;
  tenant_id: string;
  session_id: string;
  employee_id: string;
  manager_id?: string | null;
  department_id?: string | null;
  location_name?: string | null;
  checkin_at?: string | null;
  checkin_lat?: string | null;
  checkin_lng?: string | null;
  checkout_at?: string | null;
  checkout_lat?: string | null;
  checkout_lng?: string | null;
  checkin_photo_id?: string | null;
  checkout_photo_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyReport {
  id: string;
  tenant_id: string;
  session_id: string;
  template_id?: string | null;
  employee_id: string;
  manager_id?: string | null;
  department_id?: string | null;
  report_date: string;
  status: string;
  submitted_at?: string | null;
  payload: Record<string, unknown>;
  rendered_html?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  department_id?: string | null;
  version: number;
  published_at?: string | null;
  is_global: boolean;
  is_active: boolean;
  deleted_at?: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReportComment {
  id: string;
  tenant_id: string;
  report_id: string;
  manager_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface TeamStatus {
  employee_id: string;
  session_id: string;
  report_date: string;
  session_status: string;
  report_status: string;
}

export interface ReportTimelineEvent {
  id: string;
  tenant_id: string;
  session_id?: string | null;
  user_id: string;
  report_date: string;
  event_type: string;
  event_time: string;
  source: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface ReportTaskSnapshot {
  id: string;
  tenant_id: string;
  session_id?: string | null;
  report_date: string;
  task_id: string;
  snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReportPreviewResponse {
  report_date: string;
  timeline: ReportTimelineEvent[];
  task_snapshots: ReportTaskSnapshot[];
  draft_json: Record<string, unknown>;
}

export interface GeneratedReportResponse {
  report: DailyReport;
  export_url?: string | null;
  email_sent: boolean;
  webex_sent: boolean;
}


