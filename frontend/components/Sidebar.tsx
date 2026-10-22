import React, { useEffect, useState } from 'react';

import { NavLink, NavLinkProps } from 'react-router-dom';
import { Info, Menu, PanelLeftClose, Settings as SettingsIcon, UsersRound } from 'lucide-react';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';

import { useTheme } from '../hooks/useAuth';

import { useNavigation } from '../hooks/useNavigation';

import {
    ChatBubbleOvalLeftEllipsisIcon,
} from './icons';



type SidebarLink = {

    to: NavLinkProps['to'];

    icon: React.ReactNode;

    label: string;

    showUnreadDot?: boolean;

};

interface SidebarProps {
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



const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse, onVersionClick, versionLabel, hasUnreadChat = false }) => {

    const { theme, setTheme } = useTheme();
    const [resolvedTheme, setResolvedTheme] = useState<ThemeKey>('light');
    const displayVersionLabel = versionLabel ?? 'Zea.Play V6.0.1';
    const navigation = useNavigation();

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

    ];



    const adminLinks: SidebarLink[] = [
        { to: '/management', label: 'Management', icon: <UsersRound className="h-6 w-6" aria-hidden="true" /> },
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

    ];



    const getNavLinks = () => {

        let links: SidebarLink[] = [...commonLinks];



        links = [...links, ...adminLinks];

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

        links.push({ to: '/settings', label: 'Settings', icon: <SettingsIcon className="h-6 w-6" aria-hidden="true" /> });
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



    const navLinks = navigation.decorate(getNavLinks());

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
            <nav aria-label="Sidebar" className={`flex-1 min-h-0 ${isCollapsed ? 'px-2 pt-16 pb-4' : 'px-4 pt-2 pb-6'} space-y-2 overflow-auto scrollbar-hide`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
                {navLinks.map((link) => (
                    <NavLink
                        key={linkKey(link)}
                        to={link.to}
                        className={navLinkClass}
                        title={isCollapsed ? link.label : undefined}
                        aria-label={link.showUnreadDot ? `${link.label}, new chat messages` : link.label}
                    >
                        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
                            {link.icon}
                            {link.showUnreadDot && (
                                <span className="zea-notification-dot absolute -right-1 -top-1 h-2 w-2 rounded-full" aria-hidden="true" />
                            )}
                        </span>
                        {!isCollapsed && <span className="min-w-0 break-words">{link.label}</span>}
                        {link.showUnreadDot && <span className="sr-only">New chat messages</span>}
                    </NavLink>
                ))}
            </nav>

            <footer className={`mt-auto flex items-center gap-2 border-t border-border-color px-3 py-3 text-text-secondary ${isCollapsed ? 'flex-col' : ''}`}>
                {!isCollapsed && <span className="min-w-0 flex-1 text-xs">&copy; {displayVersionLabel}</span>}
                <button type="button" aria-label="Open release notes" title="Release notes" onClick={onVersionClick}
                    className="rounded-lg p-2 transition hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary">
                    <Info className="h-4 w-4" aria-hidden="true" />
                </button>
            </footer>

        </div>

    );

};



export default Sidebar;

