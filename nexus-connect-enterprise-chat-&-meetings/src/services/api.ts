import { User, Conversation, Message, Attachment, Meeting } from '../types';

let authToken: string | null = localStorage.getItem('nexus_auth_token');

export function setApiAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('nexus_auth_token', token);
  } else {
    localStorage.removeItem('nexus_auth_token');
  }
}

export function getApiAuthToken(): string | null {
  return authToken;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  register: (data: { email: string; password: string; displayName: string; title?: string; department?: string; avatarUrl?: string }) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => request<{ user: User }>('/api/auth/me'),

  getDemoUsers: () => request<{ users: User[] }>('/api/auth/demo-users'),

  switchUser: (userId: string) =>
    request<{ token: string; user: User }>('/api/auth/switch-user', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  // Users
  getUsers: () => request<{ users: User[] }>('/api/users'),

  updateProfile: (updates: Partial<User>) =>
    request<{ user: User }>('/api/users/profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  // Conversations
  getConversations: () => request<{ conversations: Conversation[] }>('/api/conversations'),

  createConversation: (data: {
    type: 'dm' | 'group' | 'channel';
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
    avatarUrl?: string;
  }) =>
    request<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMessages: (conversationId: string, limit = 50, before?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (before) params.append('before', before);
    return request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages?${params.toString()}`);
  },

  addMember: (conversationId: string, userId: string, role: 'admin' | 'member' = 'member') =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    }),

  removeMember: (conversationId: string, userId: string) =>
    request<{ success: boolean }>(`/api/conversations/${conversationId}/members/${userId}`, {
      method: 'DELETE',
    }),

  toggleMute: (conversationId: string) =>
    request<{ isMuted: boolean }>(`/api/conversations/${conversationId}/mute`, {
      method: 'POST',
    }),

  // File Upload
  uploadFile: async (file: File): Promise<Attachment> => {
    const formData = new FormData();
    formData.append('file', file);
    return request<Attachment>('/api/upload', {
      method: 'POST',
      body: formData,
    });
  },

  // Meetings
  getActiveMeetings: () => request<{ meetings: Meeting[] }>('/api/meetings/active'),

  createMeeting: (data: { title?: string; conversationId?: string }) =>
    request<{ meeting: Meeting }>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
