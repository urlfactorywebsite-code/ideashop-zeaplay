import React, { Suspense } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router-dom';
import { useNavigation } from '../hooks/useNavigation';
import PageLoader from '../components/loading/PageLoader';
import SettingsRedirect from '../components/SettingsRedirect';
import NotFound from './NotFound';
import NavigationGuard from '../components/NavigationGuard';

const OAuthManagement = React.lazy(() => import('../components/OAuthManagement'));
const OAuthApplications = React.lazy(() => import('./OAuthApplications'));
const OAUTH_PATH = '/settings/oauth';

export default function SettingsOAuth() {
  const location = useLocation();
  const navigation = useNavigation();
  const section = location.pathname.slice(OAUTH_PATH.length).replace(/^\/+|\/+$/g, '');
  const canManage = ['allowed', 'hidden'].includes(navigation.configuration?.oauthManagementAccess ?? '');
  const authorizedAccess = navigation.page('authorized-apps')?.access;
  if (section && section !== 'authorized-apps') return <NotFound />;
  if (!section && !canManage) return ['allowed', 'hidden'].includes(authorizedAccess ?? '')
    ? <SettingsRedirect to={`${OAUTH_PATH}/authorized-apps`} />
    : <Navigate to="/navigation-unavailable" replace state={{ access: authorizedAccess, pageId: 'authorized-apps' }} />;
  return <div className="min-w-0 space-y-5">
    <nav aria-label="OAuth settings" className="flex gap-2 overflow-x-auto pb-2">
      {[
        { label: 'OAuth management', path: OAUTH_PATH, visible: navigation.configuration?.oauthManagementAccess === 'allowed' },
        { label: 'Authorized apps', path: `${OAUTH_PATH}/authorized-apps`, visible: navigation.visible('authorized-apps') },
      ].filter(entry => entry.visible).map(entry => <NavLink key={entry.path} end
        to={{ pathname: entry.path, search: location.search }} state={location.state}
        className={({ isActive }) => `shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold transition ${isActive ? 'border-primary bg-primary text-white' : 'border-border-color text-text-secondary hover:border-primary hover:text-text-primary'}`}>
        {entry.label}
      </NavLink>)}
    </nav>
    <Suspense fallback={<PageLoader />}>
      {section === 'authorized-apps' ? <NavigationGuard pageId="authorized-apps"><OAuthApplications /></NavigationGuard> : <OAuthManagement />}
    </Suspense>
  </div>;
}
