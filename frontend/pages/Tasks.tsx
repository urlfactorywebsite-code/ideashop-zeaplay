import { workTimezone } from '../utils/activeWork';
import { calendarToday, taskInstant } from '../utils/taskDates';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Task, User, TaskStatus, TaskPriority, CUSTOM_STATUS_NAMES, Role, Project, ProjectStatus } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import { useTaskList } from '../hooks/useTaskList';
import { useTaskPrefetch } from '../hooks/useTaskPrefetch';
import { TASK_REALTIME_EVENT } from '../services/taskRealtimeEvents';
import { invalidateTaskCaches } from '../hooks/useTaskCache';
import api from '../services/mockApi';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { timeAgo } from '../utils';
import { augmentTasksWithPoints, summarizeTaskPoints, formatPointsValue, TaskPointsTone } from '../utils/taskPoints';
import { stageCardStyle } from '../utils/themeTokens';
import { PlusIcon, TagIcon } from '../components/icons';
import TaskStatusBadge from '../components/ui/TaskStatusBadge';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import CreateTaskModal from '../components/CreateTaskModal';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskTemplateModal from '../components/TaskTemplateModal';

import { useTaskFilter, useTaskViewActive } from '../hooks/useTaskView';

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

const completedStatuses = new Set<TaskStatus>([
    TaskStatus.DONE,
    TaskStatus.DEPLOYED,
]);

const activeStatuses = new Set<TaskStatus>([
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BUG_FIXING,
    TaskStatus.IN_REVIEW,
]);

const STATUS_ORDER: TaskStatus[] = [
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BUG_FIXING,
    TaskStatus.BLOCKED,
    TaskStatus.IN_REVIEW,
    TaskStatus.ON_HOLD,
    TaskStatus.DONE,
    TaskStatus.DEPLOYED,
    TaskStatus.FAILED,
    TaskStatus.GRAVEYARD,
];

type LightTaskStatusStyle = {
    background: string;
    borderColor: string;
    accent: string;
    shadow: string;
};

const LIGHT_TASK_STATUS_STYLES: Record<TaskStatus, LightTaskStatusStyle> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        background: 'linear-gradient(135deg, #F7FAFF 0%, #EEF6FF 100%)',
        borderColor: 'rgba(79, 124, 255, 0.28)',
        accent: '#60A5FA',
        shadow: '0 14px 34px rgba(79, 124, 255, 0.12)',
    },
    [TaskStatus.TODO]: {
        background: 'linear-gradient(135deg, #F8FAFC 0%, #E0F2FE 100%)',
        borderColor: 'rgba(14, 165, 233, 0.28)',
        accent: '#0EA5E9',
        shadow: '0 14px 34px rgba(14, 165, 233, 0.12)',
    },
    [TaskStatus.IN_PROGRESS]: {
        background: 'linear-gradient(135deg, #EEF4FF 0%, #DCEBFF 100%)',
        borderColor: 'rgba(79, 124, 255, 0.35)',
        accent: '#4F7CFF',
        shadow: '0 14px 34px rgba(79, 124, 255, 0.16)',
    },
    [TaskStatus.BUG_FIXING]: {
        background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
        borderColor: 'rgba(244, 63, 94, 0.35)',
        accent: '#E11D48',
        shadow: '0 14px 34px rgba(225, 29, 72, 0.14)',
    },
    [TaskStatus.BLOCKED]: {
        background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
        borderColor: 'rgba(244, 63, 94, 0.35)',
        accent: '#F43F5E',
        shadow: '0 14px 34px rgba(244, 63, 94, 0.14)',
    },
    [TaskStatus.IN_REVIEW]: {
        background: 'linear-gradient(135deg, #ECFEFF 0%, #D6F5FF 100%)',
        borderColor: 'rgba(34, 211, 238, 0.35)',
        accent: '#06B6D4',
        shadow: '0 14px 34px rgba(6, 182, 212, 0.14)',
    },
    [TaskStatus.ON_HOLD]: {
        background: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)',
        borderColor: 'rgba(251, 146, 60, 0.35)',
        accent: '#F97316',
        shadow: '0 14px 34px rgba(249, 115, 22, 0.13)',
    },
    [TaskStatus.DONE]: {
        background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
        borderColor: 'rgba(34, 197, 94, 0.35)',
        accent: '#22C55E',
        shadow: '0 14px 34px rgba(34, 197, 94, 0.14)',
    },
    [TaskStatus.DEPLOYED]: {
        background: 'linear-gradient(135deg, #ECFDF5 0%, #CCFBF1 100%)',
        borderColor: 'rgba(20, 184, 166, 0.35)',
        accent: '#14B8A6',
        shadow: '0 14px 34px rgba(20, 184, 166, 0.14)',
    },
    [TaskStatus.FAILED]: {
        background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
        borderColor: 'rgba(244, 63, 94, 0.35)',
        accent: '#F43F5E',
        shadow: '0 14px 34px rgba(244, 63, 94, 0.14)',
    },
    [TaskStatus.GRAVEYARD]: {
        background: 'linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)',
        borderColor: 'rgba(100, 116, 139, 0.35)',
        accent: '#64748B',
        shadow: '0 14px 34px rgba(100, 116, 139, 0.12)',
    },
};

const getLightTaskStatusStyle = (status: TaskStatus) =>
    LIGHT_TASK_STATUS_STYLES[status] ?? LIGHT_TASK_STATUS_STYLES[TaskStatus.TODO];

const getLightTaskCardStyle = (status: TaskStatus): React.CSSProperties => {
    const style = getLightTaskStatusStyle(status);
    return {
        background: style.background,
        borderColor: style.borderColor,
        boxShadow: style.shadow,
    };
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
    searchable?: boolean;
    searchPlaceholder?: string;
    emptyStateText?: string;
}> = ({
    value,
    placeholder,
    options,
    onChange,
    buttonClassName,
    menuClassName,
    itemClassName,
    activeItemClassName,
    searchable = false,
    searchPlaceholder = 'Search...',
    emptyStateText = 'No results found.',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties | undefined>(undefined);
    const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;
    const visibleOptions = useMemo(() => {
        if (!searchable || !searchQuery.trim()) {
            return options;
        }
        const query = searchQuery.trim().toLowerCase();
        return options.filter((option) => option.label.toLowerCase().includes(query));
    }, [options, searchable, searchQuery]);

    const updateMenuPosition = useCallback(() => {
        if (!buttonRef.current || typeof window === 'undefined') {
            return;
        }
        const rect = buttonRef.current.getBoundingClientRect();
        const sidePadding = 8;
        const width = Math.min(rect.width, window.innerWidth - sidePadding * 2);
        const left = Math.min(
            Math.max(rect.left, sidePadding),
            Math.max(sidePadding, window.innerWidth - width - sidePadding),
        );
        const top = rect.bottom + 8;
        setMenuStyle({
            position: 'fixed',
            top,
            left,
            width,
            zIndex: 9999,
        });
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        updateMenuPosition();
        const handleClick = (event: MouseEvent) => {
            if (menuRef.current?.contains(event.target as Node)) {
                return;
            }
            if (!wrapperRef.current || wrapperRef.current.contains(event.target as Node)) {
                return;
            }
            setIsOpen(false);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        window.addEventListener('resize', updateMenuPosition);
        document.addEventListener('scroll', updateMenuPosition, true);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
            window.removeEventListener('resize', updateMenuPosition);
            document.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [isOpen, updateMenuPosition]);

    useEffect(() => {
        if (!isOpen && searchQuery) {
            setSearchQuery('');
        }
    }, [isOpen, searchQuery]);

    return (
        <div ref={wrapperRef} className="relative min-w-[190px]">
            <button
                ref={buttonRef}
                type="button"
                className={`${buttonClassName} flex w-full items-center justify-between gap-3 text-left`}
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className={value ? '' : 'opacity-80'}>{selectedLabel}</span>
                <ChevronIcon open={isOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
            </button>
            {isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    style={menuStyle}
                    className={`overflow-hidden rounded-b-[12px] border ${menuClassName}`}
                >
                    {searchable && (
                        <div className="border-b border-white/10 p-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={searchPlaceholder}
                                className="w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-cyan-300/70 focus:outline-none"
                            />
                        </div>
                    )}
                    <div className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
                        {visibleOptions.map((option) => {
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
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                        {visibleOptions.length === 0 && (
                            <div className="px-3 py-2 text-xs text-white/60">{emptyStateText}</div>
                        )}
                    </div>
                </div>,
                document.body,
            )}        </div>
    );
};



const Tasks: React.FC = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalTasks, setTotalTasks] = useState(0);
    const [statusCounts, setStatusCounts] = useState<Record<TaskStatus, number>>({});
    const { user } = useAuth();
    const zone = workTimezone(user?.timezone);
    const queryClient = useQueryClient();
    const active = useTaskViewActive();
    const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isLight = resolvedTheme === 'light';

    const taskTextColor = isDark ? 'text-white' : 'text-slate-900';
    const taskTextSecondary = isDark ? 'text-white/80' : 'text-slate-700';
    const taskTextMuted = isDark ? 'text-white/70' : 'text-slate-600';
    const taskBgSecondary = isDark ? 'bg-black/30' : 'bg-slate-200/50';
    const taskTagText = isDark ? 'text-white/80' : 'text-slate-800';
    const getTaskCardInlineStyle = useCallback(
        (status: TaskStatus) => (isLight || isColorful ? getLightTaskCardStyle(status) : stageCardStyle(status)),
        [isLight, isColorful],
    );
    const getTaskAccentColor = useCallback(
        (status: TaskStatus) => getLightTaskStatusStyle(status).accent,
        [],
    );


    const getPointsBadgeClass = useCallback(
        (tone: TaskPointsTone | undefined) => {
            if (tone === 'positive') {
                return isDark
                    ? 'border border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                    : 'border border-emerald-400/60 bg-emerald-500/10 text-emerald-700';
            }
            if (tone === 'negative') {
                return isDark
                    ? 'border border-rose-400/50 bg-rose-500/15 text-rose-100'
                    : 'border border-rose-400/60 bg-rose-500/10 text-rose-700';
            }
            if (tone === 'warning') {
                return isDark
                    ? 'border border-amber-400/50 bg-amber-500/15 text-amber-100'
                    : 'border border-amber-400/60 bg-amber-500/10 text-amber-700';
            }
            return isDark
                ? 'border border-white/25 bg-white/10 text-white'
                : 'border border-slate-300 bg-slate-100 text-slate-700';
        },
        [isDark],
    );

    const renderPointsBadge = useCallback(
    (taskItem: Task) => {
        if (!taskItem.pointsBreakdown) {
            return null;
        }

        const summary = summarizeTaskPoints(taskItem.pointsBreakdown);
        const badgeClass = getPointsBadgeClass(summary.tone);
        const notes = taskItem.pointsBreakdown.notes.length > 0 ? taskItem.pointsBreakdown.notes.join(' | ') : '';
        const tooltip = [summary.detail, notes].filter(Boolean).join(' | ');

        return (
            <div className={'mt-2 flex flex-wrap items-center gap-2 text-xs ' + taskTextMuted}>
                <span
                    className={'inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold ' + badgeClass}
                    title={tooltip || undefined}
                >
                    {summary.label}: {formatPointsValue(summary.value)}
                </span>
                {summary.detail && <span className="text-[11px]">{summary.detail}</span>}
            </div>
        );
    },
    [getPointsBadgeClass, taskTextMuted],
);

    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const prefetchedTaskIdsRef = useRef<Set<string>>(new Set());
    const realtimeRefreshTimerRef = useRef<number | null>(null);

    // New state for selected tasks for bulk actions
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

    // Filtering and sorting state
    const [statusFilter, setStatusFilter] = useTaskFilter('status');
    const [priorityFilter, setPriorityFilter] = useTaskFilter('priority');
    const [assigneeFilter, setAssigneeFilter] = useTaskFilter('assigneeId');
    const [projectFilter, setProjectFilter] = useTaskFilter('projectId');
    const [teamFilter, setTeamFilter] = useTaskFilter('team');
    const [dueDateFilter, setDueDateFilter] = useTaskFilter('dueDate');
    const [creationDateFilter, setCreationDateFilter] = useTaskFilter('createdDate');
    const [isDateRangeOpen, setDateRangeOpen] = useState(false);
    const [activeDatePreset, setActiveDatePreset] = useState<'7d' | '30d' | 'mtd' | 'ytd' | 'custom' | ''>('');
    const dateRangeRef = useRef<HTMLDivElement | null>(null);
    const dateRangeButtonRef = useRef<HTMLButtonElement | null>(null);
    const dateRangePanelRef = useRef<HTMLDivElement | null>(null);
    const [dateRangePanelStyle, setDateRangePanelStyle] = useState<React.CSSProperties | undefined>(undefined);
    const [quickFilter, setQuickFilter] = useTaskFilter('quickFilter');
    const hasActiveFilters = Boolean(searchQuery || debouncedSearchQuery || statusFilter || priorityFilter
        || assigneeFilter || projectFilter || teamFilter || dueDateFilter || creationDateFilter || quickFilter);
    const clearFilters = () => {
        setSearchQuery('');
        setStatusFilter('');
        setPriorityFilter('');
        setAssigneeFilter('');
        setProjectFilter('');
        setTeamFilter('');
        setDueDateFilter('');
        setCreationDateFilter('');
        setQuickFilter('');
        setActiveDatePreset('');
        setDateRangeOpen(false);
    };
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('taskViewMode');
            if (saved === 'list' || saved === 'grid') {
                return saved;
            }
        }
        return 'list';
    });
    const prefetchSummaries = false;
    const [globalPageSize, setGlobalPageSize] = useState(50);
    const [pageSizeByView, setPageSizeByView] = useState<Record<'list' | 'grid', number>>({
        list: 50,
        grid: 30,
    });
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        if (!active) return;
        const handleCreateTaskShortcut = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'n') {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (target) {
                const tagName = target.tagName;
                if (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
                    return;
                }
            }

            event.preventDefault();
            setCreateModalOpen(true);
        };

        document.addEventListener('keydown', handleCreateTaskShortcut);
        return () => {
            document.removeEventListener('keydown', handleCreateTaskShortcut);
        };
    }, [active]);

    const changeViewMode = (mode: 'list' | 'grid') => {
        setViewMode(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('taskViewMode', mode);
        }
    };

    const pageSize = Math.min(globalPageSize, pageSizeByView[viewMode]);
    const apiPageSize = pageSize;
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
        setCreationDateFilter('');
        setActiveDatePreset(preset);
    }, [zone]);

    const updateDateRange = useCallback(
        (nextStart: string, nextEnd: string) => {
            const normalizedStart = nextStart || nextEnd;
            const normalizedEnd = nextEnd || nextStart;
            if (!normalizedStart) {
                setDueDateFilter('');
                setActiveDatePreset('');
                return;
            }
            setDueDateFilter(
                normalizedStart === normalizedEnd ? normalizedStart : `${normalizedStart}..${normalizedEnd}`,
            );
            setCreationDateFilter('');
            setActiveDatePreset('custom');
        },
        [],
    );

    const paginationScope = JSON.stringify([viewMode, zone, apiPageSize, debouncedSearchQuery,
        statusFilter, priorityFilter, assigneeFilter, projectFilter, teamFilter, dueDateFilter,
        creationDateFilter, quickFilter]);
    const [pagination, setPagination] = useState({ scope: paginationScope, page: 1 });
    const currentPage = pagination.scope === paginationScope ? pagination.page : 1;
    const setCurrentPage = (value: React.SetStateAction<number>) => setPagination(previous => ({
        scope: paginationScope,
        page: typeof value === 'function' ? value(previous.scope === paginationScope ? previous.page : 1) : value,
    }));

    const listParams = useMemo(
        () => ({
            viewMode,
            timezone: zone,
            page: currentPage,
            pageSize: apiPageSize,
            search: debouncedSearchQuery || undefined,
            status: statusFilter ? (statusFilter as TaskStatus) : undefined,
            priority: priorityFilter ? (priorityFilter as TaskPriority) : undefined,
            assigneeId: assigneeFilter || undefined,
            projectId: projectFilter || undefined,
            team: teamFilter || undefined,
            dueDate: dueDateFilter || undefined,
            createdDate: creationDateFilter || undefined,
            quickFilter: quickFilter || undefined,
        }),
        [
            viewMode,
            currentPage,
            zone,
            apiPageSize,
            debouncedSearchQuery,
            statusFilter,
            priorityFilter,
            assigneeFilter,
            projectFilter,
            teamFilter,
            dueDateFilter,
            creationDateFilter,
            quickFilter,
        ],
    );

    const { data: pageResult, loading: listLoading, error: taskListError, refresh: refreshTasks } = useTaskList({
        params: listParams,
        enabled: Boolean(user) && active,
    });

    const loading = listLoading;
    const [isContentFading, setIsContentFading] = useState(false);

    useEffect(() => {
        if (loading) {
            setIsContentFading(true);
            return;
        }

        const timer = window.setTimeout(() => setIsContentFading(false), 220);
        return () => window.clearTimeout(timer);
    }, [loading]);

    useEffect(() => {
        if (!pageResult) {
            return;
        }
        const tasksWithPoints = augmentTasksWithPoints(pageResult.items);
        setTasks(tasksWithPoints);
        setTotalPages(pageResult.totalPages);
        setTotalTasks(pageResult.total);
        setStatusCounts(pageResult.statusCounts ?? {});
    }, [pageResult]);

    useEffect(() => {
        if (!user) {
            return;
        }
        const loadMetadata = async () => {
            try {
                const [allUsers, deptData, projectData] = await Promise.all([
                    queryClient.fetchQuery({ queryKey: ['users', 'task-views', user.tenantId, user.id, user.role], queryFn: () => api.getUsers(), staleTime: 60_000 }),
                    queryClient.fetchQuery({ queryKey: ['departments', 'task-views', user.tenantId, user.id, user.role], queryFn: () => api.getDepartments(), staleTime: 60_000 }),
                    api.getProjects({ status: ProjectStatus.ACTIVE, pageSize: 100, sortBy: 'name', sortOrder: 'asc' }),
                ]);
                const map = new Map<string, User>();
                allUsers.forEach((entry) => map.set(entry.id, entry));
                setUsersMap(map);
                const departmentNames = Array.from(
                    new Set(
                        (deptData ?? [])
                            .map((dept) => dept.name)
                            .filter((name): name is string => Boolean(name)),
                    ),
                ).sort((a, b) => a.localeCompare(b));
                setDepartmentOptions(departmentNames);
                setProjects(projectData.items ?? []);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                console.error('Failed to fetch task metadata:', message);
            }
        };
        loadMetadata();
    }, [user, queryClient]);


    const updateDateRangePanelPosition = useCallback(() => {
        if (!dateRangeButtonRef.current || typeof window === 'undefined') {
            return;
        }
        const rect = dateRangeButtonRef.current.getBoundingClientRect();
        const sidePadding = 8;
        const width = Math.min(290, window.innerWidth - sidePadding * 2);
        const left = Math.min(
            Math.max(sidePadding, rect.right - width),
            Math.max(sidePadding, window.innerWidth - width - sidePadding),
        );
        const top = rect.bottom + 8;
        setDateRangePanelStyle({
            position: 'fixed',
            top,
            left,
            width,
            zIndex: 9999,
        });
    }, []);

    useEffect(() => {
        if (!isDateRangeOpen) {
            return;
        }
        updateDateRangePanelPosition();
        const onPointerDown = (event: MouseEvent) => {
            if (dateRangePanelRef.current?.contains(event.target as Node)) {
                return;
            }
            if (dateRangeRef.current && !dateRangeRef.current.contains(event.target as Node)) {
                setDateRangeOpen(false);
            }
        };
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setDateRangeOpen(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onEscape);
        window.addEventListener('resize', updateDateRangePanelPosition);
        document.addEventListener('scroll', updateDateRangePanelPosition, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onEscape);
            window.removeEventListener('resize', updateDateRangePanelPosition);
            document.removeEventListener('scroll', updateDateRangePanelPosition, true);
        };
    }, [isDateRangeOpen, updateDateRangePanelPosition]);

    const prefetchBaseParams = useMemo(() => {
        const { page, ...rest } = listParams;
        return rest;
    }, [listParams]);

    const prefetchPages = useMemo(() => currentPage < totalPages ? [currentPage + 1] : [], [currentPage, totalPages]);

    useTaskPrefetch({
        baseParams: prefetchBaseParams,
        pages: prefetchPages,
        enabled: Boolean(user) && active,
        prefetchSummaries,
        visibleTasks: tasks,
    });

    const flushRealtimeTaskRefresh = useCallback(() => {
        realtimeRefreshTimerRef.current = null;
        invalidateTaskCaches();
        refreshTasks();
    }, [refreshTasks]);

    const handleTaskEvent = useCallback(() => {
        if (realtimeRefreshTimerRef.current !== null) {
            window.clearTimeout(realtimeRefreshTimerRef.current);
        }
        realtimeRefreshTimerRef.current = window.setTimeout(flushRealtimeTaskRefresh, 250);
    }, [flushRealtimeTaskRefresh]);

    useEffect(() => () => {
        if (realtimeRefreshTimerRef.current !== null) {
            window.clearTimeout(realtimeRefreshTimerRef.current);
        }
    }, []);

    useEffect(() => {
        window.addEventListener(TASK_REALTIME_EVENT, handleTaskEvent);
        return () => window.removeEventListener(TASK_REALTIME_EVENT, handleTaskEvent);
    }, [handleTaskEvent]);
    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
        };

        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    const formatAssigneeNames = useCallback(
        (assigneeIds: string[] | null) => {
            if (!assigneeIds || assigneeIds.length === 0) {
                return 'Unassigned';
            }

            const names = assigneeIds
                .map((id) => usersMap.get(id)?.name || '')
                .filter((name) => name !== '');

            if (names.length === 0) {
                return 'Unassigned';
            }

            return names.join(', ');
        },
        [usersMap]
    );

    const filteredTasks = useMemo(() => tasks, [tasks]);
    const pagedTasks = useMemo(() => filteredTasks, [filteredTasks]);
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const visibleTaskIds = useMemo(() => pagedTasks.map(task => task.id), [pagedTasks]);
    const selectedTaskPreview = useMemo(() => tasks.find(task => task.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);
    const prefetchTaskDetail = useCallback((taskId: string) => {
        if (prefetchedTaskIdsRef.current.has(taskId)) {
            return;
        }
        prefetchedTaskIdsRef.current.add(taskId);
        void api.getTask(taskId).catch(() => {
            prefetchedTaskIdsRef.current.delete(taskId);
        });
    }, []);

    // New delete handler for single task
    const handleDeleteTask = async (taskId: string) => {
        if (!user) return;
        try {
            await api.deleteTask(taskId);
            setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
            setSelectedTaskIds((prev) => {
                const newSet = new Set(prev);
                newSet.delete(taskId);
                return newSet;
            });
            if (selectedTaskId === taskId) {
                setSelectedTaskId(null);
            }
            refreshTasks();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Failed to delete task:', message);
        }
    };

    // New bulk delete handler
    const handleBulkDelete = async () => {
        if (!user || selectedTaskIds.size === 0) return;
        try {
            await Promise.all(Array.from(selectedTaskIds).map((taskId) => api.deleteTask(taskId)));
            setTasks((prevTasks) => prevTasks.filter((task) => !selectedTaskIds.has(task.id)));
            setSelectedTaskIds(new Set());
            setSelectedTaskId(null);
            refreshTasks();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Failed to bulk delete tasks:', message);
        }
    };

    // Toggle select task
    const toggleSelectTask = (taskId: string) => {
        setSelectedTaskIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(taskId)) {
                newSet.delete(taskId);
            } else {
                newSet.add(taskId);
            }
            return newSet;
        });
    };

    // Select all tasks
    const selectAllTasks = () => {
        setSelectedTaskIds(new Set(visibleTaskIds));
    };

    // Deselect all tasks
    const deselectAllTasks = () => {
        setSelectedTaskIds(new Set());
    };

    // Check if all tasks are selected
    const allSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selectedTaskIds.has(id));

    // Toggle select all (dynamic for Select All button)
    const toggleSelectAll = () => {
        if (allSelected) {
            deselectAllTasks();
        } else {
            selectAllTasks();
        }
    };

    const completedCount = useMemo(() => {
        if (Object.keys(statusCounts).length === 0) {
            return filteredTasks.filter((task) => completedStatuses.has(task.status)).length;
        }
        return Array.from(completedStatuses).reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
    }, [statusCounts, filteredTasks]);
    const urgentCount = filteredTasks.filter((task) => task.priority === TaskPriority.URGENT).length;
    const activeCount = useMemo(() => {
        if (Object.keys(statusCounts).length === 0) {
            return filteredTasks.filter((task) => activeStatuses.has(task.status)).length;
        }
        return Array.from(activeStatuses).reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
    }, [statusCounts, filteredTasks]);
    const blockedCount = filteredTasks.filter((task) => task.status === TaskStatus.BLOCKED).length;
    const overdueCount = filteredTasks.filter((task) => (task.dueAt ? taskInstant(task.dueAt).toMillis() < Date.now() : false)).length;
    const statusSummary = useMemo(
        () =>
            STATUS_ORDER.map((status) => ({
                status,
                label: CUSTOM_STATUS_NAMES[status]?.name ?? status,
                count: statusCounts[status] ?? 0,
            })),
        [statusCounts],
    );
    const newsItems = useMemo(() => {
        if (tasks.length === 0) {
            return [];
        }

        const sorted = [...tasks].sort((a, b) => {
            const aTime = a.createdAt ? taskInstant(a.createdAt).toMillis() : 0;
            const bTime = b.createdAt ? taskInstant(b.createdAt).toMillis() : 0;
            return bTime - aTime;
        });

        return sorted.slice(0, 8).map((task) => {
            const creatorName = usersMap.get(task.createdBy)?.name || 'Someone';
            const assigneeNames = (task.assignedTo ?? [])
                .map((id) => usersMap.get(id)?.name)
                .filter((name): name is string => Boolean(name));
            const assigneeLabel = assigneeNames.length > 0 ? assigneeNames.join(', ') : 'unassigned';
            const departmentLabel = task.team || 'General';
            const projectLabel = task.project?.name ?? 'No project';
            const statusLabel = CUSTOM_STATUS_NAMES[task.status]?.name ?? task.status;
            return {
                id: task.id,
                title: task.title || 'Untitled task',
                department: departmentLabel,
                project: projectLabel,
                creator: creatorName,
                assignee: assigneeLabel,
                priority: task.priority,
                status: statusLabel,
            };
        });
    }, [tasks, usersMap]);
    const newsTickerItems = useMemo(() => {
        if (newsItems.length === 0) {
            return [];
        }
        return newsItems.length > 1 ? [...newsItems, ...newsItems] : newsItems;
    }, [newsItems]);
    const shouldAnimateNews = newsItems.length > 1;
    const canSeeTaskCounts = Boolean(user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role));

    const xpScore = completedCount * 160 + activeCount * 60 + urgentCount * 90;
    const baseLevel = 600;
    const level = Math.max(1, Math.floor(xpScore / baseLevel) + 1);
    const levelProgress = Math.min(100, ((xpScore % baseLevel) / baseLevel) * 100);
    const createdByFilterActive = quickFilter === 'createdByMe';
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
    const getActionButtonTone = (
        isActive: boolean,
        tone: 'cyan' | 'indigo' | 'amber' | 'emerald' | 'violet' | 'slate',
    ) => {
        if (isColorful) {
            const colorfulToneMap = {
                cyan: {
                    active: 'border-cyan-300/90 text-slate-950 bg-gradient-to-b from-cyan-100 via-sky-100 to-indigo-100 shadow-[0_10px_24px_rgba(14,165,233,0.18)]',
                    inactive: 'border-cyan-200/80 text-slate-700 bg-white/82 hover:border-cyan-300 hover:text-slate-950 hover:bg-cyan-50/80',
                    icon: 'text-cyan-600',
                },
                indigo: {
                    active: 'border-indigo-300/90 text-slate-950 bg-gradient-to-b from-indigo-100 via-violet-100 to-fuchsia-100 shadow-[0_10px_24px_rgba(124,58,237,0.16)]',
                    inactive: 'border-indigo-200/80 text-slate-700 bg-white/82 hover:border-indigo-300 hover:text-slate-950 hover:bg-indigo-50/80',
                    icon: 'text-indigo-600',
                },
                amber: {
                    active: 'border-amber-300/90 text-slate-950 bg-gradient-to-b from-amber-100 via-orange-100 to-rose-100 shadow-[0_10px_24px_rgba(245,158,11,0.16)]',
                    inactive: 'border-amber-200/80 text-slate-700 bg-white/82 hover:border-amber-300 hover:text-slate-950 hover:bg-amber-50/80',
                    icon: 'text-amber-600',
                },
                emerald: {
                    active: 'border-emerald-300/90 text-slate-950 bg-gradient-to-b from-emerald-100 via-teal-100 to-cyan-100 shadow-[0_10px_24px_rgba(16,185,129,0.16)]',
                    inactive: 'border-emerald-200/80 text-slate-700 bg-white/82 hover:border-emerald-300 hover:text-slate-950 hover:bg-emerald-50/80',
                    icon: 'text-emerald-600',
                },
                violet: {
                    active: 'border-violet-300/90 text-slate-950 bg-gradient-to-b from-violet-100 via-fuchsia-100 to-pink-100 shadow-[0_10px_24px_rgba(168,85,247,0.16)]',
                    inactive: 'border-violet-200/80 text-slate-700 bg-white/82 hover:border-violet-300 hover:text-slate-950 hover:bg-violet-50/80',
                    icon: 'text-violet-600',
                },
                slate: {
                    active: 'border-slate-300/90 text-slate-950 bg-gradient-to-b from-slate-100 via-white to-sky-50 shadow-[0_10px_24px_rgba(100,116,139,0.14)]',
                    inactive: 'border-slate-200/90 text-slate-700 bg-white/82 hover:border-slate-300 hover:text-slate-950 hover:bg-slate-50',
                    icon: 'text-slate-600',
                },
            } as const;
            const selected = colorfulToneMap[tone];
            return {
                className: [getQuickFilterButtonClass(isActive), isActive ? selected.active : selected.inactive].join(' '),
                iconClassName: selected.icon,
            };
        }
        const toneMap = {
            cyan: {
                active: 'border-cyan-300/80 text-cyan-50 shadow-[0_0_22px_rgba(34,211,238,0.35)] hover:shadow-[0_0_28px_rgba(34,211,238,0.42)]',
                inactive: 'border-cyan-300/45 text-cyan-100/90 hover:border-cyan-200/75 hover:text-cyan-50 hover:shadow-[0_0_22px_rgba(34,211,238,0.25)]',
                icon: 'text-cyan-200',
            },
            indigo: {
                active: 'border-indigo-300/80 text-indigo-50 shadow-[0_0_22px_rgba(99,102,241,0.35)] hover:shadow-[0_0_28px_rgba(99,102,241,0.42)]',
                inactive: 'border-indigo-300/45 text-indigo-100/90 hover:border-indigo-200/75 hover:text-indigo-50 hover:shadow-[0_0_22px_rgba(99,102,241,0.25)]',
                icon: 'text-indigo-200',
            },
            amber: {
                active: 'border-amber-300/80 text-amber-50 shadow-[0_0_22px_rgba(245,158,11,0.33)] hover:shadow-[0_0_28px_rgba(245,158,11,0.4)]',
                inactive: 'border-amber-300/45 text-amber-100/90 hover:border-amber-200/75 hover:text-amber-50 hover:shadow-[0_0_22px_rgba(245,158,11,0.24)]',
                icon: 'text-amber-200',
            },
            emerald: {
                active: 'border-emerald-300/80 text-emerald-50 shadow-[0_0_22px_rgba(16,185,129,0.33)] hover:shadow-[0_0_28px_rgba(16,185,129,0.4)]',
                inactive: 'border-emerald-300/45 text-emerald-100/90 hover:border-emerald-200/75 hover:text-emerald-50 hover:shadow-[0_0_22px_rgba(16,185,129,0.24)]',
                icon: 'text-emerald-200',
            },
            violet: {
                active: 'border-violet-300/80 text-violet-50 shadow-[0_0_22px_rgba(139,92,246,0.35)] hover:shadow-[0_0_28px_rgba(139,92,246,0.42)]',
                inactive: 'border-violet-300/45 text-violet-100/90 hover:border-violet-200/75 hover:text-violet-50 hover:shadow-[0_0_22px_rgba(139,92,246,0.24)]',
                icon: 'text-violet-200',
            },
            slate: {
                active: 'border-slate-300/70 text-slate-50 shadow-[0_0_20px_rgba(148,163,184,0.3)] hover:shadow-[0_0_26px_rgba(148,163,184,0.36)]',
                inactive: 'border-slate-300/45 text-slate-100/90 hover:border-slate-200/70 hover:text-slate-50 hover:shadow-[0_0_20px_rgba(148,163,184,0.22)]',
                icon: 'text-slate-200',
            },
        } as const;
        const selected = toneMap[tone];
        return {
            className: [getQuickFilterButtonClass(isActive), isActive ? selected.active : selected.inactive].join(' '),
            iconClassName: selected.icon,
        };
    };
    const myTasksTone = getActionButtonTone(quickFilter === 'myTasks', 'cyan');
    const createdByTone = getActionButtonTone(createdByFilterActive, 'indigo');
    const overdueTone = getActionButtonTone(quickFilter === 'overdue', 'amber');
    const completedTone = getActionButtonTone(quickFilter === 'completed', 'emerald');
    const listTone = getActionButtonTone(viewMode === 'list', 'cyan');
    const gridTone = getActionButtonTone(viewMode === 'grid', 'indigo');
    const selectAllTone = getActionButtonTone(allSelected, 'slate');
    const pagePanelClass = isLight
        ? 'border-indigo-200/70 bg-gradient-to-br from-white via-[#F7FAFF] to-[#EEF6FF] shadow-[0_24px_55px_rgba(79,124,255,0.14)]'
        : isColorful
            ? 'border-white/75 bg-gradient-to-br from-white/90 via-[#f8fbff]/88 to-[#fff7fb]/86 shadow-[0_24px_55px_rgba(124,58,237,0.14)] backdrop-blur-xl'
            : 'border-cyan-400/25 bg-gradient-to-br from-[#060c1a] via-[#020617] to-[#030712] shadow-[0_26px_58px_rgba(8,145,178,0.28)]';
    const templateButtonClass = isLight
        ? 'task-template-action group relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold'
        : isColorful
            ? 'task-template-action group relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold'
            : [
            'group relative inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold',
            'border-cyan-300/60 text-cyan-100 bg-gradient-to-b from-[#0f2a3f] via-[#0b1f33] to-[#08162b]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_0_rgba(6,78,99,0.45),0_16px_30px_rgba(2,132,199,0.22)]',
            'transition-all duration-200 hover:-translate-y-[1px] hover:border-cyan-200/80 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_7px_0_rgba(6,78,99,0.5),0_0_28px_rgba(34,211,238,0.35)]',
            'active:translate-y-[1px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_3px_0_rgba(6,78,99,0.5),0_12px_20px_rgba(8,145,178,0.25)]',
        ].join(' ');
    const createTaskButtonClass = isLight
        ? 'task-create-action group relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold'
        : isColorful
            ? 'task-create-action group relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold'
            : [
            'group relative inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold text-white',
            'border-fuchsia-300/70 bg-gradient-to-b from-fuchsia-500 via-indigo-600 to-[#312e81]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_6px_0_rgba(49,46,129,0.6),0_16px_30px_rgba(99,102,241,0.32)]',
            'transition-all duration-200 hover:-translate-y-[1px] hover:border-fuchsia-200/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_7px_0_rgba(49,46,129,0.62),0_0_34px_rgba(168,85,247,0.45)]',
            'active:translate-y-[1px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_3px_0_rgba(49,46,129,0.62),0_12px_22px_rgba(99,102,241,0.3)]',
        ].join(' ');
    const toolbarPanelClass = isLight
        ? 'relative isolate z-40 rounded-2xl border border-indigo-200/70 bg-white/92 p-3 shadow-[0_18px_42px_rgba(79,124,255,0.14)] backdrop-blur-xl'
        : isColorful
            ? 'relative isolate z-40 rounded-2xl border border-white/75 bg-white/88 p-3 shadow-[0_18px_42px_rgba(124,58,237,0.13)] backdrop-blur-xl'
        : 'relative isolate z-40 rounded-2xl border border-cyan-400/25 bg-slate-950/55 p-3 shadow-[0_20px_48px_rgba(2,6,23,0.65)] backdrop-blur-xl';
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
        ? 'border-indigo-100 bg-white text-slate-800 shadow-[0_20px_45px_rgba(79,124,255,0.18)]'
        : isColorful
            ? 'border-fuchsia-100 bg-white text-slate-800 shadow-[0_20px_45px_rgba(217,70,239,0.16)]'
            : 'border-slate-500/40 bg-[#081229] text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.7)]';
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
    const countPanelClass = isLight
        ? 'border-indigo-200/70 bg-white/82 shadow-[0_18px_42px_rgba(79,124,255,0.12)] backdrop-blur-xl'
        : isColorful
            ? 'border-fuchsia-200/70 bg-white/82 shadow-[0_18px_42px_rgba(217,70,239,0.12)] backdrop-blur-xl'
            : 'border-cyan-400/25 bg-gradient-to-r from-slate-950/85 via-blue-950/80 to-slate-950/90 shadow-[0_20px_50px_rgba(8,145,178,0.22)]';
    const countCardBase = [
        'relative overflow-hidden rounded-2xl border px-4 py-3 min-w-[110px]',
        'transition duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(15,23,42,0.35)]',
    ].join(' ');
    const countCardTheme = isLight
        ? 'border-indigo-200/75 bg-gradient-to-br from-white via-[#F7FAFF] to-[#EEF6FF] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_22px_rgba(79,124,255,0.1)]'
        : isColorful
            ? 'border-fuchsia-200/75 bg-gradient-to-br from-white via-[#fff7fb] to-[#eef6ff] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_22px_rgba(217,70,239,0.1)]'
            : 'border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-950/85 to-black/90 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]';
    const countCardLabel = isLight || isColorful ? 'text-slate-500' : 'text-white/70';
    const countCardValue = isLight || isColorful ? 'text-slate-900' : 'text-white';
    const countCardGlow = isLight
        ? 'bg-[radial-gradient(circle,rgba(79,124,255,0.16),transparent_70%)]'
        : isColorful
            ? 'bg-[radial-gradient(circle,rgba(217,70,239,0.14),transparent_70%)]'
            : 'bg-[radial-gradient(circle,rgba(34,211,238,0.25),transparent_70%)]';
    const totalCountCardStyle = isColorful
        ? {
            background: 'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(236,254,255,0.88))',
            borderColor: 'rgba(125, 211, 252, 0.62)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 12px 26px rgba(14,165,233,0.14)',
        }
        : undefined;
    const getCountCardStyle = (status: TaskStatus): React.CSSProperties | undefined => {
        if (!isColorful) {
            return undefined;
        }
        const statusStyle = getLightTaskStatusStyle(status);
        return {
            background: statusStyle.background,
            borderColor: statusStyle.borderColor,
            boxShadow: statusStyle.shadow,
        };
    };
    const missionUpdatesClass = isLight
        ? 'mission-updates rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-slate-950 via-indigo-800 to-fuchsia-700 px-4 py-3 shadow-[0_20px_46px_rgba(79,70,229,0.22)]'
        : isColorful
            ? 'mission-updates rounded-2xl border border-white/70 bg-gradient-to-r from-[#fff7ed]/92 via-[#fdf2f8]/92 to-[#ecfeff]/92 px-4 py-3 text-slate-900 shadow-[0_18px_42px_rgba(244,114,182,0.16)] backdrop-blur-xl'
        : 'mission-updates rounded-2xl border border-rose-400/30 bg-gradient-to-r from-rose-950/80 via-slate-950/90 to-amber-950/80 px-4 py-3 shadow-[0_20px_50px_rgba(190,18,60,0.2)]';
    const loadingBadgeClass = isLight
        ? 'rounded-full border border-indigo-200/70 bg-white/90 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700 shadow-[0_10px_24px_rgba(79,124,255,0.18)] backdrop-blur-sm'
        : isColorful
            ? 'rounded-full border border-fuchsia-200/80 bg-white/88 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700 shadow-[0_10px_24px_rgba(217,70,239,0.12)] backdrop-blur-sm'
        : 'rounded-full border border-cyan-300/35 bg-slate-900/55 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.22)] backdrop-blur-sm';
    const taskCardClass = isLight
        ? 'group relative overflow-hidden rounded-2xl border p-4 text-slate-900 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(79,124,255,0.18)] cursor-pointer'
        : isColorful
            ? 'group relative overflow-hidden rounded-2xl border p-4 text-slate-900 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(217,70,239,0.14)] cursor-pointer'
        : 'rounded-2xl border border-border-color p-4 transition-all duration-300 hover:scale-[1.02] cursor-pointer';
    const gridTaskCardClass = isLight || isColorful
        ? taskCardClass
        : 'relative rounded-2xl border border-border-color p-4 transition-all duration-300 hover:scale-[1.02] cursor-pointer';
    const paginationTextClass = isLight || isColorful ? 'text-slate-700' : 'text-text-secondary';
    const paginationControlClass = isLight
        ? 'rounded-full border border-indigo-200/80 bg-white/85 px-3 py-2 text-sm font-medium text-slate-800 shadow-[0_8px_18px_rgba(79,124,255,0.12)]'
        : isColorful
            ? 'rounded-full border border-fuchsia-200/80 bg-white/85 px-3 py-2 text-sm font-medium text-slate-800 shadow-[0_8px_18px_rgba(217,70,239,0.10)]'
        : `rounded-full border border-border-color bg-transparent px-3 py-2 text-sm font-medium shadow-[0_0_12px_rgba(56,189,248,0.2)] text-text-primary`;
    const paginationButtonClass = isLight
        ? 'rounded-full border border-indigo-200/80 bg-white/85 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-800 shadow-[0_8px_18px_rgba(79,124,255,0.12)] transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50'
        : isColorful
            ? 'rounded-full border border-fuchsia-200/80 bg-white/85 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-800 shadow-[0_8px_18px_rgba(217,70,239,0.10)] transition hover:border-fuchsia-300 hover:bg-fuchsia-50 disabled:opacity-50'
        : `rounded-full border border-border-color px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] shadow-[0_0_14px_rgba(56,189,248,0.2)] transition hover:border-primary hover:bg-primary/10 disabled:opacity-50 text-text-primary`;
    const missionLabelClass = isColorful
        ? 'rounded-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-violet-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.4em] text-white shadow-[0_10px_22px_rgba(217,70,239,0.22)]'
        : 'rounded-full bg-rose-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.4em] text-white shadow-[0_0_18px_rgba(244,63,94,0.65)]';
    const missionTickerClass = isColorful
        ? 'mission-ticker-track flex w-max items-center gap-6 pr-8 text-sm text-slate-700'
        : 'mission-ticker-track flex w-max items-center gap-6 pr-8 text-sm text-white/90';
    const missionDepartmentClass = isColorful ? 'font-semibold text-amber-700' : 'font-semibold text-amber-200';
    const missionMutedClass = isColorful ? 'text-slate-500' : 'text-white/70';
    const missionStrongClass = isColorful ? 'font-semibold text-slate-950' : 'font-semibold text-white';
    const missionTitleClass = isColorful ? 'text-indigo-700' : 'text-sky-200';
    const getMissionPriorityClass = (priority: TaskPriority) => {
        if (isColorful) {
            if (priority === TaskPriority.URGENT) return 'border-rose-300 bg-rose-50 text-rose-700';
            if (priority === TaskPriority.HIGH) return 'border-orange-300 bg-orange-50 text-orange-700';
            if (priority === TaskPriority.MEDIUM) return 'border-amber-300 bg-amber-50 text-amber-700';
            return 'border-emerald-300 bg-emerald-50 text-emerald-700';
        }
        if (priority === TaskPriority.URGENT) return 'border-rose-400/70 bg-rose-500/20 text-rose-100';
        if (priority === TaskPriority.HIGH) return 'border-orange-400/70 bg-orange-500/20 text-orange-100';
        if (priority === TaskPriority.MEDIUM) return 'border-amber-300/70 bg-amber-500/20 text-amber-100';
        return 'border-emerald-300/70 bg-emerald-500/20 text-emerald-100';
    };
    const statusOptions = useMemo(
        () => [
            { value: '', label: 'All Statuses' },
            ...STATUS_ORDER.map((status) => ({
                value: String(status),
                label: CUSTOM_STATUS_NAMES[status as TaskStatus]?.name || status.replace('_', ' '),
            })),
        ],
        [],
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
    const projectOptions = useMemo(
        () => [
            { value: '', label: 'All Projects' },
            ...projects.map((project) => ({
                value: project.id,
                label: project.client?.companyName ? `${project.name} - ${project.client.companyName}` : project.name,
            })),
        ],
        [projects],
    );
    const teamOptions = useMemo(
        () => [{ value: '', label: 'All Teams' }, ...departmentOptions.map((department) => ({ value: department, label: department }))],
        [departmentOptions],
    );
    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const handleCloseDetailModal = () => {
        setSelectedTaskId(null);
        refreshTasks();
    };

    const handleTaskCreated = () => {
        setCreateModalOpen(false);
        refreshTasks();
    };

    return (
        <div className={isLight ? 'tasks-light-theme space-y-6' : isColorful ? 'tasks-colorful-theme relative isolate min-h-screen space-y-6 overflow-hidden' : 'space-y-6'}>
            <div className="p-1 sm:p-1">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <h2 className={isLight || isColorful ? 'text-3xl font-bold text-slate-950' : 'text-3xl font-bold text-text-primary'}>
                        Tasks <span className={isLight || isColorful ? 'inline-block align-top text-xl text-fuchsia-500 sparkle-pulse' : 'inline-block align-top text-xl text-cyan-300 sparkle-pulse'}>*</span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                        {(user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
                            <button onClick={() => setTemplateModalOpen(true)} className={templateButtonClass}>
                                <TagIcon className="h-4 w-4" />
                                Templates
                            </button>
                        )}
                        <button onClick={() => setCreateModalOpen(true)} className={createTaskButtonClass}>
                            + Create Task
                        </button>
                    </div>
                </div>
            </div>

            <div className={missionUpdatesClass}>
                <style>{`
                    @keyframes taskNewsTicker {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                    .mission-updates:hover .mission-ticker-track {
                        animation-play-state: paused;
                    }
                    .sparkle-pulse {
                        animation: sparklePulse 2.8s ease-in-out infinite;
                    }
                    @keyframes sparklePulse {
                        0%, 100% { transform: translateY(0); opacity: 0.9; }
                        50% { transform: translateY(-2px); opacity: 1; }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .mission-ticker-track,
                        .sparkle-pulse {
                            animation: none !important;
                        }
                    }
                `}</style>
                <div className="flex items-center gap-3">
                    <span className={missionLabelClass}>
                        Mission Updates
                    </span>
                    <div className="flex-1 overflow-hidden">
                        {newsItems.length === 0 ? (
                            <span className={isColorful ? 'text-sm text-slate-600' : 'text-sm text-white/80'}>No task updates yet.</span>
                        ) : (
                            <div
                                className={missionTickerClass}
                                style={shouldAnimateNews ? { animation: 'taskNewsTicker 130s linear infinite' } : undefined}
                            >
                                {newsTickerItems.map((item, index) => (
                                    <span key={`${item.id}-${index}`} className="whitespace-nowrap">
                                        <span className={missionDepartmentClass}>{item.department}</span>
                                        <span className={missionMutedClass}> team / </span>
                                        <span className={missionStrongClass}>{item.project}</span>
                                        <span className={missionMutedClass}> project: </span>
                                        <span className={missionStrongClass}>{item.creator}</span>
                                        <span className={missionMutedClass}> created </span>
                                        <span className={missionTitleClass}>"{item.title}"</span>
                                        <span className={missionMutedClass}> for </span>
                                        <span className={missionStrongClass}>{item.assignee}</span>
                                        <span className={missionMutedClass}>. Status: </span>
                                        <span className={missionStrongClass}>{item.status}</span>
                                        <span
                                            className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${getMissionPriorityClass(item.priority)}`}
                                        >
                                            {item.priority}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {canSeeTaskCounts && (
                <div className={`rounded-2xl border p-4 ${countPanelClass}`}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className={`${countCardBase} ${countCardTheme}`} style={totalCountCardStyle}>
                            <span className={`pointer-events-none absolute inset-0 ${countCardGlow}`} />
                            <p className={`relative text-[10px] uppercase tracking-[0.24em] ${countCardLabel}`}>Total tasks</p>
                            <p className={`relative text-lg font-semibold ${countCardValue}`}>{totalTasks}</p>
                        </div>
                        {statusSummary.map((item) => (
                            <div key={item.status} className={`${countCardBase} ${countCardTheme}`} style={getCountCardStyle(item.status)}>
                                <span className={`pointer-events-none absolute inset-0 ${countCardGlow}`} />
                                <p className={`relative text-[10px] uppercase tracking-[0.24em] ${countCardLabel}`}>{item.label}</p>
                                <p className={`relative text-lg font-semibold ${countCardValue}`}>{item.count}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className={`${toolbarPanelClass} mb-4`}>
                <div className="flex flex-wrap items-start gap-2 pb-2">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        className={`${filterInputClass} w-full lg:w-[400px] lg:flex-none`}
                        placeholder="Search Tasks"
                    />
                    <FilterDropdown
                        value={statusFilter}
                        placeholder="All Statuses"
                        options={statusOptions}
                        onChange={setStatusFilter}
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
                        searchable
                        searchPlaceholder="Search assignee..."
                        emptyStateText="No assignee found."
                    />
                    <FilterDropdown
                        value={projectFilter}
                        placeholder="All Projects"
                        options={projectOptions}
                        onChange={setProjectFilter}
                        buttonClassName={dropdownButtonClass}
                        menuClassName={dropdownMenuClass}
                        itemClassName={dropdownItemClass}
                        activeItemClassName={dropdownItemActiveClass}
                        searchable
                        searchPlaceholder="Search project..."
                        emptyStateText="No project found."
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
                    <div ref={dateRangeRef} className="relative min-w-[220px]">
                        <button
                            ref={dateRangeButtonRef}
                            type="button"
                            className={`${dropdownButtonClass} flex w-full items-center justify-between gap-3 text-left`}
                            onClick={() => setDateRangeOpen((prev) => !prev)}
                            aria-haspopup="dialog"
                            aria-expanded={isDateRangeOpen}
                        >
                            <span className={dueDateFilter ? '' : 'opacity-80'}>{dateRangeLabel}</span>
                            <ChevronIcon open={isDateRangeOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
                        </button>
                        {isDateRangeOpen && typeof document !== 'undefined' && createPortal(
                            <div
                                ref={dateRangePanelRef}
                                style={dateRangePanelStyle}
                                className={`rounded-xl border p-3 ${dropdownMenuClass}`}
                            >
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
                                                    ? isLight || isColorful
                                                        ? 'border-indigo-300/80 bg-indigo-100 text-indigo-700'
                                                        : 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                                                    : isLight || isColorful
                                                        ? 'border-indigo-100 bg-white text-slate-600 hover:border-indigo-300 hover:text-slate-950'
                                                        : 'border-white/20 bg-black/20 text-white/80 hover:border-cyan-300/70 hover:text-white',
                                            ].join(' ')}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <label className={isLight || isColorful ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>From</label>
                                    <input
                                        type="date"
                                        value={dateRangeTokens.start}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                            updateDateRange(event.target.value, dateRangeTokens.end)
                                        }
                                        className={filterInputClass}
                                    />
                                    <label className={isLight || isColorful ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>To</label>
                                    <input
                                        type="date"
                                        value={dateRangeTokens.end}
                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                            updateDateRange(dateRangeTokens.start, event.target.value)
                                        }
                                        className={filterInputClass}
                                    />
                                </div>
                                <div className="mt-3 flex items-center justify-between">
                                    <button
                                        type="button"
                                        className={isLight || isColorful ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 hover:text-indigo-800' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80 hover:text-cyan-100'}
                                        onClick={() => {
                                            setDueDateFilter('');
                                            setCreationDateFilter('');
                                            setActiveDatePreset('');
                                        }}
                                    >
                                        Clear
                                    </button>
                                    <button
                                        type="button"
                                        className={isLight || isColorful ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 hover:text-slate-950' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 hover:text-white'}
                                        onClick={() => setDateRangeOpen(false)}
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>,
                            document.body,
                        )}
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'myTasks' ? '' : 'myTasks')}
                        aria-pressed={quickFilter === 'myTasks'}
                        className={myTasksTone.className}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10 inline-flex items-center gap-2"><span className={myTasksTone.iconClassName}>{'\u{1F464}'}</span>My Tasks</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setQuickFilter(createdByFilterActive ? '' : 'createdByMe')}
                        className={createdByTone.className}
                        aria-pressed={createdByFilterActive}
                        title="Show tasks you created"
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10 inline-flex items-center gap-2"><span className={createdByTone.iconClassName}>{'\u2728'}</span>Task Created By Me</span>
                    </button>
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'overdue' ? '' : 'overdue')}
                        aria-pressed={quickFilter === 'overdue'}
                        className={overdueTone.className}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10 inline-flex items-center gap-2"><span className={overdueTone.iconClassName}>{'\u26A0\uFE0F'}</span>Overdue</span>
                    </button>
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'completed' ? '' : 'completed')}
                        aria-pressed={quickFilter === 'completed'}
                        className={completedTone.className}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10 inline-flex items-center gap-2"><span className={completedTone.iconClassName}>{'\u2713'}</span>Completed</span>
                    </button>

                    <div className="ml-auto flex items-center gap-2 pointer-events-none">
                        <button
                            onClick={() => changeViewMode('list')}
                            className={[listTone.className, 'pointer-events-auto'].join(' ')}
                            title="List View"
                        >
                            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                            <span className="relative z-10 inline-flex items-center gap-2"><span className={listTone.iconClassName}>{'\u2637'}</span>List</span>
                        </button>
                        <button
                            onClick={() => changeViewMode('grid')}
                            className={[gridTone.className, 'pointer-events-auto'].join(' ')}
                            title="Grid View"
                        >
                            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                            <span className="relative z-10 inline-flex items-center gap-2"><span className={gridTone.iconClassName}>{'\u25A6'}</span>Grid</span>
                        </button>


                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleSelectAll}
                            className={[selectAllTone.className, 'px-1.5 py-0.9 text-[10px] font-semibold disabled:opacity-50'].join(' ')}
                            disabled={visibleTaskIds.length === 0}
                            title={allSelected ? 'Deselect all visible tasks' : 'Select all visible tasks'}
                        >
                            <span className="relative z-10 inline-flex items-center gap-2"><span className={selectAllTone.iconClassName}>{'\u2611'}</span>{allSelected ? 'Deselect All' : 'Select All'}</span>
                        </button>
                        <button
                            onClick={handleBulkDelete}
                            className="rounded-full border border-red-500 bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-50 disabled:border-gray-500 disabled:bg-gray-700 disabled:text-gray-300"
                            disabled={selectedTaskIds.size === 0}
                            title="Delete all selected tasks"
                        >
                            Delete Selected ({selectedTaskIds.size})
                        </button>
                    </div>
                </div>
            </div>

            {taskListError && !loading && (
                <div role="alert" className="rounded-xl border border-red-500/40 bg-surface p-4 text-text-primary">
                    <h2 className="font-semibold">Unable to load tasks</h2>
                    <p className="mt-1 text-sm text-text-secondary">{taskListError}</p>
                    <button type="button" onClick={refreshTasks} className="mt-3 rounded-lg border border-border-color px-3 py-2 text-sm font-semibold hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        Retry loading tasks
                    </button>
                </div>
            )}

            <div className="relative z-0 grid gap-4 transition-opacity duration-300 ease-out">
                {!loading && !taskListError && pageResult && pagedTasks.length === 0 && (
                    <div role="status" className="rounded-xl border border-border-color bg-surface p-6 text-text-primary">
                        <h2 className="font-semibold">No tasks found</h2>
                        <p className="mt-1 text-sm text-text-secondary">
                            {quickFilter === 'createdByMe'
                                ? 'No tasks you created match the current filters.'
                                : quickFilter === 'myTasks'
                                    ? 'No tasks assigned to you match the current filters.'
                                    : hasActiveFilters
                                        ? 'No tasks match the current filters or search.'
                                        : 'There are no tasks to show.'}
                        </p>
                        {hasActiveFilters && (
                            <button type="button" onClick={clearFilters} className="mt-3 rounded-lg border border-border-color px-3 py-2 text-sm font-semibold hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                Clear filters
                            </button>
                        )}
                    </div>
                )}
                {loading && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center pt-6">
                        <span className={loadingBadgeClass}>
                            Updating...
                        </span>
                    </div>
                )}
                {viewMode === 'list' && pagedTasks.map((task) => {
                    const showReadMore = task.description.trim().length > 100;
                    return (
                        <div
                            key={task.id}
                            className={`${taskCardClass} ${isContentFading ? 'opacity-65' : 'opacity-100'}`}
                            style={getTaskCardInlineStyle(task.status)}
                            onMouseEnter={() => prefetchTaskDetail(task.id)}
                            onFocus={() => prefetchTaskDetail(task.id)}
                            onClick={() => handleTaskClick(task.id)}
                        >
                            {(isLight || isColorful) && (
                                <span
                                    className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full"
                                    style={{ backgroundColor: getTaskAccentColor(task.status) }}
                                />
                            )}
                            <div className="flex items-center gap-4">
                                <input
                                    type="checkbox"
                                    checked={selectedTaskIds.has(task.id)}
                                    onChange={(e) => {
                                        toggleSelectTask(task.id);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded border-border-color bg-surface/50 text-primary focus:ring-primary"
                                />
                                <div className="relative flex-1">
                                    <h3 className={isLight || isColorful ? 'font-semibold text-slate-950 line-clamp-2' : 'font-semibold text-text-primary line-clamp-2'}>{task.title}</h3>
                                    <p className={isLight || isColorful ? 'text-sm text-slate-600 line-clamp-2 break-words overflow-hidden' : 'text-sm text-text-secondary line-clamp-2 break-words overflow-hidden'}>{task.description}</p>
                                    {showReadMore && (
                                      <span className={isLight || isColorful ? 'mt-1 inline-block text-xs font-semibold text-indigo-600' : 'mt-1 inline-block text-xs font-semibold text-primary/80'}>Read more..</span>
                                    )}
                                    <div className="mt-2 flex items-center gap-2">
                                        <TaskStatusBadge status={task.status} />
                                        <TaskPriorityBadge priority={task.priority} />
                                        <span className={isLight || isColorful ? 'text-xs text-slate-600' : 'text-xs text-text-secondary'}>
                                            Assigned to: {formatAssigneeNames(task.assignedTo)}
                                        </span>
                                    </div>
                                    <div className={isLight || isColorful ? 'mt-2 text-xs font-semibold text-indigo-700' : 'mt-2 text-xs font-semibold text-cyan-200'}>
                                        Project: {task.project?.name ?? 'Legacy task'}
                                    </div>
                                    {renderPointsBadge(task)}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {viewMode === 'grid' && (
                    <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 transition-opacity duration-300 ease-out ${isContentFading ? 'opacity-65' : 'opacity-100'}`}>
                        {pagedTasks.map((task) => {
                            const showReadMore = task.description.trim().length > 100;
                            return (
                                <div
                                    key={task.id}
                                    className={gridTaskCardClass}
                                    style={getTaskCardInlineStyle(task.status)}
                                    onMouseEnter={() => prefetchTaskDetail(task.id)}
                                    onFocus={() => prefetchTaskDetail(task.id)}
                                    onClick={() => handleTaskClick(task.id)}
                                >
                                    {(isLight || isColorful) && (
                                        <span
                                            className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full"
                                            style={{ backgroundColor: getTaskAccentColor(task.status) }}
                                        />
                                    )}
                                    <input
                                        type="checkbox"
                                        checked={selectedTaskIds.has(task.id)}
                                        onChange={(e) => {
                                            toggleSelectTask(task.id);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute top-3 left-3 z-10 rounded border-border-color bg-surface/50 text-primary focus:ring-primary h-4 w-4"
                                    />
                                    <div className="relative pt-1 pl-8"> {/* Padding for checkbox space */}
                                        <h3 className={isLight || isColorful ? 'min-h-[3rem] font-semibold text-slate-950 line-clamp-2' : 'min-h-[3rem] font-semibold text-text-primary line-clamp-2'}>{task.title}</h3>
                                        <p className={isLight || isColorful ? 'min-h-[2.5rem] text-sm text-slate-600 line-clamp-2 break-words overflow-hidden' : 'min-h-[2.5rem] text-sm text-text-secondary line-clamp-2 break-words overflow-hidden'}>{task.description}</p>
                                        {showReadMore && (
                                            <span className={isLight || isColorful ? 'mt-1 inline-block text-xs font-semibold text-indigo-600' : 'mt-1 inline-block text-xs font-semibold text-primary/80'}>Read more..</span>
                                        )}
                                        <div className="mt-2 flex items-center gap-2">
                                            <TaskStatusBadge status={task.status} />
                                            <TaskPriorityBadge priority={task.priority} />
                                        </div>
                                        <div className={isLight || isColorful ? 'mt-2 text-xs text-slate-600' : 'mt-2 text-xs text-text-secondary'}>
                                            Assigned to: {formatAssigneeNames(task.assignedTo)}
                                        </div>
                                        <div className={isLight || isColorful ? 'mt-1 text-xs font-semibold text-indigo-700' : 'mt-1 text-xs font-semibold text-cyan-200'}>
                                            Project: {task.project?.name ?? 'Legacy task'}
                                        </div>
                                        {renderPointsBadge(task)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

            </div>

            {/* Bottom buttons removed - now at top */}
            <div className={`mt-6 grid gap-3 text-xs md:grid-cols-[1fr_auto_1fr] md:items-center ${paginationTextClass}`}>
                <div className="flex items-center gap-2 md:justify-start">
                    <span className="text-xs uppercase tracking-[0.2em]">Rows</span>
                    <select
                        value={pageSize}
                        onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setPageSizeByView((prev) => ({ ...prev, [viewMode]: nextValue }));
                        }}
                        className={paginationControlClass}
                    >
                        {[10, 20, 50, 100].map((value) => (
                            <option key={value} value={value}>
                                {value} per page
                            </option>
                        ))}
                    </select>
                </div>
                {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className={paginationButtonClass}
                        >
                            Prev page
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className={paginationButtonClass}
                        >
                            Next page
                        </button>
                        <span className="text-xs uppercase tracking-[0.2em]">
                            Page {currentPage} of {totalPages}
                        </span>
                    </div>
                )}
                <div className="hidden md:block" />
            </div>

            {active && isCreateModalOpen && (
                <CreateTaskModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setCreateModalOpen(false)}
                    onTaskCreated={handleTaskCreated}
                />
            )}

            {active && selectedTaskId && (
                <TaskDetailModal
                    taskId={selectedTaskId}
                    isOpen={Boolean(selectedTaskId)}
                    initialTask={selectedTaskPreview}
                    onClose={handleCloseDetailModal}
                    usersMap={usersMap}
                    onTaskDeleted={() => {
                        setSelectedTaskId(null);
                        refreshTasks();
                    }}
                />
            )}

            {active && isTemplateModalOpen && (
                <TaskTemplateModal
                    isOpen={isTemplateModalOpen}
                    onClose={() => setTemplateModalOpen(false)}
                    onTemplateAssigned={() => {
                        setTemplateModalOpen(false);
                        refreshTasks();
                    }}
                />
            )}
        </div>
    );
};

export default Tasks;
