import { ChatConversation } from '../types';
import { User } from '../../../types';

export const getConversationTitle = (conversation: ChatConversation, currentUser?: User | null) => {
  if (conversation.type !== 'DIRECT') {
    return conversation.name || 'Untitled conversation';
  }
  const other = conversation.members.find((member) => member.userId !== currentUser?.id);
  return other?.name || 'Direct message';
};

export const getConversationSubtitle = (conversation: ChatConversation) => {
  if (conversation.type === 'DIRECT') return 'Direct message';
  if (conversation.type === 'GROUP') return `${conversation.members.length} members`;
  return conversation.isPrivate ? 'Private space' : 'Public space';
};

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CH';
