import { NotificationEntityType, NotificationType, type Notification, type NotificationModule } from '../types';

export const MAX_NOTIFICATION_SELECTION = 500;
export const notificationCategories: ReadonlyArray<{ value: NotificationModule | 'other'; label: string }> = [
  { value: 'tasks', label: 'Tasks' }, { value: 'projects', label: 'Projects' },
  { value: 'clients', label: 'Clients' }, { value: 'tickets', label: 'Tickets' },
  { value: 'users', label: 'People' }, { value: 'departments', label: 'Departments' },
  { value: 'comments', label: 'Comments & mentions' }, { value: 'chat', label: 'Chat' },
  { value: 'rewards', label: 'Rewards & achievements' }, { value: 'other', label: 'Other' },
];
export type NotificationFilters = {
  read: 'all' | 'unread' | 'read';
  category: 'all' | NotificationModule | 'other';
  search: string;
};
export const defaultNotificationFilters: NotificationFilters = { read: 'all', category: 'all', search: '' };

export function notificationCategory(notification: Notification): NotificationModule | 'other' {
  const type = notification.type;
  if (notification.entityType === NotificationEntityType.TICKET
      && [NotificationType.TASK_OVERDUE, NotificationType.APPROVAL_REQUESTED, NotificationType.APPROVAL_ACTED, NotificationType.SLA_BREACH].includes(type)) return 'tickets';
  if (type.startsWith('TASK_') || type.startsWith('SUBTASK_') || type.startsWith('APPROVAL_') || type === NotificationType.SLA_BREACH) return 'tasks';
  if (type.startsWith('PROJECT_')) return 'projects';
  if (type.startsWith('CLIENT_')) return 'clients';
  if (type.startsWith('TICKET_')) return 'tickets';
  if (type.startsWith('USER_')) return 'users';
  if (type.startsWith('DEPARTMENT_')) return 'departments';
  if (type === NotificationType.COMMENT_ADDED || type === NotificationType.MENTION) return 'comments';
  if (type === NotificationType.CHAT_MESSAGE) return 'chat';
  if (type === NotificationType.REWARD_CLAIMED || type === NotificationType.ACHIEVEMENT_UNLOCKED) return 'rewards';
  return 'other';
}

export function filterNotifications(items: Notification[], filters: NotificationFilters): Notification[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return items.filter(item => (filters.read === 'all' || item.isRead === (filters.read === 'read'))
    && (filters.category === 'all' || notificationCategory(item) === filters.category)
    && (!search || [item.title, item.body, item.message].some(value => value?.toLocaleLowerCase().includes(search))));
}
