import {
    getConfiguredGeminiKeys,
    getGeminiCooldownMap,
    getGeminiDailyLimit,
    getGeminiUsageMap,
    markGeminiKeyExhausted,
    recordGeminiError,
    recordGeminiUsage,
} from './geminiKeyStore';

const KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const pickRandom = <T,>(items: T[]): T | null => {
    if (items.length === 0) {
        return null;
    }
    return items[Math.floor(Math.random() * items.length)];
};

const getErrorMessage = (error: unknown): string => {
    if (!error) {
        return 'Unknown error';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error instanceof Error) {
        return error.message || 'Unknown error';
    }
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
};

const getErrorStatus = (error: unknown): number | null => {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const record = error as Record<string, unknown>;
    const direct = record.status ?? record.statusCode;
    if (typeof direct === 'number' && Number.isFinite(direct)) {
        return direct;
    }
    const response = record.response as Record<string, unknown> | undefined;
    const responseStatus = response?.status;
    if (typeof responseStatus === 'number' && Number.isFinite(responseStatus)) {
        return responseStatus;
    }
    return null;
};

const isQuotaError = (status: number | null, message: string): boolean => {
    if (status === 429) {
        return true;
    }
    const normalized = message.toLowerCase();
    return (
        normalized.includes('quota') ||
        normalized.includes('limit') ||
        normalized.includes('exceeded') ||
        normalized.includes('resource_exhausted') ||
        normalized.includes('rate')
    );
};

export const withGeminiKey = async <T,>(run: (apiKey: string) => Promise<T>): Promise<T> => {
    const apiKeys = getConfiguredGeminiKeys();
    if (apiKeys.length === 0) {
        throw new Error('AI features are disabled. Please configure your API key in the Settings page.');
    }

    const attemptedKeys = new Set<string>();
    let lastError: Error | null = null;
    const maxAttempts = Math.max(1, apiKeys.length);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const now = Date.now();
        const cooldowns = getGeminiCooldownMap();
        const usage = getGeminiUsageMap();
        const dailyLimit = getGeminiDailyLimit();
        const availableKeys = apiKeys.filter((key) => {
            if (attemptedKeys.has(key)) {
                return false;
            }
            const cooldownUntil = cooldowns[key];
            if (cooldownUntil && cooldownUntil > now) {
                return false;
            }
            const used = usage[key]?.used ?? 0;
            if (dailyLimit > 0 && used >= dailyLimit) {
                return false;
            }
            return true;
        });
        const remainingKeys = apiKeys.filter((key) => !attemptedKeys.has(key));
        const activeKey = pickRandom(availableKeys) ?? pickRandom(remainingKeys);

        if (!activeKey) {
            throw new Error('All Gemini API keys have reached their daily limits or cooldown windows.');
        }

        attemptedKeys.add(activeKey);

        try {
            const result = await run(activeKey);
            recordGeminiUsage(activeKey, dailyLimit);
            return result;
        } catch (error) {
            const message = getErrorMessage(error);
            recordGeminiError(activeKey, message);

            const status = getErrorStatus(error);
            markGeminiKeyExhausted(activeKey, Date.now() + KEY_COOLDOWN_MS);
            if (apiKeys.length > 1) {
                lastError = new Error(
                    isQuotaError(status, message)
                        ? 'Quota reached for key. Switching keys.'
                        : 'Key error detected. Switching keys.',
                );
                continue;
            }
            throw error;
        }
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error('AI request failed after trying all API keys.');
};
