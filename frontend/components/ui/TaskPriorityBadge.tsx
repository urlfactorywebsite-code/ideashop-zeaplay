import React from 'react';
import { TaskPriority } from '../../types';
import Badge from './Badge';

type BadgeColor = 'green' | 'yellow' | 'red' | 'purple';

const PRIORITY_META: Record<TaskPriority, { label: string; legend: string; color: BadgeColor }> = {
  [TaskPriority.LOW]: {
    label: 'Low',
    legend: 'Chill ticket - handle when convenient',
    color: 'green',
  },
  [TaskPriority.MEDIUM]: {
    label: 'Medium',
    legend: 'Standard quest - on the active radar',
    color: 'yellow',
  },
  [TaskPriority.HIGH]: {
    label: 'High',
    legend: 'Hot mission - move up the queue',
    color: 'red',
  },
  [TaskPriority.URGENT]: {
    label: 'Urgent',
    legend: 'Critical alert - grab it now',
    color: 'purple',
  },
};

const TaskPriorityBadge: React.FC<{ priority: TaskPriority }> = ({ priority }) => {
  const { label, legend, color } = PRIORITY_META[priority] ?? {
    label: 'Unknown',
    legend: 'Unknown priority level',
    color: 'yellow',
  };

  return (
    <Badge
      color={color}
      title={legend}
      className="shadow-[0_10px_25px_rgba(15,23,42,0.25)]"
    >
      {label}
    </Badge>
  );
};

export default TaskPriorityBadge;
