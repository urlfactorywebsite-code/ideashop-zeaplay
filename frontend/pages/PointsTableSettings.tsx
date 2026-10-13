import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TaskPriority } from '../types';
import {
    getConfiguredDepartments,
    getDefaultPointsConfig,
    loadPointsConfig,
    savePointsConfig,
    resetPointsConfig,
    PointsConfig,
    PointsField,
    PriorityPoints,
    priorityOrder,
} from '../utils/pointsConfigStorage';
import {
    loadRoleScoreMatrix,
    resetRoleScoreMatrix,
    saveRoleScoreMatrix,
    Priority,
    Role,
    RoleScoreMatrix,
} from '../utils/taskScoreMatrix';
import api from '../services/mockApi';
import { ArrowRightIcon } from '../components/icons';
import GamifiedXPSimulator from '../components/GamifiedXPSimulator';

interface RowDescriptor {
    id: string;
    label: string;
    priority: TaskPriority;
    field: PointsField;
    tone: 'base' | 'bonus' | 'penalty';
}

const priorityLabels: Record<TaskPriority, string> = {
    [TaskPriority.LOW]: 'Low Priority',
    [TaskPriority.MEDIUM]: 'Medium Priority',
    [TaskPriority.HIGH]: 'High Priority',
    [TaskPriority.URGENT]: 'Urgent Priority',
};

const fieldFriendlyLabels: Record<PointsField, string> = {
    base: 'Base',
    beforeDueBonus: 'Before Due Bonus',
    overduePenalty: 'Overdue Penalty',
};

const rowDescriptors: RowDescriptor[] = priorityOrder.flatMap((priority) => ([
    {
        id: `${priority}-base`,
        label: priorityLabels[priority],
        priority,
        field: 'base',
        tone: 'base',
    },
    {
        id: `${priority}-bonus`,
        label: '➕ Before Due Date',
        priority,
        field: 'beforeDueBonus',
        tone: 'bonus',
    },
    {
        id: `${priority}-penalty`,
        label: '❌ Overdue Penalty',
        priority,
        field: 'overduePenalty',
        tone: 'penalty',
    },
]));

const taskCreatePriorities: Priority[] = ['low', 'medium', 'high', 'urgent'];
const taskCreatePriorityLabels: Record<Priority, string> = {
    low: 'Low Priority',
    medium: 'Medium Priority',
    high: 'High Priority',
    urgent: 'Urgent Priority',
};

const taskCreateFields = [
    { key: 'bonusByPriority', label: 'Bonus', tone: 'bonus' as const },
    { key: 'penaltyByPriority', label: 'Penalty', tone: 'penalty' as const },
];

const roleLabels: Record<Role, string> = {
    user: 'User',
    manager: 'Manager',
    admin: 'Admin',
    owner: 'Owner',
};

const createEmptyPriorityPoints = (): PriorityPoints => ({
    base: 0,
    beforeDueBonus: 0,
    overduePenalty: 0,
});

const createEmptyDepartmentConfig = (): Record<TaskPriority, PriorityPoints> => ({
    [TaskPriority.LOW]: createEmptyPriorityPoints(),
    [TaskPriority.MEDIUM]: createEmptyPriorityPoints(),
    [TaskPriority.HIGH]: createEmptyPriorityPoints(),
    [TaskPriority.URGENT]: createEmptyPriorityPoints(),
});

const cloneDepartmentConfig = (departmentConfig: Record<TaskPriority, PriorityPoints>): Record<TaskPriority, PriorityPoints> => ({
    [TaskPriority.LOW]: { ...departmentConfig[TaskPriority.LOW] },
    [TaskPriority.MEDIUM]: { ...departmentConfig[TaskPriority.MEDIUM] },
    [TaskPriority.HIGH]: { ...departmentConfig[TaskPriority.HIGH] },
    [TaskPriority.URGENT]: { ...departmentConfig[TaskPriority.URGENT] },
});

const resolveFallbackDepartmentConfig = (defaultConfig: PointsConfig): Record<TaskPriority, PriorityPoints> => {
    if (defaultConfig.Other) {
        return cloneDepartmentConfig(defaultConfig.Other);
    }
    const [first] = Object.values(defaultConfig);
    return first ? cloneDepartmentConfig(first) : createEmptyDepartmentConfig();
};

const clonePointsConfig = (config: PointsConfig): PointsConfig => {
    const copy: PointsConfig = {} as PointsConfig;
    for (const [department, departmentConfig] of Object.entries(config)) {
        copy[department] = cloneDepartmentConfig(departmentConfig);
    }
    return copy;
};

const normalizeDepartmentKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const coercePenalty = (value: number): number => (value > 0 ? -value : value);

interface BannerState {
    tone: 'success' | 'error' | 'info';
    text: string;
}

const PointsTableSettings: React.FC = () => {
    const [config, setConfig] = useState<PointsConfig>(() => loadPointsConfig());
    const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveBanner, setSaveBanner] = useState<BannerState | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const tableDragState = useRef({ active: false, startX: 0, scrollLeft: 0 });
    const [roleScoreMatrix, setRoleScoreMatrix] = useState<RoleScoreMatrix>(() => loadRoleScoreMatrix());
    const [taskCreateBanner, setTaskCreateBanner] = useState<BannerState | null>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [isDraggingTable, setIsDraggingTable] = useState(false);

    const defaultConfig = useMemo(() => getDefaultPointsConfig(), []);
    const fallbackDepartmentConfig = useMemo(() => resolveFallbackDepartmentConfig(defaultConfig), [defaultConfig]);
    const departments = useMemo(() => {
        if (availableDepartments.length > 0) {
            return availableDepartments;
        }
        return getConfiguredDepartments(config);
    }, [availableDepartments, config]);

    const taskCreateRoles = useMemo(() => Object.keys(roleScoreMatrix) as Role[], [roleScoreMatrix]);

    const updateScrollControls = useCallback(() => {
        const container = tableScrollRef.current;
        if (!container) {
            setCanScrollLeft(false);
            setCanScrollRight(false);
            return;
        }
        const { scrollLeft, scrollWidth, clientWidth } = container;
        setCanScrollLeft(scrollLeft > 0);
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    }, []);

    const scrollTableBy = useCallback((direction: 'left' | 'right') => {
        const container = tableScrollRef.current;
        if (!container) {
            return;
        }
        const amount = Math.max(220, Math.round(container.clientWidth * 0.75));
        const delta = direction === 'left' ? -amount : amount;
        container.scrollBy({ left: delta, behavior: 'smooth' });
    }, []);

    useEffect(() => {
        let isMounted = true;
        const loadDepartments = async () => {
            try {
                const deptData = await api.getDepartments();
                if (!isMounted) {
                    return;
                }
                const names = (deptData ?? [])
                    .map((dept) => dept.name)
                    .filter((name): name is string => Boolean(name));
                names.sort((a, b) => a.localeCompare(b));
                setAvailableDepartments(names);
            } catch (error) {
                console.error('Failed to load departments for points table', error);
            }
        };
        loadDepartments();
        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        const loadPointsConfigFromServer = async () => {
            try {
                const remote = await api.getPointsTableConfig();
                if (!isMounted || !remote) {
                    return;
                }
                if (remote.pointsConfig) {
                    savePointsConfig(remote.pointsConfig);
                    setConfig(loadPointsConfig());
                }
            } catch (error) {
                console.error('Failed to load points table config from server', error);
            }
        };
        loadPointsConfigFromServer();
        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const container = tableScrollRef.current;
        if (!container || typeof window === 'undefined') {
            return;
        }
        updateScrollControls();

        const handleScroll = () => updateScrollControls();
        container.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', updateScrollControls);

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(updateScrollControls);
            resizeObserver.observe(container);
        }

        return () => {
            container.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', updateScrollControls);
            resizeObserver?.disconnect();
        };
    }, [departments.length, updateScrollControls]);

    useEffect(() => {
        if (availableDepartments.length === 0) {
            return;
        }
        setConfig((previous) => {
            let changed = false;
            const next = { ...previous };
            const normalizedKeys = new Map<string, string>();
            Object.keys(next).forEach((key) => {
                const normalized = normalizeDepartmentKey(key);
                if (!normalizedKeys.has(normalized)) {
                    normalizedKeys.set(normalized, key);
                }
            });
            availableDepartments.forEach((department) => {
                const normalized = normalizeDepartmentKey(department);
                const existingKey = normalizedKeys.get(normalized);
                if (!existingKey) {
                    next[department] = cloneDepartmentConfig(fallbackDepartmentConfig);
                    normalizedKeys.set(normalized, department);
                    changed = true;
                    return;
                }
                if (existingKey !== department) {
                    if (!next[department]) {
                        next[department] = cloneDepartmentConfig(next[existingKey]);
                        changed = true;
                    }
                    delete next[existingKey];
                    normalizedKeys.set(normalized, department);
                    changed = true;
                }
            });
            return changed ? next : previous;
        });
    }, [availableDepartments, fallbackDepartmentConfig]);

    useEffect(() => {
        if (!saveBanner) {
            return;
        }
        const timer = window.setTimeout(() => setSaveBanner(null), 4000);
        return () => window.clearTimeout(timer);
    }, [saveBanner]);

    useEffect(() => {
        if (!taskCreateBanner) {
            return;
        }
        const timer = window.setTimeout(() => setTaskCreateBanner(null), 4000);
        return () => window.clearTimeout(timer);
    }, [taskCreateBanner]);

    const handleValueChange = (department: string, priority: TaskPriority, field: PointsField) => (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const numericValue = event.target.value === '' ? 0 : Number(event.target.value);
        if (Number.isNaN(numericValue)) {
            return;
        }
        const sanitized = field === 'overduePenalty' ? coercePenalty(numericValue) : numericValue;

        setConfig((previous) => {
            const next = { ...previous };
            const existingDepartment = previous[department];
            const sourceDepartment = existingDepartment
                ? cloneDepartmentConfig(existingDepartment)
                : defaultConfig[department]
                    ? cloneDepartmentConfig(defaultConfig[department])
                    : cloneDepartmentConfig(fallbackDepartmentConfig);

            const updatedPriority = { ...sourceDepartment[priority], [field]: sanitized };
            sourceDepartment[priority] = updatedPriority;
            next[department] = sourceDepartment;
            return next;
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await api.updatePointsTableConfig({
                pointsConfig: config,
            });
            savePointsConfig(config);
            setSaveBanner({ tone: 'success', text: 'Points table saved successfully.' });
        } catch (error) {
            console.error('Failed to save points configuration', error);
            savePointsConfig(config);
            setSaveBanner({ tone: 'error', text: 'Failed to sync points table. Changes were saved locally.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        const defaults = resetPointsConfig();
        setConfig(defaults);
        setSaveBanner({ tone: 'info', text: 'Reverted to default points. Remember to save if you want to keep this change.' });
    };

    const handleRoleValueChange = (role: Role, field: 'creationPoints' | 'ratingPerStar') => (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const numericValue = event.target.value === '' ? 0 : Number(event.target.value);
        if (Number.isNaN(numericValue)) {
            return;
        }
        setRoleScoreMatrix((previous) => {
            const next = { ...previous };
            const roleConfig = next[role];
            if (!roleConfig) {
                return previous;
            }
            next[role] = { ...roleConfig, [field]: numericValue };
            return next;
        });
    };

    const handleRolePriorityChange = (
        role: Role,
        priority: Priority,
        field: 'bonusByPriority' | 'penaltyByPriority',
    ) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const numericValue = event.target.value === '' ? 0 : Number(event.target.value);
        if (Number.isNaN(numericValue)) {
            return;
        }
        const sanitized = field === 'penaltyByPriority' && numericValue > 0 ? -Math.abs(numericValue) : numericValue;

        setRoleScoreMatrix((previous) => {
            const next = { ...previous };
            const roleConfig = next[role];
            if (!roleConfig) {
                return previous;
            }
            const updated = {
                ...roleConfig,
                [field]: { ...roleConfig[field], [priority]: sanitized },
            };
            next[role] = updated;
            return next;
        });
    };

    const handleOwnerPenaltyChange = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const numericValue = event.target.value === '' ? 0 : Number(event.target.value);
        if (Number.isNaN(numericValue)) {
            return;
        }
        const sanitized = numericValue > 0 ? -Math.abs(numericValue) : numericValue;
        setRoleScoreMatrix((previous) => {
            const ownerConfig = previous.owner;
            if (!ownerConfig) {
                return previous;
            }
            const penalties = [...(ownerConfig.ownerPenalties ?? [])];
            while (penalties.length < 5) {
                penalties.push(0);
            }
            penalties[index] = sanitized;
            return {
                ...previous,
                owner: { ...ownerConfig, ownerPenalties: penalties },
            };
        });
    };

    const handleSaveTaskCreateMatrix = () => {
        try {
            saveRoleScoreMatrix(roleScoreMatrix);
            setTaskCreateBanner({ tone: 'success', text: 'Task creation points saved locally.' });
        } catch (error) {
            console.error('Failed to save task creation matrix', error);
            setTaskCreateBanner({ tone: 'error', text: 'Failed to save task creation points.' });
        }
    };

    const handleResetTaskCreateMatrix = () => {
        const defaults = resetRoleScoreMatrix();
        setRoleScoreMatrix(defaults);
        setTaskCreateBanner({ tone: 'info', text: 'Task creation matrix reset to defaults.' });
    };

    const renderBanner = (banner: BannerState | null) => {
        if (!banner) {
            return null;
        }
        const tones: Record<typeof banner.tone, string> = {
            success: 'bg-emerald-500/10 border-emerald-500/50 text-emerald-200',
            error: 'bg-rose-500/10 border-rose-500/50 text-rose-200',
            info: 'bg-sky-500/10 border-sky-500/50 text-sky-200',
        };
        return (
            <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${tones[banner.tone]}`}>
                {banner.text}
            </div>
        );
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        return Boolean(target.closest('input, textarea, select, button, label'));
    };

    const handleTablePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) {
            return;
        }
        const container = tableScrollRef.current;
        if (!container) {
            return;
        }
        tableDragState.current = {
            active: true,
            startX: event.clientX,
            scrollLeft: container.scrollLeft,
        };
        container.setPointerCapture(event.pointerId);
        setIsDraggingTable(true);
    };

    const handleTablePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const container = tableScrollRef.current;
        if (!container || !tableDragState.current.active) {
            return;
        }
        const delta = event.clientX - tableDragState.current.startX;
        container.scrollLeft = tableDragState.current.scrollLeft - delta;
    };

    const endTableDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
        if (!tableDragState.current.active) {
            return;
        }
        tableDragState.current.active = false;
        setIsDraggingTable(false);
        const container = tableScrollRef.current;
        if (container && event) {
            try {
                container.releasePointerCapture(event.pointerId);
            } catch {
                // Ignore if pointer capture isn't active anymore.
            }
        }
    };

    return (
        <div className="space-y-8">
            <header className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-text-primary">Task Points Table</h1>
                <p className="text-text-secondary max-w-3xl">
                    Adjust the base points, early completion bonuses, and overdue penalties for each department and priority level.
                    Changes are stored locally until you save them. Only workspace owners can access this page.
                </p>
            </header>

            <section className="bg-surface border border-border-color rounded-xl shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-color px-6 py-3 text-xs text-text-secondary">
                    <span>Drag the table or use arrows to scroll horizontally.</span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => scrollTableBy('left')}
                            disabled={!canScrollLeft}
                            aria-label="Scroll table left"
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-border-color bg-background text-text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ArrowRightIcon className="h-4 w-4 rotate-180" />
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollTableBy('right')}
                            disabled={!canScrollRight}
                            aria-label="Scroll table right"
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-border-color bg-background text-text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ArrowRightIcon className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                <div
                    ref={tableScrollRef}
                    onPointerDown={handleTablePointerDown}
                    onPointerMove={handleTablePointerMove}
                    onPointerUp={endTableDrag}
                    onPointerLeave={endTableDrag}
                    onPointerCancel={endTableDrag}
                    className={`overflow-x-auto px-2 pb-3 ${isDraggingTable ? 'cursor-grabbing' : 'cursor-grab'} select-none`}
                >
                    <table className="min-w-max w-full divide-y divide-border-color">
                        <thead className="bg-gray-800/60">
                            <tr>
                                <th className="sticky left-0 z-20 bg-[color:var(--color-background)] px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary min-w-[200px] shadow-[4px_0_10px_rgba(0,0,0,0.25)]">
                                    Priority / Department
                                </th>
                                {departments.map((department) => (
                                    <th
                                        key={department}
                                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary min-w-[140px]"
                                    >
                                        {department}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-color">
                            {rowDescriptors.map((row) => {
                                const rowBgClass =
                                    row.tone === 'bonus'
                                        ? 'bg-emerald-500/5'
                                        : row.tone === 'penalty'
                                            ? 'bg-rose-500/5'
                                            : 'bg-surface';
                                const stickyToneClass =
                                    row.tone === 'bonus'
                                        ? 'border-l-4 border-emerald-400/60'
                                        : row.tone === 'penalty'
                                            ? 'border-l-4 border-rose-400/60'
                                            : 'border-l-4 border-transparent';
                                return (
                                <tr key={row.id} className={rowBgClass}>
                                    <th
                                        scope="row"
                                        className={`sticky left-0 z-10 bg-[color:var(--color-background)] px-6 py-4 text-sm font-semibold text-text-primary min-w-[200px] shadow-[4px_0_10px_rgba(0,0,0,0.2)] ${stickyToneClass}`}
                                    >
                                        {row.label}
                                    </th>
                                    {departments.map((department) => {
                                        const fallbackConfig = defaultConfig[department] ?? fallbackDepartmentConfig;
                                        const departmentConfig = config[department] ?? fallbackConfig;
                                        const priorityConfig = departmentConfig ? departmentConfig[row.priority] : undefined;
                                        const value = priorityConfig ? priorityConfig[row.field] : 0;

                                        return (
                                            <td key={`${department}-${row.id}`} className="px-6 py-3 min-w-[140px]">
                                                <input
                                                    type="number"
                                                    className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                    value={value}
                                                    onChange={handleValueChange(department, row.priority, row.field)}
                                                    step={1}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-color px-6 py-4">
                    <div className="flex gap-3">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary-dark disabled:opacity-60"
                        >
                            {isSaving ? 'Saving…' : 'Save Points'}
                        </button>
                        <button
                            onClick={handleReset}
                            className="rounded-lg border border-border-color px-4 py-2 text-sm font-semibold text-text-secondary hover:border-primary hover:text-primary"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                    <p className="text-xs text-text-secondary">
                        Tip: Penalties are stored as negative values. Positive numbers will be converted automatically.
                    </p>
                </div>
                {renderBanner(saveBanner)}
            </section>

            <section className="grid gap-4 rounded-xl border border-border-color bg-surface p-6 shadow-lg">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-text-primary">Task Creation Points Table</h2>
                    <p className="text-sm text-text-secondary">
                        Manage the config-driven matrix used for task creation scoring and the time bonus rule engine.
                    </p>
                </div>
                <div className="grid gap-4">
                    {taskCreateRoles.map((role) => {
                        const roleConfig = roleScoreMatrix[role];
                        if (!roleConfig) {
                            return null;
                        }
                        return (
                            <div key={role} className="rounded-xl border border-border-color bg-background/30 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h3 className="text-lg font-semibold text-text-primary">{roleLabels[role]}</h3>
                                    <span className="text-xs uppercase tracking-[0.3em] text-text-secondary">
                                        Role Settings
                                    </span>
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <label className="space-y-1 text-sm font-medium text-text-primary">
                                        Creation points
                                        <input
                                            type="number"
                                            className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                            value={roleConfig.creationPoints}
                                            onChange={handleRoleValueChange(role, 'creationPoints')}
                                        />
                                    </label>
                                    <label className="space-y-1 text-sm font-medium text-text-primary">
                                        Rating points per star
                                        <input
                                            type="number"
                                            className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                            value={roleConfig.ratingPerStar}
                                            onChange={handleRoleValueChange(role, 'ratingPerStar')}
                                        />
                                    </label>
                                </div>
                                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                    {taskCreateFields.map((field) => (
                                        <div key={field.key} className="rounded-lg border border-border-color/60 p-3">
                                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary">
                                                {field.label}
                                            </p>
                                            <div className="mt-3 grid gap-2">
                                                {taskCreatePriorities.map((priority) => (
                                                    <label key={`${role}-${field.key}-${priority}`} className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                                                        <span>{taskCreatePriorityLabels[priority]}</span>
                                                        <input
                                                            type="number"
                                                            className="w-24 rounded-lg border border-border-color bg-background px-2 py-1 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                            value={roleConfig[field.key][priority]}
                                                            onChange={handleRolePriorityChange(role, priority, field.key)}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {role === 'owner' && (
                                    <div className="mt-4 rounded-lg border border-border-color/60 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary">
                                            Owner Penalties (manual only)
                                        </p>
                                        <div className="mt-3 grid gap-2 md:grid-cols-5">
                                            {[0, 1, 2, 3, 4].map((index) => (
                                                <label key={`owner-penalty-${index}`} className="space-y-1 text-xs text-text-secondary">
                                                    Owner Penalty {index + 1}
                                                    <input
                                                        type="number"
                                                        className="w-full rounded-lg border border-border-color bg-background px-2 py-1 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                        value={roleConfig.ownerPenalties?.[index] ?? 0}
                                                        onChange={handleOwnerPenaltyChange(index)}
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-color pt-4">
                    <div className="flex gap-3">
                        <button
                            onClick={handleSaveTaskCreateMatrix}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary-dark"
                        >
                            Save Task Creation Points
                        </button>
                        <button
                            onClick={handleResetTaskCreateMatrix}
                            className="rounded-lg border border-border-color px-4 py-2 text-sm font-semibold text-text-secondary hover:border-primary hover:text-primary"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                    <p className="text-xs text-text-secondary">
                        Tip: Penalties are stored as negative values. Positive numbers will be converted automatically.
                    </p>
                </div>
                {renderBanner(taskCreateBanner)}
            </section>
            <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-border-color to-transparent" />

            <GamifiedXPSimulator />
        </div>
    );
};

export default PointsTableSettings;
