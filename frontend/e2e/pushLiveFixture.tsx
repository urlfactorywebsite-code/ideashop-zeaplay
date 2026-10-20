// Isolated browser verification fixture; never imported by the application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import Settings from '../pages/Settings';
import '../index.css';

function Fixture() {
  const { user, logout } = useAuth();
  if (!user) return <p role="status">Signed out of the audit session.</p>;
  return <main className="mx-auto max-w-6xl p-3 sm:p-6">
    <button type="button" onClick={logout}>Sign out of audit session</button>
    <Settings />
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <HashRouter><ThemeProvider><AuthProvider><Fixture /></AuthProvider></ThemeProvider></HashRouter>,
);
