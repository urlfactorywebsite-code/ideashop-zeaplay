import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWebSocketTicket, toWebSocketBaseUrl } from '../services/realtimeAuth';
import { getApiBaseUrl, getSocketApiBaseUrl } from '../services/endpoints';
import { RealtimeReconnectController } from '../services/realtimeBackoff';
import { getAccessToken } from '../services/tokenStorage';
import { CoalescedReconciliation, comparePersistedTimes, RecentEventIds } from '../services/realtimeRecovery';
import { useAuth } from './useAuth';

export type TicketChatComment = {
    id: string;
    ticket_id: string;
    tenant_id: string;
    user_id: string;
    body: string;
    is_internal: boolean;
    created_at: string;
    mentions: string[];
};

export type TicketChatMessage =
    | { type: 'comment'; comment: TicketChatComment }
    | { type: 'typing'; ticket_id: string; user_id: string; body: string }
    | { type: 'error'; message: string };

type TicketChatState = {
    connected: boolean;
    messages: TicketChatMessage[];
    sendComment: (body: string, isInternal?: boolean) => void;
    sendTyping: (body?: string) => void;
};

const resolveTicketChatUrl = (): string => {
    return toWebSocketBaseUrl(getSocketApiBaseUrl(true));
};

export const useTicketChat = (ticketId?: string, onReconcile?: () => void): TicketChatState => {
    const { user } = useAuth();
    const [connected, setConnected] = useState(false);
    const [messages, setMessages] = useState<TicketChatMessage[]>([]);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectControllerRef = useRef(new RealtimeReconnectController({ minDelayMs: 1000, maxDelayMs: 15000 }));
    const mountedRef = useRef(false);
    const connectingRef = useRef(false);
    const connectAttemptRef = useRef(0);
    const reconcileRef = useRef(onReconcile);
    reconcileRef.current = onReconcile;
    const seenRef = useRef(new RecentEventIds());
    const bufferedRef = useRef<TicketChatMessage[] | null>(null);
    const recoveryTimerRef = useRef<number | null>(null);
    const recoveryAbortRef = useRef<AbortController | null>(null);
    const recoveryRef = useRef<CoalescedReconciliation | null>(null);

    const cleanup = useCallback(() => {
        connectAttemptRef.current += 1;
        reconnectControllerRef.current.cancel();
        connectingRef.current = false;
        bufferedRef.current = null;
        recoveryRef.current?.cancel();
        recoveryAbortRef.current?.abort();
        if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
        if (socketRef.current) {
            socketRef.current.onopen = null;
            socketRef.current.onclose = null;
            socketRef.current.onerror = null;
            socketRef.current.onmessage = null;
            socketRef.current.close();
            socketRef.current = null;
        }
        setConnected(false);
    }, []);

    const appendMessage = useCallback((parsed: TicketChatMessage) => {
        setMessages((prev) => {
            if (parsed.type === 'comment') {
                if (prev.some((message) => message.type === 'comment' && message.comment.id === parsed.comment.id)) {
                    return prev;
                }
                const comments = [...prev.filter((message): message is Extract<TicketChatMessage, { type: 'comment' }> => message.type === 'comment'), parsed];
                comments.sort((a, b) => comparePersistedTimes(a.comment.created_at, b.comment.created_at) || a.comment.id.localeCompare(b.comment.id));
                return [...comments, ...prev.filter(message => message.type !== 'comment')].slice(-200);
            }
            if (parsed.type === 'typing') {
                return [
                    ...prev.filter((message) => (
                        message.type !== 'typing' ||
                        message.ticket_id !== parsed.ticket_id ||
                        message.user_id !== parsed.user_id
                    )),
                    parsed,
                ].slice(-200);
            }
            return [...prev, parsed].slice(-200);
        });
    }, []);

    const connect = useCallback(() => {
        if (!ticketId || !mountedRef.current || connectingRef.current) return;
        void (async () => {
            const attempt = ++connectAttemptRef.current;
            connectingRef.current = true;
            const token = await getWebSocketTicket('tickets');
            if (attempt !== connectAttemptRef.current) return;
            connectingRef.current = false;
            if (!mountedRef.current) return;
            if (!token) {
                reconnectControllerRef.current.schedule(connect);
                return;
            }
            if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

            const baseUrl = resolveTicketChatUrl();
            const wsUrl = `${baseUrl}/ws/tickets/${ticketId}?token=${encodeURIComponent(token)}`;
            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;
            let waitingForReady = true;
            const abort = new AbortController();
            recoveryAbortRef.current = abort;

            const recovery = new CoalescedReconciliation(async () => {
                if (waitingForReady || socketRef.current !== socket) return;
                bufferedRef.current ??= [];
                try {
                    const apiBase = getApiBaseUrl();
                    const response = await fetch(`${apiBase}/ws/tickets/${ticketId}/snapshot`, {
                        headers: { Authorization: `Bearer ${getAccessToken()}` },
                        signal: abort.signal,
                    });
                    if (!response.ok) throw new Error('Ticket recovery failed');
                    const snapshot = await response.json();
                    if (!mountedRef.current || socketRef.current !== socket) return;
                    const byId = new Map<string, TicketChatMessage>();
                    for (const message of [
                        ...snapshot.comments.map((comment: TicketChatComment) => ({ type: 'comment' as const, comment })),
                        ...(bufferedRef.current || []),
                    ]) {
                        if (message.type === 'comment') byId.set(message.comment.id, message);
                    }
                    setMessages([...byId.values()].sort((a, b) => {
                        if (a.type !== 'comment' || b.type !== 'comment') return 0;
                        return comparePersistedTimes(a.comment.created_at, b.comment.created_at) || a.comment.id.localeCompare(b.comment.id);
                    }).slice(-200));
                    bufferedRef.current = null;
                    reconcileRef.current?.();
                } catch {
                    if (socketRef.current !== socket) return;
                    bufferedRef.current = null;
                    appendMessage({ type: 'error', message: 'Unable to refresh ticket history. Reconnecting.' });
                    socket.close();
                }
            });
            recoveryRef.current = recovery;
            const recover = () => recovery.request();

            socket.onopen = () => {
                if (socketRef.current !== socket || !mountedRef.current) return;
                reconnectControllerRef.current.reset();
                setConnected(true);
                seenRef.current = new RecentEventIds();
                bufferedRef.current = [];
                // Older backends do not send the additive ready control frame.
                recoveryTimerRef.current = window.setTimeout(() => {
                    waitingForReady = false;
                    void recover();
                }, 1000);
            };
            socket.onclose = (event) => {
                recovery.cancel();
                abort.abort();
                if (socketRef.current !== socket) return;
                socketRef.current = null;
                bufferedRef.current = null;
                if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
                setConnected(false);
                if (event.code === 1008) setMessages([]);
                if (!mountedRef.current || event.code === 1008) return;
                reconnectControllerRef.current.schedule(connect);
            };
            socket.onerror = () => socket.close();
            socket.onmessage = (event) => {
                if (!mountedRef.current || socketRef.current !== socket) return;
                try {
                    const parsed = JSON.parse(event.data);
                    if (!seenRef.current.accept(parsed.event_id)) return;
                    if (parsed.type === 'realtime:ready') {
                        if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
                        waitingForReady = false;
                        void recover();
                    } else if (parsed.type === 'ticket.changed') {
                        if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
                        recoveryTimerRef.current = window.setTimeout(() => { void recover(); }, 250);
                    } else if (bufferedRef.current !== null) {
                        if (bufferedRef.current.length >= 200) socket.close();
                        else bufferedRef.current.push(parsed);
                    } else {
                        appendMessage(parsed as TicketChatMessage);
                    }
                } catch (error) {
                    console.warn('Ticket chat message parse failed');
                }
            };
        })();
    }, [appendMessage, ticketId]);

    useEffect(() => {
        if (!ticketId || !user?.id) {
            setMessages([]);
            return () => undefined;
        }
        mountedRef.current = true;
        reconnectControllerRef.current.activate();
        setMessages([]);
        connect();

        return () => {
            mountedRef.current = false;
            cleanup();
        };
    }, [cleanup, connect, ticketId, user?.id, user?.tenantId]);

    const sendComment = useCallback((body: string, isInternal = false) => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            return;
        }
        socketRef.current.send(
            JSON.stringify({ type: 'comment', body, is_internal: isInternal }),
        );
    }, []);

    const sendTyping = useCallback((body = '') => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            return;
        }
        socketRef.current.send(JSON.stringify({ type: 'typing', body }));
    }, []);

    return useMemo(
        () => ({
            connected,
            messages,
            sendComment,
            sendTyping,
        }),
        [connected, messages, sendComment, sendTyping],
    );
};
