import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Download, Eye, FileImage, FileText, X } from 'lucide-react';
import api from '../services/mockApi';
import { useTaskReport } from '../hooks/useTaskReport';
import type { ExecutionEntity, ReportEvidence } from '../types/taskReport';
import type { TaskJourney } from '../types/taskLifecycle';
import { duration, exactTimestamp, timestamp } from '../utils/taskJourney';
import { completionOrder, evidenceBytes, reportLabel, reportLifetime, reportName, safeFilename } from '../utils/taskReport';

function Stamp({ value }: { value: string | null }) {
  return timestamp(value) === null ? <span className="journey-muted">Not recorded</span> : <time dateTime={value!}>{exactTimestamp(value)}</time>;
}

function EntityFacts({ row }: { row: ExecutionEntity }) {
  return <>
    <dl className="journey-facts report-facts">
      <div><dt>Creator</dt><dd>{reportName(row.creator)}</dd></div>
      <div><dt>Assignee</dt><dd>{reportName(row.assignee)}</dd></div>
      <div><dt>Created</dt><dd><Stamp value={row.created_at} /></dd></div>
      <div><dt>First recorded start</dt><dd><Stamp value={row.first_started_at} /></dd></div>
      <div><dt>First retained session</dt><dd><Stamp value={row.first_session_started_at} /></dd></div>
      <div><dt>Latest historical completion</dt><dd><Stamp value={row.last_completed_at} /></dd></div>
      <div><dt>Final completion</dt><dd><Stamp value={row.final_completed_at} />{row.final_completion_source === 'task_record' && <small className="journey-muted"> | Stored task timestamp</small>}</dd></div>
    </dl>
    <dl className="report-counts">
      <div><dt>Sessions</dt><dd>{row.time.session_count}</dd></div>
      <div><dt>Start / Resume / Restart events</dt><dd>{row.event_counts['timer.started'] || 0} / {row.event_counts['timer.resumed'] || 0} / {row.event_counts['timer.restarted'] || 0}</dd></div>
      <div><dt>Stop / Pause events</dt><dd>{row.event_counts['timer.stopped'] || 0} / {row.event_counts['timer.paused'] || 0}</dd></div>
      <div><dt>Completions / Reopens</dt><dd>{row.completion_count} / {row.reopened_count}</dd></div>
      <div><dt>Linked pause intervals</dt><dd>{duration(row.linked_paused_seconds)}</dd></div>
      <div><dt>Unresolved pauses</dt><dd>{row.unresolved_pause_count}</dd></div>
    </dl>
  </>;
}

function EvidenceGallery({ taskId, rows, revision, targetName }: {
  taskId: string; rows: ReportEvidence[]; revision: object; targetName: (id: string | null) => string;
}) {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string; row: ReportEvidence } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const downloadTimers = useRef(new Set<number>());
  const close = () => {
    if (preview) { URL.revokeObjectURL(preview.url); urls.current.delete(preview.url); }
    setPreview(null);
  };
  useEffect(() => {
    setPreview(null);
    setBusy(null);
    setError(null);
    return () => {
      request.current?.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      for (const timer of downloadTimers.current) window.clearTimeout(timer);
      urls.current.clear();
      downloadTimers.current.clear();
    };
  }, [taskId, revision]);

  const openFile = async (row: ReportEvidence, inline: boolean) => {
    if (busy || row.source === 'unverified') return;
    close();
    const controller = new AbortController();
    request.current = controller;
    setBusy(`${row.source}:${row.id}`);
    setError(null);
    try {
      const blob = await api.getTaskReportFile(taskId, row.source, row.id, inline, controller.signal);
      if (controller.signal.aborted) return;
      if (inline && !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'].includes(blob.type)) throw new Error('Unsupported preview');
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const name = safeFilename(row.filename);
      if (inline) setPreview({ url, mime: blob.type, name, row });
      else {
        const link = document.createElement('a');
        link.href = url; link.download = name;
        document.body.append(link); link.click(); link.remove();
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); downloadTimers.current.delete(timer); }, 1000);
        downloadTimers.current.add(timer);
      }
    } catch {
      if (!controller.signal.aborted) setError('The file is unavailable or access has changed. Refresh the report to check again.');
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  return <>
    {error && <p className="journey-notice" role="alert">{error}</p>}
    {!rows.length ? <p className="journey-muted">No accessible evidence is recorded.</p> : <ul className="report-evidence">
      {rows.map((row, index) => <li key={`${row.source}:${row.id}:${index}`}>
        <div className="report-evidence-heading">{row.mime_type?.startsWith('image/') ? <FileImage size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}
          <strong>{row.filename || 'Unverified attachment link'}</strong></div>
        <p className="journey-muted">{reportLabel(row.availability)} | {evidenceBytes(row.size_bytes)}</p>
        <dl><div><dt>Uploader</dt><dd>{reportName(row.uploaded_by)}</dd></div>
          <div><dt>Uploaded</dt><dd><Stamp value={row.uploaded_at} /></dd></div>
          <div><dt>Related work</dt><dd>{targetName(row.subtask_id)}</dd></div></dl>
        {row.submission_id && <p className="journey-id">Submission {row.submission_id}</p>}
        <div className="report-evidence-actions">
          {row.can_preview && <button className="journey-icon" type="button" title={`Preview ${row.filename}`} aria-label={`Preview ${row.filename}`} disabled={busy !== null} onClick={() => void openFile(row, true)}><Eye size={17} /></button>}
          {row.can_download && <button className="journey-icon" type="button" title={`Download ${row.filename}`} aria-label={`Download ${row.filename}`} disabled={busy !== null} onClick={() => void openFile(row, false)}><Download size={17} /></button>}
          {busy === `${row.source}:${row.id}` && <span role="status">Opening file...</span>}
        </div>
      </li>)}
    </ul>}
    <Dialog open={Boolean(preview)} onClose={close} className="task-journey report-preview">
      <DialogBackdrop className="journey-backdrop" />
      <div className="journey-position"><DialogPanel className="journey-panel">
        <header className="journey-modal-header"><DialogTitle>{preview?.name}</DialogTitle>
          {preview && <button className="journey-icon" type="button" title="Download evidence" aria-label="Download evidence" onClick={() => void openFile(preview.row, false)} disabled={busy !== null}><Download size={17} /></button>}
          <button className="journey-icon" type="button" title="Close evidence preview" aria-label="Close evidence preview" onClick={close}><X size={20} /></button></header>
        {preview && (preview.mime === 'application/pdf'
          // Only server-validated application/pdf Blobs reach the native PDF viewer.
          // An HTML iframe sandbox disables Chromium's PDF viewer, not just scripts.
          ? <iframe title={preview.name} src={preview.url} referrerPolicy="no-referrer" className="report-pdf" />
          : <img className="report-image" src={preview.url} alt={preview.name} />)}
      </DialogPanel></div>
    </Dialog>
  </>;
}

export default function TaskExecutionReport({ taskId, revision, expected, renderHistory, historyFooter }: {
  taskId: string; revision: number; expected: Pick<TaskJourney, 'status' | 'subtasks'>;
  renderHistory: (id: string | null) => React.ReactNode; historyFooter: React.ReactNode;
}) {
  const { data, busy, error, loadMore, retry } = useTaskReport(taskId, revision, expected);
  const [visible, setVisible] = useState(25);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const completions = useMemo(() => completionOrder(data?.completions.items ?? []), [data?.completions.items]);
  const childNames = useMemo(() => new Map(data?.summary.subtasks.map(row => [row.id, row.title || 'Removed subtask'])), [data?.summary.subtasks]);
  const targetName = (id: string | null) => id ? childNames.get(id) || `Subtask ${id}` : 'Main task';
  if (error) return <div role="alert" className="journey-error"><p>{error}</p><button type="button" onClick={retry}>Retry report</button></div>;
  if (!data) return <div role="status" className="journey-loading">Loading execution report...</div>;
  const { summary } = data;
  const allEvidence = [...data.completion.items, ...data.linked.items];
  return <div className="task-execution-report" aria-busy={busy}>
    <section className="journey-heading" aria-labelledby="execution-report-title">
      <div className="journey-title-row"><h2 id="execution-report-title">{summary.task.title || 'Task execution report'}</h2><span className="journey-status">{reportLabel(summary.task.status || 'Unknown')}</span></div>
      <p className="journey-id">Task {taskId}</p>
      <EntityFacts row={summary.task} />
      <p className="journey-sync journey-muted">Snapshot <Stamp value={summary.as_of} /></p>
      {!summary.history_complete && <p className="journey-notice">History is incomplete. Capture began <Stamp value={summary.capture_started_at} />. Unrecorded times and evidence remain unknown.</p>}
      {summary.deleted_session_count > 0 && <p className="journey-notice">{summary.deleted_session_count} session deletion events recorded. Totals include retained sessions only.</p>}
    </section>
    <section className="journey-section" aria-labelledby="report-time-title"><h3 id="report-time-title">Execution summary</h3>
      <dl className="journey-metrics">
        <div><dt>Direct main-task work</dt><dd>{duration(summary.direct.person_seconds)}</dd></div>
        <div><dt>Subtask work</dt><dd>{duration(summary.children.person_seconds)}</dd></div>
        <div><dt>Combined person-time</dt><dd>{duration(summary.aggregate.person_seconds)}</dd></div>
        <div><dt>Task lifetime</dt><dd>{duration(reportLifetime(summary.task, summary.as_of))}</dd></div>
      </dl>
      <p className="journey-totals">Elapsed work: <strong>{duration(summary.aggregate.elapsed_seconds)}</strong> Retained sessions: <strong>{summary.aggregate.session_count}</strong> Open: <strong>{summary.aggregate.active_session_count}</strong> Overlap excluded: <strong>{duration(Math.max(0, summary.aggregate.raw_session_seconds - summary.aggregate.person_seconds))}</strong></p>
      <p className="journey-reason">Combined time removes same-person overlaps across parent and subtask work. Pause totals only include explicit linked pause/resume intervals. Counts reflect captured events, not unrecorded historical actions.</p>
    </section>
    <section className="journey-section" aria-labelledby="report-parent-history"><h3 id="report-parent-history">Main-task history and work sessions</h3>{renderHistory(null)}</section>
    <section className="journey-section" aria-labelledby="report-subtasks-title"><h3 id="report-subtasks-title">Subtask execution ({summary.subtasks.length})</h3>
      {!summary.subtasks.length && <p className="journey-muted">No subtasks recorded.</p>}
      {summary.subtasks.slice(0, visible).map(row => <details className="journey-child" key={row.id} onToggle={event => {
        if (event.target !== event.currentTarget) return;
        const open = event.currentTarget.open;
        setExpanded(previous => { const next = new Set(previous); if (open) next.add(row.id); else next.delete(row.id); return next; });
      }}><summary><span>{row.title || 'Removed subtask'}<small>{reportName(row.assignee)}</small></span><span className="journey-status">{row.deleted ? 'Removed' : reportLabel(row.status || 'Unknown')}</span><span className="journey-mono">{duration(row.time.person_seconds)}</span></summary>
        {expanded.has(row.id) && <div className="journey-child-body"><EntityFacts row={row} />{renderHistory(row.id)}</div>}
      </details>)}
      {summary.subtasks.length > visible && <button type="button" onClick={() => setVisible(value => value + 25)}>Show more subtasks</button>}
    </section>
    <section className="journey-section" aria-labelledby="report-completions-title"><h3 id="report-completions-title">Completion submissions and review decisions</h3>
      <p className="journey-muted">{completions.length} attempts loaded{data.completions.next_after_id !== null ? ' | More history available' : ''}</p>
      {!completions.length && <p className="journey-muted">No retained completion submissions.</p>}
      <ol className="report-completions">{completions.map(row => <li key={row.id}>
        <div className="journey-transition-heading"><strong>{targetName(row.subtask_id)} | Attempt {row.attempt_number}</strong><span className="journey-status">{reportLabel(row.status)}</span></div>
        <p className="journey-reason">{row.description}</p>
        <div className="journey-event-meta"><Stamp value={row.created_at} /><span>Submitted by {reportName(row.submitted_by)}</span><span>{row.approval_required ? 'Approval required' : 'Approval not required'}</span></div>
        {row.reviewed_at && <div className="journey-event-meta"><Stamp value={row.reviewed_at} /><span>Reviewed by {reportName(row.reviewed_by)}</span></div>}
        {row.review_reason && <p className="journey-reason">Review: {row.review_reason}</p>}
      </li>)}</ol>
      {data.completions.next_after_id !== null && <button type="button" disabled={busy} onClick={() => void loadMore('completions')}>Load more completion attempts</button>}
    </section>
    <section className="journey-section" aria-labelledby="report-evidence-title"><h3 id="report-evidence-title">Evidence gallery</h3>
      <EvidenceGallery taskId={taskId} rows={allEvidence} revision={data.summary} targetName={targetName} />
      <div className="report-load-actions">{(['completion', 'linked'] as const).map(kind => data[kind].next_after_id !== null && <button type="button" key={kind} disabled={busy} onClick={() => void loadMore(kind)}>Load more {kind === 'completion' ? 'proof files' : 'task attachments'}</button>)}</div>
    </section>
    {historyFooter}
  </div>;
}
