import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/mockApi';
import {
    Badge,
    BadgeCountType,
    BadgeEntity,
    BadgeEvent,
    BadgeRule,
    BadgeRuleSet,
    BadgeScope,
    BadgeState,
    BadgeTimeWindowUnit,
    Reward,
    Role,
    Task,
    User,
} from '../types';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { augmentTasksWithPoints, calculateUserPointsFromTasks } from '../utils/taskPoints';
import {
    LEVELS_CONFIG_UPDATED_EVENT,
    LevelConfig,
    getLevelProgress,
    loadLevelsConfig,
    resetLevelsConfig,
    saveLevelsConfig,
} from '../utils/levelsConfigStorage';
import { getUserAvatarUrl } from '../utils/userAvatar';
import { GiftIcon, PencilIcon, PlusIcon, RocketLaunchIcon, SparklesIcon, StarIcon, TrashIcon } from '../components/icons';
import PageLoader from '../components/loading/PageLoader';

type BadgeDraft = {
    name: string;
    description: string;
    tier: string;
    tierGroup: string;
    tierOrder: number;
    bonusXp: number;
    state: BadgeState;
    rules: BadgeRuleSet;
};

const BADGE_ENTITIES: BadgeEntity[] = ['task', 'ticket', 'subtask', 'comment', 'project', 'time', 'manual'];
const BADGE_EVENTS: BadgeEvent[] = [
    'created',
    'completed',
    'updated',
    'reopened',
    'deleted',
    'assigned',
    'priority_changed',
    'status_changed',
    'overdue',
];
const BADGE_PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const BADGE_SCOPE_OPTIONS: BadgeScope[] = ['any', 'self', 'team'];
const BADGE_COUNT_TYPES: BadgeCountType[] = ['>=', '==', '<='];
const BADGE_TIME_UNITS: BadgeTimeWindowUnit[] = ['minutes', 'hours', 'days', 'weeks', 'months'];
const BADGE_STATES: BadgeState[] = ['draft', 'active', 'archived'];

const createDefaultRule = (): BadgeRule => ({
    entity: 'task',
    event: 'completed',
    conditions: {},
    count: { type: '>=', value: 1 },
    timeWindow: null,
    negative: false,
});

const createDefaultRuleSet = (): BadgeRuleSet => ({
    operator: 'AND',
    rules: [createDefaultRule()],
});

const createDefaultBadgeDraft = (): BadgeDraft => ({
    name: '',
    description: '',
    tier: 'Bronze',
    tierGroup: '',
    tierOrder: 1,
    bonusXp: 0,
    state: 'draft',
    rules: createDefaultRuleSet(),
});

const sortBadges = (items: Badge[]): Badge[] => {
    return [...items].sort((a, b) => {
        const groupA = (a.tierGroup ?? '').toLowerCase();
        const groupB = (b.tierGroup ?? '').toLowerCase();
        if (groupA !== groupB) {
            return groupA.localeCompare(groupB);
        }
        if (a.tierOrder !== b.tierOrder) {
            return a.tierOrder - b.tierOrder;
        }
        return a.name.localeCompare(b.name);
    });
};

const LevelsManager: React.FC = () => {
    const { user: currentUser } = useAuth();
    const [levels, setLevels] = useState<LevelConfig[]>(() => loadLevelsConfig());
    const [users, setUsers] = useState<User[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [rewards, setRewards] = useState<Reward[]>([]);
    const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
    const [draftLevel, setDraftLevel] = useState<LevelConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [blastPreview, setBlastPreview] = useState(false);
    const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
    const [badges, setBadges] = useState<Badge[]>([]);
    const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
    const [badgeDraft, setBadgeDraft] = useState<BadgeDraft>(() => createDefaultBadgeDraft());
    const [badgeError, setBadgeError] = useState<string | null>(null);
    const [badgeSaving, setBadgeSaving] = useState(false);
    const [levelUsersOpen, setLevelUsersOpen] = useState(false);
    const [levelUsersView, setLevelUsersView] = useState<'list' | 'grid'>('grid');
    const [badgeImage, setBadgeImage] = useState<{
        file: File | null;
        url: string;
        preview: string;
        dirty: boolean;
    }>({
        file: null,
        url: '',
        preview: '',
        dirty: false,
    });

    const canEditLevels = Boolean(currentUser?.role === Role.OWNER);
    const canEditBadges = Boolean(currentUser?.role === Role.OWNER || currentUser?.role === Role.ADMIN);
    const canSeeAllUsers = Boolean(currentUser?.role === Role.OWNER || currentUser?.role === Role.ADMIN);
    const canSeeTeam = Boolean(currentUser?.role === Role.MANAGER);

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            let badgeLoadFailed = false;
            const [fetchedUsers, fetchedTasks, fetchedRewards, fetchedBadges] = await Promise.all([
                api.getUsers(),
                api.getTasks(),
                api.getRewards(),
                api.getBadges({ includeRules: true }).catch((err) => {
                    badgeLoadFailed = true;
                    console.warn('Failed to load badges:', err);
                    return [] as Badge[];
                }),
            ]);
            const config = loadPointsConfig();
            const augmentedTasks = augmentTasksWithPoints(fetchedTasks, { config });
            setUsers(fetchedUsers);
            setTasks(augmentedTasks);
            setRewards(fetchedRewards);
            setBadges(sortBadges(fetchedBadges));
            setError(null);
            setBadgeError(badgeLoadFailed ? 'Failed to load badges.' : null);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load levels data.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleLevelsUpdate = (event: Event) => {
            const detail = (event as CustomEvent).detail as { levels?: LevelConfig[] } | undefined;
            if (detail?.levels) {
                setLevels(detail.levels);
            } else {
                setLevels(loadLevelsConfig());
            }
        };

        const handlePointsConfigChange = () => {
            setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
        };

        window.addEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsUpdate);
        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsUpdate);
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    const visibleUsers = useMemo(() => {
        if (!currentUser) {
            return [];
        }
        if (canSeeAllUsers) {
            return users;
        }
        if (canSeeTeam) {
            return users.filter((user) => user.department && user.department === currentUser.department);
        }
        return users.filter((user) => user.id === currentUser.id);
    }, [canSeeAllUsers, canSeeTeam, currentUser, users]);

    const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

    const userPointsMap = useMemo(() => {
        const map = new Map<string, number>();
        users.forEach((user) => {
            map.set(user.id, calculateUserPointsFromTasks(tasks, user.id, { usersById }));
        });
        return map;
    }, [tasks, users, usersById]);

    const currentUserPoints = currentUser ? userPointsMap.get(currentUser.id) ?? 0 : 0;
    const currentUserProgress = useMemo(
        () => getLevelProgress(currentUserPoints, levels),
        [currentUserPoints, levels],
    );

    const usersByLevel = useMemo(() => {
        const bucket = new Map<number, User[]>();
        visibleUsers.forEach((user) => {
            const points = userPointsMap.get(user.id) ?? 0;
            const progress = getLevelProgress(points, levels);
            const list = bucket.get(progress.level) ?? [];
            list.push(user);
            bucket.set(progress.level, list);
        });
        return bucket;
    }, [levels, userPointsMap, visibleUsers]);

    const selectedLevel = useMemo(
        () => levels.find((level) => level.id === selectedLevelId) ?? null,
        [levels, selectedLevelId],
    );
    const selectedBadge = useMemo(
        () => badges.find((badge) => badge.id === selectedBadgeId) ?? null,
        [badges, selectedBadgeId],
    );
    const sortedBadges = useMemo(() => sortBadges(badges), [badges]);
    const selectedLevelUsers = useMemo(
        () => (selectedLevel ? usersByLevel.get(selectedLevel.level) ?? [] : []),
        [selectedLevel, usersByLevel],
    );

    useEffect(() => {
        if (selectedLevel) {
            setDraftLevel({ ...selectedLevel, reward: selectedLevel.reward ? { ...selectedLevel.reward } : undefined });
        }
    }, [selectedLevel]);

    useEffect(() => {
        if (!selectedBadge) {
            setBadgeDraft(createDefaultBadgeDraft());
            setBadgeImage({ file: null, url: '', preview: '', dirty: false });
            return;
        }
        setBadgeDraft({
            name: selectedBadge.name,
            description: selectedBadge.description,
            tier: selectedBadge.tier,
            tierGroup: selectedBadge.tierGroup ?? '',
            tierOrder: selectedBadge.tierOrder,
            bonusXp: selectedBadge.bonusXp,
            state: selectedBadge.state,
            rules: selectedBadge.rules ?? createDefaultRuleSet(),
        });
        setBadgeImage({
            file: null,
            url: selectedBadge.imageUrl ?? '',
            preview: selectedBadge.imageUrl ?? '',
            dirty: false,
        });
    }, [selectedBadge]);

    useEffect(() => {
        if (!selectedBadgeId) {
            return;
        }
        if (!badges.some((badge) => badge.id === selectedBadgeId)) {
            setSelectedBadgeId(null);
        }
    }, [badges, selectedBadgeId]);

    useEffect(() => {
        if (!selectedLevelId && levels.length > 0) {
            const fallbackIndex = Math.min(Math.max(currentUserProgress.level - 1, 0), levels.length - 1);
            setSelectedLevelId(levels[fallbackIndex].id);
        }
    }, [currentUserProgress.level, levels, selectedLevelId]);

    useEffect(() => {
        if (!blastPreview) {
            return;
        }
        const timer = window.setTimeout(() => setBlastPreview(false), 1800);
        return () => window.clearTimeout(timer);
    }, [blastPreview]);

    useEffect(() => {
        if (!clipboardNotice) {
            return;
        }
        const timer = window.setTimeout(() => setClipboardNotice(null), 2400);
        return () => window.clearTimeout(timer);
    }, [clipboardNotice]);

    const handleSelectLevel = (levelId: string) => {
        setSelectedLevelId(levelId);
        setLevelUsersOpen(true);
    };

    const handleAddLevel = () => {
        const lastLevel = levels[levels.length - 1];
        const nextLevelNumber = levels.length + 1;
        const nextPoints = (lastLevel?.pointsRequired ?? 0) + 750;
        const newLevel: LevelConfig = {
            id: `level-${Date.now()}`,
            level: nextLevelNumber,
            title: `Level ${nextLevelNumber}`,
            pointsRequired: nextPoints,
            reward: undefined,
            accent: lastLevel?.accent,
        };
        const nextLevels = [...levels, newLevel];
        saveLevelsConfig(nextLevels);
        setLevels(loadLevelsConfig());
        setSelectedLevelId(newLevel.id);
    };

    const handleDeleteLevel = () => {
        if (!selectedLevel || levels.length <= 1 || selectedLevel.level !== levels.length) {
            return;
        }
        const nextLevels = levels.filter((level) => level.id !== selectedLevel.id);
        saveLevelsConfig(nextLevels);
        const normalized = loadLevelsConfig();
        setLevels(normalized);
        setSelectedLevelId(normalized[normalized.length - 1]?.id ?? null);
    };

    const handleSaveLevel = () => {
        if (!draftLevel) {
            return;
        }
        const nextLevels = levels.map((level) => (level.id === draftLevel.id ? draftLevel : level));
        saveLevelsConfig(nextLevels);
        setLevels(loadLevelsConfig());
    };

    const handleResetLevels = () => {
        const defaults = resetLevelsConfig();
        setLevels(defaults);
        setSelectedLevelId(defaults[0]?.id ?? null);
    };

    const handleRewardSelect = (rewardId: string) => {
        if (!draftLevel) {
            return;
        }
        const reward = rewards.find((item) => item.id === rewardId);
        if (!reward) {
            setDraftLevel({ ...draftLevel, reward: undefined });
            return;
        }
        setDraftLevel({
            ...draftLevel,
            reward: {
                title: reward.title,
                description: reward.description,
                rewardId: reward.id,
            },
        });
    };

    const handleCopyAnnouncement = async () => {
        if (!selectedLevel) {
            return;
        }
        const rewardTitle = selectedLevel.reward?.title ? ` Reward: ${selectedLevel.reward.title}.` : '';
        const message = `Level ${selectedLevel.level} unlocked: ${selectedLevel.title}.${rewardTitle}`;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(message);
            setClipboardNotice('Announcement copied.');
        } else {
            setClipboardNotice('Clipboard not available.');
        }
    };

    const refreshBadges = useCallback(
        async (focusId?: string | null) => {
            try {
                const fetchedBadges = await api.getBadges({ includeRules: true });
                setBadges(sortBadges(fetchedBadges));
                if (typeof focusId !== 'undefined') {
                    setSelectedBadgeId(focusId);
                }
                setBadgeError(null);
            } catch (err) {
                console.warn('Failed to refresh badges:', err);
                setBadgeError('Failed to refresh badges.');
            }
        },
        [],
    );

    const handleBadgeImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            setBadgeImage({ file, url: '', preview: result, dirty: true });
        };
        reader.readAsDataURL(file);
    };

    const handleBadgeImageUrlChange = (value: string) => {
        setBadgeImage({ file: null, url: value, preview: value, dirty: true });
    };

    const handleBadgeImageClear = () => {
        setBadgeImage({ file: null, url: '', preview: '', dirty: true });
    };

    const handleBadgeSelect = (badgeId: string) => {
        setSelectedBadgeId(badgeId);
        setBadgeError(null);
    };

    const handleNewBadge = () => {
        setSelectedBadgeId(null);
        setBadgeDraft(createDefaultBadgeDraft());
        setBadgeImage({ file: null, url: '', preview: '', dirty: false });
        setBadgeError(null);
    };

    const updateRule = useCallback((index: number, updater: (rule: BadgeRule) => BadgeRule) => {
        setBadgeDraft((prev) => {
            const nextRules = prev.rules.rules.map((rule, idx) => (idx === index ? updater(rule) : rule));
            return { ...prev, rules: { ...prev.rules, rules: nextRules } };
        });
    }, []);

    const handleRuleAdd = () => {
        setBadgeDraft((prev) => ({
            ...prev,
            rules: { ...prev.rules, rules: [...prev.rules.rules, createDefaultRule()] },
        }));
    };

    const handleRuleRemove = (index: number) => {
        setBadgeDraft((prev) => {
            const nextRules = prev.rules.rules.filter((_, idx) => idx !== index);
            return {
                ...prev,
                rules: { ...prev.rules, rules: nextRules.length ? nextRules : [createDefaultRule()] },
            };
        });
    };

    const handleBadgeSave = async () => {
        if (!canEditBadges) {
            return;
        }
        const name = badgeDraft.name.trim();
        const description = badgeDraft.description.trim();
        const tier = badgeDraft.tier.trim();
        if (!name || !description || !tier) {
            setBadgeError('Provide a badge name, description, and tier.');
            return;
        }
        if (!badgeDraft.rules.rules.length) {
            setBadgeError('Add at least one rule to the badge ruleset.');
            return;
        }
        if (badgeDraft.rules.rules.some((rule) => !rule.count?.value || rule.count.value <= 0)) {
            setBadgeError('Each rule needs a count target greater than zero.');
            return;
        }
        setBadgeSaving(true);
        try {
            const payload = {
                name,
                description,
                tier,
                tierGroup: badgeDraft.tierGroup.trim() || null,
                tierOrder: Math.max(1, badgeDraft.tierOrder || 1),
                bonusXp: Math.max(0, badgeDraft.bonusXp || 0),
                state: badgeDraft.state,
                rules: badgeDraft.rules,
            };
            const savedBadge = selectedBadgeId
                ? await api.updateBadge(selectedBadgeId, payload)
                : await api.createBadge(payload);
            const trimmedImageUrl = badgeImage.url.trim();
            if (badgeImage.dirty && (badgeImage.file || trimmedImageUrl)) {
                await api.uploadBadgeImage(savedBadge.id, {
                    file: badgeImage.file ?? undefined,
                    imageUrl: trimmedImageUrl || undefined,
                });
            }
            await refreshBadges(savedBadge.id);
            setBadgeError(null);
            setBadgeImage((prev) => ({ ...prev, dirty: false }));
        } catch (err) {
            console.error('Failed to save badge:', err);
            setBadgeError('Failed to save badge. Try again.');
        } finally {
            setBadgeSaving(false);
        }
    };

    const handleBadgeDelete = async () => {
        if (!canEditBadges || !selectedBadgeId) {
            return;
        }
        try {
            await api.deleteBadge(selectedBadgeId);
            await refreshBadges(null);
            handleNewBadge();
        } catch (err) {
            console.error('Failed to delete badge:', err);
            setBadgeError('Failed to delete badge. Try again.');
        }
    };

    const badgeStateClass = (state: BadgeState) => {
        if (state === 'active') {
            return 'border-emerald-300/40 bg-emerald-500/15 text-emerald-200';
        }
        if (state === 'archived') {
            return 'border-rose-300/40 bg-rose-500/15 text-rose-200';
        }
        return 'border-amber-300/40 bg-amber-500/15 text-amber-200';
    };

    const getAvatar = (user: User): string | null => getUserAvatarUrl(user);
    const canSaveBadge = Boolean(badgeDraft.name.trim() && badgeDraft.description.trim() && badgeDraft.tier.trim());
    const badgePreview = badgeImage.preview || selectedBadge?.imageUrl || '';
    const badgeModeLabel = selectedBadge ? 'Edit badge' : 'Create badge';

    if (isLoading) {
        return <PageLoader />;
    }

    return (
        <div className="space-y-8">
            <style>{`
                @keyframes levelBlast {
                    0% { transform: scale(0.7); opacity: 0; }
                    40% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1.6); opacity: 0; }
                }
                @keyframes levelPulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.08); }
                    100% { transform: scale(1); }
                }
            `}</style>

            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-text-secondary">
                        <StarIcon className="h-4 w-4 text-amber-400" />
                        Levels Manager
                    </div>
                    <h1 className="mt-2 text-3xl font-bold text-text-primary">Questline Levels</h1>
                    <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                        Tune each level threshold, attach rewards, and track squad progression on a gamified map.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {canEditLevels && (
                        <>
                            <button
                                type="button"
                                onClick={handleAddLevel}
                                className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/20 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/30"
                            >
                                <PlusIcon className="h-4 w-4" />
                                Add Level
                            </button>
                            <button
                                type="button"
                                onClick={handleResetLevels}
                                className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20"
                            >
                                Reset Map
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setBlastPreview(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-sky-300/50 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-400/20"
                    >
                        <RocketLaunchIcon className="h-4 w-4" />
                        Preview Blast
                    </button>
                </div>
            </header>

            {error && (
                <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                </div>
            )}

            {clipboardNotice && (
                <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {clipboardNotice}
                </div>
            )}

            <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0f172a] via-[#1e1b4b] to-[#312e81] p-6 shadow-[0_30px_70px_rgba(15,23,42,0.45)]">
                        <div
                            className="pointer-events-none absolute inset-0 opacity-50"
                            style={{
                                backgroundImage:
                                    'radial-gradient(circle at 20% 20%, rgba(148,163,184,0.15), transparent 40%), radial-gradient(circle at 80% 30%, rgba(56,189,248,0.15), transparent 45%), radial-gradient(circle at 30% 80%, rgba(244,114,182,0.15), transparent 45%)',
                            }}
                        />
                        <div className="relative">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.35em] text-white/60">
                                <span>Mission Map</span>
                                <span>
                                    Viewing:{' '}
                                    {canSeeAllUsers ? 'All squads' : canSeeTeam ? 'Your department' : 'Personal'}
                                </span>
                            </div>
                            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                                {levels.map((level) => {
                                    const usersAtLevel = usersByLevel.get(level.level) ?? [];
                                    const isSelected = level.id === selectedLevelId;
                                    const hasReward = Boolean(level.reward?.title);
                                    return (
                                        <button
                                            key={level.id}
                                            type="button"
                                            onClick={() => handleSelectLevel(level.id)}
                                            className={`group relative rounded-2xl border px-4 py-4 text-left transition ${
                                                isSelected
                                                    ? 'border-amber-300/70 bg-amber-400/10 shadow-[0_0_25px_rgba(251,191,36,0.35)]'
                                                    : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                                            }`}
                                        >
                                            <div
                                                className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${
                                                    level.accent ?? 'from-indigo-500/40 via-sky-500/30 to-fuchsia-500/40'
                                                } text-white shadow-[0_10px_30px_rgba(15,23,42,0.6)] ${
                                                    level.level === currentUserProgress.level ? 'animate-[levelPulse_2.4s_ease-in-out_infinite]' : ''
                                                }`}
                                            >
                                                <span className="text-xl font-extrabold">Lv {level.level}</span>
                                            </div>
                                            <div className="mt-3">
                                                <p className="text-sm font-semibold text-white">{level.title}</p>
                                                <p className="text-xs text-white/60">{level.pointsRequired.toLocaleString()} XP</p>
                                            </div>
                                            {hasReward && (
                                                <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                                                    <GiftIcon className="h-3 w-3" />
                                                    Reward
                                                </div>
                                            )}
                                            {usersAtLevel.length > 0 && (
                                                <div className="mt-3 flex items-center gap-2">
                                                    <div className="flex -space-x-2">
                                                        {usersAtLevel.slice(0, 3).map((user) => {
                                                            const avatar = getAvatar(user);
                                                            return (
                                                                <div
                                                                    key={user.id}
                                                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-900 bg-slate-800 text-xs font-semibold text-white"
                                                                >
                                                                    {avatar ? (
                                                                        <img src={avatar} alt={user.name} className="h-full w-full rounded-full object-cover" />
                                                                    ) : (
                                                                        user.name.slice(0, 2).toUpperCase()
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {usersAtLevel.length > 3 && (
                                                        <span className="text-xs text-white/60">+{usersAtLevel.length - 3}</span>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {blastPreview && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <div className="h-64 w-64 rounded-full border border-amber-200/50 bg-amber-200/20 shadow-[0_0_60px_rgba(251,191,36,0.45)] animate-[levelBlast_1.6s_ease-out_forwards]" />
                            </div>
                        )}
                    </div>
                </div>

                <aside className="space-y-5">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-[0_20px_40px_rgba(15,23,42,0.4)]">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Your Level</p>
                                <p className="mt-2 text-3xl font-bold text-white">Lv {currentUserProgress.level}</p>
                            </div>
                            <SparklesIcon className="h-10 w-10 text-amber-300" />
                        </div>
                        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-rose-400 to-purple-500"
                                style={{ width: `${currentUserProgress.progressPercent}%` }}
                            />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-white/60">
                            <span>
                                {currentUserProgress.pointsIntoLevel.toLocaleString()} / {currentUserProgress.levelSpan.toLocaleString()} XP
                            </span>
                            {currentUserProgress.nextLevel ? (
                                <span>{currentUserProgress.pointsToNextLevel.toLocaleString()} XP to Lv {currentUserProgress.nextLevel.level}</span>
                            ) : (
                                <span>Max level reached</span>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
                        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Next Reward</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                            {currentUserProgress.nextLevel?.reward?.title ?? 'Keep climbing for the next drop'}
                        </p>
                        <p className="mt-1 text-sm text-white/60">
                            {currentUserProgress.nextLevel?.reward?.description ??
                                'Attach rewards to levels so the squad knows what is next.'}
                        </p>
                    </div>

                    {selectedLevel && (
                        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">Selected Level</p>
                                    <p className="mt-2 text-lg font-semibold text-white">
                                        Lv {selectedLevel.level} - {selectedLevel.title}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopyAnnouncement}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 transition hover:border-white/40"
                                >
                                    <SparklesIcon className="h-3 w-3" />
                                    Copy announcement
                                </button>
                            </div>
                            <p className="mt-2 text-sm text-white/60">
                                Unlock at {selectedLevel.pointsRequired.toLocaleString()} XP
                            </p>
                            {selectedLevel.reward?.title && (
                                <div className="mt-3 rounded-xl border border-emerald-300/40 bg-emerald-400/10 p-3 text-xs text-emerald-100">
                                    Reward: {selectedLevel.reward.title}
                                    {selectedLevel.reward.description ? ` - ${selectedLevel.reward.description}` : ''}
                                </div>
                            )}
                        </div>
                    )}

                    {canEditLevels && selectedLevel && draftLevel && (
                        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                            <div className="flex items-center justify-between">
                                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Edit Level</p>
                                <PencilIcon className="h-4 w-4 text-white/70" />
                            </div>
                            <div className="mt-4 space-y-4 text-sm text-white/80">
                                <label className="block">
                                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">Title</span>
                                    <input
                                        value={draftLevel.title}
                                        onChange={(event) => setDraftLevel({ ...draftLevel, title: event.target.value })}
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">Points Required</span>
                                    <input
                                        type="number"
                                        value={draftLevel.pointsRequired}
                                        onChange={(event) =>
                                            setDraftLevel({
                                                ...draftLevel,
                                                pointsRequired: Number(event.target.value),
                                            })
                                        }
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">Reward Library</span>
                                    <select
                                        value={draftLevel.reward?.rewardId ?? ''}
                                        onChange={(event) => handleRewardSelect(event.target.value)}
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none"
                                    >
                                        <option value="">No reward</option>
                                        {rewards.map((reward) => (
                                            <option key={reward.id} value={reward.id}>
                                                {reward.title}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">Reward Title</span>
                                    <input
                                        value={draftLevel.reward?.title ?? ''}
                                        onChange={(event) =>
                                            setDraftLevel({
                                                ...draftLevel,
                                                reward: event.target.value
                                                    ? {
                                                          title: event.target.value,
                                                          description: draftLevel.reward?.description,
                                                          rewardId: draftLevel.reward?.rewardId,
                                                      }
                                                    : undefined,
                                            })
                                        }
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs uppercase tracking-[0.2em] text-white/50">Reward Description</span>
                                    <textarea
                                        rows={3}
                                        value={draftLevel.reward?.description ?? ''}
                                        onChange={(event) =>
                                            setDraftLevel({
                                                ...draftLevel,
                                                reward: draftLevel.reward
                                                    ? { ...draftLevel.reward, description: event.target.value }
                                                    : { title: '', description: event.target.value },
                                            })
                                        }
                                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none"
                                    />
                                </label>
                            </div>
                            <div className="mt-5 flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={handleSaveLevel}
                                    className="inline-flex items-center gap-2 rounded-full border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-100 transition hover:bg-emerald-500/30"
                                >
                                    Save Level
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteLevel}
                                    disabled={levels.length <= 1 || selectedLevel.level !== levels.length}
                                    className="inline-flex items-center gap-2 rounded-full border border-rose-300/50 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-40"
                                >
                                    <TrashIcon className="h-4 w-4" />
                                    Remove last level
                                </button>
                            </div>
                        </div>
                    )}
                </aside>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
                <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.35em] text-white/60">Badge studio</p>
                            <h2 className="mt-2 text-2xl font-bold text-white">{badgeModeLabel}</h2>
                            <p className="mt-2 text-sm text-white/60">
                                Define badge metadata, tier sequencing, artwork, and advanced rules.
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-amber-200">
                                <SparklesIcon className="h-6 w-6" />
                            </div>
                            {selectedBadge && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.25em] ${badgeStateClass(selectedBadge.state)}`}>
                                        {selectedBadge.state}
                                    </span>
                                    {selectedBadge.isSystem && (
                                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-white/70">
                                            System
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {badgeError && (
                        <div className="mt-4 rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                            {badgeError}
                        </div>
                    )}

                    <div className="mt-5 grid gap-4 text-sm text-white/80">
                        <label className="block">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Badge name</span>
                            <input
                                value={badgeDraft.name}
                                onChange={(event) => {
                                    setBadgeDraft((prev) => ({ ...prev, name: event.target.value }));
                                    setBadgeError(null);
                                }}
                                disabled={!canEditBadges}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                placeholder="Ex: Sprint Ace"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Description</span>
                            <textarea
                                rows={3}
                                value={badgeDraft.description}
                                onChange={(event) => {
                                    setBadgeDraft((prev) => ({ ...prev, description: event.target.value }));
                                    setBadgeError(null);
                                }}
                                disabled={!canEditBadges}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                placeholder="Ex: Complete 5 tasks in 3 days."
                            />
                        </label>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Bonus XP</span>
                                <input
                                    type="number"
                                    min={0}
                                    value={badgeDraft.bonusXp}
                                    onChange={(event) => {
                                        setBadgeDraft((prev) => ({ ...prev, bonusXp: Number(event.target.value) }));
                                        setBadgeError(null);
                                    }}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                    placeholder="100"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">State</span>
                                <select
                                    value={badgeDraft.state}
                                    onChange={(event) => setBadgeDraft((prev) => ({ ...prev, state: event.target.value as BadgeState }))}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                >
                                    {BADGE_STATES.map((state) => (
                                        <option key={state} value={state}>
                                            {state}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="grid gap-4 md:grid-cols-3">
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Tier</span>
                                <input
                                    value={badgeDraft.tier}
                                    onChange={(event) => setBadgeDraft((prev) => ({ ...prev, tier: event.target.value }))}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                    placeholder="Bronze"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Tier group</span>
                                <input
                                    value={badgeDraft.tierGroup}
                                    onChange={(event) => setBadgeDraft((prev) => ({ ...prev, tierGroup: event.target.value }))}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                    placeholder="Velocity"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Tier order</span>
                                <input
                                    type="number"
                                    min={1}
                                    value={badgeDraft.tierOrder}
                                    onChange={(event) => setBadgeDraft((prev) => ({ ...prev, tierOrder: Number(event.target.value) }))}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                    placeholder="1"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-white/60">Badge artwork</p>
                                <p className="mt-2 text-sm text-white/60">Upload a PNG or drop a hosted URL.</p>
                            </div>
                            <span className="text-xs text-white/50">Saved on publish</span>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm text-white/80">
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Image URL</span>
                                <input
                                    type="url"
                                    value={badgeImage.url}
                                    onChange={(event) => handleBadgeImageUrlChange(event.target.value)}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                    placeholder="https://..."
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs uppercase tracking-[0.2em] text-white/50">Upload image</span>
                                <input
                                    type="file"
                                    accept="image/png,image/svg+xml,image/*"
                                    onChange={handleBadgeImageUpload}
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white/70 file:mr-4 file:rounded-full file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white/80 disabled:opacity-70"
                                />
                            </label>
                            {badgePreview && (
                                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                                    <img src={badgePreview} alt="Badge preview" className="h-12 w-12 rounded-xl object-cover" />
                                    {canEditBadges && (
                                        <button
                                            type="button"
                                            onClick={handleBadgeImageClear}
                                            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white/40"
                                        >
                                            Clear image
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-white/60">Advanced rule builder</p>
                                <p className="mt-2 text-sm text-white/60">
                                    Chain event-based rules, negative resets, and time windows.
                                </p>
                            </div>
                            <label className="text-xs uppercase tracking-[0.2em] text-white/50">
                                Operator
                                <select
                                    value={badgeDraft.rules.operator}
                                    onChange={(event) =>
                                        setBadgeDraft((prev) => ({
                                            ...prev,
                                            rules: { ...prev.rules, operator: event.target.value as BadgeRuleSet['operator'] },
                                        }))
                                    }
                                    disabled={!canEditBadges}
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                >
                                    <option value="AND">AND</option>
                                    <option value="OR">OR</option>
                                </select>
                            </label>
                        </div>
                        <div className="mt-4 space-y-4">
                            {badgeDraft.rules.rules.map((rule, index) => {
                                const conditions = rule.conditions ?? {};
                                const selectedPriorities = conditions.priority ?? [];
                                const hasTimeWindow = Boolean(rule.timeWindow && rule.timeWindow.value);
                                return (
                                    <div key={`${rule.entity}-${rule.event}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Rule {index + 1}</p>
                                            {badgeDraft.rules.rules.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRuleRemove(index)}
                                                    disabled={!canEditBadges}
                                                    className="text-xs uppercase tracking-[0.2em] text-rose-200/80 transition hover:text-rose-200 disabled:opacity-50"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Entity</span>
                                                <select
                                                    value={rule.entity}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({ ...current, entity: event.target.value as BadgeEntity }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                >
                                                    {BADGE_ENTITIES.map((entity) => (
                                                        <option key={entity} value={entity}>
                                                            {entity}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Event</span>
                                                <select
                                                    value={rule.event}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({ ...current, event: event.target.value as BadgeEvent }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                >
                                                    {BADGE_EVENTS.map((event) => (
                                                        <option key={event} value={event}>
                                                            {event.replace('_', ' ')}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Count</span>
                                                <div className="mt-2 flex gap-2">
                                                    <select
                                                        value={rule.count.type}
                                                        onChange={(event) =>
                                                            updateRule(index, (current) => ({
                                                                ...current,
                                                                count: { ...current.count, type: event.target.value as BadgeCountType },
                                                            }))
                                                        }
                                                        disabled={!canEditBadges}
                                                        className="w-20 rounded-xl border border-white/10 bg-slate-950/60 px-2 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    >
                                                        {BADGE_COUNT_TYPES.map((type) => (
                                                            <option key={type} value={type}>
                                                                {type}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={rule.count.value}
                                                        onChange={(event) =>
                                                            updateRule(index, (current) => ({
                                                                ...current,
                                                                count: { ...current.count, value: Number(event.target.value) },
                                                            }))
                                                        }
                                                        disabled={!canEditBadges}
                                                        className="flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    />
                                                </div>
                                            </label>
                                        </div>
                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Assigned to</span>
                                                <select
                                                    value={conditions.assignedTo ?? 'any'}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({
                                                            ...current,
                                                            conditions: { ...current.conditions, assignedTo: event.target.value as BadgeScope },
                                                        }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                >
                                                    {BADGE_SCOPE_OPTIONS.map((scope) => (
                                                        <option key={scope} value={scope}>
                                                            {scope}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Created by</span>
                                                <select
                                                    value={conditions.createdBy ?? 'any'}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({
                                                            ...current,
                                                            conditions: { ...current.conditions, createdBy: event.target.value as BadgeScope },
                                                        }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                >
                                                    {BADGE_SCOPE_OPTIONS.map((scope) => (
                                                        <option key={scope} value={scope}>
                                                            {scope}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Project ID</span>
                                                <input
                                                    value={conditions.projectId ?? ''}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({
                                                            ...current,
                                                            conditions: { ...current.conditions, projectId: event.target.value || null },
                                                        }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    placeholder="Optional"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Pipeline ID</span>
                                                <input
                                                    value={conditions.pipelineId ?? ''}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({
                                                            ...current,
                                                            conditions: { ...current.conditions, pipelineId: event.target.value || null },
                                                        }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    placeholder="Optional"
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-3">
                                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Priority</p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {BADGE_PRIORITY_OPTIONS.map((priority) => {
                                                    const isChecked = selectedPriorities.includes(priority);
                                                    return (
                                                        <label key={priority} className="inline-flex items-center gap-2 text-xs text-white/60">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={() => {
                                                                    updateRule(index, (current) => {
                                                                        const currentPriorities = current.conditions.priority ?? [];
                                                                        const nextPriorities = currentPriorities.includes(priority)
                                                                            ? currentPriorities.filter((item) => item !== priority)
                                                                            : [...currentPriorities, priority];
                                                                        return {
                                                                            ...current,
                                                                            conditions: { ...current.conditions, priority: nextPriorities },
                                                                        };
                                                                    });
                                                                }}
                                                                disabled={!canEditBadges}
                                                                className="h-4 w-4 rounded border-white/30 bg-white/10 text-amber-300 focus:ring-amber-300 disabled:opacity-50"
                                                            />
                                                            {priority}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/60">
                                            <label className="inline-flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={hasTimeWindow}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({
                                                            ...current,
                                                            timeWindow: event.target.checked ? { value: 1, unit: 'days' } : null,
                                                        }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-amber-300 focus:ring-amber-300 disabled:opacity-50"
                                                />
                                                Enable time window
                                            </label>
                                            {hasTimeWindow && (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={rule.timeWindow?.value ?? 1}
                                                        onChange={(event) =>
                                                            updateRule(index, (current) => ({
                                                                ...current,
                                                                timeWindow: {
                                                                    value: Number(event.target.value),
                                                                    unit: current.timeWindow?.unit ?? 'days',
                                                                },
                                                            }))
                                                        }
                                                        disabled={!canEditBadges}
                                                        className="w-20 rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    />
                                                    <select
                                                        value={rule.timeWindow?.unit ?? 'days'}
                                                        onChange={(event) =>
                                                            updateRule(index, (current) => ({
                                                                ...current,
                                                                timeWindow: {
                                                                    value: current.timeWindow?.value ?? 1,
                                                                    unit: event.target.value as BadgeTimeWindowUnit,
                                                                },
                                                            }))
                                                        }
                                                        disabled={!canEditBadges}
                                                        className="rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-white focus:border-amber-300 focus:outline-none disabled:opacity-70"
                                                    >
                                                        {BADGE_TIME_UNITS.map((unit) => (
                                                            <option key={unit} value={unit}>
                                                                {unit}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                            <label className="inline-flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(rule.negative)}
                                                    onChange={(event) =>
                                                        updateRule(index, (current) => ({ ...current, negative: event.target.checked }))
                                                    }
                                                    disabled={!canEditBadges}
                                                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-rose-300 focus:ring-rose-300 disabled:opacity-50"
                                                />
                                                Negative rule (resets progress)
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={handleRuleAdd}
                                disabled={!canEditBadges}
                                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
                            >
                                <PlusIcon className="h-3 w-3" />
                                Add rule
                            </button>
                            <span className="text-xs text-white/50">Rules are evaluated in real time.</span>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleBadgeSave}
                            disabled={!canSaveBadge || !canEditBadges || badgeSaving}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40"
                        >
                            <SparklesIcon className="h-4 w-4" />
                            {badgeSaving ? 'Saving...' : selectedBadge ? 'Save badge' : 'Create badge'}
                        </button>
                        {selectedBadge && canEditBadges && (
                            <button
                                type="button"
                                onClick={handleBadgeDelete}
                                className="inline-flex items-center gap-2 rounded-full border border-rose-300/50 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-rose-100 transition hover:bg-rose-500/25"
                            >
                                <TrashIcon className="h-4 w-4" />
                                Delete badge
                            </button>
                        )}
                        {!canEditBadges && (
                            <span className="text-xs text-white/50">Managers can view badges but cannot modify them.</span>
                        )}
                    </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.35em] text-white/60">Badge list</p>
                            <p className="mt-2 text-sm text-white/60">{sortedBadges.length} total</p>
                        </div>
                        {canEditBadges && (
                            <button
                                type="button"
                                onClick={handleNewBadge}
                                className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary transition hover:bg-primary/25"
                            >
                                <PlusIcon className="h-3 w-3" />
                                New badge
                            </button>
                        )}
                    </div>
                    {sortedBadges.length === 0 ? (
                        <p className="mt-4 text-sm text-white/60">No badges yet. Create one to start the deck.</p>
                    ) : (
                        <div className="mt-4 space-y-3">
                            {sortedBadges.map((badge) => {
                                const isSelected = badge.id === selectedBadgeId;
                                return (
                                    <button
                                        key={badge.id}
                                        type="button"
                                        onClick={() => handleBadgeSelect(badge.id)}
                                        className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                                            isSelected
                                                ? 'border-amber-300/70 bg-amber-400/10 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
                                                : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="h-12 w-12 overflow-hidden rounded-xl bg-white/10">
                                                {badge.imageUrl ? (
                                                    <img src={badge.imageUrl} alt={badge.name} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/50">No art</div>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-white">{badge.name}</p>
                                                <p className="text-xs text-white/60">{badge.description}</p>
                                                <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-amber-200">
                                                    +{badge.bonusXp} XP
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/60">
                                            <span className={`rounded-full border px-2 py-1 ${badgeStateClass(badge.state)}`}>{badge.state}</span>
                                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{badge.tier}</span>
                                            {badge.tierGroup && (
                                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                                                    {badge.tierGroup} #{badge.tierOrder}
                                                </span>
                                            )}
                                            {badge.isSystem && (
                                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">System</span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            {levelUsersOpen && selectedLevel && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-8">
                    <div
                        className="absolute inset-0"
                        onClick={() => setLevelUsersOpen(false)}
                        aria-hidden="true"
                    />
                    <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 shadow-[0_40px_90px_rgba(15,23,42,0.6)]">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.35em] text-white/50">Level Roster</p>
                                <h3 className="mt-2 text-xl font-semibold text-white">
                                    Lv {selectedLevel.level} - {selectedLevel.title}
                                </h3>
                                <p className="text-sm text-white/60">
                                    {selectedLevelUsers.length} users • {selectedLevel.pointsRequired.toLocaleString()} XP
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setLevelUsersView('grid')}
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                                        levelUsersView === 'grid'
                                            ? 'border-sky-300/60 bg-sky-400/20 text-sky-100'
                                            : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
                                    }`}
                                >
                                    Grid
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLevelUsersView('list')}
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                                        levelUsersView === 'list'
                                            ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
                                            : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
                                    }`}
                                >
                                    List
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLevelUsersOpen(false)}
                                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/30"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto p-6">
                            {selectedLevelUsers.length === 0 && (
                                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                                    No users at this level yet.
                                </div>
                            )}
                            {selectedLevelUsers.length > 0 && levelUsersView === 'grid' && (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {selectedLevelUsers.map((user) => {
                                        const avatar = getAvatar(user);
                                        const points = userPointsMap.get(user.id) ?? 0;
                                        return (
                                            <div
                                                key={user.id}
                                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 overflow-hidden rounded-full border border-white/20 bg-slate-800">
                                                        {avatar ? (
                                                            <img src={avatar} alt={user.name} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold">
                                                                {user.name.slice(0, 2).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold">{user.name}</p>
                                                        <p className="text-xs text-white/60">{user.email}</p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 text-xs uppercase tracking-[0.2em] text-white/50">
                                                    {points.toLocaleString()} XP
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {selectedLevelUsers.length > 0 && levelUsersView === 'list' && (
                                <div className="space-y-3">
                                    {selectedLevelUsers.map((user) => {
                                        const avatar = getAvatar(user);
                                        const points = userPointsMap.get(user.id) ?? 0;
                                        return (
                                            <div
                                                key={user.id}
                                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-slate-800">
                                                        {avatar ? (
                                                            <img src={avatar} alt={user.name} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold">
                                                                {user.name.slice(0, 2).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold">{user.name}</p>
                                                        <p className="text-xs text-white/60">{user.email}</p>
                                                    </div>
                                                </div>
                                                <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                                                    {points.toLocaleString()} XP
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LevelsManager;
