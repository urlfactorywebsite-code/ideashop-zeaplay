import { UserStatus, type ChatConversation } from '../../../types';

export function inactiveChatUserIds(conversations: ChatConversation[]): Set<string> {
  return new Set(conversations.flatMap(conversation => conversation.members
    .filter(member => member.accountStatus === UserStatus.DEACTIVATED).map(member => member.userId)));
}

/** Hide inactive contacts and member rows while retaining stored message history. */
export function visibleChatConversations(conversations: ChatConversation[], currentUserId?: string): ChatConversation[] {
  return conversations
    .filter(conversation => conversation.type !== 'DIRECT' || !conversation.members.some(member =>
      member.userId !== currentUserId && member.accountStatus === UserStatus.DEACTIVATED))
    .map(conversation => ({ ...conversation,
      members: conversation.members.filter(member => member.accountStatus !== UserStatus.DEACTIVATED),
    }));
}
