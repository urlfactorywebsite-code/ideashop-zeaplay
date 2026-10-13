import React, { useMemo } from 'react';
import { User, UserStatus } from '../../types';

interface MentionPickerProps {
  users: User[];
  query: string;
  isOpen: boolean;
  onSelect: (user: User) => void;
  onClose: () => void;
}

const MentionPicker: React.FC<MentionPickerProps> = ({ users, query, isOpen, onSelect, onClose }) => {
  const candidates = useMemo(() => {
    const activeUsers = users.filter((user) => user.status === UserStatus.ACTIVE);
    if (!query) return activeUsers.slice(0, 6);
    const lowered = query.toLowerCase();
    return activeUsers
      .filter((user) => user.name.toLowerCase().includes(lowered) || user.email.toLowerCase().includes(lowered))
      .slice(0, 6);
  }, [users, query]);

  if (!isOpen || candidates.length === 0) return null;

  return (
    <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-xs uppercase tracking-[0.2em] text-gray-400 dark:border-gray-800">
        Mention
        <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-gray-600">
          Esc
        </button>
      </div>
      <ul className="max-h-52 overflow-y-auto">
        {candidates.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              onClick={() => onSelect(user)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-200">
                {user.name.slice(0, 2)}
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{user.name}</span>
                <span className="block text-xs text-gray-400">{user.email}</span>
              </span>
              <span className="text-xs text-blue-500">@{user.name.replace(/\s+/g, '')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MentionPicker;
