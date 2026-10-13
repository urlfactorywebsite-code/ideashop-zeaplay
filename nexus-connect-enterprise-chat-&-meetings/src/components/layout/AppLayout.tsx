import React, { useState } from 'react';
import { User } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { LeftSidebar } from '../sidebar/LeftSidebar';
import { ChatHeader } from '../chat/ChatHeader';
import { PinnedMessagesBanner } from '../chat/PinnedMessagesBanner';
import { SearchInConversationBar } from '../chat/SearchInConversationBar';
import { MessageList } from '../chat/MessageList';
import { MessageComposer } from '../chat/MessageComposer';
import { RightSidebar } from '../details/RightSidebar';
import { NewConversationModal } from '../modals/NewConversationModal';
import { ContactsModal } from '../modals/ContactsModal';
import { UserProfileModal } from '../modals/UserProfileModal';
import { SettingsModal } from '../modals/SettingsModal';
import { AuthModal } from '../modals/AuthModal';
import { IncomingCallModal } from '../calls/IncomingCallModal';
import { CallOverlay } from '../calls/CallOverlay';
import { MeetingRoom } from '../calls/MeetingRoom';
import { MessageSquare, Users, Hash, Plus, Sparkles } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { user } = useAuth();
  const {
    conversations,
    activeConversation,
    messages,
    isLoadingMessages,
    isRightSidebarOpen,
    searchInChatTerm,
    replyingToMessage,
    editingMessage,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    togglePin,
    startTyping,
    stopTyping,
    addMember,
    setIsRightSidebarOpen,
    setReplyingToMessage,
    setEditingMessage,
  } = useChat();

  // Modals state
  const [isNewConvOpen, setIsNewConvOpen] = useState(false);
  const [isContactsOpen, setIsContactsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);

  // Users list from conversation members
  const allKnownUsersMap = new Map<string, User>();
  conversations.forEach(c => {
    c.members.forEach(m => {
      if (m.user && !allKnownUsersMap.has(m.userId)) {
        allKnownUsersMap.set(m.userId, {
          id: m.user.id,
          displayName: m.user.displayName,
          email: '',
          title: m.user.title,
          department: '',
          avatarUrl: m.user.avatarUrl,
          status: m.user.status,
          customStatus: m.user.customStatus,
          createdAt: '',
        });
      }
    });
  });
  const allKnownUsers = Array.from(allKnownUsersMap.values());

  // Pinned messages for active conversation
  const pinnedMessages = messages.filter(m => m.isPinned && !m.isDeleted);
  const usersMap = new Map(allKnownUsers.map(u => [u.id, u]));

  // Search match count
  const matchCount = searchInChatTerm.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchInChatTerm.toLowerCase())).length
    : 0;

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-blue-500/20');
      setTimeout(() => el.classList.remove('bg-blue-500/20'), 1500);
    }
  };

  return (
    <div className="w-screen h-screen flex overflow-hidden bg-white dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased">
      {/* 1. LEFT SIDEBAR */}
      <LeftSidebar
        onOpenNewConversation={() => setIsNewConvOpen(true)}
        onOpenContacts={() => setIsContactsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* 2. CENTER PANEL (CONVERSATION WORKSPACE) */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative bg-white dark:bg-slate-900/60">
        {activeConversation ? (
          <>
            {/* Active Conversation Header */}
            <ChatHeader
              conversation={activeConversation}
              onOpenAddMember={() => setIsAddMemberOpen(true)}
            />

            {/* Pinned Messages Banner */}
            <PinnedMessagesBanner
              pinnedMessages={pinnedMessages}
              usersMap={usersMap}
              onJumpToMessage={jumpToMessage}
            />

            {/* In-conversation Search Bar */}
            <SearchInConversationBar matchCount={matchCount} />

            {/* Message History Timeline */}
            <MessageList
              conversation={activeConversation}
              messages={messages}
              users={allKnownUsers}
              isLoading={isLoadingMessages}
              onReply={msg => setReplyingToMessage(msg)}
              onEdit={msg => setEditingMessage(msg)}
              onDelete={deleteMessage}
              onToggleReaction={toggleReaction}
              onTogglePin={togglePin}
            />

            {/* Message Composer */}
            <MessageComposer
              conversationName={
                activeConversation.type === 'channel'
                  ? `#${activeConversation.name}`
                  : activeConversation.name
              }
              replyingToMessage={replyingToMessage}
              editingMessage={editingMessage}
              onSendMessage={sendMessage}
              onEditMessage={editMessage}
              onCancelReply={() => setReplyingToMessage(null)}
              onCancelEdit={() => setEditingMessage(null)}
              onStartTyping={startTyping}
              onStopTyping={stopTyping}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/10">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
              No Conversation Selected
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-4">
              Choose a channel or direct message from the sidebar, or create a new communication space to begin collaborating.
            </p>
            <button
              onClick={() => setIsNewConvOpen(true)}
              className="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Space</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. RIGHT SIDEBAR (COLLAPSIBLE) */}
      {isRightSidebarOpen && activeConversation && (
        <RightSidebar
          conversation={activeConversation}
          messages={messages}
          users={allKnownUsers}
          onClose={() => setIsRightSidebarOpen(false)}
          onOpenAddMember={() => setIsAddMemberOpen(true)}
          onJumpToMessage={jumpToMessage}
        />
      )}

      {/* Modals & Calling Portals */}
      <NewConversationModal
        isOpen={isNewConvOpen}
        onClose={() => setIsNewConvOpen(false)}
      />

      <ContactsModal
        isOpen={isContactsOpen}
        onClose={() => setIsContactsOpen(false)}
      />

      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

      {/* Add member modal for active conversation */}
      {isAddMemberOpen && activeConversation && (
        <ContactsModal
          isOpen={isAddMemberOpen}
          onClose={() => setIsAddMemberOpen(false)}
        />
      )}

      {/* Calling & Meeting Overlays */}
      <IncomingCallModal />
      <CallOverlay />
      <MeetingRoom />
    </div>
  );
};
