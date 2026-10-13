import { io, Socket } from 'socket.io-client';
import { UserStatus } from '../types';

class SocketService {
  private socket: Socket | null = null;
  private currentUserId: string | null = null;

  connect(userId: string) {
    if (this.socket && this.socket.connected && this.currentUserId === userId) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.currentUserId = userId;
    const serverUrl = window.location.origin;

    this.socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this.socket?.emit('auth:init', { userId });
    });

    return this.socket;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentUserId = null;
  }

  // Conversation events
  joinConversation(conversationId: string) {
    this.socket?.emit('conversation:join', conversationId);
  }

  leaveConversation(conversationId: string) {
    this.socket?.emit('conversation:leave', conversationId);
  }

  sendMessage(payload: {
    conversationId: string;
    content: string;
    attachments?: any[];
    replyToId?: string;
  }) {
    this.socket?.emit('message:send', payload);
  }

  editMessage(messageId: string, newContent: string) {
    this.socket?.emit('message:edit', { messageId, newContent });
  }

  deleteMessage(messageId: string) {
    this.socket?.emit('message:delete', { messageId });
  }

  reactMessage(messageId: string, emoji: string) {
    this.socket?.emit('message:reaction', { messageId, emoji });
  }

  pinMessage(messageId: string) {
    this.socket?.emit('message:pin', { messageId });
  }

  startTyping(conversationId: string) {
    this.socket?.emit('typing:start', { conversationId });
  }

  stopTyping(conversationId: string) {
    this.socket?.emit('typing:stop', { conversationId });
  }

  markRead(conversationId: string) {
    this.socket?.emit('message:read', { conversationId });
  }

  setPresence(status: UserStatus, customStatus?: string) {
    this.socket?.emit('presence:set', { status, customStatus });
  }

  // 1-on-1 Call Signaling
  initiateCall(payload: {
    recipientId: string;
    callType: 'audio' | 'video';
    conversationId: string;
    signalData: any;
  }) {
    this.socket?.emit('call:initiate', payload);
  }

  answerCall(payload: {
    callerId: string;
    signalData: any;
  }) {
    this.socket?.emit('call:answer', payload);
  }

  sendCandidate(targetUserId: string, candidate: any) {
    this.socket?.emit('call:candidate', { targetUserId, candidate });
  }

  rejectCall(callerId: string, reason?: string) {
    this.socket?.emit('call:reject', { callerId, reason });
  }

  endCall(targetUserId: string) {
    this.socket?.emit('call:end', { targetUserId });
  }

  // Group Meeting signaling
  joinMeeting(payload: {
    meetingId: string;
    userInfo: {
      userId: string;
      displayName: string;
      avatarUrl?: string;
      audioEnabled: boolean;
      videoEnabled: boolean;
    };
  }) {
    this.socket?.emit('meeting:join', payload);
  }

  sendMeetingSignal(payload: {
    toSocketId: string;
    signalData: any;
    fromUserInfo: any;
  }) {
    this.socket?.emit('meeting:signal', payload);
  }

  sendMeetingMediaState(payload: {
    meetingId: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
    screenSharing: boolean;
  }) {
    this.socket?.emit('meeting:media_state', payload);
  }

  leaveMeeting(meetingId: string) {
    this.socket?.emit('meeting:leave', { meetingId });
  }
}

export const socketService = new SocketService();
