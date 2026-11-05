import { Role, Task, TaskPriority, TaskStatus, TaskPointsBreakdown, TaskPointsStatus, User } from '../types';
import {
    PointsConfig,
    PriorityPoints,
    getDefaultPointsConfig,
    loadPointsConfig,
    loadTaskCreationPoints,
    loadClarityPointsPerStar,
    loadManagerOverduePenalty,
} from './pointsConfigStorage';

const DEFAULT_CONFIG: PointsConfig = getDefaultPointsConfig();
const COMPLETED_STATUSES = new Set<TaskStatus>([TaskStatus.DONE, TaskStatus.DEPLOYED]);
const FAILED_STATUSES = new Set<TaskStatus>([TaskStatus.FAILED, TaskStatus.GRAVEYARD]);
const ZERO_PRIORITY_POINTS: PriorityPoints = { base: 0, beforeDueBonus: 0, overduePenalty: 0 };

export type TaskPointsTone = 'neutral' | 'positive' | 'negative' | 'warning';

export interface TaskPointsSummary {
    label: string;
    value: number;
    tone: TaskPointsTone;
    detail: string;
}

export interface UserTaskPointsSummary {
    total: number;
    taskPoints: number;
    creationPoints: number;
    clarityPoints: number;
    managerPenalty: number;
    taskSummary: TaskPointsSummary | null;
}

export const normalizeDepartmentKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const resolvePriorityPoints = (config: PointsConfig, department: string, priority: TaskPriority): PriorityPoints => {
    const fromConfig = config?.[department]?.[priority];
    if (fromConfig) {
        return { ...fromConfig };
    }

    const defaultForDepartment = DEFAULT_CONFIG?.[department]?.[priority];
    if (defaultForDepartment) {
        return { ...defaultForDepartment };
    }

    const defaultOther = DEFAULT_CONFIG?.Other?.[priority];
    if (defaultOther) {
        return { ...defaultOther };
    }

    return { ...ZERO_PRIORITY_POINTS };
};

const normalizePenalty = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value > 0) {
        return -Math.abs(value);
    }
    return value;
};

export const findDepartmentMatch = (
    config: PointsConfig,
    rawDepartment: string,
): { matched: string | null; isFallback: boolean } => {
    if (!rawDepartment) {
        const fallback = config?.Other ? 'Other' : Object.keys(config ?? {})[0] ?? null;
        return { matched: fallback, isFallback: true };
    }

    const normalizedTarget = normalizeDepartmentKey(rawDepartment);
    for (const department of Object.keys(config ?? {})) {
        if (normalizeDepartmentKey(department) === normalizedTarget) {
            return { matched: department, isFallback: false };
        }
    }

    if (config?.Other) {
        return { matched: 'Other', isFallback: true };
    }

    const firstDepartment = Object.keys(config ?? {})[0] ?? null;
    return { matched: firstDepartment, isFallback: true };
};

export interface TeamPriorityPointsResult {
    department: string;
    isFallback: boolean;
    points: PriorityPoints;
}

export const resolvePointsForTeamAndPriority = (
    team: string,
    priority: TaskPriority,
    config?: PointsConfig,
): TeamPriorityPointsResult => {
    const activeConfig = config && Object.keys(config).length > 0 ? config : DEFAULT_CONFIG;
    const { matched, isFallback } = findDepartmentMatch(activeConfig, team);
    const department = matched ?? 'Other';
    return {
        department,
        isFallback,
        points: resolvePriorityPoints(activeConfig, department, priority),
    };
};

export const calculateTaskPoints = (
    task: Task,
    config?: PointsConfig,
    now: Date = new Date(),
): TaskPointsBreakdown => {
    const activeConfig = config && Object.keys(config).length > 0 ? config : DEFAULT_CONFIG;
    const { matched, isFallback } = findDepartmentMatch(activeConfig, task.team);
    const department = matched ?? 'Other';
    const priorityPoints = resolvePriorityPoints(activeConfig, department, task.priority);

    const basePoints = priorityPoints.base ?? 0;
    const beforeDueBonus = priorityPoints.beforeDueBonus ?? 0;
    const overduePenalty = normalizePenalty(priorityPoints.overduePenalty ?? 0);

    const dueDate = task.dueAt ? new Date(task.dueAt) : null;
    const dueTime = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.getTime() : null;
    const hasDueDate = dueTime !== null;

    const completedDate = task.completedAt ? new Date(task.completedAt) : null;
    const completedTime = completedDate && !Number.isNaN(completedDate.getTime()) ? completedDate.getTime() : null;

    const nowTime = now.getTime();
    const isCompleted = COMPLETED_STATUSES.has(task.status);
    const isFailed = FAILED_STATUSES.has(task.status);

    let status: TaskPointsStatus = 'pending';
    const notes: string[] = [];
    let awardedBase = 0;
    let awardedBonus = 0;
    let awardedPenalty = 0;

    if (isFallback && department !== task.team) {
        notes.push(`Team '${task.team || 'Unassigned'}' uses '${department}' points configuration.`);
    }

    if (!activeConfig?.[department]) {
        notes.push(`Department '${department}' missing in active configuration. Using default values.`);
        status = 'unconfigured';
    }

    if (isFailed) {
        status = 'failed';
        notes.push('Task marked as failed; no points awarded.');
    } else if (isCompleted) {
        awardedBase = basePoints;
        if (hasDueDate && completedTime !== null && dueTime !== null) {
            if (completedTime <= dueTime) {
                if (beforeDueBonus !== 0) {
                    awardedBonus = beforeDueBonus;
                    status = 'completed-early';
                } else {
                    status = 'completed-on-time';
                }
            } else {
                if (overduePenalty !== 0) {
                    awardedPenalty = overduePenalty;
                }
                status = 'completed-late';
            }
        } else {
            status = 'completed-on-time';
            if (!hasDueDate && beforeDueBonus > 0) {
                notes.push('Early completion bonus unavailable because no due date is set.');
            }
        }
    } else if (hasDueDate && dueTime !== null && dueTime < nowTime) {
        status = 'pending-overdue';
        if (overduePenalty !== 0) {
            notes.push('Task is overdue; penalty applies only if completed late.');
        }
    } else if (status !== 'unconfigured') {
        if (beforeDueBonus > 0 && !hasDueDate) {
            notes.push('Set a due date to enable early completion bonus.');
        }
        status = 'pending';
    }

    const totalAwarded = awardedBase + awardedBonus + awardedPenalty;
    const potentialEarlyTotal = basePoints + (hasDueDate && beforeDueBonus > 0 ? beforeDueBonus : 0);
    const potentialLateTotal = basePoints + (overduePenalty !== 0 ? overduePenalty : 0);

    return {
        originalDepartment: task.team,
        matchedDepartment: department,
        priority: task.priority,
        basePoints,
        beforeDueBonus,
        overduePenalty,
        awardedBase,
        awardedBonus,
        awardedPenalty,
        totalAwarded,
        potentialEarlyTotal,
        potentialLateTotal,
        status,
        isCompleted,
        bonusEligible: hasDueDate && beforeDueBonus !== 0,
        hasDueDate,
        isBonusApplied: awardedBonus !== 0,
        isPenaltyApplied: awardedPenalty !== 0,
        notes,
        calculatedAt: now.toISOString(),
    };
};

export const augmentTaskWithPoints = (
    task: Task,
    options?: { config?: PointsConfig; now?: Date },
): Task => {
    const config = options?.config ?? loadPointsConfig();
    const timestamp = options?.now ?? new Date();
    const breakdown = calculateTaskPoints(task, config, timestamp);
    return { ...task, pointsBreakdown: breakdown };
};

export const augmentTasksWithPoints = (
    tasks: Task[],
    options?: { config?: PointsConfig; now?: Date },
): Task[] => tasks.map((task) => augmentTaskWithPoints(task, options));

export const summarizeTaskPoints = (breakdown: TaskPointsBreakdown): TaskPointsSummary => {
    const baseDetail = `Base ${formatPointsValue(breakdown.basePoints)}`;
    const bonusDetail = breakdown.bonusEligible
        ? `Bonus ${formatPointsValue(breakdown.beforeDueBonus)}${breakdown.hasDueDate ? '' : ' (set due date)'}`
        : breakdown.beforeDueBonus !== 0
            ? `Bonus ${formatPointsValue(breakdown.beforeDueBonus)}`
            : null;
    const penaltyDetail = breakdown.overduePenalty !== 0 ? `Penalty ${formatPointsValue(breakdown.overduePenalty)}` : null;

    const withDetail = (...parts: Array<string | null>) => parts.filter(Boolean).join(' / ');

    switch (breakdown.status) {
        case 'completed-early':
            return {
                label: 'Points earned',
                value: breakdown.totalAwarded,
                tone: 'positive',
                detail: withDetail(baseDetail, bonusDetail),
            };
        case 'completed-on-time':
            return {
                label: 'Points earned',
                value: breakdown.totalAwarded,
                tone: 'neutral',
                detail: withDetail(baseDetail, penaltyDetail),
            };
        case 'completed-late':
            return {
                label: 'Points earned (penalty applied)',
                value: breakdown.totalAwarded,
                tone: 'negative',
                detail: withDetail(baseDetail, penaltyDetail),
            };
        case 'pending-overdue':
            return {
                label: 'Potential late points',
                value: breakdown.potentialLateTotal,
                tone: 'negative',
                detail: withDetail(baseDetail, penaltyDetail),
            };
        case 'pending':
            return {
                label: breakdown.bonusEligible ? 'Potential (with bonus)' : 'Potential points',
                value: breakdown.bonusEligible ? breakdown.potentialEarlyTotal : breakdown.basePoints,
                tone: 'neutral',
                detail: withDetail(baseDetail, bonusDetail, penaltyDetail),
            };
        case 'failed':
            return {
                label: 'No points (failed)',
                value: 0,
                tone: 'negative',
                detail: 'Task marked as failed',
            };
        case 'unconfigured':
            return {
                label: 'Points unavailable',
                value: 0,
                tone: 'warning',
                detail: 'Department missing configuration',
            };
        default:
            return {
                label: 'Points',
                value: breakdown.totalAwarded,
                tone: 'neutral',
                detail: withDetail(baseDetail, bonusDetail, penaltyDetail),
            };
    }
};

export interface UserPointsOptions {
    config?: PointsConfig;
    now?: Date;
    user?: User;
    usersById?: Map<string, User>;
}

const resolveUserFromOptions = (userId: string, options?: UserPointsOptions): User | undefined => {
    if (options?.user && options.user.id === userId) {
        return options.user;
    }
    return options?.usersById?.get(userId);
};

const isManagerPenaltyApplicable = (
    task: Task,
    manager: User | undefined,
    breakdown: TaskPointsBreakdown,
): boolean => {
    if (!manager || manager.role !== Role.MANAGER) {
        return false;
    }
    if (task.createdBy !== manager.id) {
        return false;
    }
    const assignedTo = task.assignedTo ?? [];
    if (!assignedTo.some((assigneeId) => assigneeId && assigneeId !== manager.id)) {
        return false;
    }
    if (!manager.department) {
        return false;
    }
    if (normalizeDepartmentKey(manager.department) !== normalizeDepartmentKey(task.team || '')) {
        return false;
    }
    return breakdown.status === 'completed-late';
};

export const calculateUserPointsForTask = (
    task: Task,
    userId: string,
    options?: UserPointsOptions,
): UserTaskPointsSummary => {
    const config = options?.config ?? loadPointsConfig();
    const breakdown = task.pointsBreakdown ?? calculateTaskPoints(task, config, options?.now ?? new Date());
    const taskSummary = breakdown ? summarizeTaskPoints(breakdown) : null;
    const isAssignee = task.assignedTo?.includes(userId) ?? false;
    const isCreator = task.createdBy === userId;

    const taskPoints = isAssignee && breakdown.isCompleted ? breakdown.totalAwarded : 0;
    const creationPoints = isCreator ? loadTaskCreationPoints() : 0;
    const clarityPoints =
        isCreator && task.clarityRating !== null && task.clarityRating !== undefined
            ? task.clarityRating * loadClarityPointsPerStar()
            : 0;
    const manager = resolveUserFromOptions(userId, options);
    const managerPenalty = isManagerPenaltyApplicable(task, manager, breakdown)
        ? normalizePenalty(loadManagerOverduePenalty())
        : 0;

    return {
        total: taskPoints + creationPoints + clarityPoints + managerPenalty,
        taskPoints,
        creationPoints,
        clarityPoints,
        managerPenalty,
        taskSummary,
    };
};

export const calculateUserPointsFromTasks = (
    tasks: Task[],
    userId: string,
    options?: UserPointsOptions,
): number => {
    return tasks.reduce((sum, task) => sum + calculateUserPointsForTask(task, userId, options).total, 0);
};

export const formatPointsValue = (value: number): string => {
    if (!Number.isFinite(value)) {
        return '0';
    }
    if (value > 0) {
        return `+${value}`;
    }
    return value.toString();
};
