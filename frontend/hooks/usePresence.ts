import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { useAuth } from './useAuth';
import { getAccessToken } from '../services/tokenStorage';

type PresenceState = {
    onlineUserIds: Set<string>;
    status: 'connected' | 'connecting' | 'offline';
    error?: string;
};

const PRESENCE_PING_INTERVAL_MS = 15000;
const RECONNECT_COOLDOWN_MS = 5000;

const readRuntimePresenceUrl = (): string => {
    if (typeof window === 'undefined') {
        return '';
    }
    const runtimeConfig = (window as typeof window & {
        __RUNTIME_CONFIG__?: { PRESENCE_URL?: string };
    }).__RUNTIME_CONFIG__;
    if (!runtimeConfig?.PRESENCE_URL || typeof runtimeConfig.PRESENCE_URL !== 'string') {
        return '';
    }
    return runtimeConfig.PRESENCE_URL.trim();
};

const resolvePresenceUrl = (): string | null => {
    const runtimeUrl = readRuntimePresenceUrl();
    if (runtimeUrl) {
        return runtimeUrl;
    }
    const envUrl = import.meta.env.VITE_PRESENCE_URL;
    if (envUrl && typeof envUrl === 'string') {
        return envUrl;
    }
    if (typeof window === 'undefined') {
        return null;
    }
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    return isLocalhost ? 'http://localhost:6312' : null;
};

export const usePresence = (): PresenceState => {
    const { user } = useAuth();
    const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
    const [status, setStatus] = useState<PresenceState['status']>('offline');
    const [error, setError] = useState<string | undefined>(undefined);
    const socketRef = useRef<Socket | null>(null);
    const pingTimerRef = useRef<number | null>(null);
    const reconnectCooldownRef = useRef(0);

    const disconnectSocket = useCallback(() => {
        if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
        }
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setOnlineUserIds(new Set());
    }, []);

    const connectSocket = useCallback(() => {
        const token = getAccessToken();
        if (!user || !token) {
            setStatus('offline');
            setError(undefined);
            disconnectSocket();
            return;
        }
        const presenceUrl = resolvePresenceUrl();
        if (!presenceUrl) {
            setStatus('offline');
            setError('Presence not configured');
            disconnectSocket();
            return;
        }

        setStatus('connecting');
        setError(undefined);
        disconnectSocket();

        const socket = io(presenceUrl, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: 10000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            setStatus('connected');
            setError(undefined);
            socket.emit('presence:get', (payload: { ok: boolean; users?: string[] }) => {
                if (!payload?.ok) {
                    return;
                }
                setOnlineUserIds(new Set(payload.users ?? []));
            });
            socket.emit('presence:ping');
        });

        socket.on('disconnect', () => {
            setStatus('offline');
            setError('Presence offline');
            setOnlineUserIds(new Set());
        });

        socket.on('connect_error', (err) => {
            setStatus('offline');
            setError(err?.message || 'Presence offline');
            setOnlineUserIds(new Set());
        });

        socket.on('presence:online', (payload: { userId: string }) => {
            setOnlineUserIds((prev) => {
                const next = new Set(prev);
                next.add(payload.userId);
                return next;
            });
        });

        socket.on('presence:offline', (payload: { userId: string }) => {
            setOnlineUserIds((prev) => {
                const next = new Set(prev);
                next.delete(payload.userId);
                return next;
            });
        });

        if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
        }
        pingTimerRef.current = window.setInterval(() => {
            if (socket.connected) {
                socket.emit('presence:ping');
            }
        }, PRESENCE_PING_INTERVAL_MS);
    }, [disconnectSocket, user]);

    useEffect(() => {
        connectSocket();
        return () => {
            disconnectSocket();
        };
    }, [connectSocket, disconnectSocket, user?.id]);

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            if (status !== 'offline') {
                return;
            }
            const token = getAccessToken();
            if (!user || !token) {
                return;
            }
            const now = Date.now();
            if (now - reconnectCooldownRef.current < RECONNECT_COOLDOWN_MS) {
                return;
            }
            reconnectCooldownRef.current = now;
            connectSocket();
        };

        const handleFocus = () => {
            handleVisibility();
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [connectSocket, status, user]);

    return useMemo(
        () => ({
            onlineUserIds,
            status,
            error,
        }),
        [onlineUserIds, status, error],
    );
};
