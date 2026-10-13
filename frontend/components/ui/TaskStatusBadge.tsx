import React from 'react';
import { TaskStatus, CUSTOM_STATUS_NAMES } from '../../types';
import {
  RocketLaunchIcon,
  ClipboardDocumentListIcon,
  PuzzlePieceIcon,
  FireIcon,
  AcademicCapIcon,
  NoSymbolIcon,
  TrophyIcon,
  CheckCircleIcon,
  XMarkIcon,
  TrashIcon,
} from '../icons';

const STATUS_ICONS: Record<TaskStatus, React.FC<React.SVGProps<SVGSVGElement>>> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: RocketLaunchIcon,
  [TaskStatus.TODO]: ClipboardDocumentListIcon,
  [TaskStatus.IN_PROGRESS]: PuzzlePieceIcon,
  [TaskStatus.BUG_FIXING]: FireIcon,
  [TaskStatus.BLOCKED]: FireIcon,
  [TaskStatus.IN_REVIEW]: AcademicCapIcon,
  [TaskStatus.ON_HOLD]: NoSymbolIcon,
  [TaskStatus.DONE]: TrophyIcon,
  [TaskStatus.DEPLOYED]: CheckCircleIcon,
  [TaskStatus.FAILED]: XMarkIcon,
  [TaskStatus.GRAVEYARD]: TrashIcon,
};

const STATUS_STAGE_TOKEN: Record<TaskStatus, string> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: '--color-stage-battle',
  [TaskStatus.TODO]: '--color-stage-case',
  [TaskStatus.IN_PROGRESS]: '--color-stage-progress',
  [TaskStatus.BUG_FIXING]: '--color-stage-boss',
  [TaskStatus.BLOCKED]: '--color-stage-boss',
  [TaskStatus.IN_REVIEW]: '--color-stage-tactical',
  [TaskStatus.ON_HOLD]: '--color-stage-hold',
  [TaskStatus.DONE]: '--color-stage-conquered',
  [TaskStatus.DEPLOYED]: '--color-stage-conquered',
  [TaskStatus.FAILED]: '--color-stage-fallen',
  [TaskStatus.GRAVEYARD]: '--color-stage-graveyard',
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  onClick?: () => void;
}

const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({ status, onClick }) => {
  const Icon = STATUS_ICONS[status] || STATUS_ICONS[TaskStatus.TODO];
  const name = CUSTOM_STATUS_NAMES[status]?.name || status || 'Unknown';
  const tooltip = CUSTOM_STATUS_NAMES[status]?.tooltip || '';
  const stageToken = STATUS_STAGE_TOKEN[status] ?? '--color-stage-case';

  const style: React.CSSProperties = {
    borderColor: `color-mix(in srgb, var(${stageToken}) 55%, var(--color-border-color) 45%)`,
    background: `linear-gradient(120deg, color-mix(in srgb, var(${stageToken}) 24%, var(--color-surface) 76%), color-mix(in srgb, var(${stageToken}) 16%, var(--color-bg-secondary) 84%))`,
    boxShadow: `0 10px 24px color-mix(in srgb, var(${stageToken}) 24%, transparent)`,
    color: 'var(--color-text-primary)',
  };

  const baseClass = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold transition-all duration-200 ease-out';
  const interactiveClass = 'hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary/60 cursor-pointer';

  if (!onClick) {
    return (
      <span title={tooltip} className={baseClass} style={style}>
        <Icon className="h-4 w-4" style={{ color: `var(${stageToken})` }} />
        {name}
      </span>
    );
  }

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`${baseClass} ${interactiveClass}`}
      style={style}
      type="button"
    >
      <Icon className="h-4 w-4" style={{ color: `var(${stageToken})` }} />
      {name}
    </button>
  );
};

export default TaskStatusBadge;
