import React, { useMemo, useState } from 'react';

import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

type Difficulty = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
type Role = 'user' | 'manager' | 'admin' | 'owner';

const TASK_TYPES = [
  { id: 'bug', label: 'Bug Fix', base: 40 },
  { id: 'feature', label: 'Feature', base: 65 },
  { id: 'research', label: 'Research', base: 30 },
  { id: 'support', label: 'Support', base: 25 },
];

const ROLES: { id: Role; label: string; multiplier: number }[] = [
  { id: 'user', label: 'User', multiplier: 1 },
  { id: 'manager', label: 'Manager', multiplier: 1.15 },
  { id: 'admin', label: 'Admin', multiplier: 1.15 },
  { id: 'owner', label: 'Owner', multiplier: 1.25 },
];

const DEPARTMENTS = [
  { id: 'management', label: 'Management', weight: 1.05 },
  { id: 'marketing', label: 'Marketing', weight: 1.02 },
  { id: 'finance', label: 'Finance', weight: 1.08 },
  { id: 'operations', label: 'Operations', weight: 1.0 },
  { id: 'support', label: 'Support', weight: 0.95 },
];

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  LOW: 0.9,
  NORMAL: 1,
  HIGH: 1.2,
  CRITICAL: 1.5,
};

const APPROVAL_BONUS = 12;
const TIME_BONUS_RATE = 0.25;
const TIME_PENALTY_RATE = -0.35;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatSigned = (value: number) => (value > 0 ? `+${value}` : `${value}`);

const resolveTimeResult = (durationMinutes: number, completionMinutes: number) => {
  if (durationMinutes <= 0) {
    return 'NONE';
  }
  const bonusThreshold = durationMinutes * (2 / 3);
  const tooEarlyThreshold = durationMinutes * 0.2;
  if (completionMinutes <= tooEarlyThreshold) {
    return 'PENALTY';
  }
  if (completionMinutes <= bonusThreshold) {
    return 'BONUS';
  }
  return 'NONE';
};

const GamifiedXPSimulator: React.FC = () => {
  const [taskType, setTaskType] = useState(TASK_TYPES[0].id);
  const [role, setRole] = useState<Role>('user');
  const [department, setDepartment] = useState(DEPARTMENTS[0].id);
  const [allowedMinutes, setAllowedMinutes] = useState(120);
  const [completionMinutes, setCompletionMinutes] = useState(90);
  const [difficulty, setDifficulty] = useState<Difficulty>('NORMAL');
  const [requiresApproval, setRequiresApproval] = useState(false);

  const computed = useMemo(() => {
    const taskConfig = TASK_TYPES.find((item) => item.id === taskType) ?? TASK_TYPES[0];
    const roleConfig = ROLES.find((item) => item.id === role) ?? ROLES[0];
    const deptConfig = DEPARTMENTS.find((item) => item.id === department) ?? DEPARTMENTS[0];
    const duration = clampNumber(allowedMinutes, 1, 6000);
    const completion = clampNumber(completionMinutes, 0, 6000);
    const timeResult = resolveTimeResult(duration, completion);

    const baseXp = taskConfig.base;
    const timeDelta =
      timeResult === 'BONUS'
        ? Math.round(baseXp * TIME_BONUS_RATE)
        : timeResult === 'PENALTY'
          ? Math.round(baseXp * TIME_PENALTY_RATE)
          : 0;
    const difficultyMultiplier = DIFFICULTY_MULTIPLIER[difficulty];
    const roleMultiplier = roleConfig.multiplier;
    const departmentWeight = deptConfig.weight;
    const approvalBonus = requiresApproval ? APPROVAL_BONUS : 0;

    const rawScore = (baseXp + timeDelta) * difficultyMultiplier * roleMultiplier * departmentWeight;
    const finalPoints = Math.round(rawScore + approvalBonus);

    const levelSpan = 1000;
    const currentXp = 2450;
    const totalXp = currentXp + finalPoints;
    const levelProgress = (totalXp % levelSpan) / levelSpan * 100;

    let hint: string | null = null;
    if (timeResult === 'NONE' && duration > 0 && completion > duration * (2 / 3)) {
      const deltaMinutes = Math.max(1, Math.ceil(completion - duration * (2 / 3)));
      const bonusGain = Math.round(baseXp * TIME_BONUS_RATE);
      hint = `Finish ${deltaMinutes} minutes earlier to gain +${bonusGain} XP`;
    }

    return {
      baseXp,
      timeDelta,
      difficultyMultiplier,
      roleMultiplier,
      departmentWeight,
      approvalBonus,
      finalPoints,
      levelProgress,
      hint,
      timeResult,
    };
  }, [taskType, role, department, allowedMinutes, completionMinutes, difficulty, requiresApproval]);

  const animatedXp = useAnimatedNumber(computed.finalPoints, 800);

  return (
    <section className="rounded-3xl border border-border-color bg-surface p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Gamified XP Simulator</p>
          <h2 className="text-2xl font-bold text-text-primary">Command Center XP Lab</h2>
        </div>
        <div className="rounded-full border border-border-color/60 bg-black/20 px-4 py-1 text-xs text-text-secondary">
          Calibrate XP before pushing live
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="grid gap-4 rounded-2xl border border-border-color/60 bg-background/40 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-text-primary">
              Task Type
              <select
                value={taskType}
                onChange={(event) => setTaskType(event.target.value)}
                className="w-full rounded-xl border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {TASK_TYPES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-text-primary">
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="w-full rounded-xl border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ROLES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-text-primary">
              Department
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                className="w-full rounded-xl border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {DEPARTMENTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-text-primary">
              Allowed Time (minutes)
              <input
                type="number"
                min={1}
                value={allowedMinutes}
                onChange={(event) => setAllowedMinutes(Number(event.target.value))}
                className="w-full rounded-xl border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-text-primary">
              Completion Time (minutes)
              <input
                type="number"
                min={0}
                value={completionMinutes}
                onChange={(event) => setCompletionMinutes(Number(event.target.value))}
                className="w-full rounded-xl border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
            <div className="space-y-2 text-sm font-medium text-text-primary">
              Difficulty
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DIFFICULTY_MULTIPLIER) as Difficulty[]).map((level) => {
                  const active = difficulty === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setDifficulty(level)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        active
                          ? 'border-primary bg-primary/20 text-primary shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                          : 'border-border-color text-text-secondary hover:border-primary hover:text-primary'
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center justify-between rounded-2xl border border-border-color/60 bg-background px-3 py-2 text-sm text-text-primary">
              Approval Required
              <button
                type="button"
                onClick={() => setRequiresApproval((prev) => !prev)}
                className={`relative h-6 w-12 rounded-full transition ${
                  requiresApproval ? 'bg-emerald-400/70 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-slate-700/70'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    requiresApproval ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        <div className="grid gap-4 rounded-2xl border border-border-color/60 bg-background/40 p-4">
          <div className="rounded-2xl border border-border-color/60 bg-black/30 p-4 text-center shadow-[0_0_30px_rgba(56,189,248,0.25)]">
            <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Projected XP</p>
            <div className="mt-2 flex items-center justify-center">
              <span className="rounded-full border border-cyan-300/40 px-6 py-3 text-4xl font-bold text-cyan-200 shadow-[0_0_20px_rgba(56,189,248,0.45)]">
                {animatedXp.toLocaleString()}
              </span>
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              Time result: {computed.timeResult}
            </p>
          </div>

          <div className="grid gap-2 text-sm text-text-secondary">
            {[
              { label: 'Base XP', value: computed.baseXp },
              { label: 'Time Bonus/Penalty', value: computed.timeDelta },
              { label: 'Difficulty Multiplier', value: `x${computed.difficultyMultiplier.toFixed(2)}` },
              { label: 'Role Multiplier', value: `x${computed.roleMultiplier.toFixed(2)}` },
              { label: 'Department Weight', value: `x${computed.departmentWeight.toFixed(2)}` },
              { label: 'Approval Bonus', value: computed.approvalBonus },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border border-border-color/60 bg-black/20 px-3 py-2 transition hover:scale-[1.01]"
              >
                <span className="text-xs uppercase tracking-[0.2em] text-text-secondary">{row.label}</span>
                <span className="font-semibold text-text-primary">
                  {typeof row.value === 'number' ? formatSigned(row.value) : row.value}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border-color/60 bg-black/20 p-3">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>Level Progress</span>
              <span>{Math.round(computed.levelProgress)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-700/60">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400 transition-all duration-700"
                style={{ width: `${computed.levelProgress}%` }}
              />
            </div>
          </div>

          {computed.hint && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {computed.hint}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default GamifiedXPSimulator;

export const GAMIFIED_XP_GLOW_CLASSES = [
  'shadow-[0_0_30px_rgba(56,189,248,0.25)]',
  'shadow-[0_0_20px_rgba(56,189,248,0.45)]',
  'bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400',
  'transition-all duration-700',
  'hover:scale-[1.01]',
];
