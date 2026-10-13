import { SeasonalChallengeConfig, CustomBadge } from '../types';

const SEASONAL_KEY = 'zea-seasonal-challenges';
const BADGE_KEY = 'zea-custom-badges';

export const CUSTOM_BADGES_UPDATED_EVENT = 'custom-badges-updated';

const safeParse = <T>(value: string | null, fallback: T): T => {
    if (!value) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch (error) {
        console.warn('Failed to parse stored achievement data', error);
        return fallback;
    }
};

export const loadSeasonalChallenges = (): SeasonalChallengeConfig[] => {
    if (typeof window === 'undefined') return [];
    return safeParse<SeasonalChallengeConfig[]>(localStorage.getItem(SEASONAL_KEY), []);
};

export const saveSeasonalChallenges = (items: SeasonalChallengeConfig[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SEASONAL_KEY, JSON.stringify(items));
};

export const loadCustomBadges = (): CustomBadge[] => {
    if (typeof window === 'undefined') return [];
    return safeParse<CustomBadge[]>(localStorage.getItem(BADGE_KEY), []);
};

export const saveCustomBadges = (items: CustomBadge[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(BADGE_KEY, JSON.stringify(items));
    if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(CUSTOM_BADGES_UPDATED_EVENT, { detail: { badges: items } }));
    }
};

export const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `id-${Math.random().toString(36).slice(2, 10)}`;
};
