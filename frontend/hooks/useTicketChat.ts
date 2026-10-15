import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWebSocketTicket, toWebSocketBaseUrl } from '../services/realtimeAuth';
import { RealtimeReconnectController } from '../services/realtimeBackoff';

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
    const envUrl = import.meta.env.VITE_TICKET_CHAT_WS_URL || import.meta.env.VITE_WS_URL;
    if (envUrl && typeof envUrl === 'string') {
        return toWebSocketBaseUrl(envUrl);
    }
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}/api`;
    }
    return 'ws://localhost:6311/api';
};

export const useTicketChat = (ticketId?: string): TicketChatState => {
    const [connected, setConnected] = useState(false);
    const [messages, setMessages] = useState<TicketChatMessage[]>([]);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectControllerRef = useRef(new RealtimeReconnectController({ minDelayMs: 1000, maxDelayMs: 15000 }));
    const mountedRef = useRef(false);
    const connectingRef = useRef(false);
    const connectAttemptRef = useRef(0);

    const cleanup = useCallback(() => {
        connectAttemptRef.current += 1;
        reconnectControllerRef.current.cancel();
        connectingRef.current = false;
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
                return [...prev, parsed].slice(-200);
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
            connectingRef.current = false;
            if (attempt !== connectAttemptRef.current || !mountedRef.current || !token) {
                return;
            }

            const baseUrl = resolveTicketChatUrl();
            const wsUrl = `${baseUrl}/ws/tickets/${ticketId}?token=${encodeURIComponent(token)}`;
            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                if (socketRef.current !== socket || !mountedRef.current) return;
                reconnectControllerRef.current.reset();
                setConnected(true);
            };
            socket.onclose = (event) => {
                if (socketRef.current === socket) {
                    socketRef.current = null;
                }
                setConnected(false);
                if (!mountedRef.current || event.code === 1008) return;
                reconnectControllerRef.current.schedule(connect);
            };
            socket.onerror = () => socket.close();
            socket.onmessage = (event) => {
                if (!mountedRef.current) return;
                try {
                    appendMessage(JSON.parse(event.data) as TicketChatMessage);
                } catch (error) {
                    console.warn('Ticket chat message parse failed', error);
                }
            };
        })();
    }, [appendMessage, ticketId]);

    useEffect(() => {
        if (!ticketId) {
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
    }, [cleanup, connect, ticketId]);

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
