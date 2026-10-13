import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { AuditLog, AuditRetentionConfig, CUSTOM_STATUS_NAMES, Role, TaskStatus, User } from '../types';
import { formatDate, timeAgo } from '../utils';
import { useAuth } from '../hooks/useAuth';
import PageLoader from '../components/loading/PageLoader';

type TabKey =
  | 'all'
  | 'user'
  | 'task'
  | 'ticket'
  | 'approval'
  | 'automation'
  | 'security'
  | 'failed';

const TAB_CONFIG: Record<TabKey, { label: string; categories?: string[]; status?: string[] }> = {
  all: { label: 'All Logs' },
  user: { label: 'User Logs', categories: ['user'] },
  task: { label: 'Task Logs', categories: ['task'] },
  ticket: { label: 'Ticket Logs', categories: ['ticket'] },
  approval: { label: 'Approval Logs', categories: ['approval'] },
  automation: { label: 'Automation Logs', categories: ['automation'] },
  security: { label: 'Security Logs', categories: ['security'] },
  failed: { label: 'Failed Only', status: ['failed'] },
};

const SEVERITY_OPTIONS = ['info', 'warning', 'critical'];
const SOURCE_OPTIONS = ['manual', 'automation', 'api', 'system'];
const STATUS_OPTIONS = ['success', 'failed'];
const ENTITY_OPTIONS = ['user', 'task', 'ticket', 'workflow', 'approval', 'notification', 'system'];

const PAGE_SIZE = 50;

const formatJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const formatLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatStatusValue = (value: string) => {
  const key = value as TaskStatus;
  if (CUSTOM_STATUS_NAMES[key]) {
    return CUSTOM_STATUS_NAMES[key].name;
  }
  return formatLabel(value);
};

const formatValue = (key: string, value: unknown, userMap: Map<string, User>) => {
  if (value === null || value === undefined || value === '') {
    return 'None';
  }
  if (key === 'status' && typeof value === 'string') {
    return formatStatusValue(value);
  }
  if (key === 'priority' && typeof value === 'string') {
    return formatLabel(value);
  }
  if (key.endsWith('_id') && typeof value === 'string') {
    const user = userMap.get(value);
    if (user) {
      return user.name || user.email || value;
    }
  }
  if (key.includes('date') || key.endsWith('_at')) {
    if (typeof value === 'string') {
      return formatDate(value, true);
    }
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : 'None';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

const buildDiffLines = (log: AuditLog, userMap: Map<string, User>) => {
  const before = log.before ?? {};
  const after = log.after ?? {};
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const keys = Array.from(new Set([...beforeKeys, ...afterKeys])).sort();

  if (keys.length > 0) {
    return keys.map((key) => {
      const fromValue = formatValue(key, (before as Record<string, unknown>)[key], userMap);
      const toValue = formatValue(key, (after as Record<string, unknown>)[key], userMap);
      return `${formatLabel(key)}: ${fromValue} -> ${toValue}`;
    });
  }

  if (log.oldValue || log.newValue) {
    return [`Value: ${log.oldValue ?? 'None'} -> ${log.newValue ?? 'None'}`];
  }

  const reason = log.reason || log.metadata?.reason;
  return reason ? [`No change payload. Reason: ${reason}`] : ['No change payload provided.'];
};

const truncate = (value: string, max = 120) =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const getEntityLink = (log: AuditLog) => {
  if (!log.entityType || !log.entityId) {
    return null;
  }
  if (log.entityType === 'task') {
    return `/tasks/${log.entityId}`;
  }
  if (log.entityType === 'ticket') {
    return `/tickets?ticketId=${log.entityId}`;
  }
  if (log.entityType === 'user') {
    return `/admin/users?userId=${log.entityId}`;
  }
  return null;
};

const Logs: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('all');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [retention, setRetention] = useState<AuditRetentionConfig | null>(null);
  const [retentionUpdating, setRetentionUpdating] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    startAt: '',
    endAt: '',
    actorIds: [] as string[],
    actions: '',
    entityTypes: [] as string[],
    severity: [] as string[],
    source: [] as string[],
    status: [] as string[],
  });

  const tabFilter = TAB_CONFIG[tab];
  const actionFilters = useMemo(
    () =>
      filters.actions
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [filters.actions],
  );

  const query = useMemo(
    () => ({
      categories: tabFilter.categories,
      status: tabFilter.status?.length ? tabFilter.status : filters.status,
      entityTypes: filters.entityTypes,
      actions: actionFilters,
      actorIds: filters.actorIds,
      severity: filters.severity,
      source: filters.source,
      startAt: filters.startAt || undefined,
      endAt: filters.endAt || undefined,
      pageSize: PAGE_SIZE,
    }),
    [actionFilters, filters, tabFilter],
  );

  const loadLogs = useCallback(
    async (nextPage = 1, append = false) => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getAuditLogs({ ...query, page: nextPage });
        setTotal(response.total);
        setPage(response.page);
        setLogs((prev) => (append ? [...prev, ...response.items] : response.items));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load logs.';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    loadLogs(1, false);
  }, [loadLogs]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (user.role === Role.USER) {
      setUsers([user]);
      return;
    }
    api.getUsers()
      .then((data) => setUsers(data))
      .catch(() => setUsers([]));
  }, [user]);

  useEffect(() => {
    if (!user || (user.role !== Role.ADMIN && user.role !== Role.OWNER)) {
      return;
    }
    api.getAuditRetention()
      .then((data) => setRetention(data))
      .catch(() => setRetention(null));
  }, [user]);

  const handleMultiSelect =
    (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLSelectElement>) => {
      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
      setFilters((prev) => ({ ...prev, [key]: values }));
    };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const blob = await api.exportAuditLogs({
        format,
        categories: tabFilter.categories,
        status: tabFilter.status?.length ? tabFilter.status : filters.status,
        entityTypes: filters.entityTypes,
        actions: actionFilters,
        actorIds: filters.actorIds,
        severity: filters.severity,
        source: filters.source,
        startAt: filters.startAt || undefined,
        endAt: filters.endAt || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export logs.';
      setError(message);
    }
  };

  const handleRetry = async (log: AuditLog) => {
    if (log.category !== 'automation') {
      return;
    }
    setRetentionMessage(null);
    try {
      await api.retryAuditLog(log.id);
      setRetentionMessage('Retry queued.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to queue retry.';
      setRetentionMessage(message);
    }
  };

  const applyRetention = async () => {
    setRetentionMessage(null);
    try {
      const result = await api.applyAuditRetention();
      setRetentionMessage(`Retention applied: ${result.updated} logs archived.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply retention.';
      setRetentionMessage(message);
    }
  };

  const updateRetention = async (value: number) => {
    if (!retention) {
      return;
    }
    setRetentionUpdating(true);
    setRetentionMessage(null);
    try {
      const updated = await api.updateAuditRetention(value);
      setRetention(updated);
      setRetentionMessage('Retention updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update retention.';
      setRetentionMessage(message);
    } finally {
      setRetentionUpdating(false);
    }
  };

  const canManageRetention = user?.role === Role.ADMIN || user?.role === Role.OWNER;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const userMap = useMemo(() => new Map(users.map((person) => [person.id, person])), [users]);

  if (loading && logs.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 log-arcade">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-white">Audit Logs</h1>
          <p className="text-sm text-white/60">
            Track every mission move with premium clarity across the platform.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="log-arcade-button"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('json')}
            className="log-arcade-button"
          >
            Export JSON
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(TAB_CONFIG) as TabKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={`log-arcade-pill ${
              tab === key
                ? 'log-arcade-pill-active'
                : 'log-arcade-pill-idle'
            }`}
          >
            {TAB_CONFIG[key].label}
          </button>
        ))}
      </div>

      <section className="log-arcade-panel">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Start</label>
            <input
              type="datetime-local"
              value={filters.startAt}
              onChange={(event) => setFilters((prev) => ({ ...prev, startAt: event.target.value }))}
              className="log-arcade-input"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">End</label>
            <input
              type="datetime-local"
              value={filters.endAt}
              onChange={(event) => setFilters((prev) => ({ ...prev, endAt: event.target.value }))}
              className="log-arcade-input"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Actions</label>
            <input
              type="text"
              placeholder="TASK_UPDATED, USER_LOGIN"
              value={filters.actions}
              onChange={(event) => setFilters((prev) => ({ ...prev, actions: event.target.value }))}
              className="log-arcade-input"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Entity</label>
            <select
              multiple
              value={filters.entityTypes}
              onChange={handleMultiSelect('entityTypes')}
              className="log-arcade-select"
            >
              {ENTITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Severity</label>
            <select
              multiple
              value={filters.severity}
              onChange={handleMultiSelect('severity')}
              className="log-arcade-select"
            >
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Source</label>
            <select
              multiple
              value={filters.source}
              onChange={handleMultiSelect('source')}
              className="log-arcade-select"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Status</label>
            <select
              multiple
              value={filters.status}
              onChange={handleMultiSelect('status')}
              className="log-arcade-select"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.3em] text-white/50">Users</label>
            <select
              multiple
              value={filters.actorIds}
              onChange={handleMultiSelect('actorIds')}
              className="log-arcade-select"
            >
              {users.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name || person.email || person.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {canManageRetention && retention && (
        <section className="log-arcade-panel log-arcade-panel-muted">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">Retention Policy</p>
              <p className="mt-2 text-sm text-white/70">
                Archive logs older than the configured window (soft delete only).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={retention.retentionDays}
                onChange={(event) => updateRetention(Number(event.target.value))}
                disabled={retentionUpdating}
                className="log-arcade-input"
              >
                {[30, 90, 180].map((value) => (
                  <option key={value} value={value}>
                    {value} days
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyRetention}
                className="log-arcade-button"
              >
                Apply Retention
              </button>
            </div>
          </div>
          {retentionMessage && <p className="mt-3 text-sm text-sky-200/80">{retentionMessage}</p>}
        </section>
      )}

      <section className="log-arcade-panel">
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!loading && logs.length === 0 && !error && (
          <p className="text-sm text-white/60">No logs found.</p>
        )}

        {logs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-white/70">
              <thead className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Before -&gt; After</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const actorName = log.actor?.name || log.actorId || 'System';
                  const diffLines = buildDiffLines(log, userMap);
                  const diffText = diffLines[0];
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <tr key={log.id} className="border-t border-white/5">
                      <td className="px-3 py-3 text-xs text-white/50">{timeAgo(log.createdAt)}</td>
                      <td className="px-3 py-3">{actorName}</td>
                      <td className="px-3 py-3 font-semibold text-white">{log.action}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs uppercase text-white/40">{log.entityType || log.category}</span>
                        {log.entityId && (
                          <span className="ml-2 text-xs text-white/50">#{log.entityId.slice(-6)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          className="text-left text-xs text-sky-200/80 hover:text-sky-100"
                        >
                          {truncate(diffText)}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-black/40 p-2 text-[11px] text-white/60">
                            {diffLines.map((line) => (
                              <div key={line}>{line}</div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs uppercase">{log.source}</td>
                      <td className="px-3 py-3 text-xs uppercase">{log.severity}</td>
                      <td className="px-3 py-3 text-xs">{log.ipAddress || '-'}</td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLog(log);
                            setShowRaw(false);
                          }}
                          className="log-arcade-button log-arcade-button-small"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-white/50">
          <span>
            Page {page} of {totalPages} ({total} entries)
          </span>
          {page < totalPages && (
            <button
              type="button"
              onClick={() => loadLogs(page + 1, true)}
              className="log-arcade-button"
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </div>
      </section>

      {selectedLog && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSelectedLog(null)}
            role="button"
            tabIndex={-1}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-slate-950/95 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Log Details</h2>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-sm text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm text-white/70">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Actor</p>
                <p className="mt-1 text-white">
                  {selectedLog.actor?.name || selectedLog.actorId || 'System'}
                </p>
                {selectedLog.actor?.email && (
                  <p className="text-xs text-white/50">{selectedLog.actor.email}</p>
                )}
                {selectedLog.actor?.role && (
                  <p className="text-xs text-white/50">Role: {selectedLog.actor.role}</p>
                )}
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Action</p>
                <p className="mt-1 text-white">{selectedLog.action}</p>
                <p className="text-xs text-white/50">
                  {selectedLog.source} · {selectedLog.severity} · {selectedLog.status}
                </p>
              </div>

              {(selectedLog.reason || selectedLog.trigger) && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Reason</p>
                  <p className="mt-1 text-xs text-white/60">{selectedLog.reason || '-'}</p>
                  {selectedLog.trigger && (
                    <p className="text-xs text-white/50">Trigger: {selectedLog.trigger}</p>
                  )}
                </div>
              )}

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Entity</p>
                <p className="mt-1 text-white">
                  {selectedLog.entityType || selectedLog.category} {selectedLog.entityId && `#${selectedLog.entityId}`}
                </p>
                {getEntityLink(selectedLog) && (
                  <Link to={getEntityLink(selectedLog) as string} className="text-xs text-sky-200">
                    Open related record
                  </Link>
                )}
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Before -&gt; After</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] text-white/60">
                  {buildDiffLines(selectedLog, userMap).join('\n')}
                </pre>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Request</p>
                <p className="mt-1 text-xs text-white/60">
                  {selectedLog.method || '-'} {selectedLog.route || '-'}
                </p>
                <p className="text-xs text-white/50">IP: {selectedLog.ipAddress || '-'}</p>
                <p className="text-xs text-white/50">UA: {selectedLog.userAgent || '-'}</p>
                <p className="text-xs text-white/50">
                  Browser: {selectedLog.metadata?.client?.browser ?? '-'}{' '}
                  {selectedLog.metadata?.client?.browser_version ?? ''}
                </p>
                <p className="text-xs text-white/50">OS: {selectedLog.metadata?.client?.os ?? '-'}</p>
                {selectedLog.metadata?.client?.accept_language && (
                  <p className="text-xs text-white/50">
                    Language: {selectedLog.metadata.client.accept_language}
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Metadata</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] text-white/60">
                  {formatJson(selectedLog.metadata)}
                </pre>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(selectedLog.id)}
                className="log-arcade-button"
              >
                Copy Log ID
              </button>
              <button
                type="button"
                onClick={() => setShowRaw((prev) => !prev)}
                className="log-arcade-button"
              >
                {showRaw ? 'Hide Raw' : 'More'}
              </button>
              {selectedLog.category === 'automation' && selectedLog.status === 'failed' && (
                <button
                  type="button"
                  onClick={() => handleRetry(selectedLog)}
                  className="rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200 hover:text-amber-100"
                >
                  Retry Automation
                </button>
              )}
            </div>

            {showRaw && (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/50 p-3 text-[11px] text-white/60">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};

export default Logs;
