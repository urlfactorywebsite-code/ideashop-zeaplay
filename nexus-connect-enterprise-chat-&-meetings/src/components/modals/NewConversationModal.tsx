import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { Avatar } from '../common/Avatar';
import { X, Hash, Lock, Users, MessageSquare, Search, Check } from 'lucide-react';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { createConversation, onlineUserIds } = useChat();

  const [activeTab, setActiveTab] = useState<'dm' | 'group' | 'channel'>('dm');
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupTopic, setGroupTopic] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [isPrivateChannel, setIsPrivateChannel] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getUsers().then(res => {
        setUsers(res.users.filter(u => u.id !== user?.id));
      });
      setSelectedUserIds([]);
      setGroupName('');
      setChannelName('');
      setSearch('');
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const filteredUsers = users.filter(u =>
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.department.toLowerCase().includes(search.toLowerCase())
  );

  const toggleUserSelect = (uid: string) => {
    if (activeTab === 'dm') {
      setSelectedUserIds([uid]);
    } else {
      setSelectedUserIds(prev =>
        prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
      );
    }
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      if (activeTab === 'dm') {
        if (selectedUserIds.length === 0) return;
        const targetUser = users.find(u => u.id === selectedUserIds[0]);
        await createConversation({
          type: 'dm',
          name: targetUser?.displayName || 'Direct Message',
          memberIds: [selectedUserIds[0]],
        });
      } else if (activeTab === 'group') {
        if (!groupName.trim()) return;
        await createConversation({
          type: 'group',
          name: groupName.trim(),
          topic: groupTopic.trim(),
          memberIds: selectedUserIds,
        });
      } else if (activeTab === 'channel') {
        if (!channelName.trim()) return;
        const safeName = channelName.trim().toLowerCase().replace(/\s+/g, '-');
        await createConversation({
          type: 'channel',
          name: safeName,
          topic: channelTopic.trim(),
          isPrivate: isPrivateChannel,
          memberIds: selectedUserIds,
        });
      }
      onClose();
    } catch (err) {
      console.error('Error creating conversation:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Create Communication Space
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Space Type Tabs */}
        <div className="grid grid-cols-3 p-1.5 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 gap-1.5">
          <button
            onClick={() => setActiveTab('dm')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'dm'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Direct Message
          </button>
          <button
            onClick={() => setActiveTab('group')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'group'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Group Space
          </button>
          <button
            onClick={() => setActiveTab('channel')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'channel'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            Channel
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'channel' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-mono">#</span>
                  <input
                    type="text"
                    value={channelName}
                    onChange={e => setChannelName(e.target.value)}
                    placeholder="e.g. project-alpha"
                    className="w-full pl-7 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Topic / Purpose (Optional)
                </label>
                <input
                  type="text"
                  value={channelTopic}
                  onChange={e => setChannelTopic(e.target.value)}
                  placeholder="What is this channel about?"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Private Channel
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Only invited members can view this channel
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isPrivateChannel}
                  onChange={e => setIsPrivateChannel(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded-sm border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {activeTab === 'group' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Group Space Name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="e.g. Q4 Launch Squad"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Topic (Optional)
                </label>
                <input
                  type="text"
                  value={groupTopic}
                  onChange={e => setGroupTopic(e.target.value)}
                  placeholder="Goals & initiatives for this group"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* User selector section */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {activeTab === 'dm'
                ? 'Select Colleague'
                : activeTab === 'group'
                ? 'Add Group Members'
                : 'Invite Initial Members (Optional)'}
            </label>

            {/* Search Input */}
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search colleagues by name or role..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              />
            </div>

            {/* Users list */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">No colleagues found</div>
              ) : (
                filteredUsers.map(u => {
                  const isSelected = selectedUserIds.includes(u.id);
                  const isOnline = onlineUserIds.includes(u.id);
                  return (
                    <div
                      key={u.id}
                      onClick={() => toggleUserSelect(u.id)}
                      className={`flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                        isSelected ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          name={u.displayName}
                          avatarUrl={u.avatarUrl}
                          status={isOnline ? 'online' : u.status}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {u.displayName}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {u.title} • {u.department}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-3" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={
              isSubmitting ||
              (activeTab === 'dm' && selectedUserIds.length === 0) ||
              (activeTab === 'group' && !groupName.trim()) ||
              (activeTab === 'channel' && !channelName.trim())
            }
            className="px-4 py-1.5 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSubmitting ? 'Creating...' : 'Create Space'}
          </button>
        </div>
      </div>
    </div>
  );
};
