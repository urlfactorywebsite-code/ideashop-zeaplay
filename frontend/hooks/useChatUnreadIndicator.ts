import { useCallback, useEffect, useRef, useState } from 'react';

import api from '../services/api';
import { NotificationType, type ChatConversation, type Notification } from '../types';
import { APP_REFRESH_EVENT, CHAT_UNREAD_REFRESH_EVENT } from '../utils/appEvents';
import { useAuth } from './useAuth';

const REFRESH_INTERVAL_MS = 30000;

export const useChatUnreadIndicator = () => {
  const { user, isCurrentSession } = useAuth();
  const userId = user?.id ?? null;
  const identity = `${user?.tenantId ?? ''}:${userId ?? ''}`;
  const [unread, setUnread] = useState({ identity, count: 0 });
  const sequence = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  const refreshChatUnread = useCallback(async () => {
    if (!userId) {
      setUnread({ identity, count: 0 });
      return;
    }
    const request = ++sequence.current;
    try {
      const [notifications, conversations] = await Promise.all([
        api.getNotifications(userId).catch((): Notification[] => []),
        api.getChatConversations().catch((): ChatConversation[] => []),
      ]);
      const unreadChatNotifications = notifications.filter(
        (notification) => notification.type === NotificationType.CHAT_MESSAGE && !notification.isRead,
      ).length;
      const unreadConversationMessages = conversations.reduce(
        (total, conversation) => total + (conversation.unreadCount ?? 0),
        0,
      );

      if (request === sequence.current && currentIdentity.current === identity && isCurrentSession()) {
        setUnread({ identity, count: Math.max(unreadChatNotifications, unreadConversationMessages) });
      }
    } catch (error) {
      console.error('Failed to refresh chat unread indicator:', error);
    }
  }, [userId, identity, isCurrentSession]);

  useEffect(() => {
    void refreshChatUnread();
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleRefresh = () => {
      void refreshChatUnread();
    };
    window.addEventListener(APP_REFRESH_EVENT, handleRefresh);
    window.addEventListener(CHAT_UNREAD_REFRESH_EVENT, handleRefresh);
    const interval = window.setInterval(handleRefresh, REFRESH_INTERVAL_MS);

    return () => {
      ++sequence.current;
      window.removeEventListener(APP_REFRESH_EVENT, handleRefresh);
      window.removeEventListener(CHAT_UNREAD_REFRESH_EVENT, handleRefresh);
      window.clearInterval(interval);
    };
  }, [refreshChatUnread]);

  const unreadChatCount = unread.identity === identity ? unread.count : 0;
  return {
    unreadChatCount,
    hasUnreadChat: unreadChatCount > 0,
    refreshChatUnread,
  };
};
