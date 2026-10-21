import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import {
    Task,
    User,
    TaskPriority,
    TaskStatus,
    RecurrenceRule,
    Role,
    TaskCalendarDaySummary,
} from '../types';
import { useAuth, useTheme, useSearch } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import CreateTaskModal from '../components/CreateTaskModal';
import { PlusIcon, DocumentTextIcon, BellIcon, XMarkIcon, SparklesIcon } from '../components/icons';
import PageLoader from '../components/loading/PageLoader';
import GamificationService, { GamificationStats, AchievementPopup } from '../services/gamification';
import { CUSTOM_STATUS_NAMES } from '../types';

const gamificationService = GamificationService.getInstance();


type ThemeMode = 'light' | 'dark' | 'colorful' | 'professional' | 'gamified' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful' | 'professional' | 'gamified';
type ViewMode = 'month' | 'week' | 'day';
type QuickActionType = 'note' | 'reminder' | 'more';
type DeadlineUrgency = 'safe' | 'soon' | 'critical' | 'overdue' | 'none';
type TaskTimeState = 'completed' | 'overdue' | 'urgent' | 'warning' | 'safe' | 'none';
type DateVisualState = 'empty' | 'active' | 'completed' | 'today' | 'warning' | 'urgent' | 'overdue';
type CalendarDateSummary = ReturnType<typeof getDateTaskSummary> & { completed: number };

type CalendarNote = {
    id: string;
    content: string;
    createdAt: string;
    createdBy: string | null;
};

type CalendarReminder = {
    id: string;
    message: string;
    createdAt: string;
    createdBy: string | null;
};

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
    if (theme === 'colorful' || theme === 'gamified') return theme;
    if (theme === 'light' || theme === 'professional') return theme;
    if (theme === 'dark') return 'dark';
    if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
};

const getDateKey = (date: Date) => date.toISOString().split('T')[0];
const isTaskCompleted = (task: Task) => task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED;

const getTaskTimeState = (task: Task, now = new Date()): TaskTimeState => {
    if (isTaskCompleted(task)) return 'completed';
    if (!task.dueAt) return 'none';
    const dueTime = new Date(task.dueAt).getTime();
    if (Number.isNaN(dueTime)) return 'none';
    const hoursRemaining = (dueTime - now.getTime()) / 36e5;
    if (hoursRemaining < 0) return 'overdue';
    if (hoursRemaining <= 24) return 'urgent';
    if (hoursRemaining <= 72) return 'warning';
    return 'safe';
};

const getDateVisualState = (tasks: Task[], date: Date, now = new Date()): DateVisualState => {
    const todayKey = getDateKey(now);
    const dateKey = getDateKey(date);
    if (tasks.length === 0) return dateKey === todayKey ? 'today' : 'empty';

    const taskStates = tasks.map((task) => getTaskTimeState(task, now));
    if (taskStates.includes('overdue')) return 'overdue';
    if (taskStates.includes('urgent')) return 'urgent';
    if (taskStates.includes('warning')) return 'warning';
    if (dateKey === todayKey) return 'today';
    if (taskStates.every((state) => state === 'completed')) return 'completed';
    return 'active';
};

const getCalendarThemeClasses = (theme: ResolvedTheme) => {
    if (theme === 'dark') {
        return {
            page: 'calendar-page calendar-page-dark',
            panel: 'calendar-glass-panel calendar-glass-panel-dark',
            field: 'calendar-field calendar-field-dark',
            button: 'calendar-control-button calendar-control-button-dark',
            activeButton: 'calendar-control-button calendar-control-button-active',
            heading: 'text-white',
            muted: 'text-slate-300/80',
            weekday: 'calendar-weekday calendar-weekday-dark',
            dateBadge: 'calendar-date-badge calendar-date-badge-dark',
            countChip: 'calendar-count-chip calendar-count-chip-dark',
            hotChip: 'calendar-hot-chip calendar-hot-chip-dark',
            empty: 'calendar-empty-summary calendar-empty-summary-dark',
        };
    }
    if (theme === 'colorful' || theme === 'gamified') {
        return {
            page: 'calendar-page calendar-page-colorful',
            panel: 'calendar-glass-panel calendar-glass-panel-colorful',
            field: 'calendar-field calendar-field-colorful',
            button: 'calendar-control-button calendar-control-button-colorful',
            activeButton: 'calendar-control-button calendar-control-button-active',
            heading: 'text-slate-950',
            muted: 'text-slate-600',
            weekday: 'calendar-weekday calendar-weekday-colorful',
            dateBadge: 'calendar-date-badge calendar-date-badge-colorful',
            countChip: 'calendar-count-chip calendar-count-chip-colorful',
            hotChip: 'calendar-hot-chip calendar-hot-chip-colorful',
            empty: 'calendar-empty-summary calendar-empty-summary-colorful',
        };
    }
    return {
        page: 'calendar-page calendar-page-light',
        panel: 'calendar-glass-panel calendar-glass-panel-light',
        field: 'calendar-field calendar-field-light',
        button: 'calendar-control-button calendar-control-button-light',
        activeButton: 'calendar-control-button calendar-control-button-active',
        heading: 'text-slate-950',
        muted: 'text-slate-600',
        weekday: 'calendar-weekday calendar-weekday-light',
        dateBadge: 'calendar-date-badge calendar-date-badge-light',
        countChip: 'calendar-count-chip calendar-count-chip-light',
        hotChip: 'calendar-hot-chip calendar-hot-chip-light',
        empty: 'calendar-empty-summary calendar-empty-summary-light',
    };
};

const priorityOrder: Record<TaskPriority, number> = {
    [TaskPriority.URGENT]: 0,
    [TaskPriority.HIGH]: 1,
    [TaskPriority.MEDIUM]: 2,
    [TaskPriority.LOW]: 3,
};

const getDeadlineUrgency = (task: Task, now = new Date()): DeadlineUrgency => {
    const timeState = getTaskTimeState(task, now);
    if (timeState === 'overdue') return 'overdue';
    if (timeState === 'urgent') return 'critical';
    if (timeState === 'warning') return 'soon';
    if (timeState === 'safe') return 'safe';
    return 'none';
};

const getPriorityCounts = (tasks: Task[]) => ({
    low: tasks.filter((task) => task.priority === TaskPriority.LOW).length,
    medium: tasks.filter((task) => task.priority === TaskPriority.MEDIUM).length,
    high: tasks.filter((task) => task.priority === TaskPriority.HIGH).length,
    urgent: tasks.filter((task) => task.priority === TaskPriority.URGENT).length,
});

const getStatusLabel = (status: TaskStatus) => {
    const custom = CUSTOM_STATUS_NAMES[status];
    if (typeof custom === 'string') return custom;
    if (custom && typeof custom === 'object' && 'name' in custom) return custom.name;
    return status.replace(/_/g, ' ');
};

const getDateTaskSummary = (tasks: Task[], now = new Date()) => {
    const urgency = tasks.reduce<Record<DeadlineUrgency, number>>((acc, task) => {
        acc[getDeadlineUrgency(task, now)] += 1;
        return acc;
    }, { safe: 0, soon: 0, critical: 0, overdue: 0, none: 0 });
    return {
        total: tasks.length,
        completed: tasks.filter((task) => isTaskCompleted(task)).length,
        priority: getPriorityCounts(tasks),
        urgency,
    };
};

const mapCalendarDaySummary = (day: TaskCalendarDaySummary): CalendarDateSummary => ({
    total: day.total,
    completed: day.completed,
    priority: {
        low: day.low,
        medium: day.medium,
        high: day.high,
        urgent: day.urgent,
    },
    urgency: {
        safe: Math.max(0, day.total - day.completed - day.overdue - day.dueSoon),
        soon: day.dueSoon,
        critical: 0,
        overdue: day.overdue,
        none: 0,
    },
});

const getVisualStateFromSummary = (summary: CalendarDateSummary, date: Date, now = new Date()): DateVisualState => {
    if (summary.total === 0) return getDateKey(date) === getDateKey(now) ? 'today' : 'empty';
    if (summary.urgency.overdue > 0) return 'overdue';
    if (summary.priority.urgent > 0 || summary.urgency.critical > 0) return 'urgent';
    if (summary.urgency.soon > 0) return 'warning';
    if (getDateKey(date) === getDateKey(now)) return 'today';
    if (summary.completed >= summary.total) return 'completed';
    return 'active';
};

const startOfWeek = (date: Date) => {
    const clone = new Date(date);
    const diff = clone.getDay();
    clone.setDate(clone.getDate() - diff);
    clone.setHours(0, 0, 0, 0);
    return clone;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const getRangeForView = (mode: ViewMode, reference: Date) => {
    const days: Date[] = [];
    if (mode === 'day') {
        const day = new Date(reference);
        day.setHours(0, 0, 0, 0);
        days.push(day);
        return days;
    }
    if (mode === 'week') {
        const start = startOfWeek(reference);
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            days.push(d);
        }
        return days;
    }
    // month
    const monthStart = startOfMonth(reference);
    const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
    const start = new Date(monthStart);
    start.setDate(start.getDate() - monthStart.getDay());
    const end = new Date(monthEnd);
    if (monthEnd.getDay() !== 6) {
        end.setDate(end.getDate() + (6 - monthEnd.getDay()));
    }
    const iterator = new Date(start);
    while (iterator <= end) {
        days.push(new Date(iterator));
        iterator.setDate(iterator.getDate() + 1);
    }
    return days;
};

const createLightweightId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const CalendarView: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
    const { user } = useAuth() as { user: User | null };
    const queryClient = useQueryClient();
    const { theme } = useTheme();
    const resolvedTheme = resolveTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isGamified = resolvedTheme === 'gamified';
    const isProfessional = resolvedTheme === 'professional' || resolvedTheme === 'light';
    const calendarTheme = useMemo(() => getCalendarThemeClasses(resolvedTheme), [resolvedTheme]);

    const [tasks, setTasks] = useState<Task[]>([]);
    const [calendarSummaryDays, setCalendarSummaryDays] = useState<TaskCalendarDaySummary[]>([]);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [loading, setLoading] = useState(true);

    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
    const [selectedPreviewTaskId, setSelectedPreviewTaskId] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');

    // Filter states
    const [priorityFilter, setPriorityFilter] = useState<'ALL' | TaskPriority>('ALL');
    const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
    const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | 'ME' | string>('ALL');
    const [teamFilter, setTeamFilter] = useState<string>('');
    const [tagFilter, setTagFilter] = useState<string>('');
    const [dueDateFilter, setDueDateFilter] = useState<string>('');
    const [creationDateFilter, setCreationDateFilter] = useState<string>('');
    const [quickFilter, setQuickFilter] = useState<string>('');

    // Removed inline quick add UI state and handlers as per user request
    // const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
    // const [quickAddTitle, setQuickAddTitle] = useState('');
    // const [quickAddPriority, setQuickAddPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
    // const [quickAddLoading, setQuickAddLoading] = useState(false);
    const [activityLog, setActivityLog] = useState<{ message: string; timestamp: string }[]>([]);
    const reminderSentRef = useRef<Set<string>>(new Set());

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createModalDate, setCreateModalDate] = useState<string | null>(null);
    const [activeQuickActionsDay, setActiveQuickActionsDay] = useState<string | null>(null);
    const [quickActionContext, setQuickActionContext] = useState<{ dateKey: string; date: Date; type: QuickActionType } | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [reminderDraft, setReminderDraft] = useState('');
    const [notesByDate, setNotesByDate] = useState<Record<string, CalendarNote[]>>({});
    const [remindersByDate, setRemindersByDate] = useState<Record<string, CalendarReminder[]>>({});
    const notesStorageKey = useMemo(() => (user ? `calendar-notes-${user.id}` : null), [user]);
    const remindersStorageKey = useMemo(() => (user ? `calendar-reminders-${user.id}` : null), [user]);
    const canCreateTasks = !!user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role);

    // Gamification states
    const [gamificationStats, setGamificationStats] = useState<GamificationStats | null>(null);
    const [achievementPopups, setAchievementPopups] = useState<AchievementPopup[]>([]);

    const logActivity = useCallback((message: string) => {
        setActivityLog((prev) => {
            const entry = { message, timestamp: new Date().toISOString() };
            return [entry, ...prev].slice(0, 25);
        });
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (!notesStorageKey) {
            setNotesByDate({});
            return;
        }
        try {
            const stored = window.localStorage.getItem(notesStorageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as Record<string, CalendarNote[]>;
                setNotesByDate(parsed && typeof parsed === 'object' ? parsed : {});
            } else {
                setNotesByDate({});
            }
        } catch (error) {
            console.warn('Failed to load calendar notes from storage', error);
            setNotesByDate({});
        }
    }, [notesStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined' || !notesStorageKey) {
            return;
        }
        try {
            window.localStorage.setItem(notesStorageKey, JSON.stringify(notesByDate));
        } catch (error) {
            console.warn('Failed to persist calendar notes', error);
        }
    }, [notesByDate, notesStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (!remindersStorageKey) {
            setRemindersByDate({});
            return;
        }
        try {
            const stored = window.localStorage.getItem(remindersStorageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as Record<string, CalendarReminder[]>;
                setRemindersByDate(parsed && typeof parsed === 'object' ? parsed : {});
            } else {
                setRemindersByDate({});
            }
        } catch (error) {
            console.warn('Failed to load calendar reminders from storage', error);
            setRemindersByDate({});
        }
    }, [remindersStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined' || !remindersStorageKey) {
            return;
        }
        try {
            window.localStorage.setItem(remindersStorageKey, JSON.stringify(remindersByDate));
        } catch (error) {
            console.warn('Failed to persist calendar reminders', error);
        }
    }, [remindersByDate, remindersStorageKey]);

    // Removed inline quick add handlers
    // const openQuickAdd = (date: Date) => {
    //     setQuickAddDate(date.toISOString());
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    // const submitQuickAdd = async () => {
    //     if (!quickAddDate || !user || !quickAddTitle.trim()) {
    //         return;
    //     }
    //     setQuickAddLoading(true);
    //     try {
    //         await api.createTask(
    //             {
    //                 title: quickAddTitle.trim(),
    //                 description: 'Created from calendar quick add.',
    //                 status: TaskStatus.TODO,
    //                 priority: quickAddPriority,
    //                 team: 'Calendar',
    //                 assignedTo: assigneeFilter === 'ME' ? user.id : assigneeFilter === 'ALL' ? user.id : assigneeFilter,
    //                 dueAt: quickAddDate,
    //                 recurrenceRule: RecurrenceRule.NONE,
    //                 recurringTaskId: null,
    //                 clarityRating: null,
    //                 attachments: [],
    //                 estimatedHours: null,
    //                 tags: [],
    //                 subtasks: [],
    //             } as any,
    //             user.id,
    //         );
    //         logActivity(`Quick-added "${quickAddTitle.trim()}" for ${new Date(quickAddDate).toLocaleDateString()}`);
    //         setQuickAddDate(null);
    //         setQuickAddTitle('');
    //         fetchData();
    //     } catch (error) {
    //         console.error('Failed to quick add task', error);
    //     } finally {
    //         setQuickAddLoading(false);
    //     }
    // };

    // const handleCancelQuickAdd = () => {
    //     setQuickAddDate(null);
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    const daysInView = useMemo(() => getRangeForView(viewMode, currentDate), [viewMode, currentDate]);
    const visibleRange = useMemo(() => {
        const start = daysInView[0] ?? new Date();
        const end = daysInView[daysInView.length - 1] ?? start;
        return { startKey: getDateKey(start), endKey: getDateKey(end) };
    }, [daysInView]);
    const calendarQueryParams = useMemo(() => ({
        search: searchTerm.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        priority: priorityFilter !== 'ALL' ? priorityFilter : undefined,
        assigneeId: assigneeFilter === 'ME' ? user?.id : assigneeFilter !== 'ALL' ? assigneeFilter : undefined,
        team: teamFilter || undefined,
        tag: tagFilter || undefined,
        dueDate: dueDateFilter || undefined,
        createdDate: creationDateFilter || undefined,
        quickFilter: quickFilter || undefined,
    }), [assigneeFilter, creationDateFilter, dueDateFilter, priorityFilter, quickFilter, searchTerm, statusFilter, tagFilter, teamFilter, user?.id]);

    const summaryQueryKey = useMemo(
        () => ['tasks', 'calendar', 'summary', visibleRange.startKey, visibleRange.endKey, calendarQueryParams] as const,
        [calendarQueryParams, visibleRange.endKey, visibleRange.startKey],
    );
    const visibleTasksQueryKey = useMemo(
        () => ['tasks', 'calendar', 'range-tasks', visibleRange.startKey, visibleRange.endKey, calendarQueryParams] as const,
        [calendarQueryParams, visibleRange.endKey, visibleRange.startKey],
    );

    const calendarSummaryQuery = useQuery({
        queryKey: summaryQueryKey,
        queryFn: ({ signal }) => api.getTaskCalendarSummary({
            startDate: visibleRange.startKey,
            endDate: visibleRange.endKey,
            ...calendarQueryParams,
            signal,
        }),
        enabled: Boolean(user),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
    });

    const visibleTasksQuery = useQuery({
        queryKey: visibleTasksQueryKey,
        queryFn: ({ signal }) => api.getTaskCalendarTasks({
            startDate: visibleRange.startKey,
            endDate: visibleRange.endKey,
            ...calendarQueryParams,
            signal,
        }),
        enabled: Boolean(user) && viewMode !== 'month',
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    });

    const usersQuery = useQuery({
        queryKey: ['users', 'calendar'],
        queryFn: () => api.getUsers(),
        enabled: Boolean(user),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
    });

    const fetchData = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['tasks', 'calendar'] });
    }, [queryClient]);

    useEffect(() => {
        if (calendarSummaryQuery.data) {
            setCalendarSummaryDays(calendarSummaryQuery.data.days);
        }
    }, [calendarSummaryQuery.data]);

    useEffect(() => {
        if (viewMode === 'month') {
            setTasks([]);
            return;
        }
        if (visibleTasksQuery.data) {
            setTasks(visibleTasksQuery.data);
        }
    }, [viewMode, visibleTasksQuery.data]);

    useEffect(() => {
        if (!usersQuery.data) return;
        const map = new Map<string, User>();
        usersQuery.data.forEach((u) => map.set(u.id, u));
        setUsersMap(map);
    }, [usersQuery.data]);

    useEffect(() => {
        const isInitialLoading = Boolean(user) && (
            calendarSummaryQuery.isLoading ||
            usersQuery.isLoading ||
            (viewMode !== 'month' && visibleTasksQuery.isLoading)
        );
        setLoading(isInitialLoading);
    }, [calendarSummaryQuery.isLoading, user, usersQuery.isLoading, viewMode, visibleTasksQuery.isLoading]);

    useEffect(() => {
        const error = calendarSummaryQuery.error || visibleTasksQuery.error || usersQuery.error;
        if (error) {
            console.error('Failed to fetch calendar data:', error);
        }
    }, [calendarSummaryQuery.error, usersQuery.error, visibleTasksQuery.error]);

    useEffect(() => {
        if (!user || viewMode !== 'month') return;
        const preload = (monthOffset: number) => {
            const adjacentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + monthOffset, 1);
            const adjacentDays = getRangeForView('month', adjacentDate);
            const start = adjacentDays[0];
            const end = adjacentDays[adjacentDays.length - 1];
            if (!start || !end) return;
            const startDate = getDateKey(start);
            const endDate = getDateKey(end);
            void queryClient.prefetchQuery({
                queryKey: ['tasks', 'calendar', 'summary', startDate, endDate, calendarQueryParams],
                queryFn: ({ signal }) => api.getTaskCalendarSummary({
                    startDate,
                    endDate,
                    ...calendarQueryParams,
                    signal,
                }),
                staleTime: 60_000,
            });
        };
        preload(-1);
        preload(1);
    }, [calendarQueryParams, currentDate, queryClient, user, viewMode]);

    // Update gamification stats when tasks or user changes
    useEffect(() => {
        if (!user || !tasks.length) return;
        const stats = gamificationService.getGamificationStats(tasks, user);
        setGamificationStats(stats);
    }, [tasks, user]);

    const tasksByDate = useMemo(() => {
        const map = new Map<string, Task[]>();
        tasks.forEach((task) => {
            if (!task.dueAt) {
                return;
            }
            const dateKey = getDateKey(new Date(task.dueAt));
            if (!map.has(dateKey)) {
                map.set(dateKey, []);
            }
            map.get(dateKey)!.push(task);
        });
        return map;
    }, [tasks]);

    const dateSummaries = useMemo(() => {
        const map = new Map<string, CalendarDateSummary>();
        calendarSummaryDays.forEach((day) => {
            map.set(day.date, mapCalendarDaySummary(day));
        });
        return map;
    }, [calendarSummaryDays]);

    const selectedDate = selectedDateKey ? new Date(`${selectedDateKey}T00:00:00`) : null;
    const selectedDayTasks = useMemo(() => {
        if (!selectedDateKey) return [];
        return [...(tasksByDate.get(selectedDateKey) ?? [])].sort((a, b) => {
            const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime();
        });
    }, [selectedDateKey, tasksByDate]);
    const selectedPreviewTask = useMemo(() => (
        selectedDayTasks.find((task) => task.id === selectedPreviewTaskId) ?? selectedDayTasks[0] ?? null
    ), [selectedDayTasks, selectedPreviewTaskId]);

    useEffect(() => {
        if (!user) {
            return;
        }
        const now = new Date();
        const tomorrowStart = new Date(now);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        tomorrowStart.setHours(0, 0, 0, 0);
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setHours(23, 59, 59, 999);

        tasks.forEach((task) => {
            if (!task.dueAt) return;
            if (reminderSentRef.current.has(task.id)) return;
            const dueDate = new Date(task.dueAt);
            if (dueDate >= tomorrowStart && dueDate <= tomorrowEnd) {
                reminderSentRef.current.add(task.id);
                const payload = {
                    taskId: task.id,
                    title: task.title,
                    dueAt: task.dueAt,
                    priority: task.priority,
                    assignedTo: task.assignedTo,
                    requestedBy: user?.id,
                };
                fetch('https://n8n.urlfactory.website/webhook/Remainder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).catch((error) => console.error('Failed to send reminder', error));
                logActivity(`Reminder scheduled for "${task.title}" (due tomorrow)`);
            }
        });
    }, [tasks, user, logActivity]);

    const workloadHeat = useMemo(() => {
        const counts = new Map<string, number>();
        tasksByDate.forEach((value, key) => {
            counts.set(key, value.length);
        });
        const max = Math.max(1, ...Array.from(counts.values()));
        return { counts, max };
    }, [tasksByDate]);

    const conflictDates = useMemo(() => {
        const conflicts = new Set<string>();
        dateSummaries.forEach((summary, dateKey) => {
            if (summary.priority.urgent > 1) {
                conflicts.add(dateKey);
            }
        });
        return conflicts;
    }, [dateSummaries]);

    const handlePrev = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        } else if (viewMode === 'week') {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() - 7);
            setCurrentDate(clone);
        } else {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() - 1);
            setCurrentDate(clone);
        }
    };

    const handleNext = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        } else if (viewMode === 'week') {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() + 7);
            setCurrentDate(clone);
        } else {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() + 1);
            setCurrentDate(clone);
        }
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const openDateDrawer = async (date: Date) => {
        const dateKey = getDateKey(date);
        setSelectedDateKey(dateKey);
        setSelectedPreviewTaskId(tasksByDate.get(dateKey)?.[0]?.id ?? null);
        setActiveQuickActionsDay(null);
        if (!tasksByDate.has(dateKey)) {
            try {
                const dayTasks = await queryClient.fetchQuery({
                    queryKey: ['tasks', 'calendar', 'date-tasks', dateKey, calendarQueryParams],
                    queryFn: ({ signal }) => api.getTaskCalendarTasks({
                        startDate: dateKey,
                        ...calendarQueryParams,
                        signal,
                    }),
                    staleTime: 30_000,
                });
                setTasks((prev) => {
                    const withoutDate = prev.filter((task) => !task.dueAt || getDateKey(new Date(task.dueAt)) !== dateKey);
                    return [...withoutDate, ...dayTasks];
                });
                setSelectedPreviewTaskId(dayTasks[0]?.id ?? null);
            } catch (error) {
                console.error('Failed to fetch day tasks:', error);
            }
        }
    };

    const closeDateDrawer = () => {
        setSelectedDateKey(null);
        setSelectedPreviewTaskId(null);
    };

    const closeTaskModal = () => {
        setSelectedTaskId(null);
        fetchData();
    };

    const handleTaskDeleted = (_taskId: string) => {
        setSelectedTaskId(null);
        fetchData();
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
        e.dataTransfer.setData('taskId', taskId);
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>, date: Date) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        if (!taskId || !user) {
            return;
        }
        const movedTask = tasks.find((task) => task.id === taskId);
        const iso = new Date(date).toISOString();
        try {
            setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, dueAt: iso } : task)));
            await api.updateTask(taskId, { dueAt: iso }, user.id);
            fetchData();
            if (movedTask) {
                logActivity(`Moved "${movedTask.title}" to ${new Date(date).toLocaleDateString()}`);
            }
        } catch (error) {
            console.error('Failed to move task', error);
            fetchData();
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

    // Removed inline quick add handlers as per user request
    // const openQuickAdd = (date: Date) => {
    //     setQuickAddDate(date.toISOString());
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    // const submitQuickAdd = async () => {
    //     if (!quickAddDate || !user || !quickAddTitle.trim()) {
    //         return;
    //     }
    //     setQuickAddLoading(true);
    //     try {
    //         await api.createTask(
    //             {
    //                 title: quickAddTitle.trim(),
    //                 description: 'Created from calendar quick add.',
    //                 status: TaskStatus.TODO,
    //                 priority: quickAddPriority,
    //                 team: 'Calendar',
    //                 assignedTo: assigneeFilter === 'ME' ? user.id : assigneeFilter === 'ALL' ? user.id : assigneeFilter,
    //                 dueAt: quickAddDate,
    //                 recurrenceRule: RecurrenceRule.NONE,
    //                 recurringTaskId: null,
    //                 clarityRating: null,
    //                 attachments: [],
    //                 estimatedHours: null,
    //                 tags: [],
    //                 subtasks: [],
    //             } as any,
    //             user.id,
    //         );
    //         logActivity(`Quick-added "${quickAddTitle.trim()}" for ${new Date(quickAddDate).toLocaleDateString()}`);
    //         setQuickAddDate(null);
    //         setQuickAddTitle('');
    //         fetchData();
    //     } catch (error) {
    //         console.error('Failed to quick add task', error);
    //     } finally {
    //         setQuickAddLoading(false);
    //     }
    // };

    // const handleCancelQuickAdd = () => {
    //     setQuickAddDate(null);
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    const openCreateModal = (date: Date) => {
        setCreateModalDate(date.toISOString());
        setIsCreateModalOpen(true);
    };

    const closeCreateModal = () => {
        setIsCreateModalOpen(false);
        setCreateModalDate(null);
        fetchData();
    };

    const toggleQuickActions = (dateKey: string) => {
        setActiveQuickActionsDay((prev) => (prev === dateKey ? null : dateKey));
        setQuickActionContext(null);
    };

    const handleQuickActionSelection = (dateKey: string, date: Date, type: QuickActionType) => {
        setQuickActionContext({ dateKey, date: new Date(date), type });
        setActiveQuickActionsDay(null);
        setNoteDraft('');
        setReminderDraft('');
    };

    const closeQuickActionModal = () => {
        setQuickActionContext(null);
        setNoteDraft('');
        setReminderDraft('');
    };

    const handleNoteSubmit = () => {
        if (!quickActionContext || quickActionContext.type !== 'note') {
            return;
        }
        const content = noteDraft.trim();
        if (!content) {
            return;
        }
        setNotesByDate((prev) => {
            const existing = prev[quickActionContext.dateKey] ? [...prev[quickActionContext.dateKey]] : [];
            existing.push({
                id: createLightweightId(),
                content,
                createdAt: new Date().toISOString(),
                createdBy: user ? user.id : null,
            });
            return { ...prev, [quickActionContext.dateKey]: existing };
        });
        logActivity(`Added note for ${quickActionContext.date.toLocaleDateString()}`);
        closeQuickActionModal();
    };

    const handleReminderSubmit = () => {
        if (!quickActionContext || quickActionContext.type !== 'reminder') {
            return;
        }
        const message = reminderDraft.trim();
        if (!message) {
            return;
        }
        setRemindersByDate((prev) => {
            const existing = prev[quickActionContext.dateKey] ? [...prev[quickActionContext.dateKey]] : [];
            existing.push({
                id: createLightweightId(),
                message,
                createdAt: new Date().toISOString(),
                createdBy: user ? user.id : null,
            });
            return { ...prev, [quickActionContext.dateKey]: existing };
        });
        logActivity(`Added reminder for ${quickActionContext.date.toLocaleDateString()}`);
        closeQuickActionModal();
    };

    const handleNoteDelete = (dateKey: string, noteId: string, displayDate?: Date) => {
        const existing = notesByDate[dateKey] ?? [];
        const target = existing.find((note) => note.id === noteId);
        if (!target) {
            return;
        }
        setNotesByDate((prev) => {
            const current = prev[dateKey] ?? [];
            const nextEntries = current.filter((note) => note.id !== noteId);
            const next = { ...prev };
            if (nextEntries.length > 0) {
                next[dateKey] = nextEntries;
            } else {
                delete next[dateKey];
            }
            return next;
        });
        const friendlyDate = displayDate ? displayDate.toLocaleDateString() : new Date(dateKey).toLocaleDateString();
        logActivity(`Deleted note for ${friendlyDate}`);
    };

    const handleReminderDelete = (dateKey: string, reminderId: string, displayDate?: Date) => {
        const existing = remindersByDate[dateKey] ?? [];
        const target = existing.find((reminder) => reminder.id === reminderId);
        if (!target) {
            return;
        }
        setRemindersByDate((prev) => {
            const current = prev[dateKey] ?? [];
            const nextEntries = current.filter((reminder) => reminder.id !== reminderId);
            const next = { ...prev };
            if (nextEntries.length > 0) {
                next[dateKey] = nextEntries;
            } else {
                delete next[dateKey];
            }
            return next;
        });
        const friendlyDate = displayDate ? displayDate.toLocaleDateString() : new Date(dateKey).toLocaleDateString();
        logActivity(`Deleted reminder for ${friendlyDate}`);
    };

    const formatRangeLabel = () => {
        const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
        if (viewMode === 'month') {
            return formatter.format(currentDate);
        }
        if (viewMode === 'week') {
            const weekStart = startOfWeek(currentDate);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const rangeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
            return `${rangeFormat.format(weekStart)} - ${rangeFormat.format(weekEnd)} ${weekEnd.getFullYear()}`;
        }
        return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(currentDate);
    };

    const renderTasksForDate = (date: Date) => {
        const dateKey = getDateKey(date);
        const dayTasks = tasksByDate.get(dateKey) || [];
        return dayTasks
            .sort((a, b) => a.priority.localeCompare(b.priority))
            .map((task) => {
                const assignees = task.assignedTo ? task.assignedTo.map(id => usersMap.get(id)).filter(Boolean) : [];
                const subtasks = task.subtasks || [];
                const completed = subtasks.filter((sub) => sub.completed).length;
                const progress = subtasks.length > 0 ? Math.round((completed / subtasks.length) * 100) : null;
                return (
                    <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onClick={() => handleTaskClick(task.id)}
                        className="calendar-task-card group rounded-2xl border p-3 text-left text-sm transition"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <p className="calendar-task-title flex-1 truncate font-semibold">{task.title}</p>
                            <TaskPriorityBadge priority={task.priority} />
                        </div>
                        <div className="calendar-task-meta mt-2 flex items-center gap-2 text-xs">
                            <div className="calendar-task-avatar h-6 w-6 rounded-full text-center text-[10px] font-semibold leading-6">
                                {(() => {
                                    if (assignees.length === 0) return '??';
                                    if (assignees.length === 1) {
                                        return assignees[0]!.name.split(' ').map((n) => n[0]).join('').slice(0, 2);
                                    }
                                    if (assignees.length === 2) {
                                        return assignees.map(a => a!.name.split(' ').map((n) => n[0]).join('').slice(0, 1)).join('');
                                    }
                                    return `${assignees.length}`;
                                })()}
                            </div>
                            <span>{task.status.replace(/_/g, ' ').toLowerCase()}</span>
                            {task.tags && task.tags.length > 0 && <span>/ {task.tags[0]}</span>}
                        </div>
                        {progress !== null && (
                            <div className="mt-2">
                                <div className="calendar-task-progress-track h-1.5 w-full rounded-full">
                                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="calendar-task-progress-label mt-1 text-[10px]">Progress {progress}%</p>
                            </div>
                        )}
                    </div>
                );
            });
    };

    const renderMonthSummary = (dateKey: string) => {
        const summary = dateSummaries.get(dateKey) ?? getDateTaskSummary([]);
        if (summary.total === 0) {
            return (
                <div className={`mt-2 flex flex-1 items-center justify-center rounded-xl border border-dashed text-xs ${calendarTheme.empty}`}>
                    No tasks
                </div>
            );
        }
        const priorityRows = [
            { label: 'Overdue', value: summary.urgency.overdue, tone: 'overdue' },
            { label: 'Urgent', value: summary.priority.urgent, tone: 'urgent' },
            { label: 'High', value: summary.priority.high, tone: 'high' },
            { label: 'Medium', value: summary.priority.medium, tone: 'medium' },
            { label: 'Low', value: summary.priority.low, tone: 'low' },
        ].filter((row) => row.value > 0);
        const urgencyRows = [
            { label: 'Due soon', value: summary.urgency.critical + summary.urgency.soon, tone: 'warning' },
            { label: 'Safe', value: summary.urgency.safe, tone: 'safe' },
        ].filter((row) => row.value > 0);

        return (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-visible">
                <div className="grid shrink-0 grid-cols-2 gap-1">
                    {priorityRows.map((row) => (
                        <span key={row.label} data-chip-tone={row.tone} className="calendar-priority-chip inline-flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold">
                            <span className="truncate">{row.label}</span>
                            <span className="shrink-0">{row.value}</span>
                        </span>
                    ))}
                </div>
                <div className="flex min-h-0 flex-wrap gap-1 overflow-hidden">
                    {urgencyRows.slice(0, 3).map((row) => (
                        <span key={row.label} data-chip-tone={row.tone} className="calendar-status-chip rounded-full px-2 py-0.5 text-[10px] font-bold">
                            {row.label}: {row.value}
                        </span>
                    ))}
                </div>
            </div>
        );
    };

    const renderCells = () => {
        const todayKey = getDateKey(new Date());
        const month = currentDate.getMonth();
        const isMonth = viewMode === 'month';
        const now = new Date();

        const rows: React.JSX.Element[] = [];
        const cells: React.JSX.Element[] = [];
        daysInView.forEach((day, index) => {
            const dateKey = getDateKey(day);
            const inCurrentMonth = day.getMonth() === month;
            const isConflict = conflictDates.has(dateKey);
            const summary = dateSummaries.get(dateKey) ?? getDateTaskSummary([]);
            const isSelected = selectedDateKey === dateKey;
            const urgentTotal = summary.priority.urgent + summary.priority.high;
            const visualState = getVisualStateFromSummary(summary, day, now);
            const isToday = dateKey === todayKey;

            const isQuickActionsOpen = activeQuickActionsDay === dateKey;
            const dateNotes = notesByDate[dateKey] ?? [];
            const dateReminders = remindersByDate[dateKey] ?? [];
            const dateBadgeBase = `${calendarTheme.dateBadge} ${isToday ? 'calendar-date-badge-today' : ''}`;
            const quickActionButtonStyles = isDark
                ? 'border-white/15 bg-white/10 text-white/70 hover:border-white/50 hover:text-white'
                : isColorful
                    ? 'border-white/60 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-500'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600';
            const quickActionPanelSurface = isDark
                ? 'border-white/15 bg-slate-900/95 text-white'
                : isColorful
                    ? 'border-white/60 bg-white/95 text-slate-900 shadow-lg'
                    : 'border-slate-200 bg-white text-slate-800 shadow-lg';
            const metaTextClass = isDark ? 'text-white/70' : 'text-slate-600';
            const metaLinkClass = isDark
                ? 'text-white/70 hover:text-white hover:bg-white/10'
                : isColorful
                    ? 'text-slate-600 hover:text-violet-600 hover:bg-violet-100/80'
                    : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50';
            const quickActionOptionClass = isDark
                ? 'flex w-full items-center gap-2 rounded-xl border border-white/10 px-2 py-2 text-left hover:border-white/30 hover:bg-white/10'
                : isColorful
                    ? 'flex w-full items-center gap-2 rounded-xl border border-white/60 px-2 py-2 text-left hover:border-violet-300 hover:bg-violet-100'
                    : 'flex w-full items-center gap-2 rounded-xl border border-slate-200 px-2 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50';

            const cell = (
                <div
                    key={dateKey}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDateDrawer(day)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openDateDrawer(day);
                        }
                    }}
                    data-date-state={visualState}
                    data-outside-month={!inCurrentMonth}
                    data-today={isToday}
                    className={`calendar-day-card relative flex ${isMonth ? 'h-[190px] min-h-[190px]' : 'h-full min-h-[190px]'} cursor-pointer flex-col gap-2 rounded-2xl p-3 ${isConflict ? 'calendar-day-conflict' : ''} ${isSelected ? 'calendar-day-selected' : ''} ${isQuickActionsOpen ? 'z-[55]' : 'z-auto'}`}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day)}
                >
                    <div className="flex items-center justify-between text-xs">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleQuickActions(dateKey);
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border text-[13px] transition ${quickActionButtonStyles}`}
                            aria-label={`Open quick actions for ${day.toDateString()}`}
                        >
                            <PlusIcon className="h-4 w-4" />
                        </button>
                        {canCreateTasks ? (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openCreateModal(day);
                                }}
                                className={`${dateBadgeBase} cursor-pointer transition hover:scale-105`}
                                aria-label={`Schedule task for ${day.toDateString()}`}
                            >
                                {day.getDate()}
                            </button>
                        ) : (
                            <span className={dateBadgeBase}>{day.getDate()}</span>
                        )}
                    </div>

                    {isQuickActionsOpen && (
                        <div
                            className={`absolute right-3 top-12 z-[60] w-48 rounded-2xl border p-3 text-xs shadow-2xl ${quickActionPanelSurface}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Quick actions</p>
                                <button
                                    type="button"
                                    onClick={() => toggleQuickActions(dateKey)}
                                    className="rounded-full p-1 text-xs hover:bg-white/10"
                                    aria-label="Close quick actions"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'note')}
                                    className={quickActionOptionClass}
                                >
                                    <DocumentTextIcon className="h-4 w-4" />
                                    <span>Create note</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'reminder')}
                                    className={quickActionOptionClass}
                                >
                                    <BellIcon className="h-4 w-4" />
                                    <span>Set reminder</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'more')}
                                    className={`${quickActionOptionClass} border-dashed opacity-80 hover:opacity-100`}
                                >
                                    <SparklesIcon className="h-4 w-4" />
                                    <span>Explore more</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {isMonth ? (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className={`${calendarTheme.countChip} rounded-full px-2 py-0.5 text-[11px] font-black`}>
                                    {summary.total} {summary.total === 1 ? 'Task' : 'Tasks'}
                                </span>
                                {urgentTotal > 0 && <span className={`${calendarTheme.hotChip} rounded-full px-2 py-0.5 text-[10px] font-black`}>{urgentTotal} hot</span>}
                            </div>
                            {renderMonthSummary(dateKey)}
                        </>
                    ) : (
                        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                            {renderTasksForDate(day)}
                        </div>
                    )}

                    {(dateNotes.length > 0 || dateReminders.length > 0) && (
                        <div className="mt-1 space-y-1 text-[11px]">
                            {dateNotes.length > 0 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickActionSelection(dateKey, day, 'note');
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-md px-1 py-[2px] transition ${metaLinkClass}`}
                                >
                                    <DocumentTextIcon className="h-3 w-3" />
                                    <span>{dateNotes.length} note{dateNotes.length === 1 ? '' : 's'}</span>
                                </button>
                            )}
                            {dateReminders.length > 0 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickActionSelection(dateKey, day, 'reminder');
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-md px-1 py-[2px] transition ${metaLinkClass}`}
                                >
                                    <BellIcon className="h-3 w-3" />
                                    <span>{dateReminders.length} reminder{dateReminders.length === 1 ? '' : 's'}</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            );

            cells.push(cell);

            if (isMonth && (index + 1) % 7 === 0) {
                rows.push(
                    <div key={`row-${dateKey}`} className="grid grid-cols-7 gap-3">
                        {cells.splice(0)}
                    </div>
                );
            }
        });

        if (viewMode === 'month') {
            return <div className="space-y-3 overflow-x-auto pb-2"><div className="min-w-[980px] space-y-3">{rows}</div></div>;
        }

        if (viewMode === 'week') {
            return <div className="grid grid-cols-7 gap-3">{cells}</div>;
        }

        return <div className="grid gap-3">{cells}</div>;
    };

    const quickActionModalSurface = isDark
        ? 'bg-slate-900/90 border-white/15 text-white'
        : isColorful
            ? 'bg-white/95 border-white/60 text-slate-900 shadow-xl'
            : 'bg-white border-slate-200 text-slate-900 shadow-xl';
    const modalSecondaryButton = isDark
        ? 'rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:border-white/40 hover:text-white'
        : 'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-indigo-200 hover:text-indigo-600';
    const modalPrimaryButton = 'rounded-full bg-gradient-to-r from-sky-400 to-violet-400 px-3 py-1 text-xs font-semibold text-slate-900 shadow hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed';
    const modalSubtleText = isDark ? 'text-white/70' : 'text-slate-600';
    const modalFieldClass = isDark
        ? 'border-white/20 bg-white/5 text-white placeholder:text-white/40 focus:border-sky-300'
        : isColorful
            ? 'border-white/60 bg-white text-slate-800 placeholder:text-slate-400 focus:border-violet-300'
            : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-indigo-300';
    const modalLabelClass = isDark ? 'text-white/50' : 'text-slate-400';
    const modalListCardClass = isDark
        ? 'border-white/15 bg-white/5 text-white/90'
        : isColorful
            ? 'border-white/60 bg-white text-slate-800'
            : 'border-slate-200 bg-white text-slate-800';
    const modalTimestampClass = isDark ? 'text-white/50' : 'text-slate-400';
    const modalDangerButton = isDark
        ? 'rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-200 transition hover:border-red-300 hover:text-red-100 hover:bg-red-500/10'
        : 'rounded-full border border-red-200 px-3 py-1 text-xs text-red-600 transition hover:bg-red-50';

    const notesForModal = quickActionContext ? [...(notesByDate[quickActionContext.dateKey] ?? [])] : [];
    const remindersForModal = quickActionContext ? [...(remindersByDate[quickActionContext.dateKey] ?? [])] : [];

    const drawerSurface = isDark
        ? 'border-white/15 bg-slate-950/95 text-white'
        : isGamified
            ? 'border-violet-200 bg-white/95 text-slate-950 shadow-2xl'
            : 'border-sky-100 bg-white text-slate-950 shadow-2xl';
    const drawerMutedText = isDark ? 'text-white/60' : 'text-slate-500';
    const drawerCard = isDark
        ? 'border-white/10 bg-white/5 hover:border-cyan-300/50 hover:bg-white/10'
        : isGamified
            ? 'border-violet-100 bg-violet-50/60 hover:border-violet-300 hover:bg-white'
            : 'border-sky-100 bg-sky-50/70 hover:border-sky-300 hover:bg-white';
    const getUrgencyVisuals = (urgency: DeadlineUrgency) => {
        if (urgency === 'overdue') return { label: 'Overdue', className: 'border-red-500 bg-red-500/15 text-red-100', dot: 'bg-red-500' };
        if (urgency === 'critical') return { label: 'Critical', className: 'border-red-400 bg-red-500/10 text-red-100', dot: 'bg-red-400' };
        if (urgency === 'soon') return { label: 'Due soon', className: 'border-orange-400 bg-orange-500/10 text-orange-100', dot: 'bg-orange-400' };
        if (urgency === 'safe') return { label: 'Healthy', className: 'border-emerald-400 bg-emerald-500/10 text-emerald-100', dot: 'bg-emerald-400' };
        return { label: 'No due time', className: 'border-slate-400 bg-slate-500/10 text-slate-200', dot: 'bg-slate-400' };
    };
    const selectedDaySummary = getDateTaskSummary(selectedDayTasks);
    const dateDetailsDrawer = selectedDateKey && selectedDate ? (
        <div className="fixed inset-0 z-[115] bg-slate-950/60 backdrop-blur-sm" onClick={closeDateDrawer}>
            <aside
                className={`absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col border-l ${drawerSurface}`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-current/10 px-6 py-5">
                    <div>
                        <p className={`text-xs font-black uppercase tracking-[0.24em] ${drawerMutedText}`}>Mission Day</p>
                        <h2 className="mt-1 text-2xl font-black">
                            {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(selectedDate)}
                        </h2>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                            <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-cyan-200">{selectedDaySummary.total} tasks</span>
                            <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">{selectedDaySummary.urgency.overdue} overdue</span>
                            <span className="rounded-full bg-orange-500/15 px-3 py-1 text-orange-200">{selectedDaySummary.urgency.critical + selectedDaySummary.urgency.soon} due soon</span>
                            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200">{selectedDaySummary.urgency.safe} safe</span>
                        </div>
                    </div>
                    <button type="button" onClick={closeDateDrawer} className="rounded-full border border-current/15 p-2 transition hover:bg-current/10" aria-label="Close day details">
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-h-0 space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-[0.18em]">Tasks</h3>
                            {canCreateTasks && (
                                <button type="button" onClick={() => openCreateModal(selectedDate)} className="rounded-full bg-gradient-to-r from-sky-400 to-violet-400 px-3 py-1.5 text-xs font-black text-slate-950">
                                    Add task
                                </button>
                            )}
                        </div>
                        {selectedDayTasks.length === 0 ? (
                            <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${drawerMutedText}`}>
                                No tasks scheduled for this date.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {selectedDayTasks.map((task) => {
                                    const assignees = task.assignedTo ? task.assignedTo.map((id) => usersMap.get(id)).filter(Boolean) : [];
                                    const urgency = getUrgencyVisuals(getDeadlineUrgency(task));
                                    return (
                                        <button
                                            key={task.id}
                                            type="button"
                                            onClick={() => setSelectedPreviewTaskId(task.id)}
                                            className={`w-full rounded-2xl border p-3 text-left transition ${drawerCard} ${selectedPreviewTask?.id === task.id ? 'ring-2 ring-cyan-300/70' : ''}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-black">{task.title}</p>
                                                    <p className={`mt-1 truncate text-xs ${drawerMutedText}`}>
                                                        {assignees.map((assignee) => assignee!.name).join(', ') || 'Unassigned'} / {task.team || 'No squad'}
                                                    </p>
                                                </div>
                                                <TaskPriorityBadge priority={task.priority} />
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                                <span className="rounded-full border border-current/15 px-2 py-0.5">{getStatusLabel(task.status)}</span>
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${urgency.className}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${urgency.dot}`} />
                                                    {urgency.label}
                                                </span>
                                                {task.dueAt && <span className={drawerMutedText}>{new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className={`rounded-2xl border p-4 ${isDark ? 'border-white/10 bg-white/5' : 'border-sky-100 bg-white/80'}`}>
                        {selectedPreviewTask ? (
                            <div className="space-y-4">
                                <div>
                                    <p className={`text-xs font-black uppercase tracking-[0.18em] ${drawerMutedText}`}>Preview</p>
                                    <h3 className="mt-2 text-xl font-black">{selectedPreviewTask.title}</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <span className="rounded-xl border border-current/10 px-3 py-2">Priority<br /><b>{selectedPreviewTask.priority}</b></span>
                                    <span className="rounded-xl border border-current/10 px-3 py-2">Status<br /><b>{getStatusLabel(selectedPreviewTask.status)}</b></span>
                                    <span className="rounded-xl border border-current/10 px-3 py-2">Squad<br /><b>{selectedPreviewTask.team || 'None'}</b></span>
                                    <span className="rounded-xl border border-current/10 px-3 py-2">Due<br /><b>{selectedPreviewTask.dueAt ? new Date(selectedPreviewTask.dueAt).toLocaleString() : 'None'}</b></span>
                                </div>
                                <p className={`whitespace-pre-wrap text-sm leading-6 ${drawerMutedText}`}>
                                    {selectedPreviewTask.description || 'No description available.'}
                                </p>
                                {selectedPreviewTask.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {selectedPreviewTask.tags.slice(0, 6).map((tag) => (
                                            <span key={tag} className="rounded-full bg-cyan-500/15 px-2 py-1 text-xs font-bold text-cyan-200">{tag}</span>
                                        ))}
                                    </div>
                                )}
                                {selectedPreviewTask.attachments?.length > 0 && (
                                    <p className={`text-xs font-semibold ${drawerMutedText}`}>{selectedPreviewTask.attachments.length} attachment{selectedPreviewTask.attachments.length === 1 ? '' : 's'}</p>
                                )}
                                <button type="button" onClick={() => handleTaskClick(selectedPreviewTask.id)} className="w-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 px-4 py-2 text-sm font-black text-slate-950">
                                    Open full task
                                </button>
                            </div>
                        ) : (
                            <div className={`flex h-full min-h-[320px] items-center justify-center text-center text-sm ${drawerMutedText}`}>
                                Select a task to preview mission details.
                            </div>
                        )}
                    </div>
                </div>
            </aside>
        </div>
    ) : null;

    const quickActionModal = quickActionContext ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className={`w-full max-w-sm rounded-2xl border p-5 ${quickActionModalSurface}`}>
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <p className={`text-[11px] uppercase tracking-[0.25em] ${modalLabelClass}`}>
                            {quickActionContext.type === 'note' ? 'Create Note' : quickActionContext.type === 'reminder' ? 'Set Reminder' : 'Coming Soon'}
                        </p>
                        <h3 className="text-lg font-semibold">{new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(quickActionContext.date)}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={closeQuickActionModal}
                        className="rounded-full p-1 text-sm hover:bg-white/10"
                        aria-label="Close quick action modal"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                {quickActionContext.type === 'note' && (
                    <div className="space-y-4 text-sm">
                        <div className="space-y-2">
                            <p className={modalSubtleText}>Saved notes for this day</p>
                            {notesForModal.length > 0 ? (
                                notesForModal
                                    .slice()
                                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                    .map((note) => (
                                        <div key={note.id} className={`rounded-xl border px-3 py-2 ${modalListCardClass}`}>
                                            <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                                            <div className="mt-3 flex items-center justify-between text-[11px]">
                                                <span className={modalTimestampClass}>{new Date(note.createdAt).toLocaleString()}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleNoteDelete(quickActionContext.dateKey, note.id, quickActionContext.date)}
                                                    className={modalDangerButton}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <p className={modalSubtleText}>No notes captured yet. Add one below.</p>
                            )}
                        </div>
                        <div className="space-y-3">
                            <p className={modalSubtleText}>Add a new note</p>
                            <textarea
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                rows={4}
                                className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none ${modalFieldClass}`}
                                placeholder="Reminder about standup, blockers, or anything else..."
                            />
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={closeQuickActionModal} className={modalSecondaryButton}>Cancel</button>
                                <button type="button" onClick={handleNoteSubmit} disabled={!noteDraft.trim()} className={modalPrimaryButton}>Save note</button>
                            </div>
                        </div>
                    </div>
                )}

                {quickActionContext.type === 'reminder' && (
                    <div className="space-y-4 text-sm">
                        <div className="space-y-2">
                            <p className={modalSubtleText}>Scheduled reminders</p>
                            {remindersForModal.length > 0 ? (
                                remindersForModal
                                    .slice()
                                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                    .map((reminder) => (
                                        <div key={reminder.id} className={`rounded-xl border px-3 py-2 ${modalListCardClass}`}>
                                            <p className="whitespace-pre-wrap text-sm">{reminder.message}</p>
                                            <div className="mt-3 flex items-center justify-between text-[11px]">
                                                <span className={modalTimestampClass}>{new Date(reminder.createdAt).toLocaleString()}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleReminderDelete(quickActionContext.dateKey, reminder.id, quickActionContext.date)}
                                                    className={modalDangerButton}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <p className={modalSubtleText}>No reminders set yet. Create one below.</p>
                            )}
                        </div>
                        <div className="space-y-3">
                            <p className={modalSubtleText}>Add a new reminder</p>
                            <textarea
                                value={reminderDraft}
                                onChange={(e) => setReminderDraft(e.target.value)}
                                rows={3}
                                className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none ${modalFieldClass}`}
                                placeholder="What should everyone remember?"
                            />
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={closeQuickActionModal} className={modalSecondaryButton}>Cancel</button>
                                <button type="button" onClick={handleReminderSubmit} disabled={!reminderDraft.trim()} className={modalPrimaryButton}>Save reminder</button>
                            </div>
                        </div>
                    </div>
                )}

                {quickActionContext.type === 'more' && (
                    <div className="space-y-3 text-sm">
                        <p className={modalSubtleText}>We&apos;re sketching more quick actions next... think recurring events, checklists, and AI summaries.</p>
                        <p className={modalSubtleText}>Tell us what would help most and we&apos;ll bump it up the roadmap.</p>
                        <div className="flex justify-end">
                            <button type="button" onClick={closeQuickActionModal} className={modalPrimaryButton}>Sounds good</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    ) : null;
    const buttonBase = 'rounded-full px-3 py-1 text-xs font-semibold transition';
    const activeBtn = calendarTheme.activeButton;
    const inactiveBtn = calendarTheme.button;
    const fieldClass = calendarTheme.field;

    const controls = (
        <div className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${calendarTheme.panel}`}>
            <div className="flex flex-wrap items-center gap-2">
                {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`${buttonBase} ${viewMode === mode ? activeBtn : inactiveBtn}`}
                    >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
                <button onClick={handlePrev} className={`${buttonBase} ${inactiveBtn}`}>Prev</button>
                <button onClick={handleToday} className={`${buttonBase} ${inactiveBtn}`}>Today</button>
                <button onClick={handleNext} className={`${buttonBase} ${inactiveBtn}`}>Next</button>
                <span className="text-sm font-semibold">{formatRangeLabel()}</span>
            </div>
        </div>
    );

    const filterBar = (
        <div className={`mb-6 grid gap-3 rounded-2xl border px-5 py-4 md:grid-cols-[2fr,1fr,1fr,1fr] ${calendarTheme.panel}`}>
            <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search quests..."
                className={`rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
            />
            <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as 'ALL' | TaskPriority)}
                className={`rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
            >
                <option value="ALL">All priorities</option>
                {Object.values(TaskPriority).map((priority) => (
                    <option key={priority} value={priority}>
                        {priority.replace(/_/g, ' ')}
                    </option>
                ))}
            </select>
            <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | TaskStatus)}
                className={`rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
            >
                <option value="ALL">All statuses</option>
                {Object.values(TaskStatus).map((status) => (
                    <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                    </option>
                ))}
            </select>
            <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value as 'ALL' | 'ME' | string)}
                className={`rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
            >
                <option value="ME">My quests</option>
                <option value="ALL">Entire squad</option>
                            {Array.from(usersMap.values()).map((member) => {
                                const typedMember = member as User;
                                return (
                                    <option key={typedMember.id} value={typedMember.id}>
                                        {typedMember.name}
                                    </option>
                                );
                            })}
            </select>
        </div>
    );

    const legend = (
        <div className={`mb-6 flex flex-wrap items-center gap-4 text-xs ${calendarTheme.muted}`}>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-400/60" />
                Heavy workload
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-gradient-to-r from-sky-400 to-violet-400" />
                Today
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full border border-white/40" />
                Drag quests to reschedule
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-white/30 ring-2 ring-rose-400/60" />
                Conflict alert
            </span>
        </div>
    );

    const content = loading ? <PageLoader /> : (
        <div className={`${calendarTheme.page} ${onClose ? 'calendar-page-popup' : ''} space-y-6`}>
            {!onClose && <h1 className={`text-3xl font-extrabold tracking-tight ${calendarTheme.heading}`}>Mission Calendar</h1>}
            {controls}
            {filterBar}
            {legend}
            {viewMode === 'month' && (
                <div className="overflow-x-auto pb-2">
                    <div className={`grid min-w-[980px] grid-cols-7 gap-3 text-xs font-semibold uppercase tracking-[0.3em] ${calendarTheme.muted}`}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <div key={day} className={calendarTheme.weekday}>
                                {day}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {renderCells()}
            <div className={`rounded-2xl border border-dashed p-4 text-xs ${calendarTheme.panel} ${calendarTheme.muted}`}>
                Advanced automations such as reminders, external calendar sync, exports, smart scheduling, and time-blocking are on the roadmap.
            </div>
            {(selectedDateKey || quickActionContext || selectedTaskId || isCreateModalOpen) && (
                <div>
                    {!selectedTaskId && !isCreateModalOpen && dateDetailsDrawer}
                    {quickActionModal}
                    {selectedTaskId && (
                        <TaskDetailModal
                            taskId={selectedTaskId}
                            isOpen={!!selectedTaskId}
                            onClose={closeTaskModal}
                            usersMap={usersMap}
                            onTaskDeleted={handleTaskDeleted}
                        />
                    )}
                    {isCreateModalOpen && (
                        <CreateTaskModal
                            isOpen={isCreateModalOpen}
                            onClose={closeCreateModal}
                            onTaskCreated={closeCreateModal}
                            initialDueDate={createModalDate}
                        />
                    )}
                </div>
            )}
        </div>
    );

    if (!onClose) return content;

    const dismiss = () => {
        if (selectedTaskId) closeTaskModal();
        else if (isCreateModalOpen) closeCreateModal();
        else if (quickActionContext) closeQuickActionModal();
        else if (selectedDateKey) closeDateDrawer();
        else onClose();
    };

    return (
        <Dialog open onClose={dismiss} className="fixed inset-0 z-[80]">
            <DialogBackdrop className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" />
            <div className="fixed inset-0 flex items-center justify-center p-2 sm:p-4">
                <DialogPanel className={`flex max-h-[calc(100dvh-1rem)] w-full max-w-[1600px] flex-col rounded-2xl border shadow-2xl sm:max-h-[calc(100dvh-2rem)] ${isDark ? 'border-slate-700 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}>
                    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-current/10 px-4 py-3 sm:px-6">
                        <DialogTitle className="text-xl font-bold sm:text-2xl">Mission Calendar</DialogTitle>
                        <button type="button" onClick={onClose} aria-label="Close calendar" autoFocus className="rounded-full p-2 transition hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                        </button>
                    </header>
                    <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6">{content}</div>
                </DialogPanel>
            </div>
        </Dialog>
    );
};

export default CalendarView;
