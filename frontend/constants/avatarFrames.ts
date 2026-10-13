import { Role } from '../types';

export const ROLE_FRAME_CLASSES: Record<Role, string> = {
  [Role.OWNER]: 'border-4 border-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.35)]',
  [Role.ADMIN]: 'border-4 border-indigo-400 shadow-[0_0_0_4px_rgba(99,102,241,0.35)]',
  [Role.MANAGER]: 'border-4 border-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.35)]',
  [Role.USER]: 'border-4 border-slate-300 shadow-inner dark:border-slate-500',
};

export const FRAME_OPTIONS = [
  {
    id: 'role-ring',
    label: 'Role ring',
    description: 'Auto-color the halo using the user role.',
  },
  {
    id: 'achievement-glow',
    label: 'Achievement glow',
    description: 'Vibrant gradient aura inspired by badges.',
  },
  {
    id: 'minimal',
    label: 'Minimal outline',
    description: 'Classic neutral frame with soft shadow.',
  },
] as const;

export const DEFAULT_FRAME_ID = 'role-ring';

export const getFrameClassName = (frameId: string, role: Role): string => {
  switch (frameId) {
    case 'role-ring':
      return ROLE_FRAME_CLASSES[role] ?? 'border-4 border-indigo-400';
    case 'achievement-glow':
      return 'border-4 border-transparent ring-2 ring-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.4)]';
    case 'minimal':
    default:
      return 'border-2 border-slate-300 dark:border-slate-600';
  }
};
