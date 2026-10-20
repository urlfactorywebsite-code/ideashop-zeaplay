import { NotificationEntityType, NotificationType, type Notification } from '../types';

export function notificationDestination(notification: Notification, origin: string): string | null {
  if (notification.type === NotificationType.TASK_DELETED) return '/tasks';
  if (notification.type === NotificationType.TICKET_DELETED) return '/tickets';
  if (notification.type === NotificationType.CHAT_MESSAGE && notification.relatedChatId) {
    return `/chat/${encodeURIComponent(notification.relatedChatId)}`;
  }
  if (notification.relatedTaskId) {
    const query = new URLSearchParams({ taskId: notification.relatedTaskId });
    if (notification.entityType === NotificationEntityType.SUBTASK && notification.entityId) {
      query.set('subtaskId', notification.entityId);
    }
    return `/tasks?${query}`;
  }
  if (notification.relatedChatId) return `/chat/${encodeURIComponent(notification.relatedChatId)}`;
  if (!notification.deepLink) return null;
  try {
    let url = new URL(notification.deepLink, origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.hash.startsWith('#/')) url = new URL(url.hash.slice(1), origin);
    if (url.origin !== origin || url.username || url.password) return null;
    // Accept links from older backend builds while using current application routes.
    if (/^\/(?:users|departments)(?:\/[A-Za-z0-9_-]+)?\/?$/.test(url.pathname)) return '/admin/users';
    const legacy = /^\/(tasks|tickets|projects|clients)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (legacy) return `/${legacy[1]}?${legacy[1].slice(0, -1)}Id=${encodeURIComponent(legacy[2])}`;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}
