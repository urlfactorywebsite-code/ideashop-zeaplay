import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  completeProgressTask,
  getLoadingSnapshot,
  resetProgress,
  setProgress,
  startLoading,
  startProgressTask,
  startTask,
  stopLoading,
  stopTask,
  subscribeToLoading,
  updateProgressTask,
  type LoadingSnapshot,
  type LoadingTaskOptions,
} from './loadingController';

type ProgressRenderState = {
  isVisible: boolean;
  progress: number;
  isDeterminate: boolean;
};

type LoadingContextValue = {
  state: ProgressRenderState;
  startLoading: (options?: LoadingTaskOptions) => string;
  stopLoading: (id?: string) => void;
  startTask: (idOrOptions?: string | LoadingTaskOptions) => string;
  stopTask: (id?: string) => void;
  setProgress: (value: number, id?: string) => void;
  resetProgress: (id?: string) => void;
  startProgressTask: (options?: LoadingTaskOptions) => string;
  updateProgressTask: (id: string, value: number) => void;
  completeProgressTask: (id: string) => void;
};

const SHOW_DELAY_MS = 100;
const MIN_VISIBLE_MS = 220;
const COMPLETE_HOLD_MS = 140;
const INITIAL_PROGRESS = 12;
const CRAWL_LIMIT = 90;

const LoadingContext = createContext<LoadingContextValue | undefined>(undefined);
const emptyServerSnapshot: LoadingSnapshot = { activeCount: 0, determinateProgress: null };

const useLoadingSnapshot = () =>
  useSyncExternalStore(subscribeToLoading, getLoadingSnapshot, () => emptyServerSnapshot);

const isModifiedClick = (event: MouseEvent) =>
  event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const RouteProgressTracker: React.FC = () => {
  const location = useLocation();
  const routeTaskRef = useRef<string | null>(null);
  const currentLocationRef = useRef(`${location.pathname}${location.search}${location.hash}`);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (isModifiedClick(event)) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.hasAttribute('download')) {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const targetUrl = new URL(anchor.href, window.location.href);
      if (targetUrl.origin !== currentUrl.origin || targetUrl.href === currentUrl.href) {
        return;
      }

      if (routeTaskRef.current) {
        stopTask(routeTaskRef.current);
      }
      routeTaskRef.current = startTask({ id: `route:${targetUrl.href}` });
    };

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => {
    const nextLocation = `${location.pathname}${location.search}${location.hash}`;
    if (nextLocation === currentLocationRef.current) {
      return;
    }
    currentLocationRef.current = nextLocation;

    if (routeTaskRef.current) {
      stopTask(routeTaskRef.current);
      routeTaskRef.current = null;
      return;
    }

    const taskId = startTask({ id: `route:settled:${nextLocation}` });
    window.setTimeout(() => stopTask(taskId), 160);
  }, [location]);

  useEffect(() => () => {
    if (routeTaskRef.current) {
      stopTask(routeTaskRef.current);
    }
  }, []);

  return null;
};

export const LoadingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const snapshot = useLoadingSnapshot();
  const [renderState, setRenderState] = useState<ProgressRenderState>({
    isVisible: false,
    progress: 0,
    isDeterminate: false,
  });
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const crawlTimerRef = useRef<number | null>(null);
  const visibleSinceRef = useRef<number>(0);

  const clearTimer = (timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const reveal = useCallback((isDeterminate: boolean, progress: number) => {
    clearTimer(hideTimerRef);
    visibleSinceRef.current = Date.now();
    setRenderState({
      isVisible: true,
      progress: Math.max(INITIAL_PROGRESS, progress),
      isDeterminate,
    });
  }, []);

  useEffect(() => {
    const hasActiveTasks = snapshot.activeCount > 0;
    const isDeterminate = snapshot.determinateProgress !== null;

    if (hasActiveTasks) {
      clearTimer(hideTimerRef);
      if (renderState.isVisible) {
        setRenderState((current) => ({
          ...current,
          isDeterminate,
          progress: isDeterminate
            ? snapshot.determinateProgress ?? current.progress
            : Math.max(current.progress, INITIAL_PROGRESS),
        }));
      } else if (showTimerRef.current === null) {
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null;
          const latest = getLoadingSnapshot();
          if (latest.activeCount > 0) {
            reveal(latest.determinateProgress !== null, latest.determinateProgress ?? INITIAL_PROGRESS);
          }
        }, SHOW_DELAY_MS);
      }
      return;
    }

    clearTimer(showTimerRef);
    clearTimer(crawlTimerRef);

    if (!renderState.isVisible) {
      return;
    }

    const elapsed = Date.now() - visibleSinceRef.current;
    const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
    hideTimerRef.current = window.setTimeout(() => {
      setRenderState((current) => ({ ...current, progress: 100 }));
      hideTimerRef.current = window.setTimeout(() => {
        setRenderState({ isVisible: false, progress: 0, isDeterminate: false });
        hideTimerRef.current = null;
      }, COMPLETE_HOLD_MS);
    }, delay);
  }, [reveal, renderState.isVisible, snapshot.activeCount, snapshot.determinateProgress]);

  useEffect(() => {
    clearTimer(crawlTimerRef);
    if (!renderState.isVisible || renderState.isDeterminate || snapshot.activeCount === 0) {
      return;
    }

    crawlTimerRef.current = window.setTimeout(() => {
      setRenderState((current) => {
        if (!current.isVisible || current.isDeterminate || current.progress >= CRAWL_LIMIT) {
          return current;
        }
        const distance = CRAWL_LIMIT - current.progress;
        const increment = Math.max(0.6, distance * 0.12);
        return { ...current, progress: Math.min(CRAWL_LIMIT, current.progress + increment) };
      });
    }, renderState.progress < 45 ? 260 : 520);
  }, [renderState.isDeterminate, renderState.isVisible, renderState.progress, snapshot.activeCount]);

  useEffect(() => () => {
    clearTimer(showTimerRef);
    clearTimer(hideTimerRef);
    clearTimer(crawlTimerRef);
  }, []);

  const value = useMemo<LoadingContextValue>(
    () => ({
      state: renderState,
      startLoading,
      stopLoading,
      startTask,
      stopTask,
      setProgress,
      resetProgress,
      startProgressTask,
      updateProgressTask,
      completeProgressTask,
    }),
    [renderState],
  );

  return (
    <LoadingContext.Provider value={value}>
      <RouteProgressTracker />
      {children}
    </LoadingContext.Provider>
  );
};

export const useGlobalLoadingContext = () => {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useGlobalLoading must be used within LoadingProvider');
  }
  return context;
};
