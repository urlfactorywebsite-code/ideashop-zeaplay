// Local component integration fixture, never imported by the application entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import Clients from '../pages/Clients';
import Projects from '../pages/Projects';

const kind = new URLSearchParams(location.search).get('module');
function Fixture() {
  const { user } = useAuth();
  if (!user) return <p>Waiting for the synthetic authenticated session.</p>;
  return <><output hidden id="fixture-identity" data-role={user?.role} data-user={user?.id} />
    {kind === 'projects' ? <Projects /> : <Clients />}</>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider>
  <Fixture />
</AuthProvider></BrowserRouter>);
