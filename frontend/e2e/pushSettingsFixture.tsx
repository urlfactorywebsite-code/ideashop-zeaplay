// Local browser integration fixture; never imported by the application entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider, ThemeProvider, useAuth } from '../hooks/useAuth';
import Settings from '../pages/Settings';
import '../index.css';

function Fixture() {
  const { user } = useAuth();
  if (!user) return <p>Waiting for the synthetic authenticated session.</p>;
  return <main className="mx-auto max-w-6xl p-3 sm:p-6"><Settings /></main>;
}

createRoot(document.getElementById('root')!).render(
  <HashRouter><ThemeProvider><AuthProvider><Fixture /></AuthProvider></ThemeProvider></HashRouter>,
);
