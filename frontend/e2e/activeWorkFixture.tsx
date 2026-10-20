// Local component harness; never imported by the application entry.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import ActiveWork, { WorkTimerControls } from '../components/ActiveWork';

function Fixture() {
  const { user } = useAuth();
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const target = window as Window & { hideWorkFixture?: () => void };
    target.hideWorkFixture = () => setShown(false);
    return () => { delete target.hideWorkFixture; };
  }, []);
  if (!user || !shown) return null;
  return <ActiveWorkProvider><header style={{ display: 'flex', justifyContent: 'space-between', padding: 16 }}><span>Zea.Play</span><ActiveWork onOpenTask={id => { document.body.dataset.openedTask = id; }} /></header>
    <main><h1>Subtask details</h1>{Array.from({ length: 6 }, (_, i) => <section key={i}><h2>Subtask {i + 1}</h2><WorkTimerControls subtaskId={`sub-${i + 1}`} /></section>)}</main>
  </ActiveWorkProvider>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><Fixture /></AuthProvider></BrowserRouter>);
