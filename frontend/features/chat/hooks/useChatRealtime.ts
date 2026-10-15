import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketTicket } from '../../../services/realtimeAuth';
import { RealtimeReconnectController } from '../../../services/realtimeBackoff';

export type ChatRealtimeEvent = {
  version: 'v1';
  type: string;
  payload: Record<string, any>;
  sent_at?: string;
};

const resolveChatSocketUrl = async () => {
  const token = await getWebSocketTicket('chat');
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
  const reconnectControllerRef = useRef(new RealtimeReconnectController({ minDelayMs: 1500, maxDelayMs: 30000 }));
  const closedByHookRef = useRef(false);
  const mountedRef = useRef(false);
  const connectingRef = useRef(false);
  const hasOpenedRef = useRef(false);
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
    if (!mountedRef.current || connectingRef.current) return;
    void (async () => {
      closedByHookRef.current = false;
      connectingRef.current = true;
      const url = await resolveChatSocketUrl();
      connectingRef.current = false;
      if (!mountedRef.current) return;
      if (!url || closedByHookRef.current) return;
      if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket || !mountedRef.current) return;
        reconnectControllerRef.current.reset();
        setConnected(true);
        if (hasOpenedRef.current) {
          eventHandlerRef.current({ version: 'v1', type: 'realtime:reconnected', payload: {} });
        }
        hasOpenedRef.current = true;
        joinedRef.current.forEach((conversationId) => {
          socket.send(JSON.stringify({ type: 'chat:join', payload: { conversation_id: conversationId } }));
        });
        socket.send(JSON.stringify({ type: 'presence:heartbeat', payload: { status: 'ONLINE' } }));
      };
      socket.onmessage = (message) => {
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        if (event.code === 1008) {
          closedByHookRef.current = true;
          return;
        }
        if (shouldHandleClose && !closedByHookRef.current) {
          reconnectControllerRef.current.schedule(connect);
        }
      };
      socket.onerror = () => socket.close();
    })();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    reconnectControllerRef.current.activate();
    connect();
    const heartbeat = window.setInterval(() => send('presence:heartbeat', { status: document.hidden ? 'AWAY' : 'ONLINE' }), 30000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(heartbeat);
      reconnectControllerRef.current.cancel();
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
