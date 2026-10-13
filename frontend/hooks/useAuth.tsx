import React, { createContext, useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Role } from '../types';
import api from '../services/mockApi';
import { getAccessToken } from '../services/tokenStorage';
import { AUTH_EXPIRED_EVENT } from '../utils/appEvents';
import PageLoader from '../components/loading/PageLoader';

// Auth Context
interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => void;
  updateUserInContext: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  console.log('useAuth.tsx: AuthProvider rendering');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    console.log('useAuth.tsx: AuthProvider useEffect running');
    const checkLoggedIn = async () => {
      console.log('useAuth.tsx: Checking if user is logged in');
      setLoading(true);
      try {
        if (!getAccessToken()) {
          setUser(null);
          setLoading(false);
          return;
        }
        const currentUser = await api.getCurrentUser();
        console.log('useAuth.tsx: Current user fetched:', currentUser);
        setUser(currentUser);
      } catch (error) {
        console.error('useAuth.tsx: Error fetching current user:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    checkLoggedIn();
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setLoading(false);
      navigate('/login');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [navigate]);
  
  const login = async (email: string, pass: string) => {
    const loggedInUser = await api.login(email, pass);
    setUser(loggedInUser);
  };

  const logout = () => {
    api.logout();
    setUser(null);
    navigate('/login');
  };

  const updateUserInContext = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const value = { user, loading, login, logout, updateUserInContext };

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <PageLoader />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


// Search Context
interface SearchContextType {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    debouncedSearchQuery: string;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 300); // 300ms debounce delay

        return () => {
            clearTimeout(handler);
        };
    }, [searchQuery]);

    return (
        <SearchContext.Provider value={{ searchQuery, setSearchQuery, debouncedSearchQuery }}>
            {children}
        </SearchContext.Provider>
    );
};

export const useSearch = () => {
    const context = useContext(SearchContext);
    if (context === undefined) {
        throw new Error('useSearch must be used within a SearchProvider');
    }
    return context;
};

// Theme Context
type Theme = 'light' | 'dark' | 'colorful' | 'system';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
        const storedTheme = localStorage.getItem('zenith-task-theme') as Theme | null;
        return storedTheme || 'dark';
    });

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('zenith-task-theme', newTheme);
    };

    useEffect(() => {
        const root = window.document.documentElement;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applyTheme = () => {
            const prefersDark = mediaQuery.matches;
            const resolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
            const useColorful = resolvedTheme === 'colorful';
            const useDark = resolvedTheme === 'dark';

            if (useColorful) {
                root.classList.add('theme-colorful');
                root.classList.remove('dark', 'theme-light');
            } else {
                root.classList.remove('theme-colorful');
                root.classList.toggle('dark', useDark);
                if (!useDark) {
                    root.classList.remove('dark');
                    root.classList.add('theme-light');
                } else {
                    root.classList.remove('theme-light');
                }
            }
        };

        applyTheme();

        const handleChange = () => {
            if (theme === 'system') {
                applyTheme();
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);

    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        console.warn('useTheme used without ThemeProvider; falling back to dark theme.');
        return {
            theme: 'dark' as Theme,
            setTheme: () => {},
        };
    }
    return context;
};


