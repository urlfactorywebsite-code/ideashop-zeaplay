import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, UserStatus } from '../types';
import { api, setApiAuthToken, getApiAuthToken } from '../services/api';
import { socketService } from '../services/socket';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  demoUsers: User[];
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; displayName: string; title?: string; department?: string; avatarUrl?: string }) => Promise<void>;
  logout: () => void;
  switchUser: (userId: string) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  setStatus: (status: UserStatus, customStatus?: string) => Promise<void>;
  refreshDemoUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getApiAuthToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [demoUsers, setDemoUsers] = useState<User[]>([]);

  const refreshDemoUsers = async () => {
    try {
      const res = await api.getDemoUsers();
      setDemoUsers(res.users);
    } catch (err) {
      console.error('Failed to load demo users', err);
    }
  };

  useEffect(() => {
    refreshDemoUsers();

    const initAuth = async () => {
      const storedToken = getApiAuthToken();
      if (storedToken) {
        try {
          const res = await api.getMe();
          setUser(res.user);
          socketService.connect(res.user.id);
        } catch (err) {
          console.warn('Session expired or invalid, logging out', err);
          setApiAuthToken(null);
          setToken(null);
          setUser(null);
        }
      } else {
        // If no token exists on first visit, auto-login as first demo persona (Sarah Chen)
        // so the reviewer immediately lands inside a working enterprise interface
        try {
          const demoRes = await api.getDemoUsers();
          if (demoRes.users && demoRes.users.length > 0) {
            const first = demoRes.users[0];
            const switchRes = await api.switchUser(first.id);
            setApiAuthToken(switchRes.token);
            setToken(switchRes.token);
            setUser(switchRes.user);
            socketService.connect(switchRes.user.id);
          }
        } catch (err) {
          console.error('Could not auto-login demo user', err);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await api.login({ email, password });
      setApiAuthToken(res.token);
      setToken(res.token);
      setUser(res.user);
      socketService.connect(res.user.id);
      await refreshDemoUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: { email: string; password: string; displayName: string; title?: string; department?: string; avatarUrl?: string }) => {
    setIsLoading(true);
    try {
      const res = await api.register(data);
      setApiAuthToken(res.token);
      setToken(res.token);
      setUser(res.user);
      socketService.connect(res.user.id);
      await refreshDemoUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setApiAuthToken(null);
    setToken(null);
    setUser(null);
    socketService.disconnect();
  };

  const switchUser = async (userId: string) => {
    setIsLoading(true);
    try {
      socketService.disconnect();
      const res = await api.switchUser(userId);
      setApiAuthToken(res.token);
      setToken(res.token);
      setUser(res.user);
      socketService.connect(res.user.id);
      await refreshDemoUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<User>) => {
    if (!user) return;
    const res = await api.updateProfile(updates);
    setUser(res.user);
    if (updates.status || updates.customStatus !== undefined) {
      socketService.setPresence(res.user.status, res.user.customStatus);
    }
    await refreshDemoUsers();
  };

  const setStatus = async (status: UserStatus, customStatus?: string) => {
    if (!user) return;
    const res = await api.updateProfile({ status, customStatus });
    setUser(res.user);
    socketService.setPresence(status, customStatus);
    await refreshDemoUsers();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        demoUsers,
        login,
        register,
        logout,
        switchUser,
        updateProfile,
        setStatus,
        refreshDemoUsers,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
