import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken } from '../../../services/tokenStorage';

export type ChatRealtimeEvent = {
  version: 'v1';
  type: string;
  payload: Record<string, any>;
  sent_at?: string;
};

const resolveChatSocketUrl = () => {
  const token = getAccessToken();
  if (!token || typeof window === 'undefined') return null;
  const configuredApiBase = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'https://todoplay.urlfactory.website/api'
  ).replace(/\/$/, '');
  const absoluteApiBase = configuredApiBase.startsWith('http')
    ? configuredApiBase
    : `${window.location.origin}${configuredApiBase.startsWith('/') ? '' : '/'}${configuredApiBase}`;
  const apiUrl = new URL(absoluteApiBase);
  const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const apiPath = apiUrl.pathname.replace(/\/$/, '');
  const wsPath = apiPath.endsWith('/api') ? `${apiPath}/ws/chat` : `${apiPath}/ws/chat`.replace(/\/+/g, '/');
  return `${wsProtocol}//${apiUrl.host}${wsPath}?token=${encodeURIComponent(token)}`;
};

export const useChatRealtime = (onEvent: (event: ChatRealtimeEvent) => void) => {
  const socketRef = useRef<WebSocket | null>(null);
  const eventHandlerRef = useRef(onEvent);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedByHookRef = useRef(false);
  const joinedRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    eventHandlerRef.current = onEvent;
  }, [onEvent]);

  const send = useCallback((type: string, payload: Record<string, any> = {}) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }, []);

  const connect = useCallback(() => {
    const url = resolveChatSocketUrl();
    if (!url) return;
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;
    closedByHookRef.current = false;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setConnected(true);
      joinedRef.current.forEach((conversationId) => {
        socket.send(JSON.stringify({ type: 'chat:join', payload: { conversation_id: conversationId } }));
      });
      socket.send(JSON.stringify({ type: 'presence:heartbeat', payload: { status: 'ONLINE' } }));
    };
    socket.onmessage = (message) => {
      try {
        eventHandlerRef.current(JSON.parse(message.data));
      } catch {
      }
    };
    socket.onclose = (event) => {
      const shouldHandleClose = socketRef.current === socket;
      setConnected(false);
      if (shouldHandleClose) {
        socketRef.current = null;
      }
      if (event.code === 1008) {
        closedByHookRef.current = true;
        return;
      }
      if (shouldHandleClose && !closedByHookRef.current) {
        reconnectAttemptRef.current += 1;
        const delay = Math.min(30000, 1500 * reconnectAttemptRef.current);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      }
    };
    socket.onerror = () => socket.close();
  }, []);

  useEffect(() => {
    connect();
    const heartbeat = window.setInterval(() => send('presence:heartbeat', { status: document.hidden ? 'AWAY' : 'ONLINE' }), 30000);
    return () => {
      window.clearInterval(heartbeat);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      closedByHookRef.current = true;
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
      }
      socketRef.current = null;
    };
  }, [connect, send]);

  const join = useCallback((conversationId: string) => {
    joinedRef.current.add(conversationId);
    send('chat:join', { conversation_id: conversationId });
  }, [send]);

  const leave = useCallback((conversationId: string) => {
    joinedRef.current.delete(conversationId);
    send('chat:leave', { conversation_id: conversationId });
  }, [send]);

  return { connected, send, join, leave };
};
