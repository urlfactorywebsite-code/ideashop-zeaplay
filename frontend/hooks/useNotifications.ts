import { useCallback, useEffect, useRef, useState } from 'react';
import api, { API_BASE_URL } from '../services/mockApi';
import { getAccessToken } from '../services/tokenStorage';
import { NOTIFICATIONS_CHANGED_EVENT, startNotificationStream } from '../services/notificationRealtime';
import { APP_REFRESH_EVENT, CHAT_UNREAD_REFRESH_EVENT } from '../utils/appEvents';
import type { Notification } from '../types';
import { useAuth } from './useAuth';

export function useNotifications() {
  const { user, isCurrentSession } = useAuth();
  const identity = `${user?.tenantId ?? ''}:${user?.id ?? ''}`;
  const [state, setState] = useState<{ identity: string; items: Notification[] }>({ identity, items: [] });
  const refreshRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => refreshRef.current(), []);
  const setNotifications = useCallback((update: (items: Notification[]) => Notification[]) => {
    setState(previous => ({ identity, items: update(previous.identity === identity ? previous.items : []) }));
  }, [identity]);

  useEffect(() => {
    setState({ identity, items: [] });
    if (!user) return;
    let active = true;
    let running = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const valid = () => active && isCurrentSession();
    const load = async () => {
      if (!valid()) return;
      pending = true;
      if (running) return;
      running = true;
      pending = false;
      try {
        const items = await api.getNotifications(user.id);
        if (valid()) setState({ identity, items: items.filter(item => item.userId === user.id &&
          (!item.tenantId || item.tenantId === user.tenantId)) });
      } catch {
        // Preserve existing history during transient network errors.
      } finally {
        running = false;
        if (pending && valid()) schedule();
      }
    };
    const schedule = () => {
      pending = true;
      if (!valid() || timer) return;
      timer = setTimeout(() => { timer = null; void load(); }, 100);
    };
    refreshRef.current = schedule;
    void load();
    const stop = startNotificationStream({
      url: `${API_BASE_URL}/notifications/stream`,
      getToken: getAccessToken,
      isCurrentSession: valid,
      onChange: () => {
        api.invalidateNotificationCaches();
        schedule();
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, {
          detail: { userId: user.id, tenantId: user.tenantId ?? null },
        }));
        window.dispatchEvent(new Event(CHAT_UNREAD_REFRESH_EVENT));
      },
    });
    const reconcile = () => { if (!document.hidden) schedule(); };
    const interval = setInterval(reconcile, 30000);
    window.addEventListener(APP_REFRESH_EVENT, schedule);
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      active = false;
      stop();
      refreshRef.current = () => undefined;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(APP_REFRESH_EVENT, schedule);
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [identity, user?.id, user?.tenantId, isCurrentSession]);

  return { notifications: state.identity === identity ? state.items : [], setNotifications, refresh };
}
