import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/mockApi';
import { Task, User } from '../types';
import { formatDate, timeAgo, formatTaskStatus } from '../utils';
import { getUserAvatarUrl } from '../utils/userAvatar';
import TaskStatusBadge from './ui/TaskStatusBadge';

interface SameTaskLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  usersMap: Map<string, User>;
  groupTasks?: Task[];
  onRefreshGroup?: () => void;
}

const SameTaskLogModal: React.FC<SameTaskLogModalProps> = ({ isOpen, onClose, taskId, usersMap, groupTasks, onRefreshGroup }) => {
  const [tasks, setTasks] = useState<Task[]>(groupTasks ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshGroupRef = useRef(onRefreshGroup);

  useEffect(() => {
    refreshGroupRef.current = onRefreshGroup;
  }, [onRefreshGroup]);

  useEffect(() => {
    if (groupTasks) {
      setTasks(groupTasks);
    }
  }, [groupTasks]);

  const fetchSameTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const grouped = await api.getTaskGroup(taskId);
      setTasks(grouped);
      refreshGroupRef.current?.();
    } catch (err) {
      console.error('Failed to fetch same tasks:', err);
      setError('Failed to load linked tasks');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (isOpen && taskId) {
      fetchSameTasks();
    }
  }, [fetchSameTasks, isOpen, taskId]);

  const activityFeed = useMemo(() => {
    return tasks
      .map((task) => ({
        id: `${task.id}-status`,
        userId: task.assignedTo?.[0] ?? null,
        status: task.status,
        updatedAt: task.updatedAt,
        title: task.title,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tasks]);

  const renderUserAvatar = (user?: User) => {
    if (!user) {
      return (
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-xs uppercase text-white/70">
          ??
        </span>
      );
    }
    const avatarUrl = getUserAvatarUrl(user);
    return (
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/40 text-xs font-semibold uppercase text-white/70">
        {avatarUrl ? <img src={avatarUrl} alt={user.name} className="h-full w-full object-cover" /> : user.name.slice(0, 2)}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/60 backdrop-blur">
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary pointer-events-auto z-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-white">Shared Task Group</h2>
              <p className="text-sm text-white/70">Track every teammate working on this linked quest.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/20 bg-black/40 px-3 py-1 text-sm font-semibold text-white">
                👥 {tasks.length} users
              </span>
              <button
                onClick={fetchSameTasks}
                className="rounded-full border border-primary/50 bg-primary/20 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/30"
              >
                Refresh
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center text-sm text-white/70">
              Loading same tasks...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center text-sm text-white/70">
              {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center justify-center text-sm text-white/70">
              No same tasks found.
            </div>
          ) : (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <h3 className="text-lg font-semibold text-white">Team roster</h3>
                {tasks.map((task) => {
                  const assigneeId = task.assignedTo?.[0] ?? '';
                  const user = assigneeId ? usersMap.get(assigneeId) : undefined;
                  return (
                    <div key={task.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-3">
                      {renderUserAvatar(user)}
                      <div className="flex flex-1 flex-col">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{user?.name ?? 'Unassigned'}</span>
                          <span className="text-xs text-white/60">{timeAgo(task.updatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-white/60">
                          <TaskStatusBadge status={task.status} />
                          <span>{task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No deadline'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <h3 className="text-lg font-semibold text-white">Recent pulses</h3>
                {activityFeed.length === 0 ? (
                  <p className="text-sm text-white/70">No activity captured yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {activityFeed.slice(0, 8).map((entry) => {
                      const actor = entry.userId ? usersMap.get(entry.userId) : undefined;
                      return (
                        <li key={entry.id} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{actor?.name ?? 'System update'}</span>
                            <span className="text-xs text-white/60">{formatDate(entry.updatedAt, true)}</span>
                          </div>
                          <p className="mt-1 text-xs text-white/70">
                            Status synced to <span className="font-semibold text-primary">{formatTaskStatus(entry.status)}</span> on “{entry.title}”.
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SameTaskLogModal;
