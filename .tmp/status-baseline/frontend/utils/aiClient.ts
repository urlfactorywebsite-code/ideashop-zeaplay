/// <reference types="vite/client" />

import {
    getConfiguredGeminiKeys,
    getGeminiCooldownMap,
    getGeminiDailyLimit,
    getGeminiUsageMap,
    markGeminiKeyExhausted,
    recordGeminiError,
    recordGeminiUsage,
} from './geminiKeyStore';

const DEFAULT_AI_WEBHOOK_URL = 'https://n8n.urlfactory.website/webhook/taskmanger';
const KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let resolvedWebhookUrl = DEFAULT_AI_WEBHOOK_URL;
try {
    const candidate = (import.meta as ImportMeta).env?.VITE_AI_WEBHOOK_URL;
    if (candidate) {
        resolvedWebhookUrl = candidate;
    }
} catch {
    // Running outside a Vite context; fallback to default URL.
}

export const AI_WEBHOOK_URL = resolvedWebhookUrl;
export const BOT_FALLBACK_REPLY = "Sorry, I couldn't process that. Please try again.";
export const BOT_ERROR_MESSAGE = "I'm having trouble connecting right now. Please try again later.";

const candidateKeys = ['reply', 'message', 'output', 'text', 'response'];

const isQuotaError = (status: number, body: string): boolean => {
    if (status === 429) {
        return true;
    }
    const normalized = body.toLowerCase();
    return (
        normalized.includes('quota') ||
        normalized.includes('limit') ||
        normalized.includes('exceeded') ||
        normalized.includes('resource_exhausted') ||
        normalized.includes('rate')
    );
};

const pickRandom = <T,>(items: T[]): T | null => {
    if (items.length === 0) {
        return null;
    }
    return items[Math.floor(Math.random() * items.length)];
};

export const generateSessionId = (): string => (
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
);

export const extractReply = (payload: unknown): string | undefined => {
    if (!payload) {
        return undefined;
    }

    if (typeof payload === 'string') {
        const trimmed = payload.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const result = extractReply(item);
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    if (typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        for (const key of candidateKeys) {
            if (key in record) {
                const result = extractReply(record[key]);
                if (result) {
                    return result;
                }
            }
        }
        if ('data' in record) {
            const result = extractReply(record['data']);
            if (result) {
                return result;
            }
        }
    }

    return undefined;
};

export const parseWebhookReply = async (response: Response): Promise<string> => {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        try {
            const json = await response.json();
            return extractReply(json) ?? BOT_FALLBACK_REPLY;
        } catch (error) {
            console.error('Failed to parse JSON webhook response', error);
            return BOT_FALLBACK_REPLY;
        }
    }

    const textBody = await response.text();
    if (!textBody) {
        return BOT_FALLBACK_REPLY;
    }

    try {
        const json = JSON.parse(textBody);
        return extractReply(json) ?? BOT_FALLBACK_REPLY;
    } catch {
        const trimmed = textBody.trim();
        return trimmed.length > 0 ? trimmed : BOT_FALLBACK_REPLY;
    }
};

export interface SendAiMessageOptions {
    message: string;
    sessionId?: string;
    payload?: Record<string, unknown>;
    signal?: AbortSignal;
    webhookUrl?: string;
}

export const sendAiMessage = async ({
    message,
    sessionId,
    payload,
    signal,
    webhookUrl,
}: SendAiMessageOptions): Promise<string> => {
    const requestBody: Record<string, unknown> = { message };
    if (sessionId) {
        requestBody.sessionId = sessionId;
    }
    if (payload) {
        Object.assign(requestBody, payload);
    }

    const targetUrl = webhookUrl ?? AI_WEBHOOK_URL;
    const apiKeys = getConfiguredGeminiKeys();
    const attemptedKeys = new Set<string>();
    let lastError: Error | null = null;

    const maxAttempts = Math.max(1, apiKeys.length);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let activeKey: string | null = null;
        if (apiKeys.length > 0) {
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
            activeKey = pickRandom(availableKeys) ?? pickRandom(remainingKeys);
            if (activeKey) {
                attemptedKeys.add(activeKey);
            } else {
                throw new Error('All Gemini API keys have reached their daily limits or cooldown windows.');
            }
        }

        const bodyWithKey = { ...requestBody };
        if (activeKey && bodyWithKey.apiKey === undefined && bodyWithKey.geminiApiKey === undefined) {
            bodyWithKey.apiKey = activeKey;
            bodyWithKey.geminiApiKey = activeKey;
        }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyWithKey),
            signal,
        });

        if (response.ok) {
            if (activeKey) {
                recordGeminiUsage(activeKey, getGeminiDailyLimit());
            }
            return parseWebhookReply(response);
        }

        const errorText = await response.text();
        console.error(`Webhook response error: ${response.status} ${response.statusText}`, errorText);
        if (activeKey) {
            recordGeminiError(activeKey, errorText || `HTTP ${response.status}`);
            markGeminiKeyExhausted(activeKey, Date.now() + KEY_COOLDOWN_MS);
        }

        if (activeKey && apiKeys.length > 1) {
            lastError = new Error(
                isQuotaError(response.status, errorText)
                    ? `Quota reached for key. Switching keys. Status: ${response.status}`
                    : `Key error detected. Switching keys. Status: ${response.status}`,
            );
            continue;
        }

        throw new Error(`Network response was not ok. Status: ${response.status}`);
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error('AI request failed after trying all API keys.');
};
