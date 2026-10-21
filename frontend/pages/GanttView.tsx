import Avatar from '../components/Avatar';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Task, User, TaskStatus } from '../types';
import { useAuth } from '../hooks/useAuth';
import api from '../services/mockApi';
import { formatDate, formatTaskStatus } from '../utils';
import PageLoader from '../components/loading/PageLoader';

/**
 * Gamified Gantt Raid Map — Full Page Redesign
 * -------------------------------------------------
 * - Neon grid background with parallax stars
 * - Gamified stat cards (Total/Active/Winrate/XP)
 * - Filter chips with pill UI
 * - Avatar stack for assignees (initials)
 * - Overhauled timeline bars with rarity frames, glow + progress
 * - Sticky header + mini legend footer
 * - Keyboard shortcuts: r = reset filters
 */

type RangeFilter = '30' | '60' | '90' | 'ALL';
type StatusFilter = TaskStatus | 'ALL';

type StatusTheme = {
  title: string;
  gradient: string;
  glow: string;
  accent: string;
  ring: string; // for rarity frame
};

const UNASSIGNED_FILTER_VALUE = '__UNASSIGNED__';

const statusThemes: Record<TaskStatus, StatusTheme> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: {
    title: 'Battle Plan',
    gradient: 'bg-gradient-to-r from-slate-800/80 via-indigo-700/80 to-slate-900/70',
    glow: 'shadow-[0_18px_55px_rgba(99,102,241,0.45)]',
    accent: 'bg-indigo-300',
    ring: 'ring-1 ring-indigo-300/60',
  },
  [TaskStatus.TODO]: {
    title: 'Case Filed',
    gradient: 'bg-gradient-to-r from-sky-700/80 via-sky-500/70 to-cyan-500/70',
    glow: 'shadow-[0_18px_55px_rgba(56,189,248,0.45)]',
    accent: 'bg-sky-300',
    ring: 'ring-1 ring-sky-300/60',
  },
  [TaskStatus.IN_PROGRESS]: {
    title: 'In Progress',
    gradient: 'bg-gradient-to-r from-purple-700/80 via-fuchsia-600/80 to-rose-600/70',
    glow: 'shadow-[0_18px_55px_rgba(232,121,249,0.55)]',
    accent: 'bg-purple-300',
    ring: 'ring-1 ring-fuchsia-300/60',
  },
  [TaskStatus.BUG_FIXING]: {
    title: 'Bug Fixing',
    gradient: 'bg-gradient-to-r from-rose-600/80 via-red-600/80 to-orange-500/80',
    glow: 'shadow-[0_18px_55px_rgba(248,113,113,0.55)]',
    accent: 'bg-rose-300',
    ring: 'ring-1 ring-rose-300/60',
  },
  [TaskStatus.IN_REVIEW]: {
    title: 'Tactical Shift',
    gradient: 'bg-gradient-to-r from-emerald-600/80 via-teal-500/80 to-sky-500/80',
    glow: 'shadow-[0_18px_55px_rgba(16,185,129,0.45)]',
    accent: 'bg-emerald-300',
    ring: 'ring-1 ring-emerald-300/60',
  },
  [TaskStatus.BLOCKED]: {
    title: 'Boss Encounter',
    gradient: 'bg-gradient-to-r from-rose-600/80 via-red-600/80 to-orange-500/80',
    glow: 'shadow-[0_18px_55px_rgba(248,113,113,0.55)]',
    accent: 'bg-rose-300',
    ring: 'ring-1 ring-rose-300/60',
  },
  [TaskStatus.ON_HOLD]: {
    title: 'On Hold',
    gradient: 'bg-gradient-to-r from-slate-700/80 via-slate-600/80 to-slate-800/80',
    glow: 'shadow-[0_18px_55px_rgba(148,163,184,0.45)]',
    accent: 'bg-slate-300',
    ring: 'ring-1 ring-slate-300/60',
  },
  [TaskStatus.DONE]: {
    title: 'Conquered',
    gradient: 'bg-gradient-to-r from-emerald-500/80 via-lime-500/80 to-amber-400/70',
    glow: 'shadow-[0_18px_55px_rgba(134,239,172,0.55)]',
    accent: 'bg-lime-300',
    ring: 'ring-1 ring-amber-300/70',
  },
  [TaskStatus.DEPLOYED]: {
    title: 'Deployed',
    gradient: 'bg-gradient-to-r from-teal-500/80 via-emerald-500/80 to-lime-400/70',
    glow: 'shadow-[0_18px_55px_rgba(45,212,191,0.45)]',
    accent: 'bg-teal-300',
    ring: 'ring-1 ring-teal-300/60',
  },
  [TaskStatus.FAILED]: {
    title: 'Fallen',
    gradient: 'bg-gradient-to-r from-cyan-500/80 via-emerald-500/80 to-teal-500/80',
    glow: 'shadow-[0_18px_55px_rgba(45,212,191,0.45)]',
    accent: 'bg-cyan-300',
    ring: 'ring-1 ring-cyan-300/60',
  },
  [TaskStatus.GRAVEYARD]: {
    title: 'Archived',
    gradient: 'bg-gradient-to-r from-gray-700/80 via-gray-600/80 to-gray-800/80',
    glow: 'shadow-[0_18px_55px_rgba(107,114,128,0.45)]',
    accent: 'bg-gray-300',
    ring: 'ring-1 ring-gray-300/40',
  },
};

const defaultTheme: StatusTheme = {
  title: 'Quest',
  gradient: 'bg-gradient-to-r from-slate-700/80 via-slate-600/80 to-slate-800/80',
  glow: 'shadow-[0_18px_55px_rgba(15,23,42,0.45)]',
  accent: 'bg-slate-300',
  ring: 'ring-1 ring-slate-300/40',
};

const completedStatuses = new Set<TaskStatus>([TaskStatus.DONE, TaskStatus.DEPLOYED]);
const activeStatuses = new Set<TaskStatus>([
  TaskStatus.WAITING_FOR_REQUIREMENT,
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BUG_FIXING,
  TaskStatus.IN_REVIEW,
  TaskStatus.BLOCKED,
]);

const formatShortDate = (value: Date) =>
  value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const Chip: React.FC<React.PropsWithChildren<{ active?: boolean; onClick?: () => void }>> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      'rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition',
      active ? 'border-emerald-400/70 bg-emerald-400/15 text-emerald-100' : 'border-white/15 bg-black/20 text-white/80 hover:border-white/30',
    ].join(' ')}
  >
    {children}
  </button>
);

const StatCard: React.FC<{ label: string; value: string; hint?: string; classes: string }>
  = ({ label, value, hint, classes }) => (
  <div className={`rounded-3xl border border-white/10 p-4 text-white shadow-[0_25px_65px_rgba(15,23,42,0.35)] ${classes}`}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/70">{label}</p>
    <p className="mt-2 text-3xl font-bold">{value}</p>
    {hint && <p className="mt-3 text-xs text-white/80">{hint}</p>}
  </div>
);

const PaginationBar: React.FC<{
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}> = ({ currentPage, totalPages, pageSize, onPrev, onNext }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/80">
    <span className="uppercase tracking-[0.25em]">20 per page</span>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={currentPage === 1}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 uppercase tracking-[0.25em] transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40 disabled:hover:border-white/15 disabled:hover:text-white/60"
      >
        Prev {currentPage > 1 ? currentPage - 1 : ''}
      </button>
      <span className="uppercase tracking-[0.3em] text-white/70">
        Page {currentPage} / {totalPages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={currentPage === totalPages}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 uppercase tracking-[0.25em] transition hover:border-emerald-400/60 hover:text-emerald-200 disabled:opacity-40 disabled:hover:border-white/15 disabled:hover:text-white/60"
      >
        Next {currentPage < totalPages ? currentPage + 1 : ''}
      </button>
    </div>
    <span className="uppercase tracking-[0.25em] text-white/50">Total {totalPages}</span>
  </div>
);

const GanttRaidMapPage: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | string>('ALL');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('60');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const { user } = useAuth();

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [fetchedTasks, allUsers] = await Promise.all([
        api.getTasks(user.id, user.role),
        api.getUsers(),
      ]);

      const sortedTasks = [...fetchedTasks].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setTasks(sortedTasks);

      const map = new Map<string, User>();
      allUsers.forEach((entry) => map.set(entry.id, entry));
      setUsersMap(map);
    } catch (error) {
      console.error('Failed to fetch Gantt data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r') handleResetFilters();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { options: assigneeOptions, hasUnassignedTasks } = useMemo(() => {
    const uniqueAssignees = new Set<string>();
    let hasUnassigned = false;

    tasks.forEach((task) => {
      if (task.assignedTo && task.assignedTo.length > 0) {
        task.assignedTo.forEach((id) => uniqueAssignees.add(id));
      } else {
        hasUnassigned = true;
      }
    });

    const options = Array.from(uniqueAssignees)
      .map((id) => ({ id, name: usersMap.get(id)?.name || 'Unknown hero' }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { options, hasUnassigned };
  }, [tasks, usersMap]);

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const rangeStart = new Date();
    if (rangeFilter !== 'ALL') rangeStart.setDate(now.getDate() - Number(rangeFilter));

    return tasks
      .filter((task) => {
        if (statusFilter !== 'ALL' && task.status !== statusFilter) return false;
        if (assigneeFilter !== 'ALL') {
          if (assigneeFilter === UNASSIGNED_FILTER_VALUE) {
            if (task.assignedTo && task.assignedTo.length > 0) return false;
          } else if (!task.assignedTo || !task.assignedTo.includes(assigneeFilter)) return false;
        }
        if (rangeFilter !== 'ALL') {
          const comparisonDate = task.dueAt ? new Date(task.dueAt) : new Date(task.createdAt);
          if (comparisonDate < rangeStart) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [tasks, statusFilter, assigneeFilter, rangeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const displayedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, currentPage, pageSize]);

  const projectStartDate = useMemo(() => {
    if (displayedTasks.length === 0) return new Date();
    const startDates = displayedTasks.map((t) => new Date(t.createdAt).getTime());
    return new Date(Math.min(...startDates));
  }, [displayedTasks]);

  const projectEndDate = useMemo(() => {
    if (displayedTasks.length === 0) return new Date();
    const endDates = displayedTasks.map((t) => (t.dueAt ? new Date(t.dueAt).getTime() : new Date(t.createdAt).getTime()));
    return new Date(Math.max(...endDates));
  }, [displayedTasks]);

  const totalDays = useMemo(() => {
    const diffTime = projectEndDate.getTime() - projectStartDate.getTime();
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return days > 0 ? days : 1;
  }, [projectStartDate, projectEndDate]);

  const getDayOffset = useCallback((date: Date) => {
    const diffTime = date.getTime() - projectStartDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }, [projectStartDate]);

  const timelineBackgroundStyle = useMemo(() => {
    // Pixel-grid with faint scanlines for arcade feel
    const step = Math.max(1, 100 / totalDays);
    return {
      backgroundImage: [
        `repeating-linear-gradient(to right, rgba(148,163,184,0.12) 0, rgba(148,163,184,0.12) ${step}%, transparent ${step}%, transparent ${step * 2}%)`,
        'linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
      ].join(','),
      backgroundSize: `auto, 100% 22px`,
    } as React.CSSProperties;
  }, [totalDays]);

  const timelineMarkers = useMemo(() => {
    const markers: { position: number; label: string }[] = [];
    const segments = Math.min(6, totalDays);
    const interval = Math.max(1, Math.floor(totalDays / segments));

    for (let day = 0; day <= totalDays; day += interval) {
      const markerDate = new Date(projectStartDate);
      markerDate.setDate(projectStartDate.getDate() + day);
      markers.push({ position: Math.min(100, (day / totalDays) * 100), label: formatShortDate(markerDate) });
    }

    return markers;
  }, [projectStartDate, totalDays]);

  const formatAssigneeNames = useCallback((assigneeIds: string[] | null) => {
    if (!assigneeIds || assigneeIds.length === 0) return 'Unassigned hero';
    const names = assigneeIds.map((id) => usersMap.get(id)?.name).filter((n): n is string => Boolean(n));
    return names.length ? names.join(', ') : 'Unknown hero';
  }, [usersMap]);

  const todayPosition = useMemo(() => {
    const offset = getDayOffset(new Date());
    if (offset < 0 || offset > totalDays) return null;
    return (offset / totalDays) * 100;
  }, [getDayOffset, totalDays]);

  const totalQuests = displayedTasks.length;
  const completedQuests = displayedTasks.filter((t) => completedStatuses.has(t.status)).length;
  const activeQuests = displayedTasks.filter((t) => activeStatuses.has(t.status)).length;
  const upcomingQuests = displayedTasks.filter((t) => {
    const endDate = t.dueAt ? new Date(t.dueAt) : new Date(t.createdAt);
    return endDate.getTime() >= Date.now();
  }).length;
  const overallProgress = totalQuests > 0 ? Math.round((completedQuests / totalQuests) * 100) : 0;
  const xpEarned = completedQuests * 75;

  const handleResetFilters = () => {
    setStatusFilter('ALL');
    setAssigneeFilter('ALL');
    setRangeFilter('60');
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-8">
      {/* Starfield + neon corners */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-950 via-slate-950 to-emerald-950 p-6 shadow-[0_35px_80px_rgba(15,23,42,0.55)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent,rgba(16,185,129,0.05)),radial-gradient(750px_250px_at_0%_0%,rgba(59,130,246,0.08),transparent),radial-gradient(750px_250px_at_100%_100%,rgba(16,185,129,0.07),transparent)]" />

        {/* Header */}
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Gantt Raid Map</h1>
            <p className="mt-1 text-sm text-white/70">Track quests, monitor party progress, and line up the next victory run.</p>
          </div>

          {/* Filters as chips */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <Chip active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}>All Lanes</Chip>
              {Object.values(TaskStatus).map((s) => (
                <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {formatTaskStatus(s)}
                </Chip>
              ))}
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div className="flex gap-2">
              <Chip active={assigneeFilter === 'ALL'} onClick={() => setAssigneeFilter('ALL')}>All Champs</Chip>
              {hasUnassignedTasks && (
                <Chip active={assigneeFilter === UNASSIGNED_FILTER_VALUE} onClick={() => setAssigneeFilter(UNASSIGNED_FILTER_VALUE)}>Unassigned</Chip>
              )}
              {assigneeOptions.map((a) => (
                <Chip key={a.id} active={assigneeFilter === a.id} onClick={() => setAssigneeFilter(a.id)}>
                  {a.name}
                </Chip>
              ))}
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div className="flex gap-2">
              {(['30','60','90','ALL'] as RangeFilter[]).map((r) => (
                <Chip key={r} active={rangeFilter === r} onClick={() => setRangeFilter(r)}>
                  {r === 'ALL' ? 'All Time' : `${r}d`}
                </Chip>
              ))}
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="ml-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-white hover:border-emerald-400/60 hover:text-emerald-200"
              title="Press R to reset"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="relative z-10 mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total quests" value={`${totalQuests}`} hint="All missions visible in the current view." classes="from-emerald-500/20 via-emerald-400/10 to-sky-500/10 bg-gradient-to-br" />
          <StatCard label="Active raids" value={`${activeQuests}`} hint="Currently in motion across the board." classes="from-sky-500/20 via-indigo-500/20 to-purple-500/20 bg-gradient-to-br" />
          <StatCard label="Victory rate" value={`${overallProgress}%`} hint="Completion ratio for the visible timeline." classes="from-amber-500/20 via-orange-500/15 to-rose-500/20 bg-gradient-to-br" />
          <StatCard label="Loot earned" value={`${xpEarned} XP`} hint={`~${upcomingQuests} quests upcoming`} classes="from-fuchsia-500/20 via-violet-500/20 to-indigo-500/20 bg-gradient-to-br" />
        </div>

        {/* Timeline */}
        <div className="relative z-10 mt-6 space-y-4 rounded-2xl border border-white/10 bg-black/20 p-3 backdrop-blur">
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPrev={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          />
          {displayedTasks.length > 0 ? (
            <div className="min-w-[980px] space-y-4">
              {/* Columns header */}
              <div className="grid grid-cols-[280px,1fr] sticky top-4 z-20 rounded-xl bg-black/40 backdrop-blur">
                <div className="p-3 text-[10px] font-semibold uppercase tracking-[0.35em] text-white/80">Quest</div>
                <div className="p-3 text-[10px] font-semibold uppercase tracking-[0.35em] text-white/80">Timeline</div>
              </div>

              <div className="grid grid-cols-[280px,1fr] gap-0">
                {/* Left labels */}
                <div className="rounded-xl rounded-tr-none rounded-br-none border border-white/10 bg-black/30">
                  {displayedTasks.map((task) => (
                    <div key={`label-${task.id}`} className="border-b border-white/5 p-3 text-sm text-white/90 last:border-b-0" title={task.title}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{task.title}</div>
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-white/60">
                            {/* Avatar stack */}
                            <div className="-space-x-2 rtl:space-x-reverse">
                              {(task.assignedTo && task.assignedTo.length ? task.assignedTo : []).slice(0,3).map((id) => (
                                <span key={id} className="inline-block">
                                  <Avatar user={usersMap.get(id) ?? { id }} size={24} />
                                </span>
                              ))}
                            </div>
                            <span className="truncate">{formatAssigneeNames(task.assignedTo)}</span>
                          </div>
                        </div>
                        <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white/70">
                          {formatTaskStatus(task.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Right timeline */}
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <div className="pointer-events-none absolute inset-0 opacity-90" style={timelineBackgroundStyle} />
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.07),transparent_60%)]" />

                  {/* Today marker */}
                  {todayPosition !== null && (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-px translate-x-[-50%] bg-amber-300/80 shadow-[0_0_18px_rgba(251,191,36,0.75)]"
                      style={{ left: `${todayPosition}%` }}
                    >
                      <div className="absolute -top-6 left-1/2 w-max -translate-x-1/2 rounded-full border border-amber-200/60 bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.35em] text-amber-100">
                        Today
                      </div>
                    </div>
                  )}

                  {/* Markers */}
                  {timelineMarkers.map((marker, i) => (
                    <div key={`marker-${i}`} className="pointer-events-none absolute top-0 bottom-0 border-l border-white/10" style={{ left: `${marker.position}%` }}>
                      <span className="absolute -top-6 left-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">{marker.label}</span>
                    </div>
                  ))}

                  {/* Bars */}
                  <div className="relative">
                    {displayedTasks.map((task) => {
                      const startDate = new Date(task.createdAt);
                      const endDate = task.dueAt ? new Date(task.dueAt) : new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
                      const startOffset = getDayOffset(startDate);
                      const duration = Math.max(1, Math.ceil(Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                      const left = Math.max(0, (startOffset / totalDays) * 100);
                      const width = Math.max(3, (duration / totalDays) * 100);
                      const maxWidth = 100 - left;
                      const clampedWidth = Math.min(width, maxWidth);

                      const theme = statusThemes[task.status] || defaultTheme;
                      const assigneeNames = formatAssigneeNames(task.assignedTo);
                      const totalSubtasks = task.subtasks?.length || 0;
                      const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;
                      const progress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : (completedStatuses.has(task.status) ? 100 : 0);

                      return (
                        <div key={task.id} className="flex h-[80px] items-center border-b border-white/5 px-3 last:border-b-0">
                          <div
                            className={`relative z-10 w-full max-w-full rounded-2xl border border-white/15 ${theme.gradient} ${theme.glow} ${theme.ring}`}
                            style={{ marginLeft: `${left}%`, width: `${clampedWidth}%` }}
                            title={`${task.title}\n${theme.title} | ${formatTaskStatus(task.status)}\nAssigned: ${assigneeNames}\nStart: ${formatDate(task.createdAt)}\nDue: ${formatDate(task.dueAt)}`}
                          >
                            {/* Rarity shine */}
                            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(120%_60%_at_10%_-10%,rgba(255,255,255,0.18),transparent_35%),radial-gradient(80%_80%_at_100%_120%,rgba(255,255,255,0.12),transparent_40%)]" />

                            <div className="relative z-10 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-bold tracking-wide text-white/95">{task.title}</div>
                                  <div className="mt-0.5 truncate text-[11px] text-white/80">{assigneeNames}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="whitespace-nowrap rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white/70">{theme.title}</span>
                                  <span className="whitespace-nowrap text-[11px] text-white/80">{task.dueAt ? `Due ${formatShortDate(new Date(task.dueAt))}` : 'Due TBD'}</span>
                                </div>
                              </div>
                              {/* Progress */}
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                                <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
                              </div>
                            </div>

                            {/* End cap gem */}
                            <div className="pointer-events-none absolute right-1 top-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
                              {progress}%
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-white">
              <h3 className="text-lg font-semibold">No quests match the current filters.</h3>
              <p className="mt-2 text-sm text-white/70">Adjust filters or assign due dates to populate this raid map.</p>
            </div>
          )}
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPrev={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          />
        </div>

        {/* Legend */}
        <div className="relative z-10 mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/80">Legend</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(statusThemes).map(([status, theme]) => (
              <div key={status} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/90">
                <span className={`h-2.5 w-2.5 rounded-full ${theme.accent}`} />
                <span className="font-semibold">{theme.title}</span>
                <span className="text-white/60">({formatTaskStatus(status as TaskStatus)})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GanttRaidMapPage;

