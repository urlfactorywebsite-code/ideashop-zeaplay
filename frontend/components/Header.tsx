import React, { useState, useRef, useEffect, useCallback } from 'react';
import TaskDocumentation from './TaskDocumentation';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import { timeAgo } from '../utils';
import { getUserAvatarUrl } from '../utils/userAvatar';
import {
  UserIcon,
  ArrowRightOnRectangleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  UserCircleIcon,
  BellIcon,
  CheckCircleIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  TrophyIcon,
  GiftIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
  ArrowPathIcon,
  Bars3Icon,
  PuzzlePieceIcon,
} from './icons';
import { Notification, NotificationType } from '../types';
import NotificationDetailModal from './NotificationDetailModal';
import { APP_REFRESH_EVENT } from '../utils/appEvents';
import GlobalProgressBar from './loading/GlobalProgressBar';

// ✅ NEW IMPORT
import ClockButton from './ClockAssistant/ClockButton';
import ActiveWork from './ActiveWork';

const notificationIconMap: Record<NotificationType, React.FC<React.SVGProps<SVGSVGElement>>> = {
  [NotificationType.TASK_CREATED]: BellIcon,
  [NotificationType.TASK_UPDATED]: ArrowPathIcon,
  [NotificationType.TASK_DELETED]: TrashIcon,
  [NotificationType.TASK_ASSIGNED]: UserCircleIcon,
  [NotificationType.TASK_COMPLETED]: CheckCircleIcon,
  [NotificationType.TASK_OVERDUE]: BellIcon,
  [NotificationType.COMMENT_ADDED]: ChatBubbleLeftEllipsisIcon,
  [NotificationType.ACHIEVEMENT_UNLOCKED]: TrophyIcon,
  [NotificationType.REWARD_CLAIMED]: GiftIcon,
  [NotificationType.CHAT_MESSAGE]: ChatBubbleOvalLeftEllipsisIcon,
  [NotificationType.TICKET_CREATED]: BellIcon,
  [NotificationType.TICKET_UPDATED]: ArrowPathIcon,
  [NotificationType.TICKET_DELETED]: TrashIcon,
  [NotificationType.TICKET_ASSIGNED]: UserCircleIcon,
  [NotificationType.TICKET_CLOSED]: CheckCircleIcon,
  [NotificationType.USER_CREATED]: UserIcon,
  [NotificationType.USER_UPDATED]: ArrowPathIcon,
  [NotificationType.USER_DELETED]: TrashIcon,
  [NotificationType.DEPARTMENT_CREATED]: BellIcon,
  [NotificationType.DEPARTMENT_UPDATED]: ArrowPathIcon,
  [NotificationType.DEPARTMENT_DELETED]: TrashIcon,
  [NotificationType.APPROVAL_REQUESTED]: BellIcon,
  [NotificationType.APPROVAL_ACTED]: CheckCircleIcon,
  [NotificationType.SLA_BREACH]: BellIcon,
  [NotificationType.SUBTASK_ACTIVATED]: CheckCircleIcon,
  [NotificationType.SUBTASK_REASSIGNED]: UserCircleIcon,
  [NotificationType.SUBTASK_APPROVED]: CheckCircleIcon,
  [NotificationType.SUBTASK_REJECTED]: XMarkIcon,
  [NotificationType.SUBTASK_FORCE_STARTED]: ArrowPathIcon,
  [NotificationType.SUBTASK_REVIEW_REQUIRED]: BellIcon,
  [NotificationType.MENTION]: ChatBubbleLeftEllipsisIcon,
};

const notificationAccentMap: Record<NotificationType, { icon: string; ring: string; glow: string; bg: string }> = {
  [NotificationType.TASK_CREATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.TASK_UPDATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.TASK_DELETED]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.TASK_ASSIGNED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.TASK_COMPLETED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.TASK_OVERDUE]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.COMMENT_ADDED]: {
    icon: 'text-fuchsia-400',
    ring: 'border-fuchsia-400/40',
    glow: 'shadow-[0_0_12px_rgba(217,70,239,0.45)]',
    bg: 'bg-fuchsia-500/10',
  },
  [NotificationType.ACHIEVEMENT_UNLOCKED]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.REWARD_CLAIMED]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.CHAT_MESSAGE]: {
    icon: 'text-fuchsia-400',
    ring: 'border-fuchsia-400/40',
    glow: 'shadow-[0_0_12px_rgba(217,70,239,0.45)]',
    bg: 'bg-fuchsia-500/10',
  },
  [NotificationType.TICKET_CREATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.TICKET_UPDATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.TICKET_DELETED]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.TICKET_ASSIGNED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.TICKET_CLOSED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.USER_CREATED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.USER_UPDATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.USER_DELETED]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.DEPARTMENT_CREATED]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.DEPARTMENT_UPDATED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.DEPARTMENT_DELETED]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.APPROVAL_REQUESTED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.APPROVAL_ACTED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.SLA_BREACH]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.SUBTASK_ACTIVATED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.SUBTASK_REASSIGNED]: {
    icon: 'text-sky-300',
    ring: 'border-sky-300/40',
    glow: 'shadow-[0_0_12px_rgba(56,189,248,0.45)]',
    bg: 'bg-sky-500/10',
  },
  [NotificationType.SUBTASK_APPROVED]: {
    icon: 'text-emerald-400',
    ring: 'border-emerald-400/40',
    glow: 'shadow-[0_0_12px_rgba(34,197,94,0.45)]',
    bg: 'bg-emerald-500/10',
  },
  [NotificationType.SUBTASK_REJECTED]: {
    icon: 'text-rose-400',
    ring: 'border-rose-400/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
    bg: 'bg-rose-500/10',
  },
  [NotificationType.SUBTASK_FORCE_STARTED]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.SUBTASK_REVIEW_REQUIRED]: {
    icon: 'text-amber-300',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    bg: 'bg-amber-500/10',
  },
  [NotificationType.MENTION]: {
    icon: 'text-fuchsia-400',
    ring: 'border-fuchsia-400/40',
    glow: 'shadow-[0_0_12px_rgba(217,70,239,0.45)]',
    bg: 'bg-fuchsia-500/10',
  },
};

const fallbackNotificationAccent = {
  icon: 'text-slate-300',
  ring: 'border-white/10',
  glow: 'shadow-none',
  bg: 'bg-white/5',
};

const countryTimezones = {
  "United States": "America/New_York",
  "United Kingdom": "Europe/London",
  "India": "Asia/Kolkata",
  "Australia": "Australia/Sydney",
  "Japan": "Asia/Tokyo",
  "Germany": "Europe/Berlin",
  "France": "Europe/Paris",
  "Canada": "America/Toronto",
  "Brazil": "America/Sao_Paulo",
  "China": "Asia/Shanghai",
  "Singapore": "Asia/Singapore",
  "UAE": "Asia/Dubai",
  "South Africa": "Africa/Johannesburg",
  "Italy": "Europe/Rome",
  "Spain": "Europe/Madrid",
  "Netherlands": "Europe/Amsterdam",
  "Switzerland": "Europe/Zurich",
  "Sweden": "Europe/Stockholm",
  "Norway": "Europe/Oslo",
  "Denmark": "Europe/Copenhagen",
  "Finland": "Europe/Helsinki",
  "Russia": "Europe/Moscow",
  "Turkey": "Europe/Istanbul",
  "Saudi Arabia": "Asia/Riyadh",
  "Egypt": "Africa/Cairo",
  "Mexico": "America/Mexico_City",
  "Argentina": "America/Argentina/Buenos_Aires",
  "Chile": "America/Santiago",
  "New Zealand": "Pacific/Auckland",
  "South Korea": "Asia/Seoul",
  "Thailand": "Asia/Bangkok",
  "Vietnam": "Asia/Ho_Chi_Minh",
  "Philippines": "Asia/Manila",
  "Malaysia": "Asia/Kuala_Lumpur",
  "Pakistan": "Asia/Karachi",
  "Bangladesh": "Asia/Dhaka",
  "Sri Lanka": "Asia/Colombo",
  "Nepal": "Asia/Kathmandu",
  "Qatar": "Asia/Qatar",
  "Kuwait": "Asia/Kuwait",
  "Oman": "Asia/Muscat",
  "Iran": "Asia/Tehran",
  "Iraq": "Asia/Baghdad",
  "Poland": "Europe/Warsaw",
  "Portugal": "Europe/Lisbon",
  "Greece": "Europe/Athens",
  "Ireland": "Europe/Dublin",
};

type HeaderTheme = 'light' | 'dark' | 'colorful';

const THEME_SEQUENCE: HeaderTheme[] = ['light', 'dark', 'colorful'];

const themePresentation = {
  light: {
    label: 'Light Mode',
    icon: (
      <img
        src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343928/moon_ywhmbz.png"
        alt="Light mode"
        className="h-6 w-6 object-contain"
      />
    ),
  },
  dark: {
    label: 'Dark Mode',
    icon: (
      <img
        src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343927/moon_3_gy8i0p.png"
        alt="Dark mode"
        className="h-6 w-6 object-contain"
      />
    ),
  },
  colorful: {
    label: 'Colorful Mode',
    icon: (
      <img
        src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343927/moon_1_okpfg0.png"
        alt="Colorful mode"
        className="h-6 w-6 object-contain"
      />
    ),
  },
};

const Header = ({ onNotificationClick, onRewardNotificationClick, onSupportClick, onOpenWork = onNotificationClick }) => {
  const { user, logout } = useAuth();
  const { searchQuery, setSearchQuery } = useSearch();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const profileAvatar = getUserAvatarUrl(user);

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [resolvedTheme, setResolvedTheme] = useState<HeaderTheme>('light');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  const [currentTime, setCurrentTime] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('India');
  const [is12Hour, setIs12Hour] = useState(true);
  const [notificationPreviewOpen, setNotificationPreviewOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  const profileDropdownRef = useRef(null);
  const notificationDropdownRef = useRef(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const mobileMenuRef = useRef(null);
  const mobileMenuButtonRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const userNotifications = await api.getNotifications(user.id);
      setNotifications(userNotifications);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener(APP_REFRESH_EVENT, fetchNotifications);
    return () => window.removeEventListener(APP_REFRESH_EVENT, fetchNotifications);
  }, [fetchNotifications]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateResolvedTheme = () => {
      if (theme === 'system') setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
      else setResolvedTheme(theme as HeaderTheme);
    };
    updateResolvedTheme();
    mediaQuery.addEventListener('change', updateResolvedTheme);
    return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateMobileView = () => setIsMobileView(mediaQuery.matches);
    updateMobileView();
    mediaQuery.addEventListener('change', updateMobileView);
    return () => mediaQuery.removeEventListener('change', updateMobileView);
  }, []);

  const handleThemeToggle = () => {
    const activeTheme = theme === 'system' ? resolvedTheme : theme;
    const currentIndex = THEME_SEQUENCE.indexOf(activeTheme);
    setTheme(THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length]);
  };

  const { label: themeLabel, icon: themeIcon } = themePresentation[resolvedTheme];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target))
        setProfileDropdownOpen(false);
      if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target))
        setNotificationDropdownOpen(false);
      if (
        mobileMenuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target) &&
        mobileMenuButtonRef.current &&
        !mobileMenuButtonRef.current.contains(event.target)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!isMobileView) {
      setMobileMenuOpen(false);
    }
  }, [isMobileView]);

  const triggerRefresh = useCallback(() => {
    fetchNotifications();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(APP_REFRESH_EVENT));
    }
    setIsRefreshing(true);
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
    }, 900);
  }, [fetchNotifications]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        timeZone: countryTimezones[selectedCountry],
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: is12Hour,
      });
      setCurrentTime(formatted);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [selectedCountry, is12Hour]);

  const handleLogout = () => {
    setSearchQuery('');
    logout();
  };

  const handleDeleteNotification = async (notificationId: string) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== notificationId));
    if (selectedNotification?.id === notificationId) {
      setSelectedNotification(null);
      setNotificationPreviewOpen(false);
    }
    try {
      await api.deleteNotification(notificationId);
    } catch (error) {
      console.error('Failed to delete notification:', error);
      fetchNotifications();
    }
  };

  const closeNotificationPreview = () => {
    setNotificationPreviewOpen(false);
    setSelectedNotification(null);
  };

  const handleNotificationItemClick = async (notification: Notification) => {
    setNotificationDropdownOpen(false);
    let handled = false;

    if (notification.relatedChatId) {
      navigate(`/chat/${notification.relatedChatId}`);
      handled = true;
    } else if (notification.relatedRewardId && onRewardNotificationClick) {
      onRewardNotificationClick(notification.relatedRewardId);
      handled = true;
    } else if (notification.relatedTaskId && onNotificationClick) {
      onNotificationClick(notification.relatedTaskId);
      handled = true;
    } else if (notification.type === NotificationType.ACHIEVEMENT_UNLOCKED) {
      navigate('/achievements');
      handled = true;
    }

    if (!handled) {
      setSelectedNotification(notification);
      setNotificationPreviewOpen(true);
    }

    setNotifications((prev) =>
      prev.map((notif) => (notif.id === notification.id ? { ...notif, isRead: true } : notif))
    );

    if (user) {
      try {
        await api.markNotificationAsRead(user.id, notification.id);
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <header
      className={`zea-header-saber zea-app-header zea-app-header-${resolvedTheme} relative z-[70] overflow-visible border-b`}
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <video
          className="zea-header-video h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        >
          <source src="https://res.cloudinary.com/dqhcbck76/video/upload/v1770339698/Untitled_design_2_opyhae.mp4" type="video/mp4" />
        </video>
      </div>
      {isMobileView ? (
        <div className="relative z-10 p-4">
          <div className="flex items-center justify-between">
            <img
              src="https://storage.googleapis.com/msgsndr/bsexF0htDBOfNeCh7844/media/6971f5bb4a646444cb4b5be4.png"
              alt="Zea.Play"
              className="h-10 max-w-[25vw] w-auto origin-left object-contain"
            />
            <ActiveWork onOpenTask={onOpenWork} />
            <button
              type="button"
              ref={mobileMenuButtonRef}
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="zea-header-icon-button flex h-10 w-10 items-center justify-center"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div
              ref={mobileMenuRef}
              className="zea-header-mobile-panel mt-4 space-y-4 rounded-xl border p-4 shadow-lg"
            >
              <div className="relative w-full">
                <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-background border border-border-color rounded-md py-2 pl-10 pr-10 w-full focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-primary"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="zea-header-time-pill font-mono text-lg">{currentTime}</div>
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="zea-header-select rounded-lg px-2 py-1 text-sm focus:outline-none"
                  >
                    {Object.keys(countryTimezones).map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>

                  <ClockButton
                    selectedCountry={selectedCountry}
                    is12Hour={is12Hour}
                    theme={resolvedTheme as 'light' | 'dark' | 'colorful'}
                  />
                </div>

                <div className="zea-header-toggle flex items-center gap-2">
                  <span className="text-xs">24h</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={is12Hour}
                      onChange={() => setIs12Hour(!is12Hour)}
                      className="sr-only peer"
                    />
                    <div className="zea-toggle-track w-10 h-5 rounded-full"></div>
                    <div className="zea-toggle-thumb absolute left-1 top-1 w-3 h-3 rounded-full transition-transform duration-300 peer-checked:translate-x-5"></div>
                  </label>
                  <span className="text-xs">12h</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleThemeToggle}
                  className="mode-switch-button inline-flex items-center justify-center rounded-full p-2 text-sm font-semibold"
                  aria-label={themeLabel}
                >
                  <span>{themeIcon}</span>
                </button>

                <button
                  type="button"
                  onClick={triggerRefresh}
                  className="zea-header-control group flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]"
                  title="Refresh data"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                <button onClick={() => setDocModalOpen(true)} className="zea-header-icon-button p-2">
                  <QuestionMarkCircleIcon className="h-6 w-6" />
                </button>
                <TaskDocumentation isOpen={docModalOpen} onClose={() => setDocModalOpen(false)} />

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate('/tool-library');
                  }}
                  className="zea-header-icon-button p-2"
                  title="Open Tool Library"
                  aria-label="Open Tool Library"
                >
                  <PuzzlePieceIcon className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate('/chat');
                  }}
                  className="zea-header-icon-button p-2"
                  title="Open Chat"
                  aria-label="Open Chat"
                >
                  <ChatBubbleOvalLeftEllipsisIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative" ref={notificationDropdownRef}>
                  <button
                    onClick={() => setNotificationDropdownOpen(!notificationDropdownOpen)}
                    className="zea-header-icon-button p-2 relative"
                  >
                    <BellIcon className="h-6 w-6" />
                    {unreadCount > 0 && (
                      <span className="zea-notification-dot absolute top-0 right-0 h-2 w-2 rounded-full"></span>
                    )}
                  </button>
                  {notificationDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-sky-400/40 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 shadow-[0_20px_60px_rgba(56,189,248,0.25),0_0_0_1px_rgba(59,130,246,0.35),inset_0_0_0_1px_rgba(236,72,153,0.25)] backdrop-blur z-[80]">
                      <div className="p-3 border-b border-sky-400/30 flex justify-between items-center bg-gradient-to-r from-sky-500/10 via-fuchsia-500/10 to-indigo-500/10">
                        <h3 className="font-semibold text-text-primary">Notifications</h3>
                      </div>
                      {notifications.length ? (
                        notifications.map((notif) => (
                          <div
                            key={notif.id}
                            onClick={() => handleNotificationItemClick(notif)}
                            className="p-3 flex items-start gap-3 border-b border-sky-400/20 last:border-0 hover:bg-sky-500/10 cursor-pointer relative transition"
                          >
                            {(() => {
                              const Icon = notificationIconMap[notif.type] ?? BellIcon;
                              const accent = notificationAccentMap[notif.type] ?? fallbackNotificationAccent;
                              const isUnread = !notif.isRead;
                              return (
                                <div
                                  className={`flex h-9 w-9 items-center justify-center rounded-full border bg-slate-900/70 ${
                                    isUnread ? `${accent.ring} ${accent.glow} ${accent.bg}` : 'border-white/10 shadow-none'
                                  }`}
                                >
                                  <Icon className={`h-5 w-5 ${isUnread ? accent.icon : 'text-text-muted'}`} />
                                </div>
                              );
                            })()}
                            <div className="flex-1">
                              <p className={`text-sm ${notif.isRead ? 'text-text-muted' : 'text-text-primary'}`}>
                                {notif.message}
                              </p>
                              <p className="text-xs text-text-muted mt-1">{timeAgo(notif.createdAt)}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNotification(notif.id);
                              }}
                              className="p-1 rounded-full border border-sky-400/30 bg-slate-900/70 text-text-inverted hover:border-rose-400/60 hover:text-text-warning transition-colors"
                              title="Delete notification"
                            >
                              <TrashIcon className="h-4 w-4 text-text-inverted dark:text-text-primary" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="p-4 text-center text-sm text-text-muted">No new notifications.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="relative" ref={profileDropdownRef}>
                  <button
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className="zea-header-profile-button flex items-center gap-2 p-2"
                  >
                    <div className="relative">
                      {profileAvatar ? (
                        <img
                          src={profileAvatar}
                          alt="Profile"
                          className="h-8 w-8 rounded-full object-cover border-2 border-white/20"
                        />
                      ) : (
                        <UserIcon className="h-8 w-8" />
                      )}
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium leading-tight">{user?.name}</span>
                      <span className="text-xs opacity-75 capitalize leading-tight">{user?.role}</span>
                    </div>
                  </button>
                  {profileDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-surface rounded-md shadow-lg border border-border-color">
                      <div className="px-4 py-2 border-b">
                        <p className="text-sm font-semibold">{user?.name}</p>
                        <p className="text-xs">{user?.email}</p>
                      </div>
                      <Link
                        to="/settings"
                        onClick={() => setProfileDropdownOpen(false)}
                        className="block px-4 py-2 text-sm hover:bg-surface"
                      >
                        <UserCircleIcon className="inline h-5 w-5 mr-2" />
                        My Profile
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-surface flex items-center"
                      >
                        <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative z-10 flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 lg:gap-4">
            <img
              src="https://storage.googleapis.com/msgsndr/bsexF0htDBOfNeCh7844/media/6971f5bb4a646444cb4b5be4.png"
              alt="Zea.Play"
              className="h-10 w-auto scale-110 origin-left object-contain drop-shadow-[0_6px_20px_rgba(250,204,21,0.35)]"
            />
          </div>

      {/* RIGHT: TIME + DROPDOWNS */}
      <div className="flex items-center gap-3 lg:gap-4">
        <ActiveWork onOpenTask={onOpenWork} />
        {/* ⏰ Time, Country & Smart Clock Assistant */}
        <div className="flex items-center gap-3">
          <div className="zea-header-time-pill rounded-full px-3 py-1.5 font-mono text-sm tracking-[0.2em]">
            {currentTime}
          </div>
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="zea-header-select rounded-full px-3 py-1.5 text-sm focus:outline-none"
          >
            {Object.keys(countryTimezones).map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>

          {/* ✅ Smart Clock Assistant Integration */}
          <ClockButton
            selectedCountry={selectedCountry}
            is12Hour={is12Hour}
            theme={resolvedTheme as 'light' | 'dark' | 'colorful'}
          />

          {/* Time Format Toggle */}
          <div className="zea-header-toggle flex items-center gap-1 rounded-full px-2 py-1 text-xs">
            <span className="text-[10px] tracking-[0.2em]">24h</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={is12Hour}
                onChange={() => setIs12Hour(!is12Hour)}
                className="sr-only peer"
              />
              <div className="zea-toggle-track h-5 w-10 rounded-full transition-colors"></div>
              <div className="zea-toggle-thumb absolute left-1 top-1 h-3 w-3 rounded-full transition-transform duration-300 peer-checked:translate-x-5"></div>
            </label>
            <span className="text-[10px] tracking-[0.2em]">12h</span>
          </div>
        </div>

        <button
          type="button"
          onClick={triggerRefresh}
          className="zea-header-control group flex items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.35em]"
          title="Refresh data"
        >
          <ArrowPathIcon className={`h-4 w-4 transition-transform duration-200 group-hover:rotate-180 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>

        {/* ❓ Docs */}
        <button
          onClick={() => setDocModalOpen(true)}
          className="zea-header-icon-button p-2"
        >
          <QuestionMarkCircleIcon className="h-5 w-5" />
        </button>
        <TaskDocumentation isOpen={docModalOpen} onClose={() => setDocModalOpen(false)} />

        {/* 💬 Chat */}

        {/* 🔔 Notifications */}
        <button
          type="button"
          onClick={() => navigate('/tool-library')}
          className="zea-header-icon-button p-2"
          title="Open Tool Library"
          aria-label="Open Tool Library"
        >
          <PuzzlePieceIcon className="h-5 w-5" />
        </button>

        <button
          onClick={() => navigate('/chat')}
          className="zea-header-icon-button p-2"
          title="Open Chat"
        >
          <ChatBubbleOvalLeftEllipsisIcon className="h-5 w-5" />
        </button>

        <div className="relative" ref={notificationDropdownRef}>
          <button
            onClick={() => setNotificationDropdownOpen(!notificationDropdownOpen)}
            className="zea-header-icon-button relative p-2"
          >
            <BellIcon className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="zea-notification-dot absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"></span>
            )}
          </button>
          {notificationDropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-sky-400/40 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 shadow-[0_20px_60px_rgba(56,189,248,0.25),0_0_0_1px_rgba(59,130,246,0.35),inset_0_0_0_1px_rgba(236,72,153,0.25)] backdrop-blur z-[80]">
              <div className="p-3 border-b border-sky-400/30 flex justify-between items-center bg-gradient-to-r from-sky-500/10 via-fuchsia-500/10 to-indigo-500/10">
                <h3 className="font-semibold text-text-primary">Notifications</h3>
              </div>
              {notifications.length ? (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => handleNotificationItemClick(notif)}
                    className="p-3 flex items-start gap-3 border-b border-sky-400/20 last:border-0 hover:bg-sky-500/10 cursor-pointer relative transition"
                  >
                    {(() => {
                      const Icon = notificationIconMap[notif.type] ?? BellIcon;
                      const accent = notificationAccentMap[notif.type] ?? fallbackNotificationAccent;
                      const isUnread = !notif.isRead;
                      return (
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full border bg-slate-900/70 ${
                            isUnread ? `${accent.ring} ${accent.glow} ${accent.bg}` : 'border-white/10 shadow-none'
                          }`}
                        >
                          <Icon className={`h-5 w-5 ${isUnread ? accent.icon : 'text-text-muted'}`} />
                        </div>
                      );
                    })()}
                    <div className="flex-1">
                      <p className={`text-sm ${notif.isRead ? 'text-text-muted' : 'text-text-primary'}`}>
                        {notif.message}
                      </p>
                      <p className="text-xs text-text-muted mt-1">{timeAgo(notif.createdAt)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNotification(notif.id);
                      }}
                      className="p-1 rounded-full border border-sky-400/30 bg-slate-900/70 text-text-inverted hover:border-rose-400/60 hover:text-text-warning transition-colors"
                      title="Delete notification"
                    >
                      <TrashIcon className="h-4 w-4 text-text-inverted dark:text-text-primary" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="p-4 text-center text-sm text-text-muted">No new notifications.</p>
              )}
            </div>
          )}
        </div>

        {/* 👤 Profile */}
        <div className="relative" ref={profileDropdownRef}>
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="zea-header-profile-button flex items-center gap-2 px-2 py-1.5"
          >
            <div className="relative">
              {profileAvatar ? (
                <img
                  src={profileAvatar}
                  alt="Profile"
                  className="zea-header-avatar h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <UserIcon className="h-8 w-8" />
              )}
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-semibold leading-tight">{user?.name}</span>
              <span className="zea-header-role text-[10px] uppercase tracking-[0.25em] opacity-70 leading-tight">{user?.role}</span>
            </div>
          </button>
          {profileDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-surface rounded-md shadow-lg border border-border-color">
              <div className="px-4 py-2 border-b">
                <p className="text-sm font-semibold">{user?.name}</p>
                <p className="text-xs">{user?.email}</p>
              </div>
              <Link
                to="/settings"
                onClick={() => setProfileDropdownOpen(false)}
                className="block px-4 py-2 text-sm hover:bg-surface"
              >
                <UserCircleIcon className="inline h-5 w-5 mr-2" />
                My Profile
              </Link>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm hover:bg-surface flex items-center"
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
        </div>
      )}
      <NotificationDetailModal
        notification={selectedNotification}
        isOpen={notificationPreviewOpen}
        onClose={closeNotificationPreview}
      />
      <GlobalProgressBar />
    </header>
  );
};

export default Header;
