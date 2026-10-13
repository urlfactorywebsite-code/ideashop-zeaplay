import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task, User, KanbanColumn } from '../types';
import { Role, TaskStatus, TaskPriority, CUSTOM_STATUS_NAMES } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskDetailModal from '../components/TaskDetailModal';
import PageLoader from '../components/loading/PageLoader';
import Tooltip from '../components/ui/Tooltip';
import { formatDate, formatTaskStatus } from '../utils';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { augmentTasksWithPoints, summarizeTaskPoints, formatPointsValue, normalizeDepartmentKey } from '../utils/taskPoints';
import { priorityPillStyle } from '../utils/themeTokens';
import {
  PlusIcon,
  RocketLaunchIcon,
  ClipboardDocumentListIcon,
  PuzzlePieceIcon,
  FireIcon,
  AcademicCapIcon,
  TrophyIcon,
  XMarkIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
} from '../components/icons';

type DragState = {
  taskId: string | null;
  sourceColumn: string | null;
};

type ThemeMode = 'light' | 'dark' | 'colorful' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful';

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
  if (theme === 'colorful') return 'colorful';
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

const useResolvedTheme = (theme: ThemeMode): ResolvedTheme => {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));
  useEffect(() => {
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => setResolved(media.matches ? 'dark' : 'light');
      listener();
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    setResolved(resolveTheme(theme));
  }, [theme]);
  return resolved;
};

type StatusDetail = {
  label: string;
  legend: string;
  stageToken: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
};

// 11 stages aligned with backend task statuses
const statusDetails: { [K in TaskStatus]: StatusDetail } = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: {
    label: 'Battle Plan',
    legend: 'New / Ready',
    stageToken: '--color-stage-battle',
    icon: RocketLaunchIcon,
  },
  [TaskStatus.TODO]: {
    label: 'Case Filed',
    legend: 'Assigned / To Do',
    stageToken: '--color-stage-case',
    icon: ClipboardDocumentListIcon,
  },
  [TaskStatus.IN_PROGRESS]: {
    label: 'In Progress',
    legend: 'In Progress',
    stageToken: '--color-stage-progress',
    icon: PuzzlePieceIcon,
  },
  [TaskStatus.BUG_FIXING]: {
    label: 'Bug Fixing',
    legend: 'Fixing defects before review',
    stageToken: '--color-stage-boss',
    icon: FireIcon,
  },
  [TaskStatus.BLOCKED]: {
    label: 'Boss Encounter',
    legend: 'Blocked / Critical',
    stageToken: '--color-stage-boss',
    icon: FireIcon,
  },
  [TaskStatus.IN_REVIEW]: {
    label: 'Tactical Shift',
    legend: 'Review / Adjust before completion',
    stageToken: '--color-stage-tactical',
    icon: AcademicCapIcon,
  },
  [TaskStatus.ON_HOLD]: {
    label: 'On Hold',
    legend: 'Paused / Waiting',
    stageToken: '--color-stage-hold',
    icon: QuestionMarkCircleIcon,
  },
  [TaskStatus.DONE]: {
    label: 'Conquered',
    legend: 'Completed – Level Rewards',
    stageToken: '--color-stage-conquered',
    icon: TrophyIcon,
  },
  [TaskStatus.DEPLOYED]: {
    label: 'Deployed',
    legend: 'Released / Live',
    stageToken: '--color-stage-conquered',
    icon: TrophyIcon,
  },
  [TaskStatus.FAILED]: {
    label: 'Fallen',
    legend: 'Mission Failed – Could not complete',
    stageToken: '--color-stage-fallen',
    icon: XMarkIcon,
  },
  [TaskStatus.GRAVEYARD]: {
    label: 'Graveyard',
    legend: 'For inactive / archived tasks',
    stageToken: '--color-stage-graveyard',
    icon: NoSymbolIcon,
  },
};

type KanbanStatusVisual = {
  accent: string;
  lightColumn: string;
  darkColumn: string;
  lightBorder: string;
  darkBorder: string;
  lightGlow: string;
  darkGlow: string;
};

const kanbanStatusVisuals: Record<TaskStatus, KanbanStatusVisual> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: {
    accent: '#7DD3FC',
    lightColumn: 'linear-gradient(180deg, rgba(240, 249, 255, 0.96), rgba(224, 242, 254, 0.9))',
    darkColumn: 'linear-gradient(180deg, rgba(15, 35, 56, 0.86), rgba(11, 18, 32, 0.92))',
    lightBorder: 'rgba(125, 211, 252, 0.45)',
    darkBorder: 'rgba(125, 211, 252, 0.24)',
    lightGlow: '0 18px 42px rgba(125, 211, 252, 0.2)',
    darkGlow: '0 18px 42px rgba(14, 165, 233, 0.15)',
  },
  [TaskStatus.TODO]: {
    accent: '#93C5FD',
    lightColumn: 'linear-gradient(180deg, rgba(239, 246, 255, 0.96), rgba(224, 231, 255, 0.88))',
    darkColumn: 'linear-gradient(180deg, rgba(30, 41, 74, 0.86), rgba(15, 23, 42, 0.92))',
    lightBorder: 'rgba(147, 197, 253, 0.45)',
    darkBorder: 'rgba(147, 197, 253, 0.22)',
    lightGlow: '0 18px 42px rgba(147, 197, 253, 0.18)',
    darkGlow: '0 18px 42px rgba(59, 130, 246, 0.13)',
  },
  [TaskStatus.IN_PROGRESS]: {
    accent: '#818CF8',
    lightColumn: 'linear-gradient(180deg, rgba(238, 242, 255, 0.96), rgba(221, 214, 254, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(49, 46, 129, 0.7), rgba(17, 24, 39, 0.94))',
    lightBorder: 'rgba(129, 140, 248, 0.45)',
    darkBorder: 'rgba(129, 140, 248, 0.26)',
    lightGlow: '0 18px 42px rgba(129, 140, 248, 0.2)',
    darkGlow: '0 18px 42px rgba(99, 102, 241, 0.17)',
  },
  [TaskStatus.BUG_FIXING]: {
    accent: '#E11D48',
    lightColumn: 'linear-gradient(180deg, rgba(255, 241, 242, 0.96), rgba(254, 226, 226, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(88, 28, 43, 0.72), rgba(30, 18, 30, 0.94))',
    lightBorder: 'rgba(225, 29, 72, 0.43)',
    darkBorder: 'rgba(225, 29, 72, 0.24)',
    lightGlow: '0 18px 42px rgba(225, 29, 72, 0.16)',
    darkGlow: '0 18px 42px rgba(225, 29, 72, 0.13)',
  },
  [TaskStatus.BLOCKED]: {
    accent: '#F472B6',
    lightColumn: 'linear-gradient(180deg, rgba(253, 242, 248, 0.96), rgba(252, 231, 243, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(80, 28, 62, 0.76), rgba(24, 16, 32, 0.94))',
    lightBorder: 'rgba(244, 114, 182, 0.45)',
    darkBorder: 'rgba(244, 114, 182, 0.25)',
    lightGlow: '0 18px 42px rgba(244, 114, 182, 0.18)',
    darkGlow: '0 18px 42px rgba(219, 39, 119, 0.14)',
  },
  [TaskStatus.IN_REVIEW]: {
    accent: '#2DD4BF',
    lightColumn: 'linear-gradient(180deg, rgba(240, 253, 250, 0.96), rgba(204, 251, 241, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(20, 83, 75, 0.62), rgba(12, 28, 38, 0.94))',
    lightBorder: 'rgba(45, 212, 191, 0.45)',
    darkBorder: 'rgba(45, 212, 191, 0.24)',
    lightGlow: '0 18px 42px rgba(45, 212, 191, 0.18)',
    darkGlow: '0 18px 42px rgba(20, 184, 166, 0.14)',
  },
  [TaskStatus.ON_HOLD]: {
    accent: '#F59E0B',
    lightColumn: 'linear-gradient(180deg, rgba(255, 251, 235, 0.96), rgba(254, 243, 199, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(92, 58, 19, 0.62), rgba(28, 24, 18, 0.94))',
    lightBorder: 'rgba(245, 158, 11, 0.43)',
    darkBorder: 'rgba(245, 158, 11, 0.24)',
    lightGlow: '0 18px 42px rgba(245, 158, 11, 0.16)',
    darkGlow: '0 18px 42px rgba(217, 119, 6, 0.13)',
  },
  [TaskStatus.DONE]: {
    accent: '#22C55E',
    lightColumn: 'linear-gradient(180deg, rgba(236, 253, 245, 0.96), rgba(204, 251, 241, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(20, 83, 45, 0.58), rgba(11, 30, 35, 0.94))',
    lightBorder: 'rgba(34, 197, 94, 0.43)',
    darkBorder: 'rgba(34, 197, 94, 0.24)',
    lightGlow: '0 18px 42px rgba(34, 197, 94, 0.16)',
    darkGlow: '0 18px 42px rgba(20, 184, 166, 0.13)',
  },
  [TaskStatus.DEPLOYED]: {
    accent: '#14B8A6',
    lightColumn: 'linear-gradient(180deg, rgba(240, 253, 250, 0.96), rgba(204, 251, 241, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(20, 83, 75, 0.58), rgba(11, 30, 35, 0.94))',
    lightBorder: 'rgba(20, 184, 166, 0.43)',
    darkBorder: 'rgba(20, 184, 166, 0.24)',
    lightGlow: '0 18px 42px rgba(20, 184, 166, 0.16)',
    darkGlow: '0 18px 42px rgba(20, 184, 166, 0.13)',
  },
  [TaskStatus.FAILED]: {
    accent: '#F43F5E',
    lightColumn: 'linear-gradient(180deg, rgba(255, 241, 242, 0.96), rgba(255, 228, 230, 0.86))',
    darkColumn: 'linear-gradient(180deg, rgba(88, 28, 43, 0.72), rgba(30, 18, 30, 0.94))',
    lightBorder: 'rgba(244, 63, 94, 0.43)',
    darkBorder: 'rgba(244, 63, 94, 0.24)',
    lightGlow: '0 18px 42px rgba(244, 63, 94, 0.16)',
    darkGlow: '0 18px 42px rgba(225, 29, 72, 0.13)',
  },
  [TaskStatus.GRAVEYARD]: {
    accent: '#64748B',
    lightColumn: 'linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(226, 232, 240, 0.9))',
    darkColumn: 'linear-gradient(180deg, rgba(51, 65, 85, 0.6), rgba(15, 23, 42, 0.94))',
    lightBorder: 'rgba(100, 116, 139, 0.35)',
    darkBorder: 'rgba(148, 163, 184, 0.18)',
    lightGlow: '0 18px 42px rgba(100, 116, 139, 0.12)',
    darkGlow: '0 18px 42px rgba(15, 23, 42, 0.34)',
  },
};

const getKanbanStatusVisual = (status: TaskStatus) =>
  kanbanStatusVisuals[status] ?? kanbanStatusVisuals[TaskStatus.TODO];

const getKanbanColumnStyle = (status: TaskStatus, mode: ResolvedTheme): React.CSSProperties => {
  const visual = getKanbanStatusVisual(status);
  const isLight = mode === 'light';
  const isColorful = mode === 'colorful';
  if (isColorful) {
    return {
      background: `linear-gradient(180deg, color-mix(in srgb, ${visual.accent} 16%, rgba(255,255,255,0.94) 84%), rgba(255,255,255,0.76))`,
      borderColor: visual.lightBorder,
      boxShadow: `0 18px 42px color-mix(in srgb, ${visual.accent} 18%, transparent)`,
    };
  }
  return {
    background: isLight ? visual.lightColumn : visual.darkColumn,
    borderColor: isLight ? visual.lightBorder : visual.darkBorder,
    boxShadow: isLight ? visual.lightGlow : visual.darkGlow,
  };
};

const priorityVisuals: Record<TaskPriority, { border: string; background: string; color: string }> = {
  [TaskPriority.LOW]: {
    border: 'rgba(45, 212, 191, 0.56)',
    background: 'rgba(20, 184, 166, 0.14)',
    color: '#0F766E',
  },
  [TaskPriority.MEDIUM]: {
    border: 'rgba(245, 158, 11, 0.58)',
    background: 'rgba(245, 158, 11, 0.14)',
    color: '#92400E',
  },
  [TaskPriority.HIGH]: {
    border: 'rgba(249, 115, 22, 0.58)',
    background: 'rgba(249, 115, 22, 0.14)',
    color: '#C2410C',
  },
  [TaskPriority.URGENT]: {
    border: 'rgba(244, 63, 94, 0.58)',
    background: 'rgba(244, 63, 94, 0.14)',
    color: '#BE123C',
  },
};

const getPriorityBadgeStyle = (priority: TaskPriority, mode: ResolvedTheme): React.CSSProperties => {
  if (mode !== 'light' && mode !== 'colorful') {
    return priorityPillStyle(priority);
  }
  const visual = priorityVisuals[priority] ?? priorityVisuals[TaskPriority.MEDIUM];
  return {
    borderColor: visual.border,
    background: visual.background,
    color: visual.color,
  };
};

const overdueExcludedStatuses = new Set<TaskStatus>([
  TaskStatus.DONE,
  TaskStatus.DEPLOYED,
  TaskStatus.FAILED,
  TaskStatus.GRAVEYARD,
]);

const formatPriority = (value: TaskPriority) =>
  value
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const parseRangeToken = (value: string): { start: string; end: string } => {
  if (!value) {
    return { start: '', end: '' };
  }
  const [start, end] = value.split('..');
  if (!end) {
    return { start: value, end: value };
  }
  return { start, end };
};

const formatRangeLabel = (value: string): string => {
  if (!value) {
    return 'Date Range';
  }
  const { start, end } = parseRangeToken(value);
  if (!start) {
    return 'Date Range';
  }
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end || start}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Date Range';
  }
  const startLabel = startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return start === (end || start) ? startLabel : `${startLabel} - ${endLabel}`;
};

const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const KanbanTaskCard: React.FC<any> = ({ task, assignees, creator, onDragStart, onClick, onEdit, theme, user }) => {
  const isLight = theme === 'light';
  const isBright = theme === 'light' || theme === 'colorful';
  const statusVisual = getKanbanStatusVisual(task.status);
  const cardSurface = isBright
    ? 'border-slate-200/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
    : 'border-white/10 bg-[rgba(20,28,45,0.78)] shadow-[0_10px_28px_rgba(0,0,0,0.28)]';
  const cardTextPrimaryClass = isBright ? 'text-slate-950' : 'text-white';
  const cardTextMutedClass = isBright ? 'text-slate-600' : 'text-slate-200/80';
  const buttonClass = isBright
    ? 'rounded-full border bg-white/76 px-3 py-1 text-sm font-semibold text-slate-800 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-white'
    : 'rounded-full border bg-white/5 px-3 py-1 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10';

  const assigneeNames = assignees.length > 0 ? assignees.map((a: any) => a.name).join(', ') : 'Unassigned';
  const pointsSummary = task.pointsBreakdown ? summarizeTaskPoints(task.pointsBreakdown) : null;
  const showReadMore = (task.description ?? '').trim().length > 100;
  const createdByName = creator?.name ?? 'Unknown';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onClick(task.id)}
      className={`group relative overflow-hidden rounded-2xl border p-4 transition duration-200 hover:-translate-y-1 hover:shadow-xl ${cardSurface}`}
      style={{ borderColor: isBright ? statusVisual.lightBorder : statusVisual.darkBorder }}
    >
      <span
        className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: statusVisual.accent }}
      />
      <div className="flex justify-between items-start">
        <p className={`min-h-[4.5rem] font-semibold text-sm line-clamp-3 ${cardTextPrimaryClass}`}>{task.title}</p>
        <span className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold" style={getPriorityBadgeStyle(task.priority, theme)}>
          {formatPriority(task.priority)}
        </span>
      </div>
      <p className={`min-h-[2.5rem] text-xs mt-2 leading-5 line-clamp-2 break-words overflow-hidden ${cardTextMutedClass}`}>{task.description}</p>
      {showReadMore && (
        <span className="mt-1 inline-block text-xs font-semibold text-primary/80">Read more..</span>
      )}
      <div className={`mt-3 grid gap-1 text-xs ${cardTextMutedClass}`}>
        <div>Created by: {createdByName}</div>
        <div>Created at: {formatDate(task.createdAt, true)}</div>
        <div>Assigned to: {assigneeNames}</div>
        <div>Due date: {formatDate(task.dueAt)}</div>
      </div>

      {pointsSummary && (
        <div className={`mt-2 text-[11px] ${cardTextMutedClass}`}>
          {pointsSummary.label}: {formatPointsValue(pointsSummary.value)}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onClick(task.id)}
          className={`flex-1 ${buttonClass}`}
          style={{ borderColor: isBright ? 'rgba(79, 124, 255, 0.28)' : 'rgba(125, 211, 252, 0.26)' }}
        >
          View
        </button>
        {(user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
          <button
            onClick={() => onEdit(task.id)}
            className={`flex-1 ${buttonClass}`}
            style={{ borderColor: isBright ? 'rgba(245, 158, 11, 0.34)' : 'rgba(245, 158, 11, 0.32)' }}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
};

type FilterOption = {
  value: string;
  label: string;
};

const ChevronIcon: React.FC<{ open: boolean; className?: string }> = ({ open, className }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    className={`${className ?? ''} ${open ? 'rotate-180' : ''}`.trim()}
  >
    <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FilterDropdown: React.FC<{
  value: string;
  placeholder: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  buttonClassName: string;
  menuClassName: string;
  itemClassName: string;
  activeItemClassName: string;
}> = ({ value, placeholder, options, onChange, buttonClassName, menuClassName, itemClassName, activeItemClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!wrapperRef.current || wrapperRef.current.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="relative min-w-[190px]">
      <button
        type="button"
        className={`${buttonClassName} flex w-full items-center justify-between gap-3 text-left`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={value ? '' : 'opacity-80'}>{selectedLabel}</span>
        <ChevronIcon open={isOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
      </button>
      {isOpen && (
        <div className={`absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-b-[12px] border ${menuClassName}`}>
          <div className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
            {options.map((option) => {
              const isActive = option.value === value;
              return (
                <button
                  key={option.value || option.label}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`${itemClassName} ${isActive ? activeItemClassName : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const KanbanBoard: React.FC = () => {
  const queryClient = useQueryClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
  const { theme } = useTheme();
  const resolvedTheme = useResolvedTheme(theme as ThemeMode);
  const isColorful = resolvedTheme === 'colorful';
  const isLight = resolvedTheme === 'light';
  const isBrightMode = isLight || isColorful;
  const boardTextClass = isBrightMode ? 'text-slate-950' : 'text-white';
  const boardMutedTextClass = isBrightMode ? 'text-slate-600' : 'text-slate-200/75';
  const boardTextColorHex = isBrightMode ? '#0F172A' : '#FFFFFF';
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dateRangeRef = useRef<HTMLDivElement | null>(null);
  const boardDragState = useRef<{ isDragging: boolean; startX: number; scrollLeft: number }>({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
  });

  // Filtering and sorting state
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [dueDateFilter, setDueDateFilter] = useState<string>('');
  const [isDateRangeOpen, setDateRangeOpen] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<'7d' | '30d' | 'mtd' | 'ytd' | 'custom' | ''>('');
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(20);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const dateRangeLabel = useMemo(() => formatRangeLabel(dueDateFilter), [dueDateFilter]);
  const dateRangeTokens = useMemo(() => parseRangeToken(dueDateFilter), [dueDateFilter]);

  const applyDatePreset = useCallback((preset: '7d' | '30d' | 'mtd' | 'ytd') => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    if (preset === '7d') {
      start.setDate(today.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(today.getDate() - 29);
    } else if (preset === 'mtd') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      start = new Date(today.getFullYear(), 0, 1);
    }
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(today);
    setDueDateFilter(`${startIso}..${endIso}`);
    setActiveDatePreset(preset);
  }, []);

  const updateDateRange = useCallback((start: string, end: string) => {
    if (!start && !end) {
      setDueDateFilter('');
      setActiveDatePreset('');
      return;
    }

    const normalizedStart = start || end;
    const normalizedEnd = end || start;
    setDueDateFilter(
      normalizedStart === normalizedEnd ? normalizedStart : `${normalizedStart}..${normalizedEnd}`,
    );
    setActiveDatePreset('custom');
  }, []);

  const kanbanQueryParams = useMemo(() => ({
    pageSize,
    search: debouncedSearchQuery || undefined,
    priority: priorityFilter ? (priorityFilter as TaskPriority) : undefined,
    assigneeId: assigneeFilter || undefined,
    team: teamFilter || undefined,
    dueDate: dueDateFilter || undefined,
    quickFilter: quickFilter || undefined,
  }), [assigneeFilter, debouncedSearchQuery, dueDateFilter, pageSize, priorityFilter, quickFilter, teamFilter]);

  const kanbanQuery = useQuery({
    queryKey: ['tasks', 'kanban-board', kanbanQueryParams],
    queryFn: ({ signal }) => api.getTasksKanban({ ...kanbanQueryParams, signal }),
    enabled: Boolean(user),
    staleTime: 45_000,
    placeholderData: keepPreviousData,
  });

  const usersQuery = useQuery({
    queryKey: ['users', 'kanban-board'],
    queryFn: () => api.getUsers(),
    enabled: Boolean(user),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'kanban-board'],
    queryFn: () => api.getDepartments(),
    enabled: Boolean(user),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const fetchData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'kanban-board'] });
  }, [queryClient]);

  useEffect(() => {
    if (!kanbanQuery.data) return;
    const fetchedTasks = kanbanQuery.data.columns.flatMap((column) => column.items);
    setTasks(augmentTasksWithPoints(fetchedTasks));
    setColumns(kanbanQuery.data.columns.map((column) => ({
      id: column.status,
      title: column.title || statusDetails[column.status]?.label || formatTaskStatus(column.status),
      order: column.order,
      pipelineId: 'default',
    })));
  }, [kanbanQuery.data]);

  useEffect(() => {
    if (!usersQuery.data) return;
    const map = new Map<string, User>();
    usersQuery.data.forEach((entry: User) => map.set(entry.id, entry));
    setUsersMap(map);
  }, [usersQuery.data]);

  useEffect(() => {
    if (!departmentsQuery.data) return;
    const departmentNames = Array.from(
      new Set(
        (departmentsQuery.data ?? [])
          .map((dept) => dept.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    setDepartmentOptions(departmentNames);
  }, [departmentsQuery.data]);

  useEffect(() => {
    setLoading(Boolean(user) && (kanbanQuery.isLoading || usersQuery.isLoading || departmentsQuery.isLoading));
  }, [departmentsQuery.isLoading, kanbanQuery.isLoading, user, usersQuery.isLoading]);

  useEffect(() => {
    const error = kanbanQuery.error || usersQuery.error || departmentsQuery.error;
    if (error) {
      console.error('Failed to fetch Kanban data:', error);
    }
  }, [departmentsQuery.error, kanbanQuery.error, usersQuery.error]);

  useEffect(() => {
    if (!isDateRangeOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!dateRangeRef.current || dateRangeRef.current.contains(event.target as Node)) {
        return;
      }
      setDateRangeOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDateRangeOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isDateRangeOpen]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, newStatus: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus || !user) return;

    try {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
      await api.updateTask(taskId, { status: newStatus }, user.id);
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'kanban-board'] });
    } catch (err) {
      console.error('Failed to update task:', err);
      fetchData();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const handleTaskClick = (id: string) => setSelectedTaskId(id);
  const handleTaskEdit = (id: string) => setSelectedTaskId(id);

  const scrollBoard = (direction: 'left' | 'right') => {
    if (!boardRef.current) return;
    const distance = direction === 'left' ? -320 : 320;
    boardRef.current.scrollBy({ left: distance, behavior: 'smooth' });
  };

  const stopBoardDrag = () => {
    boardDragState.current.isDragging = false;
    if (boardRef.current) {
      boardRef.current.classList.remove('cursor-grabbing', 'select-none');
    }
  };

  const handleBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardRef.current) return;
    boardDragState.current.isDragging = true;
    boardDragState.current.startX = event.pageX - boardRef.current.offsetLeft;
    boardDragState.current.scrollLeft = boardRef.current.scrollLeft;
    boardRef.current.classList.add('cursor-grabbing', 'select-none');
  };

  const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardDragState.current.isDragging || !boardRef.current) return;
    event.preventDefault();
    const x = event.pageX - boardRef.current.offsetLeft;
    const walk = x - boardDragState.current.startX;
    boardRef.current.scrollLeft = boardDragState.current.scrollLeft - walk;
  };

  const handleBoardMouseUp = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  const handleBoardMouseLeave = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (!boardDragState.current.isDragging) return;
      boardDragState.current.isDragging = false;
      if (boardRef.current) {
        boardRef.current.classList.remove('cursor-grabbing', 'select-none');
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, []);
  const handleCloseModal = () => {
    setSelectedTaskId(null);
    fetchData();
  };

  const filteredTasks = useMemo(() => {
    let filtered: Task[] = tasks;

    // Apply search
    if (typeof debouncedSearchQuery === 'string' && debouncedSearchQuery.length > 0) {
      const lowercasedQuery = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter((task) => {
        const assigneeNames = (task.assignedTo ?? [])
          .map((id) => usersMap.get(id)?.name?.toLowerCase() || '')
          .filter((name) => name !== '');
        const matchesAssignee = assigneeNames.some(name => name.includes(lowercasedQuery));
        return (
          task.title.toLowerCase().includes(lowercasedQuery) ||
          task.description.toLowerCase().includes(lowercasedQuery) ||
          task.team.toLowerCase().includes(lowercasedQuery) ||
          matchesAssignee ||
          (task.tags && task.tags.some(tag => tag.toLowerCase().includes(lowercasedQuery)))
        );
      });
    }

    // Apply filters
    if (statusFilter) {
      filtered = filtered.filter((task) => task.status === statusFilter as TaskStatus);
    }
    if (priorityFilter) {
      filtered = filtered.filter((task) => task.priority === priorityFilter as TaskPriority);
    }
    if (assigneeFilter) {
      filtered = filtered.filter((task) => task.assignedTo?.includes(assigneeFilter));
    }
    if (teamFilter) {
      const normalizedFilter = normalizeDepartmentKey(teamFilter);
      filtered = filtered.filter((task) => normalizeDepartmentKey(task.team) === normalizedFilter);
    }
    if (dueDateFilter) {
      const { start, end } = parseRangeToken(dueDateFilter);
      const lower = start ? new Date(`${start}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
      const upper = end ? new Date(`${end}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
      filtered = filtered.filter((task) => {
        if (!task.dueAt) {
          return false;
        }
        const dueAt = new Date(task.dueAt).getTime();
        if (Number.isNaN(dueAt)) {
          return false;
        }
        return dueAt >= lower && dueAt <= upper;
      });
    }
    // Apply quick filters
    if (quickFilter === 'createdByMe') {
      filtered = filtered.filter((task) => (user?.id ? task.createdBy === user.id : false));
    } else if (quickFilter === 'myTasks') {
      filtered = filtered.filter((task) => (user?.id ? task.assignedTo?.includes(user.id) : false));
    } else if (quickFilter === 'overdue') {
      filtered = filtered.filter(
        (task) =>
          task.dueAt &&
          new Date(task.dueAt).getTime() < Date.now() &&
          !overdueExcludedStatuses.has(task.status),
      );
    } else if (quickFilter === 'completed') {
      filtered = filtered.filter((task) => task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED);
    }

    return filtered;
  }, [tasks, debouncedSearchQuery, usersMap, statusFilter, priorityFilter, assigneeFilter, teamFilter, dueDateFilter, quickFilter, user?.id]);

  const maxTasksInColumn = useMemo(() => {
    if (!columns.length) return 0;
    return columns.reduce((max, column) => {
      const count = filteredTasks.filter(
        (t) => statusDetails[t.status]?.label === column.title
      ).length;
      return Math.max(max, count);
    }, 0);
  }, [columns, filteredTasks]);

  const totalPages = Math.max(1, Math.ceil(maxTasksInColumn / pageSize));
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [pageIndex, totalPages]);

  const quickFilterButtonBase = [
    'group relative isolate inline-flex items-center justify-center overflow-hidden rounded-[10px] border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em]',
    'transition duration-200 ease-out active:translate-y-[1px]',
    'focus-visible:outline-none focus-visible:ring-2',
  ].join(' ');
  const quickFilterButtonTheme = isLight
    ? {
        active:
          'border-indigo-300/90 text-white bg-gradient-to-b from-sky-400 via-indigo-500 to-violet-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_24px_rgba(79,70,229,0.28),0_0_22px_rgba(56,189,248,0.32)] ring-1 ring-white/55 focus-visible:ring-sky-300/70',
        inactive:
          'border-indigo-200/80 text-slate-700 bg-gradient-to-b from-white via-[#F7FAFF] to-[#EEF6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(79,124,255,0.12)] hover:border-sky-400/70 hover:text-slate-950 hover:shadow-[0_12px_24px_rgba(79,124,255,0.18)] focus-visible:ring-sky-300/60',
        overlay:
          'bg-[linear-gradient(135deg,rgba(255,255,255,0.5),transparent_48%,rgba(125,211,252,0.22))]',
        edgeTop: 'bg-white/80',
        edgeBottom: 'bg-sky-200/70',
      }
    : isColorful
      ? {
          active:
            'border-fuchsia-300/90 text-white bg-gradient-to-b from-fuchsia-400 via-violet-500 to-sky-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.52),0_12px_24px_rgba(217,70,239,0.24),0_0_22px_rgba(56,189,248,0.26)] ring-1 ring-white/55 focus-visible:ring-fuchsia-300/60',
          inactive:
            'border-fuchsia-200/80 text-slate-700 bg-gradient-to-b from-white via-[#fff7fb] to-[#eef6ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(217,70,239,0.1)] hover:border-fuchsia-300/80 hover:text-slate-950 focus-visible:ring-fuchsia-300/60',
          overlay:
            'bg-[linear-gradient(135deg,rgba(255,255,255,0.55),transparent_48%,rgba(244,114,182,0.18))]',
          edgeTop: 'bg-white/80',
          edgeBottom: 'bg-fuchsia-200/70',
        }
      : {
          active:
            'border-cyan-200/90 text-white bg-gradient-to-b from-cyan-300/85 via-sky-500/80 to-blue-800/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_0_18px_rgba(34,211,238,0.6)] ring-1 ring-cyan-200/60 focus-visible:ring-cyan-300/70',
          inactive:
            'border-sky-400/50 text-sky-100 bg-gradient-to-b from-sky-500/40 via-blue-700/45 to-slate-900/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)] hover:from-sky-400/50 hover:via-blue-600/55 hover:to-slate-900/90 hover:text-white focus-visible:ring-cyan-300/70',
          overlay:
            'bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_45%,rgba(0,0,0,0.35))]',
          edgeTop: 'bg-white/40',
          edgeBottom: 'bg-black/50',
        };
  const getQuickFilterButtonClass = (isActive: boolean) =>
    [quickFilterButtonBase, isActive ? quickFilterButtonTheme.active : quickFilterButtonTheme.inactive].join(' ');
  const filterControlBase = [
    'kanban-filter-control rounded-[10px] border px-4 py-2 text-sm transition',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.4)]',
    'focus:outline-none focus:ring-2',
  ].join(' ');
  const filterControlTheme = isLight
    ? [
        'border-indigo-200/85 text-slate-800',
        'bg-white/95',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(79,124,255,0.12)]',
        'focus:border-[#4F7CFF]/80 focus:ring-[#4F7CFF]/30',
      ].join(' ')
    : isColorful
      ? [
          'border-fuchsia-200/85 text-slate-800',
          'bg-white/94',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(217,70,239,0.1)]',
          'focus:border-fuchsia-200/80 focus:ring-fuchsia-300/60',
        ].join(' ')
      : [
          'border-slate-500/40 text-slate-100',
          'bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black/95',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)]',
          'focus:border-cyan-200/80 focus:ring-cyan-300/60',
        ].join(' ');
  const filterSelectClass = [
    filterControlBase,
    filterControlTheme,
    'kanban-filter-select font-semibold uppercase tracking-[0.22em]',
  ].join(' ');
  const filterPlaceholderClass = isLight
    ? 'placeholder:text-slate-500'
    : isColorful
      ? 'placeholder:text-slate-500'
      : 'placeholder:text-sky-100';
  const filterInputClass = [
    filterControlBase,
    filterControlTheme,
    'kanban-filter-input',
    'font-semibold uppercase tracking-[0.22em]',
    filterPlaceholderClass,
  ].join(' ');
  const dropdownMenuClass = isLight
    ? 'border-indigo-100 bg-white/95 text-slate-800 shadow-[0_20px_45px_rgba(79,124,255,0.18)]'
    : isColorful
      ? 'border-fuchsia-100 bg-white/95 text-slate-800 shadow-[0_20px_45px_rgba(217,70,239,0.16)]'
      : 'border-slate-500/40 bg-[#081229]/95 text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.7)]';
  const dropdownItemClass = [
    'w-full px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] transition',
    isLight ? 'text-slate-700 hover:bg-sky-50 hover:text-slate-950' : isColorful ? 'text-slate-700 hover:bg-fuchsia-50 hover:text-slate-950' : 'text-slate-100 hover:bg-white/10',
  ].join(' ');
  const dropdownItemActiveClass = isLight
    ? 'bg-gradient-to-r from-sky-100 to-indigo-100 text-slate-950'
    : isColorful
      ? 'bg-gradient-to-r from-fuchsia-100 to-sky-100 text-slate-950'
      : 'bg-sky-500/30 text-white';
  const dropdownButtonClass = filterSelectClass;
  const filterColorScheme = isLight ? 'light' : 'dark';
  const pageShellClass = isLight
    ? 'kanban-board-light-theme kanban-theme-text flex flex-col space-y-6 text-slate-950'
    : isColorful
      ? 'kanban-board-colorful-theme kanban-theme-text flex flex-col space-y-6 text-slate-950'
    : 'kanban-board-dark-theme kanban-theme-text flex flex-col space-y-6 text-white';
  const controlsPanelClass = isLight
    ? 'rounded-2xl border border-indigo-200/70 bg-white/86 p-3 shadow-[0_18px_42px_rgba(79,124,255,0.14)] backdrop-blur-xl'
    : isColorful
      ? 'rounded-2xl border border-fuchsia-200/70 bg-white/84 p-3 shadow-[0_18px_42px_rgba(217,70,239,0.12)] backdrop-blur-xl'
    : 'rounded-2xl border border-cyan-400/20 bg-slate-950/62 p-3 shadow-[0_22px_48px_rgba(2,6,23,0.58)] backdrop-blur-xl';
  const scrollButtonClass = isLight
    ? 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-indigo-200/80 bg-white/86 text-indigo-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_18px_rgba(79,124,255,0.14)] transition duration-200 hover:border-indigo-300 hover:text-indigo-900 hover:shadow-[0_0_18px_rgba(79,124,255,0.22)]'
    : isColorful
      ? 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-fuchsia-200/80 bg-white/86 text-fuchsia-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_18px_rgba(217,70,239,0.12)] transition duration-200 hover:border-fuchsia-300 hover:text-fuchsia-900 hover:shadow-[0_0_18px_rgba(217,70,239,0.18)]'
    : 'group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-cyan-300/35 bg-slate-950/76 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_18px_rgba(2,6,23,0.55)] transition duration-200 hover:border-cyan-200/70 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.34)]';
  const paginationPanelClass = isLight
    ? 'rounded-3xl border border-indigo-200/70 bg-white/86 p-5 shadow-[0_16px_38px_rgba(79,124,255,0.12)] backdrop-blur-xl'
    : isColorful
      ? 'rounded-3xl border border-fuchsia-200/70 bg-white/86 p-5 shadow-[0_16px_38px_rgba(217,70,239,0.12)] backdrop-blur-xl'
    : 'rounded-3xl border border-cyan-400/16 bg-slate-950/60 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.5)] backdrop-blur-xl';
  const paginationButtonClass = (active: boolean) =>
    active
      ? isBrightMode
        ? 'border-indigo-200/85 bg-white/86 text-slate-800 shadow-[0_8px_18px_rgba(79,124,255,0.12)] hover:border-indigo-300 hover:bg-indigo-50'
        : 'border-cyan-300/26 bg-white/6 text-white shadow-[0_8px_18px_rgba(2,6,23,0.28)] hover:border-cyan-300/54 hover:bg-white/10'
      : isBrightMode
        ? 'border-slate-200 bg-slate-100/80 text-slate-400 cursor-not-allowed'
        : 'border-white/10 bg-white/5 text-white/45 cursor-not-allowed';
  const pageSizeButtonClass = (active: boolean) =>
    active
      ? isBrightMode
        ? 'border-indigo-300/80 bg-indigo-50 text-indigo-700 shadow-[0_8px_18px_rgba(79,124,255,0.12)]'
        : 'border-cyan-300/60 bg-cyan-500/10 text-cyan-100 shadow-[0_8px_18px_rgba(34,211,238,0.1)]'
      : isBrightMode
        ? 'border-indigo-200/80 bg-white/86 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
        : 'border-white/16 bg-white/5 text-white/80 hover:border-cyan-300/42 hover:bg-white/10';
  const addStageClass = isLight
    ? 'group flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-indigo-200/90 bg-white/58 p-8 text-sm font-semibold text-slate-600 shadow-[0_14px_32px_rgba(79,124,255,0.1)] transition-all duration-200 hover:border-indigo-300 hover:bg-white/78 hover:text-indigo-700'
    : isColorful
      ? 'group flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-fuchsia-200/90 bg-white/58 p-8 text-sm font-semibold text-slate-600 shadow-[0_14px_32px_rgba(217,70,239,0.1)] transition-all duration-200 hover:border-fuchsia-300 hover:bg-white/78 hover:text-fuchsia-700'
    : 'group flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-cyan-300/24 bg-slate-950/44 p-8 text-sm font-semibold text-slate-200/70 shadow-[0_16px_38px_rgba(2,6,23,0.45)] transition-all duration-200 hover:border-cyan-300/60 hover:bg-slate-900/70 hover:text-cyan-100';
  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All Statuses' },
      ...Object.values(TaskStatus).map((status) => ({
        value: String(status),
        label: CUSTOM_STATUS_NAMES[status as TaskStatus]?.name || status.replace('_', ' '),
      })),
    ],
    [],
  );
  const priorityOptions = useMemo(
    () => [
      { value: '', label: 'All Priorities' },
      ...Object.values(TaskPriority).map((priority) => ({
        value: priority,
        label: priority,
      })),
    ],
    [],
  );
  const assigneeOptions = useMemo(() => {
    const list = (Array.from(usersMap.values()) as User[])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ value: entry.id, label: entry.name }));
    return [{ value: '', label: 'All Assignees' }, ...list];
  }, [usersMap]);
  const teamOptions = useMemo(
    () => [{ value: '', label: 'All Teams' }, ...departmentOptions.map((department) => ({ value: department, label: department }))],
    [departmentOptions],
  );

  if (loading) return <PageLoader />;

  return (
    <div className={pageShellClass} style={{ color: boardTextColorHex }}>
      <div className="flex flex-col gap-2">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.34em] ${isBrightMode ? 'text-fuchsia-600' : 'text-cyan-200/80'}`}>
          Mission Control
        </p>
        <h1 className={`text-3xl font-bold ${boardTextClass}`}>
          Battle Board <span className={isBrightMode ? 'text-fuchsia-500' : 'text-cyan-200'}>⚔️</span>
        </h1>
      </div>

      <div className={`${controlsPanelClass} space-y-3`}>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          className={`${filterInputClass} min-w-[220px] sm:min-w-[320px]`}
          placeholder="Search Tasks"
        />
        <FilterDropdown
          value={statusFilter}
          placeholder="All Statuses"
          options={statusOptions}
          onChange={setStatusFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={priorityFilter}
          placeholder="All Priorities"
          options={priorityOptions}
          onChange={setPriorityFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={assigneeFilter}
          placeholder="All Assignees"
          options={assigneeOptions}
          onChange={setAssigneeFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <FilterDropdown
          value={teamFilter}
          placeholder="All Teams"
          options={teamOptions}
          onChange={setTeamFilter}
          buttonClassName={dropdownButtonClass}
          menuClassName={dropdownMenuClass}
          itemClassName={dropdownItemClass}
          activeItemClassName={dropdownItemActiveClass}
        />
        <div ref={dateRangeRef} className="relative min-w-[190px]">
          <button
            type="button"
            onClick={() => setDateRangeOpen((prev) => !prev)}
            className={`${dropdownButtonClass} flex w-full items-center justify-between gap-3 text-left`}
            aria-haspopup="dialog"
            aria-expanded={isDateRangeOpen}
          >
            <span className={dueDateFilter ? '' : 'opacity-80'}>{dateRangeLabel}</span>
            <ChevronIcon open={isDateRangeOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
          </button>
          {isDateRangeOpen && (
            <div className={`absolute left-0 top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border p-3 ${dropdownMenuClass}`}>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {([
                  { key: '7d', label: '7D' },
                  { key: '30d', label: '30D' },
                  { key: 'mtd', label: 'MTD' },
                  { key: 'ytd', label: 'YTD' },
                ] as const).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyDatePreset(option.key)}
                    className={[
                      'rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition',
                      activeDatePreset === option.key
                        ? isBrightMode
                          ? 'border-indigo-300/80 bg-indigo-100 text-indigo-700'
                          : 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                        : isBrightMode
                          ? 'border-indigo-100 bg-white text-slate-600 hover:border-indigo-300 hover:text-slate-950'
                          : 'border-white/20 bg-black/20 text-white/80 hover:border-cyan-300/70 hover:text-white',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className={isBrightMode ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>From</label>
                <input
                  type="date"
                  value={dateRangeTokens.start}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(event.target.value, dateRangeTokens.end)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
                <label className={isBrightMode ? 'block text-[10px] uppercase tracking-[0.2em] text-slate-500' : 'block text-[10px] uppercase tracking-[0.2em] text-white/60'}>To</label>
                <input
                  type="date"
                  value={dateRangeTokens.end}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(dateRangeTokens.start, event.target.value)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className={isBrightMode ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 hover:text-indigo-800' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80 hover:text-cyan-100'}
                  onClick={() => {
                    setDueDateFilter('');
                    setActiveDatePreset('');
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className={isBrightMode ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 hover:text-slate-950' : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 hover:text-white'}
                  onClick={() => setDateRangeOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setQuickFilter(quickFilter === 'myTasks' ? '' : 'myTasks')}
            className={getQuickFilterButtonClass(quickFilter === 'myTasks')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">My Tasks</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'createdByMe' ? '' : 'createdByMe')}
            className={getQuickFilterButtonClass(quickFilter === 'createdByMe')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Task Created By Me</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'overdue' ? '' : 'overdue')}
            className={getQuickFilterButtonClass(quickFilter === 'overdue')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Overdue</span>
          </button>
          <button
            onClick={() => setQuickFilter(quickFilter === 'completed' ? '' : 'completed')}
            className={getQuickFilterButtonClass(quickFilter === 'completed')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Completed</span>
          </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={getQuickFilterButtonClass(true)}
            title="Kanban View"
            aria-current="true"
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Kanban</span>
          </button>

        <button
          type="button"
          onClick={() => scrollBoard('left')}
          className={scrollButtonClass}
          aria-label="Scroll board left"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x2039)}</span>
        </button>
        <button
          type="button"
          onClick={() => scrollBoard('right')}
          className={scrollButtonClass}
          aria-label="Scroll board right"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x203A)}</span>
        </button>
        </div>
      </div>
      </div>

      <div
        ref={boardRef}
        className="kanban-board-scroll flex gap-6 overflow-x-auto overflow-y-visible rounded-3xl border p-4 pb-6 cursor-grab active:cursor-grabbing"
        style={{
          borderColor: isBrightMode ? 'rgba(217, 70, 239, 0.24)' : 'rgba(34, 211, 238, 0.14)',
          background: isBrightMode ? 'rgba(255, 255, 255, 0.38)' : 'rgba(2, 6, 23, 0.22)',
          boxShadow: isBrightMode ? '0 18px 46px rgba(217, 70, 239, 0.1)' : '0 20px 52px rgba(2, 6, 23, 0.38)',
        }}
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseLeave={handleBoardMouseLeave}
        onMouseUp={handleBoardMouseUp}
      >
        {columns.map((column) => {
          const tasksInColumn = filteredTasks.filter(
            (t) => statusDetails[t.status]?.label === column.title
          );
          const startIndex = pageIndex * pageSize;
          const visibleTasks = tasksInColumn.slice(startIndex, startIndex + pageSize);
          const detail = Object.values(statusDetails).find((s) => s.label === column.title);
          if (!detail) return null;
          const Icon = detail.icon;

          return (
            <div
              key={column.id}
              className="relative w-72 flex-shrink-0 overflow-hidden rounded-3xl border p-5 backdrop-blur transition duration-200 hover:-translate-y-0.5"
              onDrop={(e) => handleDrop(e, column.id as TaskStatus)}
              onDragOver={handleDragOver}
              style={getKanbanColumnStyle(column.id as TaskStatus, resolvedTheme)}
            >
              <div
                className="pointer-events-none absolute inset-x-5 top-0 h-1 rounded-b-full"
                style={{ backgroundColor: getKanbanStatusVisual(column.id as TaskStatus).accent }}
              />
              <div className="relative flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className={`flex items-center gap-2 font-semibold ${boardTextClass}`}>
                    <span
                      className="grid h-8 w-8 place-items-center rounded-xl border shadow-sm"
                      style={{
                        borderColor: getKanbanStatusVisual(column.id as TaskStatus).accent,
                        color: getKanbanStatusVisual(column.id as TaskStatus).accent,
                        background: isBrightMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(15, 23, 42, 0.58)',
                      }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <Tooltip text={String(column.id)} triggerClassName="inline-flex items-center">
                      <span>{detail.label}</span>
                    </Tooltip>
                  </h3>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${boardMutedTextClass}`} style={{ borderColor: isBrightMode ? 'rgba(148, 163, 184, 0.22)' : 'rgba(255, 255, 255, 0.1)', background: isBrightMode ? 'rgba(255, 255, 255, 0.58)' : 'rgba(255, 255, 255, 0.06)' }}>
                    {tasksInColumn.length}
                  </span>
                </div>

                <div className="space-y-4">
                  {visibleTasks.map((task) => {
                    const assignees = (task.assignedTo || []).map((id) => usersMap.get(id)).filter(Boolean) as User[];
                    const creator = usersMap.get(task.createdBy);
                    return (
                      <KanbanTaskCard
                        key={task.id}
                        task={task}
                        assignees={assignees}
                        creator={creator}
                        onDragStart={handleDragStart}
                        onClick={handleTaskClick}
                        onEdit={handleTaskEdit}
                        theme={resolvedTheme}
                        user={user || null}
                      />
                    );
                  })}
                  {tasksInColumn.length === 0 && (
                    <div className={`text-xs text-center py-6 border border-dashed rounded-2xl ${isBrightMode ? 'border-indigo-200/90 bg-white/52 text-slate-500' : 'border-white/20 bg-white/5 text-white/60'}`}>
                      Drop quests here
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="w-72 flex-shrink-0">
          <button
            onClick={() => {}}
            className={addStageClass}
          >
            <div className="grid h-12 w-12 place-items-center rounded-xl border-2 border-dashed border-current bg-white/5 group-hover:scale-110">
              <PlusIcon className="h-6 w-6" />
            </div>
            <span>Add Stage</span>
          </button>
        </div>
      </div>

      <div className={paginationPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
              disabled={!canGoPrev}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${paginationButtonClass(canGoPrev)}`}
            >
              Prev page
            </button>
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={!canGoNext}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${paginationButtonClass(canGoNext)}`}
            >
              Next page
            </button>
            <span className={`text-xs ${boardMutedTextClass}`}>Page {pageIndex + 1} of {totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPageSize(20);
                setPageIndex(0);
              }}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${pageSizeButtonClass(pageSize === 20)}`}
            >
              20 per page
            </button>
            <button
              type="button"
              onClick={() => {
                setPageSize(100);
                setPageIndex(0);
              }}
              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${pageSizeButtonClass(pageSize === 100)}`}
            >
              100 per page
            </button>
          </div>
        </div>
      </div>

      {selectedTaskId &&
        typeof window !== 'undefined' &&
        ReactDOM.createPortal(
          <TaskDetailModal
            taskId={selectedTaskId}
            isOpen={!!selectedTaskId}
            onClose={handleCloseModal}
            usersMap={usersMap}
            onTaskDeleted={() => setSelectedTaskId(null)}
          />,
          document.body
        )}
    </div>
  );
};

export default KanbanBoard;


