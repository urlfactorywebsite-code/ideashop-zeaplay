import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Role } from '../types.ts';
import MessageItem from '../features/chat/components/MessageItem.tsx';
import MessageList from '../features/chat/components/MessageList.tsx';
import { normalizeMessage } from '../features/chat/utils/normalizeMessage.ts';

const currentUser = {
  id: 'me',
  name: 'Current User',
  email: 'me@example.com',
  role: Role.USER,
};

test('normalizes REST snake_case messages before rendering', () => {
  const message = normalizeMessage({
    id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    sender_name: 'Alice Johnson',
    sender_role: 'USER',
    message_type: 'TEXT',
    content: 'hello',
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    reactions: [{ id: 'r1', message_id: 'm1', user_id: 'me', emoji: 'ok', created_at: '2026-01-01T10:01:00.000Z' }],
  });

  assert.equal(message.senderName, 'Alice Johnson');
  assert.equal(message.content, 'hello');
  assert.doesNotThrow(() => renderToString(React.createElement(MessageItem, { message, currentUser })));
});

test('normalizes websocket camelCase nested sender messages before rendering', () => {
  const message = normalizeMessage({
    id: 'm2',
    conversationId: 'c1',
    sender: { id: 'u2', name: 'Sruthi R' },
    messageType: 'TEXT',
    text: 'socket message',
    createdAt: '2026-01-01T10:02:00.000Z',
  });

  assert.equal(message.senderName, 'Sruthi R');
  assert.equal(message.sender.id, 'u2');
  assert.doesNotThrow(() => renderToString(React.createElement(MessageItem, { message, currentUser })));
});

test('renders missing sender, null content, deleted, and attachment-only messages', () => {
  const deleted = normalizeMessage({
    id: 'm3',
    conversation_id: 'c1',
    content: null,
    deleted_at: '2026-01-01T10:05:00.000Z',
    attachments: [{ original_file_name: 'report.pdf', file_size: null }],
  });

  assert.equal(deleted.senderName, 'Unknown User');
  assert.equal(deleted.content, '');
  assert.equal(deleted.attachments[0].mimeType, 'application/octet-stream');
  assert.doesNotThrow(() => renderToString(React.createElement(MessageItem, { message: deleted, currentUser })));
});

test('renders reply previews when original content is missing', () => {
  const original = normalizeMessage({ id: 'm4', conversation_id: 'c1', sender_name: undefined, content: undefined });
  const reply = normalizeMessage({ id: 'm5', conversation_id: 'c1', sender_id: 'me', sender_name: 'Current User', content: 'reply', reply_to_message_id: 'm4' });

  assert.doesNotThrow(() => renderToString(React.createElement(MessageItem, { message: reply, currentUser, replyTo: original })));
});

test('message list handles invalid dates without crashing', () => {
  const messages = [
    normalizeMessage({ id: 'm6', conversation_id: 'c1', sender_id: 'u1', sender_name: 'Alice', content: 'bad date', created_at: 'not-a-date' }),
    normalizeMessage({ id: 'm7', conversation_id: 'c1', sender_id: 'u1', sender_name: 'Alice', content: 'next', created_at: null }),
  ];

  assert.doesNotThrow(() => renderToString(React.createElement(MessageList, {
    messages,
    currentUser,
    loading: false,
    hasMore: false,
    onLoadMore: () => {},
  })));
});
