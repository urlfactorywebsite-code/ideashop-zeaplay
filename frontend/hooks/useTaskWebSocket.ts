import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWebSocketTicket, toWebSocketBaseUrl } from '../services/realtimeAuth';
import { RealtimeReconnectController } from '../services/realtimeBackoff';

type TaskSocketStatus = 'connected' | 'connecting' | 'offline';

type TaskSocketEvent = Record<string, unknown>;

type UseTaskWebSocketOptions = {
  enabled?: boolean;
  onEvent?: (payload: TaskSocketEvent) => void;
};

const resolveTasksSocketUrl = (): string | null => {
  const base =
    import.meta.env.VITE_API_URL ??
    import.meta.env.VITE_API_BASE_URL ??
    (typeof window !== 'undefined' ? window.location.origin : '');

  if (!base) {
    return null;
  }

  return `${toWebSocketBaseUrl(base)}/ws/tasks`;
};

export const useTaskWebSocket = ({ enabled = true, onEvent }: UseTaskWebSocketOptions) => {
  const [status, setStatus] = useState<TaskSocketStatus>('offline');
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectControllerRef = useRef(new RealtimeReconnectController({ minDelayMs: 1000, maxDelayMs: 15000 }));
  const connectAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const connectingRef = useRef(false);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const cleanup = useCallback(() => {
    connectAttemptRef.current += 1;
    reconnectControllerRef.current.cancel();
    connectingRef.current = false;
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }
    if (!mountedRef.current || connectingRef.current) {
      return;
    }
    void (async () => {
      const attempt = ++connectAttemptRef.current;
      connectingRef.current = true;
      const token = await getWebSocketTicket('tasks');
      const wsUrl = resolveTasksSocketUrl();
      connectingRef.current = false;
      if (attempt !== connectAttemptRef.current) return;
      if (!mountedRef.current) return;
      if (!token || !wsUrl) {
        setStatus('offline');
        return;
      }

      const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
      setStatus('connecting');
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket || !mountedRef.current) return;
        reconnectControllerRef.current.reset();
        setStatus('connected');
        if (hasOpenedRef.current) {
          onEventRef.current?.({ type: 'realtime:reconnected' });
        }
        hasOpenedRef.current = true;
      };

      socket.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          onEventRef.current?.(payload);
        } catch {
          // ignore malformed payload
        }
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setStatus('offline');
        if (!mountedRef.current || !enabled || event.code === 1008) {
          return;
        }
        reconnectControllerRef.current.schedule(connect);
      };

      socket.onerror = () => {
        socket.close();
      };
    })();
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    reconnectControllerRef.current.activate();
    if (!enabled) {
      cleanup();
      setStatus('offline');
      return;
    }
    connect();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [cleanup, connect, enabled]);

  return useMemo(
    () => ({
      status,
    }),
    [status],
  );
};
