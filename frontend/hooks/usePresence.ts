import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from './useAuth';
import { getAccessToken } from '../services/tokenStorage';
import { acquireSharedPresenceSocket, SharedSocketIoLease } from '../services/sharedSocketIo';

type PresenceState = {
    onlineUserIds: Set<string>;
    status: 'connected' | 'connecting' | 'offline';
    error?: string;
};

const PRESENCE_PING_INTERVAL_MS = 15000;
const RECONNECT_COOLDOWN_MS = 5000;

export const usePresence = (): PresenceState => {
    const { user } = useAuth();
    const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
    const [status, setStatus] = useState<PresenceState['status']>('offline');
    const [error, setError] = useState<string | undefined>(undefined);
    const socketRef = useRef<SharedSocketIoLease | null>(null);
    const pingTimerRef = useRef<number | null>(null);
    const reconnectCooldownRef = useRef(0);
    const connectAttemptRef = useRef(0);
    const listenerCleanupRef = useRef<Array<() => void>>([]);

    const disconnectSocket = useCallback(() => {
        connectAttemptRef.current += 1;
        listenerCleanupRef.current.forEach((unsubscribe) => unsubscribe());
        listenerCleanupRef.current = [];
        if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
        }
        if (socketRef.current) {
            socketRef.current.release();
            socketRef.current = null;
        }
        setOnlineUserIds(new Set());
    }, []);

    const connectSocket = useCallback(() => {
        const accessToken = getAccessToken();
        if (!user?.id || !accessToken) {
            setStatus('offline');
            setError(undefined);
            disconnectSocket();
            return;
        }

        setStatus('connecting');
        setError(undefined);
        disconnectSocket();
        const attempt = ++connectAttemptRef.current;
        const lease = acquireSharedPresenceSocket(user.id, user.tenantId);
        if (!lease) {
            setStatus('offline');
            setError('Presence not configured');
            return;
        }
        socketRef.current = lease;

        const syncPresence = () => {
            lease.emit('presence:get', (payload: { ok: boolean; users?: string[] }) => {
                if (attempt !== connectAttemptRef.current || !payload?.ok) {
                    return;
                }
                setOnlineUserIds(new Set(payload.users ?? []));
            });
            lease.emit('presence:ping');
        };

        listenerCleanupRef.current = [
            lease.subscribeStatus((nextStatus, nextError) => {
                if (attempt !== connectAttemptRef.current) return;
                setStatus(nextStatus);
                setError(nextStatus === 'offline' ? nextError : undefined);
                if (nextStatus === 'connected') {
                    syncPresence();
                }
            }),
            lease.on('disconnect', () => {
                if (attempt !== connectAttemptRef.current) return;
                setOnlineUserIds(new Set());
            }),
            lease.on('presence:online', (payload: { userId: string }) => {
                if (attempt !== connectAttemptRef.current) return;
                setOnlineUserIds((prev) => {
                    const next = new Set(prev);
                    next.add(payload.userId);
                    return next;
                });
            }),
            lease.on('presence:offline', (payload: { userId: string }) => {
                if (attempt !== connectAttemptRef.current) return;
                setOnlineUserIds((prev) => {
                    const next = new Set(prev);
                    next.delete(payload.userId);
                    return next;
                });
            }),
        ];

        if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
        }
        pingTimerRef.current = window.setInterval(() => {
            lease.emit('presence:ping');
        }, PRESENCE_PING_INTERVAL_MS);

    }, [disconnectSocket, user?.id, user?.tenantId]);

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
            socketRef.current?.reconnect();
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
