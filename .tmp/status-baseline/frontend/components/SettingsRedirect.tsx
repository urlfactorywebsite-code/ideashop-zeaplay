import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { settingsLanding } from '../utils/settingsNavigation';

export default function SettingsRedirect({ to }: { to?: string }) {
  const location = useLocation();
  const target = to ? { pathname: to, search: location.search } : settingsLanding(location.search);
  return <Navigate to={target} state={location.state} replace />;
}
