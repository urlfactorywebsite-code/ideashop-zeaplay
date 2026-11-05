import type React from 'react';
import { TaskStatus } from '../types';
import { Circle, Flag, Play, Pause, Check, Star, Zap, Clock } from 'lucide-react';
import { RocketLaunchIcon, ClipboardDocumentListIcon, PuzzlePieceIcon, FireIcon,
  AcademicCapIcon, TrophyIcon, XMarkIcon, NoSymbolIcon, QuestionMarkCircleIcon } from '../components/icons';

export type ResolvedTheme = 'light' | 'dark' | 'colorful';
const configuredIcons = { circle: Circle, flag: Flag, play: Play, pause: Pause, check: Check, star: Star, bolt: Zap, clock: Clock };
type StatusDetail = {
  label: string;
  legend: string;
  stageToken: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
};

// 11 stages aligned with backend task statuses
export const statusDetails: { [K in TaskStatus]: StatusDetail } = {
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

export const getKanbanStatusVisual = (status: TaskStatus) =>
  kanbanStatusVisuals[status] ?? kanbanStatusVisuals[TaskStatus.TODO];

export const getKanbanColumnStyle = (status: TaskStatus, mode: ResolvedTheme): React.CSSProperties => {
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


export function columnAppearance(status: string, color: string | undefined, icon: string | undefined, mode: ResolvedTheme) {
  const detail = statusDetails[status as TaskStatus] || statusDetails[TaskStatus.IN_PROGRESS];
  const visual = getKanbanStatusVisual(status as TaskStatus);
  const accent = color && /^#[0-9a-f]{6}$/i.test(color) ? color : visual.accent;
  const Icon = configuredIcons[icon as keyof typeof configuredIcons] || detail.icon;
  const base = getKanbanColumnStyle(status as TaskStatus, mode);
  const changed = accent.toLowerCase() !== visual.accent.toLowerCase();
  const bright = mode !== 'dark';
  const style: React.CSSProperties = changed ? {
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} ${bright ? 14 : 24}%, ${bright ? '#ffffff' : '#0b1220'}), ${bright ? 'rgba(255,255,255,0.86)' : 'rgba(11,18,32,0.94)'})`,
    borderColor: accent,
    boxShadow: `0 18px 42px color-mix(in srgb, ${accent} ${bright ? 16 : 13}%, transparent)`,
  } : { ...base, borderColor: accent };
  return { accent, Icon, style };
}

export const questCardSurface = (mode: ResolvedTheme) => mode !== 'dark'
  ? 'border-slate-200/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
  : 'border-white/10 bg-[rgba(20,28,45,0.78)] shadow-[0_10px_28px_rgba(0,0,0,0.28)]';
