import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/mockApi';
import type { ExecutionReport, ReportCompletion, ReportEvidence, ReportPage, ReportPageKind } from '../types/taskReport';
import { timestamp } from '../utils/taskJourney';
import type { TaskJourney } from '../types/taskLifecycle';

export interface ReportSnapshot {
  summary: ExecutionReport;
  completions: ReportPage<ReportCompletion>;
  completion: ReportPage<ReportEvidence>;
  linked: ReportPage<ReportEvidence>;
}

const merge = <T extends { id: string }>(first: ReportPage<T>, next: ReportPage<T>): ReportPage<T> => ({
  ...next, items: [...new Map([...first.items, ...next.items].map(row => [row.id, row])).values()],
});

async function readWindow<T extends { id: string }>(fetchPage: (cursor: string) => Promise<ReportPage<T>>, count: number) {
  let result = await fetchPage('');
  for (let page = 1; page < count && result.next_after_id !== null; page++) result = merge(result, await fetchPage(result.next_after_id));
  return result;
}

export function useTaskReport(taskId: string, revision: number, expected: Pick<TaskJourney, 'status' | 'subtasks'>) {
  const signature = useMemo(() => JSON.stringify([expected.status, expected.subtasks.map(row => [row.id, row.status]).sort()]),
    [expected.status, expected.subtasks]);
  const [data, setData] = useState<ReportSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ controller: AbortController | null; version: number }>({ controller: null, version: 0 });
  const windows = useRef({ completions: 1, completion: 1, linked: 1 });
  const loading = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    request.current.controller?.abort();
    const version = ++request.current.version;
    request.current.controller = controller;
    loading.current = true;
    setBusy(true);
    setError(null);
    setData(null); // No stale evidence remains visible during permission revalidation.
    void (async () => {
      try {
        const [summary, completions, completion, linked] = await Promise.all([
          api.getTaskExecutionReport(taskId, controller.signal),
          readWindow(cursor => api.getTaskReportCompletions(taskId, cursor, controller.signal), windows.current.completions),
          readWindow(cursor => api.getTaskReportEvidence(taskId, 'completion', cursor, controller.signal), windows.current.completion),
          readWindow(cursor => api.getTaskReportEvidence(taskId, 'linked', cursor, controller.signal), windows.current.linked),
        ]);
        if (summary.task_id !== taskId || timestamp(summary.as_of) === null) throw new Error('Invalid report');
        if (signature !== JSON.stringify([summary.task.status,
          summary.subtasks.filter(row => !row.deleted).map(row => [row.id, row.status]).sort()])) {
          throw new Error('Report changed');
        }
        const result: ReportSnapshot = { summary, completions, completion, linked };
        const children = new Set(summary.subtasks.map(row => row.id));
        for (const kind of ['completions', 'completion', 'linked'] as const) {
          if (result[kind].items.some(row => row.task_id !== taskId || row.subtask_id !== null && !children.has(row.subtask_id))) throw new Error('Invalid report target');
        }
        if (!controller.signal.aborted && version === request.current.version) setData(result);
      } catch (err) {
        if (!controller.signal.aborted && version === request.current.version) {
          controller.abort();
          setData(null);
          const status = (err as { response?: { status?: number } }).response?.status;
          setError([401, 403, 404].includes(status ?? 0) ? 'This report is no longer accessible.' :
            (err as Error).message === 'Report changed' ? 'Task state changed while loading. Refresh the task journey.' : 'Unable to load the execution report.');
        }
      } finally {
        if (version === request.current.version) { loading.current = false; setBusy(false); }
      }
    })();
    return () => { controller.abort(); ++request.current.version; };
  }, [taskId, revision, retry, signature]);

  const loadMore = useCallback(async (kind: ReportPageKind) => {
    if (!data || loading.current || data[kind].next_after_id === null) return;
    const controller = new AbortController();
    const version = ++request.current.version;
    request.current.controller = controller;
    loading.current = true;
    setBusy(true);
    try {
      if (kind === 'completions') {
        const next = await api.getTaskReportCompletions(taskId, data.completions.next_after_id!, controller.signal);
        if (next.items.some(row => row.task_id !== taskId || !data.summary.subtasks.some(child => child.id === row.subtask_id))) throw new Error('Invalid report target');
        if (controller.signal.aborted || version !== request.current.version) return;
        setData(previous => previous ? { ...previous, completions: merge(previous.completions, next) } : null);
      } else {
        const next = await api.getTaskReportEvidence(taskId, kind, data[kind].next_after_id!, controller.signal);
        if (next.items.some(row => row.task_id !== taskId || row.subtask_id !== null && !data.summary.subtasks.some(child => child.id === row.subtask_id))) throw new Error('Invalid report target');
        if (controller.signal.aborted || version !== request.current.version) return;
        setData(previous => previous ? { ...previous, [kind]: merge(previous[kind], next) } : null);
      }
      windows.current[kind]++;
    } catch {
      if (!controller.signal.aborted && version === request.current.version) {
        setData(null);
        setError('Unable to load more report records. Access may have changed.');
      }
    } finally {
      if (version === request.current.version) { loading.current = false; setBusy(false); }
    }
  }, [data, taskId]);

  useEffect(() => () => { request.current.controller?.abort(); }, []);
  return { data, busy, error, loadMore, retry: () => setRetry(value => value + 1) };
}
