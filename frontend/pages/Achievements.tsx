
import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import { Achievement, BadgeProgress, User, Reward, RewardStatus, Task, CUSTOM_STATUS_NAMES, Role, UserStatus } from '../types';
import { formatDate } from '../utils';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { LEVELS_CONFIG_UPDATED_EVENT, LevelConfig, getLevelProgress, loadLevelsConfig } from '../utils/levelsConfigStorage';
import { APP_REFRESH_EVENT } from '../utils/appEvents';
import PageLoader from '../components/loading/PageLoader';
import {
    augmentTasksWithPoints,
    summarizeTaskPoints,
    formatPointsValue,
    TaskPointsTone,
    normalizeDepartmentKey,
    calculateUserPointsForTask,
} from '../utils/taskPoints';
import {
    RocketLaunchIcon,
    BoltIcon,
    AcademicCapIcon,
    FireIcon,
    ClipboardDocumentListIcon,
    SparklesIcon,
    GiftIcon,
    TrophyIcon,
    StarIcon,
    PaperAirplaneIcon,
    XMarkIcon,
    ShieldCheckIcon,
    ArrowRightIcon,
} from '../components/icons';

const RewardManagementTab = React.lazy(() => import('./RewardManagement'));
const LevelsManagerTab = React.lazy(() => import('./LevelsManager'));
const PointsTableSettingsTab = React.lazy(() => import('./PointsTableSettings'));
const TemplateEditorTab = React.lazy(() => import('./TemplateEditor'));

const preloadAchievementTabs = () => {
    void import('./RewardManagement');
    void import('./LevelsManager');
    void import('./PointsTableSettings');
    void import('./TemplateEditor');
};

const POINTS_HISTORY_PAGE_SIZE = 100;
const LEVEL_UP_STORAGE_PREFIX = 'level-up-seen';
const LEADERBOARD_ANIMATION_CONFIG = {
    tabDurationMs: 360,
    shimmerDurationMs: 7200,
    pulseDurationMs: 2800,
    sparkleDurationMs: 6400,
    energyFlowDurationMs: 2400,
    xpCountDurationMs: 900,
    xpUpdateDurationMs: 700,
    spotlightDurationMs: 1500,
    impactFlashMs: 450,
    refreshMs: 650,
    rankPulseMs: 700,
};
const LEADERBOARD_POINTS_VISIBILITY_KEY = 'leaderboard-points-visible';
const LEADERBOARD_BADGE_STORAGE_PREFIX = 'leaderboard-badge';

type LeaderboardTabKey = 'apex' | 'leadership' | 'contributors';

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

const loadLeaderboardPointsVisibility = (): boolean => {
    if (typeof window === 'undefined') {
        return true;
    }
    const stored = window.localStorage.getItem(LEADERBOARD_POINTS_VISIBILITY_KEY);
    if (stored === null) {
        return true;
    }
    return stored === 'true';
};

const persistLeaderboardPointsVisibility = (isVisible: boolean): void => {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(LEADERBOARD_POINTS_VISIBILITY_KEY, String(isVisible));
};

const loadLeaderboardBadgeId = (userId?: string | null): string => {
    if (typeof window === 'undefined' || !userId) {
        return '';
    }
    return window.localStorage.getItem(`${LEADERBOARD_BADGE_STORAGE_PREFIX}-${userId}`) ?? '';
};

const persistLeaderboardBadgeId = (userId: string | null | undefined, badgeId: string): void => {
    if (typeof window === 'undefined' || !userId) {
        return;
    }
    if (badgeId) {
        window.localStorage.setItem(`${LEADERBOARD_BADGE_STORAGE_PREFIX}-${userId}`, badgeId);
    } else {
        window.localStorage.removeItem(`${LEADERBOARD_BADGE_STORAGE_PREFIX}-${userId}`);
    }
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

type IconComponent = React.FC<React.SVGProps<SVGSVGElement>>;

type SeasonalChallenge = {
    id: string;
    title: string;
    description: string;
    progress: number;
    reward: string;
    xpReward: number;
    expiresIn: string;
    accent: string;
    icon: IconComponent;
};

type ProgressionStep = {
    level: number;
    xpRequired: number;
    title: string;
    reward: string;
    progress: number;
    isUnlocked: boolean;
};

type BadgeAchievement = Achievement & {
    status: BadgeProgress['status'];
    progressPercent: number;
    tier: string;
    tierGroup?: string | null;
    tierOrder: number;
    isSystem: boolean;
    earnedAt?: string | null;
};

type TierMeta = {
    index: number;
    total: number;
    group: BadgeAchievement[];
};

type AchievementWorkspaceTabKey = 'overview' | 'rewards' | 'levels' | 'points' | 'templates';

type AchievementWorkspaceTab = {
    key: AchievementWorkspaceTabKey;
    label: string;
    description: string;
    icon: IconComponent;
    roles?: Role[];
};

const achievementIcons: Record<Achievement['icon'], IconComponent> = {
    RocketLaunch: RocketLaunchIcon,
    Bolt: BoltIcon,
    AcademicCap: AcademicCapIcon,
    Fire: FireIcon,
    Clipboard: ClipboardDocumentListIcon,
    Sparkles: SparklesIcon,
    Image: SparklesIcon,
};

const achievementInsights: Record<Achievement['icon'], string> = {
    RocketLaunch: "Stack high-impact releases back-to-back to keep this badge glowing.",
    Bolt: 'Chain quick-win tasks under two hours to overcharge the Bolt badge.',
    AcademicCap: 'Document learnings and mentor teammates to progress this mastery badge.',
    Fire: 'Maintain a daily delivery streak to keep the momentum meter blazing.',
    Clipboard: 'Finish checklists and submit retrospectives to level up this discipline badge.',
    Sparkles: 'Experiment with creative task approaches and celebrate wins with the crew.',
    Image: 'Experiment with creative task approaches and celebrate wins with the crew.',
};

const achievementGlow: Record<Achievement['icon'], string> = {
    RocketLaunch: 'bg-amber-400/25',
    Bolt: 'bg-sky-400/25',
    AcademicCap: 'bg-emerald-300/25',
    Fire: 'bg-rose-400/25',
    Clipboard: 'bg-purple-400/25',
    Sparkles: 'bg-fuchsia-400/25',
    Image: 'bg-fuchsia-400/25',
};

const tierIconMap: Record<string, Achievement['icon']> = {
    Bronze: 'RocketLaunch',
    Silver: 'AcademicCap',
    Gold: 'Fire',
    Platinum: 'Sparkles',
};

const achievementWorkspaceTabs: AchievementWorkspaceTab[] = [
    {
        key: 'overview',
        label: 'Achievements',
        description: 'Track streaks, badges, rewards, and leaderboard progress from one place.',
        icon: TrophyIcon,
    },
    {
        key: 'rewards',
        label: 'Manage Rewards',
        description: 'Create, review, and manage reward inventory without leaving the achievements area.',
        icon: GiftIcon,
        roles: [Role.MANAGER, Role.ADMIN, Role.OWNER],
    },
    {
        key: 'levels',
        label: 'Levels Manager',
        description: 'Tune level progression, badge rules, and questline milestones.',
        icon: RocketLaunchIcon,
    },
    {
        key: 'points',
        label: 'Points Table',
        description: 'Adjust department scoring, task creation bonuses, and penalties.',
        icon: BoltIcon,
        roles: [Role.OWNER],
    },
    {
        key: 'templates',
        label: 'Template Editor',
        description: 'Design and iterate on achievement share-card templates.',
        icon: SparklesIcon,
        roles: [Role.OWNER],
    },
];

const canAccessAchievementWorkspaceTab = (role: Role | undefined, tab: AchievementWorkspaceTab): boolean => {
    if (!tab.roles) {
        return true;
    }
    return Boolean(role && tab.roles.includes(role));
};

const resolveBadgeIcon = (badge: BadgeProgress): Achievement['icon'] => {
    if (badge.imageUrl) {
        return 'Image';
    }
    return tierIconMap[badge.tier] ?? 'Sparkles';
};

const mapBadgeProgressToAchievement = (badge: BadgeProgress): BadgeAchievement => ({
    id: badge.id,
    title: badge.name,
    description: badge.description,
    points: badge.bonusXp,
    icon: resolveBadgeIcon(badge),
    imageUrl: badge.imageUrl ?? null,
    custom: !badge.isSystem,
    status: badge.status,
    progressPercent: badge.progressPercent,
    tier: badge.tier,
    tierGroup: badge.tierGroup ?? null,
    tierOrder: badge.tierOrder,
    isSystem: badge.isSystem,
    earnedAt: badge.earnedAt ?? null,
});

const progressionBlueprint = [
    { offset: 1, title: 'Neon Nameplate', reward: 'Animated profile frame & gradient banner unlocks.' },
    { offset: 2, title: 'Squad Signal Boost', reward: '+10% XP on co-op tasks for 24 hours.' },
    { offset: 3, title: 'Legend Emote Drop', reward: 'Exclusive reaction emotes & audio stingers.' },
    { offset: 4, title: 'Mythic Avatar Forge', reward: 'Unlock the full avatar customization suite.' },
];

const formatRelativeDay = (daysAgo: number): string => {
    if (daysAgo <= 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    return `${daysAgo} days ago`;
};

type LeaderboardTab = {
    key: LeaderboardTabKey;
    label: string;
    description: string;
    icon: IconComponent;
};

const isLeadershipRole = (role?: Role | null) =>
    role === Role.ADMIN || role === Role.OWNER || role === Role.MANAGER;

const isLeaderboardEligibleUser = (user: User) => user.status !== UserStatus.DEACTIVATED;

const resolveStreakLabel = (user: User): string => {
    const activity = user.tasksCompleted + user.tasksCreated;
    if (activity >= 60) return '30-day';
    if (activity >= 30) return '7-day';
    return '3-day';
};

const resolveUserBadges = (user: User): string[] => {
    const badges: string[] = [];
    if (user.tasksCreated >= Math.max(8, user.tasksCompleted + 4)) {
        badges.push('Top Creator');
    }
    if (user.tasksCompleted >= 18) {
        badges.push('Finisher');
    }
    if (user.tasksCompleted + user.tasksCreated >= 32) {
        badges.push('Consistent');
    }
    return badges.slice(0, 2);
};

const getXpTooltip = (user: User): string => {
    const streakLabel = `Streak ${resolveStreakLabel(user)}`;
    return `XP from ${user.tasksCompleted} completed, ${user.tasksCreated} created, ${streakLabel} streak bonus.`;
};

const resolveFallbackPoints = (user: User): number => {
    const toNumber = (value: unknown): number => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
    };
    const completed = toNumber(user.tasksCompleted);
    const created = toNumber(user.tasksCreated);
    const clarityCount = Array.isArray(user.clarityScores) ? user.clarityScores.length : 0;
    const derived = completed * 25 + created * 10 + clarityCount * 5;
    return Number.isFinite(user.points) ? user.points : derived;
};


type StatPillProps = {
    icon: IconComponent;
    label: string;
    value: string;
    accent?: string;
    theme: ResolvedTheme;
};

const StatPill: React.FC<StatPillProps> = ({ icon: Icon, label, value, accent, theme }) => {
    const wrapper =
        theme === 'dark'
            ? 'border-white/15 bg-black/30 text-white/80'
            : theme === 'colorful'
                ? 'border-white/50 bg-white/30 text-slate-800 shadow-[0_12px_30px_rgba(99,102,241,0.35)]'
                : 'border-slate-200 bg-white/80 text-slate-700 shadow-[0_12px_25px_rgba(148,163,184,0.25)]';
    const iconWrapper =
        theme === 'dark'
            ? 'bg-white/10 text-white'
            : theme === 'colorful'
                ? 'bg-white text-fuchsia-500 shadow-md'
                : 'bg-white text-indigo-500 shadow-inner';
    const labelClass = theme === 'dark' ? 'text-white/50' : 'text-slate-500';
    const valueClass = accent ?? (theme === 'dark' ? 'text-white' : theme === 'colorful' ? 'text-indigo-600' : 'text-indigo-600');

    return (
        <div className={`flex items-center gap-3 rounded-full border px-4 py-2 backdrop-blur ${wrapper}`}>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${iconWrapper}`}>
                <Icon className="h-5 w-5" />
            </span>
            <div>
                <p className={`text-[10px] uppercase tracking-[0.32em] ${labelClass}`}>{label}</p>
                <p className={`text-sm font-semibold ${valueClass}`}>{value}</p>
            </div>
        </div>
    );
};

type AchievementCardProps = {
    achievement: BadgeAchievement;
    isUnlocked: boolean;
    progress: number;
    onSelect: (achievement: BadgeAchievement) => void;
    theme: ResolvedTheme;
    isLeaderboardBadge?: boolean;
    tierMeta?: TierMeta;
};

const AchievementCard: React.FC<AchievementCardProps> = ({
    achievement,
    isUnlocked,
    progress,
    onSelect,
    theme,
    isLeaderboardBadge,
    tierMeta,
}) => {
    const isDark = theme === 'dark';
    const isColorful = theme === 'colorful';
    const IconComponent = achievementIcons[achievement.icon];
    const hasImage = Boolean(achievement.imageUrl);

    const unlockedClasses = isUnlocked
        ? isDark
            ? 'border-transparent bg-gradient-to-br from-amber-500/25 via-purple-600/25 to-sky-500/25 shadow-[0_20px_45px_rgba(88,28,135,0.35)]'
            : isColorful
                ? 'border-transparent bg-gradient-to-br from-rose-200/70 via-violet-200/70 to-sky-200/70 shadow-[0_25px_45px_rgba(236,72,153,0.35)]'
                : 'border border-indigo-100 bg-white shadow-[0_25px_45px_rgba(129,140,248,0.25)]'
        : isDark
            ? 'border-dashed border-border-color/70 bg-surface/60'
            : isColorful
                ? 'border border-white/60 bg-white/80 shadow-[0_20px_35px_rgba(129,140,248,0.2)]'
                : 'border border-slate-200 bg-white/85 shadow-sm';

    const textColor = isUnlocked
        ? isDark
            ? 'text-white'
            : 'text-slate-900'
        : isDark
            ? 'text-text-secondary'
            : 'text-slate-600';

    const descriptionClass = isUnlocked
        ? isDark
            ? 'text-white/80'
            : 'text-slate-600'
        : isDark
            ? 'text-gray-400/80'
            : 'text-slate-500';

    const pointsClass = isUnlocked
        ? isDark
            ? 'text-amber-200'
            : 'text-amber-600'
        : isDark
            ? 'text-gray-500'
            : 'text-slate-500';

    const iconWrapper = isUnlocked
        ? isDark
            ? 'bg-black/35 text-amber-200'
            : 'bg-white/70 text-amber-500 shadow-inner'
        : isDark
            ? 'bg-gray-800/70 text-gray-400'
            : 'bg-slate-100 text-slate-400';

    const chipClass = isUnlocked
        ? isDark
            ? 'bg-black/30 text-amber-200'
            : 'bg-amber-100 text-amber-600'
        : isDark
            ? 'bg-gray-700/70 text-gray-300'
            : 'bg-slate-100 text-slate-500';

    const progressTrack = isDark ? 'bg-black/20' : 'bg-slate-200';
    const progressFill = isDark
        ? 'from-sky-400 via-indigo-400 to-purple-400'
        : isColorful
            ? 'from-fuchsia-400 via-indigo-400 to-sky-400'
            : 'from-indigo-400 via-sky-400 to-emerald-400';

    const calloutClass = isDark ? 'text-white/45' : 'text-slate-400';
    const badgeChipClass = isDark ? 'bg-black/35 text-amber-200' : 'bg-amber-100 text-amber-600';
    const spotlightChipClass = isDark ? 'bg-sky-500/20 text-sky-200' : 'bg-sky-100 text-sky-600';
    const tierChipClass = isDark ? 'bg-white/10 text-white/70' : 'bg-slate-100 text-slate-600';
    const tierLabel = tierMeta
        ? `${achievement.tier} Tier ${tierMeta.index}/${tierMeta.total}`
        : `${achievement.tier} Tier`;

    return (
        <button
            type="button"
            onClick={() => onSelect(achievement)}
            className={`relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-transform duration-300 hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-primary/60 ${unlockedClasses}`}
        >
            {isUnlocked && <div className={`pointer-events-none absolute -top-16 right-0 h-36 w-36 rounded-full blur-3xl ${achievementGlow[achievement.icon]}`} />}
            <div className="relative flex items-start gap-4">
                <div className={`rounded-2xl p-3 ${iconWrapper}`}>
                    {hasImage ? (
                        <img src={achievement.imageUrl ?? ''} alt={achievement.title} className="h-9 w-9 rounded-lg object-cover" />
                    ) : (
                        <IconComponent className="h-9 w-9" />
                    )}
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className={`text-lg font-semibold ${textColor}`}>{achievement.title}</h3>
                        {isUnlocked && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] ${chipClass}`}>
                                <SparklesIcon className="h-3 w-3" />
                                Unlocked
                            </span>
                        )}
                        {achievement.custom && (
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] ${badgeChipClass}`}>
                                Custom
                            </span>
                        )}
                        {isLeaderboardBadge && (
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] ${spotlightChipClass}`}>
                                Spotlight
                            </span>
                        )}
                    </div>
                    <p className={`mt-1 text-sm ${descriptionClass}`}>{achievement.description}</p>
                    <p className={`mt-3 text-xs font-bold tracking-widest ${pointsClass}`}>+{achievement.points} XP</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.25em]">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${tierChipClass}`}>{tierLabel}</span>
                        {tierMeta && (
                            <div className="flex items-center gap-1">
                                {tierMeta.group.map((tierBadge) => {
                                    const earned = tierBadge.status === 'earned';
                                    const isCurrent = tierBadge.id === achievement.id;
                                    const dotClass = earned
                                        ? isDark
                                            ? 'bg-emerald-300'
                                            : 'bg-emerald-500'
                                        : isDark
                                            ? 'bg-white/20'
                                            : 'bg-slate-300';
                                    const ringClass = isCurrent ? (isDark ? 'ring-2 ring-amber-300/70' : 'ring-2 ring-amber-400') : '';
                                    return (
                                        <span
                                            key={tierBadge.id}
                                            className={`h-2.5 w-2.5 rounded-full ${dotClass} ${ringClass}`}
                                            title={`${tierBadge.tier} Tier`}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {!isUnlocked && (
                <div className="relative mt-4">
                    <div className={`h-1.5 w-full overflow-hidden rounded-full ${progressTrack}`}>
                        <div className={`h-full rounded-full bg-gradient-to-r ${progressFill}`} style={{ width: `${progress}%` }} />
                    </div>
                    <p className={`mt-1 text-xs ${isDark ? 'text-white/60' : 'text-slate-500'}`}>{progress}% charged</p>
                </div>
            )}
            <p className={`mt-4 text-[10px] uppercase tracking-[0.35em] ${calloutClass}`}>Tap for badge intel</p>
        </button>
    );
};

type SeasonalChallengeCardProps = {
    challenge: SeasonalChallenge;
    theme: ResolvedTheme;
};

const SeasonalChallengeCard: React.FC<SeasonalChallengeCardProps> = ({ challenge, theme }) => {
    const isDark = theme === 'dark';
    const isColorful = theme === 'colorful';
    const wrapperBase = 'relative overflow-hidden rounded-2xl border p-5 backdrop-blur transition-shadow';
    const wrapper = isDark
        ? `${wrapperBase} border-white/10 bg-gradient-to-br ${challenge.accent} text-white`
        : isColorful
            ? `${wrapperBase} border-white/60 bg-gradient-to-br ${challenge.accent} text-slate-900 shadow-[0_20px_45px_rgba(236,72,153,0.25)]`
            : `${wrapperBase} border-slate-200 bg-white/90 text-slate-900 shadow-[0_18px_40px_rgba(148,163,184,0.25)]`;

    const badgeTextClass = isDark ? 'text-white/60' : 'text-slate-600';
    const descriptionClass = isDark ? 'text-white/80' : 'text-slate-600';
    const iconWrapper = isDark ? 'bg-black/30 text-white' : 'bg-white text-indigo-500 shadow';
    const progressTrack = isDark ? 'bg-black/30' : 'bg-slate-200';
    const progressFill = isDark
        ? 'from-emerald-300 via-cyan-300 to-violet-300'
        : isColorful
            ? 'from-fuchsia-400 via-sky-300 to-emerald-300'
            : 'from-indigo-400 via-sky-400 to-emerald-400';
    const progressMeta = isDark ? 'text-white/75' : 'text-slate-600';
    const chipReward = isDark ? 'bg-black/30 text-emerald-200' : 'bg-white/70 text-emerald-600';
    const chipXp = isDark ? 'bg-black/30 text-sky-200' : 'bg-white/70 text-sky-600';

    const Icon = challenge.icon;

    return (
        <div className={wrapper}>
            <div className="relative flex items-start justify-between gap-4">
                <div>
                    <p className={`text-[11px] uppercase tracking-[0.35em] ${badgeTextClass}`}>Limited Event</p>
                    <h3 className="mt-1 text-lg font-semibold">{challenge.title}</h3>
                    <p className={`mt-2 text-sm ${descriptionClass}`}>{challenge.description}</p>
                </div>
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${iconWrapper}`}>
                    <Icon className="h-6 w-6" />
                </span>
            </div>
            <div className="mt-4">
                <div className={`h-2 w-full overflow-hidden rounded-full ${progressTrack}`}>
                    <div
                        className={`h-full rounded-full bg-gradient-to-r ${progressFill}`}
                        style={{ width: `${challenge.progress}%` }}
                    />
                </div>
                <div className={`mt-2 flex items-center justify-between text-xs ${progressMeta}`}>
                    <span>{challenge.progress}% synced</span>
                    <span>{challenge.expiresIn}</span>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em]">
                <span className={`rounded-full px-3 py-1 font-semibold ${chipReward}`}>{challenge.reward}</span>
                <span className={`rounded-full px-3 py-1 font-semibold ${chipXp}`}>+{challenge.xpReward} XP</span>
            </div>
        </div>
    );
};

type ProgressionCardProps = {
    step: ProgressionStep;
    theme: ResolvedTheme;
};

const ProgressionCard: React.FC<ProgressionCardProps> = ({ step, theme }) => {
    const isDark = theme === 'dark';
    const isColorful = theme === 'colorful';

    const container = step.isUnlocked
        ? isDark
            ? 'border-emerald-400/60 bg-emerald-500/15 text-white shadow-[0_20px_40px_rgba(16,185,129,0.25)]'
            : isColorful
                ? 'border-emerald-200 bg-white/95 text-slate-900 shadow-[0_20px_45px_rgba(52,211,153,0.25)]'
                : 'border-emerald-200 bg-white text-slate-900 shadow-[0_20px_45px_rgba(59,130,246,0.15)]'
        : isDark
            ? 'border-border-color/70 bg-surface/70 text-white/90'
            : isColorful
                ? 'border-white/60 bg-white/85 text-slate-800 shadow-sm'
                : 'border-slate-200 bg-white/85 text-slate-800 shadow-sm';

    const iconWrapper = step.isUnlocked
        ? isDark
            ? 'border-white/50 bg-black/20 text-emerald-100'
            : 'border-emerald-200 bg-white text-emerald-500 shadow'
        : isDark
            ? 'border-white/20 bg-black/30 text-white/70'
            : 'border-slate-200 bg-white text-slate-500';

    const progressTrack = isDark ? 'bg-black/30' : 'bg-slate-200';
    const progressFill = step.isUnlocked
        ? isDark
            ? 'from-emerald-300 via-teal-300 to-sky-300'
            : 'from-emerald-400 via-teal-300 to-sky-300'
        : isDark
            ? 'from-purple-300 via-indigo-300 to-sky-300'
            : 'from-indigo-300 via-sky-300 to-teal-300';

    const metaText = isDark ? 'text-white/70' : 'text-slate-600';

    return (
        <div className={`relative overflow-hidden rounded-2xl border p-5 backdrop-blur ${container}`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className={`text-[11px] uppercase tracking-[0.3em] ${metaText}`}>Lv {step.level}</p>
                    <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                    <p className={`mt-2 text-sm ${metaText}`}>{step.reward}</p>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-full border ${iconWrapper}`}>
                    <TrophyIcon className="h-5 w-5" />
                </div>
            </div>
            <div className={`mt-4 h-2 w-full overflow-hidden rounded-full ${progressTrack}`}>
                <div
                    className={`h-full rounded-full bg-gradient-to-r ${progressFill}`}
                    style={{ width: `${step.progress}%` }}
                />
            </div>
            <div className={`mt-2 flex items-center justify-between text-xs ${metaText}`}>
                <span>{step.progress}% complete</span>
                <span>{step.isUnlocked ? 'Unlocked' : `${step.xpRequired.toLocaleString()} XP`}</span>
            </div>
        </div>
    );
};

type LeaderboardHighlight = {
    container: string;
    emblem: string;
    accent: string;
};

const getLeaderboardHighlight = (rank: number, theme: ResolvedTheme): LeaderboardHighlight | null => {
    if (rank > 3) {
        return null;
    }

    if (theme === 'dark') {
        const darkHighlights: LeaderboardHighlight[] = [
            {
                container: 'bg-gradient-to-r from-amber-400/30 via-orange-500/25 to-yellow-500/25 border-transparent shadow-[0_20px_40px_rgba(250,204,21,0.35)]',
                emblem: 'bg-black/30 border-white/40 text-amber-100',
                accent: 'text-amber-100',
            },
            {
                container: 'bg-gradient-to-r from-slate-300/20 via-slate-400/20 to-slate-500/25 border-transparent shadow-[0_20px_40px_rgba(148,163,184,0.35)]',
                emblem: 'bg-black/25 border-white/30 text-slate-100',
                accent: 'text-slate-100',
            },
            {
                container: 'bg-gradient-to-r from-orange-300/20 via-amber-400/20 to-rose-400/20 border-transparent shadow-[0_20px_40px_rgba(249,115,22,0.3)]',
                emblem: 'bg-black/25 border-white/30 text-orange-100',
                accent: 'text-orange-100',
            },
        ];
        return darkHighlights[rank - 1];
    }

    if (theme === 'colorful') {
        const colorfulHighlights: LeaderboardHighlight[] = [
            {
                container: 'bg-gradient-to-r from-amber-100 via-amber-200 to-orange-200 border-transparent shadow-[0_18px_35px_rgba(251,191,36,0.35)]',
                emblem: 'bg-white text-amber-600 border-amber-200',
                accent: 'text-amber-600',
            },
            {
                container: 'bg-gradient-to-r from-sky-100 via-indigo-100 to-slate-200 border-transparent shadow-[0_18px_35px_rgba(129,140,248,0.3)]',
                emblem: 'bg-white text-indigo-500 border-indigo-200',
                accent: 'text-indigo-500',
            },
            {
                container: 'bg-gradient-to-r from-rose-100 via-amber-100 to-pink-100 border-transparent shadow-[0_18px_35px_rgba(244,114,182,0.3)]',
                emblem: 'bg-white text-rose-500 border-rose-200',
                accent: 'text-rose-500',
            },
        ];
        return colorfulHighlights[rank - 1];
    }

    const lightHighlights: LeaderboardHighlight[] = [
        {
            container: 'bg-gradient-to-r from-amber-100 via-yellow-100 to-orange-100 border-transparent shadow-[0_18px_35px_rgba(250,204,21,0.25)]',
            emblem: 'bg-white border-amber-200 text-amber-600',
            accent: 'text-amber-600',
        },
        {
            container: 'bg-gradient-to-r from-slate-100 via-slate-200 to-slate-300 border-transparent shadow-[0_18px_35px_rgba(148,163,184,0.25)]',
            emblem: 'bg-white border-slate-200 text-slate-600',
            accent: 'text-slate-600',
        },
        {
            container: 'bg-gradient-to-r from-orange-100 via-rose-100 to-amber-100 border-transparent shadow-[0_18px_35px_rgba(251,146,60,0.25)]',
            emblem: 'bg-white border-orange-200 text-orange-600',
            accent: 'text-orange-600',
        },
    ];
    return lightHighlights[rank - 1];
};

const CrownIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7.5l4.5 4 4-6 4 6 4.5-4V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7.5z"
        />
    </svg>
);

const useAnimatedNumber = (value: number, durationMs: number, startFromZero = false) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    const [displayValue, setDisplayValue] = useState<number>(() => (startFromZero ? 0 : safeValue));
    const previousValue = useRef<number>(startFromZero ? 0 : safeValue);
    const animationFrame = useRef<number | null>(null);

    useEffect(() => {
        const endValue = Number.isFinite(value) ? value : 0;
        const startValue = previousValue.current;
        if (startValue === endValue) {
            return;
        }

        if (typeof window === 'undefined' || typeof window.requestAnimationFrame === 'undefined') {
            setDisplayValue(endValue);
            previousValue.current = endValue;
            return;
        }

        const startTime = window.performance.now();
        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / Math.max(durationMs, 1), 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const nextValue = Math.round(startValue + (endValue - startValue) * eased);
            setDisplayValue(nextValue);
            if (progress < 1) {
                animationFrame.current = requestAnimationFrame(animate);
            }
        };

        animationFrame.current = requestAnimationFrame(animate);
        previousValue.current = endValue;

        return () => {
            if (animationFrame.current !== null) {
                cancelAnimationFrame(animationFrame.current);
            }
        };
    }, [value, durationMs]);

    return displayValue;
};

type LeaderboardItemProps = {
    user: User;
    rank: number;
    isCurrentUser: boolean;
    theme: ResolvedTheme;
    maxPoints: number;
    isSpotlighted: boolean;
    xpPulse: boolean;
    rankImpact: boolean;
    rankDelta: number;
    pointsOverride?: number;
    showPoints: boolean;
    leaderboardBadge?: BadgeAchievement | null;
};

const LeaderboardItem: React.FC<LeaderboardItemProps> = ({
    user,
    rank,
    isCurrentUser,
    theme,
    maxPoints,
    isSpotlighted,
    xpPulse,
    rankImpact,
    rankDelta,
    pointsOverride,
    showPoints,
    leaderboardBadge,
}) => {
    const highlight = getLeaderboardHighlight(rank, theme);
    const isDark = theme === 'dark';
    const isTopThree = rank <= 3;
    const resolvedPoints =
        Number.isFinite(pointsOverride)
            ? (pointsOverride as number)
            : resolveFallbackPoints(user);
    const xpPercent = showPoints && maxPoints > 0 ? Math.min((resolvedPoints / maxPoints) * 100, 100) : 0;
    const animatedXp = useAnimatedNumber(
        resolvedPoints,
        isTopThree ? LEADERBOARD_ANIMATION_CONFIG.xpCountDurationMs : LEADERBOARD_ANIMATION_CONFIG.xpUpdateDurationMs,
        true,
    );
    const displayXp = Number.isFinite(animatedXp) ? animatedXp : user.points;
    const streakLabel = resolveStreakLabel(user);
    const badges = resolveUserBadges(user);
    const xpTooltip = showPoints ? getXpTooltip(user) : undefined;

    const containerClasses = [
        'leaderboard-item relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border px-4 py-3 transition-transform duration-200 backdrop-blur-sm',
        highlight
            ? `${highlight.container} leaderboard-shimmer`
            : isDark
                ? 'bg-surface/70 border-border-color/70'
                : 'bg-white/85 border-slate-200 shadow-sm',
        isCurrentUser
            ? isDark
                ? 'leaderboard-you ring-2 ring-primary/70 shadow-[0_0_25px_rgba(59,130,246,0.35)]'
                : 'leaderboard-you ring-2 ring-indigo-300 shadow-[0_0_25px_rgba(99,102,241,0.25)]'
            : '',
        !highlight ? 'hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_0_22px_rgba(56,189,248,0.25)]' : 'hover:-translate-y-1',
        isSpotlighted ? 'leaderboard-spotlight' : '',
        rankImpact ? 'leaderboard-impact' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const emblemClass = highlight
        ? highlight.emblem
        : isDark
            ? 'border-border-color/80 bg-black/30 text-text-secondary'
            : 'border-slate-200 bg-white text-slate-500';

    const nameClass = isDark ? 'text-white' : 'text-slate-900';
    const metaClass = isDark ? 'text-white/70' : 'text-slate-600';
    const xpClass = isDark ? 'text-white' : 'text-slate-900';
    const xpTrack = isDark ? 'bg-black/25' : 'bg-slate-200';
    const xpFlowClass = highlight ? 'leaderboard-xp-flow leaderboard-xp-flow-top' : 'leaderboard-xp-flow';
    const rewardedChip = isDark ? 'bg-black/30 text-emerald-200' : 'bg-emerald-100 text-emerald-600';
    const youChip = isDark ? 'bg-primary/20 text-primary' : 'bg-indigo-100 text-indigo-600';
    const streakChip = isDark ? 'bg-black/35 text-amber-200' : 'bg-amber-100 text-amber-700';
    const badgeChip = isDark ? 'bg-black/25 text-sky-200' : 'bg-sky-100 text-sky-700';
    const spotlightBadgeChip = isDark ? 'bg-indigo-500/20 text-indigo-200' : 'bg-indigo-100 text-indigo-700';
    const deltaUpClass = isDark ? 'text-emerald-300' : 'text-emerald-600';
    const deltaDownClass = isDark ? 'text-rose-300' : 'text-rose-500';
    const deltaNeutralClass = isDark ? 'text-white/50' : 'text-slate-400';
    const showDelta = rankDelta !== 0;
    const deltaLabel = showDelta ? `${Math.abs(rankDelta)} place` : 'No change';
    const spotlightHasImage = Boolean(leaderboardBadge?.imageUrl);
    const SpotlightIcon = leaderboardBadge ? achievementIcons[leaderboardBadge.icon] : null;

    return (
        <li className={containerClasses} data-user-id={user.id}>
            {isTopThree && (
                <div className="pointer-events-none absolute inset-0">
                    <span className="leaderboard-sparkle leaderboard-sparkle-1" />
                    <span className="leaderboard-sparkle leaderboard-sparkle-2" />
                    <span className="leaderboard-sparkle leaderboard-sparkle-3" />
                </div>
            )}
            <div className="leaderboard-energy pointer-events-none absolute inset-0 rounded-xl z-0" />
            <div className="relative z-10 flex items-center gap-4">
                <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg font-bold ${emblemClass} ${
                        xpPulse ? 'leaderboard-rank-pulse' : ''
                    }`}
                >
                    {rank}
                </span>
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-semibold ${nameClass}`}>{user.name}</span>
                        {rank === 1 && (
                            <CrownIcon className={`h-4 w-4 animate-[leaderboardCrown_2.4s_ease-in-out_infinite] ${highlight?.accent ?? ''}`} />
                        )}
                        {highlight && <TrophyIcon className={`h-4 w-4 ${highlight.accent}`} />}
                        {user.claimedRewardIds.length > 0 && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] ${rewardedChip}`}>
                                <GiftIcon className="h-3 w-3" />
                                Rewarded
                            </span>
                        )}
                        {badges.map((badge) => (
                            <span key={`${user.id}-${badge}`} className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${badgeChip}`}>
                                {badge}
                            </span>
                        ))}
                        {leaderboardBadge && (
                            <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${spotlightBadgeChip}`}
                                title={leaderboardBadge.title}
                            >
                                {spotlightHasImage ? (
                                    <img
                                        src={leaderboardBadge.imageUrl ?? ''}
                                        alt={leaderboardBadge.title}
                                        className="h-3 w-3 rounded-full object-cover"
                                    />
                                ) : SpotlightIcon ? (
                                    <SpotlightIcon className="h-3 w-3" />
                                ) : (
                                    <TrophyIcon className="h-3 w-3" />
                                )}
                                <span className="max-w-[110px] truncate">{leaderboardBadge.title}</span>
                            </span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${streakChip}`}>
                            <FireIcon className="h-3 w-3" />
                            {streakLabel}
                        </span>
                        {isCurrentUser && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] ${youChip}`}>You</span>
                        )}
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-3 text-xs ${metaClass}`}>
                        <span>Created {user.tasksCreated}</span>
                        <span>Completed {user.tasksCompleted}</span>
                        <span className="flex items-center gap-1" title="Rank movement since last refresh.">
                            {showDelta ? (
                                <>
                                    <ArrowRightIcon
                                        className={`h-3.5 w-3.5 ${rankDelta > 0 ? `${deltaUpClass} rotate-90` : `${deltaDownClass} -rotate-90`}`}
                                    />
                                    <span className={rankDelta > 0 ? deltaUpClass : deltaDownClass}>{deltaLabel}</span>
                                </>
                            ) : (
                                <span className={deltaNeutralClass}>{deltaLabel}</span>
                            )}
                        </span>
                    </div>
                    <div className="mt-3">
                        <div className={`h-1.5 w-full overflow-hidden rounded-full ${xpTrack}`}>
                            {showPoints && (
                                <div
                                    className={`${xpFlowClass} h-full rounded-full`}
                                    style={{ width: `${xpPercent}%` }}
                                    title={xpTooltip}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="relative z-10 flex flex-col items-end gap-1">
                {showPoints ? (
                    <span className={`text-lg font-bold ${xpClass}`} title={xpTooltip}>
                        {displayXp.toLocaleString()} XP
                    </span>
                ) : (
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.3em] ${metaClass}`}>XP hidden</span>
                )}
                <span className={`flex items-center gap-1 text-[10px] uppercase tracking-[0.3em] ${metaClass}`}>
                    <BoltIcon className="leaderboard-float h-3.5 w-3.5" />
                    Charge
                </span>
            </div>
        </li>
    );
};

type RewardCardProps = {
    reward: Reward;
    userPoints: number;
    hasClaimed: boolean;
    onClaim: (rewardId: string) => void;
    isClaiming: boolean;
    theme: ResolvedTheme;
    userDepartmentId?: string | null;
};

const RewardCard: React.FC<RewardCardProps> = ({
    reward,
    userPoints,
    hasClaimed,
    onClaim,
    isClaiming,
    theme,
    userDepartmentId,
}) => {
    const isDeptEligible = !reward.deptWhitelist || reward.deptWhitelist.includes(userDepartmentId ?? '');
    const alreadyClaimed = hasClaimed && !reward.allowMultipleClaims;
    const canClaim = !alreadyClaimed && isDeptEligible && userPoints >= reward.xpRequired && reward.status === RewardStatus.ACTIVE;
    const progress = alreadyClaimed ? 100 : Math.min((userPoints / Math.max(reward.xpRequired, 1)) * 100, 100);
    const toGo = Math.max(reward.xpRequired - userPoints, 0);
    const isDark = theme === 'dark';
    const isBadgeReward = /badge/i.test(reward.title);
    const deptRestricted = Boolean(reward.deptWhitelist && !isDeptEligible);
    const imageUrl = reward.imageUrl;
    const isHighlighted = canClaim || alreadyClaimed;

    const containerClasses = isHighlighted
        ? isDark
            ? 'border-emerald-300/60 bg-gradient-to-br from-emerald-500/15 via-emerald-400/10 to-sky-500/20 shadow-[0_25px_45px_rgba(16,185,129,0.25)]'
            : theme === 'colorful'
                ? 'border-emerald-200 bg-gradient-to-br from-emerald-100 via-sky-100 to-indigo-100 shadow-[0_25px_45px_rgba(52,211,153,0.25)]'
                : 'border-emerald-200 bg-white shadow-[0_20px_45px_rgba(59,130,246,0.2)]'
        : isDark
            ? 'border-border-color/70 bg-surface/70'
            : 'border-slate-200 bg-white/85 shadow-sm';

    const titleClass = isDark ? 'text-white' : 'text-slate-900';
    const descriptionClass = isDark ? 'text-white/70' : 'text-slate-600';
    const labelClass = isDark ? 'bg-black/30 text-emerald-200' : 'bg-emerald-50 text-emerald-600';
    const progressTrack = isDark ? 'bg-black/30' : 'bg-slate-200';
    const progressFill = isDark
        ? 'from-emerald-400 via-teal-400 to-sky-400'
        : theme === 'colorful'
            ? 'from-emerald-400 via-sky-400 to-indigo-400'
            : 'from-emerald-400 via-sky-400 to-indigo-400';
    const progressMeta = isDark ? 'text-white/70' : 'text-slate-600';

    const buttonClass = alreadyClaimed
        ? isDark
            ? 'bg-white/15 text-white/70 cursor-not-allowed'
            : 'bg-slate-100 text-slate-500 cursor-not-allowed'
        : canClaim
            ? isDark
                ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 text-gray-900 hover:from-emerald-300 hover:via-teal-300 hover:to-sky-300'
                : 'bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 text-white hover:brightness-105 shadow'
            : isDark
                ? 'bg-white/10 text-white/50 cursor-not-allowed'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed';

    const buttonLabel = alreadyClaimed
        ? 'Already claimed'
        : isClaiming
            ? 'Summoning...'
            : canClaim
                ? isBadgeReward
                    ? 'Claim badge'
                    : 'Claim reward'
                : 'Keep grinding';

    return (
        <div className={`relative overflow-hidden rounded-2xl border p-5 backdrop-blur ${containerClasses}`}>
            <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl" />
            <div className="relative space-y-4">
                <div className="flex items-start gap-4">
                    <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                        {imageUrl ? (
                            <img src={imageUrl} alt={reward.title} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <GiftIcon className={isDark ? 'h-6 w-6 text-white/40' : 'h-6 w-6 text-slate-400'} />
                            </div>
                        )}
                    </div>
                    <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className={`text-lg font-semibold line-clamp-2 ${titleClass}`}>{reward.title}</h3>
                                <p className={`mt-1 text-sm line-clamp-4 ${descriptionClass}`}>{reward.description}</p>
                            </div>
                            <span
                                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                                    alreadyClaimed ? 'bg-white/15 text-white' : labelClass
                                }`}
                            >
                                {alreadyClaimed ? 'Collected' : reward.status === RewardStatus.ACTIVE ? 'Active' : reward.status}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/70">
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${labelClass}`}>
                                {reward.xpRequired.toLocaleString()} XP
                            </span>
                            {deptRestricted && (
                                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">Dept restricted</span>
                            )}
                            {!reward.autoRedeem && (
                                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">Approval needed</span>
                            )}
                            {reward.allowMultipleClaims && (
                                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-200">Repeatable</span>
                            )}
                        </div>
                    </div>
                </div>
                <div>
                    <div className={`flex items-center justify-between text-xs ${progressMeta}`}>
                        <span>Progress</span>
                        <span>
                            {progress.toFixed(0)}% {alreadyClaimed ? 'Collected' : canClaim ? 'Ready' : 'Charged'}
                        </span>
                    </div>
                    <div className={`mt-2 h-2 w-full overflow-hidden rounded-full ${progressTrack}`}>
                        <div className={`h-full rounded-full bg-gradient-to-r ${progressFill}`} style={{ width: `${progress}%` }} />
                    </div>
                    <div className={`mt-2 flex items-center justify-between text-xs ${progressMeta}`}>
                        <span>{alreadyClaimed ? 'Enjoy your perk!' : canClaim ? 'Reward ready!' : `${toGo.toLocaleString()} XP to go`}</span>
                        <span className="flex items-center gap-1">
                            <SparklesIcon className="h-3.5 w-3.5" />
                            {isDeptEligible ? 'Eligible department' : 'Dept restricted'}
                        </span>
                    </div>
                </div>
                <button
                    type="button"
                    disabled={!canClaim || isClaiming || alreadyClaimed}
                    onClick={() => onClaim(reward.id)}
                    className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${buttonClass} ${isClaiming ? 'opacity-80' : ''}`}
                >
                    {buttonLabel}
                </button>
            </div>
        </div>
    );
};

type AchievementDetailModalProps = {
    achievement: BadgeAchievement;
    progress: number;
    isUnlocked: boolean;
    onClose: () => void;
    onShare: (achievement: BadgeAchievement) => void;
    onToggleLeaderboardBadge: (achievement: BadgeAchievement) => void;
    isLeaderboardBadge: boolean;
    canSpotlight: boolean;
    theme: ResolvedTheme;
};

const AchievementDetailModal: React.FC<AchievementDetailModalProps> = ({
    achievement,
    progress,
    isUnlocked,
    onClose,
    onShare,
    onToggleLeaderboardBadge,
    isLeaderboardBadge,
    canSpotlight,
    theme,
}) => {
    const isDark = theme === 'dark';
    const isColorful = theme === 'colorful';
    const IconComponent = achievementIcons[achievement.icon];
    const hasImage = Boolean(achievement.imageUrl);

    const surfaceClasses = isDark
        ? 'border-white/15 bg-gradient-to-br from-slate-950 via-indigo-900 to-slate-900 text-white'
        : isColorful
            ? 'border-white/70 bg-gradient-to-br from-white via-sky-50 to-rose-50 text-slate-900 shadow-[0_25px_60px_rgba(129,140,248,0.25)]'
            : 'border-slate-200 bg-white text-slate-900 shadow-[0_25px_60px_rgba(148,163,184,0.25)]';

    const haloClass = `${achievementGlow[achievement.icon]} opacity-90`;
    const metaLabel = isDark ? 'text-white/60' : 'text-slate-500';
    const insightClass = isDark ? 'text-white/75' : 'text-slate-600';
    const progressTrack = isDark ? 'bg-white/10' : 'bg-slate-200';
    const progressFill = isUnlocked
        ? 'from-amber-400 via-purple-400 to-fuchsia-400'
        : isDark
            ? 'from-sky-400 via-indigo-400 to-purple-400'
            : 'from-indigo-400 via-sky-400 to-emerald-400';
    const shareButtonClass = isDark
        ? 'inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-white/25'
        : isColorful
            ? 'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f97316] via-[#ec4899] to-[#6366f1] px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 shadow'
            : 'inline-flex items-center gap-2 rounded-full bg-slate-900/80 px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-slate-900';
    const spotlightButtonClass = isDark
        ? `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] transition ${
            isLeaderboardBadge ? 'bg-emerald-500/20 text-emerald-200' : 'bg-sky-500/20 text-sky-200'
        }`
        : isColorful
            ? `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] transition ${
                isLeaderboardBadge ? 'bg-emerald-100 text-emerald-600' : 'bg-sky-100 text-sky-600'
            }`
            : `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] transition ${
                isLeaderboardBadge ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
            }`;
    const focusChipClass = isDark
        ? 'inline-flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/70'
        : 'inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-600';
    const insightText = achievement.custom ? 'Custom badge configured in Levels Manager.' : achievementInsights[achievement.icon];

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
            <div className={`relative w-full max-w-xl overflow-hidden rounded-3xl border p-8 ${surfaceClasses}`}>
                <button
                    type="button"
                    onClick={onClose}
                    className={`absolute right-6 top-6 transition ${isDark ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-slate-700'}`}
                    aria-label="Close badge details"
                >
                    <XMarkIcon className="h-6 w-6" />
                </button>
                <div className={`pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full blur-3xl ${haloClass}`} />
                <div className="relative">
                    <div className={`flex items-center gap-3 text-xs uppercase tracking-[0.4em] ${metaLabel}`}>
                        <SparklesIcon className={`h-4 w-4 ${isDark ? 'text-amber-200' : 'text-amber-500'}`} />
                        Badge intel
                    </div>
                    <div className="mt-4 flex items-start gap-4">
                        <span className={`flex h-16 w-16 items-center justify-center rounded-2xl ${isDark ? 'bg-black/30 text-amber-200' : 'bg-amber-100 text-amber-600'}`}>
                            {hasImage ? (
                                <img src={achievement.imageUrl ?? ''} alt={achievement.title} className="h-12 w-12 rounded-xl object-cover" />
                            ) : (
                                <IconComponent className="h-10 w-10" />
                            )}
                        </span>
                        <div>
                            <h3 className="text-2xl font-bold">{achievement.title}</h3>
                            <p className={`mt-2 text-sm ${insightClass}`}>{achievement.description}</p>
                            <p className={`mt-3 text-xs font-semibold uppercase tracking-[0.3em] ${isDark ? 'text-amber-200' : 'text-amber-600'}`}>+{achievement.points} XP</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.3em]">
                                <span className={`${isDark ? 'bg-white/10 text-white/70' : 'bg-slate-100 text-slate-600'} rounded-full px-2 py-0.5 font-semibold`}>
                                    {achievement.tier} Tier
                                </span>
                                {achievement.tierGroup && (
                                    <span className={`${isDark ? 'bg-white/10 text-white/60' : 'bg-slate-100 text-slate-500'} rounded-full px-2 py-0.5 font-semibold`}>
                                        Group {achievement.tierOrder}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-6">
                        <div className={`flex items-center justify-between text-xs ${metaLabel}`}>
                            <span>{isUnlocked ? 'Badge unlocked' : 'Progress to unlock'}</span>
                            <span>{progress}%</span>
                        </div>
                        <div className={`mt-2 h-2.5 w-full overflow-hidden rounded-full ${progressTrack}`}>
                            <div
                                className={`h-full rounded-full bg-gradient-to-r ${progressFill}`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className={`mt-4 text-sm ${insightClass}`}>{insightText}</p>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <button type="button" onClick={() => onShare(achievement)} className={shareButtonClass}>
                            <PaperAirplaneIcon className="h-4 w-4" />
                            Share progress
                        </button>
                        {canSpotlight && (
                            <button type="button" onClick={() => onToggleLeaderboardBadge(achievement)} className={spotlightButtonClass}>
                                <TrophyIcon className="h-4 w-4" />
                                {isLeaderboardBadge ? 'Remove spotlight' : 'Show on leaderboard'}
                            </button>
                        )}
                        {!isUnlocked && (
                            <span className={focusChipClass}>
                                <BoltIcon className={`h-4 w-4 ${isDark ? 'text-sky-300' : 'text-indigo-400'}`} />
                                Focus quick wins
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const Achievements: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [achievements, setAchievements] = useState<BadgeAchievement[]>([]);
    const [rewards, setRewards] = useState<Reward[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [pointsHistoryLoading, setPointsHistoryLoading] = useState(false);
    const [visibleAchievementCount, setVisibleAchievementCount] = useState(5);
    const [isClaiming, setIsClaiming] = useState<string | null>(null);
    const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null);
    const [shareFeedback, setShareFeedback] = useState<string | null>(null);
    const [pointsHistoryUserId, setPointsHistoryUserId] = useState<string>('');
    const [pointsHistoryDepartment, setPointsHistoryDepartment] = useState<string>('');
    const [pointsHistoryPage, setPointsHistoryPage] = useState(1);
    const [levelsConfig, setLevelsConfig] = useState<LevelConfig[]>(() => loadLevelsConfig());
    const [levelUpState, setLevelUpState] = useState<{ from: number; to: number } | null>(null);
    const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<LeaderboardTabKey>('contributors');
    const [showLeaderboardPoints, setShowLeaderboardPoints] = useState(() => loadLeaderboardPointsVisibility());
    const [leaderboardBadgeId, setLeaderboardBadgeId] = useState<string>('');
    const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right');
    const [rankDeltaById, setRankDeltaById] = useState<Record<string, number>>({});
    const [xpPulseIds, setXpPulseIds] = useState<Set<string>>(new Set());
    const [rankImpactIds, setRankImpactIds] = useState<Set<string>>(new Set());
    const [refreshPulse, setRefreshPulse] = useState(false);
    const [spotlightUserId, setSpotlightUserId] = useState<string | null>(null);
    const leaderboardListRef = useRef<HTMLDivElement | null>(null);
    const autoScrollTabsRef = useRef<Set<LeaderboardTabKey>>(new Set());
    const previousRankRef = useRef<Map<string, number>>(new Map());
    const previousPointsRef = useRef<Map<string, number>>(new Map());
    const hasLeaderboardInitialized = useRef(false);
    const hasSetInitialLeaderboardTab = useRef(false);
    const xpPulseTimerRef = useRef<number | null>(null);
    const rankImpactTimerRef = useRef<number | null>(null);
    const refreshTimerRef = useRef<number | null>(null);
    const { user: currentUser, updateUserInContext } = useAuth();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const requestedWorkspaceTab = searchParams.get('tab') as AchievementWorkspaceTabKey | null;
    const availableWorkspaceTabs = useMemo(
        () => achievementWorkspaceTabs.filter((tab) => canAccessAchievementWorkspaceTab(currentUser?.role, tab)),
        [currentUser?.role],
    );
    const activeWorkspaceTab = availableWorkspaceTabs.some((tab) => tab.key === requestedWorkspaceTab)
        ? (requestedWorkspaceTab as AchievementWorkspaceTabKey)
        : (availableWorkspaceTabs[0]?.key ?? 'overview');
    const activeWorkspaceTabConfig =
        availableWorkspaceTabs.find((tab) => tab.key === activeWorkspaceTab) ?? achievementWorkspaceTabs[0];
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isOwner = currentUser?.role === Role.OWNER;
    const effectiveShowLeaderboardPoints = isOwner ? showLeaderboardPoints : true;

    useEffect(() => {
        if (!searchParams.get('tab') || requestedWorkspaceTab !== activeWorkspaceTab) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('tab', activeWorkspaceTab);
            setSearchParams(nextParams, { replace: true });
        }
    }, [activeWorkspaceTab, requestedWorkspaceTab, searchParams, setSearchParams]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const idleCallback = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
            .requestIdleCallback;
        if (idleCallback) {
            idleCallback(preloadAchievementTabs);
            return;
        }
        const timeout = window.setTimeout(preloadAchievementTabs, 250);
        return () => window.clearTimeout(timeout);
    }, []);

    const handleWorkspaceTabChange = useCallback(
        (tabKey: AchievementWorkspaceTabKey) => {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('tab', tabKey);
            setSearchParams(nextParams);
        },
        [searchParams, setSearchParams],
    );

    const renderWorkspacePanel = () => {
        switch (activeWorkspaceTab) {
            case 'rewards':
                return <RewardManagementTab />;
            case 'levels':
                return <LevelsManagerTab />;
            case 'points':
                return <PointsTableSettingsTab />;
            case 'templates':
                return <TemplateEditorTab />;
            default:
                return null;
        }
    };

    const achievementsById = useMemo(
        () => new Map(achievements.map((achievement) => [achievement.id, achievement])),
        [achievements],
    );
    const tierMetaById = useMemo(() => {
        const groups = new Map<string, BadgeAchievement[]>();
        achievements.forEach((badge) => {
            if (!badge.tierGroup) {
                return;
            }
            const group = groups.get(badge.tierGroup) ?? [];
            group.push(badge);
            groups.set(badge.tierGroup, group);
        });
        const meta = new Map<string, TierMeta>();
        groups.forEach((group) => {
            group.sort((a, b) => a.tierOrder - b.tierOrder);
            group.forEach((badge, index) => {
                meta.set(badge.id, { index: index + 1, total: group.length, group });
            });
        });
        return meta;
    }, [achievements]);
    const pointsToggleClass = showLeaderboardPoints
        ? isDark
            ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-200'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : isDark
            ? 'border-rose-300/40 bg-rose-500/10 text-rose-200'
            : 'border-rose-200 bg-rose-50 text-rose-700';
    const pointsToggleTrackClass = showLeaderboardPoints
        ? isDark
            ? 'bg-emerald-400/60'
            : 'bg-emerald-400'
        : isDark
            ? 'bg-white/20'
            : 'bg-slate-300';
    const pointsToggleKnobClass = showLeaderboardPoints ? 'left-3.5' : 'left-0.5';
    const pointsBadgeClass = useCallback(
        (tone: TaskPointsTone | undefined) => {
            if (tone === 'positive') {
                return isDark
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : isColorful
                        ? 'border-emerald-300/70 bg-emerald-200/70 text-emerald-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700';
            }
            if (tone === 'negative') {
                return isDark
                    ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                    : isColorful
                        ? 'border-rose-300/70 bg-rose-200/70 text-rose-800'
                        : 'border-rose-200 bg-rose-50 text-rose-700';
            }
            if (tone === 'warning') {
                return isDark
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : isColorful
                        ? 'border-amber-200/70 bg-amber-100/80 text-amber-800'
                        : 'border-amber-200 bg-amber-50 text-amber-700';
            }
            return isDark
                ? 'border-white/20 bg-white/10 text-white/80'
                : isColorful
                    ? 'border-white/60 bg-white/70 text-slate-800'
                    : 'border-slate-200 bg-slate-100 text-slate-700';
        },
        [isDark, isColorful],
    );

    useEffect(() => {
        if (!currentUser?.id) {
            return;
        }
        setLeaderboardBadgeId(loadLeaderboardBadgeId(currentUser.id));
    }, [currentUser?.id]);

    useEffect(() => {
        if (!currentUser?.id) {
            return;
        }
        persistLeaderboardBadgeId(currentUser.id, leaderboardBadgeId);
    }, [currentUser?.id, leaderboardBadgeId]);

    useEffect(() => {
        if (!leaderboardBadgeId) {
            return;
        }
        if (!achievements.some((badge) => badge.id === leaderboardBadgeId)) {
            setLeaderboardBadgeId('');
        }
    }, [achievements, leaderboardBadgeId]);

    useEffect(() => {
        if (!isOwner) {
            return;
        }
        setShowLeaderboardPoints(loadLeaderboardPointsVisibility());
    }, [isOwner]);

    useEffect(() => {
        if (!isOwner) {
            return;
        }
        persistLeaderboardPointsVisibility(showLeaderboardPoints);
    }, [isOwner, showLeaderboardPoints]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [fetchedBadges, fetchedUsers, fetchedRewards, fetchedDepartments] = await Promise.all([
                api.getMyAchievements(),
                api.getUsers(),
                api.getRewards(),
                api.getDepartments(),
            ]);
            setAchievements(fetchedBadges.map(mapBadgeProgressToAchievement));
            setUsers(fetchedUsers.sort((a, b) => b.points - a.points));
            setRewards(fetchedRewards);
            const departmentNames = Array.from(
                new Set(
                    (fetchedDepartments ?? [])
                        .map((dept) => dept.name)
                        .filter((name): name is string => Boolean(name)),
                ),
            );
            setDepartmentOptions(departmentNames.sort((a, b) => a.localeCompare(b)));
        } catch (error) {
            console.error('Failed to fetch achievements data:', error);
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (!currentUser || currentUser.role !== Role.OWNER || tasks.length > 0) {
            return;
        }

        let cancelled = false;
        let timeoutId: number | undefined;

        const loadPointsHistoryTasks = async () => {
            setPointsHistoryLoading(true);
            try {
                const fetchedTasks = await api.getTasks(currentUser.id, currentUser.role);
                if (cancelled) {
                    return;
                }
                const nextTasks = augmentTasksWithPoints(fetchedTasks);
                setTasks(nextTasks);
                setDepartmentOptions((previous) => {
                    if (previous.length > 0) {
                        return previous;
                    }
                    return Array.from(
                        new Set(
                            nextTasks
                                .map((task) => task.team)
                                .filter((name): name is string => Boolean(name)),
                        ),
                    ).sort((a, b) => a.localeCompare(b));
                });
            } catch (error) {
                if (!cancelled) {
                    console.warn('Failed to load points history tasks:', error);
                }
            } finally {
                if (!cancelled) {
                    setPointsHistoryLoading(false);
                }
            }
        };

        const idleCallback = (window as unknown as {
            requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        }).requestIdleCallback;
        if (idleCallback) {
            const idleId = idleCallback(loadPointsHistoryTasks, { timeout: 1500 });
            return () => {
                cancelled = true;
                (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
            };
        }

        timeoutId = window.setTimeout(loadPointsHistoryTasks, 350);
        return () => {
            cancelled = true;
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [currentUser, tasks.length]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            const config = loadPointsConfig();
            setTasks((previous) => augmentTasksWithPoints(previous, { config }));
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
            const detail = (event as CustomEvent).detail as { levels?: LevelConfig[] } | undefined;
            if (detail?.levels) {
                setLevelsConfig(detail.levels);
            } else {
                setLevelsConfig(loadLevelsConfig());
            }
        };

        window.addEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        return () => {
            window.removeEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        };
    }, []);

    const currentUserPoints = useMemo(() => {
        if (!currentUser) {
            return 0;
        }
        return Number.isFinite(currentUser.points) ? currentUser.points : 0;
    }, [currentUser]);
    const currentUserOverallXp = currentUser?.overallXpPoints ?? currentUserPoints;
    const currentUserClaimedXp = currentUser?.claimedXpPoints ?? Math.max(currentUserOverallXp - currentUserPoints, 0);
    const levelProgress = useMemo(
        () => getLevelProgress(currentUserPoints, levelsConfig),
        [currentUserPoints, levelsConfig],
    );
    const playerMetrics = useMemo(() => {
        if (!currentUser) {
            return {
                currentStreak: 0,
                bestStreak: 0,
                daysSinceActive: 0,
                activityScore: 0,
                xpIntoLevel: 0,
                level: 1,
                levelProgress: 0,
                xpToNextLevel: 0,
                levelSpan: 0,
            };
        }
        const activityScore = currentUser.tasksCompleted + currentUser.tasksCreated;
        const currentStreak = Math.max(1, Math.min(30, (activityScore % 9) + 3));
        const bestStreak = Math.max(currentStreak, Math.min(60, Math.floor((currentUserPoints + activityScore * 5) / 45)));
        const daysSinceActive = activityScore % 3;
        const xpIntoLevel = levelProgress.pointsIntoLevel;
        const level = levelProgress.level;
        const levelProgressPercent = levelProgress.progressPercent;
        const xpToNextLevel = levelProgress.pointsToNextLevel;
        const levelSpan = levelProgress.levelSpan;

        return {
            currentStreak,
            bestStreak,
            daysSinceActive,
            activityScore,
            xpIntoLevel,
            level,
            levelProgress: levelProgressPercent,
            xpToNextLevel,
            levelSpan,
        };
    }, [currentUser, currentUserPoints, levelProgress]);

    useEffect(() => {
        if (!currentUser || typeof window === 'undefined') {
            return;
        }
        const storageKey = `${LEVEL_UP_STORAGE_PREFIX}-${currentUser.id}`;
        const stored = window.localStorage.getItem(storageKey);
        const previousLevel = stored !== null ? Number(stored) : null;
        if (previousLevel !== null && Number.isFinite(previousLevel) && levelProgress.level > previousLevel) {
            setLevelUpState({ from: previousLevel, to: levelProgress.level });
        }
        window.localStorage.setItem(storageKey, String(levelProgress.level));
    }, [currentUser, levelProgress.level]);

    useEffect(() => {
        if (!levelUpState) {
            return;
        }
        const timer = window.setTimeout(() => setLevelUpState(null), 2600);
        return () => window.clearTimeout(timer);
    }, [levelUpState]);

    const canSeePointsHistory = Boolean(currentUser?.role === Role.OWNER);
    const canSeeLeadershipTabs = isLeadershipRole(currentUser?.role);

    const leaderboardTabs = useMemo<LeaderboardTab[]>(() => {
        const tabs: LeaderboardTab[] = [];
        if (canSeeLeadershipTabs) {
            tabs.push(
                {
                    key: 'apex',
                    label: 'Apex Board',
                    description: 'All employees ranked by XP.',
                    icon: CrownIcon,
                },
                {
                    key: 'leadership',
                    label: 'Leadership League',
                    description: 'Admins, owners, and managers only.',
                    icon: ShieldCheckIcon,
                },
            );
        }
        tabs.push({
            key: 'contributors',
            label: 'Contributors League',
            description: 'Top 10 individual contributors.',
            icon: BoltIcon,
        });
        return tabs;
    }, [canSeeLeadershipTabs]);

    useEffect(() => {
        if (leaderboardTabs.length === 0) {
            return;
        }
        if (!leaderboardTabs.some((tab) => tab.key === activeLeaderboardTab)) {
            setActiveLeaderboardTab(leaderboardTabs[0].key);
        }
    }, [leaderboardTabs, activeLeaderboardTab]);

    useEffect(() => {
        if (hasSetInitialLeaderboardTab.current) {
            return;
        }
        if (!currentUser) {
            return;
        }
        setActiveLeaderboardTab(canSeeLeadershipTabs ? 'apex' : 'contributors');
        hasSetInitialLeaderboardTab.current = true;
    }, [canSeeLeadershipTabs, currentUser]);

    const handleLeaderboardTabChange = (nextKey: LeaderboardTabKey) => {
        if (nextKey === activeLeaderboardTab) {
            return;
        }
        const currentIndex = leaderboardTabs.findIndex((tab) => tab.key === activeLeaderboardTab);
        const nextIndex = leaderboardTabs.findIndex((tab) => tab.key === nextKey);
        if (currentIndex !== -1 && nextIndex !== -1) {
            setTabDirection(nextIndex > currentIndex ? 'right' : 'left');
        }
        setActiveLeaderboardTab(nextKey);
    };

    const userOptions = useMemo(
        () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
        [users],
    );
    const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
    const leaderboardEligibleUsers = useMemo(
        () => users.filter(isLeaderboardEligibleUser),
        [users],
    );

    const leaderboardPointsByUserId = useMemo(() => {
        const map = new Map<string, number>();
        leaderboardEligibleUsers.forEach((user) => {
            const basePoints = Number.isFinite(user.points) ? user.points : resolveFallbackPoints(user);
            map.set(user.id, basePoints);
        });
        return map;
    }, [leaderboardEligibleUsers]);

    const leaderboardUsers = useMemo(() => {
        const updated = leaderboardEligibleUsers.map((user) => ({
            ...user,
            points: leaderboardPointsByUserId.get(user.id) ?? 0,
        }));
        return updated.slice().sort((a, b) => b.points - a.points);
    }, [leaderboardEligibleUsers, leaderboardPointsByUserId]);

    const leaderboardTabUsers = useMemo(() => {
        if (activeLeaderboardTab === 'leadership') {
            return leaderboardUsers.filter((user) => isLeadershipRole(user.role));
        }
        if (activeLeaderboardTab === 'contributors') {
            return leaderboardUsers.filter((user) => user.role === Role.USER);
        }
        return leaderboardUsers;
    }, [activeLeaderboardTab, leaderboardUsers]);

    const leaderboardTabTopUsers = useMemo(
        () => leaderboardTabUsers.slice(0, 10),
        [leaderboardTabUsers],
    );

    const leaderboardBadgeByUserId = useMemo(() => {
        if (typeof window === 'undefined') {
            return new Map<string, Achievement>();
        }
        const map = new Map<string, Achievement>();
        leaderboardEligibleUsers.forEach((user) => {
            const badgeId =
                currentUser && user.id === currentUser.id
                    ? leaderboardBadgeId
                    : loadLeaderboardBadgeId(user.id);
            if (!badgeId) {
                return;
            }
            const badge = achievementsById.get(badgeId);
            if (badge) {
                map.set(user.id, badge);
            }
        });
        return map;
    }, [achievementsById, currentUser, leaderboardBadgeId, leaderboardEligibleUsers]);

    const activeLeaderboardTabMeta = leaderboardTabs.find((tab) => tab.key === activeLeaderboardTab);
    const maxLeaderboardPoints = useMemo(() => {
        if (leaderboardTabUsers.length === 0) {
            return 0;
        }
        return leaderboardTabUsers.reduce((max, user) => {
            const resolved = Number.isFinite(user.points) ? user.points : 0;
            return Math.max(max, resolved);
        }, 0);
    }, [leaderboardTabUsers]);
    const currentLeaderboardEntry = useMemo(
        () => leaderboardUsers.find((user) => user.id === currentUser?.id) ?? null,
        [leaderboardUsers, currentUser?.id],
    );
    const currentGlobalRank = useMemo(() => {
        if (!currentUser) {
            return null;
        }
        const index = leaderboardUsers.findIndex((user) => user.id === currentUser.id);
        return index >= 0 ? index + 1 : null;
    }, [currentUser, leaderboardUsers]);
    const currentUserRankInTab = useMemo(() => {
        if (!currentUser) {
            return null;
        }
        const index = leaderboardTabUsers.findIndex((user) => user.id === currentUser.id);
        return index >= 0 ? index + 1 : null;
    }, [currentUser, leaderboardTabUsers]);
    const showYourRankCard = currentUserRankInTab !== null && currentUserRankInTab > 10;

    useEffect(() => {
        if (leaderboardUsers.length === 0) {
            return;
        }

        const nextRank = new Map<string, number>();
        const nextPoints = new Map<string, number>();
        const nextDelta: Record<string, number> = {};
        const nextXpPulse = new Set<string>();
        const nextRankImpact = new Set<string>();

        leaderboardUsers.forEach((user, index) => {
            const rank = index + 1;
            nextRank.set(user.id, rank);
            nextPoints.set(user.id, user.points);

            const previousRank = previousRankRef.current.get(user.id);
            if (hasLeaderboardInitialized.current && previousRank !== undefined && previousRank !== rank) {
                nextDelta[user.id] = previousRank - rank;
                nextRankImpact.add(user.id);
            } else {
                nextDelta[user.id] = 0;
            }

            const previousPoints = previousPointsRef.current.get(user.id);
            if (hasLeaderboardInitialized.current && previousPoints !== undefined && previousPoints !== user.points) {
                nextXpPulse.add(user.id);
            }
        });

        previousRankRef.current = nextRank;
        previousPointsRef.current = nextPoints;
        setRankDeltaById(nextDelta);

        if (hasLeaderboardInitialized.current) {
            if (nextXpPulse.size > 0) {
                setXpPulseIds(nextXpPulse);
                if (xpPulseTimerRef.current !== null) {
                    window.clearTimeout(xpPulseTimerRef.current);
                }
                xpPulseTimerRef.current = window.setTimeout(
                    () => setXpPulseIds(new Set()),
                    LEADERBOARD_ANIMATION_CONFIG.rankPulseMs,
                );
            }
            if (nextRankImpact.size > 0) {
                setRankImpactIds(nextRankImpact);
                if (rankImpactTimerRef.current !== null) {
                    window.clearTimeout(rankImpactTimerRef.current);
                }
                rankImpactTimerRef.current = window.setTimeout(
                    () => setRankImpactIds(new Set()),
                    LEADERBOARD_ANIMATION_CONFIG.impactFlashMs,
                );
            }
        }

        hasLeaderboardInitialized.current = true;

        setRefreshPulse(true);
        if (refreshTimerRef.current !== null) {
            window.clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setTimeout(
            () => setRefreshPulse(false),
            LEADERBOARD_ANIMATION_CONFIG.refreshMs,
        );
    }, [leaderboardUsers]);

    useEffect(() => {
        if (!currentUser) {
            return;
        }
        if (!leaderboardListRef.current) {
            return;
        }
        if (autoScrollTabsRef.current.has(activeLeaderboardTab)) {
            return;
        }
        const target = leaderboardListRef.current.querySelector(`[data-user-id="${currentUser.id}"]`);
        if (target && typeof (target as HTMLElement).scrollIntoView === 'function') {
            (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            autoScrollTabsRef.current.add(activeLeaderboardTab);
            setSpotlightUserId(currentUser.id);
            const timer = window.setTimeout(
                () => setSpotlightUserId(null),
                LEADERBOARD_ANIMATION_CONFIG.spotlightDurationMs,
            );
            return () => window.clearTimeout(timer);
        }
    }, [activeLeaderboardTab, currentUser, leaderboardTabTopUsers]);

    useEffect(() => {
        return () => {
            if (xpPulseTimerRef.current !== null) {
                window.clearTimeout(xpPulseTimerRef.current);
            }
            if (rankImpactTimerRef.current !== null) {
                window.clearTimeout(rankImpactTimerRef.current);
            }
            if (refreshTimerRef.current !== null) {
                window.clearTimeout(refreshTimerRef.current);
            }
        };
    }, []);

    const pointsHistoryItems = useMemo(() => {
        let filtered = tasks;
        if (pointsHistoryUserId) {
            filtered = filtered.filter((task) => {
                const assignedMatch = task.assignedTo?.includes(pointsHistoryUserId) ?? false;
                const createdMatch = task.createdBy === pointsHistoryUserId;
                return assignedMatch || createdMatch;
            });
        }
        if (pointsHistoryDepartment) {
            const normalized = normalizeDepartmentKey(pointsHistoryDepartment);
            filtered = filtered.filter((task) => normalizeDepartmentKey(task.team) === normalized);
        }

        return filtered
            .map((task) => {
                const summary = task.pointsBreakdown ? summarizeTaskPoints(task.pointsBreakdown) : null;
                const userPoints = pointsHistoryUserId
                    ? calculateUserPointsForTask(task, pointsHistoryUserId, { usersById })
                    : null;
                const createdByName = usersById.get(task.createdBy)?.name ?? 'Unknown';
                const assignees = (task.assignedTo ?? [])
                    .map((id) => usersById.get(id)?.name)
                    .filter((name): name is string => Boolean(name));
                const updatedAt = task.completedAt || task.updatedAt || task.createdAt;
                const dateValue = updatedAt ? new Date(updatedAt).getTime() : 0;

                let pointsLabel = summary?.label ?? 'Points';
                let pointsValue = summary ? formatPointsValue(summary.value) : '0';
                let pointsNumber = summary?.value ?? 0;
                let pointsTone = summary?.tone;
                let pointsDetail = summary?.detail ?? '';

                if (userPoints) {
                    const detailParts: string[] = [];
                    if (userPoints.taskPoints && userPoints.taskSummary) {
                        detailParts.push(`${userPoints.taskSummary.label} ${formatPointsValue(userPoints.taskSummary.value)}`);
                    }
                    if (userPoints.creationPoints) {
                        detailParts.push(`Creation ${formatPointsValue(userPoints.creationPoints)}`);
                    }
                    if (userPoints.clarityPoints) {
                        detailParts.push(`Clarity ${formatPointsValue(userPoints.clarityPoints)}`);
                    }
                    if (userPoints.managerPenalty) {
                        detailParts.push(`Manager penalty ${formatPointsValue(userPoints.managerPenalty)}`);
                    }

                    pointsNumber = userPoints.total;
                    pointsValue = formatPointsValue(userPoints.total);
                    if (detailParts.length > 1) {
                        pointsLabel = 'Total points';
                    } else if (userPoints.creationPoints && !userPoints.taskPoints) {
                        pointsLabel = 'Creator points';
                    } else {
                        pointsLabel = userPoints.taskSummary?.label ?? 'Points';
                    }
                    pointsDetail = detailParts.join(' • ');
                    pointsTone = userPoints.taskSummary?.tone ?? 'neutral';
                }

                return {
                    id: task.id,
                    title: task.title || 'Untitled task',
                    team: task.team || 'General',
                    statusLabel: CUSTOM_STATUS_NAMES[task.status]?.name ?? task.status,
                    priority: task.priority,
                    createdByName,
                    assigneesLabel: assignees.length ? assignees.join(', ') : 'Unassigned',
                    dateLabel: formatDate(updatedAt, true),
                    dateValue,
                    pointsLabel,
                    pointsValue,
                    pointsNumber,
                    pointsTone,
                    pointsDetail,
                };
            })
            .sort((a, b) => b.dateValue - a.dateValue);
    }, [tasks, pointsHistoryUserId, pointsHistoryDepartment, usersById]);

    const pointsHistoryTotal = pointsHistoryItems.length;
    const pointsHistoryPages = Math.max(1, Math.ceil(pointsHistoryTotal / POINTS_HISTORY_PAGE_SIZE));
    const resolvedHistoryPage = Math.min(pointsHistoryPage, pointsHistoryPages);
    const pointsHistoryStart = (resolvedHistoryPage - 1) * POINTS_HISTORY_PAGE_SIZE;
    const pointsHistoryEnd = pointsHistoryStart + POINTS_HISTORY_PAGE_SIZE;
    const pointsHistoryPageItems = pointsHistoryItems.slice(pointsHistoryStart, pointsHistoryEnd);
    const selectedUserPointsTotal = useMemo(() => {
        if (!pointsHistoryUserId) {
            return null;
        }
        const total = pointsHistoryItems.reduce((sum, item) => sum + (item.pointsNumber || 0), 0);
        return formatPointsValue(total);
    }, [pointsHistoryItems, pointsHistoryUserId]);

    useEffect(() => {
        setPointsHistoryPage(1);
    }, [pointsHistoryUserId, pointsHistoryDepartment]);

    useEffect(() => {
        if (pointsHistoryPage > pointsHistoryPages) {
            setPointsHistoryPage(pointsHistoryPages);
        }
    }, [pointsHistoryPage, pointsHistoryPages]);

    const isAchievementUnlocked = useCallback(
        (achievement: BadgeAchievement) => achievement.status === 'earned',
        [],
    );

    const achievementProgressMap = useMemo(() => {
        return achievements.reduce<Record<string, number>>((acc, achievement) => {
            const baseProgress = achievement.status === 'earned' ? 100 : achievement.progressPercent ?? 0;
            acc[achievement.id] = Math.max(0, Math.min(100, Math.round(baseProgress)));
            return acc;
        }, {});
    }, [achievements]);

    const unlockedCount = useMemo(
        () => achievements.filter((achievement) => isAchievementUnlocked(achievement)).length,
        [achievements, isAchievementUnlocked],
    );
    const visibleAchievements = useMemo(
        () => achievements.slice(0, visibleAchievementCount),
        [achievements, visibleAchievementCount],
    );
    const hasMoreAchievementsToRender = visibleAchievementCount < achievements.length;

    useEffect(() => {
        setVisibleAchievementCount(5);
    }, [achievements]);

    useEffect(() => {
        if (!hasMoreAchievementsToRender) {
            return;
        }
        const timer = window.setTimeout(() => {
            setVisibleAchievementCount((previous) => Math.min(previous + 5, achievements.length));
        }, 80);
        return () => window.clearTimeout(timer);
    }, [achievements.length, hasMoreAchievementsToRender, visibleAchievementCount]);

    const seasonalChallenges = useMemo<SeasonalChallenge[]>(() => {
        if (!currentUser) {
            return [];
        }
        const { currentStreak, bestStreak, activityScore } = playerMetrics;
        return [
            {
                id: 'aurora-sprint',
                title: 'Aurora Sprint',
                description: 'Deliver five collaborative tasks back-to-back without a miss.',
                progress: Math.min(100, Math.round((currentStreak / Math.max(1, bestStreak)) * 100)),
                reward: 'Aurora Trail',
                xpReward: 400,
                expiresIn: '3 days left',
                accent: 'from-fuchsia-500/15 via-purple-500/20 to-sky-500/15',
                icon: RocketLaunchIcon,
            },
            {
                id: 'after-hours-raid',
                title: 'After Hours Raid',
                description: 'Close three priority tasks after twilight to earn the glow badge.',
                progress: Math.min(100, (activityScore % 5) * 20),
                reward: 'Night Runner Badge',
                xpReward: 320,
                expiresIn: 'Ends Friday',
                accent: 'from-slate-700/50 via-indigo-600/40 to-purple-600/30',
                icon: FireIcon,
            },
            {
                id: 'mentors-circle',
                title: 'Mentor\'s Circle',
                description: 'Log two knowledge drops or peer reviews to empower the crew.',
                progress: Math.min(100, Math.round((currentUser.clarityScores.length % 4) * 25)),
                reward: 'Guiding Light Halo',
                xpReward: 280,
                expiresIn: '1 week left',
                accent: 'from-emerald-400/20 via-teal-400/20 to-cyan-400/20',
                icon: AcademicCapIcon,
            },
        ];
    }, [currentUser, playerMetrics]);

    const progressionMilestones = useMemo<ProgressionStep[]>(() => {
        if (!currentUser || levelsConfig.length === 0) {
            return [];
        }
        const currentIndex = Math.max(
            0,
            levelsConfig.findIndex((level) => level.level === levelProgress.level),
        );
        const basePoints = levelsConfig[currentIndex]?.pointsRequired ?? 0;
        const upcoming = levelsConfig.slice(currentIndex + 1, currentIndex + 5);
        return upcoming.map((level, index) => {
            const xpEnd = level.pointsRequired;
            const totalXp = currentUserPoints;
            const progressPct =
                xpEnd <= basePoints
                    ? 100
                    : Math.round(((totalXp - basePoints) / (xpEnd - basePoints)) * 100);
            const fallback = progressionBlueprint[index];
            return {
                level: level.level,
                xpRequired: xpEnd,
                title: level.title || fallback?.title || `Level ${level.level}`,
                reward: level.reward?.title || fallback?.reward || 'Mystery reward',
                progress: Math.max(0, Math.min(100, progressPct)),
                isUnlocked: totalXp >= xpEnd,
            };
        });
    }, [currentUser, currentUserPoints, levelProgress.level, levelsConfig]);

    const selectedAchievement = useMemo(
        () => achievements.find((achievement) => achievement.id === selectedAchievementId) ?? null,
        [achievements, selectedAchievementId]
    );

    const handleShare = useCallback(
        async (overrideText?: string) => {
            if (!currentUser) return;
            const defaultText = `I just reached Level ${playerMetrics.level} with ${currentUserPoints.toLocaleString()} XP and ${unlockedCount} badges in Zea.Play!`;
            const shareText = overrideText ?? defaultText;

            if (typeof navigator === 'undefined') {
                setShareFeedback('Sharing not supported in this environment.');
                return;
            }

            try {
                if ('share' in navigator && typeof navigator.share === 'function') {
                    await navigator.share({ title: 'Zea.Play Achievements', text: shareText });
                    setShareFeedback('Shared! Rally the squad.');
                    return;
                }

                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(shareText);
                    setShareFeedback('Copied to clipboard. Drop it in chat!');
                    return;
                }

                setShareFeedback('Sharing not available. Copy manually?');
            } catch (error) {
                console.error('Share failed', error);
                setShareFeedback('Share cancelled. Try again?');
            }
        },
        [currentUser, playerMetrics.level, unlockedCount]
    );

    const handleToggleLeaderboardBadge = useCallback((achievement: BadgeAchievement) => {
        setLeaderboardBadgeId((current) => (current === achievement.id ? '' : achievement.id));
    }, []);

    useEffect(() => {
        if (!shareFeedback) return;
        const timer = window.setTimeout(() => setShareFeedback(null), 2600);
        return () => window.clearTimeout(timer);
    }, [shareFeedback]);

    const handleClaimReward = async (rewardId: string) => {
        if (!currentUser) return;
        setIsClaiming(rewardId);
        try {
            await api.claimReward(rewardId);
            const refreshedUser = await api.getCurrentUser();
            if (refreshedUser) {
                updateUserInContext(refreshedUser);
            }
            const fetchedUsers = await api.getUsers();
            setUsers(fetchedUsers.sort((a, b) => b.points - a.points));
            window.dispatchEvent(new Event(APP_REFRESH_EVENT));
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsClaiming(null);
        }
    };

    if (loading) {
        return <PageLoader />;
    }

    if (!currentUser) return null;

    const rankAccent = isDark ? 'text-amber-200' : isColorful ? 'text-amber-500' : 'text-amber-600';
    const badgesAccent = isDark ? 'text-emerald-200' : isColorful ? 'text-emerald-500' : 'text-emerald-600';
    const xpAccent = isDark ? 'text-sky-200' : isColorful ? 'text-indigo-500' : 'text-indigo-600';

    const heroBorder = isDark ? 'border-primary/40' : isColorful ? 'border-pink-200/50' : 'border-slate-200';
    const heroGradient = isDark
        ? 'from-[#1e1b4b] via-[#312e81] to-[#4c1d95]'
        : isColorful
            ? 'from-[#c4b5fd] via-[#fbcfe8] to-[#a5f3fc]'
            : 'from-[#ede9fe] via-[#dbeafe] to-[#fef9c3]';
    const haloPrimary = isDark ? 'bg-primary/30' : isColorful ? 'bg-pink-200/60' : 'bg-indigo-200/60';
    const haloSecondary = isDark ? 'bg-rose-500/20' : isColorful ? 'bg-amber-200/60' : 'bg-rose-200/60';
    const heroSurface = isDark
        ? 'border-white/15 bg-black/25'
        : isColorful
            ? 'border-white/60 bg-white/40 shadow-[0_35px_70px_rgba(167,139,250,0.35)]'
            : 'border-slate-200 bg-white shadow-[0_35px_70px_rgba(148,163,184,0.25)]';
    const heroPrimaryText = isDark ? 'text-white' : 'text-slate-900';
    const heroSecondaryText = isDark ? 'text-white/80' : 'text-slate-600';
    const heroSubtleText = isDark ? 'text-white/60' : 'text-slate-500';
    const streakBadgeClass = isDark
        ? 'inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-white/70'
        : isColorful
            ? 'inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs uppercase tracking-[0.35em] text-rose-500 shadow-sm'
            : 'inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs uppercase tracking-[0.35em] text-rose-500 shadow';

    const shareButtonClass = isDark
        ? 'inline-flex items-center gap-2 rounded-full bg-white/20 px-5 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/30'
        : isColorful
            ? 'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f97316] via-[#ec4899] to-[#6366f1] px-5 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white shadow-lg transition hover:brightness-110'
            : 'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#fbbf24] via-[#f472b6] to-[#60a5fa] px-5 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-900 shadow transition hover:shadow-lg';

    const shareFeedbackClass = isDark
        ? 'rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary'
        : isColorful
            ? 'rounded-2xl border border-pink-200 bg-white/85 px-4 py-3 text-sm text-fuchsia-600 shadow-[0_10px_25px_rgba(236,72,153,0.2)]'
            : 'rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm';

    const leaderboardAnimationStyle = {
        '--leaderboard-tab-duration': `${LEADERBOARD_ANIMATION_CONFIG.tabDurationMs}ms`,
        '--leaderboard-shimmer-duration': `${LEADERBOARD_ANIMATION_CONFIG.shimmerDurationMs}ms`,
        '--leaderboard-sparkle-duration': `${LEADERBOARD_ANIMATION_CONFIG.sparkleDurationMs}ms`,
        '--leaderboard-energy-duration': `${LEADERBOARD_ANIMATION_CONFIG.energyFlowDurationMs}ms`,
        '--leaderboard-pulse-duration': `${LEADERBOARD_ANIMATION_CONFIG.pulseDurationMs}ms`,
        '--leaderboard-spotlight-duration': `${LEADERBOARD_ANIMATION_CONFIG.spotlightDurationMs}ms`,
        '--leaderboard-impact-duration': `${LEADERBOARD_ANIMATION_CONFIG.impactFlashMs}ms`,
        '--leaderboard-refresh-duration': `${LEADERBOARD_ANIMATION_CONFIG.refreshMs}ms`,
        '--leaderboard-rank-pulse-duration': `${LEADERBOARD_ANIMATION_CONFIG.rankPulseMs}ms`,
    } as React.CSSProperties;

    const lastActiveLabel = formatRelativeDay(playerMetrics.daysSinceActive);
    const nextLevel = levelProgress.nextLevel;
    const currentLevelReward = levelProgress.currentLevel.reward;
    const nextLevelReward = levelProgress.nextLevel?.reward;

    return (
        <div className="space-y-8">
            <section className="rounded-3xl border border-border-color/70 bg-surface/70 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-sm sm:p-5">
                <div className="flex flex-wrap gap-3">
                    {availableWorkspaceTabs.map((tab) => {
                        const isActive = tab.key === activeWorkspaceTab;
                        const TabIcon = tab.icon;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => handleWorkspaceTabChange(tab.key)}
                                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition ${
                                    isActive
                                        ? 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_18px_rgba(99,102,241,0.18)]'
                                        : 'border-border-color/70 bg-background/40 text-text-secondary hover:border-primary/40 hover:text-text-primary'
                                }`}
                            >
                                <TabIcon className="h-4 w-4" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
                <p className="mt-4 text-sm text-text-secondary">{activeWorkspaceTabConfig.description}</p>
            </section>

            {activeWorkspaceTab === 'overview' ? (
            <div className="space-y-12">
                <style>{`
                @keyframes levelBlast {
                    0% { transform: scale(0.7); opacity: 0; }
                    40% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1.7); opacity: 0; }
                }
                @keyframes levelJump {
                    0% { transform: translateY(0) scale(1); }
                    40% { transform: translateY(-8px) scale(1.08); }
                    100% { transform: translateY(0) scale(1); }
                }
                @keyframes leaderboardTabIn {
                    from { opacity: 0; transform: translateX(var(--leaderboard-tab-slide, 14px)); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes leaderboardShimmer {
                    0% { transform: translateX(-120%); opacity: 0; }
                    15% { opacity: 0.9; }
                    50% { opacity: 0.6; }
                    100% { transform: translateX(220%); opacity: 0; }
                }
                @keyframes leaderboardSparkle {
                    0% { transform: translateY(0) scale(0.6); opacity: 0; }
                    30% { opacity: 0.9; }
                    100% { transform: translateY(-14px) scale(1); opacity: 0; }
                }
                @keyframes leaderboardCrown {
                    0% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                    100% { transform: translateY(0); }
                }
                @keyframes leaderboardPulse {
                    0% { opacity: 0.45; }
                    50% { opacity: 1; }
                    100% { opacity: 0.45; }
                }
                @keyframes leaderboardEnergy {
                    0% { transform: translateX(-120%); opacity: 0; }
                    20% { opacity: 0.6; }
                    100% { transform: translateX(120%); opacity: 0; }
                }
                @keyframes leaderboardFlow {
                    0% { background-position: 0% 50%; }
                    100% { background-position: 200% 50%; }
                }
                @keyframes leaderboardFloat {
                    0% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                    100% { transform: translateY(0); }
                }
                @keyframes leaderboardSpotlight {
                    0% { box-shadow: 0 0 0 rgba(56,189,248,0); }
                    40% { box-shadow: 0 0 30px rgba(56,189,248,0.35); }
                    100% { box-shadow: 0 0 0 rgba(56,189,248,0); }
                }
                @keyframes leaderboardImpact {
                    0% { opacity: 0; transform: scale(0.9); }
                    40% { opacity: 1; }
                    100% { opacity: 0; transform: scale(1.1); }
                }
                @keyframes leaderboardBurst {
                    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
                    40% { opacity: 0.9; }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); }
                }
                @keyframes leaderboardRefresh {
                    0% { transform: translateY(0); box-shadow: 0 0 0 rgba(56,189,248,0); }
                    35% { transform: translateY(-2px); box-shadow: 0 0 24px rgba(56,189,248,0.25); }
                    100% { transform: translateY(0); box-shadow: 0 0 0 rgba(56,189,248,0); }
                }
                @keyframes leaderboardDrift {
                    0% { transform: translateX(-10%); }
                    50% { transform: translateX(10%); }
                    100% { transform: translateX(-10%); }
                }
                @keyframes leaderboardYouGlow {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                @keyframes leaderboardRankPulse {
                    0% { transform: scale(1); box-shadow: 0 0 0 rgba(99,102,241,0); }
                    50% { transform: scale(1.08); box-shadow: 0 0 18px rgba(99,102,241,0.35); }
                    100% { transform: scale(1); box-shadow: 0 0 0 rgba(99,102,241,0); }
                }
                .leaderboard-tab {
                    position: relative;
                    transition: opacity 200ms ease;
                }
                .leaderboard-tab-active::after {
                    content: '';
                    position: absolute;
                    left: 10%;
                    right: 10%;
                    bottom: -6px;
                    height: 2px;
                    border-radius: 9999px;
                    background: linear-gradient(90deg, rgba(251,191,36,0.2), rgba(251,191,36,0.8), rgba(251,191,36,0.2));
                    box-shadow: 0 0 12px rgba(251,191,36,0.5);
                    animation: leaderboardPulse var(--leaderboard-pulse-duration, 2800ms) ease-in-out infinite;
                }
                .leaderboard-tab-panel {
                    animation: leaderboardTabIn var(--leaderboard-tab-duration, 360ms) ease;
                }
                .leaderboard-shimmer::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -60%;
                    width: 45%;
                    height: 100%;
                    background: linear-gradient(120deg, transparent, rgba(255,255,255,0.16), transparent);
                    opacity: 0;
                    pointer-events: none;
                    mix-blend-mode: screen;
                    animation: leaderboardShimmer var(--leaderboard-shimmer-duration, 7200ms) ease-in-out infinite;
                }
                .leaderboard-sparkle {
                    position: absolute;
                    width: 6px;
                    height: 6px;
                    border-radius: 9999px;
                    background: rgba(251,191,36,0.8);
                    box-shadow: 0 0 12px rgba(251,191,36,0.6);
                    animation: leaderboardSparkle var(--leaderboard-sparkle-duration, 6400ms) ease-in-out infinite;
                }
                .leaderboard-sparkle-1 { top: 18%; left: 14%; animation-delay: 0ms; }
                .leaderboard-sparkle-2 { top: 62%; left: 70%; animation-delay: 1200ms; }
                .leaderboard-sparkle-3 { top: 40%; left: 52%; animation-delay: 2600ms; }
                .leaderboard-energy::before,
                .leaderboard-energy::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 40%;
                    background: linear-gradient(90deg, transparent, rgba(56,189,248,0.35), transparent);
                    opacity: 0;
                    animation: leaderboardEnergy var(--leaderboard-energy-duration, 2400ms) linear infinite;
                }
                .leaderboard-energy::after {
                    animation-delay: 1200ms;
                }
                .leaderboard-xp-flow {
                    background-image: linear-gradient(90deg, rgba(56,189,248,0.2), rgba(99,102,241,0.7), rgba(56,189,248,0.2));
                    background-size: 200% 100%;
                    animation: leaderboardFlow var(--leaderboard-energy-duration, 2400ms) linear infinite;
                }
                .leaderboard-xp-flow-top {
                    background-image: linear-gradient(90deg, rgba(251,191,36,0.25), rgba(251,191,36,0.85), rgba(251,191,36,0.25));
                }
                .leaderboard-float {
                    animation: leaderboardFloat 3200ms ease-in-out infinite;
                }
                .leaderboard-you {
                    position: relative;
                }
                .leaderboard-you::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    background: linear-gradient(120deg, rgba(59,130,246,0.18), rgba(14,165,233,0.2), rgba(59,130,246,0.18));
                    background-size: 200% 200%;
                    opacity: 0.8;
                    pointer-events: none;
                    animation: leaderboardYouGlow 9s ease-in-out infinite;
                }
                .leaderboard-spotlight {
                    animation: leaderboardSpotlight var(--leaderboard-spotlight-duration, 1500ms) ease-out;
                }
                .leaderboard-impact::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    background: radial-gradient(circle at 20% 20%, rgba(56,189,248,0.35), transparent 55%);
                    opacity: 0;
                    pointer-events: none;
                    animation: leaderboardImpact var(--leaderboard-impact-duration, 450ms) ease-out;
                }
                .leaderboard-impact::before {
                    content: '';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 4px;
                    height: 4px;
                    border-radius: 9999px;
                    background: rgba(56,189,248,0.9);
                    box-shadow: 10px -8px rgba(56,189,248,0.7), -12px -4px rgba(56,189,248,0.6), 8px 10px rgba(56,189,248,0.5), -10px 8px rgba(56,189,248,0.6);
                    opacity: 0;
                    pointer-events: none;
                    animation: leaderboardBurst var(--leaderboard-impact-duration, 450ms) ease-out;
                }
                .leaderboard-refresh {
                    animation: leaderboardRefresh var(--leaderboard-refresh-duration, 650ms) ease-out;
                }
                .leaderboard-drift::before {
                    content: '';
                    position: absolute;
                    inset: -40% 0 0;
                    border-radius: inherit;
                    background: radial-gradient(circle at top, rgba(56,189,248,0.12), transparent 60%);
                    opacity: 0.65;
                    animation: leaderboardDrift 18s ease-in-out infinite;
                    pointer-events: none;
                }
                .leaderboard-rank-pulse {
                    animation: leaderboardRankPulse var(--leaderboard-rank-pulse-duration, 700ms) ease-out;
                }
                @media (prefers-reduced-motion: reduce) {
                    .leaderboard-tab-panel,
                    .leaderboard-shimmer::after,
                    .leaderboard-sparkle,
                    .leaderboard-energy::before,
                    .leaderboard-energy::after,
                    .leaderboard-xp-flow,
                    .leaderboard-float,
                    .leaderboard-you,
                    .leaderboard-spotlight,
                    .leaderboard-impact::after,
                    .leaderboard-impact::before,
                    .leaderboard-refresh,
                    .leaderboard-drift::before,
                    .leaderboard-rank-pulse,
                    .leaderboard-tab-active::after {
                        animation: none !important;
                    }
                }
            `}</style>
            {levelUpState && (
                <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute h-72 w-72 rounded-full border border-amber-200/50 bg-amber-200/10 shadow-[0_0_80px_rgba(251,191,36,0.35)] animate-[levelBlast_1.8s_ease-out_forwards]" />
                    <div className="relative rounded-3xl border border-amber-200/40 bg-slate-950/80 px-8 py-6 text-center text-white shadow-[0_25px_70px_rgba(251,191,36,0.25)]">
                        <p className="text-xs uppercase tracking-[0.4em] text-amber-200">Level Up</p>
                        <p className="mt-2 text-3xl font-bold">Lv {levelUpState.to}</p>
                        <p className="mt-1 text-sm text-white/70">Blast unlocked. New rewards ahead.</p>
                    </div>
                </div>
            )}
            <section className={`relative overflow-hidden rounded-3xl border ${heroBorder} bg-gradient-to-br ${heroGradient} p-8 shadow-[0_25px_70px_rgba(76,29,149,0.45)]`}>
                <div className={`pointer-events-none absolute -top-32 -right-10 h-64 w-64 rounded-full ${haloPrimary} blur-3xl`} />
                <div className={`pointer-events-none absolute bottom-0 left-0 h-48 w-48 rounded-full ${haloSecondary} blur-3xl`} />
                <div className="relative grid gap-8 lg:grid-cols-[1.2fr,1fr]">
                    <div>
                        <div className={`flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.4em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                            <StarIcon className={`h-5 w-5 ${isDark ? 'text-amber-300' : 'text-indigo-500'}`} />
                            Legends Arena
                        </div>
                        <h1 className={`mt-3 text-4xl font-extrabold drop-shadow ${heroPrimaryText}`}>Achievements &amp; Leaderboard</h1>
                        <p className={`mt-3 max-w-xl text-sm ${heroSecondaryText}`}>
                            Smash quests, collect rare badges, and climb the leaderboard. Every task you conquer powers up your squad and unlocks new rewards.
                        </p>
                        <div className="mt-6 flex flex-wrap gap-4">
                            <StatPill icon={TrophyIcon} label="Global Rank" value={currentGlobalRank ? `#${currentGlobalRank}` : '--'} accent={rankAccent} theme={resolvedTheme} />
                            <StatPill icon={SparklesIcon} label="Badges" value={`${unlockedCount}/${achievements.length}`} accent={badgesAccent} theme={resolvedTheme} />
                            <StatPill icon={BoltIcon} label="Total XP" value={currentUserPoints.toLocaleString()} accent={xpAccent} theme={resolvedTheme} />
                            <StatPill icon={FireIcon} label="Overall XP" value={currentUserOverallXp.toLocaleString()} accent={rankAccent} theme={resolvedTheme} />
                            <StatPill icon={GiftIcon} label="Claimed XP" value={currentUserClaimedXp.toLocaleString()} accent={badgesAccent} theme={resolvedTheme} />
                        </div>
                        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
                            <span className={streakBadgeClass}>
                                <FireIcon className={`h-4 w-4 ${isDark ? 'text-rose-300' : 'text-rose-500'}`} />
                                Streak {playerMetrics.currentStreak} days
                            </span>
                            <span className={heroSubtleText}>Best streak {playerMetrics.bestStreak} days • Last active {lastActiveLabel}</span>
                        </div>
                        <div className="mt-8">
                            <button type="button" onClick={() => handleShare()} className={shareButtonClass}>
                                <PaperAirplaneIcon className="h-4 w-4" />
                                Share highlight
                            </button>
                        </div>
                    </div>
                    <div className={`relative space-y-5 rounded-2xl border ${heroSurface} p-6 backdrop-blur`}>
                        <div className={`flex items-start justify-between ${heroPrimaryText}`}>
                            <div>
                                <p className={`text-xs uppercase tracking-[0.3em] ${heroSubtleText}`}>Level</p>
                                <p className={`text-3xl font-bold ${levelUpState ? 'animate-[levelJump_0.6s_ease-out]' : ''}`}>Lv {playerMetrics.level}</p>
                            </div>
                            <RocketLaunchIcon className={`h-10 w-10 ${isDark ? 'text-amber-300' : 'text-indigo-500'}`} />
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-rose-400 to-purple-500"
                                style={{ width: `${playerMetrics.levelProgress}%` }}
                            />
                        </div>
                        <div className={`flex items-center justify-between text-xs ${heroSubtleText}`}>
                            <span>
                                {playerMetrics.xpIntoLevel.toLocaleString()} / {playerMetrics.levelSpan.toLocaleString()} XP
                            </span>
                            {levelProgress.nextLevel ? (
                                <span>{playerMetrics.xpToNextLevel.toLocaleString()} XP to Lv {levelProgress.nextLevel.level}</span>
                            ) : (
                                <span>Max level reached</span>
                            )}
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                            <p className="text-[10px] uppercase tracking-[0.35em] text-white/40">Level Rewards</p>
                            <p className="mt-2 text-sm text-white">
                                {currentLevelReward?.title ? `Now: ${currentLevelReward.title}` : 'No reward attached yet.'}
                            </p>
                            <p className="mt-1 text-xs text-white/60">
                                {nextLevelReward?.title
                                    ? `Next: ${nextLevelReward.title}`
                                    : nextLevel
                                        ? 'Attach a reward to the next level.'
                                        : 'You reached the final tier.'}
                            </p>
                        </div>
                        <div className={`flex items-center gap-3 text-xs ${heroSubtleText}`}>
                            <FireIcon className={`h-4 w-4 ${isDark ? 'text-rose-300' : 'text-rose-500'}`} />
                            Keep your streak alive! Complete tasks daily to stack bonus XP.
                        </div>
                    </div>
                </div>
            </section>

            {shareFeedback && (
                <div className={shareFeedbackClass}>{shareFeedback}</div>
            )}

            <section className="grid gap-4 md:grid-cols-3">
                <div className={`rounded-2xl border p-5 ${isDark ? 'border-white/10 bg-surface/70' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary">Overall XP Points</p>
                    <p className="mt-2 text-3xl font-bold text-text-primary">{currentUserOverallXp.toLocaleString()}</p>
                    <p className="mt-1 text-sm text-text-secondary">Lifetime XP earned before reward redemptions.</p>
                </div>
                <div className={`rounded-2xl border p-5 ${isDark ? 'border-white/10 bg-surface/70' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary">Claimed Points</p>
                    <p className="mt-2 text-3xl font-bold text-text-primary">{currentUserClaimedXp.toLocaleString()}</p>
                    <p className="mt-1 text-sm text-text-secondary">XP spent on claimed rewards.</p>
                </div>
                <div className={`rounded-2xl border p-5 ${isDark ? 'border-white/10 bg-surface/70' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary">Available XP</p>
                    <p className="mt-2 text-3xl font-bold text-text-primary">{currentUserPoints.toLocaleString()}</p>
                    <p className="mt-1 text-sm text-text-secondary">Balance used for levels, leaderboard, and rewards.</p>
                </div>
            </section>

            <section className="space-y-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary">Rewards Vault</h2>
                        <p className="text-sm text-text-secondary">Trade your XP for perks and bragging rights.</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                    {rewards.length === 0 ? (
                        <div className="col-span-full rounded-2xl border border-dashed border-border-color/70 px-6 py-12 text-center text-sm text-text-secondary">
                            No active rewards yet. Check back after your crew drops new perks.
                        </div>
                    ) : (
                        rewards.map((reward) => (
                            <RewardCard
                                key={reward.id}
                                reward={reward}
                                userPoints={currentUserPoints}
                                hasClaimed={currentUser.claimedRewardIds.includes(reward.id)}
                                onClaim={handleClaimReward}
                                isClaiming={isClaiming === reward.id}
                                theme={resolvedTheme}
                                userDepartmentId={currentUser.departmentId ?? null}
                            />
                        ))
                    )}
                </div>
            </section>

            {seasonalChallenges.length > 0 && (
                <section className="space-y-5">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold text-text-primary">Seasonal Challenges</h2>
                            <p className="text-sm text-text-secondary">Limited-time quests for exclusive cosmetics.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {seasonalChallenges.map((challenge) => (
                            <SeasonalChallengeCard key={challenge.id} challenge={challenge} theme={resolvedTheme} />
                        ))}
                    </div>
                </section>
            )}

            {progressionMilestones.length > 0 && (
                <section className="space-y-5">
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary">Progression Roadmap</h2>
                        <p className="text-sm text-text-secondary">See what unlocks as you climb.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {progressionMilestones.map((step) => (
                            <ProgressionCard key={step.level} step={step} theme={resolvedTheme} />
                        ))}
                    </div>
                </section>
            )}

            <section className="space-y-5">
                <div className="space-y-5">
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary">Your Badge Deck</h2>
                        <p className="text-sm text-text-secondary">Collect them all and flex your mastery.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {visibleAchievements.map((achievement) => (
                            <AchievementCard
                                key={achievement.id}
                                achievement={achievement}
                                isUnlocked={isAchievementUnlocked(achievement)}
                                progress={achievementProgressMap[achievement.id] ?? 0}
                                onSelect={(selected) => setSelectedAchievementId(selected.id)}
                                theme={resolvedTheme}
                                isLeaderboardBadge={leaderboardBadgeId === achievement.id}
                                tierMeta={tierMetaById.get(achievement.id)}
                            />
                        ))}
                        {hasMoreAchievementsToRender && (
                            <div className="rounded-2xl border border-border-color/60 bg-surface/50 p-5 text-sm text-text-secondary">
                                Loading more achievements...
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="space-y-5">
                <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-2xl font-bold text-text-primary">Leaderboard</h2>
                            <p className="text-sm text-text-secondary">Top contenders battling for glory.</p>
                        </div>
                        {isOwner && (
                            <button
                                type="button"
                                role="switch"
                                aria-checked={showLeaderboardPoints}
                                onClick={() => setShowLeaderboardPoints((prev) => !prev)}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] transition ${pointsToggleClass}`}
                            >
                                <span>{showLeaderboardPoints ? 'XP shown' : 'XP hidden'}</span>
                                <span className={`relative h-4 w-7 rounded-full ${pointsToggleTrackClass}`}>
                                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${pointsToggleKnobClass}`} />
                                </span>
                            </button>
                        )}
                    </div>
                    <div
                        className={`leaderboard-drift relative overflow-hidden rounded-2xl border border-border-color/70 bg-surface/60 p-4 backdrop-blur-sm ${
                            refreshPulse ? 'leaderboard-refresh' : ''
                        }`}
                        style={leaderboardAnimationStyle}
                    >
                        <div className="relative z-10 space-y-4">
                            <div className="flex flex-wrap items-center gap-3">
                                {leaderboardTabs.map((tab) => {
                                    const isActive = tab.key === activeLeaderboardTab;
                                    const TabIcon = tab.icon;
                                    return (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            onClick={() => handleLeaderboardTabChange(tab.key)}
                                            className={`leaderboard-tab flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.32em] transition ${
                                                isActive
                                                    ? 'leaderboard-tab-active border-amber-300/60 bg-amber-200/10 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.25)]'
                                                    : 'border-white/10 bg-white/5 text-text-secondary opacity-80 hover:opacity-100 hover:border-amber-300/40 hover:text-amber-200'
                                            }`}
                                        >
                                            <TabIcon className="h-4 w-4" />
                                            <span>{tab.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {activeLeaderboardTabMeta && (
                                <p className="text-xs text-text-secondary">{activeLeaderboardTabMeta.description}</p>
                            )}
                            <div
                                key={activeLeaderboardTab}
                                className="leaderboard-tab-panel"
                                style={
                                    {
                                        '--leaderboard-tab-slide': tabDirection === 'right' ? '16px' : '-16px',
                                    } as React.CSSProperties
                                }
                            >
                                <div ref={leaderboardListRef} className="space-y-4">
                                    <ul className="space-y-3">
                                        {leaderboardTabTopUsers.length === 0 ? (
                                            <li className="rounded-xl border border-dashed border-border-color/70 px-4 py-6 text-center text-xs text-text-secondary">
                                                No contenders available for this league yet.
                                            </li>
                                        ) : (
                                            leaderboardTabTopUsers.map((user, index) => (
                                                <LeaderboardItem
                                                    key={user.id}
                                                    user={user}
                                                    rank={index + 1}
                                                    isCurrentUser={user.id === currentUser?.id}
                                                    theme={resolvedTheme}
                                                    maxPoints={maxLeaderboardPoints}
                                                    isSpotlighted={spotlightUserId === user.id}
                                                    xpPulse={xpPulseIds.has(user.id)}
                                                    rankImpact={rankImpactIds.has(user.id)}
                                                    rankDelta={rankDeltaById[user.id] ?? 0}
                                                    pointsOverride={leaderboardPointsByUserId.get(user.id)}
                                                    showPoints={effectiveShowLeaderboardPoints}
                                                    leaderboardBadge={leaderboardBadgeByUserId.get(user.id) ?? null}
                                                />
                                            ))
                                        )}
                                    </ul>
                                    {showYourRankCard && currentUser && (
                                        <div className="leaderboard-you mt-4 rounded-xl border border-primary/40 px-4 py-3 text-sm text-white/90 backdrop-blur">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200">Your Rank</p>
                                                    <p className="mt-1 font-semibold">{currentUser.name}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg font-bold">#{currentUserRankInTab}</p>
                                                    <p className="text-xs text-white/70">
                                                        {effectiveShowLeaderboardPoints
                                                            ? `${(leaderboardPointsByUserId.get(currentUser.id) ?? 0).toLocaleString()} XP`
                                                            : 'XP hidden'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {canSeePointsHistory && (
                <section className="space-y-5">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold text-text-primary">Points history</h2>
                            <p className="text-sm text-text-secondary">Filter by user or department to review XP activity.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {selectedUserPointsTotal !== null && (
                                <span className="rounded-full border border-border-color/70 bg-surface px-4 py-2 text-xs font-semibold text-text-primary">
                                    Total points: {selectedUserPointsTotal}
                                </span>
                            )}
                            <select
                                value={pointsHistoryUserId}
                                onChange={(e) => setPointsHistoryUserId(e.target.value)}
                                className="rounded-full border border-border-color/70 bg-surface px-4 py-2 text-sm"
                            >
                                <option value="">All users</option>
                                {userOptions.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={pointsHistoryDepartment}
                                onChange={(e) => setPointsHistoryDepartment(e.target.value)}
                                className="rounded-full border border-border-color/70 bg-surface px-4 py-2 text-sm"
                            >
                                <option value="">All departments</option>
                                {departmentOptions.map((dept) => (
                                    <option key={dept} value={dept}>
                                        {dept}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-border-color/70 bg-surface/60 backdrop-blur-sm">
                        {pointsHistoryLoading ? (
                            <div className="space-y-3 p-6">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <div key={index} className="h-16 animate-pulse rounded-xl bg-white/10" />
                                ))}
                            </div>
                        ) : pointsHistoryPageItems.length === 0 ? (
                            <div className="p-6 text-sm text-text-secondary">
                                No points history available for the selected filters.
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {pointsHistoryPageItems.map((item) => (
                                    <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-text-primary">{item.title}</p>
                                            <p className="mt-1 text-xs text-text-secondary">
                                                {item.team} • {item.statusLabel} • {item.priority}
                                            </p>
                                            <p className="mt-1 text-xs text-text-secondary">
                                                Creator: {item.createdByName} • Assignees: {item.assigneesLabel}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-start gap-2 sm:items-end">
                                            <span
                                                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${pointsBadgeClass(item.pointsTone)}`}
                                                title={item.pointsDetail || undefined}
                                            >
                                                {item.pointsLabel}: {item.pointsValue}
                                            </span>
                                            <span className="text-xs text-text-secondary">{item.dateLabel}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-secondary">
                        <span>
                            {pointsHistoryTotal === 0
                                ? 'Showing 0 of 0'
                                : `Showing ${pointsHistoryStart + 1}-${Math.min(pointsHistoryEnd, pointsHistoryTotal)} of ${pointsHistoryTotal}`}
                        </span>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setPointsHistoryPage((prev) => Math.max(1, prev - 1))}
                                disabled={resolvedHistoryPage <= 1}
                                className="rounded-full border border-border-color/70 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <span>
                                Page {resolvedHistoryPage} / {pointsHistoryPages}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPointsHistoryPage((prev) => Math.min(pointsHistoryPages, prev + 1))}
                                disabled={resolvedHistoryPage >= pointsHistoryPages}
                                className="rounded-full border border-border-color/70 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {selectedAchievement && (
                <AchievementDetailModal
                    achievement={selectedAchievement}
                    progress={achievementProgressMap[selectedAchievement.id] ?? 0}
                    isUnlocked={isAchievementUnlocked(selectedAchievement)}
                    onClose={() => setSelectedAchievementId(null)}
                    onShare={(achievement) =>
                        handleShare(
                            `I${isAchievementUnlocked(achievement) ? ' just unlocked' : "'m closing in on"} the ${achievement.title} badge in Zea.Play!`
                        )
                    }
                    onToggleLeaderboardBadge={handleToggleLeaderboardBadge}
                    isLeaderboardBadge={leaderboardBadgeId === selectedAchievement.id}
                    canSpotlight={isAchievementUnlocked(selectedAchievement)}
                    theme={resolvedTheme}
                />
            )}
            </div>
            ) : (
            <section className="rounded-3xl border border-border-color/70 bg-surface/50 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-sm sm:p-6">
                <Suspense
                    fallback={
                        <div className="flex min-h-[320px] items-center justify-center text-sm text-text-secondary">
                            Loading tab...
                        </div>
                    }
                >
                    {renderWorkspacePanel()}
                </Suspense>
            </section>
            )}
        </div>
    );
};

export default Achievements;
