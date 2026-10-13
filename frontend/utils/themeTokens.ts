import type { CSSProperties } from 'react';
import { TaskPriority, TaskStatus } from '../types';

export const STATUS_STAGE_TOKEN: Record<TaskStatus, string> = {
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

export const PRIORITY_TOKEN: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: '--color-priority-low',
  [TaskPriority.MEDIUM]: '--color-priority-medium',
  [TaskPriority.HIGH]: '--color-priority-high',
  [TaskPriority.URGENT]: '--color-priority-urgent',
};

export const stageCardStyle = (status: TaskStatus): CSSProperties => {
  const token = STATUS_STAGE_TOKEN[status] ?? '--color-stage-case';
  return {
    borderColor: `color-mix(in srgb, var(${token}) 40%, var(--color-border-color) 60%)`,
    background: `linear-gradient(120deg, color-mix(in srgb, var(${token}) 20%, var(--color-surface) 80%), color-mix(in srgb, var(${token}) 12%, var(--color-bg-secondary) 88%))`,
    boxShadow: `0 16px 34px color-mix(in srgb, var(${token}) 18%, transparent)`,
  };
};

export const stageColumnStyle = (status: TaskStatus): CSSProperties => {
  const token = STATUS_STAGE_TOKEN[status] ?? '--color-stage-case';
  return {
    borderColor: `color-mix(in srgb, var(${token}) 50%, var(--color-border-color) 50%)`,
    background: `linear-gradient(180deg, color-mix(in srgb, var(${token}) 22%, var(--color-surface) 78%), color-mix(in srgb, var(${token}) 10%, var(--color-bg-primary) 90%))`,
    boxShadow: `0 22px 48px color-mix(in srgb, var(${token}) 22%, transparent)`,
  };
};

export const stageAccentColor = (status: TaskStatus): string => {
  const token = STATUS_STAGE_TOKEN[status] ?? '--color-stage-case';
  return `var(${token})`;
};

export const priorityPillStyle = (priority: TaskPriority): CSSProperties => {
  const token = PRIORITY_TOKEN[priority] ?? '--color-priority-medium';
  return {
    borderColor: `color-mix(in srgb, var(${token}) 62%, var(--color-border-color) 38%)`,
    background: `color-mix(in srgb, var(${token}) 24%, var(--color-surface) 76%)`,
    color: 'var(--color-text-primary)',
  };
};
