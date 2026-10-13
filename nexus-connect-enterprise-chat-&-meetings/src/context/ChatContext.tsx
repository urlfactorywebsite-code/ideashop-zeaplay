import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Conversation, Message, Attachment, User } from '../types';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from './AuthContext';

interface ChatContextType {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  messages: Message[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  typingUsers: { [userId: string]: string };
  onlineUserIds: string[];
  filterTab: 'all' | 'dms' | 'channels' | 'groups' | 'meetings';
  searchQuery: string;
  isRightSidebarOpen: boolean;
  isSearchInChatOpen: boolean;
  searchInChatTerm: string;
  replyingToMessage: Message | null;
  editingMessage: Message | null;
  
  // Actions
  selectConversation: (id: string) => void;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => void;
  deleteMessage: (messageId: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  togglePin: (messageId: string) => void;
  startTyping: () => void;
  stopTyping: () => void;
  createConversation: (data: {
    type: 'dm' | 'group' | 'channel';
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
    avatarUrl?: string;
  }) => Promise<Conversation>;
  addMember: (userId: string, role?: 'admin' | 'member') => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  toggleMute: (conversationId?: string) => Promise<void>;
  setFilterTab: (tab: 'all' | 'dms' | 'channels' | 'groups' | 'meetings') => void;
  setSearchQuery: (query: string) => void;
  toggleRightSidebar: () => void;
  setIsRightSidebarOpen: (open: boolean) => void;
  setIsSearchInChatOpen: (open: boolean) => void;
  setSearchInChatTerm: (term: string) => void;
  setReplyingToMessage: (msg: Message | null) => void;
  setEditingMessage: (msg: Message | null) => void;
  refreshConversations: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [typingUsers, setTypingUsers] = useState<{ [userId: string]: string }>({});
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [filterTab, setFilterTab] = useState<'all' | 'dms' | 'channels' | 'groups' | 'meetings'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState<boolean>(false);
  const [isSearchInChatOpen, setIsSearchInChatOpen] = useState<boolean>(false);
  const [searchInChatTerm, setSearchInChatTerm] = useState<string>('');
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConversationId;

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refreshConversations = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.getConversations();
      setConversations(res.conversations);
      // Select first conversation if none selected
      if (!activeConvIdRef.current && res.conversations.length > 0) {
        selectConversation(res.conversations[0].id);
      }
    } catch (err) {
      console.error('Failed to load conversations', err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await api.getMessages(conversationId);
      setMessages(res.messages);
      socketService.markRead(conversationId);
      // Decrement unread count locally
      setConversations(prev =>
        prev.map(c => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
    } catch (err) {
      console.error('Failed to load messages', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const selectConversation = useCallback((id: string) => {
    if (activeConvIdRef.current) {
      socketService.leaveConversation(activeConvIdRef.current);
    }
    setActiveConversationId(id);
    setReplyingToMessage(null);
    setEditingMessage(null);
    setTypingUsers({});
    socketService.joinConversation(id);
    loadMessages(id);
  }, [loadMessages]);

  // Load conversations when user authenticates
  useEffect(() => {
    if (user) {
      refreshConversations();
    } else {
      setConversations([]);
      setMessages([]);
      setActiveConversationId(null);
    }
  }, [user, refreshConversations]);

  // Attach Socket.IO listeners
  useEffect(() => {
    const socket = socketService.getSocket();
    if (!socket) return;

    const handleAuthReady = (data: { onlineUserIds: string[] }) => {
      setOnlineUserIds(data.onlineUserIds || []);
    };

    const handlePresenceSync = (data: { userId: string; status: string; onlineUserIds?: string[] }) => {
      if (data.onlineUserIds) {
        setOnlineUserIds(data.onlineUserIds);
      }
    };

    const handleNewMessage = (data: { message: Message; conversationId: string }) => {
      if (data.conversationId === activeConvIdRef.current) {
        setMessages(prev => {
          // Idempotency check
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        socketService.markRead(data.conversationId);
      }

      // Update conversations list with latest message
      setConversations(prev =>
        prev.map(c => {
          if (c.id === data.conversationId) {
            const isCurrent = c.id === activeConvIdRef.current;
            return {
              ...c,
              lastMessage: data.message,
              updatedAt: data.message.createdAt,
              unreadCount: isCurrent ? 0 : (c.unreadCount || 0) + 1,
            };
          }
          return c;
        }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
    };

    const handleMessageEdited = (edited: Message) => {
      setMessages(prev => prev.map(m => (m.id === edited.id ? edited : m)));
      setConversations(prev =>
        prev.map(c => (c.lastMessage?.id === edited.id ? { ...c, lastMessage: edited } : c))
      );
    };

    const handleMessageDeleted = (deleted: Message) => {
      setMessages(prev => prev.map(m => (m.id === deleted.id ? deleted : m)));
    };

    const handleReactionUpdated = (data: { messageId: string; reactions: any[] }) => {
      setMessages(prev =>
        prev.map(m => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m))
      );
    };

    const handlePinUpdated = (data: { messageId: string; isPinned: boolean }) => {
      setMessages(prev =>
        prev.map(m => (m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m))
      );
    };

    const handleTypingStatus = (data: {
      conversationId: string;
      userId: string;
      userName?: string;
      isTyping: boolean;
    }) => {
      if (data.conversationId !== activeConvIdRef.current) return;
      if (data.userId === user?.id) return;

      setTypingUsers(prev => {
        const next = { ...prev };
        if (data.isTyping) {
          next[data.userId] = data.userName || 'Someone';
        } else {
          delete next[data.userId];
        }
        return next;
      });
    };

    socket.on('auth:ready', handleAuthReady);
    socket.on('presence:sync', handlePresenceSync);
    socket.on('message:new', handleNewMessage);
    socket.on('message:edited', handleMessageEdited);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('message:reaction_updated', handleReactionUpdated);
    socket.on('message:pin_updated', handlePinUpdated);
    socket.on('typing:status', handleTypingStatus);

    return () => {
      socket.off('auth:ready', handleAuthReady);
      socket.off('presence:sync', handlePresenceSync);
      socket.off('message:new', handleNewMessage);
      socket.off('message:edited', handleMessageEdited);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('message:reaction_updated', handleReactionUpdated);
      socket.off('message:pin_updated', handlePinUpdated);
      socket.off('typing:status', handleTypingStatus);
    };
  }, [user]);

  const sendMessage = async (content: string, attachments?: Attachment[]) => {
    if (!activeConversationId || !user) return;
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    socketService.sendMessage({
      conversationId: activeConversationId,
      content,
      attachments,
      replyToId: replyingToMessage ? replyingToMessage.id : undefined,
    });

    setReplyingToMessage(null);
    stopTyping();
  };

  const editMessage = (messageId: string, newContent: string) => {
    socketService.editMessage(messageId, newContent);
    setEditingMessage(null);
  };

  const deleteMessage = (messageId: string) => {
    socketService.deleteMessage(messageId);
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    socketService.reactMessage(messageId, emoji);
  };

  const togglePin = (messageId: string) => {
    socketService.pinMessage(messageId);
  };

  const startTyping = () => {
    if (!activeConversationId) return;
    socketService.startTyping(activeConversationId);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  const stopTyping = () => {
    if (!activeConversationId) return;
    socketService.stopTyping(activeConversationId);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const createConversation = async (data: {
    type: 'dm' | 'group' | 'channel';
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
    avatarUrl?: string;
  }) => {
    const res = await api.createConversation(data);
    await refreshConversations();
    selectConversation(res.conversation.id);
    return res.conversation;
  };

  const addMember = async (userId: string, role?: 'admin' | 'member') => {
    if (!activeConversationId) return;
    await api.addMember(activeConversationId, userId, role);
    await refreshConversations();
  };

  const removeMember = async (userId: string) => {
    if (!activeConversationId) return;
    await api.removeMember(activeConversationId, userId);
    await refreshConversations();
  };

  const toggleMute = async (conversationId?: string) => {
    const id = conversationId || activeConversationId;
    if (!id || !user) return;
    const res = await api.toggleMute(id);
    setConversations(prev =>
      prev.map(c => {
        if (c.id === id) {
          const members = c.members.map(m =>
            m.userId === user.id ? { ...m, isMuted: res.isMuted } : m
          );
          return { ...c, members };
        }
        return c;
      })
    );
  };

  const toggleRightSidebar = () => {
    setIsRightSidebarOpen(prev => !prev);
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeConversationId,
        activeConversation,
        messages,
        isLoadingConversations,
        isLoadingMessages,
        typingUsers,
        onlineUserIds,
        filterTab,
        searchQuery,
        isRightSidebarOpen,
        isSearchInChatOpen,
        searchInChatTerm,
        replyingToMessage,
        editingMessage,
        selectConversation,
        sendMessage,
        editMessage,
        deleteMessage,
        toggleReaction,
        togglePin,
        startTyping,
        stopTyping,
        createConversation,
        addMember,
        removeMember,
        toggleMute,
        setFilterTab,
        setSearchQuery,
        toggleRightSidebar,
        setIsRightSidebarOpen,
        setIsSearchInChatOpen,
        setSearchInChatTerm,
        setReplyingToMessage,
        setEditingMessage,
        refreshConversations,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
