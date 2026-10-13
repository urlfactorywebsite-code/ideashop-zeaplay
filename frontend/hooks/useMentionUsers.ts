import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { User } from '../types';

export const useMentionUsers = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getChatUsers({ limit: 100 });
      setUsers(data.items.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        role: 'user' as any,
        status: 'ACTIVE' as any,
        department: item.teamName ?? undefined,
        title: item.title ?? undefined,
        avatarUrl: item.avatarUrl ?? null,
        points: 0,
        overallXpPoints: 0,
        claimedXpPoints: 0,
        unlockedAchievementIds: [],
        tasksCreated: 0,
        tasksCompleted: 0,
        clarityScores: [],
        claimedRewardIds: [],
      })));
    } catch (error) {
      console.error('Failed to load users for mentions', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, loading, refetch: fetchUsers };
};
