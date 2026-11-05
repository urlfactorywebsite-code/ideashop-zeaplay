import { workTimezone } from '../utils/activeWork';
import { calendarToday, taskInstant } from '../utils/taskDates';
import { useTaskFilter, useTaskViewActive } from '../hooks/useTaskView';
import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import ReactDOM from 'react-dom';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, DialogDescription } from '@headlessui/react';
import { getKanbanStatusVisual, questCardSurface } from '../utils/kanbanAppearance';
import KanbanColumnFrame, { EmptyQuestColumn } from '../components/KanbanColumnFrame';
import { STATUS_CONFIGURATION_EVENT, configurationStorageKey, groupKanbanTasks } from '../utils/kanbanConfiguration';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task, User, KanbanColumn } from '../types';
import { TaskPriority } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskDetailModal from '../components/TaskDetailModal';
import PageLoader from '../components/loading/PageLoader';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { augmentTasksWithPoints, summarizeTaskPoints, formatPointsValue } from '../utils/taskPoints';
import { priorityPillStyle } from '../utils/themeTokens';
type ThemeMode = 'light' | 'dark' | 'colorful' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful';

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
  if (theme === 'colorful') return 'colorful';
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

const useResolvedTheme = (theme: ThemeMode): ResolvedTheme => {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));
  useEffect(() => {
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => setResolved(media.matches ? 'dark' : 'light');
      listener();
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    setResolved(resolveTheme(theme));
  }, [theme]);
  return resolved;
};

const priorityVisuals: Record<TaskPriority, { border: string; background: string; color: string }> = {
  [TaskPriority.LOW]: {
    border: 'rgba(45, 212, 191, 0.56)',
    background: 'rgba(20, 184, 166, 0.14)',
    color: '#0F766E',
  },
  [TaskPriority.MEDIUM]: {
    border: 'rgba(245, 158, 11, 0.58)',
    background: 'rgba(245, 158, 11, 0.14)',
    color: '#92400E',
  },
  [TaskPriority.HIGH]: {
    border: 'rgba(249, 115, 22, 0.58)',
    background: 'rgba(249, 115, 22, 0.14)',
    color: '#C2410C',
  },
  [TaskPriority.URGENT]: {
    border: 'rgba(244, 63, 94, 0.58)',
    background: 'rgba(244, 63, 94, 0.14)',
    color: '#BE123C',
  },
};

const getPriorityBadgeStyle = (priority: TaskPriority, mode: ResolvedTheme): React.CSSProperties => {
  if (mode !== 'light' && mode !== 'colorful') {
    return priorityPillStyle(priority);
  }
  const visual = priorityVisuals[priority] ?? priorityVisuals[TaskPriority.MEDIUM];
  return {
    borderColor: visual.border,
    background: visual.background,
    color: visual.color,
  };
};



const formatPriority = (value: TaskPriority) =>
  value
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const parseRangeToken = (value: string): { start: string; end: string } => {
  if (!value) {
    return { start: '', end: '' };
  }
  const [start, end] = value.split('..');
  if (!end) {
    return { start: value, end: value };
  }
  return { start, end };
};

const formatRangeLabel = (value: string): string => {
  if (!value) {
    return 'Date Range';
  }
  const { start, end } = parseRangeToken(value);
  if (!start) {
    return 'Date Range';
  }
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end || start}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Date Range';
  }
  const startLabel = startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return start === (end || start) ? startLabel : `${startLabel} - ${endLabel}`;
};

const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const KanbanTaskCard: React.FC<any> = ({ task, assignees, creator, onDragStart, onClick, onEdit, theme, timezone, columnColor, destinations, onMove, moving }) => {
  const formatDate = (value: string | null, includeTime = false) => value ? taskInstant(value).setZone(timezone).toLocaleString({ year: 'numeric', month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}) }) : 'N/A';
  const isLight = theme === 'light';
  const isBright = theme === 'light' || theme === 'colorful';
  const statusVisual = getKanbanStatusVisual(task.status);
  const cardSurface = questCardSurface(theme);
  const cardTextPrimaryClass = isBright ? 'text-slate-950' : 'text-white';
  const cardTextMutedClass = isBright ? 'text-slate-600' : 'text-slate-200/80';
  const buttonClass = isBright
    ? 'rounded-full border bg-white/76 px-3 py-1 text-sm font-semibold text-slate-800 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-white'
    : 'rounded-full border bg-white/5 px-3 py-1 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10';

  const assigneeNames = assignees.length > 0 ? assignees.map((a: any) => a.name).join(', ') : 'Unassigned';
  const pointsSummary = task.pointsBreakdown ? summarizeTaskPoints(task.pointsBreakdown) : null;
  const showReadMore = (task.description ?? '').trim().length > 100;
  const createdByName = creator?.name ?? 'Unknown';

  return (
    <div
      data-task-id={task.id}
      aria-busy={moving}
      draggable={task.canEdit === true && !moving}
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onClick(task.id)}
      className={`group relative overflow-hidden rounded-2xl border p-4 transition duration-200 hover:-translate-y-1 hover:shadow-xl ${cardSurface}`}
      style={{ borderColor: isBright ? statusVisual.lightBorder : statusVisual.darkBorder }}
    >
      <span
        className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: columnColor || statusVisual.accent }}
      />
      <div className="flex justify-between items-start">
        <p className={`min-h-[4.5rem] font-semibold text-sm line-clamp-3 ${cardTextPrimaryClass}`}>{task.title}</p>
        <span className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold" style={getPriorityBadgeStyle(task.priority, theme)}>
          {formatPriority(task.priority)}
        </span>
      </div>
      <p className={`min-h-[2.5rem] text-xs mt-2 leading-5 line-clamp-2 break-words overflow-hidden ${cardTextMutedClass}`}>{task.description}</p>
      {showReadMore && (
        <span className="mt-1 inline-block text-xs font-semibold text-primary/80">Read more..</span>
      )}
      <div className={`mt-3 grid gap-1 text-xs ${cardTextMutedClass}`}>
        <div>Created by: {createdByName}</div>
        <div>Created at: {formatDate(task.createdAt, true)}</div>
        <div>Assigned to: {assigneeNames}</div>
        <div>Due date: {formatDate(task.dueAt)}</div>
      </div>

      {pointsSummary && (
        <div className={`mt-2 text-[11px] ${cardTextMutedClass}`}>
          {pointsSummary.label}: {formatPointsValue(pointsSummary.value)}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={event => { event.stopPropagation(); onClick(task.id); }}
          className={`flex-1 ${buttonClass}`}
          style={{ borderColor: isBright ? 'rgba(79, 124, 255, 0.28)' : 'rgba(125, 211, 252, 0.26)' }}
        >
          View
        </button>
        {task.canEdit === true && (
          <button
            onClick={event => { event.stopPropagation(); onEdit(task.id); }}
            className={`flex-1 ${buttonClass}`}
            style={{ borderColor: isBright ? 'rgba(245, 158, 11, 0.34)' : 'rgba(245, 158, 11, 0.32)' }}
          >
            Edit
          </button>
        )}
      </div>
      {task.canEdit === true && <label className={`mt-3 block text-xs ${cardTextMutedClass}`} onClick={event => event.stopPropagation()}>
        Move quest
        <select aria-label={`Move ${task.title} to status`} value="" disabled={moving}
          onChange={event => { const destination = destinations.find((column: KanbanColumn) => column.statusId === event.target.value); if (destination) void onMove(task, destination); }}
          className={`mt-1 w-full min-w-0 rounded-lg border px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${isBright ? 'border-slate-300 bg-white text-slate-900' : 'border-white/20 bg-slate-950 text-slate-100'}`}>
          <option value="">{moving ? 'Moving quest...' : 'Choose destination'}</option>
          {destinations.filter((column: KanbanColumn) => column.id !== (task.customStatusId || task.status)).map((column: KanbanColumn) => <option key={column.statusId} value={column.statusId}>{column.title}</option>)}
        </select>
      </label>}
    </div>
  );
};

type FilterOption = {
  value: string;
  label: string;
};

const ChevronIcon: React.FC<{ open: boolean; className?: string }> = ({ open, className }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    className={`${className ?? ''} ${open ? 'rotate-180' : ''}`.trim()}
  >
    <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FilterDropdown: React.FC<{
  value: string;
  placeholder: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  buttonClassName: string;
  menuClassName: string;
  itemClassName: string;
  activeItemClassName: string;
}> = ({ value, placeholder, options, onChange, buttonClassName, menuClassName, itemClassName, activeItemClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!wrapperRef.current || wrapperRef.current.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) (wrapperRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      || wrapperRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="relative min-w-[190px]">
      <button
        ref={triggerRef}
        type="button"
        className={`${buttonClassName} flex w-full items-center justify-between gap-3 text-left`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-label={placeholder}
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
      >
        <span className={`min-w-0 [overflow-wrap:anywhere] ${value ? '' : 'opacity-80'}`}>{selectedLabel}</span>
        <ChevronIcon open={isOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
      </button>
      {isOpen && (
        <div className={`absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-b-[12px] border ${menuClassName}`}>
          <div id={listId} role="listbox" aria-label={placeholder} className="max-h-64 overflow-y-auto py-1 custom-scrollbar"
            onKeyDown={event => {
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
              } else if (event.key === 'Tab') setIsOpen(false);
            }}>
            {options.map((option) => {
              const isActive = option.value === value;
              return (
                <button
                  key={option.value || option.label}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`${itemClassName} ${isActive ? activeItemClassName : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const KanbanBoard: React.FC = () => {
  const queryClient = useQueryClient();
  const active = useTaskViewActive();
  const [moveError, setMoveError] = useState('');
  const [moveMessage, setMoveMessage] = useState('');
  const [filterMessage, setFilterMessage] = useState('');
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [pendingHold, setPendingHold] = useState<{task:Task;column:KanbanColumn;configurationRevision?:number}|null>(null);
  const [holdReason, setHoldReason] = useState('');
  const pendingMoves = useRef(new Set<string>());
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const zone = workTimezone(user?.timezone);
  const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
  const { theme } = useTheme();
  const resolvedTheme = useResolvedTheme(theme as ThemeMode);
  const isColorful = resolvedTheme === 'colorful';
  const isLight = resolvedTheme === 'light';
  const isBrightMode = isLight || isColorful;
  const boardTextClass = isBrightMode ? 'text-slate-950' : 'text-white';
  const boardMutedTextClass = isBrightMode ? 'text-slate-600' : 'text-slate-200/75';
  const boardTextColorHex = isBrightMode ? '#0F172A' : '#FFFFFF';
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dateRangeRef = useRef<HTMLDivElement | null>(null);
  const boardDragState = useRef<{ isDragging: boolean; startX: number; scrollLeft: number }>({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
  });

  // Filtering and sorting state
  const [statusFilter, setStatusFilter] = useTaskFilter<string>('status', '');
  const [priorityFilter, setPriorityFilter] = useTaskFilter<string>('priority', '');
  const [assigneeFilter, setAssigneeFilter] = useTaskFilter<string>('assigneeId', '');
  const [projectFilter] = useTaskFilter('projectId');
  const [teamFilter, setTeamFilter] = useTaskFilter<string>('team', '');
  const [dueDateFilter, setDueDateFilter] = useTaskFilter<string>('dueDate', '');
  const [isDateRangeOpen, setDateRangeOpen] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<'7d' | '30d' | 'mtd' | 'ytd' | 'custom' | ''>('');
  const [quickFilter, setQuickFilter] = useTaskFilter<string>('quickFilter', '');
  const [pageSize, setPageSize] = useState<number>(20);
  const paginationScope = JSON.stringify([debouncedSearchQuery, statusFilter, priorityFilter, assigneeFilter, projectFilter, teamFilter, dueDateFilter, quickFilter, pageSize]);
  const [pagination, setPagination] = useState({ scope: paginationScope, index: 0 });
  const pageIndex = pagination.scope === paginationScope ? pagination.index : 0;
  const setPageIndex = (value: React.SetStateAction<number>) => setPagination(previous => ({
    scope: paginationScope,
    index: typeof value === 'function' ? value(previous.scope === paginationScope ? previous.index : 0) : value,
  }));

  const dateRangeLabel = useMemo(() => formatRangeLabel(dueDateFilter), [dueDateFilter]);
  const dateRangeTokens = useMemo(() => parseRangeToken(dueDateFilter), [dueDateFilter]);

  const applyDatePreset = useCallback((preset: '7d' | '30d' | 'mtd' | 'ytd') => {
    const now = calendarToday(zone);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    if (preset === '7d') {
      start.setDate(today.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(today.getDate() - 29);
    } else if (preset === 'mtd') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      start = new Date(today.getFullYear(), 0, 1);
    }
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(today);
    setDueDateFilter(`${startIso}..${endIso}`);
    setActiveDatePreset(preset);
  }, [zone]);

  const updateDateRange = useCallback((start: string, end: string) => {
    if (!start && !end) {
      setDueDateFilter('');
      setActiveDatePreset('');
      return;
    }

    const normalizedStart = start || end;
    const normalizedEnd = end || start;
    setDueDateFilter(
      normalizedStart === normalizedEnd ? normalizedStart : `${normalizedStart}..${normalizedEnd}`,
    );
    setActiveDatePreset('custom');
  }, []);

  const kanbanQueryParams = useMemo(() => ({
    page: pageIndex + 1,
    timezone: zone,
    pageSize,
    search: debouncedSearchQuery || undefined,
    priority: priorityFilter ? (priorityFilter as TaskPriority) : undefined,
    assigneeId: assigneeFilter || undefined,
    projectId: projectFilter || undefined,
    team: teamFilter || undefined,
    dueDate: dueDateFilter || undefined,
    quickFilter: quickFilter || undefined,
  }), [assigneeFilter, projectFilter, debouncedSearchQuery, dueDateFilter, zone, pageIndex, pageSize, priorityFilter, quickFilter, teamFilter]);

  const kanbanQuery = useQuery({
    queryKey: ['tasks', 'kanban-board', user?.tenantId, user?.id, user?.role, kanbanQueryParams],
    queryFn: ({ signal }) => api.getTasksKanban({ ...kanbanQueryParams, signal }),
    enabled: Boolean(user) && active,
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    placeholderData: keepPreviousData,
  });

  const usersQuery = useQuery({
    queryKey: ['users', 'task-views', user?.tenantId, user?.id, user?.role],
    queryFn: () => api.getUsers(),
    enabled: Boolean(user) && active,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'task-views', user?.tenantId, user?.id, user?.role],
    queryFn: () => api.getDepartments(),
    enabled: Boolean(user) && active,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const fetchData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'kanban-board'] });
  }, [queryClient]);

  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.tenantId === user?.tenantId) fetchData();
    };
    const stored = (event: StorageEvent) => {
      if (user?.tenantId && event.key === configurationStorageKey(user.tenantId)) fetchData();
    };
    window.addEventListener(STATUS_CONFIGURATION_EVENT, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(STATUS_CONFIGURATION_EVENT, changed); window.removeEventListener('storage', stored); };
  }, [fetchData, user?.tenantId]);

  const tasks = useMemo(() => augmentTasksWithPoints(
    [...(kanbanQuery.data?.columns || []), ...(kanbanQuery.data?.outsideColumns || [])].flatMap(column => column.items)), [kanbanQuery.data]);
  const columns: KanbanColumn[] = useMemo(() => (kanbanQuery.data?.columns || []).map((column) => ({
      id: column.status,
      title: column.title,
      statusId: column.statusId,
      workflowBehavior:column.workflowBehavior,
      holdReasonRequired:column.holdReasonRequired,
      count: column.count,
      order: column.order,
      pipelineId: 'default',
      color: column.color,
      icon: column.icon,
    })), [kanbanQuery.data]);

  useEffect(() => {
    if (!statusFilter || !kanbanQuery.data || kanbanQuery.isPlaceholderData) return;
    if (![...kanbanQuery.data.columns, ...(kanbanQuery.data.outsideColumns || [])].some(column => column.status === statusFilter)) {
      setStatusFilter('');
      setFilterMessage('The selected status is no longer available. Showing all statuses; reassigned quests may be on another page.');
    }
  }, [statusFilter, kanbanQuery.data, kanbanQuery.isPlaceholderData, setStatusFilter]);

  useEffect(() => {
    if (!usersQuery.data) return;
    const map = new Map<string, User>();
    usersQuery.data.forEach((entry: User) => map.set(entry.id, entry));
    setUsersMap(map);
  }, [usersQuery.data]);

  useEffect(() => {
    if (!departmentsQuery.data) return;
    const departmentNames = Array.from(
      new Set(
        (departmentsQuery.data ?? [])
          .map((dept) => dept.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    setDepartmentOptions(departmentNames);
  }, [departmentsQuery.data]);

  useEffect(() => {
    setLoading(Boolean(user) && (kanbanQuery.isLoading || usersQuery.isLoading || departmentsQuery.isLoading));
  }, [departmentsQuery.isLoading, kanbanQuery.isLoading, user, usersQuery.isLoading]);

  useEffect(() => {
    const error = kanbanQuery.error || usersQuery.error || departmentsQuery.error;
    if (error) {
      console.error('Failed to fetch Kanban data:', error);
    }
  }, [departmentsQuery.error, kanbanQuery.error, usersQuery.error]);

  useEffect(() => {
    if (!isDateRangeOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!dateRangeRef.current || dateRangeRef.current.contains(event.target as Node)) {
        return;
      }
      setDateRangeOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDateRangeOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isDateRangeOpen]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent<HTMLElement>, column: KanbanColumn) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find((t) => t.id === taskId);
    if (task) await moveTask(task, column);
  };

  const moveTask = async (task: Task, column: KanbanColumn, reason?: string, configurationRevision=kanbanQuery.data?.configurationRevision) => {
    const taskId = task.id;
    if (pendingMoves.current.has(taskId) || task.canEdit !== true || (task.customStatusId || task.status) === column.id || !user) return;

    if (!column.statusId) { setMoveError('Status configuration is unavailable. Refresh the board.'); return; }
    if (column.workflowBehavior==='HOLD' && task.status!=='ON_HOLD' && reason===undefined) {
      setHoldReason(''); setMoveError(''); setPendingHold({task,column,configurationRevision}); return;
    }
    pendingMoves.current.add(taskId); setMovingIds(new Set(pendingMoves.current)); setMoveError(''); setMoveMessage('');
    try {
      await api.moveTaskToKanbanStatus(taskId, column.statusId, reason, configurationRevision);
      setMoveMessage(`Moved ${task.title} to ${column.title}. Current filters and pagination still apply.`);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      return true;
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Unable to move quest. Please try again.');
      fetchData();
      return false;
    } finally { pendingMoves.current.delete(taskId); setMovingIds(new Set(pendingMoves.current)); }
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => e.preventDefault();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const handleTaskClick = (id: string) => setSelectedTaskId(id);
  const handleTaskEdit = (id: string) => setSelectedTaskId(id);

  const scrollBoard = (direction: 'left' | 'right') => {
    if (!boardRef.current) return;
    const distance = direction === 'left' ? -320 : 320;
    boardRef.current.scrollBy({ left: distance, behavior: 'smooth' });
  };

  const stopBoardDrag = () => {
    boardDragState.current.isDragging = false;
    if (boardRef.current) {
      boardRef.current.classList.remove('cursor-grabbing', 'select-none');
    }
  };

  const handleBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardRef.current) return;
    // Cards use native drag/drop; board panning must not consume that gesture.
    if ((event.target as HTMLElement).closest('[draggable="true"], button, input, select, textarea, a')) return;
    boardDragState.current.isDragging = true;
    boardDragState.current.startX = event.pageX - boardRef.current.offsetLeft;
    boardDragState.current.scrollLeft = boardRef.current.scrollLeft;
    boardRef.current.classList.add('cursor-grabbing', 'select-none');
  };

  const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardDragState.current.isDragging || !boardRef.current) return;
    event.preventDefault();
    const x = event.pageX - boardRef.current.offsetLeft;
    const walk = x - boardDragState.current.startX;
    boardRef.current.scrollLeft = boardDragState.current.scrollLeft - walk;
  };

  const handleBoardMouseUp = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  const handleBoardMouseLeave = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (!boardDragState.current.isDragging) return;
      boardDragState.current.isDragging = false;
      if (boardRef.current) {
        boardRef.current.classList.remove('cursor-grabbing', 'select-none');
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, []);
  const handleCloseModal = () => {
    setSelectedTaskId(null);
    fetchData();
  };

  // The server already applies shared filters before pagination. Reapplying
  // approximate client date/search filters would hide valid rows on each page.
  const filteredTasks = useMemo(() => statusFilter ? tasks.filter(task => (task.customStatusId || task.status) === statusFilter) : tasks, [tasks, statusFilter]);
  const groupedTasks = useMemo(() => groupKanbanTasks(filteredTasks), [filteredTasks]);

  const maxTasksInColumn = useMemo(() => Math.max(0, ...[...(kanbanQuery.data?.columns || []), ...(kanbanQuery.data?.outsideColumns || [])]
    .filter(column => !statusFilter || column.status === statusFilter).map(column => column.count), kanbanQuery.data?.unmappedCount || 0), [kanbanQuery.data, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(maxTasksInColumn / pageSize));
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [pageIndex, totalPages]);

  const quickFilterButtonBase = [
    'group relative isolate inline-flex items-center justify-center overflow-hidden rounded-[10px] border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em]',
    'transition duration-200 ease-out active:translate-y-[1px]',
    'focus-visible:outline-none focus-visible:ring-2',
  ].join(' ');
  const quickFilterButtonTheme = isLight
    ? {
        active:
          'border-indigo-300/90 text-white bg-gradient-to-b from-sky-400 via-indigo-500 to-violet-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_24px_rgba(79,70,229,0.28),0_0_22px_rgba(56,189,248,0.32)] ring-1 ring-white/55 focus-visible:ring-sky-300/70',
        inactive:
          'border-indigo-200/80 text-slate-700 bg-gradient-to-b from-white via-[#F7FAFF] to-[#EEF6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(79,124,255,0.12)] hover:border-sky-400/70 hover:text-slate-950 hover:shadow-[0_12px_24px_rgba(79,124,255,0.18)] focus-visible:ring-sky-300/60',
        overlay:
          'bg-[linear-gradient(135deg,rgba(255,255,255,0.5),transparent_48%,rgba(125,211,252,0.22))]',
        edgeTop: 'bg-white/80',
        edgeBottom: 'bg-sky-200/70',
      }
    : isColorful
      ? {
          active:
            'border-fuchsia-300/90 text-white bg-gradient-to-b from-fuchsia-400 via-violet-500 to-sky-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.52),0_12px_24px_rgba(217,70,239,0.24),0_0_22px_rgba(56,189,248,0.26)] ring-1 ring-white/55 focus-visible:ring-fuchsia-300/60',
          inactive:
            'border-fuchsia-200/80 text-slate-700 bg-gradient-to-b from-white via-[#fff7fb] to-[#eef6ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(217,70,239,0.1)] hover:border-fuchsia-300/80 hover:text-slate-950 focus-visible:ring-fuchsia-300/60',
          overlay:
            'bg-[linear-gradient(135deg,rgba(255,255,255,0.55),transparent_48%,rgba(244,114,182,0.18))]',
          edgeTop: 'bg-white/80',
          edgeBottom: 'bg-fuchsia-200/70',
        }
      : {
          active:
            'border-cyan-200/90 text-white bg-gradient-to-b from-cyan-300/85 via-sky-500/80 to-blue-800/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_0_18px_rgba(34,211,238,0.6)] ring-1 ring-cyan-200/60 focus-visible:ring-cyan-300/70',
          inactive:
            'border-sky-400/50 text-sky-100 bg-gradient-to-b from-sky-500/40 via-blue-700/45 to-slate-900/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)] hover:from-sky-400/50 hover:via-blue-600/55 hover:to-slate-900/90 hover:text-white focus-visible:ring-cyan-300/70',
          overlay:
            'bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_45%,rgba(0,0,0,0.35))]',
          edgeTop: 'bg-white/40',
          edgeBottom: 'bg-black/50',
        };
  const getQuickFilterButtonClass = (isActive: boolean) =>
    [quickFilterButtonBase, isActive ? quickFilterButtonTheme.active : quickFilterButtonTheme.inactive].join(' ');
  const filterControlBase = [
    'kanban-filter-control rounded-[10px] border px-4 py-2 text-sm transition',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.4)]',
    'focus:outline-none focus:ring-2',
  ].join(' ');
  const filterControlTheme = isLight
    ? [
        'border-indigo-200/85 text-slate-800',
        'bg-white/95',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(79,124,255,0.12)]',
        'focus:border-[#4F7CFF]/80 focus:ring-[#4F7CFF]/30',
      ].join(' ')
    : isColorful
      ? [
          'border-fuchsia-200/85 text-slate-800',
          'bg-white/94',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(217,70,239,0.1)]',
          'focus:border-fuchsia-200/80 focus:ring-fuchsia-300/60',
        ].join(' ')
      : [
          'border-slate-500/40 text-slate-100',
          'bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black/95',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)]',
          'focus:border-cyan-200/80 focus:ring-cyan-300/60',
        ].join(' ');
  const filterSelectClass = [
    filterControlBase,
    filterControlTheme,
    'kanban-filter-select font-semibold uppercase tracking-[0.22em]',
  ].join(' ');
  const filterPlaceholderClass = isLight
    ? 'placeholder:text-slate-500'
    : isColorful
      ? 'placeholder:text-slate-500'
      : 'placeholder:text-sky-100';
  const filterInputClass = [
    filterControlBase,
    filterControlTheme,
    'kanban-filter-input',
    'font-semibold uppercase tracking-[0.22em]',
    filterPlaceholderClass,
  ].join(' ');
  const dropdownMenuClass = isLight
    ? 'border-indigo-100 bg-white/95 text-slate-800 shadow-[0_20px_45px_rgba(79,124,255,0.18)]'
    : isColorful
      ? 'border-fuchsia-100 bg-white/95 text-slate-800 shadow-[0_20px_45px_rgba(217,70,239,0.16)]'
      : 'border-slate-500/40 bg-[#081229]/95 text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.7)]';
  const dropdownItemClass = [
    'w-full px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] transition',
    isLight ? 'text-slate-700 hover:bg-sky-50 hover:text-slate-950' : isColorful ? 'text-slate-700 hover:bg-fuchsia-50 hover:text-slate-950' : 'text-slate-100 hover:bg-white/10',
  ].join(' ');
  const dropdownItemActiveClass = isLight
    ? 'bg-gradient-to-r from-sky-100 to-indigo-100 text-slate-950'
    : isColorful
      ? 'bg-gradient-to-r from-fuchsia-100 to-sky-100 text-slate-950'
      : 'bg-sky-500/30 text-white';
  const dropdownButtonClass = filterSelectClass;
  const filterColorScheme = isLight ? 'light' : 'dark';
  const pageShellClass = isLight
    ? 'kanban-board-light-theme kanban-theme-text flex flex-col space-y-6 text-slate-950'
    : isColorful
      ? 'kanban-board-colorful-theme kanban-theme-text flex flex-col space-y-6 text-slate-950'
    : 'kanban-board-dark-theme kanban-theme-text flex flex-col space-y-6 text-white';
  const controlsPanelClass = isLight
    ? 'rounded-2xl border border-indigo-200/70 bg-white/86 p-3 shadow-[0_18px_42px_rgba(79,124,255,0.14)] backdrop-blur-xl'
    : isColorful
      ? 'rounded-2xl border border-fuchsia-200/70 bg-white/84 p-3 shadow-[0_18px_42px_rgba(217,70,239,0.12)] backdrop-blur-xl'
    : 'rounded-2xl border border-cyan-400/20 bg-slate-950/62 p-3 shadow-[0_22px_48px_rgba(2,6,23,0.58)] backdrop-blur-xl';
  const scrollButtonClass = isLight
    ? 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-indigo-200/80 bg-white/86 text-indigo-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_18px_rgba(79,124,255,0.14)] transition duration-200 hover:border-indigo-300 hover:text-indigo-900 hover:shadow-[0_0_18px_rgba(79,124,255,0.22)]'
    : isColorful
      ? 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-fuchsia-200/80 bg-white/86 text-fuchsia-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_18px_rgba(217,70,239,0.12)] transition duration-200 hover:border-fuchsia-300 hover:text-fuchsia-900 hover:shadow-[0_0_18px_rgba(217,70,239,0.18)]'
    : 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-cyan-300/35 bg-slate-950/76 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_18px_rgba(2,6,23,0.55)] transition duration-200 hover:border-cyan-200/70 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.34)]';
  const paginationPanelClass = isLight
    ? 'rounded-3xl border border-indigo-200/70 bg-white/86 p-5 shadow-[0_16px_38px_rgba(79,124,255,0.12)] backdrop-blur-xl'
    : isColorful
      ? 'rounded-3xl border border-fuchsia-200/70 bg-white/86 p-5 shadow-[0_16px_38px_rgba(217,70,239,0.12)] backdrop-blur-xl'
    : 'rounded-3xl border border-cyan-400/16 bg-slate-950/60 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.5)] backdrop-blur-xl';
  const paginationButtonClass = (active: boolean) =>
    active
      ? isBrightMode
        ? 'border-indigo-200/85 bg-white/86 text-slate-800 shadow-[0_8px_18px_rgba(79,124,255,0.12)] hover:border-indigo-300 hover:bg-indigo-50'
        : 'border-cyan-300/26 bg-white/6 text-white shadow-[0_8px_18px_rgba(2,6,23,0.28)] hover:border-cyan-300/54 hover:bg-white/10'
      : isBrightMode
        ? 'border-slate-200 bg-slate-100/80 text-slate-400 cursor-not-allowed'
        : 'border-white/10 bg-white/5 text-white/45 cursor-not-allowed';
  const pageSizeButtonClass = (active: boolean) =>
    active
      ? isBrightMode
        ? 'border-indigo-300/80 bg-indigo-50 text-indigo-700 shadow-[0_8px_18px_rgba(79,124,255,0.12)]'
        : 'border-cyan-300/60 bg-cyan-500/10 text-cyan-100 shadow-[0_8px_18px_rgba(34,211,238,0.1)]'
      : isBrightMode
        ? 'border-indigo-200/80 bg-white/86 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
        : 'border-white/16 bg-white/5 text-white/80 hover:border-cyan-300/42 hover:bg-white/10';
  const statusOptions = useMemo(
    () => [{ value: '', label: 'All Statuses' }, ...columns.map(column => ({ value: column.id, label: column.title })),
      ...(kanbanQuery.data?.outsideColumns || []).map(column => ({ value: column.status, label: `${column.title} (${column.outsideReason})` }))],
    [columns, kanbanQuery.data?.outsideColumns],
  );
  const priorityOptions = useMemo(
    () => [
      { value: '', label: 'All Priorities' },
      ...Object.values(TaskPriority).map((priority) => ({
        value: priority,
        label: priority,
      })),
    ],
    [],
  );
  const assigneeOptions = useMemo(() => {
    const list = (Array.from(usersMap.values()) as User[])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ value: entry.id, label: entry.name }));
    return [{ value: '', label: 'All Assignees' }, ...list];
  }, [usersMap]);
  const teamOptions = useMemo(
    () => [{ value: '', label: 'All Teams' }, ...departmentOptions.map((department) => ({ value: department, label: department }))],
    [departmentOptions],
  );

  if (loading) return <PageLoader />;

  return (
    <div className={pageShellClass} style={{ color: boardTextColorHex }}>
      {(kanbanQuery.isError || usersQuery.isError || departmentsQuery.isError) && <div role="alert" className="rounded-xl border border-red-400/50 p-4">Unable to load the latest Battle Board data. <button className="rounded underline focus-visible:ring-2" onClick={() => { void kanbanQuery.refetch(); void usersQuery.refetch(); void departmentsQuery.refetch(); }}>Retry</button></div>}
      {moveError && <p role="alert" className="rounded-xl border border-red-400/50 p-4">{moveError}</p>}
      {moveMessage && <p role="status" className="text-sm">{moveMessage}</p>}
      {filterMessage && <p role="status" className="text-sm">{filterMessage}</p>}
      {kanbanQuery.isFetching && !loading && <p role="status" className="text-xs">Refreshing Battle Board...</p>}
      {kanbanQuery.data && !filteredTasks.length && !kanbanQuery.data.unmappedCount && <p role="status" className="text-sm">No quests on this page match the current filters.</p>}
      <div className="flex flex-col gap-2">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.34em] ${isBrightMode ? 'text-fuchsia-600' : 'text-cyan-200/80'}`}>
          Mission Control
        </p>
        <h2 className={`text-3xl font-bold ${boardTextClass}`}>
          Battle Board <span className={isBrightMode ? 'text-fuchsia-500' : 'text-cyan-200'}>⚔️</span>
        </h2>
      </div>

      <div className={`${controlsPanelClass} relative !z-30 space-y-3`}>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          className={`${filterInputClass} min-w-[220px] sm:min-w-[320px]`}
          placeholder="Search Tasks"
        />
        <FilterDropdown
          value={statusFilter}
          placeholder="All Statuses"
          options={statusOptions}
          onChange={value => { setFilterMessage(''); setStatusFilter(value); }}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={priorityFilter}
          placeholder="All Priorities"
          options={priorityOptions}
          onChange={setPriorityFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={assigneeFilter}
          placeholder="All Assignees"
          options={assigneeOptions}
          onChange={setAssigneeFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={teamFilter}
          placeholder="All Teams"
          options={teamOptions}
          onChange={setTeamFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <div ref={dateRangeRef} className="relative min-w-[190px]">
          <button
            type="button"
            onClick={() => setDateRangeOpen((prev) => !prev)}
            className={`${dropdownButtonClass} flex w-full items-center justify-between gap-3 text-left`}
            aria-haspopup="dialog"
            aria-expanded={isDateRangeOpen}
          >
            <span className={dueDateFilter ? '' : 'opacity-80'}>{dateRangeLabel}</span>
            <ChevronIcon open={isDateRangeOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
          </button>
          {isDateRangeOpen && (
            <div className={`absolute left-0 top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border p-3 ${dropdownMenuClass}`}>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {([
                  { key: '7d', label: '7D' },
                  { key: '30d', label: '30D' },
                  { key: 'mtd', label: 'MTD' },
                  { key: 'ytd', label: 'YTD' },
                ] as const).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyDatePreset(option.key)}
                    className={[
                      'rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition',
                      activeDatePreset === option.key
                        ? isBrightMode
                          ? 'border-indigo-300/80 bg-indigo-100 text-indigo-700'
                          : 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                        : isBrightMode
                          ? 'border-indigo-100 bg-white text-slate-600 hover:border-indigo-300 hover:text-slate-950'
                          : 'border-white/20 bg-black/20 text-white/80 hover:border-cyan-300/70 hover:text-white',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className={isBrightMode ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>From</label>
                <input
                  type="date"
                  value={dateRangeTokens.start}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(event.target.value, dateRangeTokens.end)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
                <label className={isBrightMode ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>To</label>
                <input
                  type="date"
                  value={dateRangeTokens.end}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(dateRangeTokens.start, event.target.value)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className={isBrightMode ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 hover:text-indigo-800' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80 hover:text-cyan-100'}
                  onClick={() => {
                    setDueDateFilter('');
                    setActiveDatePreset('');
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className={isBrightMode ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 hover:text-slate-950' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 hover:text-white'}
                  onClick={() => setDateRangeOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setQuickFilter(quickFilter === 'myTasks' ? '' : 'myTasks')}
            className={getQuickFilterButtonClass(quickFilter === 'myTasks')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">My Tasks</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'createdByMe' ? '' : 'createdByMe')}
            className={getQuickFilterButtonClass(quickFilter === 'createdByMe')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Task Created By Me</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'overdue' ? '' : 'overdue')}
            className={getQuickFilterButtonClass(quickFilter === 'overdue')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Overdue</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'completed' ? '' : 'completed')}
            className={getQuickFilterButtonClass(quickFilter === 'completed')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Completed</span>
          </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={getQuickFilterButtonClass(true)}
            title="Kanban View"
            aria-current="true"
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Kanban</span>
          </button>

        <button
          type="button"
          onClick={() => scrollBoard('left')}
          className={scrollButtonClass}
          aria-label="Scroll board left"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x2039)}</span>
        </button>
        <button
          type="button"
          onClick={() => scrollBoard('right')}
          className={scrollButtonClass}
          aria-label="Scroll board right"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x203A)}</span>
        </button>
        </div>
      </div>
      </div>

      <div
        ref={boardRef}
        role="region"
        aria-label="Battle Board columns"
        tabIndex={0}
        className="kanban-board-scroll flex gap-6 overflow-x-auto overflow-y-visible rounded-3xl border p-4 pb-6 cursor-grab active:cursor-grabbing"
        style={{
          borderColor: isBrightMode ? 'rgba(217, 70, 239, 0.24)' : 'rgba(34, 211, 238, 0.14)',
          background: isBrightMode ? 'rgba(255, 255, 255, 0.38)' : 'rgba(2, 6, 23, 0.22)',
          boxShadow: isBrightMode ? '0 18px 46px rgba(217, 70, 239, 0.1)' : '0 20px 52px rgba(2, 6, 23, 0.38)',
        }}
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseLeave={handleBoardMouseLeave}
        onMouseUp={handleBoardMouseUp}
      >
        {columns.filter(column => !statusFilter || column.id === statusFilter).map(column => {
          const visibleTasks = groupedTasks.get(column.id) || [];
          return <KanbanColumnFrame key={column.id} data-task-status={column.id} data-status-id={column.statusId}
            statusKey={column.id} label={column.title} color={column.color} icon={column.icon} theme={resolvedTheme}
            count={column.count || 0} onDrop={event => void handleDrop(event, column)} onDragOver={handleDragOver}>
            {visibleTasks.map(task => <KanbanTaskCard key={task.id} task={task}
              assignees={(task.assignedTo || []).map(id => usersMap.get(id)).filter(Boolean) as User[]}
              creator={usersMap.get(task.createdBy)} onDragStart={handleDragStart} onClick={handleTaskClick}
              onEdit={handleTaskEdit} theme={resolvedTheme} timezone={zone} columnColor={column.color}
              destinations={columns} onMove={moveTask} moving={movingIds.has(task.id)} />)}
            {!visibleTasks.length && <EmptyQuestColumn theme={resolvedTheme} hasTasks={!!column.count} />}
          </KanbanColumnFrame>;
        })}
      </div>
      {!!kanbanQuery.data?.outsideColumns?.length && <details className="rounded-2xl border border-amber-400/30 p-4" open>
        <summary className="cursor-pointer rounded font-semibold focus-visible:ring-2 focus-visible:ring-cyan-300">Quests in hidden or archived statuses</summary>
        <p className="my-3 text-sm">These quests are retained. Drag an editable quest into a visible column to move it.</p>
        {kanbanQuery.data.outsideColumns.filter(column => !statusFilter || column.status === statusFilter).map(column => <section key={column.status} aria-label={`${column.title} retained quests`} className="mt-4">
          <h3 className="mb-3 font-semibold">{column.title} ({column.count}) / {column.outsideReason}</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(groupedTasks.get(column.status) || []).map(task => <KanbanTaskCard key={task.id} task={task}
            assignees={(task.assignedTo || []).map(id => usersMap.get(id)).filter(Boolean) as User[]}
            creator={usersMap.get(task.createdBy)} onDragStart={handleDragStart} onClick={handleTaskClick}
            onEdit={handleTaskEdit} theme={resolvedTheme} timezone={zone} columnColor={column.color}
            destinations={columns} onMove={moveTask} moving={movingIds.has(task.id)} />)}</div>
          {!column.items.length && <p className="text-sm">No quests on this page. Use the page controls to see retained quests.</p>}
        </section>)}
      </details>}
      {!!kanbanQuery.data?.unmappedCount && <section role="region" aria-label="Unmapped legacy quests" className="rounded-2xl border border-amber-400/40 p-4">
        <h3 className="font-semibold">{kanbanQuery.data.unmappedCount} quests need status mapping</h3>
        <p className="my-2 text-sm">Ask a workspace administrator to review these legacy status references. The records remain preserved.</p>
        <ul className="space-y-2">{kanbanQuery.data.unmappedItems?.map(task => <li key={task.id} className="break-words text-sm">{task.title} / {task.id} / {task.raw_status}{task.custom_status_id ? ` / ${task.custom_status_id}` : ''}</li>)}</ul>
      </section>}

      <div className={paginationPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
              disabled={!canGoPrev}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${paginationButtonClass(canGoPrev)}`}
            >
              Prev page
            </button>
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={!canGoNext}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${paginationButtonClass(canGoNext)}`}
            >
              Next page
            </button>
            <span className={`text-xs ${boardMutedTextClass}`}>Page {pageIndex + 1} of {totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPageSize(20);
                setPageIndex(0);
              }}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${pageSizeButtonClass(pageSize === 20)}`}
            >
              20 per page
            </button>
            <button
              type="button"
              onClick={() => {
                setPageSize(100);
                setPageIndex(0);
              }}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${pageSizeButtonClass(pageSize === 100)}`}
            >
              100 per page
            </button>
          </div>
        </div>
      </div>

      <Dialog open={!!pendingHold} onClose={() => { if (!pendingHold || !movingIds.has(pendingHold.task.id)) setPendingHold(null); }} className="relative z-[110]">
        <DialogBackdrop className="fixed inset-0 bg-black/70" />
        <div className="fixed inset-0 flex items-center justify-center p-4"><DialogPanel className="w-full max-w-lg space-y-4 rounded-2xl border border-cyan-400/30 bg-slate-950 p-6 text-slate-100">
          <DialogTitle className="text-lg font-bold">Place quest On Hold</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{pendingHold?.task.title} will move to {pendingHold?.column.title}. Eligible overdue aging pauses; the original deadline and earlier penalties are preserved.</DialogDescription>
          <label className="block text-sm">Hold reason {pendingHold?.column.holdReasonRequired ? '(required)' : '(optional)'}
            <textarea aria-label="Hold reason" maxLength={500} required={pendingHold?.column.holdReasonRequired} value={holdReason} onChange={event => setHoldReason(event.target.value)}
              className="mt-2 w-full rounded-lg border border-cyan-400/30 bg-slate-900 p-3 focus-visible:ring-2 focus-visible:ring-cyan-300" /></label>
          {moveError && <p role="alert" className="text-sm text-red-300">{moveError}</p>}
          <div className="flex justify-end gap-3"><button className="rounded-lg border border-white/20 px-4 py-2 focus-visible:ring-2" onClick={() => setPendingHold(null)} disabled={!!pendingHold && movingIds.has(pendingHold.task.id)}>Cancel</button>
            <button className="rounded-lg border border-cyan-300/50 bg-cyan-500/20 px-4 py-2 focus-visible:ring-2 disabled:opacity-40"
              disabled={!pendingHold || movingIds.has(pendingHold.task.id) || (!!pendingHold.column.holdReasonRequired && !holdReason.trim())}
              onClick={async () => { if (pendingHold && await moveTask(pendingHold.task,pendingHold.column,holdReason,pendingHold.configurationRevision)) setPendingHold(null); }}>Confirm hold</button></div>
        </DialogPanel></div>
      </Dialog>
      {selectedTaskId &&
        typeof window !== 'undefined' &&
        ReactDOM.createPortal(
          <TaskDetailModal
            taskId={selectedTaskId}
            isOpen={!!selectedTaskId}
            onClose={handleCloseModal}
            usersMap={usersMap}
            onTaskDeleted={() => setSelectedTaskId(null)}
          />,
          document.body
        )}
    </div>
  );
};

export default KanbanBoard;


