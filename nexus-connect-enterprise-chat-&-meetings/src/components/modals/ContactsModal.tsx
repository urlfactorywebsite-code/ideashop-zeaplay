import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useCall } from '../../context/CallContext';
import { Avatar } from '../common/Avatar';
import { Search, X, MessageSquare, Phone, Video, Mail, Building } from 'lucide-react';

interface ContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ContactsModal: React.FC<ContactsModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { createConversation, onlineUserIds } = useChat();
  const { initiateCall } = useCall();
  const [contacts, setContacts] = useState<User[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      api.getUsers().then(res => {
        setContacts(res.users);
      });
      setSearch('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = contacts.filter(
    c =>
      c.displayName.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.department.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleStartChat = async (targetUser: User) => {
    if (targetUser.id === user?.id) return;
    await createConversation({
      type: 'dm',
      name: targetUser.displayName,
      memberIds: [targetUser.id],
    });
    onClose();
  };

  const handleStartCall = async (targetUser: User, type: 'audio' | 'video') => {
    if (targetUser.id === user?.id) return;
    await initiateCall(targetUser, type);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Enterprise Colleague Directory
              </h2>
              <p className="text-[11px] text-slate-400">
                {contacts.length} team members across departments
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, title, department, or email..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              autoFocus
            />
          </div>
        </div>

        {/* Contacts Grid */}
        <div className="p-3 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 max-h-96">
          {filtered.map(contact => {
            const isSelf = contact.id === user?.id;
            const isOnline = onlineUserIds.includes(contact.id);

            return (
              <div
                key={contact.id}
                className="py-3 px-2 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    name={contact.displayName}
                    avatarUrl={contact.avatarUrl}
                    status={isOnline ? 'online' : contact.status}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {contact.displayName}
                      </span>
                      {isSelf && (
                        <span className="px-1.5 py-0.5 text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md font-medium">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {contact.title} • {contact.department}
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                      <Mail className="w-2.5 h-2.5" />
                      {contact.email}
                    </p>
                    {contact.customStatus && (
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5 truncate italic">
                        "{contact.customStatus}"
                      </p>
                    )}
                  </div>
                </div>

                {!isSelf && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleStartChat(contact)}
                      className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                      title="Direct Message"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleStartCall(contact, 'audio')}
                      className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                      title="Audio Call"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleStartCall(contact, 'video')}
                      className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                      title="Video Call"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
