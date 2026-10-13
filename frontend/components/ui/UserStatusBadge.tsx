import React from 'react';
import { UserStatus } from '../../types';
import Badge from './Badge';

type BadgeColor = 'green' | 'gray';

const STATUS_META: Record<UserStatus, { label: string; legend: string; color: BadgeColor }> = {
  [UserStatus.ACTIVE]: {
    label: 'Active',
    legend: 'Ready for deployment',
    color: 'green',
  },
  [UserStatus.DEACTIVATED]: {
    label: 'Deactivated',
    legend: 'User not available for quests',
    color: 'gray',
  },
};

const UserStatusBadge: React.FC<{ status: UserStatus }> = ({ status }) => {
  const { label, legend, color } = STATUS_META[status] ?? {
    label: 'Unknown',
    legend: 'Unknown user state',
    color: 'gray',
  };

  return (
    <Badge
      color={color}
      title={legend}
    >
      {label}
    </Badge>
  );
};

export default UserStatusBadge;
