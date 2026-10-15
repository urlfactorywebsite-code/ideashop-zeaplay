import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './tokenStorage';
import { getPresenceSocketToken, resolvePresenceSocketUrl } from './realtimeAuth';

type SharedSocketStatus = 'connecting' | 'connected' | 'offline';
type EventHandler = (...args: any[]) => void;
type StatusHandler = (status: SharedSocketStatus, error?: string) => void;

export type SharedSocketIoLease = {
  key: string;
  on: (eventName: string, handler: EventHandler) => () => void;
  emit: (eventName: string, ...args: any[]) => boolean;
  subscribeStatus: (handler: StatusHandler) => () => void;
  reconnect: () => void;
  release: () => void;
};

type SharedSocketEntry = {
  key: string;
  url: string;
  userId: string;
  refs: number;
  socket: Socket | null;
  status: SharedSocketStatus;
  error?: string;
  connecting: boolean;
  disposed: boolean;
  releaseTimer: number | null;
  listeners: Map<string, Set<EventHandler>>;
  statusListeners: Set<StatusHandler>;
};

export const SHARED_SOCKET_RELEASE_DELAY_MS = 750;
const sharedSockets = new Map<string, SharedSocketEntry>();

const tokenFingerprint = (token: string | null): string => {
  if (!token) return 'anonymous';
  let hash = 5381;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) + hash) ^ token.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

const setStatus = (entry: SharedSocketEntry, status: SharedSocketStatus, error?: string) => {
  entry.status = status;
  entry.error = error;
  entry.statusListeners.forEach((handler) => handler(status, error));
};

const attachStoredListeners = (entry: SharedSocketEntry, socket: Socket) => {
  entry.listeners.forEach((handlers, eventName) => {
    handlers.forEach((handler) => socket.on(eventName, handler));
  });
};

const detachStoredListeners = (entry: SharedSocketEntry, socket: Socket) => {
  entry.listeners.forEach((handlers, eventName) => {
    handlers.forEach((handler) => socket.off(eventName, handler));
  });
};

const closeSocket = (entry: SharedSocketEntry) => {
  if (!entry.socket) return;
  detachStoredListeners(entry, entry.socket);
  entry.socket.removeAllListeners('connect');
  entry.socket.removeAllListeners('disconnect');
  entry.socket.removeAllListeners('connect_error');
  entry.socket.disconnect();
  entry.socket = null;
};

const isAuthSocketError = (message?: string) => /auth|token|jwt|expired|unauthorized|forbidden/i.test(message || '');

const ensureConnected = async (entry: SharedSocketEntry): Promise<void> => {
  if (entry.disposed || entry.connecting || entry.socket) return;
  entry.connecting = true;
  setStatus(entry, 'connecting');
  const token = await getPresenceSocketToken();
  entry.connecting = false;
  if (entry.disposed || !token) {
    setStatus(entry, 'offline', token ? undefined : 'Missing realtime token');
    return;
  }

  const socket = io(entry.url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    timeout: 10000,
  });
  entry.socket = socket;
  attachStoredListeners(entry, socket);

  socket.on('connect', () => setStatus(entry, 'connected'));
  socket.on('disconnect', (reason) => setStatus(entry, 'offline', reason));
  socket.on('connect_error', (error) => {
    const message = error instanceof Error ? error.message : 'Connection failed';
    setStatus(entry, 'offline', message);
    if (isAuthSocketError(message)) {
      closeSocket(entry);
    }
  });
};

const disposeEntry = (entry: SharedSocketEntry) => {
  entry.disposed = true;
  if (entry.releaseTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(entry.releaseTimer);
  }
  entry.releaseTimer = null;
  closeSocket(entry);
  entry.listeners.clear();
  entry.statusListeners.clear();
  sharedSockets.delete(entry.key);
};

export const buildSharedSocketKey = (url: string, userId: string): string => {
  const token = getAccessToken();
  return `${url}|${userId}|${tokenFingerprint(token)}`;
};

export const acquireSharedPresenceSocket = (userId: string): SharedSocketIoLease | null => {
  const url = resolvePresenceSocketUrl();
  const accessToken = getAccessToken();
  if (!url || !accessToken || !userId) return null;
  const key = buildSharedSocketKey(url, userId);
  let entry = sharedSockets.get(key);
  if (!entry) {
    entry = {
      key,
      url,
      userId,
      refs: 0,
      socket: null,
      status: 'offline',
      connecting: false,
      disposed: false,
      releaseTimer: null,
      listeners: new Map(),
      statusListeners: new Set(),
    };
    sharedSockets.set(key, entry);
  }
  if (entry.releaseTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.disposed = false;
  entry.refs += 1;
  void ensureConnected(entry);

  return {
    key,
    on(eventName, handler) {
      const handlers = entry.listeners.get(eventName) ?? new Set<EventHandler>();
      handlers.add(handler);
      entry.listeners.set(eventName, handlers);
      entry.socket?.on(eventName, handler);
      return () => {
        handlers.delete(handler);
        entry.socket?.off(eventName, handler);
        if (handlers.size === 0) {
          entry.listeners.delete(eventName);
        }
      };
    },
    emit(eventName, ...args) {
      if (!entry.socket?.connected) return false;
      entry.socket.emit(eventName, ...args);
      return true;
    },
    subscribeStatus(handler) {
      entry.statusListeners.add(handler);
      handler(entry.status, entry.error);
      return () => {
        entry.statusListeners.delete(handler);
      };
    },
    reconnect() {
      void ensureConnected(entry);
    },
    release() {
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs > 0) return;
      if (typeof window === 'undefined') {
        disposeEntry(entry);
        return;
      }
      entry.releaseTimer = window.setTimeout(() => {
        if (entry.refs === 0) {
          disposeEntry(entry);
        }
      }, SHARED_SOCKET_RELEASE_DELAY_MS);
    },
  };
};

export const getSharedSocketDiagnostics = () => ({
  entries: sharedSockets.size,
  refs: Array.from(sharedSockets.values()).map((entry) => ({
    key: entry.key,
    userId: entry.userId,
    refs: entry.refs,
    status: entry.status,
    listenerCount: Array.from(entry.listeners.values()).reduce((total, handlers) => total + handlers.size, 0),
  })),
});
