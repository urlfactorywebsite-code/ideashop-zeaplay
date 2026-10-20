import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { TaskStatus, CUSTOM_STATUS_NAMES } from '../types';
import { reportingApi } from '../services/reportingApi';
import type { ReportingFilters, ReportingMeta, ReportingOverview, ReportingQuery, ReportingRow, ReportPreset, ReportSection } from '../types/reporting';
import { numberValue, previousReportingPeriod, reportError, reportingDates, reportingDuration, reportingFiltersFromUrl, reportingSearchParams, reportingTaskLink, reportSections, reportTimezone, validateReportingDates } from '../utils/reporting';
import './Reports.css';

const LABELS: Record<ReportSection, string> = {
  overview: 'Overview', employees: 'Employees', tasks: 'Tasks & assignments', statuses: 'Task statuses',
  projects: 'Projects', activity: 'Date-wise activity', time: 'Time tracking',
};
const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'last7', label: 'Last 7 days' },
  { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom date range' },
];
const STATUS_COLOR: Record<string, string> = Object.fromEntries(Object.entries({
  WAITING_FOR_REQUIREMENT: 'battle', TODO: 'case', IN_PROGRESS: 'progress', BUG_FIXING: 'boss',
  BLOCKED: 'boss', IN_REVIEW: 'tactical', ON_HOLD: 'hold', DONE: 'conquered', DEPLOYED: 'conquered',
  FAILED: 'fallen', GRAVEYARD: 'graveyard',
}).map(([status, token]) => [status, `var(--color-stage-${token})`]));
const statusLabel = (status: string) => `${status.replace(/_/g, ' ')}${CUSTOM_STATUS_NAMES[status as TaskStatus]?.name ? ` · ${CUSTOM_STATUS_NAMES[status as TaskStatus].name}` : ''}`;
const int = (value: unknown) => numberValue(value).toLocaleString();
const present = (value: unknown) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
interface Column { key: string; label: string; sort?: boolean; kind?: 'status' | 'date' | 'percent' | 'duration' | 'people' | 'boolean' }
const c = (key: string, label: string, sort = false, kind?: Column['kind']): Column => ({ key, label, sort, kind });
const COLUMNS: Record<Exclude<ReportSection, 'overview'>, Column[]> = {
  employees: [
    c('name', 'Employee', true), c('email', 'Email'), c('status', 'Account'),
    c('assigned_parent_tasks', 'Parent assignments', true), c('assigned_subtasks', 'Subtask assignments'),
    c('completed_parent_tasks', 'Completed', true), c('in_progress_parent_tasks', 'In progress'),
    c('pending_parent_tasks', 'Pending'), c('blocked_parent_tasks', 'Blocked'), c('overdue_parent_tasks', 'Overdue', true),
    c('completion_percentage', 'Completion', false, 'percent'), c('project_count', 'Projects'),
    c('recorded_effort_seconds', 'Recorded effort', true, 'duration'),
    c('active_assignments', 'Active assignments'), c('completed_assignments', 'Completed assignments'),
  ],
  tasks: [
    c('title', 'Parent task', true), c('status', 'Persisted status', true, 'status'),
    c('assignee_name', 'Assigned employee'), c('project_name', 'Project'), c('project_status', 'Project status'),
    c('created_at', 'Created', true, 'date'), c('assigned_at', 'Assigned', true, 'date'),
    c('due_at', 'Due', true, 'date'), c('completed_at', 'Completed', false, 'date'),
    c('total_subtasks', 'Subtasks'), c('completed_subtasks', 'Completed subtasks'), c('overdue', 'Overdue', false, 'boolean'),
  ],
  statuses: [
    c('status', 'Persisted parent status', true, 'status'), c('count', 'Unique tasks', true),
    c('percentage', 'Share', false, 'percent'), c('project_count', 'Projects'),
    c('employee_count', 'Employees'), c('overdue_tasks', 'Overdue'),
  ],
  projects: [
    c('name', 'Project', true), c('client_name', 'Client / company'), c('status', 'Project status'),
    c('manager_count', 'Manager count'), c('managers', 'Managers (preview)', false, 'people'), c('member_count', 'Member count'), c('members', 'Members (preview)', false, 'people'),
    c('members_truncated', 'Name preview truncated', false, 'boolean'),
    c('start_date', 'Start', false, 'date'), c('end_date', 'End', false, 'date'),
    c('total_tasks', 'Unique tasks', true), c('completed_tasks', 'Completed', true),
    c('in_progress_tasks', 'In progress'), c('pending_tasks', 'Pending'), c('blocked_tasks', 'Blocked'),
    c('overdue_tasks', 'Overdue', true), c('completion_percentage', 'Completion', false, 'percent'),
    c('total_subtasks', 'Subtasks'), c('completed_subtasks', 'Completed subtasks'),
    c('recorded_effort_seconds', 'Recorded effort', true, 'duration'),
  ],
  activity: [
    c('date', 'Period', true), c('tasks_created', 'Tasks created', true),
    c('tasks_started', 'Tasks started'), c('tasks_completed', 'Task completions'), c('tasks_reopened', 'Tasks reopened'),
    c('subtasks_completed', 'Subtask completions'), c('work_sessions_started', 'Sessions started'), c('work_intervals_started', 'Active intervals started'),
    c('recorded_effort_seconds', 'Recorded effort', false, 'duration'), c('unique_working_seconds', 'Unique working time', false, 'duration'),
  ],
  time: [
    c('name', 'Employee', true), c('recorded_effort_seconds', 'Recorded task effort', true, 'duration'),
    c('unique_working_seconds', 'Unique working time', true, 'duration'), c('interval_count', 'Active intervals', true),
    c('running_interval_count', 'Running intervals', true), c('paused_interval_count', 'Paused intervals', true), c('resumed_interval_count', 'Resumed intervals', true),
  ],
};
const SESSION_COLUMNS: Column[] = [
  c('employee_name', 'Employee', true), c('task_title', 'Parent task', true), c('subtask_title', 'Subtask'), c('project_name', 'Project'),
  c('state', 'Session state'), c('started_at', 'Started', true, 'date'), c('stopped_at', 'Stopped', false, 'date'),
  c('recorded_effort_seconds', 'Recorded effort', true, 'duration'), c('start_kind', 'Start / resume'),
  c('stop_reason', 'Stop reason'), c('resumed_at', 'Resumed', false, 'date'), c('paused_seconds', 'Observed pause', false, 'duration'),
];

function useReportResource<T>(key: string, enabled: boolean, request: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; busy: boolean; error: string | null }>({ key, data: null, busy: enabled, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) { setState({ key, data: null, busy: false, error: null }); return; }
    setState({ key, data: null, busy: true, error: null });
    request(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, busy: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, data: null, busy: false, error: reportError(error) });
    });
    return () => controller.abort();
  }, [key, enabled, retry]);
  return { ...(state.key === key ? state : { data: null, busy: enabled, error: null }), retry: () => setRetry(n => n + 1) };
}

function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="report-error"><span>{message}</span>{retry && <button type="button" onClick={retry}>Try again</button>}</div>;
}
function Loading({ label = 'Loading report' }: { label?: string }) {
  return <div className="report-loading" role="status" aria-live="polite"><span>{label}…</span><div /><div /><div /></div>;
}
function Empty({ text = 'No records match these filters.' }: { text?: string }) {
  return <div className="report-empty"><strong>No report data</strong><p>{text}</p></div>;
}
function Meta({ meta }: { meta?: ReportingMeta }) {
  if (!meta) return null;
  return <div className="report-meta">
    <p>Snapshot: {new Date(meta.as_of).toLocaleString(undefined, { timeZone: meta.timezone })} · {meta.timezone} · {meta.from} through {meta.to}</p>
    {meta.limitations?.length ? <details><summary>Data coverage and limitations</summary><ul>{meta.limitations.map(text => <li key={text}>{text}</li>)}</ul></details> : null}
  </div>;
}
function displayCell(row: ReportingRow, column: Column, timezone: string): React.ReactNode {
  const value = row[column.key];
  if (column.key === 'assignee_name' && row.assigned_to_id === null && !row.assignment_redacted) return 'Unassigned';
  if (value === undefined || value === null) return <span className="report-muted">Not recorded</span>;
  if (column.kind === 'people') return Array.isArray(value) ? value.map(person => person.name).join(', ') || 'None' : present(value);
  if (column.kind === 'duration') return reportingDuration(numberValue(value));
  if (column.kind === 'percent') return `${numberValue(value).toFixed(1)}%`;
  if (column.kind === 'boolean') return value ? 'Yes' : 'No';
  if (column.kind === 'date') {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  }
  if (column.kind === 'status') return <span className="report-status" style={{ borderColor: STATUS_COLOR[String(value)] || 'var(--color-border-color)' }}>{statusLabel(String(value))}</span>;
  if (typeof value === 'number') return int(value);
  if (value === 'ARCHIVED' || value === 'INACTIVE') return <span className="report-archived">{value}</span>;
  return present(value);
}
function DataTable({ items, columns, timezone, sort = '', direction = 'asc', onSort, onRow, rowLabel }: {
  items: ReportingRow[]; columns: Column[]; timezone: string; sort?: string; direction?: string;
  onSort?: (key: string) => void; onRow?: (row: ReportingRow) => void; rowLabel?: string;
}) {
  const location = useLocation();
  if (!items.length) return <Empty />;
  return <div className="report-table-scroll" tabIndex={0} aria-label="Report table; scroll horizontally for more columns">
    <table className="report-table"><thead><tr>{columns.map(column => <th key={column.key} scope="col"
      aria-sort={sort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
      {column.sort && onSort ? <button type="button" onClick={() => onSort(column.key)}>{column.label}<span aria-hidden="true">{sort === column.key ? direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button> : column.label}
    </th>)}</tr></thead><tbody>{items.map((row, index) => <tr key={String(row.id || row.employee_id || row.project_id || row.status || row.date || index)}>
      {columns.map((column, columnIndex) => <td key={column.key}>{columnIndex === 0 && onRow
        ? <button type="button" className="report-link" onClick={() => onRow(row)} aria-label={`${rowLabel || 'View details for'} ${present(row[column.key])}`}>{displayCell(row, column, timezone)}</button>
        : column.key === 'title' && row.id ? <Link className="report-link" to={reportingTaskLink(location.search, row)}>{displayCell(row, column, timezone)}</Link>
          : displayCell(row, column, timezone)}</td>)}
    </tr>)}</tbody></table>
  </div>;
}
function Pagination({ page, pageSize, total, totalPages, onPage, onSize }: {
  page: number; pageSize: number; total: number; totalPages: number; onPage: (page: number) => void; onSize?: (size: number) => void;
}) {
  return <div className="report-pagination">
    <span>{int(total)} records · Page {page} of {Math.max(1, totalPages)}</span>
    <div>{onSize && <label>Rows <select aria-label="Rows per page" value={pageSize} onChange={event => onSize(Number(event.target.value))}>{[10, 25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>}
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button></div>
  </div>;
}
function SearchPicker({ label, selected, onChange, options, total, busy, search, setSearch, page, setPage }: {
  label: string; selected?: string; onChange: (id: string) => void;
  options: { id: string; name: string; status: string }[]; total: number; busy: boolean;
  search: string; setSearch: (text: string) => void; page: number; setPage: (page: number) => void;
}) {
  return <div className="report-picker">
    <label>{label}<input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={search}
      onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    <select aria-label={label} value={selected || ''} onChange={event => onChange(event.target.value)}>
      <option value="">All authorized {label.toLowerCase()}</option>
      {selected && !options.some(option => option.id === selected) && <option value={selected}>Selected record</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.name}{option.status !== 'ACTIVE' ? ` (${option.status.toLowerCase()})` : ''}</option>)}
    </select>
    <div className="report-picker-meta"><span>{busy ? 'Searching…' : `${options.length} of ${total}`}</span>
      <button type="button" aria-label={`Previous ${label.toLowerCase()}`} disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>‹</button>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={!options.length || page * 100 >= total || busy} onClick={() => setPage(page + 1)}>›</button>
    </div>
  </div>;
}
function Overview({ data, onFilter }: { data: ReportingOverview; onFilter: (key: 'status' | 'employee_id' | 'project_id', value: string) => void }) {
  const metricLabels: [string, string][] = [
    ['total_tasks', 'Unique parent tasks'], ['assigned_tasks', 'Assigned tasks'], ['unassigned_tasks', 'Unassigned tasks'],
    ['completed_tasks', 'Completed tasks'], ['in_progress_tasks', 'In progress'], ['pending_tasks', 'Pending tasks'],
    ['blocked_tasks', 'Blocked tasks'], ['overdue_tasks', 'Overdue tasks'], ['completion_percentage', 'Completion'],
    ['total_projects', 'Projects in scope'], ['employees_with_assigned_work', 'Employees with work'], ['assignment_count', 'Assignment records'],
  ];
  return <>
    <div className="report-kpis">{metricLabels.map(([key, label]) => <article key={key}><span>{label}</span><strong>{key === 'completion_percentage' ? `${numberValue(data.metrics[key]).toFixed(1)}%` : int(data.metrics[key])}</strong></article>)}</div>
    <div className="report-chart-grid">
      <section className="report-panel"><h2>Parent task status</h2><p>Persisted task status; click a segment or status to filter.</p>
        {data.status_distribution.some(row => row.count > 0) ? <>
          <div className="report-chart"><ResponsiveContainer width="100%" height="100%"><PieChart>
            <Pie data={data.status_distribution} dataKey="count" nameKey="status" innerRadius={62} outerRadius={95} paddingAngle={2}
              isAnimationActive={false} onClick={entry => onFilter('status', entry.status)}>
              {data.status_distribution.map(row => <Cell key={row.status} fill={STATUS_COLOR[row.status]} />)}
            </Pie><Tooltip contentStyle={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-color)', color: 'var(--color-text-primary)' }} />
          </PieChart></ResponsiveContainer></div>
          <div className="report-legend">{data.status_distribution.filter(row => row.count).map(row => <button key={row.status} type="button" onClick={() => onFilter('status', row.status)}>
            <i style={{ background: STATUS_COLOR[row.status] }} />{row.status.replace(/_/g, ' ')} <strong>{int(row.count)}</strong>
          </button>)}</div>
        </> : <Empty />}
      </section>
      <section className="report-panel"><h2>Employee workload</h2><p>Parent assignment records per employee.</p>
        {data.employee_workload.length ? <><div className="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.employee_workload.slice(0, 10)} layout="vertical" margin={{ left: 15, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-color)" horizontal={false} /><XAxis type="number" allowDecimals={false} stroke="var(--color-text-secondary)" />
          <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" /><Tooltip contentStyle={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-color)' }} />
          <Bar dataKey="assigned_parent_tasks" name="Assigned parent tasks" fill="#38bdf8" maxBarSize={32} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(_, index) => onFilter('employee_id', data.employee_workload[index].employee_id)} />
        </BarChart></ResponsiveContainer></div><div className="report-chart-links">{data.employee_workload.slice(0, 10).map(row => <button key={row.employee_id} type="button" onClick={() => onFilter('employee_id', row.employee_id)}>{row.name}</button>)}</div></> : <Empty />}
      </section>
      <section className="report-panel report-wide"><h2>Project completion</h2><p>Completed persisted parent tasks divided by project task count. Archived does not mean completed.</p>
        {data.project_completion.length ? <div className="report-project-progress">{data.project_completion.map(row => <button key={row.project_id} type="button" onClick={() => onFilter('project_id', row.project_id)}>
          <span>{row.name}</span><progress max="100" value={row.completion_percentage} aria-label={`${row.name} completion`} /><strong>{row.completion_percentage.toFixed(1)}%</strong><small>{row.completed_tasks} / {row.total_tasks}</small>
        </button>)}</div> : <Empty />}
      </section>
    </div>
  </>;
}
function ActivityChart({ rows }: { rows: ReportingRow[] }) {
  if (!rows.length) return <Empty />;
  return <div className="report-chart report-chart-large"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ left: 0, right: 20, bottom: 5 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-color)" /><XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
    <YAxis allowDecimals={false} stroke="var(--color-text-secondary)" /><Tooltip contentStyle={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-color)' }} />
    <Line dataKey="tasks_created" name="Created" stroke="#38bdf8" strokeWidth={2} isAnimationActive={false} />
    <Line dataKey="tasks_completed" name="Completion events" stroke="#4ade80" strokeWidth={2} isAnimationActive={false} />
    <Line dataKey="tasks_reopened" name="Reopened" stroke="#f59e0b" isAnimationActive={false} />
  </LineChart></ResponsiveContainer></div>;
}
function ActivityComparison({ filters, totals }: { filters: ReportingFilters; totals?: Record<string, number> }) {
  const previous = previousReportingPeriod(filters);
  const resource = useReportResource(JSON.stringify(previous), true, signal => reportingApi.page('activity', { ...previous, page_size: 1 }, signal));
  return <div className="report-comparison"><h3>Compared with the previous period</h3><p>{previous.from} through {previous.to} · same filters and number of calendar days</p>
    {resource.busy && <Loading label="Loading comparison" />}{resource.error && <ErrorBox message={resource.error} retry={resource.retry} />}
    {resource.data && totals && <div className="report-comparison-grid">{[['tasks_created', 'Tasks created'], ['tasks_completed', 'Completion events'], ['tasks_reopened', 'Reopen events']].map(([key, label]) => {
      const current = numberValue(totals[key]); const prior = numberValue(resource.data?.totals?.[key]); const delta = current - prior;
      return <article key={key}><span>{label}</span><strong>{current} <small>vs {prior}</small></strong><span>{delta > 0 ? '+' : ''}{delta} observed events</span></article>;
    })}</div>}
    <p>History coverage applies to both periods; missing legacy events are not reconstructed.</p>
  </div>;
}
function WorkSessions({ query }: { query: ReportingQuery }) {
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(false);
  const [sort, setSort] = useState('started_at');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const params = { ...query, active, page, page_size: 10, sort, direction };
  const resource = useReportResource(JSON.stringify(params), true, signal => reportingApi.sessions(params, signal));
  return <section className="report-panel">
    <div className="report-panel-heading"><div><h2>Work-session history</h2><p>Active intervals and observed pause / resume links. Multiple running timers are shown independently.</p></div>
      <label><input type="checkbox" checked={active} onChange={event => { setActive(event.target.checked); setPage(1); }} /> Active timers only</label></div>
    {resource.busy && <Loading />}{resource.error && <ErrorBox message={resource.error} retry={resource.retry} />}
    {resource.data && <>
      <DataTable items={resource.data.items} columns={SESSION_COLUMNS} timezone={query.timezone} sort={sort} direction={direction}
        onSort={key => { setSort(key); setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc'); setPage(1); }} />
      <Pagination page={page} pageSize={10} total={resource.data.total} totalPages={resource.data.total_pages} onPage={setPage} />
      <Meta meta={resource.data.meta} />
    </>}
  </section>;
}
function TimeSummary({ values }: { values?: Record<string, number> }) {
  if (!values) return null;
  return <div className="report-kpis report-time-kpis">
    <article><span>Recorded task effort</span><strong>{reportingDuration(values.recorded_effort_seconds)}</strong></article>
    <article><span>Unique working time</span><strong>{reportingDuration(values.unique_working_seconds)}</strong></article>
    <article><span>Active intervals</span><strong>{int(values.interval_count)}</strong></article>
    <article><span>Running intervals</span><strong>{int(values.running_interval_count)}</strong></article>
  </div>;
}
function DetailPanel({ target, query, onClose, onExplore }: { target: { section: 'employees' | 'projects'; id: string }; query: ReportingQuery; onClose: () => void; onExplore: (section: 'activity' | 'time') => void }) {
  const [page, setPage] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const detailQuery = { ...query, page, page_size: 10, sort: '' };
  const resource = useReportResource(JSON.stringify([target, detailQuery]), true, signal => reportingApi.detail(target.section, target.id, detailQuery, signal));
  const timeQuery: ReportingQuery = { ...query, [target.section === 'employees' ? 'employee_id' : 'project_id']: target.id, page: 1, page_size: 10, sort: '', group_by: 'task' };
  const work = useReportResource(JSON.stringify([target, timeQuery]), true, signal => reportingApi.page('time', timeQuery, signal));
  useEffect(() => { closeRef.current?.focus(); }, []);
  const data = resource.data;
  const entity = data?.employee || data?.project;
  return <section className="report-panel report-detail" aria-label={`${target.section === 'employees' ? 'Employee' : 'Project'} detail`}>
    <div className="report-panel-heading"><div><span className="report-eyebrow">Detailed report</span><h2>{entity ? present(entity.name) : 'Loading details'}</h2></div><div className="report-export"><button type="button" onClick={() => onExplore('activity')}>View date-wise activity</button><button type="button" onClick={() => onExplore('time')}>View work breakdown</button><button type="button" ref={closeRef} onClick={onClose}>Close details</button></div></div>
    {resource.busy && <Loading />}
    {resource.error && <ErrorBox message={resource.error} retry={resource.retry} />}
    {data && <>
      {entity && <DataTable items={[entity]} columns={COLUMNS[target.section]} timezone={query.timezone} />}
      {data.projects && <div className="report-detail-projects"><h3>Associated projects ({data.projects_total ?? data.projects.length})</h3>{data.projects.length ? data.projects.map(project => <span key={String(project.id)}>{present(project.name)} {project.status === 'ARCHIVED' ? '(archived)' : ''}</span>) : <p>No projects in this report scope.</p>}{data.projects_truncated && <p>Showing the first 100 authorized projects. Use the project filter to narrow this report.</p>}</div>}
      <h3>Parent tasks in scope</h3>{target.section === 'employees' && <p>Includes directly assigned tasks and parents of assigned subtasks. Parent assignment counts use direct task assignments only.</p>}<DataTable items={data.tasks.items} columns={COLUMNS.tasks} timezone={query.timezone} />
      <Pagination page={page} pageSize={10} total={data.tasks.total} totalPages={data.tasks.total_pages} onPage={setPage} />
      {data.subtasks && <><h3>Assigned subtasks · workflow status is separate</h3><DataTable items={data.subtasks.items}
        columns={[c('title', 'Subtask'), c('status', 'Workflow status'), c('task_title', 'Parent task')]} timezone={query.timezone} />
        <p>Subtask creation dates are not stored in the existing subtask record.</p>
        <Pagination page={page} pageSize={10} total={data.subtasks.total} totalPages={data.subtasks.total_pages} onPage={setPage} /></>}
      {data.employees && <><h3>Employee workload</h3><DataTable items={data.employees.items} columns={COLUMNS.employees} timezone={query.timezone} />
        <Pagination page={page} pageSize={10} total={data.employees.total} totalPages={data.employees.total_pages} onPage={setPage} /></>}
      {data.statuses && <><h3>Parent status breakdown</h3><DataTable items={data.statuses} columns={COLUMNS.statuses} timezone={query.timezone} /></>}
      <h3>Recorded work in this period</h3><p>This section uses session interval dates, independent of parent creation date.</p>
      {work.busy && <Loading />}{work.error && <ErrorBox message={work.error} retry={work.retry} />}
      {work.data && <TimeSummary values={work.data.summary} />}
      <WorkSessions key={JSON.stringify(timeQuery)} query={timeQuery} />
      <Meta meta={data.meta} />
    </>}
  </section>;
}

export default function Reports() {
  const { user } = useAuth();
  const [url, setUrl] = useSearchParams();
  const timezone = reportTimezone(user?.timezone);
  const filters = useMemo(() => reportingFiltersFromUrl(url, timezone), [url, timezone]);
  const section = reportSections.includes(url.get('tab') as ReportSection) ? url.get('tab') as ReportSection : 'overview';
  const preset = PRESETS.some(item => item.id === url.get('preset')) ? url.get('preset') as ReportPreset : 'month';
  const page = Math.max(1, Number.parseInt(url.get('page') || '1', 10) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(url.get('page_size'))) ? Number(url.get('page_size')) : 25;
  const sort = url.get('sort') || '';
  const direction = url.get('direction') === 'desc' ? 'desc' : 'asc';
  const grouping = ['daily', 'weekly', 'monthly'].includes(url.get('grouping') || '') ? url.get('grouping') as 'daily' | 'weekly' | 'monthly' : 'daily';
  const groupBy = ['employee', 'task', 'subtask', 'project', 'daily'].includes(url.get('group_by') || '') ? url.get('group_by') as ReportingQuery['group_by'] : 'employee';
  const [draft, setDraft] = useState<ReportingFilters>(filters);
  const [draftPreset, setDraftPreset] = useState<ReportPreset>(preset);
  const [validation, setValidation] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [employeePage, setEmployeePage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const [optionSearch, setOptionSearch] = useState({ employee: '', project: '' });
  const [detail, setDetail] = useState<{ section: 'employees' | 'projects'; id: string } | null>(null);
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const query: ReportingQuery = { ...filters, page, page_size: pageSize, sort, direction, group_by: groupBy, grouping };
  const identity = `${user?.tenantId}:${user?.id}:${user?.role}`;
  const scopeKey = JSON.stringify([identity, filters, revision]);
  const invalid = validateReportingDates(filters.from, filters.to, filters.timezone);
  useEffect(() => { setDraft(filters); setDraftPreset(preset); setValidation(null); setDetail(null); setExportError(null); }, [scopeKey, preset]);
  useEffect(() => {
    const timer = window.setTimeout(() => setOptionSearch({ employee: employeeSearch, project: projectSearch }), 250);
    return () => window.clearTimeout(timer);
  }, [employeeSearch, projectSearch]);
  const optionsQuery = { timezone: filters.timezone, from: filters.from, to: filters.to, employee_id: filters.employee_id, project_id: filters.project_id };
  const employeeOptions = useReportResource(JSON.stringify([identity, optionSearch.employee, employeePage, optionsQuery]), !invalid,
    signal => reportingApi.options({ ...optionsQuery, employee_search: optionSearch.employee, options_page: employeePage }, signal));
  const projectOptions = useReportResource(JSON.stringify([identity, optionSearch.project, projectPage, optionsQuery]), !invalid,
    signal => reportingApi.options({ ...optionsQuery, project_search: optionSearch.project, options_page: projectPage }, signal));
  const overview = useReportResource(scopeKey, !invalid, signal => reportingApi.overview(filters, signal));
  const table = useReportResource(JSON.stringify([scopeKey, section, page, pageSize, sort, direction, groupBy, grouping]), !invalid && section !== 'overview',
    signal => reportingApi.page(section as Exclude<ReportSection, 'overview'>, query, signal));
  const activity = useReportResource(JSON.stringify([scopeKey, grouping]), !invalid && section === 'overview',
    signal => reportingApi.page('activity', { ...filters, page: 1, page_size: 31, grouping }, signal));
  const updateUrl = (next: ReportingQuery, tab = section, nextPreset = preset) => setUrl(reportingSearchParams(next, tab, nextPreset));
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateReportingDates(draft.from, draft.to, draft.timezone);
    setValidation(error);
    if (!error) updateUrl({ ...draft, page: 1, page_size: pageSize, group_by: groupBy, grouping }, section, draftPreset);
  };
  const changeSection = (next: ReportSection) => { setDetail(null); setExportError(null); updateUrl({ ...filters, page: 1, page_size: pageSize, group_by: groupBy, grouping }, next); };
  const quickFilter = (key: 'status' | 'employee_id' | 'project_id', value: string) =>
    updateUrl({ ...filters, [key]: value, page: 1, page_size: pageSize, group_by: groupBy, grouping }, key === 'employee_id' ? 'employees' : key === 'project_id' ? 'projects' : 'tasks');
  const exportReport = async () => {
    setExporting(true); setExportError(null);
    try {
      const result = await reportingApi.export(section === 'overview' ? 'tasks' : section, exportFormat, query);
      const blobUrl = URL.createObjectURL(result.blob);
      const link = document.createElement('a'); link.href = blobUrl; link.download = result.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) { setExportError(reportError(error)); }
    finally { setExporting(false); }
  };
  const meta = section === 'overview' ? overview.data?.meta : table.data?.meta;
  const employeeList = employeeOptions.data?.employees || [];
  const projectList = projectOptions.data?.projects || [];
  const onSort = (key: string) => updateUrl({ ...query, page: 1, sort: key, direction: sort === key && direction === 'asc' ? 'desc' : 'asc' });
  return <main className="reports-page">
    <header className="report-header"><div><span className="report-eyebrow">Zea.Play analytics</span><h1>Reporting & Analytics</h1><p>Task inventory, current assignments, project delivery and recorded work.</p></div>
      <div className="report-export"><button type="button" onClick={() => setRevision(n => n + 1)}>Refresh</button>
        <select aria-label="Export format" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'csv' | 'xlsx')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select>
        <button className="report-primary" type="button" disabled={exporting || !!invalid || !meta} onClick={exportReport}>{exporting ? 'Preparing export…' : `Export ${section === 'overview' ? 'tasks' : LABELS[section].toLowerCase()}`}</button>
      </div>
    </header>
    {exportError && <ErrorBox message={exportError} />}
    <form className="report-panel report-filters" onSubmit={apply}>
      <div className="report-filter-heading"><h2>Global filters</h2><span>{filters.timezone} · all tabs and exports use applied filters</span></div>
      <div className="report-filter-grid">
        <label>Date range<select aria-label="Date range" value={draftPreset} onChange={event => {
          const next = event.target.value as ReportPreset; setDraftPreset(next);
          if (next !== 'custom') setDraft(previous => ({ ...previous, ...reportingDates(next, previous.timezone) }));
        }}>{PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>From<input aria-label="From" type="date" value={draft.from} onChange={event => { setDraftPreset('custom'); setDraft({ ...draft, from: event.target.value }); }} /></label>
        <label>Through<input aria-label="Through" type="date" value={draft.to} onChange={event => { setDraftPreset('custom'); setDraft({ ...draft, to: event.target.value }); }} /></label>
        <label>Parent task status<select aria-label="Parent task status" value={draft.status || ''} onChange={event => setDraft({ ...draft, status: event.target.value as TaskStatus || undefined })}>
          <option value="">All persisted statuses</option>{(employeeOptions.data?.statuses || Object.values(TaskStatus)).map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select></label>
        <SearchPicker label="Employees" selected={draft.employee_id} onChange={id => setDraft({ ...draft, employee_id: id || undefined })}
          options={employeeList} total={employeeOptions.data?.employees_total || 0} busy={employeeOptions.busy} search={employeeSearch} setSearch={setEmployeeSearch} page={employeePage} setPage={setEmployeePage} />
        <SearchPicker label="Projects" selected={draft.project_id} onChange={id => setDraft({ ...draft, project_id: id || undefined })}
          options={projectList} total={projectOptions.data?.projects_total || 0} busy={projectOptions.busy} search={projectSearch} setSearch={setProjectSearch} page={projectPage} setPage={setProjectPage} />
        <label className="report-search">Search tasks<input placeholder="Task title…" value={draft.search || ''} onChange={event => setDraft({ ...draft, search: event.target.value || undefined })} /></label>
        <div className="report-filter-actions"><button className="report-primary" type="submit">Apply filters</button><button type="button" onClick={() => {
          setEmployeeSearch(''); setProjectSearch(''); setEmployeePage(1); setProjectPage(1);
          const defaults = { ...reportingDates('month', timezone), timezone };
          setDraft(defaults); setDraftPreset('month'); setValidation(null);
          updateUrl({ ...defaults, page: 1, page_size: 25 }, section, 'month');
        }}>Reset</button></div>
      </div>
      {(validation || invalid) && <ErrorBox message={validation || invalid!} />}
      {(employeeOptions.error || projectOptions.error) && <ErrorBox message={employeeOptions.error || projectOptions.error!} retry={() => { employeeOptions.retry(); projectOptions.retry(); }} />}
    </form>
    <nav className="report-tabs" aria-label="Reporting sections">{reportSections.map(tab => <button key={tab} type="button" aria-current={section === tab ? 'page' : undefined} onClick={() => changeSection(tab)}>{LABELS[tab]}</button>)}</nav>
    <div className="report-definition"><strong>{section === 'activity' ? 'Event dates' : section === 'time' ? 'Session intervals' : 'Task inventory'}</strong>
      <p>{section === 'activity' ? 'Events are counted by their recorded timestamp in the selected timezone. Historical events before capture began may be unavailable.'
        : section === 'time' ? 'Recorded task effort sums session durations. Unique working time merges overlapping intervals per employee. Neither metric is attendance or payroll time.'
          : 'The date range applies to parent task creation. Completed: DONE or DEPLOYED. In progress: IN_PROGRESS, BUG_FIXING or IN_REVIEW. Pending: WAITING_FOR_REQUIREMENT, TODO or ON_HOLD. Subtask progress is separate from saved parent status.'}</p>
      {section !== 'activity' && section !== 'time' && <p>Counts use persisted task IDs. Legacy multi-assignee work may use separate task records linked by a group; assignment and group totals are distinct.</p>}
      {(section === 'employees' || section === 'projects') && <p>Recorded effort sums concurrent work on the filtered task inventory, clipped to the report period. The Time tracking tab reports historical work independently of task creation.</p>}
      {section === 'activity' && <p>Assignment event totals are unavailable because complete assignment history was not recorded.</p>}
      {section === 'projects' && <p>Member and manager counts include authorized memberships. Name previews show at most 25 people.</p>}
    </div>
    {section === 'overview' ? <>
      {overview.busy && <Loading label="Loading overview" />}{overview.error && <ErrorBox message={overview.error} retry={overview.retry} />}
      {overview.data && <Overview data={overview.data} onFilter={quickFilter} />}
      <section className="report-panel"><div className="report-panel-heading"><div><h2>Date-wise task activity</h2><p>Recorded events in the report period, independent of task creation date.</p></div><button type="button" onClick={() => changeSection('activity')}>View full activity</button></div>
        {activity.busy && <Loading label="Loading activity" />}{activity.error && <ErrorBox message={activity.error} retry={activity.retry} />}{activity.data && <ActivityChart rows={activity.data.series || activity.data.items} />}
      </section>
    </> : <section className="report-panel">
      <div className="report-panel-heading"><div><h2>{LABELS[section]}</h2><p>{section === 'employees' ? 'Open an employee to inspect assigned tasks, subtasks and projects.' : section === 'projects' ? 'Open a project to inspect delivery and employee workload.' : 'Sort supported columns to inspect the complete filtered report.'}</p></div>
        {section === 'activity' && <label>Group by <select aria-label="Group by" value={grouping} onChange={event => updateUrl({ ...query, page: 1, grouping: event.target.value as ReportingQuery['grouping'] })}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>}
        {section === 'time' && <label>Group work by <select aria-label="Group work by" value={groupBy} onChange={event => updateUrl({ ...query, page: 1, sort: '', group_by: event.target.value as ReportingQuery['group_by'] })}>
          <option value="employee">Employee</option><option value="task">Parent task</option><option value="subtask">Subtask</option><option value="project">Project</option><option value="daily">Day</option></select></label>}
      </div>
      {table.busy && <Loading />}{table.error && <ErrorBox message={table.error} retry={table.retry} />}
      {table.data && <>
        {section === 'activity' && <><ActivityChart rows={table.data.series || table.data.items} /><ActivityComparison filters={filters} totals={table.data.totals} /></>}
        {section === 'time' && <TimeSummary values={table.data.summary} />}
        <DataTable items={table.data.items} columns={section === 'time' ? COLUMNS.time.filter(column => groupBy !== 'daily' || !['running_interval_count', 'paused_interval_count', 'resumed_interval_count'].includes(column.key)).map(column => column.key === 'name' ? { ...column, label: groupBy === 'daily' ? 'Day' : groupBy === 'task' ? 'Parent task' : groupBy === 'subtask' ? 'Subtask' : groupBy === 'project' ? 'Project' : 'Employee' } : column) : COLUMNS[section]} timezone={filters.timezone} sort={sort} direction={direction} onSort={onSort}
          onRow={section === 'employees' || section === 'projects' ? row => setDetail({ section, id: String(row[section === 'employees' ? 'employee_id' : 'project_id']) }) : section === 'statuses' ? row => quickFilter('status', String(row.status)) : undefined} />
        <Pagination page={page} pageSize={pageSize} total={table.data.total} totalPages={table.data.total_pages}
          onPage={next => updateUrl({ ...query, page: next })} onSize={size => updateUrl({ ...query, page: 1, page_size: size })} />
      </>}
    </section>}
    {section === 'time' && !invalid && <WorkSessions key={scopeKey} query={query} />}
    {detail && <DetailPanel key={`${scopeKey}:${detail.section}:${detail.id}`} target={detail} query={query} onClose={() => setDetail(null)}
      onExplore={tab => updateUrl({ ...filters, [detail.section === 'employees' ? 'employee_id' : 'project_id']: detail.id, page: 1, page_size: pageSize, group_by: 'employee', grouping }, tab)} />}
    <Meta meta={meta} />
  </main>;
}
