export type LevelReward = {
    title: string;
    description?: string;
    rewardId?: string | null;
};

export type LevelConfig = {
    id: string;
    level: number;
    title: string;
    pointsRequired: number;
    reward?: LevelReward | null;
    accent?: string;
    note?: string;
};

export type LevelProgress = {
    level: number;
    levelTitle: string;
    pointsRequired: number;
    pointsIntoLevel: number;
    pointsToNextLevel: number;
    levelSpan: number;
    progressPercent: number;
    currentLevel: LevelConfig;
    nextLevel?: LevelConfig;
};

const STORAGE_KEY = 'levels-config';
export const LEVELS_CONFIG_UPDATED_EVENT = 'levels-config-updated';

const DEFAULT_LEVELS: LevelConfig[] = [
    {
        id: 'level-1',
        level: 1,
        title: 'Rookie Trail',
        pointsRequired: 0,
        reward: { title: 'Starter Pack', description: 'Unlock basic profile glow.' },
        accent: 'from-amber-400/40 via-rose-400/30 to-purple-400/40',
    },
    {
        id: 'level-2',
        level: 2,
        title: 'Spark Runner',
        pointsRequired: 750,
        reward: { title: 'Focus Banner', description: 'Animated banner trim.' },
        accent: 'from-sky-400/40 via-indigo-400/30 to-emerald-400/40',
    },
    {
        id: 'level-3',
        level: 3,
        title: 'Momentum Pilot',
        pointsRequired: 1500,
        reward: { title: 'Squad Emote', description: 'Unlock a team emote.' },
        accent: 'from-emerald-400/40 via-cyan-400/30 to-lime-300/40',
    },
    {
        id: 'level-4',
        level: 4,
        title: 'Night Vanguard',
        pointsRequired: 2300,
        reward: { title: 'Night Runner Badge', description: 'Badge for late-night launches.' },
        accent: 'from-purple-500/40 via-fuchsia-500/30 to-rose-400/40',
    },
    {
        id: 'level-5',
        level: 5,
        title: 'Trailblazer',
        pointsRequired: 3200,
        reward: { title: 'Mission Flair', description: 'Animated card highlight.' },
        accent: 'from-amber-400/40 via-orange-400/30 to-rose-400/40',
    },
    {
        id: 'level-6',
        level: 6,
        title: 'Skyforge',
        pointsRequired: 4200,
        reward: { title: 'Elite Frame', description: 'New avatar frame tier.' },
        accent: 'from-sky-400/40 via-indigo-400/30 to-violet-400/40',
    },
    {
        id: 'level-7',
        level: 7,
        title: 'Arc Sentinel',
        pointsRequired: 5300,
        reward: { title: 'Power Surge', description: 'Boost card overlays.' },
        accent: 'from-emerald-400/40 via-teal-400/30 to-sky-400/40',
    },
    {
        id: 'level-8',
        level: 8,
        title: 'Mythic Pulse',
        pointsRequired: 6500,
        reward: { title: 'Mythic Aura', description: 'Epic profile aura.' },
        accent: 'from-fuchsia-500/40 via-purple-500/30 to-sky-400/40',
    },
    {
        id: 'level-9',
        level: 9,
        title: 'Nova Commander',
        pointsRequired: 7800,
        reward: { title: 'Command Sigil', description: 'Exclusive badge sigil.' },
        accent: 'from-amber-400/40 via-rose-400/30 to-indigo-400/40',
    },
    {
        id: 'level-10',
        level: 10,
        title: 'Starlight Legend',
        pointsRequired: 9200,
        reward: { title: 'Legend Crest', description: 'Legendary crest + confetti.' },
        accent: 'from-rose-400/40 via-amber-400/30 to-yellow-300/40',
    },
];

const cloneLevels = (levels: LevelConfig[]): LevelConfig[] =>
    levels.map((level) => ({
        ...level,
        reward: level.reward ? { ...level.reward } : undefined,
    }));

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

const normalizeReward = (raw: unknown, fallback?: LevelReward | null): LevelReward | null | undefined => {
    if (!raw || typeof raw !== 'object') {
        return fallback ?? undefined;
    }
    const maybeReward = raw as Partial<LevelReward>;
    const title =
        typeof maybeReward.title === 'string' && maybeReward.title.trim().length > 0
            ? maybeReward.title.trim()
            : fallback?.title ?? '';
    if (!title) {
        return fallback ?? undefined;
    }
    return {
        title,
        description:
            typeof maybeReward.description === 'string' && maybeReward.description.trim().length > 0
                ? maybeReward.description.trim()
                : fallback?.description,
        rewardId:
            typeof maybeReward.rewardId === 'string' && maybeReward.rewardId.trim().length > 0
                ? maybeReward.rewardId.trim()
                : fallback?.rewardId,
    };
};

const normalizeLevel = (raw: unknown, index: number, fallback?: LevelConfig): LevelConfig => {
    const safeFallback = fallback ?? DEFAULT_LEVELS[Math.min(index, DEFAULT_LEVELS.length - 1)];
    const value = raw && typeof raw === 'object' ? (raw as Partial<LevelConfig>) : {};
    const pointsRequired = Math.max(0, normalizeNumber(value.pointsRequired, safeFallback.pointsRequired));
    const title =
        typeof value.title === 'string' && value.title.trim().length > 0
            ? value.title.trim()
            : safeFallback.title || `Level ${index + 1}`;
    const accent = typeof value.accent === 'string' ? value.accent : safeFallback.accent;
    const note = typeof value.note === 'string' ? value.note : safeFallback.note;
    return {
        id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : safeFallback.id || `level-${index + 1}`,
        level: index + 1,
        title,
        pointsRequired,
        reward: normalizeReward(value.reward, safeFallback.reward),
        accent,
        note,
    };
};

const normalizeLevels = (raw: unknown): LevelConfig[] => {
    const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_LEVELS;
    const normalized = source.map((level, index) => normalizeLevel(level, index));
    const sorted = normalized
        .slice()
        .sort((a, b) => a.pointsRequired - b.pointsRequired || a.level - b.level)
        .map((level, index) => ({
            ...level,
            level: index + 1,
            title: level.title || `Level ${index + 1}`,
        }));

    if (sorted.length === 0) {
        return cloneLevels(DEFAULT_LEVELS);
    }

    const ids = new Set<string>();
    const unique = sorted.map((level, index) => {
        let id = level.id || `level-${index + 1}`;
        if (ids.has(id)) {
            id = `${id}-${index + 1}`;
        }
        ids.add(id);
        return { ...level, id };
    });

    if (unique[0].pointsRequired !== 0) {
        unique[0] = { ...unique[0], pointsRequired: 0 };
    }

    return unique;
};

const dispatchLevelsConfigUpdated = (levels: LevelConfig[]): void => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }
    const detail = { levels: cloneLevels(levels) };
    window.dispatchEvent(new CustomEvent(LEVELS_CONFIG_UPDATED_EVENT, { detail }));
};

export const loadLevelsConfig = (): LevelConfig[] => {
    if (typeof window === 'undefined') {
        return cloneLevels(DEFAULT_LEVELS);
    }
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return cloneLevels(DEFAULT_LEVELS);
        }
        const parsed = JSON.parse(stored);
        return normalizeLevels(parsed);
    } catch (error) {
        console.error('Failed to load levels configuration, using defaults.', error);
        return cloneLevels(DEFAULT_LEVELS);
    }
};

export const saveLevelsConfig = (levels: LevelConfig[]): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        const normalized = normalizeLevels(levels);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        dispatchLevelsConfigUpdated(normalized);
    } catch (error) {
        console.error('Failed to persist levels configuration.', error);
    }
};

export const resetLevelsConfig = (): LevelConfig[] => {
    const defaults = cloneLevels(DEFAULT_LEVELS);
    saveLevelsConfig(defaults);
    return defaults;
};

export const getLevelProgress = (points: number, levels?: LevelConfig[]): LevelProgress => {
    const safePoints = Math.max(0, Number.isFinite(points) ? points : 0);
    const config = levels && levels.length > 0 ? cloneLevels(levels) : loadLevelsConfig();
    const sorted = config.slice().sort((a, b) => a.pointsRequired - b.pointsRequired);
    let current = sorted[0];
    for (const level of sorted) {
        if (safePoints >= level.pointsRequired) {
            current = level;
        } else {
            break;
        }
    }
    const currentIndex = sorted.findIndex((level) => level.id === current.id);
    const nextLevel = currentIndex >= 0 ? sorted[currentIndex + 1] : undefined;
    const pointsIntoLevel = Math.max(0, safePoints - current.pointsRequired);
    const levelSpan = nextLevel
        ? Math.max(nextLevel.pointsRequired - current.pointsRequired, 1)
        : Math.max(current.pointsRequired, 1);
    const pointsToNextLevel = nextLevel ? Math.max(nextLevel.pointsRequired - safePoints, 0) : 0;
    const progressPercent = nextLevel ? Math.min((pointsIntoLevel / levelSpan) * 100, 100) : 100;

    return {
        level: current.level,
        levelTitle: current.title,
        pointsRequired: current.pointsRequired,
        pointsIntoLevel,
        pointsToNextLevel,
        levelSpan,
        progressPercent,
        currentLevel: current,
        nextLevel,
    };
};
