import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketTicket, toWebSocketBaseUrl } from '../../../services/realtimeAuth';
import { getSocketApiBaseUrl } from '../../../services/endpoints';
import { RealtimeReconnectController } from '../../../services/realtimeBackoff';
import { RecentEventIds } from '../../../services/realtimeRecovery';
import { useAuth } from '../../../hooks/useAuth';

export type ChatRealtimeEvent = {
  version: 'v1';
  type: string;
  payload: Record<string, any>;
  sent_at?: string;
};

const resolveChatSocketUrl = async () => {
  const token = await getWebSocketTicket('chat');
  if (!token || typeof window === 'undefined') return null;
  return `${toWebSocketBaseUrl(getSocketApiBaseUrl())}/ws/chat?token=${encodeURIComponent(token)}`;
};

export const useChatRealtime = (onEvent: (event: ChatRealtimeEvent) => void) => {
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const eventHandlerRef = useRef(onEvent);
  const reconnectControllerRef = useRef(new RealtimeReconnectController({ minDelayMs: 1500, maxDelayMs: 30000 }));
  const closedByHookRef = useRef(false);
  const mountedRef = useRef(false);
  const connectingRef = useRef(false);
  const attemptRef = useRef(0);
  const seenRef = useRef(new RecentEventIds());
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
      const attempt = ++attemptRef.current;
      connectingRef.current = true;
      const url = await resolveChatSocketUrl();
      if (attempt !== attemptRef.current) return;
      connectingRef.current = false;
      if (!mountedRef.current) return;
      if (closedByHookRef.current) return;
      if (!url) {
        reconnectControllerRef.current.schedule(connect);
        return;
      }
      if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket || !mountedRef.current) return;
        reconnectControllerRef.current.reset();
        setConnected(true);
        joinedRef.current.forEach((conversationId) => {
          socket.send(JSON.stringify({ type: 'chat:join', payload: { conversation_id: conversationId } }));
        });
        socket.send(JSON.stringify({ type: 'presence:heartbeat', payload: { status: 'ONLINE' } }));
      };
      socket.onmessage = (message) => {
        if (!mountedRef.current || socketRef.current !== socket) return;
        try {
          const event = JSON.parse(message.data);
          if (!seenRef.current.accept(event.event_id)) return;
          if (event.type === 'chat:joined') {
            eventHandlerRef.current({ version: 'v1', type: 'realtime:reconnected', payload: {} });
          }
          eventHandlerRef.current(event);
        } catch {
        }
      };
      socket.onclose = (event) => {
        const shouldHandleClose = socketRef.current === socket;
        if (!shouldHandleClose) return;
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
    if (!user?.id) return;
    mountedRef.current = true;
    reconnectControllerRef.current.activate();
    connect();
    const heartbeat = window.setInterval(() => send('presence:heartbeat', { status: document.hidden ? 'AWAY' : 'ONLINE' }), 30000);
    return () => {
      mountedRef.current = false;
      setConnected(false);
      attemptRef.current += 1;
      connectingRef.current = false;
      seenRef.current = new RecentEventIds();
      joinedRef.current.clear();
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
  }, [connect, send, user?.id, user?.tenantId]);

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
