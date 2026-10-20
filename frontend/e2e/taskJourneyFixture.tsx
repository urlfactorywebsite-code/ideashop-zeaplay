// Loaded only by the local browser test route, never by the application entry.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import TaskJourneyModal from '../components/TaskJourneyModal';
import TaskDetailModal from '../components/TaskDetailModal';
import { ToastProvider } from '../hooks/useToast';
import { ActiveWorkProvider } from '../hooks/useActiveWork';
import { UserStatus, Role, type User } from '../types';

const reviewer = { id: 'reviewer', name: 'Asha Reviewer', tenantId: 'tenant-a', role: Role.OWNER,
  email: 'asha@example.test', status: UserStatus.ACTIVE, points: 0, overallXpPoints: 0, claimedXpPoints: 0,
  department: 'Engineering', unlockedAchievementIds: [], tasksCreated: 0, tasksCompleted: 0,
  clarityScores: [], claimedRewardIds: [] } as User;
const worker = { ...reviewer, id: 'worker', name: 'Dev Kumar', role: Role.USER };

declare global {
  interface Window {
    journeyFixture: { setTask: (id: string) => void; switchTenant: () => void; close: () => void; logout: () => void };
  }
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [taskId, setTask] = useState('task-a');
  const { updateUserInContext, logout } = useAuth();
  useEffect(() => {
    window.journeyFixture = { setTask, close: () => setOpen(false), logout,
      switchTenant: () => updateUserInContext({ ...reviewer, id: 'reviewer-b', tenantId: 'tenant-b' }) };
  }, [updateUserInContext, logout]);
  const users = new Map([[reviewer.id, reviewer], [worker.id, worker]]);
  if (new URLSearchParams(location.search).has('details')) return <ToastProvider>
    <ActiveWorkProvider><TaskDetailModal taskId={taskId} isOpen onClose={() => {}} usersMap={users} /></ActiveWorkProvider>
  </ToastProvider>;
  return <><button id="open-journey" onClick={() => setOpen(true)}>Open journey</button>
    {open && <TaskJourneyModal taskId={taskId} usersMap={users} onClose={() => setOpen(false)} />}</>;
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><Fixture /></AuthProvider></BrowserRouter>);
