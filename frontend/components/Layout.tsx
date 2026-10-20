

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import TaskDetailModal from './TaskDetailModal';
import SupportFormModal from './SupportFormModal';
import api from '../services/mockApi';
import { User, Role, ReleaseNotes, ReleaseNotesUpdate } from '../types';
import ClaimedRewardModal from './ClaimedRewardModal';
import Chatbot from './Chatbot';
import { APP_REFRESH_EVENT } from '../utils/appEvents';
import { useAuth, useTheme } from '../hooks/useAuth';
import { useChatUnreadIndicator } from '../hooks/useChatUnreadIndicator';
import { ToastProvider } from '../hooks/useToast';
import ReleaseNotesModal from './ReleaseNotesModal';
import ReleaseNotesEditorModal from './ReleaseNotesEditorModal';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { hasUnreadChat } = useChatUnreadIndicator();
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTaskId = searchParams.get('taskId');
  const linkedSubtaskId = searchParams.get('subtaskId');
  const linkedTaskRef = useRef<string | null>(null);
  const [workSubtaskId, setWorkSubtaskId] = useState<string | null>(null);
  const [viewingRewardId, setViewingRewardId] = useState<string | null>(null);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotes | null>(null);
  const [releaseNotesLoading, setReleaseNotesLoading] = useState(false);
  const [releaseNotesError, setReleaseNotesError] = useState<string | null>(null);
  const [releaseNotesSaving, setReleaseNotesSaving] = useState(false);
  const [isReleaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [isReleaseNotesEditorOpen, setReleaseNotesEditorOpen] = useState(false);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuView, setMobileMenuView] = useState<'grid' | 'list'>('grid');

  const fetchUsers = useCallback(async () => {
    try {
      const allUsers = await api.getUsers();
      const map = new Map<string, User>();
      allUsers.forEach(u => map.set(u.id, u));
      setUsersMap(map);
    } catch (error) {
      console.error("Failed to fetch users for layout:", error);
    }
  }, []);

  const fetchReleaseNotes = useCallback(async () => {
    setReleaseNotesLoading(true);
    setReleaseNotesError(null);
    try {
      const notes = await api.getReleaseNotes();
      setReleaseNotes(notes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load release notes.';
      setReleaseNotesError(message);
    } finally {
      setReleaseNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      fetchUsers();
    };
    if (refreshKey > 0) {
      run();
      return () => {
        cancelled = true;
      };
    }
    if (typeof window === 'undefined') {
      return;
    }
    if ('requestIdleCallback' in window) {
      const browserWindow = window;
      const idleId = browserWindow.requestIdleCallback(run);
      return () => {
        cancelled = true;
        browserWindow.cancelIdleCallback(idleId);
      };
    }
    const timeoutId = globalThis.setTimeout(run, 150);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [fetchUsers, refreshKey]);

  useEffect(() => {
    fetchReleaseNotes();
  }, [fetchReleaseNotes]);

  useEffect(() => {
    const handleRefresh = () => {
      setRefreshKey((prev) => prev + 1);
    };
    window.addEventListener(APP_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(APP_REFRESH_EVENT, handleRefresh);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const previous = linkedTaskRef.current;
    if (!user || !linkedTaskId || !/^[A-Za-z0-9_-]{1,128}$/.test(linkedTaskId)) {
      linkedTaskRef.current = null;
      if (previous) setModalTaskId((current) => current === previous ? null : current);
      return;
    }
    linkedTaskRef.current = linkedTaskId;
    setWorkSubtaskId(linkedSubtaskId && /^[A-Za-z0-9_-]{1,128}$/.test(linkedSubtaskId) ? linkedSubtaskId : null);
    setModalTaskId(linkedTaskId);
  }, [linkedTaskId, linkedSubtaskId, user?.id]);

  const handleCloseModal = () => {
    setModalTaskId(null);
    setWorkSubtaskId(null);
    if (searchParams.has('taskId')) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('taskId');
        next.delete('subtaskId');
        return next;
      }, { replace: true });
    }
  };

  const handleTaskDeleted = (_taskId: string) => {
    handleCloseModal();
  };
  
  const handleCloseRewardModal = () => {
    setViewingRewardId(null);
  }

  const isOwner = user?.role === Role.OWNER;

  const mobileLinks = useMemo(() => {
    const links = [
      { to: '/dashboard', label: 'Dashboard', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/dashboard_pvjlbg.png' },
      { to: '/tasks', label: 'Tasks', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/task-actions_urhfeq.png' },
      { to: '/projects', label: 'Projects', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/Users_b58wty.png' },
      { to: '/chat', label: 'Chat', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/customer-service_cra3yp.png', showUnreadDot: hasUnreadChat },
      { to: '/kanban', label: 'Kanban', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/kanban_ysnojm.png' },
      { to: '/tickets', label: 'Tickets', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343495/support-ticket_fku5gp.png' },
      { to: '/calendar', label: 'Calendar', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/calendar_xbhksz.png' },
      { to: '/media', label: 'Media', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/Media_Library_em2ky8.png' },
    ];
    if (user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) {
      links.push(
        { to: '/clients', label: 'Clients', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/Users_b58wty.png' },
        { to: '/admin/users', label: 'Users', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/Users_b58wty.png' },
        { to: '/gantt', label: 'Gantt', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343495/gantt-chart_gjwr5s.png' },
        { to: '/reports', label: 'Reports', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343494/report_boqlo0.png' },
        { to: '/logs', label: 'Logs', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770623653/log_cbtgmr.png' },
      );
    }
    if (user?.role === Role.OWNER) {
      links.push(
        { to: '/admin/points-table', label: 'Points', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/points_jgi3yh.png' },
        { to: '/template-editor', label: 'Templates', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/layout_xgg1fa.png' },
        { to: '/api/overview', label: 'API', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/api_bhcggn.png' },
      );
    }
    if (user?.role === Role.ADMIN) {
      links.push({ to: '/api/smtp', label: 'SMTP', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/api_bhcggn.png' });
    }
    if (user?.role === Role.USER) {
      links.push({ to: '/reports', label: 'Reports', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343494/report_boqlo0.png' });
    }
    links.push(
      { to: '/achievements', label: 'Achievements', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/achivement_ckvs6i.png' },
      { to: '/levels', label: 'Levels', icon: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/level-up_l6lcwq.png' },
    );
    return links;
  }, [hasUnreadChat, user]);

  const bottomBarLinks = useMemo(
    () => mobileLinks.filter((link) => ['/dashboard', '/tasks', '/kanban'].includes(String(link.to))),
    [mobileLinks],
  );

  const handleOpenReleaseNotes = () => {
    setReleaseNotesOpen(true);
    fetchReleaseNotes();
  };

  const handleCloseReleaseNotes = () => {
    setReleaseNotesOpen(false);
  };

  const handleOpenReleaseNotesEditor = () => {
    if (!isOwner) {
      return;
    }
    setReleaseNotesOpen(false);
    setReleaseNotesEditorOpen(true);
    if (!releaseNotes) {
      fetchReleaseNotes();
    }
  };

  const handleCloseReleaseNotesEditor = () => {
    setReleaseNotesEditorOpen(false);
  };

  const handleSaveReleaseNotes = async (payload: ReleaseNotesUpdate) => {
    setReleaseNotesSaving(true);
    try {
      const updated = await api.updateReleaseNotes(payload);
      setReleaseNotes(updated);
      setReleaseNotesEditorOpen(false);
      setReleaseNotesOpen(true);
    } catch (error) {
      throw error;
    } finally {
      setReleaseNotesSaving(false);
    }
  };

  return (
    <ToastProvider>
      <ActiveWorkProvider>
      <div className="flex h-screen flex-col bg-background text-text-primary">
        <Header 
        onNotificationClick={(taskId) => { setWorkSubtaskId(null); if (taskId) setModalTaskId(taskId); }}
        onOpenWork={(taskId, subtaskId) => { setWorkSubtaskId(subtaskId ?? null); setModalTaskId(taskId); }}
        onRewardNotificationClick={(rewardId) => rewardId && setViewingRewardId(rewardId)}
        onSupportClick={() => setIsSupportOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden lg:block">
          <Sidebar
            onSupportClick={() => setIsSupportOpen(true)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
            onVersionClick={handleOpenReleaseNotes}
            versionLabel={releaseNotes?.versionLabel}
            hasUnreadChat={hasUnreadChat}
          />
        </div>
        <main
          key={refreshKey}
          className={`layout-main-surface flex-1 overflow-x-hidden overflow-y-auto bg-background pt-4 pr-4 pb-24 pl-4 sm:pt-6 sm:pr-6 sm:pb-24 sm:pl-6 lg:p-6 ${theme === 'colorful' ? 'layout-main-colorful' : ''}`}
        >
        <style>
          {`
            @keyframes colorShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes darkShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes lightShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          `}
        </style>
        {children}
      </main>
      </div>
      <div className="lg:hidden">
        <div className="mobile-nav-shell">
          {bottomBarLinks.slice(0, 2).map((link) => (
            <NavLink key={String(link.to)} to={link.to} className="mobile-nav-item" onClick={() => setMobileMenuOpen(false)}>
              <span className="relative">
                <img src={link.icon} alt={link.label} className="h-5 w-5" />
                {link.showUnreadDot && (
                  <span className="zea-notification-dot absolute -right-1 -top-1 h-2 w-2 rounded-full" aria-hidden="true" />
                )}
              </span>
              <span>{link.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="mobile-nav-center"
            aria-label="Open menu"
          >
            <span className="text-xl">â‰¡</span>
          </button>
          {bottomBarLinks.slice(2, 4).map((link) => (
            <NavLink key={String(link.to)} to={link.to} className="mobile-nav-item" onClick={() => setMobileMenuOpen(false)}>
              <span className="relative">
                <img src={link.icon} alt={link.label} className="h-5 w-5" />
                {link.showUnreadDot && (
                  <span className="zea-notification-dot absolute -right-1 -top-1 h-2 w-2 rounded-full" aria-hidden="true" />
                )}
              </span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </div>
        {isMobileMenuOpen && (
          <div className="mobile-menu-overlay">
            <div className="mobile-menu-card">
              <div className="mobile-menu-header">
                <span>Pages</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileMenuView('grid')}
                    className={`mobile-menu-toggle ${mobileMenuView === 'grid' ? 'mobile-menu-toggle-active' : ''}`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileMenuView('list')}
                    className={`mobile-menu-toggle ${mobileMenuView === 'list' ? 'mobile-menu-toggle-active' : ''}`}
                  >
                    List
                  </button>
                  <button type="button" onClick={() => setMobileMenuOpen(false)} className="mobile-menu-close">
                    Close
                  </button>
                </div>
              </div>
              <div className={`mobile-menu-grid ${mobileMenuView === 'list' ? 'mobile-menu-grid-list' : ''}`}>
                {mobileLinks.map((link) => (
                  <NavLink
                    key={String(link.to)}
                    to={link.to}
                    className="mobile-menu-link"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span className="relative">
                      <img src={link.icon} alt={link.label} className="h-6 w-6" />
                      {link.showUnreadDot && (
                        <span className="zea-notification-dot absolute -right-1 -top-1 h-2 w-2 rounded-full" aria-hidden="true" />
                      )}
                    </span>
                    <span>{link.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
       {modalTaskId && (
        <TaskDetailModal
          key={`${user?.id}:${modalTaskId}`}
          taskId={modalTaskId}
          requireFresh={Boolean(linkedTaskId)}
          focusSubtaskId={workSubtaskId}
          isOpen={!!modalTaskId}
          onClose={handleCloseModal}
          usersMap={usersMap}
          onTaskDeleted={handleTaskDeleted}
        />
      )}
      {viewingRewardId && (
        <ClaimedRewardModal
            isOpen={!!viewingRewardId}
            rewardId={viewingRewardId}
            onClose={handleCloseRewardModal}
        />
      )}
      {isSupportOpen && (
        <SupportFormModal
          isOpen={isSupportOpen}
          onClose={() => setIsSupportOpen(false)}
        />
      )}
      {isReleaseNotesOpen && (
        <ReleaseNotesModal
          isOpen={isReleaseNotesOpen}
          onClose={handleCloseReleaseNotes}
          onEdit={handleOpenReleaseNotesEditor}
          isOwner={!!isOwner}
          isLoading={releaseNotesLoading}
          errorMessage={releaseNotesError}
          releaseNotes={releaseNotes}
        />
      )}
      {isReleaseNotesEditorOpen && (
        <ReleaseNotesEditorModal
          isOpen={isReleaseNotesEditorOpen}
          onClose={handleCloseReleaseNotesEditor}
          onSave={handleSaveReleaseNotes}
          isSaving={releaseNotesSaving}
          releaseNotes={releaseNotes}
        />
      )}
      <Chatbot />
    </div>
      </ActiveWorkProvider>
  </ToastProvider>
);
};

export default Layout;



