import assert from 'node:assert/strict';
import test from 'node:test';
import { UserStatus, type ChatConversation } from '../types';
import { inactiveChatUserIds, visibleChatConversations } from '../features/chat/utils/userVisibility';

const conversation = (id: string, type: ChatConversation['type'], inactive: boolean) => ({
  id, type, members: [
    { userId: 'self', accountStatus: UserStatus.ACTIVE },
    { userId: id, accountStatus: inactive ? UserStatus.DEACTIVATED : UserStatus.ACTIVE },
  ], lastMessage: { content: 'Historical message remains intact' },
} as ChatConversation);

test('deactivated direct contacts are hidden while active contacts remain', () => {
  const rows = [conversation('inactive', 'DIRECT', true), conversation('active', 'DIRECT', false)];
  assert.deepEqual(visibleChatConversations(rows, 'self').map(item => item.id), ['active']);
  rows[0].members[1].accountStatus = UserStatus.ACTIVE;
  assert.deepEqual(visibleChatConversations(rows, 'self').map(item => item.id), ['inactive', 'active']);
});

test('groups/spaces hide inactive member rows without mutating membership or message history', () => {
  for (const type of ['GROUP', 'SPACE'] as const) {
    const original = conversation('inactive', type, true);
    const visible = visibleChatConversations([original], 'self')[0];
    assert.deepEqual(visible.members.map(member => member.userId), ['self']);
    assert.equal(visible.lastMessage, original.lastMessage);
    assert.equal(original.members.length, 2);
  }
});

test('inactive identities from existing conversations can be removed from synthesized contacts', () => {
  const rows = [conversation('inactive', 'DIRECT', true), conversation('group-inactive', 'GROUP', true), conversation('active', 'DIRECT', false)];
  assert.deepEqual([...inactiveChatUserIds(rows)].sort(), ['group-inactive', 'inactive']);
});
