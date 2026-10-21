import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Building2, UsersRound } from 'lucide-react';
import { useNavigation } from '../hooks/useNavigation';
import NavigationGuard from '../components/NavigationGuard';
import SettingsRedirect from '../components/SettingsRedirect';
import PageTabs from '../components/PageTabs';
import PageLoader from '../components/loading/PageLoader';
import NotFound from './NotFound';

const Users = React.lazy(() => import('./Users'));
const Clients = React.lazy(() => import('./Clients'));
const sections = [
  { key: 'users', label: 'Users Management', to: '/management/users', icon: UsersRound },
  { key: 'clients', label: 'Clients', to: '/management/clients', icon: Building2 },
];

export default function Management() {
  const navigation = useNavigation();
  const active = useLocation().pathname.split('/')[2] || '';
  const visible = navigation.decorate(sections);
  const landing = visible[0] || sections.find(section => navigation.page(section.key)?.access === 'hidden');
  return <div className="management-hub min-w-0 space-y-6 pb-8">
    <header className="rounded-2xl border border-border-color bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-primary/10 p-3 text-primary"><UsersRound className="h-7 w-7" aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="text-2xl font-bold text-text-primary">Management</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage users, clients, and organizational information.</p>
        </div>
      </div>
      <PageTabs tabs={visible} active={active} scope="management" label="Management sections" />
    </header>
    <div role="tabpanel" id={`management-panel-${active}`} aria-labelledby={`management-tab-${active}`} className="min-w-0">
      <Suspense fallback={<PageLoader />}><Routes>
        <Route index element={landing ? <SettingsRedirect to={landing.to} /> : <Navigate to="/navigation-unavailable" replace state={{ access: 'forbidden', pageId: 'management' }} />} />
        <Route path="users" element={<NavigationGuard pageId="users"><Users /></NavigationGuard>} />
        <Route path="clients" element={<NavigationGuard pageId="clients"><Clients /></NavigationGuard>} />
        <Route path="*" element={<NotFound />} />
      </Routes></Suspense>
    </div>
  </div>;
}
