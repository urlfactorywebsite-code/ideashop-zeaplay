import { NavigationProvider } from '../hooks/useNavigation';
// Synthetic browser harness; not imported by the application.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, ThemeProvider } from '../hooks/useAuth';
import Sidebar from '../components/Sidebar';

function Fixture() {
  const [collapsed, setCollapsed] = useState(false);
  return <div style={{ height: '100dvh' }}><Sidebar isCollapsed={collapsed} onToggleCollapse={() => setCollapsed(value => !value)} onVersionClick={() => {}} /></div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><ThemeProvider><AuthProvider><NavigationProvider><Fixture /></NavigationProvider></AuthProvider></ThemeProvider></BrowserRouter>);
