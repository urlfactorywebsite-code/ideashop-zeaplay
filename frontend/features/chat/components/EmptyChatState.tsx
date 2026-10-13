import React from 'react';
import { ChatConversation } from '../types';
import { User } from '../../../types';
import { getConversationTitle, initials } from '../utils/conversation';

type Props = {
  conversation?: ChatConversation | null;
  currentUser?: User | null;
};

const EmptyChatState: React.FC<Props> = ({ conversation, currentUser }) => {
  const title = conversation ? getConversationTitle(conversation, currentUser) : 'Choose a conversation';
  const otherMember = conversation?.type === 'DIRECT'
    ? conversation.members.find((member) => member.userId !== currentUser?.id)
    : null;
  const inactive = otherMember?.accountStatus === 'DEACTIVATED';

  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-white">
      <div className="max-w-sm">
        <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-zinc-800 text-2xl font-black text-sky-300 ring-1 ring-white/10">
          {otherMember?.avatarUrl ? <img src={otherMember.avatarUrl} alt="" className="h-full w-full object-cover" /> : conversation ? initials(title) : '+'}
        </div>
        <h2 className="mt-4 text-xl font-black text-white">
          {conversation ? title : 'Choose a conversation'}
        </h2>
        <p className="mt-1 text-sm font-semibold text-zinc-400">
          {inactive ? 'Deactivated account' : otherMember?.departmentName || otherMember?.title || (conversation?.type === 'SPACE' ? 'Space' : conversation?.type === 'GROUP' ? 'Group' : '')}
        </p>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {conversation
            ? inactive
              ? 'You can view previous messages, but new messages are disabled.'
              : conversation.type === 'DIRECT'
                ? `Start a conversation with ${title}.`
                : 'This is the beginning of this conversation.'
            : 'Direct messages, groups, and spaces will appear here.'}
        </p>
      </div>
    </div>
  );
};

export default EmptyChatState;
