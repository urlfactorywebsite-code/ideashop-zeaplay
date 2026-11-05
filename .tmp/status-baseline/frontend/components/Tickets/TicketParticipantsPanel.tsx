import React, { useState } from 'react';
import { UserPlusIcon, UserMinusIcon, UserIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { Ticket, User, TicketParticipantRole } from '../../types';
import { useTicketParticipants } from '../../hooks/useTicketParticipants';

interface TicketParticipantsPanelProps {
  ticket: Ticket;
}

const TicketParticipantsPanel: React.FC<TicketParticipantsPanelProps> = ({ ticket }) => {
  const { participants, users, updateParticipants, loading } = useTicketParticipants(ticket.id);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState<TicketParticipantRole>(TicketParticipantRole.FOLLOWER);

  const participantEntries = participants.map((participant) => ({
    ...participant,
    user: users.find((user) => user.id === participant.userId) as User | undefined,
  }));

  const availableUsers = users.filter(
    (user) => !participants.some((participant) => participant.userId === user.id),
  );

  const handleAddParticipant = async () => {
    if (!selectedUser) return;

    try {
      await updateParticipants({
        add: [{ userId: selectedUser.id, role: selectedRole }],
        remove: [],
      });
      setShowAddModal(false);
      setSelectedUser(null);
      setSelectedRole(TicketParticipantRole.FOLLOWER);
    } catch (error) {
      console.error('Failed to add participant:', error);
    }
  };

  const handleRemoveParticipant = async (userId: string, role: TicketParticipantRole) => {
    try {
      await updateParticipants({
        add: [],
        remove: [{ userId, role }],
      });
    } catch (error) {
      console.error('Failed to remove participant:', error);
    }
  };

  const getRoleIcon = (role: TicketParticipantRole) => {
    switch (role) {
      case TicketParticipantRole.OWNER:
        return <ShieldCheckIcon className="h-5 w-5 text-purple-500" />;
      case TicketParticipantRole.ASSIGNEE:
        return <UserIcon className="h-5 w-5 text-blue-500" />;
      case TicketParticipantRole.FOLLOWER:
        return <UserIcon className="h-5 w-5 text-gray-500" />;
      default:
        return <UserIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getRoleLabel = (role: TicketParticipantRole) => {
    switch (role) {
      case TicketParticipantRole.OWNER:
        return 'Owner';
      case TicketParticipantRole.ASSIGNEE:
        return 'Assignee';
      case TicketParticipantRole.FOLLOWER:
        return 'Follower';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Participants ({participantEntries.length})
        </h3>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <UserPlusIcon className="h-5 w-5 mr-2" />
          Add Participant
        </button>
      </div>

      {/* Participants List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {participantEntries.map((participant) => (
            <div
              key={participant.userId}
              className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <div className="flex items-center space-x-4">
                <div className="flex items-center justify-center w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full">
                  <UserIcon className="h-6 w-6 text-gray-600 dark:text-gray-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {participant.user?.name || participant.userId}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {participant.user?.email || 'No email on file'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  {getRoleIcon(participant.role)}
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {getRoleLabel(participant.role)}
                  </span>
                </div>
                {participant.role !== TicketParticipantRole.OWNER && (
                  <button
                  onClick={() => handleRemoveParticipant(participant.userId, participant.role)}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <UserMinusIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {participantEntries.length === 0 && (
        <div className="text-center py-12">
          <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No participants</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Add team members to collaborate on this ticket.
          </p>
        </div>
      )}

      {/* Add Participant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setShowAddModal(false)}></div>
            </div>

            <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white mb-4">
                      Add Participant
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Select User
                        </label>
                        <select
                          value={selectedUser?.id || ''}
                          onChange={(e) => {
                            const user = availableUsers.find(u => u.id === e.target.value);
                            setSelectedUser(user || null);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">Choose a user...</option>
                          {availableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} ({user.email})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Role
                        </label>
                        <select
                          value={selectedRole}
                          onChange={(e) => setSelectedRole(e.target.value as TicketParticipantRole)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        >
                          <option value={TicketParticipantRole.FOLLOWER}>Follower</option>
                          <option value={TicketParticipantRole.ASSIGNEE}>Assignee</option>
                          <option value={TicketParticipantRole.OWNER}>Owner</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleAddParticipant}
                  disabled={!selectedUser}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  Add Participant
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-800 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketParticipantsPanel;


