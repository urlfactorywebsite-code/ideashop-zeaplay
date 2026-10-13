import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAccessToken } from '../services/tokenStorage';

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
        return envUrl;
    }
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}`;
    }
    return 'ws://localhost:8000';
};

export const useTicketChat = (ticketId?: string): TicketChatState => {
    const [connected, setConnected] = useState(false);
    const [messages, setMessages] = useState<TicketChatMessage[]>([]);
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!ticketId) {
            return () => undefined;
        }

        const token = getAccessToken();
        if (!token) {
            return () => undefined;
        }

        const baseUrl = resolveTicketChatUrl();
        const wsUrl = `${baseUrl}/ws/tickets/${ticketId}?token=${encodeURIComponent(token)}`;
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => setConnected(true);
        socket.onclose = () => setConnected(false);
        socket.onerror = (event) => console.warn('Ticket chat socket error', event);
        socket.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as TicketChatMessage;
                setMessages((prev) => [...prev, parsed]);
            } catch (error) {
                console.warn('Ticket chat message parse failed', error);
            }
        };

        return () => {
            socket.close();
            socketRef.current = null;
        };
    }, [ticketId]);

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
