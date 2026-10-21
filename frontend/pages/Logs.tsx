import Avatar from '../components/Avatar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  RefreshCcw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import api from '../services/api';
import { AuditLog, AuditRetentionConfig, CUSTOM_STATUS_NAMES, Role, TaskStatus, User } from '../types';
import { formatDate, timeAgo } from '../utils';
import { useAuth } from '../hooks/useAuth';

type TabKey =
  | 'all'
  | 'user'
  | 'task'
  | 'ticket'
  | 'approval'
  | 'automation'
  | 'security'
  | 'failed';

type FilterState = {
  startAt: string;
  endAt: string;
  actorIds: string[];
  actions: string;
  entityTypes: string[];
  severity: string[];
  source: string[];
  status: string[];
};

type MultiFilterKey = 'actorIds' | 'entityTypes' | 'severity' | 'source' | 'status';

type FilterOption = {
  value: string;
  label: string;
  description?: string;
};

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

const SEVERITY_OPTIONS: FilterOption[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];
const SOURCE_OPTIONS: FilterOption[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'automation', label: 'Automation' },
  { value: 'api', label: 'API' },
  { value: 'system', label: 'System' },
];
const STATUS_OPTIONS: FilterOption[] = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];
const ENTITY_OPTIONS: FilterOption[] = [
  { value: 'user', label: 'User' },
  { value: 'task', label: 'Task' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'approval', label: 'Approval' },
  { value: 'notification', label: 'Notification' },
  { value: 'system', label: 'System' },
];

const PAGE_SIZE = 50;

const EMPTY_FILTERS: FilterState = {
  startAt: '',
  endAt: '',
  actorIds: [],
  actions: '',
  entityTypes: [],
  severity: [],
  source: [],
  status: [],
};

const SENSITIVE_KEY_PATTERN = /password|secret|token|authorization|api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token/i;

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
    acc[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactSensitive(item);
    return acc;
  }, {});
};

const formatJson = (value: unknown) => JSON.stringify(redactSensitive(value ?? {}), null, 2);

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
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
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
    return JSON.stringify(redactSensitive(value));
  }
  return String(value);
};

const buildDiffLines = (log: AuditLog, userMap: Map<string, User>) => {
  const before = log.before ?? {};
  const after = log.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();

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
  const trigger = log.trigger || log.metadata?.trigger;
  if (reason || trigger) {
    return [`Event message: ${String(reason || trigger)}`];
  }

  return ['No recorded changes'];
};

const summarizeChanges = (log: AuditLog, userMap: Map<string, User>) => {
  const lines = buildDiffLines(log, userMap);
  if (lines.length === 1) {
    return lines[0];
  }
  const changedFields = Array.from(new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})]));
  if (changedFields.length > 0) {
    const preview = changedFields.slice(0, 3).map(formatLabel).join(', ');
    const suffix = changedFields.length > 3 ? ` +${changedFields.length - 3} more` : '';
    return `${changedFields.length} field${changedFields.length === 1 ? '' : 's'} changed: ${preview}${suffix}`;
  }
  return lines[0];
};

const truncate = (value: string, max = 110) => (value.length > max ? `${value.slice(0, max)}...` : value);

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

const getSeverityClass = (severity: AuditLog['severity']) => {
  if (severity === 'critical') {
    return 'border-red-400/40 bg-red-500/10 text-red-200';
  }
  if (severity === 'warning') {
    return 'border-amber-400/40 bg-amber-500/10 text-amber-200';
  }
  return 'border-sky-400/30 bg-sky-500/10 text-sky-200';
};

const getStatusClass = (status: AuditLog['status']) =>
  status === 'failed'
    ? 'border-red-400/40 bg-red-500/10 text-red-200'
    : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';

const matchesSearch = (log: AuditLog, term: string, userMap: Map<string, User>) => {
  if (!term) {
    return true;
  }
  const haystack = [
    log.id,
    log.action,
    log.category,
    log.entityType,
    log.entityId,
    log.actor?.name,
    log.actor?.email,
    log.actorId,
    log.ipAddress,
    log.source,
    log.severity,
    log.status,
    log.reason,
    summarizeChanges(log, userMap),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
};

const buildActiveChips = (
  tab: TabKey,
  filters: FilterState,
  searchTerm: string,
  userOptions: FilterOption[],
  statusLocked: boolean,
) => {
  const chipData: { key: string; label: string; filterKey?: MultiFilterKey | 'actions' | 'startAt' | 'endAt' | 'search'; value?: string }[] = [];

  if (tab !== 'all') {
    chipData.push({ key: `tab-${tab}`, label: TAB_CONFIG[tab].label });
  }
  if (searchTerm.trim()) {
    chipData.push({ key: 'search', label: `Search: ${searchTerm.trim()}`, filterKey: 'search' });
  }
  if (filters.startAt) {
    chipData.push({ key: 'startAt', label: `From: ${formatDate(filters.startAt, true)}`, filterKey: 'startAt' });
  }
  if (filters.endAt) {
    chipData.push({ key: 'endAt', label: `To: ${formatDate(filters.endAt, true)}`, filterKey: 'endAt' });
  }
  if (filters.actions.trim()) {
    chipData.push({ key: 'actions', label: `Action: ${filters.actions.trim()}`, filterKey: 'actions' });
  }

  const labelFromOptions = (options: FilterOption[], value: string) =>
    options.find((option) => option.value === value)?.label ?? value;

  filters.entityTypes.forEach((value) =>
    chipData.push({ key: `entity-${value}`, label: `Entity: ${labelFromOptions(ENTITY_OPTIONS, value)}`, filterKey: 'entityTypes', value }),
  );
  filters.severity.forEach((value) =>
    chipData.push({ key: `severity-${value}`, label: `Severity: ${labelFromOptions(SEVERITY_OPTIONS, value)}`, filterKey: 'severity', value }),
  );
  filters.source.forEach((value) =>
    chipData.push({ key: `source-${value}`, label: `Source: ${labelFromOptions(SOURCE_OPTIONS, value)}`, filterKey: 'source', value }),
  );
  if (!statusLocked) {
    filters.status.forEach((value) =>
      chipData.push({ key: `status-${value}`, label: `Status: ${labelFromOptions(STATUS_OPTIONS, value)}`, filterKey: 'status', value }),
    );
  }
  filters.actorIds.forEach((value) =>
    chipData.push({ key: `actor-${value}`, label: `User: ${labelFromOptions(userOptions, value)}`, filterKey: 'actorIds', value }),
  );

  return chipData;
};

interface MultiSelectFilterProps {
  label: string;
  value: string[];
  options: FilterOption[];
  placeholder: string;
  isOpen: boolean;
  disabled?: boolean;
  helperText?: string;
  onToggle: () => void;
  onClose: () => void;
  onChange: (values: string[]) => void;
}

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
  label,
  value,
  options,
  placeholder,
  isOpen,
  disabled = false,
  helperText,
  onToggle,
  onClose,
  onChange,
}) => {
  const [search, setSearch] = useState('');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const selectedOptions = useMemo(
    () => value.map((item) => options.find((option) => option.value === item)).filter(Boolean) as FilterOption[],
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) =>
      [option.label, option.value, option.description].filter(Boolean).join(' ').toLowerCase().includes(needle),
    );
  }, [options, search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const toggleValue = (nextValue: string) => {
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }
    onChange([...value, nextValue]);
  };

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-semibold text-slate-400">{label}</label>
      <button
        ref={buttonRef}
        type="button"
        className={`audit-filter-control ${disabled ? 'audit-filter-control-disabled' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={disabled ? false : isOpen}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={disabled ? undefined : onToggle}
      >
        <span className={selectedOptions.length ? 'text-slate-100' : 'text-slate-500'}>
          {selectedOptions.length === 0
            ? placeholder
            : selectedOptions.length === 1
              ? selectedOptions[0].label
              : `${selectedOptions.length} selected`}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {helperText && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}

      {isOpen && !disabled && (
        <div ref={panelRef} className="audit-popover" role="dialog" aria-label={`${label} options`}>
          <div className="border-b border-slate-700/70 p-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="audit-filter-control h-9"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-2 py-2 text-xs">
            <button
              type="button"
              className="text-cyan-200 transition hover:text-cyan-100"
              onClick={() => onChange(options.map((option) => option.value))}
            >
              Select all
            </button>
            <button type="button" className="text-slate-400 transition hover:text-slate-100" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
            {filteredOptions.length === 0 && <div className="px-3 py-3 text-sm text-slate-500">No options found.</div>}
            {filteredOptions.map((option) => {
              const selected = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                    selected ? 'bg-cyan-500/10 text-cyan-100' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                  onClick={() => toggleValue(option.value)}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                    selected ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-600'
                  }`}>
                    {selected && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && <span className="block truncate text-xs text-slate-500">{option.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end border-t border-slate-700/70 p-2">
            <button type="button" className="audit-secondary-button h-8 px-3 text-xs" onClick={onClose}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SkeletonRows: React.FC = () => (
  <>
    {Array.from({ length: 8 }).map((_, index) => (
      <tr key={index} className="border-t border-slate-800/80">
        {Array.from({ length: 9 }).map((__, cellIndex) => (
          <td key={cellIndex} className="px-4 py-3">
            <div className="h-3 animate-pulse rounded-full bg-slate-700/60" />
          </td>
        ))}
      </tr>
    ))}
  </>
);

const DetailField: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <div className="mt-1 text-sm text-slate-100">{value || '-'}</div>
  </div>
);

const Logs: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('all');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showRaw, setShowRaw] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openFilter, setOpenFilter] = useState<MultiFilterKey | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [retention, setRetention] = useState<AuditRetentionConfig | null>(null);
  const [retentionUpdating, setRetentionUpdating] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);
  const [pendingRetentionDays, setPendingRetentionDays] = useState(90);
  const [confirmApplyRetention, setConfirmApplyRetention] = useState(false);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const requestIdRef = useRef(0);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const retentionCloseRef = useRef<HTMLButtonElement | null>(null);

  const tabFilter = TAB_CONFIG[tab];
  const statusLocked = Boolean(tabFilter.status?.length);
  const actionFilters = useMemo(
    () =>
      filters.actions
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [filters.actions],
  );

  const userMap = useMemo(() => new Map(users.map((person) => [person.id, person])), [users]);
  const userOptions = useMemo<FilterOption[]>(
    () =>
      users.map((person) => ({
        value: person.id,
        label: person.name || person.email || person.id,
        description: person.email || person.role,
      })),
    [users],
  );

  const query = useMemo(
    () => ({
      categories: tabFilter.categories,
      status: statusLocked ? tabFilter.status : filters.status,
      entityTypes: filters.entityTypes,
      actions: actionFilters,
      actorIds: filters.actorIds,
      severity: filters.severity,
      source: filters.source,
      startAt: filters.startAt || undefined,
      endAt: filters.endAt || undefined,
      pageSize: PAGE_SIZE,
    }),
    [actionFilters, filters, statusLocked, tabFilter],
  );

  const displayedLogs = useMemo(
    () => logs.filter((log) => matchesSearch(log, debouncedSearch.trim(), userMap)),
    [debouncedSearch, logs, userMap],
  );

  const activeChips = useMemo(
    () => buildActiveChips(tab, filters, debouncedSearch, userOptions, statusLocked),
    [debouncedSearch, filters, statusLocked, tab, userOptions],
  );

  const loadLogs = useCallback(
    async (nextPage = 1) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);
      try {
        const response = await api.getAuditLogs({ ...query, page: nextPage });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setTotal(response.total);
        setTotalPages(response.totalPages);
        setPage(response.page);
        setLogs(response.items);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load logs.';
        setError(message);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    loadLogs(page);
  }, [loadLogs, page]);

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
      .then((data) => {
        setRetention(data);
        setPendingRetentionDays(data.retentionDays);
      })
      .catch(() => setRetention(null));
  }, [user]);

  useEffect(() => {
    if (!selectedLog) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedLog(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => drawerCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedLog]);

  const closeRetentionModal = useCallback(() => {
    setRetentionModalOpen(false);
    setConfirmApplyRetention(false);
    if (retention) {
      setPendingRetentionDays(retention.retentionDays);
    }
  }, [retention]);

  useEffect(() => {
    if (!retentionModalOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRetentionModal();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => retentionCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeRetentionModal, retentionModalOpen]);

  const setFilterValues = (key: MultiFilterKey, values: string[]) => {
    setFilters((prev) => ({ ...prev, [key]: values }));
    setPage(1);
  };

  const clearSingleChip = (chip: ReturnType<typeof buildActiveChips>[number]) => {
    if (!chip.filterKey) {
      return;
    }
    if (chip.filterKey === 'search') {
      setSearchInput('');
      setDebouncedSearch('');
      return;
    }
    if (chip.filterKey === 'actions' || chip.filterKey === 'startAt' || chip.filterKey === 'endAt') {
      setFilters((prev) => ({ ...prev, [chip.filterKey as 'actions' | 'startAt' | 'endAt']: '' }));
      setPage(1);
      return;
    }
    setFilters((prev) => ({
      ...prev,
      [chip.filterKey as MultiFilterKey]: prev[chip.filterKey as MultiFilterKey].filter((item) => item !== chip.value),
    }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    setDebouncedSearch('');
    setOpenFilter(null);
    setPage(1);
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(format);
    setError(null);
    try {
      const blob = await api.exportAuditLogs({
        format,
        categories: tabFilter.categories,
        status: statusLocked ? tabFilter.status : filters.status,
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
    } finally {
      setExporting(null);
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
      loadLogs(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to queue retry.';
      setRetentionMessage(message);
    }
  };

  const applyRetention = async () => {
    setRetentionMessage(null);
    setConfirmApplyRetention(false);
    try {
      const result = await api.applyAuditRetention();
      setRetentionMessage(`Retention applied: ${result.updated} logs archived.`);
      loadLogs(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply retention.';
      setRetentionMessage(message);
    }
  };

  const updateRetention = async () => {
    if (!retention) {
      return;
    }
    setRetentionUpdating(true);
    setRetentionMessage(null);
    try {
      const updated = await api.updateAuditRetention(pendingRetentionDays);
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
  const hasServerFilters = activeChips.some((chip) => chip.filterKey !== 'search' || tab !== 'all');
  const hasAnyFilter = activeChips.length > 0;
  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="audit-dashboard min-h-full space-y-4 text-slate-100">
      <header className="audit-header">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Audit Logs</h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor user activity, system events, and security actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageRetention && retention && (
            <button
              type="button"
              className="audit-secondary-button"
              onClick={() => {
                setPendingRetentionDays(retention.retentionDays);
                setRetentionModalOpen(true);
              }}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              Retention
            </button>
          )}
          <button type="button" className="audit-secondary-button" onClick={() => loadLogs(page)} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" className="audit-secondary-button" onClick={() => handleExport('csv')} disabled={Boolean(exporting)}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
          </button>
          <button type="button" className="audit-secondary-button" onClick={() => handleExport('json')} disabled={Boolean(exporting)}>
            <FileJson className="h-4 w-4" aria-hidden="true" />
            {exporting === 'json' ? 'Exporting...' : 'Export JSON'}
          </button>
        </div>
      </header>

      <nav className="audit-tabs" aria-label="Audit log categories">
        {(Object.keys(TAB_CONFIG) as TabKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            aria-pressed={tab === key}
            className={`audit-tab ${tab === key ? 'audit-tab-active' : ''}`}
          >
            {TAB_CONFIG[key].label}
          </button>
        ))}
      </nav>

      <section className="audit-panel p-3" aria-label="Audit filters">
        <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.4fr)_180px_180px_180px_auto_auto]">
          <label className="relative block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Search current page</span>
            <Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search actor, action, entity, IP..."
              className="audit-filter-control pl-9"
              aria-label="Search current audit logs page"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Start date</span>
            <input
              type="datetime-local"
              value={filters.startAt}
              onChange={(event) => {
                setFilters((prev) => ({ ...prev, startAt: event.target.value }));
                setPage(1);
              }}
              className="audit-filter-control"
              aria-label="Audit start date"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">End date</span>
            <input
              type="datetime-local"
              value={filters.endAt}
              onChange={(event) => {
                setFilters((prev) => ({ ...prev, endAt: event.target.value }));
                setPage(1);
              }}
              className="audit-filter-control"
              aria-label="Audit end date"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Action</span>
            <input
              type="text"
              placeholder="TASK_UPDATED"
              value={filters.actions}
              onChange={(event) => {
                setFilters((prev) => ({ ...prev, actions: event.target.value }));
                setPage(1);
              }}
              className="audit-filter-control"
              aria-label="Audit action filter"
            />
          </label>
          <MultiSelectFilter
            label="Entity"
            value={filters.entityTypes}
            options={ENTITY_OPTIONS}
            placeholder="Any entity"
            isOpen={openFilter === 'entityTypes'}
            onToggle={() => setOpenFilter(openFilter === 'entityTypes' ? null : 'entityTypes')}
            onClose={() => setOpenFilter(null)}
            onChange={(values) => setFilterValues('entityTypes', values)}
          />
          <MultiSelectFilter
            label="Severity"
            value={filters.severity}
            options={SEVERITY_OPTIONS}
            placeholder="Any severity"
            isOpen={openFilter === 'severity'}
            onToggle={() => setOpenFilter(openFilter === 'severity' ? null : 'severity')}
            onClose={() => setOpenFilter(null)}
            onChange={(values) => setFilterValues('severity', values)}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="audit-secondary-button h-9 px-3 text-xs"
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Advanced Filters
          </button>
          <button type="button" className="audit-secondary-button h-9 px-3 text-xs" onClick={clearFilters} disabled={!hasAnyFilter}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear Filters
          </button>
          <span className="text-xs text-slate-500">
            {total.toLocaleString()} total entries
            {debouncedSearch.trim() && `, ${displayedLogs.length} visible on this page`}
          </span>
        </div>

        {showAdvanced && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <MultiSelectFilter
              label="Source"
              value={filters.source}
              options={SOURCE_OPTIONS}
              placeholder="Any source"
              isOpen={openFilter === 'source'}
              onToggle={() => setOpenFilter(openFilter === 'source' ? null : 'source')}
              onClose={() => setOpenFilter(null)}
              onChange={(values) => setFilterValues('source', values)}
            />
            <MultiSelectFilter
              label="Status"
              value={statusLocked ? tabFilter.status ?? [] : filters.status}
              options={STATUS_OPTIONS}
              placeholder="Any status"
              isOpen={!statusLocked && openFilter === 'status'}
              disabled={statusLocked}
              helperText={statusLocked ? 'Locked by Failed Only.' : undefined}
              onToggle={() => setOpenFilter(openFilter === 'status' ? null : 'status')}
              onClose={() => setOpenFilter(null)}
              onChange={(values) => setFilterValues('status', values)}
            />
            <MultiSelectFilter
              label="Users"
              value={filters.actorIds}
              options={userOptions}
              placeholder="Any user"
              isOpen={openFilter === 'actorIds'}
              onToggle={() => setOpenFilter(openFilter === 'actorIds' ? null : 'actorIds')}
              onClose={() => setOpenFilter(null)}
              onChange={(values) => setFilterValues('actorIds', values)}
            />
          </div>
        )}

        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Active filters">
            {activeChips.map((chip) => (
              <span key={chip.key} className="audit-chip">
                {chip.label}
                {chip.filterKey && (
                  <button
                    type="button"
                    className="ml-1 rounded-full p-0.5 text-slate-500 transition hover:bg-slate-700 hover:text-slate-100"
                    onClick={() => clearSingleChip(chip)}
                    aria-label={`Remove ${chip.label}`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </section>

      {error && (
        <section className="audit-alert" role="alert">
          <AlertTriangle className="h-4 w-4 text-red-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-100">Audit logs could not be loaded.</p>
            <p className="mt-1 text-sm text-red-200/70">{error}</p>
          </div>
          <button type="button" className="audit-secondary-button h-9 px-3 text-xs" onClick={() => loadLogs(page)}>
            Retry
          </button>
        </section>
      )}

      <section className="audit-panel overflow-hidden" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Event stream</h2>
            <p className="text-xs text-slate-500">
              Showing {firstItem.toLocaleString()}-{lastItem.toLocaleString()} of {total.toLocaleString()} server results
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Newest first
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-slate-800 bg-[#111C30] text-xs text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Time</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actor</th>
                <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                <th scope="col" className="px-4 py-3 font-semibold">Entity</th>
                <th scope="col" className="px-4 py-3 font-semibold">Changes</th>
                <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                <th scope="col" className="px-4 py-3 font-semibold">Severity</th>
                <th scope="col" className="px-4 py-3 font-semibold">IP Address</th>
                <th scope="col" className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading && logs.length === 0 && <SkeletonRows />}
              {!loading && displayedLogs.map((log) => {
                const actorName = log.actor?.name || log.actor?.email || log.actorId || 'System';
                const summary = summarizeChanges(log, userMap);
                const entityLink = getEntityLink(log);
                return (
                  <tr key={log.id} className="audit-row">
                    <td className="px-4 py-3 align-top">
                      <span title={formatDate(log.createdAt, true)} className="block whitespace-nowrap text-slate-100">
                        {timeAgo(log.createdAt)}
                      </span>
                      <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">
                        {formatDate(log.createdAt, true)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="flex items-center gap-2"><Avatar user={{ id: log.actorId || undefined, name: actorName }} size={24} /><span className="block max-w-[160px] truncate font-medium text-slate-100">{actorName}</span></span>
                      {log.actor?.role && <span className="text-xs text-slate-500">{formatLabel(String(log.actor.role))}</span>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="audit-action-label">{formatLabel(log.action)}</span>
                      <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${getStatusClass(log.status)}`}>
                        {formatLabel(log.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block text-slate-100">{formatLabel(log.entityType || log.category)}</span>
                      {log.entityId && (
                        <span className="block max-w-[140px] truncate text-xs text-slate-500" title={log.entityId}>
                          {log.entityId}
                        </span>
                      )}
                      {entityLink && (
                        <Link to={entityLink} className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                          Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                    </td>
                    <td className="max-w-[340px] px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLog(log);
                          setShowRaw(false);
                        }}
                        className="audit-change-summary text-left text-slate-300 transition hover:text-cyan-100"
                        title={summary}
                      >
                        {truncate(summary)}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="audit-muted-pill">{formatLabel(log.source)}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getSeverityClass(log.severity)}`}>
                        {formatLabel(log.severity)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-400">{log.ipAddress || '-'}</td>
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLog(log);
                          setShowRaw(false);
                        }}
                        className="audit-secondary-button h-8 px-3 text-xs"
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

        {!loading && logs.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <Database className="h-9 w-9 text-slate-600" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-slate-100">No audit logs found.</h3>
            <p className="mt-1 text-sm text-slate-500">
              {hasServerFilters ? 'Try clearing filters or widening the date range.' : 'Activity will appear here after auditable actions occur.'}
            </p>
            {hasServerFilters && (
              <button type="button" className="audit-secondary-button mt-4 h-9 px-3 text-xs" onClick={clearFilters}>
                Clear Filters
              </button>
            )}
          </div>
        )}

        {!loading && logs.length > 0 && displayedLogs.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <Search className="h-9 w-9 text-slate-600" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-slate-100">No logs match your current filters.</h3>
            <p className="mt-1 text-sm text-slate-500">Clear search or filters to see more events.</p>
            <button type="button" className="audit-secondary-button mt-4 h-9 px-3 text-xs" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
          <span>
            Page {page} of {Math.max(1, totalPages)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="audit-secondary-button h-9 px-3 text-xs"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1 || loading}
            >
              Previous
            </button>
            <button
              type="button"
              className="audit-secondary-button h-9 px-3 text-xs"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {retentionModalOpen && retention && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Retention settings">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-[#111C30] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">Retention Settings</h2>
                <p className="mt-1 text-sm text-slate-400">Archive logs older than the configured window. Data is soft archived.</p>
              </div>
              <button
                ref={retentionCloseRef}
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                onClick={closeRetentionModal}
              >
                <X className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Close retention settings</span>
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs font-semibold text-slate-500">Current retention</p>
                <p className="mt-1 text-2xl font-semibold text-slate-50">{retention.retentionDays} days</p>
                <p className="mt-1 text-xs text-slate-500">
                  Last applied: {retention.lastAppliedAt ? formatDate(retention.lastAppliedAt, true) : 'Not applied yet'}
                </p>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-300">Retention duration</span>
                <select
                  value={pendingRetentionDays}
                  onChange={(event) => setPendingRetentionDays(Number(event.target.value))}
                  disabled={retentionUpdating}
                  className="audit-filter-control"
                >
                  {[30, 90, 180].map((value) => (
                    <option key={value} value={value}>
                      {value} days
                    </option>
                  ))}
                </select>
              </label>
              {retentionMessage && <p className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">{retentionMessage}</p>}
              {confirmApplyRetention && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  Confirm archival of audit logs older than {retention.retentionDays} days?
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button type="button" className="audit-secondary-button" onClick={closeRetentionModal}>
                Cancel
              </button>
              <button type="button" className="audit-secondary-button" onClick={updateRetention} disabled={retentionUpdating || pendingRetentionDays === retention.retentionDays}>
                {retentionUpdating ? 'Saving...' : 'Save Duration'}
              </button>
              {!confirmApplyRetention ? (
                <button type="button" className="audit-danger-button" onClick={() => setConfirmApplyRetention(true)}>
                  Apply Retention
                </button>
              ) : (
                <button type="button" className="audit-danger-button" onClick={applyRetention}>
                  Confirm Apply
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedLog && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Audit log details">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-black/60"
            onClick={() => setSelectedLog(null)}
            aria-label="Close audit log details"
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-slate-700 bg-[#0B1220] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cyan-200">Event Overview</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-slate-50">{formatLabel(selectedLog.action)}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedLog.id}</p>
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close details"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <section className="grid gap-4 rounded-xl border border-slate-800 bg-[#111C30] p-4 sm:grid-cols-2">
                <DetailField
                  label="Actor"
                  value={
                    <>
                      <span>{selectedLog.actor?.name || selectedLog.actor?.email || selectedLog.actorId || 'System'}</span>
                      {selectedLog.actor?.role && <span className="ml-2 text-xs text-slate-500">({formatLabel(String(selectedLog.actor.role))})</span>}
                    </>
                  }
                />
                <DetailField label="Exact timestamp" value={formatDate(selectedLog.createdAt, true)} />
                <DetailField label="Entity" value={`${formatLabel(selectedLog.entityType || selectedLog.category)}${selectedLog.entityId ? ` #${selectedLog.entityId}` : ''}`} />
                <DetailField label="Source" value={formatLabel(selectedLog.source)} />
                <DetailField
                  label="Severity"
                  value={<span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getSeverityClass(selectedLog.severity)}`}>{formatLabel(selectedLog.severity)}</span>}
                />
                <DetailField
                  label="Status"
                  value={<span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getStatusClass(selectedLog.status)}`}>{formatLabel(selectedLog.status)}</span>}
                />
                <DetailField label="IP address" value={selectedLog.ipAddress || '-'} />
                <DetailField label="Request" value={`${selectedLog.method || '-'} ${selectedLog.route || '-'}`} />
              </section>

              {(selectedLog.reason || selectedLog.trigger) && (
                <section className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                  <h3 className="text-sm font-semibold text-slate-100">Event Message</h3>
                  <p className="mt-2 text-sm text-slate-300">{selectedLog.reason || '-'}</p>
                  {selectedLog.trigger && <p className="mt-1 text-xs text-slate-500">Trigger: {selectedLog.trigger}</p>}
                </section>
              )}

              <section className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-100">Change Details</h3>
                  {getEntityLink(selectedLog) && (
                    <Link to={getEntityLink(selectedLog) as string} className="inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                      Open related record <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  )}
                </div>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                  {buildDiffLines(selectedLog, userMap).join('\n')}
                </pre>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                  <h3 className="text-sm font-semibold text-slate-100">Before value</h3>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                    {formatJson(selectedLog.before ?? selectedLog.oldValue ?? {})}
                  </pre>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                  <h3 className="text-sm font-semibold text-slate-100">After value</h3>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                    {formatJson(selectedLog.after ?? selectedLog.newValue ?? {})}
                  </pre>
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                <h3 className="text-sm font-semibold text-slate-100">Technical Information</h3>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <DetailField label="User agent" value={<span className="break-all">{selectedLog.userAgent || '-'}</span>} />
                  <DetailField label="Actor ID" value={<span className="break-all">{selectedLog.actorId || '-'}</span>} />
                  <DetailField label="Target user ID" value={<span className="break-all">{selectedLog.targetUserId || '-'}</span>} />
                  <DetailField label="Approval ID" value={<span className="break-all">{selectedLog.approvalId || '-'}</span>} />
                </div>
                <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                  {formatJson(selectedLog.metadata)}
                </pre>
              </section>

              {showRaw && (
                <section className="rounded-xl border border-slate-800 bg-[#111C30] p-4">
                  <h3 className="text-sm font-semibold text-slate-100">Structured JSON View</h3>
                  <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
                    {formatJson(selectedLog)}
                  </pre>
                </section>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => navigator.clipboard.writeText(selectedLog.id)} className="audit-secondary-button h-9 px-3 text-xs">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy Event ID
                </button>
                <button type="button" onClick={() => setShowRaw((prev) => !prev)} className="audit-secondary-button h-9 px-3 text-xs">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {showRaw ? 'Hide JSON' : 'Show JSON'}
                </button>
              </div>
              {selectedLog.category === 'automation' && selectedLog.status === 'failed' && (
                <button type="button" onClick={() => handleRetry(selectedLog)} className="audit-warning-button">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Retry Automation
                </button>
              )}
            </footer>
          </aside>
        </div>
      )}

      {retentionMessage && !retentionModalOpen && (
        <div className="fixed bottom-4 right-4 z-40 flex max-w-sm items-center gap-2 rounded-xl border border-cyan-400/20 bg-[#111C30] px-4 py-3 text-sm text-cyan-100 shadow-xl">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          {retentionMessage}
        </div>
      )}
    </div>
  );
};

export default Logs;
