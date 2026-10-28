import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatAttachment, ChatConversation, ChatDirectoryUser, ChatMessage } from '../types';
import { chatService } from '../services/chatService';
import { useChatRealtime, ChatRealtimeEvent } from './useChatRealtime';
import { useAuth } from '../../../hooks/useAuth';
import { CHAT_UNREAD_REFRESH_EVENT } from '../../../utils/appEvents';
import { Role } from '../../../types';
import { normalizeMessage } from '../utils/normalizeMessage';
import { mergeRecoveredMessages } from '../../../services/realtimeRecovery';
import { inactiveChatUserIds, visibleChatConversations } from '../utils/userVisibility';

const emitChatUnreadRefresh = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_UNREAD_REFRESH_EVENT));
  }
};

export const useChat = (initialConversationId?: string | null) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<ChatDirectoryUser[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, Record<string, string>>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>>({});
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const messageRequestSeqRef = useRef(0);
  const conversationRequestSeqRef = useRef(0);
  const directoryRequestSeqRef = useRef(0);
  const userIdRef = useRef(`${user?.id}:${user?.tenantId}`);
  userIdRef.current = `${user?.id}:${user?.tenantId}`;
  const messageCursorInFlightRef = useRef<Set<string>>(new Set());
  const pendingSendTimersRef = useRef<Record<string, number>>({});
  const reconcileAfterReconnectRef = useRef<() => void>(() => {});
  const refreshConversationsRef = useRef<() => void>(() => {});
  const conversationRefreshTimerRef = useRef<number | null>(null);
  const recoveryEventsRef = useRef<Map<string, ChatMessage> | null>(null);
  const recoveryOverflowRef = useRef(false);
  const bufferRecoveryMessage = useCallback((message: ChatMessage) => {
    const buffer = recoveryEventsRef.current;
    if (!buffer) return;
    buffer.set(message.clientId || message.id, message);
    if (buffer.size > 2000) {
      buffer.delete(buffer.keys().next().value!);
      recoveryOverflowRef.current = true;
    }
  }, []);

  useEffect(() => {
    messageRequestSeqRef.current += 1;
    recoveryEventsRef.current = null;
    setMessages([]);
    setNextCursor(null);
    setHasMore(false);
    messageCursorInFlightRef.current.clear();
    setConversations([]);
    setDirectoryUsers([]);
    setSelectedConversationId(null);
    setTypingByConversation({});
    setPresenceByUserId({});
  }, [user?.id, user?.tenantId]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    if (initialConversationId) {
      setSelectedConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  const loadConversations = useCallback(async () => {
    const requestedUserId = userIdRef.current;
    const requestSeq = ++conversationRequestSeqRef.current;
    setLoadingConversations(true);
    setError(null);
    try {
      const rawData = await chatService.listConversations();
      const inactiveIds = inactiveChatUserIds(rawData);
      const data = visibleChatConversations(rawData, user?.id);
      if (userIdRef.current !== requestedUserId || requestSeq !== conversationRequestSeqRef.current) return;
      setConversations(data);
      setDirectoryUsers((current) => {
        const byUserId = new Map(current.filter(item => !inactiveIds.has(item.id)).map((item) => [item.id, item]));
        data.forEach((conversation) => {
          if (conversation.type !== 'DIRECT') return;
          const other = conversation.members.find((member) => member.userId !== user?.id);
          if (!other || byUserId.has(other.userId)) return;
          byUserId.set(other.userId, {
            id: other.userId,
            name: other.name,
            email: other.email,
            avatarUrl: other.avatarUrl ?? null,
            presence: 'OFFLINE',
            lastSeenAt: null,
            roleName: other.appRole,
            teamName: other.departmentName ?? null,
            title: other.title ?? null,
            existingConversationId: conversation.id,
            isFavorite: other.isPinned,
            unreadCount: conversation.unreadCount,
            latestMessagePreview: conversation.lastMessage?.content ?? null,
            lastMessageAt: conversation.lastMessageAt ?? null,
          });
        });
        return Array.from(byUserId.values()).sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedConversationId((current) => {
        if (current && data.some((conversation) => conversation.id === current)) {
          return current;
        }
        if (initialConversationId && data.some((conversation) => conversation.id === initialConversationId)) {
          return initialConversationId;
        }
        return data[0]?.id ?? null;
      });
    } catch (err) {
      if (userIdRef.current !== requestedUserId || requestSeq !== conversationRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to load conversations');
    } finally {
      if (userIdRef.current === requestedUserId && requestSeq === conversationRequestSeqRef.current) setLoadingConversations(false);
    }
  }, [initialConversationId, user?.id, user?.tenantId]);

  useEffect(() => {
    refreshConversationsRef.current = () => { void loadConversations(); };
    return () => {
      if (conversationRefreshTimerRef.current !== null) window.clearTimeout(conversationRefreshTimerRef.current);
    };
  }, [loadConversations]);

  const loadDirectoryUsers = useCallback(async (search?: string) => {
    const requestedUserId = userIdRef.current;
    const requestSeq = ++directoryRequestSeqRef.current;
    setLoadingDirectory(true);
    try {
      const page = await chatService.listUsers({ search, limit: 100 });
      if (userIdRef.current !== requestedUserId || requestSeq !== directoryRequestSeqRef.current) return;
      setDirectoryUsers(page.items.filter((directoryUser) => directoryUser.id !== user?.id));
    } catch (err) {
      if (userIdRef.current !== requestedUserId || requestSeq !== directoryRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to load chat users');
    } finally {
      if (userIdRef.current === requestedUserId && requestSeq === directoryRequestSeqRef.current) setLoadingDirectory(false);
    }
  }, [user?.id, user?.tenantId]);

  const markReadSafely = useCallback(async (conversationId: string, lastReadMessageId?: string | null) => {
    try {
      await chatService.markRead(conversationId, lastReadMessageId);
    } catch (err) {
      console.warn('chat.markRead.failed');
    }
  }, []);

  const applyConversationPreview = useCallback((message: ChatMessage) => {
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== message.conversationId) return conversation;
      return {
        ...conversation,
        lastMessage: message,
        lastMessageAt: message.createdAt,
        updatedAt: message.updatedAt,
        unreadCount: selectedConversationIdRef.current === message.conversationId ? 0 : conversation.unreadCount,
      };
    }));
    setDirectoryUsers((current) => current.map((directoryUser) => {
      const existingConversationId = directoryUser.existingConversationId;
      if (existingConversationId !== message.conversationId) return directoryUser;
      return {
        ...directoryUser,
        latestMessagePreview: message.content,
        lastMessageAt: message.createdAt,
        unreadCount: selectedConversationIdRef.current === message.conversationId ? 0 : directoryUser.unreadCount,
      };
    }));
  }, []);

  const mergeMessage = useCallback((message: unknown, clientId?: string | null, fallback: Partial<ChatMessage> = {}) => {
    const normalizedMessage = normalizeMessage(message, {
      ...fallback,
      clientId: clientId ?? fallback.clientId ?? null,
      deliveryStatus: fallback.deliveryStatus ?? 'sent',
    });
    if (normalizedMessage.conversationId !== selectedConversationIdRef.current) return;
    bufferRecoveryMessage(normalizedMessage);
    setMessages((current) => {
      const existingIndex = current.findIndex((item) => item.id === normalizedMessage.id || (clientId && item.clientId === clientId));
      const nextMessage = { ...normalizedMessage, clientId: clientId ?? normalizedMessage.clientId ?? null, deliveryStatus: 'sent' as const };
      if (nextMessage.clientId && pendingSendTimersRef.current[nextMessage.clientId]) {
        window.clearTimeout(pendingSendTimersRef.current[nextMessage.clientId]);
        delete pendingSendTimersRef.current[nextMessage.clientId];
      }
      if (existingIndex === -1) return mergeRecoveredMessages(current, [nextMessage]);
      const next = [...current];
      next[existingIndex] = nextMessage;
      return mergeRecoveredMessages(next, []);
    });
  }, [bufferRecoveryMessage]);

  const handleRealtimeEvent = useCallback((event: ChatRealtimeEvent) => {
    const payload = event.payload || {};
    if (event.type === 'realtime:reconnected') {
      reconcileAfterReconnectRef.current();
      return;
    }
    if (event.type === 'message:new' && payload.message) {
      const message = normalizeMessage(payload.message, {
        clientId: payload.client_id ?? payload.clientId ?? null,
        conversationId: payload.conversation_id ?? payload.conversationId ?? '',
        deliveryStatus: 'sent',
      });
      const active = message.conversationId === selectedConversationIdRef.current;
      if (active) {
        bufferRecoveryMessage(message);
        mergeMessage(message, message.clientId);
        void markReadSafely(message.conversationId, message.id);
      }
      applyConversationPreview(message);
      emitChatUnreadRefresh();
      return;
    }
    if ((event.type === 'message:updated' || event.type === 'message:deleted' || event.type === 'reaction:added' || event.type === 'reaction:removed') && payload.message) {
      const message = normalizeMessage(payload.message, {
        conversationId: payload.conversation_id ?? payload.conversationId ?? '',
      });
      if (message.conversationId === selectedConversationIdRef.current) {
        bufferRecoveryMessage(message);
        setMessages((current) => current.map((item) => (item.id === message.id ? { ...message, deliveryStatus: item.deliveryStatus } : item)));
      }
      applyConversationPreview(message);
      return;
    }
    if (event.type === 'typing:started') {
      setTypingByConversation((current) => ({
        ...current,
        [payload.conversation_id]: { ...(current[payload.conversation_id] ?? {}), [payload.user_id]: payload.name },
      }));
      return;
    }
    if (event.type === 'typing:stopped') {
      setTypingByConversation((current) => {
        const nextConversation = { ...(current[payload.conversation_id] ?? {}) };
        delete nextConversation[payload.user_id];
        return { ...current, [payload.conversation_id]: nextConversation };
      });
      return;
    }
    if (event.type === 'presence:changed') {
      setPresenceByUserId((current) => ({ ...current, [payload.user_id]: payload.status }));
      setDirectoryUsers((current) => current.map((item) => (
        item.id === payload.user_id ? { ...item, presence: payload.status } : item
      )));
      return;
    }
    if (event.type === 'unread:updated') {
      // Read authoritative counts so late duplicates and out-of-order hints cannot regress them.
      if (conversationRefreshTimerRef.current !== null) window.clearTimeout(conversationRefreshTimerRef.current);
      conversationRefreshTimerRef.current = window.setTimeout(() => refreshConversationsRef.current(), 250);
      emitChatUnreadRefresh();
    }
  }, [applyConversationPreview, bufferRecoveryMessage, markReadSafely, mergeMessage]);

  const { connected: realtimeConnected, send: sendRealtime, join: joinRealtime, leave: leaveRealtime } = useChatRealtime(handleRealtimeEvent);

  const loadMessages = useCallback(async (conversationId: string, cursor?: string | null, force = false) => {
    const requestedUserId = userIdRef.current;
    const cursorKey = cursor ?? '__latest__';
    if (!force && messageCursorInFlightRef.current.has(`${conversationId}:${cursorKey}`)) return;
    messageCursorInFlightRef.current.add(`${conversationId}:${cursorKey}`);
    const requestSeq = cursor ? messageRequestSeqRef.current : ++messageRequestSeqRef.current;
    if (!cursor) {
      recoveryEventsRef.current = new Map();
      recoveryOverflowRef.current = false;
    }
    setLoadingMessages(true);
    setError(null);
    try {
      const page = await chatService.listMessages(conversationId, cursor);
      if (requestedUserId !== userIdRef.current) return;
      if (selectedConversationIdRef.current !== conversationId) return;
      if (!cursor && requestSeq !== messageRequestSeqRef.current) return;
      const bufferedMessages = [...(recoveryEventsRef.current?.values() || [])];
      setMessages((current) => {
        if (!cursor) {
          return mergeRecoveredMessages(page.items, bufferedMessages,
            current.filter((message) => message.conversationId === conversationId && ['sending', 'failed'].includes(message.deliveryStatus || '')));
        }
        return mergeRecoveredMessages(page.items, current);
      });
      setNextCursor(page.nextCursor ?? null);
      setHasMore(page.hasMore);
      if (!cursor) {
        const latestMessage = page.items[page.items.length - 1];
        void markReadSafely(conversationId, latestMessage?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load messages');
    } finally {
      if (requestSeq === messageRequestSeqRef.current && !cursor) recoveryEventsRef.current = null;
      if (requestSeq === messageRequestSeqRef.current && recoveryOverflowRef.current) {
        recoveryOverflowRef.current = false;
        reconcileAfterReconnectRef.current();
      }
      messageCursorInFlightRef.current.delete(`${conversationId}:${cursorKey}`);
      setLoadingMessages(false);
    }
  }, [markReadSafely]);

  useEffect(() => {
    reconcileAfterReconnectRef.current = () => {
      void loadConversations();
      const activeConversationId = selectedConversationIdRef.current;
      if (activeConversationId) {
        void loadMessages(activeConversationId, null, true);
      }
    };
  }, [loadConversations, loadMessages]);

  useEffect(() => {
    void loadConversations();
    void loadDirectoryUsers();
  }, [loadConversations, loadDirectoryUsers]);

  useEffect(() => {
    if (!selectedConversationId || !selectedConversation) {
      setMessages([]);
      return;
    }
    joinRealtime(selectedConversationId);
    void loadMessages(selectedConversationId);
    return () => leaveRealtime(selectedConversationId);
  }, [joinRealtime, leaveRealtime, loadMessages, selectedConversationId, selectedConversation?.id]);

  const sendMessage = useCallback(async (content: string, options?: { replyToMessageId?: string | null; attachments?: ChatAttachment[] }) => {
    const requestedUserId = userIdRef.current;
    const attachments = options?.attachments ?? [];
    if (!selectedConversationId || (!content.trim() && attachments.length === 0)) return;
    setError(null);
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = normalizeMessage({
      id: clientId,
      clientId,
      conversationId: selectedConversationId,
      senderId: user?.id ?? 'me',
      senderName: user?.name ?? 'You',
      senderRole: user?.role ?? Role.USER,
      sender: { id: user?.id ?? 'me', name: user?.name ?? 'You', avatarUrl: user?.avatarUrl ?? null },
      messageType: attachments.length ? (attachments.every(file => file.mimeType.startsWith('image/')) ? 'IMAGE' : 'FILE') : 'TEXT',
      content: content.trim(),
      replyToMessageId: options?.replyToMessageId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryStatus: 'sending',
      reactions: [],
      attachments,
      mentions: [],
    });
    setMessages((current) => [...current, optimistic]);
    applyConversationPreview(optimistic);
    try {
      const payloadAttachments = attachments.map(({ id, messageId, createdAt, ...attachment }) => attachment);
      const message = await chatService.sendMessage(selectedConversationId, {
        content: content.trim(),
        messageType: optimistic.messageType,
        clientId,
        replyToMessageId: options?.replyToMessageId ?? null,
        attachments: payloadAttachments,
      });
      if (requestedUserId !== userIdRef.current) return;
      const sentMessage = normalizeMessage(message, { conversationId: selectedConversationId, clientId, deliveryStatus: 'sent' });
      if (selectedConversationIdRef.current === selectedConversationId) {
        mergeMessage(sentMessage, clientId, { conversationId: selectedConversationId });
      }
      applyConversationPreview(sentMessage);
      void markReadSafely(selectedConversationId, sentMessage.id);
    } catch (err) {
      if (requestedUserId !== userIdRef.current) return;
      setMessages((current) => current.map((message) => (message.clientId === clientId ? { ...message, deliveryStatus: 'failed' } : message)));
      setError(err instanceof Error ? err.message : 'Unable to send message');
    }
  }, [applyConversationPreview, markReadSafely, mergeMessage, selectedConversationId, user?.avatarUrl, user?.id, user?.name, user?.role]);

  useEffect(() => () => {
    Object.values(pendingSendTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    pendingSendTimersRef.current = {};
  }, []);

  const retryMessage = useCallback((message: ChatMessage) => {
    void sendMessage(message.content ?? '', { replyToMessageId: message.replyToMessageId, attachments: message.attachments ?? [] });
    setMessages((current) => current.filter((item) => item.id !== message.id));
  }, [sendMessage]);

  const setTyping = useCallback((typing: boolean) => {
    if (!selectedConversationId) return;
    sendRealtime(typing ? 'typing:start' : 'typing:stop', { conversation_id: selectedConversationId });
  }, [selectedConversationId, sendRealtime]);

  const toggleReaction = useCallback((message: ChatMessage, emoji: string, currentUserId?: string) => {
    const hasReacted = (message.reactions ?? []).some((reaction) => reaction.emoji === emoji && reaction.userId === currentUserId);
    if (realtimeConnected && sendRealtime(hasReacted ? 'reaction:remove' : 'reaction:add', { message_id: message.id, emoji })) {
      return;
    }
    const action = hasReacted ? chatService.removeReaction(message.id, emoji) : chatService.addReaction(message.id, emoji);
    void action.then((updated) => mergeMessage(updated));
  }, [mergeMessage, realtimeConnected, sendRealtime]);

  const editMessage = useCallback(async (message: ChatMessage, content: string) => {
    if (!content.trim()) return;
    if (realtimeConnected && sendRealtime('message:edit', { message_id: message.id, content: content.trim() })) {
      return;
    }
    const updated = await chatService.updateMessage(message.id, content.trim());
    mergeMessage(updated);
  }, [mergeMessage, realtimeConnected, sendRealtime]);

  const deleteMessage = useCallback(async (message: ChatMessage) => {
    if (realtimeConnected && sendRealtime('message:delete', { message_id: message.id })) {
      return;
    }
    await chatService.deleteMessage(message.id);
    setMessages((current) => current.map((item) => (
      item.id === message.id ? { ...item, content: '', deletedAt: new Date().toISOString() } : item
    )));
  }, [realtimeConnected, sendRealtime]);

  const pinMessage = useCallback(async (message: ChatMessage) => {
    if (!selectedConversationId || message.deletedAt) return;
    await chatService.pinMessage(selectedConversationId, message.id);
    void loadConversations();
  }, [loadConversations, selectedConversationId]);

  const unpinMessage = useCallback(async (messageId: string) => {
    if (!selectedConversationId) return;
    await chatService.unpinMessage(selectedConversationId, messageId);
    void loadConversations();
  }, [loadConversations, selectedConversationId]);

  const toggleFavorite = useCallback(async (conversationId: string, userId: string, isPinned: boolean) => {
    await chatService.updateMember(conversationId, userId, { isPinned });
    await loadConversations();
    await loadDirectoryUsers();
  }, [loadConversations, loadDirectoryUsers]);

  const toggleMute = useCallback(async (conversationId: string, userId: string, isMuted: boolean) => {
    await chatService.updateMember(conversationId, userId, { isMuted });
    await loadConversations();
  }, [loadConversations]);

  const addMembers = useCallback(async (conversationId: string, userIds: string[]) => {
    if (userIds.length === 0) return;
    await chatService.addMembers(conversationId, userIds);
    await loadConversations();
    await loadDirectoryUsers();
  }, [loadConversations, loadDirectoryUsers]);

  const removeMember = useCallback(async (conversationId: string, userId: string) => {
    await chatService.removeMember(conversationId, userId);
    await loadConversations();
    await loadDirectoryUsers();
  }, [loadConversations, loadDirectoryUsers]);

  const startDirect = useCallback(async (userId: string) => {
    setError(null);
    try {
      const conversation = await chatService.startDirect({ userId });
      setConversations((current) => {
        const exists = current.some((item) => item.id === conversation.id);
        return exists ? current.map((item) => (item.id === conversation.id ? conversation : item)) : [conversation, ...current];
      });
      setSelectedConversationId(conversation.id);
      void loadDirectoryUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start direct message');
    }
  }, [loadDirectoryUsers]);

  const createConversation = useCallback(async (payload: Parameters<typeof chatService.createConversation>[0]) => {
    setError(null);
    try {
      const conversation = await chatService.createConversation(payload);
      setConversations((current) => [conversation, ...current]);
      setSelectedConversationId(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create conversation');
    }
  }, []);

  return {
    conversations,
    directoryUsers,
    selectedConversation,
    selectedConversationId,
    messages,
    nextCursor,
    hasMore,
    loadingConversations,
    loadingDirectory,
    loadingMessages,
    error,
    setSelectedConversationId,
    loadMoreMessages: () => selectedConversationId && nextCursor ? loadMessages(selectedConversationId, nextCursor) : undefined,
    sendMessage,
    startDirect,
    createConversation,
    retryMessage,
    setTyping,
    toggleReaction,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    toggleFavorite,
    toggleMute,
    addMembers,
    removeMember,
    uploadAttachment: chatService.uploadAttachment,
    typingUsers: selectedConversationId ? Object.values(typingByConversation[selectedConversationId] ?? {}) : [],
    presenceByUserId,
    realtimeConnected,
    reload: loadConversations,
    reloadMessages: () => selectedConversationId ? loadMessages(selectedConversationId, null, true) : undefined,
    reloadDirectory: loadDirectoryUsers,
  };
};
