import React, { Suspense } from 'react';
import { NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useNavigation } from '../hooks/useNavigation';
import PageLoader from '../components/loading/PageLoader';
import SettingsRedirect from '../components/SettingsRedirect';
import NotFound from './NotFound';
import type { SettingsApiSection } from '../utils/settingsNavigation';

const ApiOverview = React.lazy(() => import('./ApiOverview'));
const SmtpManagement = React.lazy(() => import('../components/SmtpManagement'));

export default function SettingsApi() {
  const navigation = useNavigation();
  const { apiSection } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const sections = navigation.configuration?.apiSections || [];
  const eligible = sections.filter(section => section.access === 'allowed' || section.access === 'hidden');
  const visible = sections.filter(section => section.access === 'allowed');
  const defaultSection = eligible.find(entry => entry.key === 'overview') ?? eligible[0];
  if (!apiSection) return <SettingsRedirect to={`/settings/api/${defaultSection?.key ?? 'overview'}`} />;
  const section = sections.find(entry => entry.key === apiSection);
  if (!section) return <NotFound />;
  if (!['allowed', 'hidden'].includes(section.access)) return <Navigate to="/navigation-unavailable" replace state={{ access: section.access, pageId: 'settings.api' }} />;
  return <>
    <div className="min-w-0 space-y-5">
      <nav aria-label="API settings" className="flex gap-2 overflow-x-auto pb-2">
        {visible.map(entry => <NavLink key={entry.key}
          to={{ pathname: `/settings/api/${entry.key}`, search: location.search }} state={location.state}
          className={({ isActive }) => `shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold transition ${isActive ? 'border-primary bg-primary text-white' : 'border-border-color text-text-secondary hover:border-primary hover:text-text-primary'}`}>
          {entry.label}
        </NavLink>)}
      </nav>
      <Suspense fallback={<PageLoader />}>
        {navigation.configuration?.actorRole === 'owner'
          ? <ApiOverview section={section.key as SettingsApiSection} onSectionChange={next => navigate({ pathname: `/settings/api/${next}`, search: location.search }, { state: location.state })} hideTabs />
          : <SmtpManagement />}
      </Suspense>
    </div>
  </>;
}
