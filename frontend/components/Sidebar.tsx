import React, { useEffect, useRef, useState } from 'react';

import { NavLink, NavLinkProps } from 'react-router-dom';
import { Menu, PanelLeftClose } from 'lucide-react';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';

import { useAuth, useTheme } from '../hooks/useAuth';
import { getUserAvatarUrl } from '../utils/userAvatar';

import { Role } from '../types';

import {
    ChartPieIcon,
    CodeBracketSquareIcon,
    UserCircleIcon,
    ChatBubbleLeftEllipsisIcon,
    ChatBubbleOvalLeftEllipsisIcon,
} from './icons';



type SidebarLink = {

    to: NavLinkProps['to'];

    icon: React.ReactNode;

    label: string;

    showUnreadDot?: boolean;

};

interface SidebarProps {
  onSupportClick: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onVersionClick: () => void;
  versionLabel?: string;
  hasUnreadChat?: boolean;
}

type ThemeKey = 'light' | 'dark' | 'colorful';

const isColorfulThemeEnabled =
  ((import.meta.env.VITE_ENABLE_COLORFUL_THEME ?? 'false').trim().toLowerCase() === 'true');

const THEME_ORDER: ThemeKey[] = isColorfulThemeEnabled ? ['dark', 'light', 'colorful'] : ['dark', 'light'];

const THEME_ICON_URLS: Record<ThemeKey, string> = {
  dark: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343927/moon_3_gy8i0p.png',
  light: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343928/moon_ywhmbz.png',
  colorful: 'https://res.cloudinary.com/dqhcbck76/image/upload/v1770343927/moon_1_okpfg0.png',
};


const linkKey = (link: SidebarLink) => {

    const destination = link.to;

    if (typeof destination === 'string') {

        return destination;

    }

    const pathname = destination.pathname ?? '';

    const search = destination.search ?? '';

    const hash = destination.hash ?? '';

    return `${pathname}${search}${hash}`;

};



const Sidebar: React.FC<SidebarProps> = ({ onSupportClick, isCollapsed, onToggleCollapse, onVersionClick, versionLabel, hasUnreadChat = false }) => {

    const { user } = useAuth();
    const { theme, setTheme } = useTheme();
    const [resolvedTheme, setResolvedTheme] = useState<ThemeKey>('light');
    const [isDropupOpen, setDropupOpen] = useState(false);
    const displayVersionLabel = versionLabel ?? 'Zea.Play V6.0.1';
    const profileAvatar = getUserAvatarUrl(user);
    const dropupRef = useRef<HTMLDivElement | null>(null);



    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const updateResolvedTheme = () => {
            if (theme === 'system') setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
            else setResolvedTheme(theme as ThemeKey);
        };
        updateResolvedTheme();
        mediaQuery.addEventListener('change', updateResolvedTheme);
        return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
    }, [theme]);

    const activeTheme = ((theme === 'system' ? resolvedTheme : theme) === 'colorful' && !isColorfulThemeEnabled
        ? 'light'
        : (theme === 'system' ? resolvedTheme : theme)) as ThemeKey;
    const handleThemeToggle = () => {
        const currentIndex = THEME_ORDER.indexOf(activeTheme);
        setTheme(THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]);
    };
    const themeLabel =
        activeTheme === 'dark' ? 'Dark Mode' : activeTheme === 'light' ? 'Light Mode' : 'Colorful Mode';

    useEffect(() => {
        if (!isDropupOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!dropupRef.current || dropupRef.current.contains(event.target as Node)) {
                return;
            }
            setDropupOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropupOpen]);



    const commonLinks: SidebarLink[] = [
        {
            to: '/dashboard',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/dashboard_pvjlbg.png"
                    alt="Dashboard"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Dashboard',
        },
        {
            to: '/tasks',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/task-actions_urhfeq.png"
                    alt="All Tasks"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'All Tasks',
        },
        {
            to: '/chat',
            icon: (
                <ChatBubbleOvalLeftEllipsisIcon className="h-6 w-6" />
            ),
            label: 'Chat',
            showUnreadDot: hasUnreadChat,
        },
        {
            to: '/projects',
            icon: (
                <BuildingOffice2Icon className="h-6 w-6" />
            ),
            label: 'Projects',
        },
        {
            to: '/kanban',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/kanban_ysnojm.png"
                    alt="Kanban Board"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Kanban Board',
        },
        {
            to: '/tickets',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343495/support-ticket_fku5gp.png"
                    alt="Ticket"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Ticket',
        },
        {
            to: '/calendar',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/calendar_xbhksz.png"
                    alt="Calendar"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Calendar',
        },
        {
            to: '/media',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/Media_Library_em2ky8.png"
                    alt="Media Library"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Media Library',
        },
    ];



    const adminLinks: SidebarLink[] = [
        {
            to: '/clients',
            icon: (
                <BuildingOffice2Icon className="h-6 w-6" />
            ),
            label: 'Clients',
        },
        {
            to: '/admin/users',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241423/Users_b58wty.png"
                    alt="Users"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Users',
        },
        {
            to: '/gantt',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343495/gantt-chart_gjwr5s.png"
                    alt="Gantt Chart"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Gantt Chart',
        },
        {
            to: '/reports',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343494/report_boqlo0.png"
                    alt="Reports"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Reports',
        },
        {
            to: '/logs',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770623653/log_cbtgmr.png"
                    alt="Logs"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Logs',
        },
    ];



    const getNavLinks = () => {

        let links: SidebarLink[] = [...commonLinks];



        if (user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) {

            links = [...links, ...adminLinks];

        }



        links.push({
            to: '/achievements',
            icon: (
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/achivement_ckvs6i.png"
                    alt="Achievements"
                    className="h-6 w-6 object-contain"
                />
            ),
            label: 'Achievements',
        });

        if (user?.role === Role.OWNER) {
            links.push({
                to: '/api/overview',
                icon: (
                    <img
                        src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/api_bhcggn.png"
                        alt="API"
                        className="h-6 w-6 object-contain"
                    />
                ),
                label: 'API',
            });
        }
        if (user?.role === Role.ADMIN) {
            links.push({ to: '/api/smtp', label: 'SMTP', icon: <span aria-hidden="true">✉</span> });
        }
        const seen = new Set<string>();

        return links.filter((link) => {

            const key = linkKey(link);

            if (seen.has(key)) {

                return false;

            }

            seen.add(key);

            return true;

        });

    };



    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `sidebar-link flex items-center ${isCollapsed ? 'justify-center px-2' : 'space-x-3 px-4'} py-3 rounded-lg transition-all duration-300 ease-in-out ${
            isActive
                ? 'sidebar-link-active bg-blue-100 dark:bg-gray-900 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
        }`;



    return (

        <div
            className={`group/sidebar sidebar-shell sidebar-${activeTheme} relative border-r flex h-full flex-col rounded-2xl shadow-lg transition-all duration-300 lg:rounded-none lg:shadow-none ${isCollapsed ? 'w-16' : 'w-64'}`}
        >
            {isCollapsed && (
            <button
                type="button"
                onClick={onToggleCollapse}
                className="absolute left-1/2 top-4 z-40 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-300/60 bg-slate-950/90 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.45)] transition duration-300 ease-in-out hover:scale-105 hover:border-cyan-200/80 hover:text-white focus-visible:opacity-100 focus-visible:pointer-events-auto dark:border-cyan-300/60 dark:bg-slate-950/90"
                aria-label="Expand sidebar"
            >
                <Menu className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
            </button>
            )}
            {!isCollapsed && (
            <div className="px-4 pb-5 pt-7">
                <div className="flex items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={handleThemeToggle}
                        className="theme-pill-button mode-switch-button group flex h-10 items-center gap-2 rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.28em]"
                        aria-label={themeLabel}
                    >
                        <img
                            src={THEME_ICON_URLS[activeTheme]}
                            alt={themeLabel}
                            className="h-6 w-6 object-contain drop-shadow-[0_0_8px_rgba(34,211,238,0.45)]"
                        />
                        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.28em] sm:inline">
                            {themeLabel}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="mode-switch-button flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition duration-300 ease-in-out hover:scale-105"
                        aria-label="Collapse sidebar"
                    >
                        <PanelLeftClose className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
                    </button>
                </div>
            </div>
            )}
            <nav className={`flex-1 min-h-0 ${isCollapsed ? 'px-2 pt-16 pb-4' : 'px-4 pt-2 pb-6'} space-y-2 overflow-auto scrollbar-hide`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
                {getNavLinks().map((link) => (
                    <NavLink
                        key={linkKey(link)}
                        to={link.to}
                        className={navLinkClass}
                        title={isCollapsed ? link.label : undefined}
                    >
                        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                            {link.icon}
                            {link.showUnreadDot && (
                                <span className="zea-notification-dot absolute -right-1 -top-1 h-2 w-2 rounded-full" aria-hidden="true" />
                            )}
                        </span>
                        {!isCollapsed && <span>{link.label}</span>}
                        {link.showUnreadDot && <span className="sr-only">New chat messages</span>}
                    </NavLink>
                ))}
            </nav>

            {!isCollapsed && (
            <div className="relative mt-auto px-4 py-3 border-t border-gray-200 dark:border-gray-900 text-sm" ref={dropupRef}>
                {isDropupOpen && (
                    <div className="absolute left-0 bottom-12 z-20 w-56 overflow-hidden rounded-2xl border border-sky-300/40 bg-slate-950/95 text-slate-100 shadow-[0_18px_40px_rgba(2,6,23,0.6)]">
                        <NavLink
                            to="/settings"
                            className="flex items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-white/10"
                            onClick={() => setDropupOpen(false)}
                        >
                            {profileAvatar ? (
                                <img
                                    src={profileAvatar}
                                    alt={user?.name ? `${user.name} profile` : 'Profile'}
                                    className="h-7 w-7 rounded-full object-cover"
                                />
                            ) : (
                                <img
                                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770343495/avatar-design_p5updr.png"
                                    alt="Profile"
                                    className="h-6 w-6 object-contain"
                                />
                            )}
                            <span>Profile</span>
                        </NavLink>
                        <button
                            type="button"
                            onClick={() => {
                                onSupportClick();
                                setDropupOpen(false);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-white/10"
                        >
                            <img
                                src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241422/customer-service_cra3yp.png"
                                alt="Support"
                                className="h-6 w-6 object-contain"
                            />
                            <span>Support</span>
                        </button>
                        {user?.role === Role.OWNER && (
                            <NavLink
                                to="/master-control"
                                className="flex items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-white/10"
                                onClick={() => setDropupOpen(false)}
                            >
                                <img
                                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/api_bhcggn.png"
                                    alt="Master Control"
                                    className="h-6 w-6 object-contain"
                                />
                                <span>Master Control</span>
                            </NavLink>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onVersionClick}
                        className="text-gray-400 hover:text-gray-200 transition"
                        aria-label="Open release notes"
                    >
                        Â© {displayVersionLabel}
                    </button>
                    <button
                        type="button"
                        onClick={() => setDropupOpen((prev) => !prev)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-300/60 bg-slate-950/90 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.35)] transition hover:scale-105 hover:border-sky-200/80 hover:text-white"
                        aria-expanded={isDropupOpen}
                        aria-label="Open sidebar menu"
                    >
                        <span className={`text-xs font-semibold transition ${isDropupOpen ? 'rotate-180' : ''}`}>{'^'}</span>
                    </button>
                </div>
            </div>
            )}

        </div>

    );

};



export default Sidebar;

