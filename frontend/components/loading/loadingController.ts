export type LoadingTaskOptions = {
  id?: string;
  determinate?: boolean;
  progress?: number;
  silent?: boolean;
};

export type LoadingSnapshot = {
  activeCount: number;
  determinateProgress: number | null;
};

type LoadingTask = {
  id: string;
  determinate: boolean;
  progress: number | null;
  silent: boolean;
};

const activeTasks = new Map<string, LoadingTask>();
const listeners = new Set<() => void>();
let taskSequence = 0;
let cachedSnapshot: LoadingSnapshot = {
  activeCount: 0,
  determinateProgress: null,
};

const clampProgress = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const createTaskId = () => {
  taskSequence += 1;
  return `global-load-${taskSequence}`;
};

const computeSnapshot = (): LoadingSnapshot => {
  const visibleTasks = Array.from(activeTasks.values()).filter((task) => !task.silent);
  const determinateTasks = visibleTasks.filter((task) => task.determinate && task.progress !== null);

  return {
    activeCount: visibleTasks.length,
    determinateProgress: determinateTasks.length
      ? Math.min(...determinateTasks.map((task) => task.progress ?? 0))
      : null,
  };
};

const emit = () => {
  const nextSnapshot = computeSnapshot();
  if (
    nextSnapshot.activeCount === cachedSnapshot.activeCount &&
    nextSnapshot.determinateProgress === cachedSnapshot.determinateProgress
  ) {
    return;
  }

  cachedSnapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
};

export const getLoadingSnapshot = (): LoadingSnapshot => cachedSnapshot;

export const subscribeToLoading = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const startTask = (idOrOptions?: string | LoadingTaskOptions): string => {
  const options = typeof idOrOptions === 'string' ? { id: idOrOptions } : idOrOptions ?? {};
  const id = options.id ?? createTaskId();

  activeTasks.set(id, {
    id,
    determinate: !!options.determinate,
    progress: options.determinate ? clampProgress(options.progress ?? 0) : null,
    silent: !!options.silent,
  });
  emit();
  return id;
};

export const stopTask = (id?: string) => {
  if (!id || !activeTasks.has(id)) {
    return;
  }
  activeTasks.delete(id);
  emit();
};

export const startLoading = (options?: LoadingTaskOptions) => startTask(options);

export const stopLoading = (id?: string) => {
  stopTask(id);
};

export const setProgress = (value: number, id?: string) => {
  const progress = clampProgress(value);
  if (id && activeTasks.has(id)) {
    const task = activeTasks.get(id);
    if (task) {
      activeTasks.set(id, { ...task, determinate: true, progress });
      emit();
    }
    return;
  }

  const determinateTask = Array.from(activeTasks.values()).find((task) => task.determinate && !task.silent);
  if (determinateTask) {
    activeTasks.set(determinateTask.id, { ...determinateTask, progress });
    emit();
  }
};

export const resetProgress = (id?: string) => {
  if (id && activeTasks.has(id)) {
    const task = activeTasks.get(id);
    if (task) {
      activeTasks.set(id, { ...task, determinate: false, progress: null });
      emit();
    }
    return;
  }

  activeTasks.forEach((task) => {
    if (task.determinate) {
      activeTasks.set(task.id, { ...task, determinate: false, progress: null });
    }
  });
  emit();
};

export const startProgressTask = (options: LoadingTaskOptions = {}) =>
  startTask({ ...options, determinate: true, progress: options.progress ?? 0 });

export const updateProgressTask = (id: string, value: number) => {
  setProgress(value, id);
};

export const completeProgressTask = (id: string) => {
  setProgress(100, id);
  window.setTimeout(() => stopTask(id), 120);
};
