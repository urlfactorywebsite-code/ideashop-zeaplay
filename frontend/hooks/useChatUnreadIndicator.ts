import { useCallback, useEffect, useState } from 'react';

import api from '../services/api';
import { NotificationType } from '../types';
import { APP_REFRESH_EVENT, CHAT_UNREAD_REFRESH_EVENT } from '../utils/appEvents';
import { useAuth } from './useAuth';

const REFRESH_INTERVAL_MS = 30000;

export const useChatUnreadIndicator = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const refreshChatUnread = useCallback(async () => {
    if (!userId) {
      setUnreadChatCount(0);
      return;
    }

    try {
      const [notifications, conversations] = await Promise.all([
        api.getNotifications(userId).catch(() => []),
        api.getChatConversations().catch(() => []),
      ]);
      const unreadChatNotifications = notifications.filter(
        (notification) => notification.type === NotificationType.CHAT_MESSAGE && !notification.isRead,
      ).length;
      const unreadConversationMessages = conversations.reduce(
        (total, conversation) => total + (conversation.unreadCount ?? 0),
        0,
      );

      setUnreadChatCount(Math.max(unreadChatNotifications, unreadConversationMessages));
    } catch (error) {
      console.error('Failed to refresh chat unread indicator:', error);
    }
  }, [userId]);

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
      window.removeEventListener(APP_REFRESH_EVENT, handleRefresh);
      window.removeEventListener(CHAT_UNREAD_REFRESH_EVENT, handleRefresh);
      window.clearInterval(interval);
    };
  }, [refreshChatUnread]);

  return {
    unreadChatCount,
    hasUnreadChat: unreadChatCount > 0,
    refreshChatUnread,
  };
};
