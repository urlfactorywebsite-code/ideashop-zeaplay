import { TaskPriority } from '../types';

export type PointsField = 'base' | 'beforeDueBonus' | 'overduePenalty';

export interface PriorityPoints {
    base: number;
    beforeDueBonus: number;
    overduePenalty: number;
}

export type PointsConfig = Record<string, Record<TaskPriority, PriorityPoints>>;

const STORAGE_KEY = 'task-points-config';
const TASK_CREATION_POINTS_KEY = 'task-creation-points';
const CLARITY_POINTS_PER_STAR_KEY = 'task-clarity-points-per-star';
const MANAGER_OVERDUE_PENALTY_KEY = 'manager-overdue-penalty';

export const POINTS_CONFIG_UPDATED_EVENT = 'points-config-updated';

const DEFAULT_POINTS_CONFIG: PointsConfig = {
    'Data Team': {
        [TaskPriority.LOW]: { base: 10, beforeDueBonus: 5, overduePenalty: -5 },
        [TaskPriority.MEDIUM]: { base: 15, beforeDueBonus: 10, overduePenalty: -10 },
        [TaskPriority.HIGH]: { base: 25, beforeDueBonus: 15, overduePenalty: -15 },
        [TaskPriority.URGENT]: { base: 40, beforeDueBonus: 20, overduePenalty: -20 },
    },
    'Lead Generation': {
        [TaskPriority.LOW]: { base: 15, beforeDueBonus: 5, overduePenalty: -10 },
        [TaskPriority.MEDIUM]: { base: 25, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.HIGH]: { base: 40, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.URGENT]: { base: 60, beforeDueBonus: 20, overduePenalty: -25 },
    },
    'Marketing Team': {
        [TaskPriority.LOW]: { base: 15, beforeDueBonus: 5, overduePenalty: -10 },
        [TaskPriority.MEDIUM]: { base: 25, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.HIGH]: { base: 35, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.URGENT]: { base: 55, beforeDueBonus: 20, overduePenalty: -25 },
    },
    'IT Support': {
        [TaskPriority.LOW]: { base: 10, beforeDueBonus: 5, overduePenalty: -5 },
        [TaskPriority.MEDIUM]: { base: 20, beforeDueBonus: 10, overduePenalty: -10 },
        [TaskPriority.HIGH]: { base: 30, beforeDueBonus: 15, overduePenalty: -15 },
        [TaskPriority.URGENT]: { base: 50, beforeDueBonus: 20, overduePenalty: -20 },
    },
    'Sales Team': {
        [TaskPriority.LOW]: { base: 20, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.MEDIUM]: { base: 35, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.HIGH]: { base: 50, beforeDueBonus: 20, overduePenalty: -25 },
        [TaskPriority.URGENT]: { base: 70, beforeDueBonus: 25, overduePenalty: -30 },
    },
    Management: {
        [TaskPriority.LOW]: { base: 10, beforeDueBonus: 5, overduePenalty: -5 },
        [TaskPriority.MEDIUM]: { base: 20, beforeDueBonus: 10, overduePenalty: -10 },
        [TaskPriority.HIGH]: { base: 30, beforeDueBonus: 15, overduePenalty: -15 },
        [TaskPriority.URGENT]: { base: 45, beforeDueBonus: 20, overduePenalty: -20 },
    },
    'Finance Team': {
        [TaskPriority.LOW]: { base: 15, beforeDueBonus: 5, overduePenalty: -10 },
        [TaskPriority.MEDIUM]: { base: 25, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.HIGH]: { base: 40, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.URGENT]: { base: 55, beforeDueBonus: 20, overduePenalty: -25 },
    },
    'Hyper Automation': {
        [TaskPriority.LOW]: { base: 20, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.MEDIUM]: { base: 35, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.HIGH]: { base: 50, beforeDueBonus: 20, overduePenalty: -25 },
        [TaskPriority.URGENT]: { base: 75, beforeDueBonus: 25, overduePenalty: -30 },
    },
    ZeaCRM: {
        [TaskPriority.LOW]: { base: 20, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.MEDIUM]: { base: 35, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.HIGH]: { base: 55, beforeDueBonus: 20, overduePenalty: -25 },
        [TaskPriority.URGENT]: { base: 80, beforeDueBonus: 25, overduePenalty: -30 },
    },
    'URL Factory': {
        [TaskPriority.LOW]: { base: 25, beforeDueBonus: 10, overduePenalty: -20 },
        [TaskPriority.MEDIUM]: { base: 40, beforeDueBonus: 15, overduePenalty: -25 },
        [TaskPriority.HIGH]: { base: 60, beforeDueBonus: 20, overduePenalty: -30 },
        [TaskPriority.URGENT]: { base: 85, beforeDueBonus: 25, overduePenalty: -35 },
    },
    'Target Access Hub': {
        [TaskPriority.LOW]: { base: 15, beforeDueBonus: 5, overduePenalty: -10 },
        [TaskPriority.MEDIUM]: { base: 25, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.HIGH]: { base: 40, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.URGENT]: { base: 60, beforeDueBonus: 20, overduePenalty: -25 },
    },
    Client: {
        [TaskPriority.LOW]: { base: 10, beforeDueBonus: 5, overduePenalty: -10 },
        [TaskPriority.MEDIUM]: { base: 20, beforeDueBonus: 10, overduePenalty: -15 },
        [TaskPriority.HIGH]: { base: 35, beforeDueBonus: 15, overduePenalty: -20 },
        [TaskPriority.URGENT]: { base: 50, beforeDueBonus: 20, overduePenalty: -25 },
    },
    Other: {
        [TaskPriority.LOW]: { base: 10, beforeDueBonus: 5, overduePenalty: -5 },
        [TaskPriority.MEDIUM]: { base: 20, beforeDueBonus: 10, overduePenalty: -10 },
        [TaskPriority.HIGH]: { base: 30, beforeDueBonus: 15, overduePenalty: -15 },
        [TaskPriority.URGENT]: { base: 45, beforeDueBonus: 20, overduePenalty: -20 },
    },
};

export const DEFAULT_TASK_CREATION_POINTS = 10;
export const DEFAULT_CLARITY_POINTS_PER_STAR = 5;
export const DEFAULT_MANAGER_OVERDUE_PENALTY = 0;

const createEmptyDepartmentConfig = (): Record<TaskPriority, PriorityPoints> => ({
    [TaskPriority.LOW]: { base: 0, beforeDueBonus: 0, overduePenalty: 0 },
    [TaskPriority.MEDIUM]: { base: 0, beforeDueBonus: 0, overduePenalty: 0 },
    [TaskPriority.HIGH]: { base: 0, beforeDueBonus: 0, overduePenalty: 0 },
    [TaskPriority.URGENT]: { base: 0, beforeDueBonus: 0, overduePenalty: 0 },
});

const cloneDepartmentConfig = (priorities: Record<TaskPriority, PriorityPoints>): Record<TaskPriority, PriorityPoints> => ({
    [TaskPriority.LOW]: { ...priorities[TaskPriority.LOW] },
    [TaskPriority.MEDIUM]: { ...priorities[TaskPriority.MEDIUM] },
    [TaskPriority.HIGH]: { ...priorities[TaskPriority.HIGH] },
    [TaskPriority.URGENT]: { ...priorities[TaskPriority.URGENT] },
});

const resolveFallbackDepartmentConfig = (): Record<TaskPriority, PriorityPoints> => {
    if (DEFAULT_POINTS_CONFIG.Other) {
        return cloneDepartmentConfig(DEFAULT_POINTS_CONFIG.Other);
    }
    const [first] = Object.values(DEFAULT_POINTS_CONFIG);
    return first ? cloneDepartmentConfig(first) : createEmptyDepartmentConfig();
};

const cloneConfig = (config: PointsConfig): PointsConfig => {
    const result: PointsConfig = {} as PointsConfig;
    for (const [department, priorities] of Object.entries(config)) {
        result[department] = cloneDepartmentConfig(priorities);
    }
    return result;
};


const dispatchPointsConfigUpdated = (config?: PointsConfig): void => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    const resolvedConfig = config ?? loadPointsConfig();
    const detail = {
        config: cloneConfig(resolvedConfig),
        taskCreationPoints: loadTaskCreationPoints(),
        clarityPointsPerStar: loadClarityPointsPerStar(),
        managerOverduePenalty: loadManagerOverduePenalty(),
    };
    window.dispatchEvent(new CustomEvent(POINTS_CONFIG_UPDATED_EVENT, { detail }));
};

const normalizeNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const normalizeNonNegative = (value: unknown, fallback: number): number => {
    const normalized = normalizeNumber(value, fallback);
    return normalized < 0 ? 0 : normalized;
};

const normalizePenaltyValue = (value: unknown, fallback: number): number => {
    const normalized = normalizeNumber(value, fallback);
    if (!Number.isFinite(normalized)) {
        return fallback;
    }
    return normalized > 0 ? -Math.abs(normalized) : normalized;
};

const normalizePriorityPoints = (raw: unknown, defaults: PriorityPoints): PriorityPoints => {
    if (!raw || typeof raw !== 'object') {
        return { ...defaults };
    }

    const maybePoints = raw as Partial<Record<keyof PriorityPoints, unknown>>;
    return {
        base: normalizeNumber(maybePoints.base, defaults.base),
        beforeDueBonus: normalizeNumber(maybePoints.beforeDueBonus, defaults.beforeDueBonus),
        overduePenalty: normalizeNumber(maybePoints.overduePenalty, defaults.overduePenalty),
    };
};

const normalizeConfig = (raw: unknown): PointsConfig => {
    const result = cloneConfig(DEFAULT_POINTS_CONFIG);

    if (!raw || typeof raw !== 'object') {
        return result;
    }

    for (const [department, priorities] of Object.entries(raw as Record<string, unknown>)) {
        const defaults = result[department] ?? resolveFallbackDepartmentConfig();
        const priorityRecord =
            priorities && typeof priorities === 'object'
                ? (priorities as Partial<Record<TaskPriority, unknown>>)
                : {};
        result[department] = {
            [TaskPriority.LOW]: normalizePriorityPoints(priorityRecord[TaskPriority.LOW], defaults[TaskPriority.LOW]),
            [TaskPriority.MEDIUM]: normalizePriorityPoints(priorityRecord[TaskPriority.MEDIUM], defaults[TaskPriority.MEDIUM]),
            [TaskPriority.HIGH]: normalizePriorityPoints(priorityRecord[TaskPriority.HIGH], defaults[TaskPriority.HIGH]),
            [TaskPriority.URGENT]: normalizePriorityPoints(priorityRecord[TaskPriority.URGENT], defaults[TaskPriority.URGENT]),
        };
    }

    return result;
};

export const loadPointsConfig = (): PointsConfig => {
    if (typeof window === 'undefined') {
        return cloneConfig(DEFAULT_POINTS_CONFIG);
    }

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return cloneConfig(DEFAULT_POINTS_CONFIG);
        }
        const parsed = JSON.parse(stored);
        return normalizeConfig(parsed);
    } catch (error) {
        console.error('Failed to load points configuration from storage, using defaults.', error);
        return cloneConfig(DEFAULT_POINTS_CONFIG);
    }
};

export const savePointsConfig = (config: PointsConfig): void => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        dispatchPointsConfigUpdated(config);
    } catch (error) {
        console.error('Failed to persist points configuration.', error);
    }
};

export const resetPointsConfig = (): PointsConfig => {
    const defaults = cloneConfig(DEFAULT_POINTS_CONFIG);
    savePointsConfig(defaults);
    return defaults;
};

export const getDefaultPointsConfig = (): PointsConfig => cloneConfig(DEFAULT_POINTS_CONFIG);

export const getConfiguredDepartments = (config?: PointsConfig): string[] => {
    const defaults = Object.keys(DEFAULT_POINTS_CONFIG);
    if (!config) {
        return defaults;
    }
    const extras = Object.keys(config).filter((dept) => !defaults.includes(dept)).sort();
    return [...defaults, ...extras];
};

export const loadTaskCreationPoints = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_TASK_CREATION_POINTS;
    }
    try {
        const stored = window.localStorage.getItem(TASK_CREATION_POINTS_KEY);
        if (stored === null) {
            return DEFAULT_TASK_CREATION_POINTS;
        }
        return normalizeNonNegative(stored, DEFAULT_TASK_CREATION_POINTS);
    } catch (error) {
        console.error('Failed to load task creation points, using default.', error);
        return DEFAULT_TASK_CREATION_POINTS;
    }
};

export const saveTaskCreationPoints = (value: number): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(TASK_CREATION_POINTS_KEY, String(normalizeNonNegative(value, DEFAULT_TASK_CREATION_POINTS)));
        dispatchPointsConfigUpdated();
    } catch (error) {
        console.error('Failed to persist task creation points.', error);
    }
};

export const resetTaskCreationPoints = (): number => {
    saveTaskCreationPoints(DEFAULT_TASK_CREATION_POINTS);
    return DEFAULT_TASK_CREATION_POINTS;
};

export const loadClarityPointsPerStar = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_CLARITY_POINTS_PER_STAR;
    }
    try {
        const stored = window.localStorage.getItem(CLARITY_POINTS_PER_STAR_KEY);
        if (stored === null) {
            return DEFAULT_CLARITY_POINTS_PER_STAR;
        }
        return normalizeNonNegative(stored, DEFAULT_CLARITY_POINTS_PER_STAR);
    } catch (error) {
        console.error('Failed to load clarity points per star, using default.', error);
        return DEFAULT_CLARITY_POINTS_PER_STAR;
    }
};

export const saveClarityPointsPerStar = (value: number): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(CLARITY_POINTS_PER_STAR_KEY, String(normalizeNonNegative(value, DEFAULT_CLARITY_POINTS_PER_STAR)));
        dispatchPointsConfigUpdated();
    } catch (error) {
        console.error('Failed to persist clarity points per star.', error);
    }
};

export const resetClarityPointsPerStar = (): number => {
    saveClarityPointsPerStar(DEFAULT_CLARITY_POINTS_PER_STAR);
    return DEFAULT_CLARITY_POINTS_PER_STAR;
};

export const loadManagerOverduePenalty = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_MANAGER_OVERDUE_PENALTY;
    }
    try {
        const stored = window.localStorage.getItem(MANAGER_OVERDUE_PENALTY_KEY);
        if (stored === null) {
            return DEFAULT_MANAGER_OVERDUE_PENALTY;
        }
        return normalizePenaltyValue(stored, DEFAULT_MANAGER_OVERDUE_PENALTY);
    } catch (error) {
        console.error('Failed to load manager overdue penalty, using default.', error);
        return DEFAULT_MANAGER_OVERDUE_PENALTY;
    }
};

export const saveManagerOverduePenalty = (value: number): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(
            MANAGER_OVERDUE_PENALTY_KEY,
            String(normalizePenaltyValue(value, DEFAULT_MANAGER_OVERDUE_PENALTY)),
        );
        dispatchPointsConfigUpdated();
    } catch (error) {
        console.error('Failed to persist manager overdue penalty.', error);
    }
};

export const resetManagerOverduePenalty = (): number => {
    saveManagerOverduePenalty(DEFAULT_MANAGER_OVERDUE_PENALTY);
    return DEFAULT_MANAGER_OVERDUE_PENALTY;
};

export const priorityOrder: TaskPriority[] = [
    TaskPriority.LOW,
    TaskPriority.MEDIUM,
    TaskPriority.HIGH,
    TaskPriority.URGENT,
];
