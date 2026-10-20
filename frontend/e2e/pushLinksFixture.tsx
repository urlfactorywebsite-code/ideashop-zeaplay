// Local integration fixture: actual navigation shell and detail components.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, useLocation } from 'react-router-dom';
import { AuthProvider, ThemeProvider, SearchProvider, useAuth } from '../hooks/useAuth';
import { LoadingProvider } from '../components/loading/LoadingProvider';
import Layout from '../components/Layout';
import TicketPage from '../pages/TicketPage';
import '../index.css';

function Fixture() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <p>Waiting for synthetic authentication.</p>;
  return <Layout>{location.pathname === '/tickets' ? <TicketPage /> : <p>Task notification destination</p>}</Layout>;
}

createRoot(document.getElementById('root')!).render(
  <HashRouter><ThemeProvider><LoadingProvider><AuthProvider><SearchProvider>
    <Fixture />
  </SearchProvider></AuthProvider></LoadingProvider></ThemeProvider></HashRouter>,
);
