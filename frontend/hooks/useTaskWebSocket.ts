import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAccessToken } from '../services/tokenStorage';

type TaskSocketStatus = 'connected' | 'connecting' | 'offline';

type TaskSocketEvent = Record<string, unknown>;

type UseTaskWebSocketOptions = {
  enabled?: boolean;
  onEvent?: (payload: TaskSocketEvent) => void;
};

const MAX_RECONNECT_DELAY_MS = 15000;
const BASE_RECONNECT_DELAY_MS = 1000;

const resolveTasksSocketUrl = (): string | null => {
  const base =
    import.meta.env.VITE_API_URL ??
    import.meta.env.VITE_API_BASE_URL ??
    (typeof window !== 'undefined' ? window.location.origin : '');

  if (!base) {
    return null;
  }

  const normalized = base.replace(/\/$/, '');
  const protocol = normalized.startsWith('https') ? 'wss' : 'ws';
  const wsBase = normalized.replace(/^https?/, protocol);
  return `${wsBase}/ws/tasks`;
};

export const useTaskWebSocket = ({ enabled = true, onEvent }: UseTaskWebSocketOptions) => {
  const [status, setStatus] = useState<TaskSocketStatus>('offline');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const cleanup = useCallback(() => {
    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }
    const token = getAccessToken();
    const wsUrl = resolveTasksSocketUrl();
    if (!token || !wsUrl) {
      setStatus('offline');
      return;
    }

    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    setStatus('connecting');
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      retryCountRef.current = 0;
      setStatus('connected');
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        onEvent?.(payload);
      } catch {
        // ignore malformed payload
      }
    });

    socket.addEventListener('close', () => {
      setStatus('offline');
      if (!enabled) {
        return;
      }
      const retryDelay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** retryCountRef.current,
        MAX_RECONNECT_DELAY_MS,
      );
      retryCountRef.current += 1;
      reconnectRef.current = window.setTimeout(() => {
        connect();
      }, retryDelay);
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }, [enabled, onEvent]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      setStatus('offline');
      return;
    }
    connect();
    return () => {
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
