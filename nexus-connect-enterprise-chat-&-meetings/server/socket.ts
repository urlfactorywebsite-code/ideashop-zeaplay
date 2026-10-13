import { Server as SocketIOServer, Socket } from 'socket.io';
import { db, User } from './db.js';

interface UserSocketMap {
  [userId: string]: Set<string>;
}

export function setupSocketIO(io: SocketIOServer) {
  const userSockets: UserSocketMap = {};
  const socketToUser = new Map<string, string>();

  io.on('connection', (socket: Socket) => {
    let currentUserId: string | null = null;

    // Client authenticates with userId
    socket.on('auth:init', (data: { userId: string }) => {
      const { userId } = data;
      if (!userId) return;

      currentUserId = userId;
      socketToUser.set(socket.id, userId);

      if (!userSockets[userId]) {
        userSockets[userId] = new Set();
      }
      userSockets[userId].add(socket.id);

      // Update user status to online in DB
      const user = db.getUserById(userId);
      if (user && user.status === 'offline') {
        db.updateUser(userId, { status: 'online' });
      }

      // Broadcast presence update
      io.emit('presence:sync', {
        userId,
        status: user ? user.status : 'online',
        customStatus: user?.customStatus,
        onlineUserIds: Object.keys(userSockets),
      });

      // Join personal room for direct notifications & call invites
      socket.join(`user:${userId}`);

      socket.emit('auth:ready', {
        userId,
        onlineUserIds: Object.keys(userSockets),
      });
    });

    // Join conversation room
    socket.on('conversation:join', (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on('conversation:leave', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Send Message
    socket.on('message:send', (payload: {
      conversationId: string;
      content: string;
      attachments?: any[];
      replyToId?: string;
    }) => {
      const senderId = currentUserId || socketToUser.get(socket.id);
      if (!senderId) return;

      const message = db.createMessage({
        conversationId: payload.conversationId,
        senderId,
        content: payload.content,
        attachments: payload.attachments,
        replyToId: payload.replyToId,
      });

      const conversation = db.getConversationById(payload.conversationId);
      const sender = db.getUserById(senderId);

      // Broadcast message to everyone in the conversation
      io.to(`conv:${payload.conversationId}`).emit('message:new', {
        message,
        conversationId: payload.conversationId,
        sender,
      });

      // Notify members who may not have the conversation active
      if (conversation) {
        conversation.members.forEach(member => {
          if (member.userId !== senderId) {
            io.to(`user:${member.userId}`).emit('notification:new_message', {
              conversationId: payload.conversationId,
              conversationName: conversation.name,
              message,
              senderName: sender?.displayName || 'Colleague',
            });
          }
        });
      }
    });

    // Edit message
    socket.on('message:edit', (payload: { messageId: string; newContent: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;

      const updated = db.updateMessage(payload.messageId, userId, payload.newContent);
      if (updated) {
        io.to(`conv:${updated.conversationId}`).emit('message:edited', updated);
      }
    });

    // Delete message
    socket.on('message:delete', (payload: { messageId: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;

      const deleted = db.deleteMessage(payload.messageId, userId);
      if (deleted) {
        io.to(`conv:${deleted.conversationId}`).emit('message:deleted', deleted);
      }
    });

    // Reactions
    socket.on('message:reaction', (payload: { messageId: string; emoji: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;

      const updated = db.toggleReaction(payload.messageId, userId, payload.emoji);
      if (updated) {
        io.to(`conv:${updated.conversationId}`).emit('message:reaction_updated', {
          messageId: updated.id,
          reactions: updated.reactions,
        });
      }
    });

    // Pin message
    socket.on('message:pin', (payload: { messageId: string }) => {
      const updated = db.togglePinMessage(payload.messageId);
      if (updated) {
        io.to(`conv:${updated.conversationId}`).emit('message:pin_updated', {
          messageId: updated.id,
          isPinned: updated.isPinned,
        });
      }
    });

    // Typing indicators
    socket.on('typing:start', (payload: { conversationId: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;
      const user = db.getUserById(userId);
      socket.to(`conv:${payload.conversationId}`).emit('typing:status', {
        conversationId: payload.conversationId,
        userId,
        userName: user?.displayName || 'Someone',
        isTyping: true,
      });
    });

    socket.on('typing:stop', (payload: { conversationId: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;
      socket.to(`conv:${payload.conversationId}`).emit('typing:status', {
        conversationId: payload.conversationId,
        userId,
        isTyping: false,
      });
    });

    // Read Receipt
    socket.on('message:read', (payload: { conversationId: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;

      db.markConversationRead(payload.conversationId, userId);
      socket.to(`conv:${payload.conversationId}`).emit('conversation:read_receipt', {
        conversationId: payload.conversationId,
        userId,
        readAt: new Date().toISOString(),
      });
    });

    // User Presence change
    socket.on('presence:set', (payload: { status: User['status']; customStatus?: string }) => {
      const userId = currentUserId || socketToUser.get(socket.id);
      if (!userId) return;

      const updated = db.updateUser(userId, {
        status: payload.status,
        customStatus: payload.customStatus,
      });

      if (updated) {
        io.emit('presence:sync', {
          userId,
          status: updated.status,
          customStatus: updated.customStatus,
          onlineUserIds: Object.keys(userSockets),
        });
      }
    });

    // --- WebRTC 1-on-1 Calling Signaling ---
    socket.on('call:initiate', (payload: {
      recipientId: string;
      callType: 'audio' | 'video';
      conversationId: string;
      signalData: any; // SDP offer
    }) => {
      const callerId = currentUserId || socketToUser.get(socket.id);
      if (!callerId) return;

      const caller = db.getUserById(callerId);
      io.to(`user:${payload.recipientId}`).emit('call:incoming', {
        callerId,
        callerName: caller?.displayName || 'Colleague',
        callerAvatar: caller?.avatarUrl,
        callerTitle: caller?.title,
        callType: payload.callType,
        conversationId: payload.conversationId,
        signalData: payload.signalData,
      });
    });

    socket.on('call:answer', (payload: {
      callerId: string;
      signalData: any; // SDP answer
    }) => {
      const responderId = currentUserId || socketToUser.get(socket.id);
      if (!responderId) return;

      io.to(`user:${payload.callerId}`).emit('call:answered', {
        responderId,
        signalData: payload.signalData,
      });
    });

    socket.on('call:candidate', (payload: {
      targetUserId: string;
      candidate: any;
    }) => {
      io.to(`user:${payload.targetUserId}`).emit('call:candidate', {
        candidate: payload.candidate,
        fromUserId: currentUserId || socketToUser.get(socket.id),
      });
    });

    socket.on('call:reject', (payload: { callerId: string; reason?: string }) => {
      io.to(`user:${payload.callerId}`).emit('call:rejected', {
        reason: payload.reason || 'declined',
      });
    });

    socket.on('call:end', (payload: { targetUserId: string }) => {
      io.to(`user:${payload.targetUserId}`).emit('call:ended', {
        fromUserId: currentUserId || socketToUser.get(socket.id),
      });
    });

    // --- Group Meeting Room Signaling ---
    socket.on('meeting:join', (payload: {
      meetingId: string;
      userInfo: {
        userId: string;
        displayName: string;
        avatarUrl?: string;
        audioEnabled: boolean;
        videoEnabled: boolean;
      };
    }) => {
      const roomKey = `meeting:${payload.meetingId}`;
      socket.join(roomKey);

      // Notify others in meeting room
      socket.to(roomKey).emit('meeting:peer_joined', {
        socketId: socket.id,
        userInfo: payload.userInfo,
      });

      // Get sockets already in this room
      const room = io.sockets.adapter.rooms.get(roomKey);
      const peers: string[] = [];
      if (room) {
        room.forEach(sId => {
          if (sId !== socket.id) {
            peers.push(sId);
          }
        });
      }

      socket.emit('meeting:existing_peers', { peers });
    });

    socket.on('meeting:signal', (payload: {
      toSocketId: string;
      signalData: any;
      fromUserInfo: any;
    }) => {
      io.to(payload.toSocketId).emit('meeting:signal', {
        fromSocketId: socket.id,
        signalData: payload.signalData,
        fromUserInfo: payload.fromUserInfo,
      });
    });

    socket.on('meeting:media_state', (payload: {
      meetingId: string;
      audioEnabled: boolean;
      videoEnabled: boolean;
      screenSharing: boolean;
    }) => {
      socket.to(`meeting:${payload.meetingId}`).emit('meeting:peer_media_state', {
        socketId: socket.id,
        audioEnabled: payload.audioEnabled,
        videoEnabled: payload.videoEnabled,
        screenSharing: payload.screenSharing,
      });
    });

    socket.on('meeting:leave', (payload: { meetingId: string }) => {
      const roomKey = `meeting:${payload.meetingId}`;
      socket.leave(roomKey);
      socket.to(roomKey).emit('meeting:peer_left', { socketId: socket.id });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      const userId = socketToUser.get(socket.id);
      socketToUser.delete(socket.id);

      if (userId && userSockets[userId]) {
        userSockets[userId].delete(socket.id);
        if (userSockets[userId].size === 0) {
          delete userSockets[userId];

          // Set user status to offline
          db.updateUser(userId, { status: 'offline' });

          io.emit('presence:sync', {
            userId,
            status: 'offline',
            onlineUserIds: Object.keys(userSockets),
          });
        }
      }
    });
  });
}
