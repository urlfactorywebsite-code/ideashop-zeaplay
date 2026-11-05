import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { pageIdForPath, useNavigation } from '../hooks/useNavigation';
import PageLoader from './loading/PageLoader';

export default function NavigationGuard({ children, pageId }: { children: React.ReactNode; pageId?: string }) {
  const location = useLocation();
  const { configuration, error, revalidate, page } = useNavigation();
  const id = pageId || pageIdForPath(location.pathname, location.search);
  if (!id) return <>{children}</>;
  if (error) return <div role="alert" className="rounded-xl border border-border-color bg-surface p-6"><p>{error}</p><button onClick={() => void revalidate()} className="mt-3 text-primary">Retry navigation</button></div>;
  if (!configuration) return <PageLoader />;
  const access = page(id)?.access;
  if (access === 'allowed' || access === 'hidden') return <>{children}</>;
  return <Navigate to="/navigation-unavailable" replace state={{ access, pageId: id }} />;
}

export function NavigationUnavailable() {
  const { state } = useLocation();
  const access = state?.access;
  return <section role="alert" className="rounded-xl border border-border-color bg-surface p-6">
    <h2 className="text-xl font-semibold">{access === 'disabled' ? 'Module disabled' : 'Access forbidden'}</h2>
    <p className="mt-2 text-text-secondary">{access === 'disabled' ? 'This module is disabled for this workspace. Its data has been preserved.' : 'Your role is not permitted to access this page.'}</p>
    <Link className="mt-4 inline-block text-primary" to="/settings/profile">Go to General / Profile</Link>
  </section>;
}
