import api from '../../../services/api';
import { CHAT_UNREAD_REFRESH_EVENT } from '../../../utils/appEvents';
import { UserStatus } from '../../../types';
import { ChatConversationCreatePayload, ChatDirectCreatePayload, ChatDirectoryPage, ChatMessageCreatePayload } from '../types';

const emitChatUnreadRefresh = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_UNREAD_REFRESH_EVENT));
  }
};

const listUsersFromDirectoryFallback = async (
  options?: { search?: string; cursor?: string | null; limit?: number; teamId?: string | null },
): Promise<ChatDirectoryPage> => {
  const users = await api.getUsers();
  const needle = options?.search?.trim().toLowerCase();
  const items = users
    .filter((user) => user.status === UserStatus.ACTIVE)
    .filter((user) => {
      if (!needle) return true;
      return [user.name, user.email, user.department, user.title]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    })
    .slice(0, options?.limit ?? 100)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? user.profileImageUrl ?? null,
      presence: 'OFFLINE' as const,
      lastSeenAt: null,
      roleName: user.role,
      teamName: user.department || null,
      title: user.title ?? null,
      existingConversationId: null,
      isFavorite: false,
      unreadCount: 0,
      latestMessagePreview: null,
      lastMessageAt: null,
    }));
  return { items, nextCursor: null };
};

export const chatService = {
  listConversations: () => api.getChatConversations(),
  listUsers: async (options?: { search?: string; cursor?: string | null; limit?: number; teamId?: string | null }): Promise<ChatDirectoryPage> => {
    try {
      const directory = await api.getChatUsers(options);
      return directory.items.length > 0 ? directory : listUsersFromDirectoryFallback(options);
    } catch (error) {
      return listUsersFromDirectoryFallback(options);
    }
  },
  getConversation: (conversationId: string) => api.getChatConversation(conversationId),
  createConversation: (payload: ChatConversationCreatePayload) => api.createChatConversation(payload),
  startDirect: (payload: ChatDirectCreatePayload) => api.startDirectChat(payload),
  listMessages: (conversationId: string, cursor?: string | null, limit = 50) =>
    api.getChatMessages(conversationId, { cursor, limit }),
  sendMessage: async (conversationId: string, payload: ChatMessageCreatePayload) => {
    const message = await api.sendChatMessage(conversationId, payload);
    emitChatUnreadRefresh();
    return message;
  },
  updateMessage: (messageId: string, content: string) => api.updateChatMessage(messageId, content),
  deleteMessage: (messageId: string) => api.deleteChatMessage(messageId),
  addMembers: (conversationId: string, userIds: string[]) => api.addChatMembers(conversationId, userIds),
  updateMember: (conversationId: string, userId: string, payload: { isPinned?: boolean; isMuted?: boolean }) =>
    api.updateChatMember(conversationId, userId, payload),
  removeMember: (conversationId: string, userId: string) => api.removeChatMember(conversationId, userId),
  markRead: async (conversationId: string, lastReadMessageId?: string | null) => {
    const member = await api.markChatRead(conversationId, lastReadMessageId);
    emitChatUnreadRefresh();
    return member;
  },
  addReaction: (messageId: string, emoji: string) => api.addChatReaction(messageId, emoji),
  removeReaction: (messageId: string, emoji: string) => api.removeChatReaction(messageId, emoji),
  uploadAttachment: (conversationId: string, file: File, onProgress?: (progress: number) => void) =>
    api.uploadChatAttachment(conversationId, file, onProgress),
  searchMessages: (options: { q: string; conversationId?: string | null; senderId?: string | null; cursor?: string | null; limit?: number }) =>
    api.searchChatMessages(options),
  listPins: (conversationId: string) => api.getChatPinnedMessages(conversationId),
  pinMessage: (conversationId: string, messageId: string) => api.pinChatMessage(conversationId, messageId),
  unpinMessage: (conversationId: string, messageId: string) => api.unpinChatMessage(conversationId, messageId),
};
