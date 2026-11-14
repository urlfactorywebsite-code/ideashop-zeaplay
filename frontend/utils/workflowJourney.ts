import { TaskStatus } from '../types';
import type { LifecycleEvent } from '../types/taskLifecycle';
import type { StatusLabelEntry } from './taskStatusLabels';
import { currentStageStart, duration, elapsedSeconds, enabledWorkflowStages, MAIN_STAGES, OTHER_STAGES, stageVisits } from './taskJourney';

export type WorkflowIcon = 'rocket' | 'file' | 'activity' | 'review' | 'trophy' | 'deploy' | 'bug' | 'crown' | 'pause' | 'warning' | 'grave' | 'checkpoint';
export interface WorkflowStage {
  id: string;
  label: string;
  icon?: WorkflowIcon;
  isCurrent: boolean;
  completed: boolean;
  recorded: boolean;
  pending?: boolean;
  recordedSeconds?: number | null;
  enteredAt?: string | null;
  lastChangedAt?: string | null;
  visits?: number;
  metadata?: Record<string, string | number | null>;
}
export const stageStateName = (stage: WorkflowStage) => stage.isCurrent ? 'Current' : stage.completed ? 'Completed' : stage.pending ? 'Pending' : 'Not recorded';
export const stageTime = (stage: WorkflowStage) => duration(stage.recordedSeconds ?? null);
export function workflowCompletion(stages: WorkflowStage[]) {
  const completed = stages.filter(stage => stage.completed).length;
  return { completed, total: stages.length, percentage: stages.length ? Math.round(completed / stages.length * 100) : 0 };
}

const icons: Record<string, WorkflowIcon> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: 'rocket', [TaskStatus.TODO]: 'file',
  [TaskStatus.IN_PROGRESS]: 'activity', [TaskStatus.IN_REVIEW]: 'review',
  [TaskStatus.DONE]: 'trophy', [TaskStatus.DEPLOYED]: 'deploy',
  [TaskStatus.BUG_FIXING]: 'bug', [TaskStatus.BLOCKED]: 'crown', [TaskStatus.ON_HOLD]: 'pause',
  [TaskStatus.FAILED]: 'warning', [TaskStatus.GRAVEYARD]: 'grave',
};

// Presentation projection only. Keep immutable IDs, configured labels and the
// separate core/custom capture records; never infer visits from stage position.
export function buildWorkflowJourney(entries: StatusLabelEntry[], events: LifecycleEvent[], customEvents: LifecycleEvent[],
  currentId: string, now: number, pagesComplete: boolean, historyComplete: boolean) {
  const enabled = enabledWorkflowStages(entries);
  const byId = new Map(enabled.map(entry => [entry.custom_status_id || entry.id, entry]));
  const mainEntries = MAIN_STAGES.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const alternateEntries = [...OTHER_STAGES.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    ...enabled.filter(entry => ![...MAIN_STAGES, ...OTHER_STAGES].includes((entry.custom_status_id || entry.id) as TaskStatus))];
  const project = (entry: StatusLabelEntry, main: boolean): WorkflowStage => {
    const id = entry.custom_status_id || entry.id;
    const rows = entry.custom_status_id ? customEvents : events;
    const stays = stageVisits(rows, currentId, now, pagesComplete).filter(visit => visit.event.new_status === id);
    const exited = rows.some(event => event.previous_status === id);
    const isCurrent = currentId === id;
    const terminal = entry.workflow_behavior === 'COMPLETED' || [TaskStatus.DONE, TaskStatus.DEPLOYED].includes(id as TaskStatus);
    const recordedSeconds = stays.length && stays.every(visit => visit.seconds !== null)
      ? stays.reduce((total, visit) => total + visit.seconds!, 0) : null;
    const latest = stays.at(-1)?.event;
    // A reopened current checkpoint is active, even if it was left previously.
    const completed = isCurrent ? terminal : exited;
    const currentRows = entry.custom_status_id ? customEvents : [...events, ...customEvents].sort((a, b) => a.id - b.id);
    return { id, label: entry.title, icon: icons[id] || 'checkpoint', isCurrent, completed,
      recorded: stays.length > 0 || exited, pending: main && !exited && !isCurrent && historyComplete && pagesComplete && events.length > 0,
      recordedSeconds, enteredAt: stays[0]?.event.occurred_at, lastChangedAt: latest?.occurred_at,
      visits: stays.length, metadata: isCurrent ? { 'Current stay': duration(pagesComplete ? elapsedSeconds(currentStageStart(currentRows, id), now) : null) } : undefined };
  };
  return { main: mainEntries.map(entry => project(entry, true)), alternate: alternateEntries.map(entry => project(entry, false)) };
}
