import { NavigationProvider } from '../hooks/useNavigation';
// Isolated browser verification fixture; never imported by the application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import Settings from '../pages/Settings';
import SettingsRedirect from '../components/SettingsRedirect';
import '../index.css';

function Fixture() {
  const { user, logout } = useAuth();
  if (!user) return <p role="status">Signed out of the audit session.</p>;
  return <main className="mx-auto max-w-6xl p-3 sm:p-6">
    <button type="button" onClick={logout}>Sign out of audit session</button>
    <Routes><Route path="/settings/*" element={<Settings />} /><Route path="*" element={<SettingsRedirect />} /></Routes>
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <HashRouter><ThemeProvider><AuthProvider><NavigationProvider><Fixture /></NavigationProvider></AuthProvider></ThemeProvider></HashRouter>,
);
