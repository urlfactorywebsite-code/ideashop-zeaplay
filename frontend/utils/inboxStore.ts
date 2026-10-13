import { Notification, NotificationType } from '../types';

const notificationKey = (userId: string) => `zeaplay.localNotifications.${userId}`;
const missionLogKey = 'zeaplay.missionLog';

export type MissionLogEntry = {
  id: string;
  taskId?: string | null;
  taskTitle?: string | null;
  authorId: string;
  authorName: string;
  message: string;
  mentions: string[];
  createdAt: string;
  isRead: boolean;
};

const readJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

export const getLocalNotifications = (userId: string): Notification[] =>
  readJson<Notification[]>(notificationKey(userId), []);

export const addLocalNotification = (userId: string, payload: Omit<Notification, 'id' | 'userId' | 'createdAt'>) => {
  const next: Notification = {
    ...payload,
    id: createId(),
    userId,
    createdAt: new Date().toISOString(),
    source: 'local',
  };
  const existing = getLocalNotifications(userId);
  writeJson(notificationKey(userId), [next, ...existing]);
  return next;
};

export const markLocalNotificationsRead = (userId: string, ids?: string[]) => {
  const existing = getLocalNotifications(userId);
  const updated = existing.map((item) =>
    !ids || ids.includes(item.id) ? { ...item, isRead: true } : item,
  );
  writeJson(notificationKey(userId), updated);
};

export const deleteLocalNotifications = (userId: string, ids: string[]) => {
  const existing = getLocalNotifications(userId);
  writeJson(
    notificationKey(userId),
    existing.filter((item) => !ids.includes(item.id)),
  );
};

export const addMentionNotifications = ({
  authorName,
  mentionedUserIds,
  message,
  entityType,
  entityId,
  deepLink,
}: {
  authorName: string;
  mentionedUserIds: string[];
  message: string;
  entityType: Notification['entityType'];
  entityId?: string;
  deepLink?: string;
}) => {
  mentionedUserIds.forEach((userId) => {
    addLocalNotification(userId, {
      type: NotificationType.MENTION,
      title: 'You were mentioned',
      body: message,
      message: `${authorName} mentioned you.`,
      entityType,
      entityId: entityId ?? null,
      deepLink: deepLink ?? null,
      isRead: false,
      relatedTaskId: entityType === 'task' ? entityId ?? null : null,
      relatedRewardId: null,
    });
  });
};

export const getMissionLogEntries = (): MissionLogEntry[] =>
  readJson<MissionLogEntry[]>(missionLogKey, []);

export const addMissionLogEntry = (entry: Omit<MissionLogEntry, 'id' | 'createdAt' | 'isRead'>) => {
  const next: MissionLogEntry = {
    ...entry,
    id: createId(),
    createdAt: new Date().toISOString(),
    isRead: false,
  };
  const existing = getMissionLogEntries();
  writeJson(missionLogKey, [next, ...existing]);
  return next;
};

export const markMissionLogRead = (ids?: string[]) => {
  const existing = getMissionLogEntries();
  const updated = existing.map((entry) =>
    !ids || ids.includes(entry.id) ? { ...entry, isRead: true } : entry,
  );
  writeJson(missionLogKey, updated);
};

export const deleteMissionLogEntries = (ids: string[]) => {
  const existing = getMissionLogEntries();
  writeJson(
    missionLogKey,
    existing.filter((entry) => !ids.includes(entry.id)),
  );
};
