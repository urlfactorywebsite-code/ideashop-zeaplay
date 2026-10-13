import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Task, User, TaskStatus, TaskPriority, Role } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskStatusBadge from '../components/ui/TaskStatusBadge';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import { formatDate } from '../utils';
import TaskDetailModal from '../components/TaskDetailModal';
import { augmentTasksWithPoints, calculateUserPointsFromTasks } from '../utils/taskPoints';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { LEVELS_CONFIG_UPDATED_EVENT, getLevelProgress, loadLevelsConfig } from '../utils/levelsConfigStorage';
import { BoltIcon, ChartBarIcon, RocketLaunchIcon, SparklesIcon, TrophyIcon } from '../components/icons';
import PageLoader from '../components/loading/PageLoader';

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

const statusOrder: TaskStatus[] = [
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BUG_FIXING,
    TaskStatus.IN_REVIEW,
    TaskStatus.BLOCKED,
    TaskStatus.ON_HOLD,
    TaskStatus.DONE,
    TaskStatus.DEPLOYED,
    TaskStatus.FAILED,
    TaskStatus.GRAVEYARD,
];

const focusStatuses: TaskStatus[] = [
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BUG_FIXING,
    TaskStatus.IN_REVIEW,
];

const focusQueueStatusSet = new Set<TaskStatus>([
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BUG_FIXING,
]);

const completedStatuses = new Set<TaskStatus>([
    TaskStatus.DONE,
    TaskStatus.DEPLOYED,
    TaskStatus.FAILED,
]);

const statusDetails: Record<TaskStatus, { label: string; legend: string; gradient: string; glow: string }> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        label: 'Awaiting Brief',
        legend: 'Gather intel',
        gradient: 'from-slate-500/25 via-slate-600/25 to-slate-800/30',
        glow: 'shadow-[0_25px_45px_rgba(100,116,139,0.35)]',
    },
    [TaskStatus.TODO]: {
        label: 'Ready Queue',
        legend: 'Prep to launch',
        gradient: 'from-indigo-500/25 via-sky-500/25 to-cyan-500/30',
        glow: 'shadow-[0_25px_45px_rgba(59,130,246,0.35)]',
    },
    [TaskStatus.IN_PROGRESS]: {
        label: 'Active Quest',
        legend: 'Stay in the zone',
        gradient: 'from-purple-500/25 via-fuchsia-500/25 to-rose-500/30',
        glow: 'shadow-[0_25px_45px_rgba(192,132,252,0.35)]',
    },
    [TaskStatus.BUG_FIXING]: {
        label: 'Bug Fixing',
        legend: 'Fix defects',
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/30',
        glow: 'shadow-[0_25px_45px_rgba(248,113,113,0.35)]',
    },
    [TaskStatus.IN_REVIEW]: {
        label: 'Review Bay',
        legend: 'Awaiting verdict',
        gradient: 'from-emerald-500/25 via-teal-500/25 to-sky-400/30',
        glow: 'shadow-[0_25px_45px_rgba(16,185,129,0.35)]',
    },
    [TaskStatus.BLOCKED]: {
        label: 'Blocked Path',
        legend: 'Needs assistance',
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/30',
        glow: 'shadow-[0_25px_45px_rgba(248,113,113,0.35)]',
    },
    [TaskStatus.ON_HOLD]: {
        label: 'Paused Run',
        legend: 'Resume later',
        gradient: 'from-slate-400/25 via-slate-500/25 to-slate-600/30',
        glow: 'shadow-[0_25px_45px_rgba(148,163,184,0.3)]',
    },
    [TaskStatus.DONE]: {
        label: 'Completed',
        legend: 'Claim your XP',
        gradient: 'from-emerald-400/25 via-lime-400/25 to-amber-300/30',
        glow: 'shadow-[0_25px_45px_rgba(74,222,128,0.35)]',
    },
    [TaskStatus.DEPLOYED]: {
        label: 'Deployed',
        legend: 'Released live',
        gradient: 'from-teal-400/25 via-emerald-400/25 to-lime-300/30',
        glow: 'shadow-[0_25px_45px_rgba(45,212,191,0.35)]',
    },
    [TaskStatus.FAILED]: {
        label: 'Failed',
        legend: 'Mission failed',
        gradient: 'from-cyan-400/25 via-emerald-400/25 to-teal-400/30',
        glow: 'shadow-[0_25px_45px_rgba(45,212,191,0.35)]',
    },
    [TaskStatus.GRAVEYARD]: {
        label: 'Archived',
        legend: 'Archived quests',
        gradient: 'from-gray-400/25 via-gray-500/25 to-gray-600/30',
        glow: 'shadow-[0_25px_45px_rgba(107,114,128,0.35)]',
    },
};

const getStatusDetails = (status: TaskStatus) => {
    return (
        statusDetails[status] || {
            label: status,
            legend: 'Track progress',
            gradient: 'from-slate-500/25 via-slate-600/25 to-slate-800/30',
            glow: 'shadow-[0_25px_45px_rgba(100,116,139,0.35)]',
        }
    );
};

type DashboardStatusVisual = {
    gradient: string;
    border: string;
    accent: string;
    glow: string;
    focusTint: string;
};

const dashboardStatusVisuals: Record<TaskStatus, DashboardStatusVisual> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        gradient: 'from-slate-100 via-slate-50 to-white',
        border: 'border-slate-200/80',
        accent: '#64748B',
        glow: 'shadow-[0_18px_38px_rgba(100,116,139,0.12)]',
        focusTint: 'linear-gradient(135deg, rgba(248,250,252,0.96), rgba(226,232,240,0.72))',
    },
    [TaskStatus.TODO]: {
        gradient: 'from-slate-100 via-sky-50 to-indigo-50',
        border: 'border-sky-200/80',
        accent: '#60A5FA',
        glow: 'shadow-[0_18px_38px_rgba(96,165,250,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(240,249,255,0.96), rgba(224,231,255,0.72))',
    },
    [TaskStatus.IN_PROGRESS]: {
        gradient: 'from-[#E879F9]/35 via-[#C7D2FE]/58 to-[#DBEAFE]/75',
        border: 'border-violet-200/80',
        accent: '#8B5CF6',
        glow: 'shadow-[0_20px_44px_rgba(139,92,246,0.18)]',
        focusTint: 'linear-gradient(135deg, rgba(245,243,255,0.96), rgba(219,234,254,0.74))',
    },
    [TaskStatus.BUG_FIXING]: {
        gradient: 'from-red-100 via-rose-50 to-white',
        border: 'border-rose-200/80',
        accent: '#E11D48',
        glow: 'shadow-[0_18px_38px_rgba(225,29,72,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(255,241,242,0.96), rgba(254,226,226,0.74))',
    },
    [TaskStatus.IN_REVIEW]: {
        gradient: 'from-amber-100 via-orange-50 to-white',
        border: 'border-orange-200/80',
        accent: '#F97316',
        glow: 'shadow-[0_18px_38px_rgba(249,115,22,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(255,251,235,0.96), rgba(255,237,213,0.76))',
    },
    [TaskStatus.BLOCKED]: {
        gradient: 'from-red-100 via-rose-50 to-white',
        border: 'border-rose-200/80',
        accent: '#F43F5E',
        glow: 'shadow-[0_18px_38px_rgba(244,63,94,0.15)]',
        focusTint: 'linear-gradient(135deg, rgba(255,241,242,0.96), rgba(254,226,226,0.74))',
    },
    [TaskStatus.ON_HOLD]: {
        gradient: 'from-yellow-100 via-amber-50 to-white',
        border: 'border-yellow-200/80',
        accent: '#EAB308',
        glow: 'shadow-[0_18px_38px_rgba(234,179,8,0.13)]',
        focusTint: 'linear-gradient(135deg, rgba(254,252,232,0.96), rgba(254,243,199,0.74))',
    },
    [TaskStatus.DONE]: {
        gradient: 'from-green-100 via-emerald-50 to-teal-50',
        border: 'border-emerald-200/80',
        accent: '#22C55E',
        glow: 'shadow-[0_18px_38px_rgba(34,197,94,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(236,253,245,0.96), rgba(209,250,229,0.72))',
    },
    [TaskStatus.DEPLOYED]: {
        gradient: 'from-teal-100 via-emerald-50 to-white',
        border: 'border-teal-200/80',
        accent: '#14B8A6',
        glow: 'shadow-[0_18px_38px_rgba(20,184,166,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(240,253,250,0.96), rgba(204,251,241,0.72))',
    },
    [TaskStatus.FAILED]: {
        gradient: 'from-red-100 via-rose-50 to-pink-50',
        border: 'border-rose-200/80',
        accent: '#E11D48',
        glow: 'shadow-[0_18px_38px_rgba(225,29,72,0.14)]',
        focusTint: 'linear-gradient(135deg, rgba(255,241,242,0.96), rgba(252,231,243,0.72))',
    },
    [TaskStatus.GRAVEYARD]: {
        gradient: 'from-slate-100 via-gray-50 to-white',
        border: 'border-slate-200/80',
        accent: '#64748B',
        glow: 'shadow-[0_18px_38px_rgba(100,116,139,0.12)]',
        focusTint: 'linear-gradient(135deg, rgba(248,250,252,0.96), rgba(226,232,240,0.72))',
    },
};

const Dashboard: React.FC = () => {
    console.log('Dashboard.tsx: Dashboard component rendering');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [allTasks, setAllTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [levelsConfig, setLevelsConfig] = useState(() => loadLevelsConfig());
    const { user } = useAuth();
    const { debouncedSearchQuery } = useSearch();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isLight = !isDark && !isColorful;

    const fetchDashboardData = useCallback(async () => {
        if (!user) {
            return;
        }
        setLoading(true);
        try {
            const [fetchedTasks, allUsers] = await Promise.all([
                api.getTasks(user.id, user.role),
                api.getUsers(),
            ]);

            const tasksWithPoints = augmentTasksWithPoints(fetchedTasks, { config: loadPointsConfig() });
            setAllTasks(tasksWithPoints);
            const myTasks = tasksWithPoints.filter((task) => task.assignedTo?.includes(user.id));
            setTasks(myTasks);

            const map = new Map<string, User>();
            allUsers.forEach((entry) => map.set(entry.id, entry));
            setUsersMap(map);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            setAllTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
            setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
        };

        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleLevelsConfigChange = (event: Event) => {
            const detail = (event as CustomEvent).detail as { levels?: unknown } | undefined;
            setLevelsConfig(Array.isArray(detail?.levels) ? (detail?.levels as ReturnType<typeof loadLevelsConfig>) : loadLevelsConfig());
        };

        window.addEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        return () => {
            window.removeEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        };
    }, []);

    const priorityLabel: Record<TaskPriority, string> = {
        [TaskPriority.LOW]: 'Low',
        [TaskPriority.MEDIUM]: 'Medium',
        [TaskPriority.HIGH]: 'High',
        [TaskPriority.URGENT]: 'Urgent',
    };

    const filteredTasks = useMemo(() => {
        if (!debouncedSearchQuery) {
            return tasks;
        }
        const query = debouncedSearchQuery.toLowerCase();
        return tasks.filter((task) => {
            const label = priorityLabel[task.priority as TaskPriority] || '';
            return (
                task.title.toLowerCase().includes(query) ||
                task.description.toLowerCase().includes(query) ||
                task.team.toLowerCase().includes(query) ||
                task.priority.toLowerCase().includes(query) ||
                label.toLowerCase().includes(query)
            );
        });
    }, [tasks, debouncedSearchQuery]);

    const focusQueueTasks = useMemo(() => {
        const roleWeight: Record<Role, number> = {
            [Role.OWNER]: 3,
            [Role.MANAGER]: 2,
            [Role.ADMIN]: 1,
            [Role.USER]: 0,
        };

        const priorityWeight: Record<TaskPriority, number> = {
            [TaskPriority.URGENT]: 3,
            [TaskPriority.HIGH]: 2,
            [TaskPriority.MEDIUM]: 1,
            [TaskPriority.LOW]: 0,
        };

        return [...filteredTasks]
            .filter((task) => focusQueueStatusSet.has(task.status))
            .sort((a, b) => {
                const aRole = usersMap.get(a.createdBy)?.role ?? Role.USER;
                const bRole = usersMap.get(b.createdBy)?.role ?? Role.USER;
                const roleDelta = (roleWeight[bRole] ?? 0) - (roleWeight[aRole] ?? 0);
                if (roleDelta !== 0) return roleDelta;

                const priorityDelta =
                    (priorityWeight[b.priority as TaskPriority] ?? 0) -
                    (priorityWeight[a.priority as TaskPriority] ?? 0);
                if (priorityDelta !== 0) return priorityDelta;

                const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
                const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
                return aDue - bDue;
            })
            .slice(0, 5);
    }, [filteredTasks, usersMap]);

    const tasksByStatus = useMemo(() => {
        return filteredTasks.reduce((acc, task) => {
            const key = task.status;
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(task);
            return acc;
        }, {} as Record<TaskStatus, Task[]>);
    }, [filteredTasks]);

    const totalTasks = filteredTasks.length;
    const completedCount = filteredTasks.filter((task) => completedStatuses.has(task.status)).length;
    const focusCount = filteredTasks.filter((task) => focusStatuses.includes(task.status)).length;
    const blockedCount = filteredTasks.filter((task) => task.status === TaskStatus.BLOCKED).length;

    const xpScore = user ? calculateUserPointsFromTasks(allTasks, user.id, { user }) : 0;
    const levelProgressData = useMemo(() => getLevelProgress(xpScore, levelsConfig), [xpScore, levelsConfig]);
    const level = levelProgressData.level;
    const xpIntoLevel = levelProgressData.pointsIntoLevel;
    const levelProgress = levelProgressData.progressPercent;
    const levelSpan = levelProgressData.levelSpan;
    const xpToNextLevel = levelProgressData.pointsToNextLevel;
    const nextLevel = levelProgressData.nextLevel;

    const streakLength = Math.max(1, Math.min(30, completedCount + Math.floor(focusCount / 2)));
    const dailyObjective = Math.max(3, Math.ceil(totalTasks / 3));
    const momentumScore = Math.min(100, Math.round(((completedCount + focusCount) / Math.max(1, totalTasks)) * 100));

    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const handleCloseModal = () => {
        setSelectedTaskId(null);
    };

    const handleTaskDeleted = useCallback((_taskId: string) => {
        setSelectedTaskId(null);
        fetchDashboardData();
    }, [fetchDashboardData]);

    if (loading) {
        return <PageLoader />;
    }

    const heroBorder = isDark ? 'border-primary/40' : isColorful ? 'border-white/70' : 'border-indigo-200/70';
    const heroGradient = isDark
        ? 'from-[#1e1b4b] via-[#312e81] to-[#4c1d95]'
        : isColorful
            ? 'from-white/90 via-[#F5F0FF]/85 to-[#ECFEFF]/85'
            : 'from-white via-[#eef6ff] to-[#e8f4ff]';
    const heroTitle = isDark ? 'text-white' : 'text-slate-900';
    const heroSub = isDark ? 'text-white/80' : 'text-slate-600';
    const heroMeta = isDark ? 'text-white/60' : 'text-slate-500';
    const statCardBase = isDark
        ? 'border-white/15 bg-slate-950/35 text-white/85 shadow-[0_20px_52px_rgba(2,6,23,0.35)]'
        : isColorful
            ? 'dashboard-colorful-card border-white/70 bg-white/88 text-slate-800 shadow-[0_18px_42px_rgba(99,102,241,0.14)]'
            : 'dashboard-light-card border-indigo-200/70 bg-white/95 text-slate-800';
    const statAccent = isDark ? 'text-white' : 'text-slate-900';
    const progressTrackClass = isLight || isColorful ? 'bg-[#e8eef8]' : 'bg-white/10';
    const progressFillClass = isLight || isColorful
        ? 'h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 shadow-[0_0_14px_rgba(168,85,247,0.35)]'
        : 'h-full rounded-full bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-500';
    const heroChipClass = isDark ? 'bg-white/10 text-white/80' : 'bg-white/80 text-slate-700 shadow-sm ring-1 ring-indigo-100';
    const statOverlayOpacity = isLight || isColorful ? 'opacity-75' : 'opacity-60';
    const metricValueClass = isDark ? 'text-white' : 'text-slate-950';
    const statLabelClass = isDark ? 'text-white/70' : 'text-slate-700';
    const statIconClass = isDark
        ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/15'
        : 'bg-white/55 text-slate-800 shadow-sm ring-1 ring-white/70';
    const statOverlayClass = isDark ? 'bg-black/10' : 'bg-white/20';

    const questCardBase = isDark
        ? 'bg-surface/70 border border-border-color/70 text-white'
        : isColorful
            ? 'dashboard-colorful-card bg-white/88 border border-white/70 text-slate-800'
            : 'dashboard-light-card bg-white/95 border border-indigo-200/70 text-slate-800';

    const pipelineSurface = isDark
        ? 'bg-surface/80 border border-border-color/70'
        : isColorful
            ? 'dashboard-colorful-card bg-white/88 border border-white/70'
            : 'dashboard-light-card bg-white/95 border border-indigo-200/70';
    const laneTextClass = isLight || isColorful ? 'text-slate-800' : 'text-white';
    const laneMutedTextClass = isLight || isColorful ? 'text-slate-600' : 'text-white/70';
    const laneEyebrowClass = isLight || isColorful ? 'text-slate-500' : 'text-white/80';
    const laneCountClass = isLight || isColorful ? 'bg-white/80 text-slate-700 ring-1 ring-indigo-100' : 'bg-black/30 text-white/80';
    const laneTrackClass = isLight || isColorful ? 'bg-white/80' : 'bg-black/30';
    const laneFillClass = isLight || isColorful
        ? 'h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 shadow-[0_0_12px_rgba(124,58,237,0.28)]'
        : 'h-full rounded-full bg-white/70';
    const taskPreviewClass = isLight || isColorful
        ? 'group flex w-full items-start justify-between gap-3 rounded-xl bg-white/88 px-3 py-2 text-left shadow-[0_8px_22px_rgba(31,41,55,0.08)] ring-1 ring-indigo-100/80 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_28px_rgba(79,124,255,0.16)]'
        : 'group flex w-full items-start justify-between gap-3 rounded-xl bg-black/30 px-3 py-2 text-left transition hover:bg-black/40';
    const taskPreviewTitleClass = isLight || isColorful ? 'text-sm font-semibold text-slate-900 group-hover:text-indigo-700' : 'text-sm font-semibold text-white group-hover:text-amber-200';
    const taskPreviewDescriptionClass = isLight || isColorful ? 'mt-1 text-xs text-slate-600 line-clamp-2' : 'mt-1 text-xs text-white/70 line-clamp-2';
    const focusTaskClass = isLight || isColorful
        ? 'group w-full rounded-2xl border border-white/75 bg-white/90 px-4 py-3 text-left shadow-[0_8px_24px_rgba(31,41,55,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-[0_14px_30px_rgba(79,124,255,0.16)]'
        : 'group w-full rounded-2xl border border-border-color/60 bg-background/60 px-4 py-3 text-left transition hover:border-primary hover:shadow-lg';
    const dashboardRootClass = isLight
        ? 'dashboard-light-theme space-y-10'
        : isColorful
            ? 'dashboard-colorful-theme relative isolate min-h-screen space-y-10 overflow-hidden'
            : 'space-y-10';
    const heroShellClass = isLight
        ? 'dashboard-light-hero'
        : isColorful
            ? 'dashboard-colorful-hero'
            : '';
    const levelAccentClass = isColorful
        ? 'from-[#8B5CF6] to-[#6366F1]'
        : 'from-indigo-500 to-violet-500';
    const momentumAccentClass = isColorful
        ? 'from-[#22D3EE] to-[#3B82F6]'
        : 'from-cyan-400 to-blue-500';
    const topStatCards = [
        {
            label: 'Quests Assigned',
            value: totalTasks,
            accent: 'linear-gradient(135deg, rgba(96,165,250,0.78), rgba(167,139,250,0.68))',
            icon: RocketLaunchIcon,
        },
        {
            label: 'XP Banked',
            value: xpScore.toLocaleString(),
            accent: 'linear-gradient(135deg, rgba(45,212,191,0.78), rgba(34,211,238,0.68))',
            icon: BoltIcon,
        },
        {
            label: 'Focus Lane',
            value: focusCount,
            accent: 'linear-gradient(135deg, rgba(244,114,182,0.74), rgba(251,113,133,0.68))',
            icon: ChartBarIcon,
        },
        {
            label: 'Unclaimed Rewards',
            value: Math.max(0, completedCount - 3),
            accent: 'linear-gradient(135deg, rgba(251,191,36,0.76), rgba(251,113,133,0.66))',
            icon: TrophyIcon,
        },
    ];

    return (
        <div className={dashboardRootClass}>
            <style>
                {`
                    @keyframes dashboardPulse {
                        0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: 0.9; }
                        50% { transform: translate3d(0,-8px,0) scale(1.02); opacity: 1; }
                    }
                    @keyframes dashboardGlow {
                        0%, 100% { box-shadow: 0 0 0 rgba(99,102,241,0.2); }
                        50% { box-shadow: 0 0 45px rgba(99,102,241,0.35); }
                    }
                    @keyframes dashboardSlide {
                        0% { transform: translateY(12px); opacity: 0; }
                        100% { transform: translateY(0); opacity: 1; }
                    }
                `}
            </style>

            <section className={`${heroShellClass} relative overflow-hidden rounded-3xl border ${heroBorder} bg-gradient-to-br ${heroGradient} p-6 shadow-[0_25px_70px_rgba(76,29,149,0.45)] sm:p-8`}>
                <div className={`pointer-events-none absolute -right-20 -top-20 h-56 w-72 ${isDark ? 'bg-primary/30' : isLight ? 'bg-cyan-200/55' : 'bg-cyan-200/60'} blur-3xl`} />
                <div className={`pointer-events-none absolute -bottom-20 -left-16 h-52 w-72 ${isDark ? 'bg-rose-500/30' : isLight ? 'bg-violet-200/50' : 'bg-fuchsia-200/55'} blur-3xl`} />
                {(isLight || isColorful) && (
                    <>
                        <div className="pointer-events-none absolute inset-0 dashboard-light-grid" />
                        <div className="pointer-events-none absolute right-10 top-10 h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.55)]" />
                        <div className="pointer-events-none absolute bottom-12 left-1/2 h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_16px_rgba(139,92,246,0.45)]" />
                    </>
                )}
                <div className="relative grid gap-6 lg:grid-cols-[1.2fr,1fr]">
                    <div>
                        <p className={`text-xs font-semibold uppercase tracking-[0.4em] ${heroMeta}`}>Command Center</p>
                        <h1 className={`mt-3 text-4xl font-extrabold drop-shadow ${heroTitle}`}>Welcome back, {user?.name?.split(' ')[0] || 'Pilot'}!</h1>
                        <p className={`mt-3 max-w-2xl text-sm ${heroSub}`}>
                            Your squad is counting on you. Check active quests, cash in rewards, and keep the streak alive. Complete your daily objectives to unlock bonus XP.
                        </p>
                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                            <div className={`${statCardBase} relative overflow-hidden rounded-[22px] border px-5 py-4 backdrop-blur animate-[dashboardSlide_0.6s_ease]`}>
                                <span className={`pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${levelAccentClass}`} />
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs uppercase tracking-[0.24em]">Level</p>
                                    <SparklesIcon className="h-5 w-5 text-violet-500 transition group-hover:scale-110" />
                                </div>
                                <p className={`mt-2 text-4xl font-extrabold ${metricValueClass}`}>Lv {level}</p>
                                <div className={`mt-4 h-2 w-full overflow-hidden rounded-full ${progressTrackClass}`}>
                                    <div
                                        className={`${progressFillClass} dashboard-progress-fill`}
                                        style={{ width: `${levelProgress}%` }}
                                    />
                                </div>
                                <p className={`mt-2 text-xs ${heroMeta}`}>
                                    {xpIntoLevel.toLocaleString()} / {levelSpan.toLocaleString()} XP &bull;{' '}
                                    {nextLevel ? `${xpToNextLevel.toLocaleString()} XP to Lv ${nextLevel.level}` : 'Max level reached'}
                                </p>
                            </div>
                            <div className={`${statCardBase} relative overflow-hidden rounded-[22px] border px-5 py-4 backdrop-blur animate-[dashboardSlide_0.75s_ease]`}>
                                <span className={`pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${momentumAccentClass}`} />
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs uppercase tracking-[0.24em]">Momentum</p>
                                    <BoltIcon className="h-5 w-5 text-cyan-500 transition group-hover:scale-110" />
                                </div>
                                <p className={`mt-2 text-4xl font-extrabold ${metricValueClass}`}>{momentumScore}%</p>
                                <p className={`mt-3 text-sm ${heroSub}`}>
                                    {completedCount} quests cleared &bull; {focusCount} in focus lane &bull; {blockedCount} blocked
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                    <span className={`rounded-full px-3 py-1 font-semibold shadow-sm ${isDark ? heroChipClass : 'bg-gradient-to-r from-violet-100 to-fuchsia-100 text-violet-700 ring-1 ring-violet-200/70'}`}>
                                        {streakLength}-day streak
                                    </span>
                                    <span className={`rounded-full px-3 py-1 font-semibold shadow-sm ${isDark ? heroChipClass : 'bg-gradient-to-r from-cyan-100 to-blue-100 text-blue-700 ring-1 ring-cyan-200/70'}`}>
                                        Daily objective: {dailyObjective} quests
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="relative grid gap-4 sm:grid-cols-2">
                        {topStatCards.map((stat, index) => {
                            const Icon = stat.icon;
                            return (
                            <div
                                key={stat.label}
                                className={`${isColorful ? 'dashboard-colorful-stat-card ' : ''}relative overflow-hidden rounded-[22px] border ${statCardBase} px-4 py-5 transition duration-200 hover:-translate-y-0.5 animate-[dashboardSlide_0.6s_ease]`}
                                style={{
                                    animationDelay: `${index * 0.08}s`,
                                    ...(!isDark ? ({ '--dashboard-stat-bg': stat.accent } as React.CSSProperties) : {}),
                                }}
                            >
                                <div className={`pointer-events-none absolute inset-0 ${statOverlayClass} ${statOverlayOpacity}`} />
                                <div className="relative">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className={`text-xs uppercase tracking-[0.22em] ${statLabelClass}`}>{stat.label}</p>
                                        <span className={`grid h-9 w-9 place-items-center rounded-full ${statIconClass}`}>
                                            <Icon className="h-4 w-4" />
                                        </span>
                                    </div>
                                    <p className={`mt-2 text-2xl font-bold ${statAccent}`}>{stat.value}</p>
                                    <p className={`mt-2 text-xs ${heroMeta}`}>Keep momentum high to unlock bonus loot.</p>
                                </div>
                            </div>
                        );})}
                    </div>
                </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
                <div className={`${pipelineSurface} rounded-3xl border p-6 backdrop-blur`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Quest Pipeline</p>
                            <h2 className="mt-2 text-2xl font-semibold text-text-primary">Mission Control</h2>
                        </div>
                        <div className="flex gap-2 text-xs text-text-secondary">
                            <span>Total: {totalTasks}</span>
                            <span>&bull; Completed: {completedCount}</span>
                        </div>
                    </div>
                    {totalTasks === 0 ? (
                        <div className="mt-6 rounded-2xl border border-dashed border-border-color/70 p-6 text-center text-text-secondary">
                            No quests assigned yet. Grab a mission from the Kanban board!
                        </div>
                    ) : (
                        <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
                            {statusOrder
                                .filter((status) => tasksByStatus[status]?.length)
                                .map((status) => {
                                    const detail = getStatusDetails(status);
                                    const visual = dashboardStatusVisuals[status];
                                    const items = tasksByStatus[status];
                                    const progressValue = Math.min(100, Math.round((items.length / Math.max(1, totalTasks)) * 100));
                                    const laneGradientClass = (isLight || isColorful) && status === TaskStatus.IN_PROGRESS
                                        ? 'from-[#f3e8ff] via-[#fce7f3] to-[#ffe4e6]'
                                        : isLight || isColorful
                                            ? visual.gradient
                                            : detail.gradient;
                                    const laneGradientOpacity = isLight || isColorful ? 'opacity-95' : 'opacity-80';

                                    return (
                                        <div
                                            key={status}
                                            className={`relative overflow-hidden rounded-2xl border px-4 py-5 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-2xl ${isLight || isColorful ? `${visual.border} ${visual.glow}` : detail.glow}`}
                                        >
                                            {(isLight || isColorful) && (
                                                <span
                                                    className="pointer-events-none absolute inset-x-5 top-0 h-1 rounded-b-full"
                                                    style={{ backgroundColor: visual.accent }}
                                                />
                                            )}
                                            <div className={`pointer-events-none absolute inset-0 ${laneGradientOpacity}`}>
                                                <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${laneGradientClass}`} />
                                            </div>
                                            <div className="relative">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className={`text-xs uppercase tracking-[0.3em] ${laneEyebrowClass}`}>{detail.legend}</p>
                                                        <h3 className={`mt-1 text-lg font-semibold ${laneTextClass}`}>{detail.label}</h3>
                                                    </div>
                                                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${laneCountClass}`}>
                                                        {items.length} quest{items.length > 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className={`mt-4 h-2 w-full overflow-hidden rounded-full ${laneTrackClass}`}>
                                                    <div
                                                        className={laneFillClass}
                                                        style={{ width: `${progressValue}%` }}
                                                    />
                                                </div>
                                                <p className={`mt-3 text-xs ${laneMutedTextClass}`}>{progressValue}% of current load</p>
                                                <div className="mt-4 space-y-3">
                                                    {items.slice(0, 3).map((task) => (
                                                        <button
                                                            type="button"
                                                            key={task.id}
                                                            onClick={() => handleTaskClick(task.id)}
                                                            className={taskPreviewClass}
                                                        >
                                                            <div>
                                                                <p className={taskPreviewTitleClass}>
                                                                    {task.title}
                                                                </p>
                                                                <p className={taskPreviewDescriptionClass}>{task.description}</p>
                                                            </div>
                                                            <TaskPriorityBadge priority={task.priority} />
                                                        </button>
                                                    ))}
                                                    {items.length > 3 && (
                                                        <p className={`text-xs ${laneMutedTextClass}`}>+{items.length - 3} more quests in this lane</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className={`${questCardBase} rounded-3xl border p-6 backdrop-blur`}>
                        <h2 className="text-xl font-semibold text-text-primary">Focus Queue</h2>
                        <p className="text-sm text-text-secondary">These quests are closest to the loot timer.</p>
                        <div className="mt-4 space-y-4">
                            {focusQueueTasks.length === 0 ? (
                                <p className="text-sm text-text-secondary">No upcoming deadlines. Consider tackling backlog quests.</p>
                            ) : (
                                focusQueueTasks.map((task) => (
                                    <button
                                        type="button"
                                        key={task.id}
                                        onClick={() => handleTaskClick(task.id)}
                                        className={focusTaskClass}
                                        style={isLight || isColorful ? { background: dashboardStatusVisuals[task.status].focusTint } : undefined}
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-semibold text-text-primary group-hover:text-primary">{task.title}</p>
                                            <span className="text-xs text-text-secondary">
                                                {task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No due date'}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-xs text-text-secondary line-clamp-2">{task.description}</p>
                                        <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                                            <TaskStatusBadge status={task.status} />
                                            <span>&bull;</span>
                                            <TaskPriorityBadge priority={task.priority} />
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                </div>
            </section>

            {selectedTaskId && (
                <TaskDetailModal
                    taskId={selectedTaskId}
                    isOpen={Boolean(selectedTaskId)}
                    onClose={handleCloseModal}
                    usersMap={usersMap}
                    onTaskDeleted={handleTaskDeleted}
                />
            )}
        </div>
    );
};

export default Dashboard;







