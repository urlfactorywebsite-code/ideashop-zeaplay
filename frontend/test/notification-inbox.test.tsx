import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NotificationInbox from '../components/NotificationInbox';
import { NotificationEntityType, NotificationType, type Notification } from '../types';
import { defaultNotificationFilters, filterNotifications, notificationCategories, notificationCategory } from '../utils/notificationFilters';

const item = (id: string, values: Partial<Notification> = {}): Notification => ({
  id, userId: 'synthetic-user', type: NotificationType.TASK_UPDATED, message: 'Plan updated',
  isRead: false, createdAt: '2026-11-06T06:00:00Z', relatedTaskId: null, relatedRewardId: null, ...values,
});
test('notification filters combine read state, category and Unicode search without changing records', () => {
  const items = [item('a'), item('b', { isRead: true }), item('c', { type: NotificationType.CHAT_MESSAGE, message: 'Guild résumé' })];
  const before = structuredClone(items);
  assert.equal(filterNotifications(items, defaultNotificationFilters).length, 3);
  assert.deepEqual(filterNotifications(items, { read: 'unread', category: 'tasks', search: '  PLAN ' }).map(row => row.id), ['a']);
  assert.deepEqual(filterNotifications(items, { read: 'read', category: 'all', search: '' }).map(row => row.id), ['b']);
  assert.deepEqual(filterNotifications(items, { read: 'all', category: 'chat', search: 'RÉSUMÉ' }).map(row => row.id), ['c']);
  assert.equal(filterNotifications(items, { read: 'read', category: 'chat', search: '' }).length, 0);
  assert.deepEqual(items, before);
});
test('every registered notification type has a category and ticket workflow exceptions follow the existing module mapping', () => {
  for (const type of Object.values(NotificationType)) assert.notEqual(notificationCategory(item(type, { type })), 'other', type);
  for (const type of [NotificationType.TASK_OVERDUE, NotificationType.APPROVAL_REQUESTED, NotificationType.APPROVAL_ACTED, NotificationType.SLA_BREACH]) {
    assert.equal(notificationCategory(item('ticket', { type, entityType: NotificationEntityType.TICKET })), 'tickets');
  }
  const unknown = item('old', { type: 'LEGACY_NOTICE' as NotificationType });
  assert.equal(notificationCategory(unknown), 'other');
  assert.equal(filterNotifications([unknown], defaultNotificationFilters).length, 1);
  assert(notificationCategories.some(category => category.value === 'other'));
});
test('inbox exposes named actions, hides filter fields behind the icon and safely renders long messages', () => {
  const html = renderToStaticMarkup(<NotificationInbox notifications={[item('long', { message: '<script>alert(1)</script>' + 'a'.repeat(300) })]}
    renderIcon={() => null} onOpen={() => {}} onDelete={async () => {}} onMarkAllRead={async () => {}} onClose={() => {}} />);
  assert.match(html, /Filter notifications/);
  assert.match(html, /aria-expanded="false"/);
  assert(!html.includes('placeholder="Search notifications'));
  assert.match(html, /Mark all as read/);
  assert.match(html, /Ctrl\+click to select/);
  assert.match(html, /&lt;script&gt;/);
  assert(!html.includes('<script>'));
  assert.match(html, /break-words/);
});
test('empty inbox explains the empty state and disables mark-all-read', () => {
  const html = renderToStaticMarkup(<NotificationInbox notifications={[]}
    renderIcon={() => null} onOpen={() => {}} onDelete={async () => {}} onMarkAllRead={async () => {}} onClose={() => {}} />);
  assert.match(html, /No notifications yet/);
  assert.match(html, /Showing 0 of 0/);
  assert.match(html, /disabled=""[^>]*title="Mark all notifications as read/);
});
