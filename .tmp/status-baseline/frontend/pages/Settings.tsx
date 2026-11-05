import React, { Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Bell, Code2, FileText, Images, LifeBuoy, Settings as SettingsIcon, UserRound, PanelLeft, KeyRound } from 'lucide-react';
import { useNavigation } from '../hooks/useNavigation';
import { useAuth } from '../hooks/useAuth';
import NavigationGuard from '../components/NavigationGuard';
import PageLoader from '../components/loading/PageLoader';
import PageTabs from '../components/PageTabs';
import SettingsRedirect from '../components/SettingsRedirect';
import { SETTINGS_SECTIONS, settingsLanding, type SettingsSection } from '../utils/settingsNavigation';
import NotFound from './NotFound';

const ProfileSettings = React.lazy(() => import('./ProfileSettings'));
const SupportForm = React.lazy(() => import('../components/SupportFormModal'));
const SettingsOAuth = React.lazy(() => import('./SettingsOAuth'));
const SettingsApi = React.lazy(() => import('./SettingsApi'));
const Logs = React.lazy(() => import('./Logs'));
const MediaLibrary = React.lazy(() => import('./MediaLibrary'));
const PushNotifications = React.lazy(() => import('../components/SettingsNotificationsPanel'));
const SidebarManagement = React.lazy(() => import('./SidebarManagement'));

const icons = { profile: UserRound, support: LifeBuoy, api: Code2, oauth: KeyRound,
  logs: FileText, 'media-library': Images, push: Bell, 'sidebar-management': PanelLeft };

function SectionContent({ section }: { section: SettingsSection }) {
  const { user } = useAuth();
  switch (section) {
    case 'profile': return null;
    case 'support': return <SupportForm isOpen embedded onClose={() => {}} />;
    case 'api': return <SettingsApi />;
    case 'oauth': return <SettingsOAuth />;
    case 'logs': return <Logs />;
    case 'media-library': return <MediaLibrary />;
    case 'push': return <PushNotifications key={`${user?.tenantId}:${user?.id}`} />;
    case 'sidebar-management': return <SidebarManagement />;
  }
}

export default function Settings() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const location = useLocation();
  const active = location.pathname.split('/')[2] || settingsLanding(location.search).pathname.split('/')[2];
  const identity = `${user?.tenantId}:${user?.id}`;
  const [profileIdentity, setProfileIdentity] = useState<string | null>(null);
  useEffect(() => { if (active === 'profile') setProfileIdentity(identity); }, [active, identity]);
  const sectionPath = (key: string) => `/settings/${key}`;
  const visible = navigation.decorate(SETTINGS_SECTIONS.map(section => ({ ...section, to: sectionPath(section.key) })));
  return <div className="settings-hub min-w-0 space-y-6 pb-8">
    <header className="rounded-2xl border border-border-color bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-primary/10 p-3 text-primary"><SettingsIcon className="h-7 w-7" aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage your profile, application configuration, integrations, support, and administrative controls.</p>
        </div>
      </div>
      <PageTabs tabs={visible.map(section => ({ ...section, icon: icons[section.key] }))} active={active} scope="settings" label="Settings sections" />
    </header>
    <div role="tabpanel" id={`settings-panel-${active}`} aria-labelledby={`settings-tab-${active}`} className="min-w-0">
      {(profileIdentity === identity || active === 'profile') && <div hidden={active !== 'profile'}>
        <Suspense fallback={<PageLoader />}><ProfileSettings key={identity} /></Suspense>
      </div>}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<SettingsRedirect />} />
          <Route path="master-control" element={<SettingsRedirect to="/settings/profile" />} />
          <Route path="api/oauth/*" element={<SettingsRedirect to={location.pathname.replace('/settings/api/oauth', '/settings/oauth')} />} />
          {SETTINGS_SECTIONS.map(section => <Route key={section.key}
            path={section.key === 'api' ? 'api/:apiSection?/*' : section.key === 'oauth' ? 'oauth/*' : section.key}
            element={<NavigationGuard pageId={`settings.${section.key}`}><SectionContent section={section.key} /></NavigationGuard>} />)}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  </div>;
}
