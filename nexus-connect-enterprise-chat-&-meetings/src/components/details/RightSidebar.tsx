import React, { useState } from 'react';
import { Conversation, Message, User, Attachment } from '../../types';
import { Avatar } from '../common/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import {
  X,
  Users,
  Pin,
  FileText,
  Info,
  UserPlus,
  Shield,
  Download,
  Image as ImageIcon,
  Calendar,
  Lock,
  Hash,
  UserMinus,
} from 'lucide-react';

interface RightSidebarProps {
  conversation: Conversation;
  messages: Message[];
  users: User[];
  onClose: () => void;
  onOpenAddMember: () => void;
  onJumpToMessage: (id: string) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  conversation,
  messages,
  users,
  onClose,
  onOpenAddMember,
  onJumpToMessage,
}) => {
  const { user } = useAuth();
  const { togglePin, removeMember, onlineUserIds } = useChat();
  const [activeTab, setActiveTab] = useState<'info' | 'members' | 'pinned' | 'files'>('members');

  const usersMap = new Map<string, User>(users.map(u => [u.id, u]));
  const isDm = conversation.type === 'dm';

  // Gather pinned messages
  const pinnedMessages = messages.filter(m => m.isPinned && !m.isDeleted);

  // Gather all attachments from messages
  const allAttachments: { attachment: Attachment; message: Message }[] = [];
  messages.forEach(m => {
    if (!m.isDeleted && m.attachments) {
      m.attachments.forEach(att => {
        allAttachments.push({ attachment: att, message: m });
      });
    }
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isCurrentAdmin = conversation.members.some(
    m => m.userId === user?.id && m.role === 'admin'
  );

  return (
    <div className="w-80 h-full bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 select-none animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between bg-white dark:bg-slate-900/90">
        <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
          Space Details
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 px-2 py-1.5 gap-1 bg-white/50 dark:bg-slate-900/50">
        {[
          { id: 'members', label: 'Members', icon: Users, count: conversation.members.length },
          { id: 'pinned', label: 'Pins', icon: Pin, count: pinnedMessages.length },
          { id: 'files', label: 'Files', icon: FileText, count: allAttachments.length },
          { id: 'info', label: 'Info', icon: Info },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[9px] bg-slate-200 dark:bg-slate-800 px-1 rounded-full font-bold">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 1. Members Tab */}
        {activeTab === 'members' && (
          <div className="space-y-3">
            {!isDm && (
              <button
                onClick={onOpenAddMember}
                className="w-full py-2 px-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center justify-center gap-2 text-xs font-semibold transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Member to Space</span>
              </button>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {conversation.members.map(member => {
                const u = usersMap.get(member.userId);
                const isOnline = onlineUserIds.includes(member.userId);
                const isAdmin = member.role === 'admin';
                const isSelf = member.userId === user?.id;

                return (
                  <div
                    key={member.userId}
                    className="py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        name={u?.displayName || 'User'}
                        avatarUrl={u?.avatarUrl}
                        status={isOnline ? 'online' : (u?.status || 'offline')}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {u?.displayName || 'Member'}
                          </span>
                          {isAdmin && (
                            <span className="px-1 py-0.2 text-[8px] font-bold rounded-sm bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                              Admin
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {u?.title || 'Team Member'}
                        </p>
                      </div>
                    </div>

                    {!isDm && (isCurrentAdmin || isSelf) && (
                      <button
                        onClick={() => removeMember(member.userId)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title={isSelf ? 'Leave Space' : 'Remove Member'}
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. Pinned Tab */}
        {activeTab === 'pinned' && (
          <div className="space-y-2">
            {pinnedMessages.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Pin className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No pinned messages in this space</p>
              </div>
            ) : (
              pinnedMessages.map(msg => {
                const sender = usersMap.get(msg.senderId);
                return (
                  <div
                    key={msg.id}
                    onClick={() => onJumpToMessage(msg.id)}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-blue-400 dark:hover:border-blue-500/60 cursor-pointer transition-all shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                        {sender?.displayName || 'Colleague'}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          togglePin(msg.id);
                        }}
                        className="text-slate-400 hover:text-rose-500 p-0.5"
                        title="Unpin"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3">
                      {msg.content}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 3. Files Tab */}
        {activeTab === 'files' && (
          <div className="space-y-2">
            {allAttachments.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <FileText className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No shared media or documents yet</p>
              </div>
            ) : (
              allAttachments.map(({ attachment, message }, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 shrink-0">
                      {attachment.type.startsWith('image/') ? (
                        <ImageIcon className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {attachment.name}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatFileSize(attachment.size)} •{' '}
                        {new Date(message.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <a
                    href={attachment.url}
                    download={attachment.name}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              ))
            )}
          </div>
        )}

        {/* 4. Info Tab */}
        {activeTab === 'info' && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Topic & Purpose
              </span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {conversation.topic || 'No topic has been set for this space yet.'}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Space Details
              </span>
              <div className="space-y-1.5 text-slate-600 dark:text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Type:</span>
                  <span className="font-semibold text-slate-900 dark:text-white capitalize">
                    {conversation.type} {conversation.isPrivate ? '(Private)' : '(Public)'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Created:</span>
                  <span>{new Date(conversation.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Space ID:</span>
                  <span className="font-mono text-[10px] text-slate-500">{conversation.id}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
