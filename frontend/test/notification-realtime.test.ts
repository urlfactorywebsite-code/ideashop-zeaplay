import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationEventParser, startNotificationStream } from '../services/notificationRealtime';
import { notificationDestination } from '../utils/notificationNavigation';
import { NotificationEntityType, NotificationType, type Notification } from '../types';
import { storeRefreshedTokens, AUTH_TOKEN_REFRESHED_EVENT } from '../services/tokenStorage';
import { taskPermissions } from '../utils/taskPermissions';
import { Role, type Task, type User } from '../types';

test('server capabilities override global role for parent editing and subtask management/review', () => {
  const admin = { id: 'admin', role: Role.ADMIN } as User;
  const member = { id: 'member', role: Role.USER } as User;
  const task = { createdBy: 'someone-else', assignedTo: ['member'], projectId: 'project',
    canEdit: false, canManageSubtasks: false, canReviewSubtasks: false } as Task;
  assert.deepEqual(taskPermissions(task, admin), { canEdit: false, canManageSubtasks: false, canReviewSubtasks: false });
  assert.deepEqual(taskPermissions({ ...task, canEdit: true, canManageSubtasks: true, canReviewSubtasks: true }, member),
    { canEdit: true, canManageSubtasks: true, canReviewSubtasks: true });
  assert.deepEqual(taskPermissions({ ...task, canManageSubtasks: true }, member),
    { canEdit: false, canManageSubtasks: true, canReviewSubtasks: false });
  assert.equal(taskPermissions({ assignedTo: ['member'] } as Task, member).canEdit, true);
  assert.equal(taskPermissions({ createdBy: 'member' } as Task, member).canManageSubtasks, true);
});

test('notification stream handles fragmented UTF-8 frames, CRLF, comments and multiple events without duplicates', () => {
  let changes = 0;
  const parse = createNotificationEventParser(() => changes++);
  parse(': keepalive\n\n');
  parse('event: notifications.cha');
  parse('nged\r\ndata: {"type":"notifications.changed"}\r');
  assert.equal(changes, 0);
  parse('\n\r\n');
  assert.equal(changes, 1);
  parse('data: {"type":"notifications.changed"}\n\ndata: broken\n\nevent: another\ndata: {}\n\n');
  assert.equal(changes, 2);
  parse('event: notifications.changed\ndata: {}\n\nevent: notifications.changed\ndata: {}\n\n');
  assert.equal(changes, 4);
});

test('notification stream authenticates in headers and aborts delivery on stop', async () => {
  const originalFetch = globalThis.fetch;
  let fetchOptions: RequestInit | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let changes = 0;
  let cancelled = false;
  globalThis.fetch = async (_url, options) => {
    fetchOptions = options;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      cancel() { cancelled = true; },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  };
  const stop = startNotificationStream({ url: '/api/notifications/stream', getToken: () => 'synthetic-token',
    isCurrentSession: () => true, onChange: () => changes++ });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((fetchOptions?.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    streamController!.enqueue(new TextEncoder().encode('event: notifications.changed\ndata: {}\n\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(changes, 1);
    stop();
    assert.equal(fetchOptions?.signal?.aborted, true);
    streamController!.enqueue(new TextEncoder().encode('event: notifications.changed\ndata: {}\n\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(changes, 1);
    assert.equal(cancelled, true);
  } finally {
    stop();
    globalThis.fetch = originalFetch;
  }
});

test('notification stream ignores events from a session that changed during streaming', async () => {
  const originalFetch = globalThis.fetch;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let current = true;
  let changes = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(stream) { controller = stream; },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  const stop = startNotificationStream({ url: '/api/notifications/stream', getToken: () => 'synthetic-token',
    isCurrentSession: () => current, onChange: () => changes++ });
  try {
    await new Promise(resolve => setImmediate(resolve));
    current = false;
    controller!.enqueue(new TextEncoder().encode('data: {"type":"notifications.changed"}\n\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(changes, 0);
  } finally { stop(); globalThis.fetch = originalFetch; }
});

const notification = (values: Partial<Notification>): Notification => ({
  id: 'notification-1', userId: 'user-1', type: NotificationType.TASK_UPDATED, message: 'Updated',
  isRead: false, relatedTaskId: null, relatedRewardId: null, createdAt: '2026-10-20T00:00:00Z', ...values,
});
test('notification navigation focuses a subtask, canonicalizes old ticket links and rejects external links', () => {
  assert.equal(notificationDestination(notification({ relatedTaskId: 'task-1',
    entityType: NotificationEntityType.SUBTASK, entityId: 'child-2' }), 'https://example.com'),
  '/tasks?taskId=task-1&subtaskId=child-2');
  assert.equal(notificationDestination(notification({ deepLink: '/tickets/ticket-1' }), 'https://example.com'), '/tickets?ticketId=ticket-1');
  assert.equal(notificationDestination(notification({ deepLink: '/projects?projectId=p1' }), 'https://example.com'), '/projects?projectId=p1');
  assert.equal(notificationDestination(notification({ deepLink: '/projects/p1' }), 'https://example.com'), '/projects?projectId=p1');
  assert.equal(notificationDestination(notification({ deepLink: '/clients/c1' }), 'https://example.com'), '/clients?clientId=c1');
  assert.equal(notificationDestination(notification({ deepLink: '/#/projects?projectId=p1' }), 'https://example.com'), '/projects?projectId=p1');
  for (const deepLink of ['https://other.example/tasks', '//other.example/path', '/#//other.example/path', 'javascript:alert(1)', 'https://name:password@example.com/tasks']) {
    assert.equal(notificationDestination(notification({ deepLink }), 'https://example.com'), null);
  }
});

test('deleted entity notifications open lists and chat bridges retain their conversation target', () => {
  assert.equal(notificationDestination(notification({ type: NotificationType.TASK_DELETED,
    relatedTaskId: 'deleted-task', deepLink: '/tasks/deleted-task' }), 'https://example.com'), '/tasks');
  assert.equal(notificationDestination(notification({ type: NotificationType.TICKET_DELETED,
    relatedTaskId: 'linked-task', deepLink: '/tickets/deleted-ticket' }), 'https://example.com'), '/tickets');
  assert.equal(notificationDestination(notification({ type: NotificationType.CHAT_MESSAGE,
    relatedTaskId: 'task-1', relatedChatId: 'conversation-1', deepLink: '/tasks/task-1' }), 'https://example.com'), '/chat/conversation-1');
  assert.equal(notificationDestination(notification({ type: NotificationType.SUBTASK_ACTIVATED,
    relatedTaskId: 'task-1', relatedChatId: 'conversation-1', entityType: NotificationEntityType.SUBTASK,
    entityId: 'child-2' }), 'https://example.com'), '/tasks?taskId=task-1&subtaskId=child-2');
});

test('legacy user and department links open administration while own-user settings remain intact', () => {
  for (const deepLink of ['/users', '/users/user-2', '/departments', '/departments/department-1', '/#/users/user-2']) {
    assert.equal(notificationDestination(notification({ type: NotificationType.USER_UPDATED,
      entityType: NotificationEntityType.USER, deepLink }), 'https://example.com'), '/admin/users');
  }
  for (const deepLink of ['/settings', '/#/settings']) {
    assert.equal(notificationDestination(notification({ type: NotificationType.USER_UPDATED,
      entityType: NotificationEntityType.USER, entityId: 'user-1', deepLink }), 'https://example.com'), '/settings');
  }
});

test('token refresh preserves current session and cannot overwrite an account switch', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['vee_access_token', 'old'], ['vee_refresh_token', 'refresh-old']]);
  const target = new EventTarget();
  let rotations = 0;
  target.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, () => rotations++);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    assert.equal(storeRefreshedTokens('old', 'refresh-old', 'new', 'refresh-new'), true);
    assert.equal(rotations, 1);
    assert.equal(storeRefreshedTokens('old', 'refresh-old', 'late', 'refresh-late'), false);
    assert.equal(values.get('vee_access_token'), 'new');
    assert.equal(rotations, 1);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as any).window;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as any).localStorage;
  }
});
