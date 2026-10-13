export type UserStatus = 'online' | 'busy' | 'away' | 'dnd' | 'offline';

export interface User {
  id: string;
  email: string;
  displayName: string;
  title: string;
  department: string;
  avatarUrl: string;
  status: UserStatus;
  customStatus?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachments: Attachment[];
  replyToId?: string;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  reactions: Reaction[];
  readBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMember {
  userId: string;
  role: 'admin' | 'member';
  joinedAt: string;
  lastReadAt: string;
  isMuted?: boolean;
  user?: {
    id: string;
    displayName: string;
    avatarUrl: string;
    status: UserStatus;
    title: string;
    customStatus?: string;
  } | null;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group' | 'channel';
  name: string;
  topic?: string;
  isPrivate?: boolean;
  avatarUrl?: string;
  createdBy: string;
  members: ConversationMember[];
  lastMessage?: Message | null;
  unreadCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  conversationId?: string;
  title: string;
  hostId: string;
  activeParticipants: {
    userId: string;
    socketId: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
  }[];
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
}

export type CallType = 'audio' | 'video';
export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connected' | 'ended';

export interface ActiveCall {
  state: CallState;
  callType: CallType;
  remoteUserId: string;
  remoteUserName: string;
  remoteUserAvatar?: string;
  remoteUserTitle?: string;
  conversationId?: string;
  isInitiator: boolean;
  startedAt?: number;
}
