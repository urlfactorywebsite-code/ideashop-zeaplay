import { NavigationProvider } from '../hooks/useNavigation';
// Local browser integration fixture; never imported by the application entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import Settings from '../pages/Settings';
import SettingsRedirect from '../components/SettingsRedirect';
import '../index.css';

function Fixture() {
  const { user } = useAuth();
  if (!user) return <p>Waiting for the synthetic authenticated session.</p>;
  return <main className="mx-auto max-w-6xl p-3 sm:p-6"><Routes><Route path="/settings/*" element={<Settings />} /><Route path="*" element={<SettingsRedirect />} /></Routes></main>;
}

createRoot(document.getElementById('root')!).render(
  <HashRouter><ThemeProvider><AuthProvider><NavigationProvider><Fixture /></NavigationProvider></AuthProvider></ThemeProvider></HashRouter>,
);
