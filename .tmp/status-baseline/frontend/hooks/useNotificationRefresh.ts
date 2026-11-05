import { useEffect, useRef } from 'react';
import { NOTIFICATIONS_CHANGED_EVENT } from '../services/notificationRealtime';
import { useAuth } from './useAuth';

// Share the header's one stream; visible readers reconcile through authorized APIs.
export function useNotificationRefresh(refresh: () => void) {
  const { user } = useAuth();
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = (event: Event) => {
      const notice = (event as CustomEvent<{ userId: string; tenantId: string | null }>).detail;
      if (notice?.userId !== user.id || notice.tenantId !== (user.tenantId ?? null) || timer) return;
      timer = setTimeout(() => { timer = null; latest.current(); }, 200);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    };
  }, [user?.id, user?.tenantId]);
}
