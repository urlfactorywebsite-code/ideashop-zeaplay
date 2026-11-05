export type Role = 'user' | 'manager' | 'admin' | 'owner';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface RoleScoreConfig {
  creationPoints: number;
  ratingPerStar: number;
  bonusByPriority: Record<Priority, number>;
  penaltyByPriority: Record<Priority, number>;
  ownerPenalties: number[];
}

export type RoleScoreMatrix = Record<Role, RoleScoreConfig>;

export const ROLE_SCORE_MATRIX: RoleScoreMatrix = {
  user: {
    creationPoints: 5,
    ratingPerStar: 2,
    bonusByPriority: { low: 5, medium: 8, high: 12, urgent: 15 },
    penaltyByPriority: { low: -10, medium: -20, high: -30, urgent: -40 },
    ownerPenalties: [0, 0, 0, 0, 0],
  },
  manager: {
    creationPoints: 10,
    ratingPerStar: 3,
    bonusByPriority: { low: 10, medium: 12, high: 15, urgent: 20 },
    penaltyByPriority: { low: -20, medium: -30, high: -45, urgent: -60 },
    ownerPenalties: [0, 0, 0, 0, 0],
  },
  admin: {
    creationPoints: 10,
    ratingPerStar: 3,
    bonusByPriority: { low: 10, medium: 12, high: 15, urgent: 20 },
    penaltyByPriority: { low: -20, medium: -30, high: -45, urgent: -60 },
    ownerPenalties: [0, 0, 0, 0, 0],
  },
  owner: {
    creationPoints: 10,
    ratingPerStar: 3,
    bonusByPriority: { low: 10, medium: 12, high: 15, urgent: 20 },
    penaltyByPriority: { low: -20, medium: -30, high: -45, urgent: -60 },
    ownerPenalties: [0, 0, 0, 0, 0],
  },
};

const STORAGE_KEY = 'task-create-score-config';

const cloneRoleConfig = (config: RoleScoreMatrix): RoleScoreMatrix => {
  const next = {} as RoleScoreMatrix;
  (Object.keys(config) as Role[]).forEach((role) => {
    const roleConfig = config[role];
    next[role] = {
      creationPoints: roleConfig.creationPoints,
      ratingPerStar: roleConfig.ratingPerStar,
      bonusByPriority: { ...roleConfig.bonusByPriority },
      penaltyByPriority: { ...roleConfig.penaltyByPriority },
      ownerPenalties: [...(roleConfig.ownerPenalties ?? [])],
    };
  });
  return next;
};

export const loadRoleScoreMatrix = (): RoleScoreMatrix => {
  if (typeof window === 'undefined') {
    return cloneRoleConfig(ROLE_SCORE_MATRIX);
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return cloneRoleConfig(ROLE_SCORE_MATRIX);
    }
    const parsed = JSON.parse(stored) as Partial<RoleScoreMatrix>;
    return cloneRoleConfig({ ...ROLE_SCORE_MATRIX, ...parsed });
  } catch {
    return cloneRoleConfig(ROLE_SCORE_MATRIX);
  }
};

export const saveRoleScoreMatrix = (matrix: RoleScoreMatrix): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matrix));
};

export const resetRoleScoreMatrix = (): RoleScoreMatrix => {
  const defaults = cloneRoleConfig(ROLE_SCORE_MATRIX);
  saveRoleScoreMatrix(defaults);
  return defaults;
};

const assertFinite = (value: number, message: string) => {
  if (!Number.isFinite(value)) {
    throw new Error(message);
  }
};

export const evaluateTimeRule = (
  durationHours: number,
  completionHours: number,
): 'BONUS' | 'PENALTY' | 'NONE' => {
  assertFinite(durationHours, 'duration must be a finite number.');
  assertFinite(completionHours, 'completion must be a finite number.');
  if (durationHours <= 0) {
    throw new Error('duration must be > 0.');
  }
  if (completionHours < 0) {
    throw new Error('completion cannot be negative.');
  }

  const bonusThreshold = durationHours * (2 / 3);
  const tooEarlyThreshold = durationHours * 0.2;

  if (completionHours <= tooEarlyThreshold) {
    return 'PENALTY';
  }
  if (completionHours <= bonusThreshold) {
    return 'BONUS';
  }
  return 'NONE';
};

const resolveRoleConfig = (matrix: RoleScoreMatrix, role: Role): RoleScoreConfig => {
  const config = matrix[role];
  if (!config) {
    throw new Error(`Unknown role: ${role}`);
  }
  return config;
};

const resolvePriorityValue = (config: RoleScoreConfig, priority: Priority, field: 'bonus' | 'penalty'): number => {
  const map = field === 'bonus' ? config.bonusByPriority : config.penaltyByPriority;
  const value = map[priority];
  if (value === undefined) {
    throw new Error(`Unknown priority: ${priority}`);
  }
  return value;
};

export interface TaskInput {
  creatorRole: Role;
  priority: Priority;
  stars: number;
  durationHours: number;
  completionHours: number;
}

export const calculateTaskScore = (input: TaskInput): number => {
  return calculateTaskScoreWithConfig(ROLE_SCORE_MATRIX, input);
};

export const calculateTaskScoreWithConfig = (
  matrix: RoleScoreMatrix,
  { creatorRole, priority, stars, durationHours, completionHours }: TaskInput,
): number => {
  if (!Number.isFinite(stars) || !Number.isInteger(stars) || stars < 0) {
    throw new Error('stars must be a non-negative integer.');
  }
  const config = resolveRoleConfig(matrix, creatorRole);
  let score = config.creationPoints;
  score += stars * config.ratingPerStar;

  const timeResult = evaluateTimeRule(durationHours, completionHours);
  if (timeResult === 'PENALTY') {
    if (creatorRole !== 'owner') {
      score += resolvePriorityValue(config, priority, 'penalty');
    }
  } else if (timeResult === 'BONUS') {
    score += resolvePriorityValue(config, priority, 'bonus');
  }

  return score;
};
