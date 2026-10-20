import { RealtimeReconnectController } from './realtimeBackoff';

export const NOTIFICATIONS_CHANGED_EVENT = 'zea:notifications-changed';

// Event frames may span network chunks; comment heartbeats are deliberately ignored.
export function createNotificationEventParser(onChange: () => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const lines = frame.split(/\r?\n/);
      const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (event === 'notifications.changed') {
        onChange();
      } else if (data) {
        try { if (JSON.parse(data)?.type === 'notifications.changed') onChange(); } catch { /* malformed frame */ }
      }
    }
    // A broken intermediary must not grow the buffer indefinitely.
    if (buffer.length > 65536) buffer = '';
  };
}

export function startNotificationStream(options: {
  url: string;
  getToken: () => string | null;
  isCurrentSession: () => boolean;
  onChange: () => void;
}) {
  let stopped = false;
  let controller: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const reconnect = new RealtimeReconnectController({ minDelayMs: 1000, maxDelayMs: 15000 });
  const connect = async () => {
    if (stopped || controller || !options.isCurrentSession()) return;
    const token = options.getToken();
    if (!token) return;
    const attempt = new AbortController();
    controller = attempt;
    const current = () => !stopped && options.isCurrentSession();
    const keepAlive = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => attempt.abort(), 45000);
    };
    try {
      keepAlive();
      const response = await fetch(options.url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: attempt.signal,
      });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('Notification stream unavailable');
      }
      const parse = createNotificationEventParser(() => { if (current()) options.onChange(); });
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      try {
        while (current()) {
          const { value, done } = await reader.read();
          if (done) break;
          keepAlive();
          reconnect.reset();
          parse(decoder.decode(value, { stream: true }));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      // Reconcile through history polling while the stream reconnects.
    } finally {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
      if (controller === attempt) controller = null;
      if (current()) reconnect.schedule(() => void connect());
    }
  };
  void connect();
  return () => {
    stopped = true;
    reconnect.cancel();
    controller?.abort();
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  };
}
