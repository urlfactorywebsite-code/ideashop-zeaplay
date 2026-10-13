const KEY_LIST_STORAGE = 'gemini-api-keys';
const KEY_USAGE_STORAGE = 'gemini-api-usage';
const KEY_LIMIT_STORAGE = 'gemini-api-daily-limit';
const KEY_COOLDOWN_STORAGE = 'gemini-api-key-state';

export const GEMINI_KEYS_UPDATED_EVENT = 'gemini-keys-updated';
export const DEFAULT_GEMINI_DAILY_LIMIT = 60;

export type GeminiKeyUsage = {
    used: number;
    day: string;
    lastUsedAt?: number;
    lastError?: string;
    lastErrorAt?: number;
};

type GeminiCooldownState = {
    exhaustedUntil?: number;
};

const dispatchUpdate = (): void => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }
    window.dispatchEvent(new CustomEvent(GEMINI_KEYS_UPDATED_EVENT));
};

const parseKeyList = (value?: string | null): string[] => {
    if (!value) {
        return [];
    }
    return Array.from(
        new Set(
            value
                .split(/[\n,]+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
        ),
    );
};

const getTodayKey = (): string => new Date().toISOString().slice(0, 10);

const sanitizeUsageEntry = (entry: unknown, today: string): GeminiKeyUsage | null => {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const record = entry as Partial<GeminiKeyUsage>;
    const used = typeof record.used === 'number' && Number.isFinite(record.used) ? record.used : 0;
    const day = typeof record.day === 'string' && record.day.length > 0 ? record.day : today;
    const next: GeminiKeyUsage = {
        used: day === today ? Math.max(0, used) : 0,
        day: today,
    };
    if (typeof record.lastUsedAt === 'number') {
        next.lastUsedAt = record.lastUsedAt;
    }
    if (typeof record.lastError === 'string') {
        next.lastError = record.lastError;
    }
    if (typeof record.lastErrorAt === 'number') {
        next.lastErrorAt = record.lastErrorAt;
    }
    return next;
};

export const getStoredGeminiKeys = (): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }
    try {
        const stored = window.localStorage.getItem(KEY_LIST_STORAGE);
        if (!stored) {
            return [];
        }
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
            return parseKeyList(parsed.join('\n'));
        }
        if (typeof parsed === 'string') {
            return parseKeyList(parsed);
        }
        return [];
    } catch (error) {
        console.warn('Failed to read stored Gemini API keys.', error);
        return [];
    }
};

export const setStoredGeminiKeys = (keys: string[]): string[] => {
    const normalized = parseKeyList(keys.join('\n'));
    if (typeof window === 'undefined') {
        return normalized;
    }
    try {
        window.localStorage.setItem(KEY_LIST_STORAGE, JSON.stringify(normalized));
        pruneUsageForKeys(normalized);
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to store Gemini API keys.', error);
    }
    return normalized;
};

export const addGeminiKeys = (keys: string[]): string[] => {
    const existing = getStoredGeminiKeys();
    return setStoredGeminiKeys([...existing, ...keys]);
};

export const removeGeminiKey = (key: string): string[] => {
    const normalized = key.trim();
    const existing = getStoredGeminiKeys().filter((entry) => entry !== normalized);
    setStoredGeminiKeys(existing);
    clearGeminiError(normalized);
    clearGeminiCooldown(normalized);
    return existing;
};

export const getGeminiDailyLimit = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_GEMINI_DAILY_LIMIT;
    }
    try {
        const stored = window.localStorage.getItem(KEY_LIMIT_STORAGE);
        const parsed = stored ? Number(stored) : NaN;
        if (!Number.isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    } catch (error) {
        console.warn('Failed to read Gemini API key limit.', error);
    }
    return DEFAULT_GEMINI_DAILY_LIMIT;
};

export const setGeminiDailyLimit = (limit: number): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const normalized = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_GEMINI_DAILY_LIMIT;
    try {
        window.localStorage.setItem(KEY_LIMIT_STORAGE, String(normalized));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to store Gemini API key limit.', error);
    }
};

export const getGeminiUsageMap = (): Record<string, GeminiKeyUsage> => {
    if (typeof window === 'undefined') {
        return {};
    }
    const today = getTodayKey();
    try {
        const stored = window.localStorage.getItem(KEY_USAGE_STORAGE);
        const parsed = stored ? JSON.parse(stored) : {};
        const next: Record<string, GeminiKeyUsage> = {};
        if (parsed && typeof parsed === 'object') {
            Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
                const sanitized = sanitizeUsageEntry(value, today);
                if (sanitized) {
                    next[key] = sanitized;
                }
            });
        }
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(next));
        return next;
    } catch (error) {
        console.warn('Failed to read Gemini usage stats.', error);
        return {};
    }
};

export const recordGeminiUsage = (key: string, limit?: number): GeminiKeyUsage | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    const normalized = key.trim();
    if (!normalized) {
        return null;
    }
    const today = getTodayKey();
    const usage = getGeminiUsageMap();
    const current = usage[normalized] ?? { used: 0, day: today };
    const nextUsed = Math.max(0, current.used + 1);
    const cappedUsed = limit && limit > 0 ? Math.min(limit, nextUsed) : nextUsed;
    usage[normalized] = {
        ...current,
        used: cappedUsed,
        day: today,
        lastUsedAt: Date.now(),
        lastError: undefined,
        lastErrorAt: undefined,
    };
    try {
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(usage));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to persist Gemini usage stats.', error);
    }
    return usage[normalized];
};

export const recordGeminiError = (key: string, message: string): GeminiKeyUsage | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    const normalized = key.trim();
    if (!normalized) {
        return null;
    }
    const today = getTodayKey();
    const usage = getGeminiUsageMap();
    const current = usage[normalized] ?? { used: 0, day: today };
    usage[normalized] = {
        ...current,
        day: today,
        lastError: message,
        lastErrorAt: Date.now(),
    };
    try {
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(usage));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to persist Gemini error state.', error);
    }
    return usage[normalized];
};

export const clearGeminiError = (key: string): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const normalized = key.trim();
    if (!normalized) {
        return;
    }
    const usage = getGeminiUsageMap();
    if (!usage[normalized]) {
        return;
    }
    usage[normalized] = {
        ...usage[normalized],
        lastError: undefined,
        lastErrorAt: undefined,
    };
    try {
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(usage));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to clear Gemini error state.', error);
    }
};

export const resetGeminiUsage = (key?: string): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const today = getTodayKey();
    const usage = getGeminiUsageMap();
    if (key) {
        const normalized = key.trim();
        if (usage[normalized]) {
            usage[normalized] = { ...usage[normalized], used: 0, day: today };
        }
    } else {
        Object.keys(usage).forEach((entry) => {
            usage[entry] = { ...usage[entry], used: 0, day: today };
        });
    }
    try {
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(usage));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to reset Gemini usage stats.', error);
    }
};

export const getGeminiCooldownMap = (): Record<string, number> => {
    if (typeof window === 'undefined') {
        return {};
    }
    const now = Date.now();
    try {
        const stored = window.localStorage.getItem(KEY_COOLDOWN_STORAGE);
        const parsed = stored ? JSON.parse(stored) : {};
        const next: Record<string, number> = {};
        if (parsed && typeof parsed === 'object') {
            Object.entries(parsed as Record<string, GeminiCooldownState>).forEach(([key, value]) => {
                const until = value?.exhaustedUntil;
                if (typeof until === 'number' && until > now) {
                    next[key] = until;
                }
            });
        }
        window.localStorage.setItem(KEY_COOLDOWN_STORAGE, JSON.stringify(Object.fromEntries(
            Object.entries(next).map(([key, until]) => [key, { exhaustedUntil: until }]),
        )));
        return next;
    } catch (error) {
        console.warn('Failed to read Gemini cooldown state.', error);
        return {};
    }
};

export const markGeminiKeyExhausted = (key: string, until: number): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const normalized = key.trim();
    if (!normalized) {
        return;
    }
    const cooldowns = getGeminiCooldownMap();
    cooldowns[normalized] = until;
    const payload = Object.fromEntries(
        Object.entries(cooldowns).map(([entry, ts]) => [entry, { exhaustedUntil: ts }]),
    );
    try {
        window.localStorage.setItem(KEY_COOLDOWN_STORAGE, JSON.stringify(payload));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to persist Gemini cooldown state.', error);
    }
};

export const clearGeminiCooldown = (key: string): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const normalized = key.trim();
    const cooldowns = getGeminiCooldownMap();
    if (!cooldowns[normalized]) {
        return;
    }
    delete cooldowns[normalized];
    const payload = Object.fromEntries(
        Object.entries(cooldowns).map(([entry, ts]) => [entry, { exhaustedUntil: ts }]),
    );
    try {
        window.localStorage.setItem(KEY_COOLDOWN_STORAGE, JSON.stringify(payload));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to persist Gemini cooldown state.', error);
    }
};

const pruneUsageForKeys = (keys: string[]): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const usage = getGeminiUsageMap();
    const normalizedKeys = new Set(keys);
    let changed = false;
    Object.keys(usage).forEach((key) => {
        if (!normalizedKeys.has(key)) {
            delete usage[key];
            changed = true;
        }
    });
    if (!changed) {
        return;
    }
    try {
        window.localStorage.setItem(KEY_USAGE_STORAGE, JSON.stringify(usage));
        dispatchUpdate();
    } catch (error) {
        console.warn('Failed to prune Gemini usage stats.', error);
    }
};

export const getConfiguredGeminiKeys = (): string[] => {
    const envKeys = [
        (import.meta as ImportMeta).env?.VITE_GEMINI_API_KEYS,
        (import.meta as ImportMeta).env?.VITE_GEMINI_API_KEY,
        (process.env.GEMINI_API_KEYS || ''),
        (process.env.GEMINI_API_KEY || ''),
    ]
        .map((entry) => entry?.toString() ?? '')
        .filter(Boolean)
        .join(',');
    const parsedEnvKeys = parseKeyList(envKeys);
    if (parsedEnvKeys.length > 0) {
        return parsedEnvKeys;
    }
    const stored = getStoredGeminiKeys();
    if (stored.length > 0) {
        return stored;
    }
    return [];
};

export const maskGeminiKey = (key: string): string => {
    if (key.length <= 8) {
        return key;
    }
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

export const parseGeminiKeysInput = (value: string): string[] => parseKeyList(value);
