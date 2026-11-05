import Avatar from '../components/Avatar';
import ClientSelect from '../components/ClientSelect';
import SearchableMultiSelect from '../components/ui/SearchableMultiSelect';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useNotificationRefresh } from '../hooks/useNotificationRefresh';
import {
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  BriefcaseIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import PageLoader from '../components/loading/PageLoader';
import RestoreConfirmation from '../components/RestoreConfirmation';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  Client,
  ClientStatus,
  Project,
  ProjectCreatePayload,
  ProjectDashboardTask,
  ProjectListFilters,
  ProjectMemberRole,
  ProjectTaskDashboardResponse,
  ProjectStatus,
  ProjectUpdatePayload,
  Role,
  SubtaskStatus,
  TaskPriority,
  TaskStatus,
  User,
  UserStatus,
  CUSTOM_STATUS_NAMES,
} from '../types';
import { ProjectDraft, toProjectPayload, validateProjectDraft } from '../utils/projectValidation';
import { formatTaskStatus } from '../utils';

type ProjectFormProps = {
  project: Project | null;
  clients: Client[];
  users: User[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ProjectCreatePayload | ProjectUpdatePayload) => Promise<void>;
};

const statusTone: Record<ProjectStatus, string> = {
  [ProjectStatus.ACTIVE]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  [ProjectStatus.ARCHIVED]: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

const emptyDraft = (): ProjectDraft => ({
  name: '',
  clientId: '',
  description: '',
  startDate: '',
  endDate: '',
  managerIds: [],
  memberIds: [],
  subtaskApprovalRequiredDefault: false,
});

const toDateInput = (value?: string | null) => (value ? value.slice(0, 10) : '');

const toDraft = (project: Project | null, clients: Client[]): ProjectDraft => {
  if (!project) {
    return { ...emptyDraft(), clientId: clients[0]?.id ?? '' };
  }
  return {
    name: project.name,
    clientId: project.clientId,
    description: project.description ?? '',
    startDate: toDateInput(project.startDate),
    endDate: toDateInput(project.endDate),
    managerIds: project.members.filter((member) => member.role === ProjectMemberRole.MANAGER).map((member) => member.userId),
    memberIds: project.members.filter((member) => member.role === ProjectMemberRole.MEMBER).map((member) => member.userId),
    subtaskApprovalRequiredDefault: project.subtaskApprovalRequiredDefault ?? false,
  };
};

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : '-');
const formatDuration = (seconds = 0) => {
  if (!seconds) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const taskStatusLabel = (status: TaskStatus) => CUSTOM_STATUS_NAMES[status]?.name ?? formatTaskStatus(status);

const subtaskStatusTone: Record<SubtaskStatus, string> = {
  [SubtaskStatus.WAITING]: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  [SubtaskStatus.TODO]: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  [SubtaskStatus.IN_PROGRESS]: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  [SubtaskStatus.BLOCKED]: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  [SubtaskStatus.IN_REVIEW]: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200',
  [SubtaskStatus.DONE]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
};

const ProgressBar: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div>
    <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
      <span>{label}</span>
      <span>{value}%</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  </div>
);

const DashboardTaskRow: React.FC<{
  task: ProjectDashboardTask;
  canManage: boolean;
  busy: boolean;
  onOverride: (task: ProjectDashboardTask, status: TaskStatus) => void;
}> = ({ task, canManage, busy, onOverride }) => {
  const subtaskById = useMemo(() => new Map(task.subtasks.map((subtask) => [subtask.id, subtask])), [task.subtasks]);
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white">{task.title}</h4>
          <p className="mt-1 text-xs text-gray-500">
            Parent: {taskStatusLabel(task.status)} / Derived: {taskStatusLabel(task.derivedStatus)} / {task.statusSource.replace('_', ' ')}
          </p>
          <p className="mt-1 text-xs text-gray-500">Assignee: {task.assignedUserName || 'Unassigned'} / Priority: {task.priority}</p>
        </div>
        {canManage && (
          <label className="text-xs text-gray-500">
            Override
            <select
              value={task.status}
              disabled={busy}
              onChange={(event) => onOverride(task, event.target.value as TaskStatus)}
              className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              {Object.values(TaskStatus).map((status) => (
                <option key={status} value={status}>{taskStatusLabel(status)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <ProgressBar value={task.progressPercent} label={`${task.completedSubtasks}/${task.totalSubtasks} subtasks done`} />
        <div className="text-xs text-gray-500 md:text-right">
          <div>{formatDuration(task.totalTrackedSeconds)} tracked</div>
          <div>{task.activeTimerUserIds.length ? `${task.activeTimerUserIds.length} active timer(s)` : 'No active timers'}</div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {task.subtasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">No subtasks.</p>
        ) : task.subtasks.map((subtask) => {
          const dependencies = subtask.dependencyIds.map((id) => subtaskById.get(id)?.title || id.slice(0, 8));
          return (
            <div key={subtask.id} className="rounded-md border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${subtaskStatusTone[subtask.status]}`}>{subtask.status.replace('_', ' ')}</span>
                <span className="font-medium">{subtask.title}</span>
                {subtask.forceStarted && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">force-started</span>}
                {subtask.completionApprovalRequired && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">approval</span>}
                {subtask.latestSubmissionStatus && <span className="text-xs text-gray-500">{subtask.latestSubmissionStatus}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>Assignee: {subtask.assignedUserName || 'Unassigned'}</span>
                <span>Dependency: {subtask.dependencyState}</span>
                <span>{dependencies.length ? `After ${dependencies.join(', ')}` : 'Parallel/independent'}</span>
                <span>{formatDuration(subtask.totalTrackedSeconds)}</span>
                {subtask.activeTimerUserIds.length > 0 && <span>{subtask.activeTimerUserIds.length} active timer(s)</span>}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
};

const ProjectFormModal: React.FC<ProjectFormProps> = ({ project, clients, users, saving, error, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<ProjectDraft>(() => toDraft(project, clients));
  const [localError, setLocalError] = useState<string | null>(null);
  const [managerSearch, setManagerSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    setDraft(toDraft(project, clients));
    setLocalError(null);
  }, [project]);

  useEffect(() => {
    if (!project && clients.length) setDraft(current => current.clientId ? current : { ...current, clientId: clients[0].id });
  }, [project, clients]);

  // Keep historical selections visible even when a user is inactive or absent
  // from the current user lookup. New selections retain the existing role rules.
  const knownUsers = useMemo(() => Array.from(new Map([
    ...(project?.members ?? []).map(member => ({ ...member, id: member.userId, role: member.userRole,
      tenantId: member.tenantId || project?.tenantId, avatarUrl: null })),
    ...users,
  ].map(person => [person.id, person])).values()), [project, users]);
  const managerOptions = useMemo(
    () => knownUsers.filter(person => draft.managerIds.includes(person.id)
      || (person.status === UserStatus.ACTIVE && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(person.role))),
    [knownUsers, draft.managerIds],
  );
  const memberOptions = useMemo(() => knownUsers.filter(person => person.status === UserStatus.ACTIVE || draft.memberIds.includes(person.id)), [knownUsers, draft.memberIds]);
  const userOption = (person: typeof knownUsers[number]) => ({ id: person.id, name: person.name,
    description: `${person.role} · ${person.email}`, active: person.status === UserStatus.ACTIVE,
    statusLabel: person.status === UserStatus.ACTIVE ? 'Online' : 'Offline' });
  const matches = (person: typeof knownUsers[number], term: string) => [person.name, person.email, person.role,
    'department' in person ? person.department : ''].some(value => (value || '').toLowerCase().includes(term.trim().toLowerCase()));
  const pickerClass = 'rounded-2xl bg-slate-950/95 text-slate-50 dark:bg-transparent';

  const toggleId = (field: 'managerIds' | 'memberIds', userId: string) => {
    setDraft((prev) => {
      const next = prev[field].includes(userId) ? prev[field].filter((id) => id !== userId) : [...prev[field], userId];
      const otherField = field === 'managerIds' ? 'memberIds' : 'managerIds';
      return { ...prev, [field]: next, [otherField]: prev[otherField].filter((id) => id !== userId) };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateProjectDraft(draft);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setLocalError(firstError);
      return;
    }
    setLocalError(null);
    await onSubmit(toProjectPayload(draft));
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="project-form-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-4">
      <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 id="project-form-title" className="text-lg font-semibold text-gray-900 dark:text-white">{project ? 'Edit Project' : 'Create Project'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Client-linked project workspace</p>
          </div>
          <button type="button" aria-label="Close project form" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div role="region" aria-label="Project details" className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-6 custom-scrollbar md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Project name</span>
            <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" autoFocus />
          </label>
          <div>
            <label htmlFor="projectClient" className="text-xs uppercase tracking-[0.25em] text-gray-700 dark:text-white/50">Client</label>
            <ClientSelect value={draft.clientId} initialClient={clients.find(client => client.id === draft.clientId)
              ?? (project?.client.id === draft.clientId ? project.client : null)}
              onChange={clientId => setDraft(current => ({ ...current, clientId }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Start</span>
              <input type="date" value={draft.startDate} onChange={(event) => setDraft((prev) => ({ ...prev, startDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            </label>
            <label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">End</span>
              <input type="date" value={draft.endDate} onChange={(event) => setDraft((prev) => ({ ...prev, endDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            </label>
          </div>
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Description</span>
            <textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} className="mt-1 min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>
          <label className="md:col-span-2 flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
            <input
              type="checkbox"
              checked={draft.subtaskApprovalRequiredDefault}
              onChange={(event) => setDraft((prev) => ({ ...prev, subtaskApprovalRequiredDefault: event.target.checked }))}
            />
            <span className="font-medium text-gray-700 dark:text-gray-200">Require approval for subtask completions by default</span>
          </label>

          <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="projectManagers" className="text-xs uppercase tracking-[0.25em] text-gray-700 dark:text-white/50">Managers</label>
              <SearchableMultiSelect id="projectManagers" label="Managers" avoidClipping className={pickerClass}
                options={managerOptions.filter(person => matches(person, managerSearch)).map(userOption)}
                selectedOptions={knownUsers.filter(person => draft.managerIds.includes(person.id)).map(userOption)}
                value={draft.managerIds} onToggle={id => toggleId('managerIds', id)}
                search={managerSearch} onSearchChange={setManagerSearch} placeholder="Search and select managers..."
                searchPlaceholder="Search managers by name, role, email, team..." emptyMessage="No managers match your search."
                loadingMessage="Loading managers..." selectedStatusLabel="Added"
                renderAvatar={(option, size) => <Avatar user={knownUsers.find(person => person.id === option.id)} size={size} />} />
            </div>
            <div>
              <label htmlFor="projectMembers" className="text-xs uppercase tracking-[0.25em] text-gray-700 dark:text-white/50">Members</label>
              <SearchableMultiSelect id="projectMembers" label="Members" avoidClipping className={pickerClass}
                options={memberOptions.filter(person => matches(person, memberSearch)).map(userOption)}
                selectedOptions={knownUsers.filter(person => draft.memberIds.includes(person.id)).map(userOption)}
                value={draft.memberIds} onToggle={id => toggleId('memberIds', id)}
                search={memberSearch} onSearchChange={setMemberSearch} placeholder="Search and select members..."
                searchPlaceholder="Search members by name, role, email, team..." emptyMessage="No members match your search."
                loadingMessage="Loading members..." selectedStatusLabel="Added"
                renderAvatar={(option, size) => <Avatar user={knownUsers.find(person => person.id === option.id)} size={size} />} />
            </div>
          </div>

          {(localError || error) && <div className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{localError || error}</div>}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : project ? 'Save Project' : 'Create Project'}</button>
        </div>
      </form>
    </div>, document.body
  );
};

const Projects: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const linkedProjectId = searchParams.get('projectId');
  const [notificationRevision, setNotificationRevision] = useState(0);
  const [filters, setFilters] = useState<ProjectListFilters>({ page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc', status: ProjectStatus.ACTIVE });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Project | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoring = useRef(false);
  const listGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formProject, setFormProject] = useState<Project | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [taskDashboard, setTaskDashboard] = useState<ProjectTaskDashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const dashboardGeneration = useRef(0);
  const [dashboardFilters, setDashboardFilters] = useState<{
    page: number;
    pageSize: number;
    q: string;
    status: TaskStatus | '';
    priority: TaskPriority | '';
    memberId: string;
  }>({ page: 1, pageSize: 10, q: '', status: '', priority: '', memberId: '' });
  const [statusOverrideBusy, setStatusOverrideBusy] = useState(false);

  const canManage = user?.role === Role.OWNER || user?.role === Role.ADMIN || user?.role === Role.MANAGER;

  const fetchProjects = useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getProjects(filters);
      if (generation !== listGeneration.current) return;
      if ((filters.page ?? 1) > response.totalPages) {
        setFilters(prev => ({ ...prev, page: response.totalPages }));
        return;
      }
      setProjects(response.items);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setSelectedProject((current) => linkedProjectId
        ? response.items.find((project) => project.id === linkedProjectId) ?? (current?.id === linkedProjectId ? current : null)
        : response.items.find((project) => project.id === current?.id) ?? response.items[0] ?? null);
    } catch (err) {
      if (generation !== listGeneration.current) return;
      setError(err instanceof Error ? err.message : 'Unable to load projects.');
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, [filters, linkedProjectId]);
  useNotificationRefresh(() => { void fetchProjects(); setNotificationRevision(revision => revision + 1); });

  useEffect(() => {
    if (!linkedProjectId) return;
    let active = true;
    setSelectedProject(null);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(linkedProjectId)) return;
    void api.getProject(linkedProjectId).then(project => {
      if (active) setSelectedProject(project);
    }).catch(() => { if (active) setError('Unable to open this project. It may no longer be available to your account.'); });
    return () => { active = false; };
  }, [linkedProjectId, user?.id, user?.tenantId, notificationRevision]);

  useEffect(() => () => { listGeneration.current++; dashboardGeneration.current++; }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const fetchTaskDashboard = useCallback(async () => {
    const generation = ++dashboardGeneration.current;
    if (!selectedProject) {
      setTaskDashboard(null);
      setDashboardLoading(false);
      return;
    }
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await api.getProjectTaskDashboard(selectedProject.id, dashboardFilters);
      if (generation !== dashboardGeneration.current) return;
      setTaskDashboard(response);
    } catch (err) {
      if (generation !== dashboardGeneration.current) return;
      setDashboardError(err instanceof Error ? err.message : 'Unable to load project task dashboard.');
    } finally {
      if (generation === dashboardGeneration.current) setDashboardLoading(false);
    }
  }, [selectedProject, dashboardFilters]);

  useEffect(() => {
    fetchTaskDashboard();
  }, [fetchTaskDashboard]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [clientResponse, userResponse] = await Promise.all([
          api.getClients({ page: 1, pageSize: 100, status: ClientStatus.ACTIVE, sortBy: 'company_name', sortOrder: 'asc' }),
          api.getUsers(),
        ]);
        setClients(clientResponse.items);
        setUsers(userResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load project lookups.');
      }
    };
    loadLookups();
  }, []);

  const openCreate = () => {
    setFormProject(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (project: Project) => {
    setFormProject(project);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (payload: ProjectCreatePayload | ProjectUpdatePayload) => {
    setActionLoading(true);
    setFormError(null);
    try {
      const saved = formProject
        ? await api.updateProject(formProject.id, payload)
        : await api.createProject(payload as ProjectCreatePayload);
      setSuccess(formProject ? 'Project updated.' : 'Project created.');
      setFormOpen(false);
      setSelectedProject(saved);
      await fetchProjects();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save project.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async (project: Project) => {
    if (!window.confirm(`Archive ${project.name}?`)) return;
    setActionLoading(true);
    setError(null);
    try {
      const archived = await api.archiveProject(project.id);
      setSelectedProject(archived);
      setSuccess('Project archived.');
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive project.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget || restoring.current) return;
    restoring.current = true;
    setActionLoading(true); setRestoreError(null); setSuccess(null);
    try {
      const restored = await api.restoreProject(restoreTarget.id);
      setSelectedProject(restored);
      if (filters.status && filters.status !== restored.status) setTotal(count => Math.max(0, count - 1));
      setProjects(rows => rows.flatMap(row => row.id !== restored.id ? [row]
        : !filters.status || filters.status === restored.status ? [restored] : []));
      setSuccess('Project restored.');
      setRestoreTarget(null);
      await fetchProjects();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Unable to restore project.');
    } finally { restoring.current = false; setActionLoading(false); }
  };

  const handleStatusOverride = async (task: ProjectDashboardTask, nextStatus: TaskStatus) => {
    if (!selectedProject || nextStatus === task.status) return;
    const reason = window.prompt(`Reason for overriding "${task.title}" to ${taskStatusLabel(nextStatus)}?`);
    if (!reason || reason.trim().length < 3) return;
    setStatusOverrideBusy(true);
    setDashboardError(null);
    try {
      await api.overrideProjectTaskStatus(selectedProject.id, task.id, nextStatus, reason.trim());
      setSuccess('Task status override recorded.');
      await fetchTaskDashboard();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : 'Unable to override task status.');
    } finally {
      setStatusOverrideBusy(false);
    }
  };

  const managers = selectedProject?.members.filter((member) => member.role === ProjectMemberRole.MANAGER) ?? [];
  const members = selectedProject?.members.filter((member) => member.role === ProjectMemberRole.MEMBER) ?? [];
  const canManageSelected = Boolean(canManage && selectedProject && (user?.role !== Role.MANAGER
    || selectedProject.members.some(member => member.userId === user.id && member.role === ProjectMemberRole.MANAGER)));

  if (loading && projects.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{total} projects in view</p>
          </div>
          {canManage && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <PlusIcon className="h-4 w-4" />
              New Project
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="relative min-w-64 flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={filters.q ?? ''} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value, page: 1 }))} placeholder="Search projects or clients" className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </div>
          <select aria-label="Project status" value={filters.status ?? ''} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as ProjectStatus | '', page: 1 }))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
            <option value="">All statuses</option>
            <option value={ProjectStatus.ACTIVE}>Active</option>
            <option value={ProjectStatus.ARCHIVED}>Archived</option>
          </select>
          <select value={filters.clientId ?? ''} onChange={(event) => setFilters((prev) => ({ ...prev, clientId: event.target.value || undefined, page: 1 }))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
            <option value="">All clients</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
            <input type="checkbox" checked={Boolean(filters.mine)} onChange={(event) => setFilters((prev) => ({ ...prev, mine: event.target.checked, page: 1 }))} />
            Mine
          </label>
        </div>
      </div>

      {error && <div role="alert" className="mx-6 mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
      {success && <div role="status" className="mx-6 mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{success}</div>}

      <div className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {projects.length === 0 ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center text-gray-500">
              <BriefcaseIcon className="mb-3 h-10 w-10" />
              <p className="font-medium">No projects found.</p>
            </div>
          ) : (
            <div className="max-h-full overflow-y-auto">
              {projects.map((project) => (
                <button key={project.id} onClick={() => setSelectedProject(project)} className={`block w-full border-b border-gray-100 px-4 py-4 text-left transition last:border-b-0 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-gray-800 ${selectedProject?.id === project.id ? 'bg-blue-50 dark:bg-gray-800' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{project.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{project.client.companyName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[project.status]}`}>{project.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>{project.members.length} people</span>
                    <span>{project.taskCount} tasks</span>
                    <span>{formatDate(project.startDate)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-800">
            <button disabled={(filters.page ?? 1) <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))} className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700">Previous</button>
            <span>Page {filters.page ?? 1} of {totalPages}</span>
            <button disabled={(filters.page ?? 1) >= totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))} className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700">Next</button>
          </div>
        </div>

        <div className="overflow-y-auto rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          {selectedProject ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{selectedProject.name}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedProject.client.companyName}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[selectedProject.status]}`}>{selectedProject.status}</span>
              </div>
              <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2">
                <div><dt className="text-gray-500">Client</dt><dd>{selectedProject.client.companyName}</dd></div>
                <div><dt className="text-gray-500">Tasks</dt><dd>{selectedProject.taskCount}</dd></div>
                <div><dt className="text-gray-500">Start</dt><dd>{formatDate(selectedProject.startDate)}</dd></div>
                <div><dt className="text-gray-500">End</dt><dd>{formatDate(selectedProject.endDate)}</dd></div>
                <div className="md:col-span-2"><dt className="text-gray-500">Description</dt><dd className="whitespace-pre-wrap">{selectedProject.description || '-'}</dd></div>
              </dl>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <section>
                  <h3 className="text-sm font-semibold">Managers</h3>
                  <div className="mt-2 space-y-2">
                    {managers.length === 0 ? <p className="text-sm text-gray-500">No managers assigned.</p> : managers.map((member) => (
                      <div key={member.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
                        <p className="flex items-center gap-2 font-medium"><Avatar user={{ id: member.userId, name: member.name, role: member.userRole }} size={28} />{member.name}</p>
                        <p className="text-xs text-gray-500">{member.email}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold">Members</h3>
                  <div className="mt-2 space-y-2">
                    {members.length === 0 ? <p className="text-sm text-gray-500">No members assigned.</p> : members.map((member) => (
                      <div key={member.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
                        <p className="flex items-center gap-2 font-medium"><Avatar user={{ id: member.userId, name: member.name, role: member.userRole }} size={28} />{member.name}</p>
                        <p className="text-xs text-gray-500">{member.email}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">Task dashboard</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Progress is based on DONE subtasks and is separate from parent task status.</p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchTaskDashboard}
                    disabled={dashboardLoading}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-700"
                  >
                    {dashboardLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {dashboardError && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{dashboardError}</div>}

                {taskDashboard && (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <p className="text-xs text-gray-500">Project progress</p>
                        <p className="mt-1 text-2xl font-semibold">{taskDashboard.summary.progressPercent}%</p>
                        <p className="text-xs text-gray-500">{taskDashboard.summary.completedSubtasks}/{taskDashboard.summary.subtaskTotal} subtasks complete</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <p className="text-xs text-gray-500">Tasks</p>
                        <p className="mt-1 text-2xl font-semibold">{taskDashboard.summary.taskTotal}</p>
                        <p className="text-xs text-gray-500">{taskDashboard.total} match filters</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <p className="text-xs text-gray-500">Tracked time</p>
                        <p className="mt-1 text-2xl font-semibold">{formatDuration(taskDashboard.summary.totalTrackedSeconds)}</p>
                        <p className="text-xs text-gray-500">{taskDashboard.summary.activeTimerCount} active timer(s)</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <p className="text-xs text-gray-500">Workload</p>
                        <p className="mt-1 text-2xl font-semibold">{taskDashboard.summary.workload.length}</p>
                        <p className="text-xs text-gray-500">assigned project people</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-5">
                      <input
                        value={dashboardFilters.q}
                        onChange={(event) => setDashboardFilters((prev) => ({ ...prev, q: event.target.value, page: 1 }))}
                        placeholder="Search tasks"
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                      <select
                        value={dashboardFilters.status}
                        onChange={(event) => setDashboardFilters((prev) => ({ ...prev, status: event.target.value as TaskStatus | '', page: 1 }))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      >
                        <option value="">All task statuses</option>
                        {Object.values(TaskStatus).map((status) => <option key={status} value={status}>{taskStatusLabel(status)}</option>)}
                      </select>
                      <select
                        value={dashboardFilters.priority}
                        onChange={(event) => setDashboardFilters((prev) => ({ ...prev, priority: event.target.value as TaskPriority | '', page: 1 }))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      >
                        <option value="">All priorities</option>
                        {Object.values(TaskPriority).map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                      <select
                        value={dashboardFilters.memberId}
                        onChange={(event) => setDashboardFilters((prev) => ({ ...prev, memberId: event.target.value, page: 1 }))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      >
                        <option value="">All members</option>
                        {selectedProject.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
                      </select>
                      <select
                        value={dashboardFilters.pageSize}
                        onChange={(event) => setDashboardFilters((prev) => ({ ...prev, pageSize: Number(event.target.value), page: 1 }))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      >
                        {[5, 10, 20, 50].map((size) => <option key={size} value={size}>{size} per page</option>)}
                      </select>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <h4 className="text-sm font-semibold">Status mix</h4>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {Object.values(TaskStatus).filter((status) => (taskDashboard.summary.derivedStatusCounts[status] ?? 0) > 0).map((status) => (
                            <span key={status} className="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">
                              {taskStatusLabel(status)}: {taskDashboard.summary.derivedStatusCounts[status]}
                            </span>
                          ))}
                        </div>
                      </section>
                      <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <h4 className="text-sm font-semibold">Workload</h4>
                        <div className="mt-2 space-y-2">
                          {taskDashboard.summary.workload.slice(0, 4).map((item) => (
                            <div key={item.userId} className="flex items-center justify-between text-xs">
                              <span>{item.name}</span>
                              <span>{item.assignedTasks} tasks / {item.actionableSubtasks} actionable / {item.waitingSubtasks} waiting</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>

                    <div className="mt-4 space-y-3">
                      {dashboardLoading && taskDashboard.items.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-800">Loading project tasks...</div>
                      ) : taskDashboard.items.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">No project tasks match these filters.</div>
                      ) : taskDashboard.items.map((task) => (
                        <DashboardTaskRow
                          key={task.id}
                          task={task}
                          canManage={canManageSelected && selectedProject.status === ProjectStatus.ACTIVE}
                          busy={statusOverrideBusy}
                          onOverride={handleStatusOverride}
                        />
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <button
                        disabled={taskDashboard.page <= 1}
                        onClick={() => setDashboardFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                        className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700"
                      >
                        Previous
                      </button>
                      <span>Task page {taskDashboard.page} of {taskDashboard.totalPages}</span>
                      <button
                        disabled={taskDashboard.page >= taskDashboard.totalPages}
                        onClick={() => setDashboardFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
                        className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-700"
                      >
                        Next
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-gray-500">{taskDashboard.statusPolicy}</p>
                  </>
                )}
              </section>
              {canManageSelected && (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={() => openEdit(selectedProject)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold dark:border-gray-700">
                    <PencilSquareIcon className="h-4 w-4" />
                    Edit
                  </button>
                  {selectedProject.status !== ProjectStatus.ARCHIVED && (
                    <button disabled={actionLoading} onClick={() => handleArchive(selectedProject)} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-700 dark:text-amber-300">
                      <ArchiveBoxIcon className="h-4 w-4" />
                      Archive
                    </button>
                  )}
                  {selectedProject.status === ProjectStatus.ARCHIVED && (
                    <button disabled={actionLoading} onClick={() => { setRestoreError(null); setRestoreTarget(selectedProject); }} className="inline-flex items-center gap-2 rounded-lg border border-teal-500 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950">
                      <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />Restore Project
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center text-sm text-gray-500">Select a project to view details.</div>
          )}
        </div>
      </div>

      {restoreTarget && canManage && <RestoreConfirmation kind="Project" name={restoreTarget.name} busy={actionLoading}
        error={restoreError} onClose={() => setRestoreTarget(null)} onConfirm={() => void handleRestore()} />}
      {isFormOpen && (
        <ProjectFormModal
          key={`${user?.tenantId}:${user?.id}:${formProject?.id ?? 'new'}`}
          project={formProject}
          clients={clients}
          users={users}
          saving={actionLoading}
          error={formError}
          onClose={() => setFormOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};

export default Projects;
