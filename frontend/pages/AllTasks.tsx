import React, { Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CalendarDays, ChartGantt, Columns3, ListTodo } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '../hooks/useNavigation';
import { TaskFiltersProvider, TaskViewActive } from '../hooks/useTaskView';
import { invalidateTaskCaches } from '../hooks/useTaskCache';
import { TASK_SECTIONS, taskSectionForPath, legacyTaskDetailSearch } from '../utils/taskNavigation';
import { TASK_REALTIME_EVENT, type TaskRealtimeNotice } from '../services/taskRealtimeEvents';
import NavigationGuard from '../components/NavigationGuard';
import PageTabs from '../components/PageTabs';
import PageLoader from '../components/loading/PageLoader';
import NotFound from './NotFound';

const views = {
  list: React.lazy(() => import('./Tasks')),
  kanban: React.lazy(() => import('./KanbanBoard')),
  gantt: React.lazy(() => import('./GanttView')),
  calendar: React.lazy(() => import('./CalendarView')),
};
const icons = { list: ListTodo, kanban: Columns3, gantt: ChartGantt, calendar: CalendarDays };

function TaskPanels() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const active = taskSectionForPath(location.pathname);
  const [visited, setVisited] = useState<string[]>([]);
  // The legacy list cache has no account key. Clear before child fetch effects
  // can read it when entering this module under a new authenticated identity.
  useLayoutEffect(() => { invalidateTaskCaches(); }, [user?.tenantId, user?.id, user?.role]);
  useEffect(() => {
    if (active) setVisited(previous => previous.includes(active.key) ? previous : [...previous, active.key]);
  }, [active?.key]);
  useEffect(() => {
    let timer: number | undefined;
    const changed = (event: Event) => {
      const notice = (event as CustomEvent<TaskRealtimeNotice>).detail;
      if (notice?.userId !== user?.id || notice.tenantId !== (user?.tenantId ?? null)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['tasks'] }), 250);
    };
    window.addEventListener(TASK_REALTIME_EVENT, changed);
    return () => { window.clearTimeout(timer); window.removeEventListener(TASK_REALTIME_EVENT, changed); };
  }, [queryClient, user?.id, user?.tenantId]);
  const visible = navigation.decorate(TASK_SECTIONS.map(section => ({ ...section, icon: icons[section.key] })));
  return <div className="tasks-hub min-w-0 space-y-6 pb-8">
    <header className="rounded-2xl border border-border-color bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-primary/10 p-3 text-primary"><ListTodo className="h-7 w-7" aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="text-2xl font-bold text-text-primary">All Tasks</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage tasks, track progress, visualize workflows, and plan schedules.</p></div>
      </div>
      <PageTabs tabs={visible} active={active?.key || ''} scope="tasks" label="Task views" />
    </header>
    {!active ? <NotFound /> : <NavigationGuard pageId={active.pageId}>
      {TASK_SECTIONS.map(section => {
        const access = navigation.page(section.pageId)?.access;
        if (!['allowed', 'hidden'].includes(access || '') || (!visited.includes(section.key) && active.key !== section.key)) return null;
        const View = views[section.key];
        const selected = active.key === section.key;
        return <div key={section.key} hidden={!selected} role="tabpanel" id={`tasks-panel-${section.key}`}
          aria-labelledby={visible.some(tab => tab.key === section.key) ? `tasks-tab-${section.key}` : undefined}
          aria-label={visible.some(tab => tab.key === section.key) ? undefined : section.label} className="min-w-0">
          <TaskViewActive.Provider value={selected}><Suspense fallback={<PageLoader />}><View /></Suspense></TaskViewActive.Provider>
        </div>;
      })}
    </NavigationGuard>}
  </div>;
}

export default function AllTasks() {
  const { user } = useAuth();
  const location = useLocation();
  const detailSearch = legacyTaskDetailSearch(location.pathname, location.search);
  if (detailSearch !== undefined) return <Navigate to={{ pathname: '/tasks', search: detailSearch }} replace state={location.state} />;
  return <TaskFiltersProvider><TaskPanels key={`${user?.tenantId}:${user?.id}:${user?.role}`} /></TaskFiltersProvider>;
}
