import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { db, User } from './server/db.js';
import { setupSocketIO } from './server/socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-connect-enterprise-secret-key-2026';

const app = express();
const server = http.createServer(app);

// Setup Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
setupSocketIO(io);

// Uploads setup
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}-${safeName}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));

// JWT Authentication Helper
function generateToken(user: User): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing token' });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = db.getUserById(decoded.userId);
    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    (req as any).user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- REST API ROUTES ---

// 1. Auth routes
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, displayName, title, department, avatarUrl } = req.body;
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const newUser = db.createUser({
    email,
    passwordHash,
    displayName,
    title: title || 'Team Member',
    department: department || 'General',
    avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`,
    status: 'online',
    customStatus: '',
  });

  // Automatically add user to public general and engineering channels
  const general = db.getConversationById('conv_general');
  if (general) db.addMemberToConversation(general.id, newUser.id);
  const eng = db.getConversationById('conv_engineering');
  if (eng) db.addMemberToConversation(eng.id, newUser.id);

  const token = generateToken(newUser);
  const { passwordHash: _, ...safeUser } = newUser;
  return res.json({ token, user: safeUser });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  const { passwordHash: _, ...safeUser } = user;
  return res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const { passwordHash: _, ...safeUser } = user;
  return res.json({ user: safeUser });
});

// Quick switch demo users for fast testing across personas
app.get('/api/auth/demo-users', (_req: Request, res: Response) => {
  const users = db.getUsers().map(({ passwordHash, ...u }) => u);
  return res.json({ users });
});

app.post('/api/auth/switch-user', (req: Request, res: Response) => {
  const { userId } = req.body;
  const user = db.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const token = generateToken(user);
  const { passwordHash: _, ...safeUser } = user;
  return res.json({ token, user: safeUser });
});

// 2. User routes
app.get('/api/users', authMiddleware, (_req: Request, res: Response) => {
  const users = db.getUsers().map(({ passwordHash, ...u }) => u);
  return res.json({ users });
});

app.put('/api/users/profile', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const { displayName, title, department, avatarUrl, customStatus, status } = req.body;

  const updated = db.updateUser(user.id, {
    ...(displayName ? { displayName } : {}),
    ...(title ? { title } : {}),
    ...(department ? { department } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(customStatus !== undefined ? { customStatus } : {}),
    ...(status ? { status } : {}),
  });

  if (!updated) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { passwordHash: _, ...safeUser } = updated;
  return res.json({ user: safeUser });
});

// 3. Conversation routes
app.get('/api/conversations', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const conversations = db.getConversationsForUser(user.id);

  // Augment conversations with latest message, unread count, member details
  const augmented = conversations.map(c => {
    const messages = db.getMessages(c.id);
    const lastMessage = messages[messages.length - 1] || null;
    const memberEntry = c.members.find(m => m.userId === user.id);
    const lastReadAt = memberEntry ? new Date(memberEntry.lastReadAt).getTime() : 0;
    
    // Count unread
    const unreadCount = messages.filter(
      m => m.senderId !== user.id && new Date(m.createdAt).getTime() > lastReadAt
    ).length;

    // Detailed member objects
    const populatedMembers = c.members.map(m => {
      const u = db.getUserById(m.userId);
      return {
        ...m,
        user: u ? {
          id: u.id,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          status: u.status,
          title: u.title,
          customStatus: u.customStatus,
        } : null,
      };
    });

    return {
      ...c,
      lastMessage,
      unreadCount,
      members: populatedMembers,
    };
  });

  return res.json({ conversations: augmented });
});

app.post('/api/conversations', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const { type, name, topic, isPrivate, memberIds, avatarUrl } = req.body;

  if (!type || !['dm', 'group', 'channel'].includes(type)) {
    return res.status(400).json({ error: 'Invalid conversation type' });
  }

  // If DM, check if one already exists between these 2 users
  if (type === 'dm' && memberIds && memberIds.length > 0) {
    const targetUserId = memberIds[0];
    const existing = db.getConversationsForUser(user.id).find(
      c => c.type === 'dm' && c.members.some(m => m.userId === targetUserId)
    );
    if (existing) {
      return res.json({ conversation: existing });
    }
  }

  const conversation = db.createConversation({
    type,
    name: name || 'New Chat',
    topic,
    isPrivate: Boolean(isPrivate),
    avatarUrl,
    createdBy: user.id,
    memberIds: memberIds || [],
  });

  return res.json({ conversation });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req: Request, res: Response) => {
  const { id } = req.params;
  const { limit, before } = req.query;

  const messages = db.getMessages(
    id,
    limit ? parseInt(limit as string, 10) : 50,
    before as string | undefined
  );

  return res.json({ messages });
});

app.post('/api/conversations/:id/members', authMiddleware, (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId, role } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const success = db.addMemberToConversation(id, userId, role || 'member');
  if (!success) {
    return res.status(400).json({ error: 'Could not add member or user already present' });
  }

  const conv = db.getConversationById(id);
  return res.json({ conversation: conv });
});

app.delete('/api/conversations/:id/members/:userId', authMiddleware, (req: Request, res: Response) => {
  const { id, userId } = req.params;
  const success = db.removeMemberFromConversation(id, userId);
  return res.json({ success });
});

app.post('/api/conversations/:id/mute', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const { id } = req.params;
  const isMuted = db.toggleConversationMute(id, user.id);
  return res.json({ isMuted });
});

// 4. File Upload endpoint
app.post('/api/upload', authMiddleware, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  return res.json({
    id: `att_${Date.now()}`,
    name: req.file.originalname,
    url: fileUrl,
    size: req.file.size,
    type: req.file.mimetype,
  });
});

// 5. Meetings
app.get('/api/meetings/active', authMiddleware, (_req: Request, res: Response) => {
  const meetings = db.getActiveMeetings();
  return res.json({ meetings });
});

app.post('/api/meetings', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const { title, conversationId } = req.body;
  const meeting = db.createMeeting(
    title || `${user.displayName}'s Meeting Room`,
    user.id,
    conversationId
  );
  return res.json({ meeting });
});

// Attach Vite middleware for dev or serve static files for prod
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Chat & Meetings server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
