import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  title: string;
  department: string;
  avatarUrl: string;
  status: 'online' | 'busy' | 'away' | 'dnd' | 'offline';
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

interface DatabaseSchema {
  users: User[];
  conversations: Conversation[];
  messages: Message[];
  meetings: Meeting[];
}

const DB_FILE = path.resolve(process.cwd(), 'data', 'database.json');

class DatabaseService {
  private data: DatabaseSchema = {
    users: [],
    conversations: [],
    messages: [],
    meetings: [],
  };

  constructor() {
    this.init();
  }

  private init() {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        // Ensure all arrays exist
        if (!this.data.users) this.data.users = [];
        if (!this.data.conversations) this.data.conversations = [];
        if (!this.data.messages) this.data.messages = [];
        if (!this.data.meetings) this.data.meetings = [];
      } else {
        this.seedInitialData();
        this.persist();
      }
    } catch (err) {
      console.error('Error initializing database, seeding defaults:', err);
      this.seedInitialData();
      this.persist();
    }
  }

  private persist() {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('Failed to write database file:', err);
    }
  }

  private seedInitialData() {
    const salt = bcrypt.genSaltSync(10);
    const defaultPasswordHash = bcrypt.hashSync('password123', salt);

    const now = new Date().toISOString();
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const u1: User = {
      id: 'usr_sarah',
      email: 'sarah.chen@nexuscorp.com',
      passwordHash: defaultPasswordHash,
      displayName: 'Sarah Chen',
      title: 'VP of Product',
      department: 'Product Management',
      avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      status: 'online',
      customStatus: 'Reviewing Q4 Architecture Roadmaps 🎯',
      createdAt: yesterday,
    };

    const u2: User = {
      id: 'usr_alex',
      email: 'alex.rivera@nexuscorp.com',
      passwordHash: defaultPasswordHash,
      displayName: 'Alex Rivera',
      title: 'Principal Software Architect',
      department: 'Engineering',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      status: 'online',
      customStatus: 'Synthesizing WebRTC peer signaling protocols ⚡',
      createdAt: yesterday,
    };

    const u3: User = {
      id: 'usr_morgan',
      email: 'morgan.vance@nexuscorp.com',
      passwordHash: defaultPasswordHash,
      displayName: 'Morgan Vance',
      title: 'Design Systems Lead',
      department: 'Product Design',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      status: 'busy',
      customStatus: 'In a Webex review session 🎨',
      createdAt: yesterday,
    };

    const u4: User = {
      id: 'usr_elena',
      email: 'elena.rostova@nexuscorp.com',
      passwordHash: defaultPasswordHash,
      displayName: 'Elena Rostova',
      title: 'Infrastructure & SRE Lead',
      department: 'Cloud Operations',
      avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
      status: 'away',
      customStatus: 'Deploying edge clusters 🌐',
      createdAt: yesterday,
    };

    this.data.users = [u1, u2, u3, u4];

    // Channels
    const cGeneral: Conversation = {
      id: 'conv_general',
      type: 'channel',
      name: 'general',
      topic: 'Company-wide announcements, team wins, and cross-functional updates',
      isPrivate: false,
      createdBy: u1.id,
      members: [
        { userId: u1.id, role: 'admin', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u3.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u4.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    const cEng: Conversation = {
      id: 'conv_engineering',
      type: 'channel',
      name: 'engineering-core',
      topic: 'Real-time sync, WebSockets, WebRTC signaling & CI/CD pipeline alerts',
      isPrivate: false,
      createdBy: u2.id,
      members: [
        { userId: u1.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'admin', joinedAt: yesterday, lastReadAt: now },
        { userId: u3.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u4.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    const cDesign: Conversation = {
      id: 'conv_design',
      type: 'channel',
      name: 'design-system',
      topic: 'Webex-style enterprise dark/light tokens, components & UX review',
      isPrivate: false,
      createdBy: u3.id,
      members: [
        { userId: u1.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u3.id, role: 'admin', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    const cPrivateSec: Conversation = {
      id: 'conv_security',
      type: 'channel',
      name: 'infosec-confidential',
      topic: 'Zero-trust policies, SOC2 compliance, audit logs',
      isPrivate: true,
      createdBy: u4.id,
      members: [
        { userId: u1.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u4.id, role: 'admin', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    const cDmSarahAlex: Conversation = {
      id: 'conv_dm_sarah_alex',
      type: 'dm',
      name: 'Alex Rivera',
      topic: 'Direct Message',
      isPrivate: true,
      createdBy: u1.id,
      members: [
        { userId: u1.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    const cGroupSquad: Conversation = {
      id: 'conv_group_squad',
      type: 'group',
      name: 'Q4 Launch Steering Committee',
      topic: 'Cross-functional deliverables & WebRTC multi-party room testing',
      isPrivate: true,
      avatarUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150&auto=format&fit=crop&q=80',
      createdBy: u1.id,
      members: [
        { userId: u1.id, role: 'admin', joinedAt: yesterday, lastReadAt: now },
        { userId: u2.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u3.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
        { userId: u4.id, role: 'member', joinedAt: yesterday, lastReadAt: now },
      ],
      createdAt: yesterday,
      updatedAt: now,
    };

    this.data.conversations = [cGeneral, cEng, cDesign, cPrivateSec, cDmSarahAlex, cGroupSquad];

    // Seed Messages
    this.data.messages = [
      {
        id: 'msg_1',
        conversationId: cGeneral.id,
        senderId: u1.id,
        content: 'Welcome everyone to the new **Nexus Connect** communication hub! 🚀 We have full real-time messaging, WebRTC audio/video meetings, threaded interactions, and verified persistence in place.',
        attachments: [],
        isPinned: true,
        isEdited: false,
        isDeleted: false,
        reactions: [
          { emoji: '🎉', userIds: [u2.id, u3.id, u4.id] },
          { emoji: '🚀', userIds: [u1.id, u2.id] }
        ],
        readBy: [u1.id, u2.id, u3.id, u4.id],
        createdAt: yesterday,
        updatedAt: yesterday,
      },
      {
        id: 'msg_2',
        conversationId: cGeneral.id,
        senderId: u2.id,
        content: 'Awesome! Real-time Socket.IO rooms are active and our WebRTC signaling channels are ready for test calls. You can test video and voice calls directly using the buttons in the conversation header.',
        attachments: [],
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        reactions: [
          { emoji: '👍', userIds: [u1.id, u3.id] }
        ],
        readBy: [u1.id, u2.id, u3.id, u4.id],
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo,
      },
      {
        id: 'msg_3',
        conversationId: cGeneral.id,
        senderId: u3.id,
        content: 'Here is the preliminary enterprise UI layout specification document. Let me know if anyone needs token adjustments.',
        attachments: [
          {
            id: 'att_1',
            name: 'Nexus_Enterprise_Design_Tokens_v2.pdf',
            url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            size: 245000,
            type: 'application/pdf',
          }
        ],
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        reactions: [
          { emoji: '❤️', userIds: [u1.id] }
        ],
        readBy: [u1.id, u2.id, u3.id],
        createdAt: tenMinAgo,
        updatedAt: tenMinAgo,
      },
      // Engineering messages
      {
        id: 'msg_eng_1',
        conversationId: cEng.id,
        senderId: u2.id,
        content: '```typescript\n// WebRTC Peer Connection Config\nconst rtcConfig = {\n  iceServers: [\n    { urls: "stun:stun.l.google.com:19302" },\n    { urls: "stun:stun1.l.google.com:19302" }\n  ]\n};\n```\nSignaling handshake is synced over Socket.IO events `call_user` and `webrtc_signal`.',
        attachments: [],
        isPinned: true,
        isEdited: false,
        isDeleted: false,
        reactions: [
          { emoji: '🔥', userIds: [u4.id, u1.id] }
        ],
        readBy: [u1.id, u2.id, u4.id],
        createdAt: yesterday,
        updatedAt: yesterday,
      },
      {
        id: 'msg_eng_2',
        conversationId: cEng.id,
        senderId: u4.id,
        content: 'Edge gateway roundtrip latency is holding under 18ms across all regions. Ready for multi-party group video test.',
        attachments: [],
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        reactions: [{ emoji: '⚡', userIds: [u2.id] }],
        readBy: [u1.id, u2.id, u4.id],
        createdAt: tenMinAgo,
        updatedAt: tenMinAgo,
      },
      // DM messages between Sarah & Alex
      {
        id: 'msg_dm_1',
        conversationId: cDmSarahAlex.id,
        senderId: u1.id,
        content: 'Hi Alex! Are we ready to demonstrate the one-on-one video call and screen share capabilities in today’s review?',
        attachments: [],
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        reactions: [],
        readBy: [u1.id, u2.id],
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo,
      },
      {
        id: 'msg_dm_2',
        conversationId: cDmSarahAlex.id,
        senderId: u2.id,
        content: 'Yes! Both audio and video streaming are wired up. Feel free to click the phone or camera icon in this chat to test the ringing and answer flow.',
        attachments: [],
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        reactions: [{ emoji: '🙌', userIds: [u1.id] }],
        readBy: [u1.id, u2.id],
        createdAt: tenMinAgo,
        updatedAt: tenMinAgo,
      }
    ];

    // Seed sample active meeting
    this.data.meetings = [
      {
        id: 'meet_sync_101',
        conversationId: cGeneral.id,
        title: 'Weekly Cross-Functional All-Hands',
        hostId: u1.id,
        activeParticipants: [],
        status: 'active',
        startedAt: now,
      }
    ];
  }

  // --- User Operations ---
  getUsers(): User[] {
    return this.data.users;
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find(u => u.id === id);
  }

  getUserByEmail(email: string): User | undefined {
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  createUser(userData: Omit<User, 'id' | 'createdAt'>): User {
    const id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const user: User = {
      ...userData,
      id,
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this.persist();
    return user;
  }

  updateUser(id: string, updates: Partial<User>): User | undefined {
    const user = this.getUserById(id);
    if (!user) return undefined;
    Object.assign(user, updates);
    this.persist();
    return user;
  }

  // --- Conversation Operations ---
  getConversationsForUser(userId: string): Conversation[] {
    return this.data.conversations.filter(c => 
      c.type === 'channel' && !c.isPrivate
        ? true
        : c.members.some(m => m.userId === userId)
    ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getConversationById(id: string): Conversation | undefined {
    return this.data.conversations.find(c => c.id === id);
  }

  createConversation(convData: {
    type: 'dm' | 'group' | 'channel';
    name: string;
    topic?: string;
    isPrivate?: boolean;
    avatarUrl?: string;
    createdBy: string;
    memberIds: string[];
  }): Conversation {
    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const members: ConversationMember[] = convData.memberIds.map(uid => ({
      userId: uid,
      role: uid === convData.createdBy ? 'admin' : 'member',
      joinedAt: now,
      lastReadAt: now,
    }));

    // Ensure creator is included
    if (!members.some(m => m.userId === convData.createdBy)) {
      members.unshift({
        userId: convData.createdBy,
        role: 'admin',
        joinedAt: now,
        lastReadAt: now,
      });
    }

    const conversation: Conversation = {
      id,
      type: convData.type,
      name: convData.name,
      topic: convData.topic || '',
      isPrivate: convData.isPrivate ?? false,
      avatarUrl: convData.avatarUrl,
      createdBy: convData.createdBy,
      members,
      createdAt: now,
      updatedAt: now,
    };

    this.data.conversations.unshift(conversation);
    this.persist();
    return conversation;
  }

  addMemberToConversation(conversationId: string, userId: string, role: 'admin' | 'member' = 'member'): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    if (!conv.members.some(m => m.userId === userId)) {
      conv.members.push({
        userId,
        role,
        joinedAt: new Date().toISOString(),
        lastReadAt: new Date().toISOString(),
      });
      conv.updatedAt = new Date().toISOString();
      this.persist();
      return true;
    }
    return false;
  }

  removeMemberFromConversation(conversationId: string, userId: string): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    const initialLen = conv.members.length;
    conv.members = conv.members.filter(m => m.userId !== userId);
    if (conv.members.length !== initialLen) {
      conv.updatedAt = new Date().toISOString();
      this.persist();
      return true;
    }
    return false;
  }

  toggleConversationMute(conversationId: string, userId: string): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    const member = conv.members.find(m => m.userId === userId);
    if (member) {
      member.isMuted = !member.isMuted;
      this.persist();
      return !!member.isMuted;
    }
    return false;
  }

  // --- Message Operations ---
  getMessages(conversationId: string, limit = 50, beforeTimestamp?: string): Message[] {
    let msgs = this.data.messages.filter(m => m.conversationId === conversationId);
    if (beforeTimestamp) {
      msgs = msgs.filter(m => new Date(m.createdAt).getTime() < new Date(beforeTimestamp).getTime());
    }
    return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  getMessageById(id: string): Message | undefined {
    return this.data.messages.find(m => m.id === id);
  }

  createMessage(msgData: {
    conversationId: string;
    senderId: string;
    content: string;
    attachments?: Attachment[];
    replyToId?: string;
  }): Message {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const msg: Message = {
      id,
      conversationId: msgData.conversationId,
      senderId: msgData.senderId,
      content: msgData.content,
      attachments: msgData.attachments || [],
      replyToId: msgData.replyToId,
      isPinned: false,
      isEdited: false,
      isDeleted: false,
      reactions: [],
      readBy: [msgData.senderId],
      createdAt: now,
      updatedAt: now,
    };

    this.data.messages.push(msg);

    // Update conversation updatedAt
    const conv = this.getConversationById(msgData.conversationId);
    if (conv) {
      conv.updatedAt = now;
      // Mark read for sender
      const member = conv.members.find(m => m.userId === msgData.senderId);
      if (member) {
        member.lastReadAt = now;
      }
    }

    this.persist();
    return msg;
  }

  updateMessage(id: string, senderId: string, newContent: string): Message | null {
    const msg = this.getMessageById(id);
    if (!msg || msg.senderId !== senderId || msg.isDeleted) return null;
    msg.content = newContent;
    msg.isEdited = true;
    msg.updatedAt = new Date().toISOString();
    this.persist();
    return msg;
  }

  deleteMessage(id: string, senderId: string): Message | null {
    const msg = this.getMessageById(id);
    if (!msg || (msg.senderId !== senderId && !this.getUserById(senderId)?.title?.includes('Admin'))) return null;
    msg.isDeleted = true;
    msg.content = 'This message was deleted';
    msg.attachments = [];
    msg.updatedAt = new Date().toISOString();
    this.persist();
    return msg;
  }

  toggleReaction(messageId: string, userId: string, emoji: string): Message | null {
    const msg = this.getMessageById(messageId);
    if (!msg || msg.isDeleted) return null;

    let reactionGroup = msg.reactions.find(r => r.emoji === emoji);
    if (!reactionGroup) {
      reactionGroup = { emoji, userIds: [] };
      msg.reactions.push(reactionGroup);
    }

    const index = reactionGroup.userIds.indexOf(userId);
    if (index > -1) {
      reactionGroup.userIds.splice(index, 1);
    } else {
      reactionGroup.userIds.push(userId);
    }

    // Clean up empty reaction groups
    msg.reactions = msg.reactions.filter(r => r.userIds.length > 0);
    this.persist();
    return msg;
  }

  togglePinMessage(messageId: string): Message | null {
    const msg = this.getMessageById(messageId);
    if (!msg || msg.isDeleted) return null;
    msg.isPinned = !msg.isPinned;
    this.persist();
    return msg;
  }

  markConversationRead(conversationId: string, userId: string): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    const now = new Date().toISOString();
    const member = conv.members.find(m => m.userId === userId);
    if (member) {
      member.lastReadAt = now;
    }
    // Also mark read on recent messages
    this.data.messages
      .filter(m => m.conversationId === conversationId && !m.readBy.includes(userId))
      .forEach(m => m.readBy.push(userId));

    this.persist();
    return true;
  }

  // --- Meetings ---
  createMeeting(title: string, hostId: string, conversationId?: string): Meeting {
    const id = `meet_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const meeting: Meeting = {
      id,
      conversationId,
      title,
      hostId,
      activeParticipants: [],
      status: 'active',
      startedAt: new Date().toISOString(),
    };
    this.data.meetings.push(meeting);
    this.persist();
    return meeting;
  }

  getMeetingById(id: string): Meeting | undefined {
    return this.data.meetings.find(m => m.id === id);
  }

  endMeeting(id: string): boolean {
    const m = this.getMeetingById(id);
    if (!m) return false;
    m.status = 'ended';
    m.endedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  getActiveMeetings(): Meeting[] {
    return this.data.meetings.filter(m => m.status === 'active');
  }
}

export const db = new DatabaseService();
