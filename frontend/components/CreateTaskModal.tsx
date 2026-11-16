import SearchableMultiSelect from './ui/SearchableMultiSelect';
import Avatar from './Avatar';
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from 'react-dom';
import api from '../services/mockApi';
import { TaskPriority, User, UserStatus, RecurrenceRule, KanbanColumn, TaskStatus, Subtask, SubtaskStatus, Project, ProjectStatus, Role } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { formatRecurrenceRule, formatTaskStatus } from '../utils';
import { configurationStorageKey, STATUS_CONFIGURATION_EVENT } from '../utils/kanbanConfiguration';
import { PlusIcon, SparklesIcon } from './icons';
import GenerateTaskWithAIModal from './GenerateTaskWithAIModal';
import SingleSelect from './ui/SingleSelect';
import { taskDateTimeInstant } from '../utils/taskDates';
import SubtaskDueDateField from './SubtaskDueDateField';
import TaskAttachments from './TaskAttachments';
import DatePicker from './ui/DatePicker';
import TimePicker from './ui/TimePicker';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { CalendarDays, ChevronDown, Settings2, Upload, X } from 'lucide-react';
import './CreateTaskModal.css';

type ThemeMode = 'dark' | 'colorful' | 'light';

type SubtaskDraft = {
    draftId?: string;
    dueDate?: string | null;
    hasDueDate?: boolean;
    title: string;
    completed: boolean;
    assignedToId: string | null;
    status: SubtaskStatus;
    assigneeTouched?: boolean;
};

interface ThemeConfig {
    name: string;
    gradient: string;
    surface: string;
    sectionBorder: string;
    text: string;
    mutedText: string;
    placeholder: string;
    accent: string;
    accentSoft: string;
    input: string;
    inputHover: string;
    dropdown: string;
    chipBg: string;
    chipText: string;
    chipBorder: string;
    chipHover: string;
    ring: string;
    shadow: string;
    sectionShadow: string;
    glowOne: string;
    glowTwo: string;
}

const THEME_MODES: Record<ThemeMode, ThemeConfig> = {
    dark: {
        name: 'Dark',
        gradient: 'linear-gradient(135deg, rgba(13,16,35,0.95), rgba(27,31,56,0.95))',
        surface: 'linear-gradient(160deg, rgba(17,24,39,0.75), rgba(15,23,42,0.55))',
        sectionBorder: 'rgba(148, 163, 184, 0.2)',
        text: '#f8fafc',
        mutedText: 'rgba(226, 232, 240, 0.78)',
        placeholder: 'rgba(226, 232, 240, 0.58)',
        accent: '#6366f1',
        accentSoft: 'rgba(99,102,241,0.25)',
        input: 'rgba(15,23,42,0.6)',
        inputHover: 'rgba(30,41,59,0.75)',
        dropdown: 'rgba(10,15,31,0.985)',
        chipBg: 'rgba(99,102,241,0.18)',
        chipText: '#c4c6ff',
        chipBorder: 'rgba(99,102,241,0.55)',
        chipHover: 'rgba(99,102,241,0.28)',
        ring: 'rgba(99,102,241,0.35)',
        shadow: '0 50px 120px rgba(15,23,42,0.7)',
        sectionShadow: '0 25px 50px rgba(15,23,42,0.35)',
        glowOne: 'rgba(99,102,241,0.35)',
        glowTwo: 'rgba(56,189,248,0.25)',
    },
    colorful: {
        name: 'Colorful',
        gradient: 'linear-gradient(135deg, rgba(217,70,239,0.85), rgba(59,130,246,0.85), rgba(139,92,246,0.85))',
        surface: 'linear-gradient(160deg, rgba(255,255,255,0.85), rgba(241,245,249,0.75))',
        sectionBorder: 'rgba(79, 70, 229, 0.25)',
        text: '#111827',
        mutedText: 'rgba(55, 65, 81, 0.6)',
        placeholder: 'rgba(71, 85, 105, 0.4)',
        accent: '#db2777',
        accentSoft: 'rgba(219,39,119,0.2)',
        input: 'rgba(255,255,255,0.9)',
        inputHover: 'rgba(255,255,255,1)',
        dropdown: 'rgba(255,255,255,0.98)',
        chipBg: 'rgba(59,130,246,0.18)',
        chipText: '#1e3a8a',
        chipBorder: 'rgba(59,130,246,0.35)',
        chipHover: 'rgba(59,130,246,0.28)',
        ring: 'rgba(219,39,119,0.3)',
        shadow: '0 40px 120px rgba(59,130,246,0.35)',
        sectionShadow: '0 20px 45px rgba(59,130,246,0.25)',
        glowOne: 'rgba(217,70,239,0.35)',
        glowTwo: 'rgba(59,130,246,0.3)',
    },
    light: {
        name: 'Light',
        gradient: 'linear-gradient(135deg, rgba(248,250,252,0.95), rgba(226,232,240,0.92))',
        surface: 'linear-gradient(160deg, rgba(255,255,255,0.95), rgba(241,245,249,0.9))',
        sectionBorder: 'rgba(148, 163, 184, 0.35)',
        text: '#0f172a',
        mutedText: 'rgba(30, 41, 59, 0.55)',
        placeholder: 'rgba(100, 116, 139, 0.4)',
        accent: '#0ea5e9',
        accentSoft: 'rgba(14,165,233,0.18)',
        input: 'rgba(248,250,252,0.95)',
        inputHover: 'rgba(255,255,255,1)',
        dropdown: 'rgba(255,255,255,0.98)',
        chipBg: 'rgba(14,165,233,0.12)',
        chipText: '#0369a1',
        chipBorder: 'rgba(14,165,233,0.35)',
        chipHover: 'rgba(14,165,233,0.2)',
        ring: 'rgba(14,165,233,0.35)',
        shadow: '0 35px 80px rgba(148,163,184,0.35)',
        sectionShadow: '0 18px 40px rgba(148,163,184,0.25)',
        glowOne: 'rgba(14,165,233,0.3)',
        glowTwo: 'rgba(236,72,153,0.2)',
    },
};

const QUICK_DATE_PRESETS = [
    { label: 'Today', offset: 0 },
    { label: 'Tomorrow', offset: 1 },
    { label: 'Next Week', offset: 7 },
    { label: 'In 2 Weeks', offset: 14 },
];

const QUICK_TIME_PRESETS = [
    { label: 'Morning', value: '10:00' },
    { label: 'Midday', value: '13:00' },
    { label: 'Afternoon', value: '15:00' },
    { label: 'EOD', value: '20:00' },
];

const DEFAULT_EOD_TIME = '20:00';
const DUE_DATE_CUTOFF_HOUR = 18;

const formatDateInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const resolveDefaultDueDateTime = (now = new Date()) => {
    const target = new Date(now);
    if (now.getHours() >= DUE_DATE_CUTOFF_HOUR) {
        target.setDate(target.getDate() + 1);
    }
    while (target.getDay() === 0) {
        target.setDate(target.getDate() + 1);
    }
    target.setHours(0, 0, 0, 0);
    return {
        date: formatDateInput(target),
        time: DEFAULT_EOD_TIME,
    };
};

const TAG_SUGGESTIONS = ['Urgent', 'Client', 'Follow-up', 'QA', 'Research', 'Blocked', 'Launch'];

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
  initialDueDate?: string | null;
  dueTimezone?: string;
  ticketId?: string;
  ticketTitle?: string;
  ticketDescription?: string;
}

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
    isOpen,
    onClose,
    onTaskCreated,
    initialDueDate = null,
    dueTimezone,
    ticketId,
    ticketTitle,
    ticketDescription,
}) => {
    const { user: currentUser } = useAuth();
    const { notify } = useToast();
    const isTicketMode = Boolean(ticketId);

    // Core fields
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [assignedTo, setAssignedTo] = useState<string[]>([]);
    const [followerIds, setFollowerIds] = useState<string[]>([]);
    const [priority, setPriority] = useState<TaskPriority>(TaskPriority.LOW);
    const [status, setStatus] = useState('');
    const [holdReason, setHoldReason] = useState('');
    const [dueDate, setDueDate] = useState(() => resolveDefaultDueDateTime().date);
    const [dueTime, setDueTime] = useState(() => resolveDefaultDueDateTime().time);
    const [team, setTeam] = useState('');
    const [projectId, setProjectId] = useState('');
    const [projectSearch, setProjectSearch] = useState('');
    const [projectPage, setProjectPage] = useState(1);
    const [projectResults, setProjectResults] = useState<Project[]>([]);
    const [projectHasMore, setProjectHasMore] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [projectRetry, setProjectRetry] = useState(0);
    const [subtaskApprovalOverride, setSubtaskApprovalOverride] = useState<'inherit' | 'required' | 'not_required'>('inherit');
    const [approvalRequired, setApprovalRequired] = useState(false);
    const [approverId, setApproverId] = useState<string | null>(null);

    // Enhancements
    const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [attachmentFiles, setAttachmentFiles] = useState<Record<string, File>>({});
    const [currentAttachment, setCurrentAttachment] = useState('');
    const [estimatedHours, setEstimatedHours] = useState<number | ''>('');
    const [estimatedMinutes, setEstimatedMinutes] = useState<number | ''>('');
    const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>(RecurrenceRule.NONE);
    const [repeatInterval, setRepeatInterval] = useState(1);
    const [repeatEndDate, setRepeatEndDate] = useState('');
    const [recurrenceTimezone, setRecurrenceTimezone] = useState(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    });
    const [tags, setTags] = useState<string[]>([]);
    const [currentTag, setCurrentTag] = useState('');

    const [users, setUsers] = useState<User[]>(() => (
        currentUser ? [currentUser] : []
    ));
    const [projects, setProjects] = useState<Project[]>([]);
    const [isProjectsLoading, setIsProjectsLoading] = useState(false);
    const [columns, setColumns] = useState<KanbanColumn[]>([]);
    const [isStatusesLoading, setIsStatusesLoading] = useState(true);
    const [statusError, setStatusError] = useState('');
    const [statusRetry, setStatusRetry] = useState(0);
    const [isAssigneesLoading, setIsAssigneesLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const additionalRef = useRef<HTMLDivElement>(null);
    const addSubtaskRef = useRef<HTMLButtonElement>(null);
    const aiTriggerRef = useRef<HTMLButtonElement>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    const [additionalOpen, setAdditionalOpen] = useState(false);
    const [dateOptionsOpen, setDateOptionsOpen] = useState(false);
    const [uploads, setUploads] = useState<Array<{ id: string; file: File; progress: number; error?: string }>>([]);
    const uploadControllers = useRef(new Map<string, AbortController>());
    const uploadGeneration = useRef(0);
    const [error, setError] = useState('');
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const closeAiModal = () => {
        setIsAiModalOpen(false);
        window.requestAnimationFrame(() => aiTriggerRef.current?.focus());
    };
    const themeMode: ThemeMode = 'dark';
    useEffect(() => {
        if (!isOpen || !initialDueDate) return;
        const date = new Date(initialDueDate);
        if (Number.isNaN(date.getTime())) return;
        setDueDate(formatDateInput(date));
        setDueTime(date.toTimeString().slice(0, 5));
    }, [isOpen, initialDueDate]);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [followerSearch, setFollowerSearch] = useState('');
    const primaryTaskAssigneeId = assignedTo[0] ?? null;

    const statusOptions = columns.map(column => ({ id: column.id, name: column.title }));

    const allowedPriorities = useMemo(
        () => Object.values(TaskPriority),
        []
    );

    const priorityOptions = allowedPriorities.map((p) => ({
        id: p,
        name: `${String(p).charAt(0)}${String(p).slice(1).toLowerCase()}`,
    }));

    const projectOptions = useMemo(
        () => projectResults.map((project) => ({
            id: project.id,
            name: project.name,
            description: project.client?.companyName || project.description || 'No client details',
            active: project.status === ProjectStatus.ACTIVE,
            statusLabel: project.status,
        })),
        [projectResults],
    );

    useEffect(() => {
        if (!allowedPriorities.includes(priority)) {
            setPriority(TaskPriority.LOW);
        }
    }, [allowedPriorities, priority]);

    useEffect(() => {
        if (!isOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    const recurrenceOptions = Object.values(RecurrenceRule).map((rule) => ({
        id: rule,
        name: rule === RecurrenceRule.AFTER_COMPLETION ? 'Custom repeat' : formatRecurrenceRule(rule),
    }));

    const teamOptions = useMemo(() => {
        const departments = new Set<string>();
        users.forEach((member) => {
            if (member.department) departments.add(member.department);
        });
        if (team) departments.add(team);
        if (currentUser?.department) departments.add(currentUser.department);
        return Array.from(departments).sort().map((department) => ({ id: department, name: department }));
    }, [currentUser?.department, team, users]);

    const theme = THEME_MODES[themeMode];

    const themeVariables = useMemo<React.CSSProperties>(() => ({
        '--modal-shell-bg': theme.gradient,
        '--modal-surface-bg': theme.surface,
        '--modal-border': theme.sectionBorder,
        '--modal-text': theme.text,
        '--modal-muted': theme.mutedText,
        '--modal-placeholder': theme.placeholder,
        '--modal-accent': theme.accent,
        '--modal-accent-soft': theme.accentSoft,
        '--modal-input-bg': theme.input,
        '--modal-input-hover': theme.inputHover,
        '--modal-dropdown-bg': theme.dropdown,
        '--modal-chip-bg': theme.chipBg,
        '--modal-chip-text': theme.chipText,
        '--modal-chip-border': theme.chipBorder,
        '--modal-chip-hover': theme.chipHover,
        '--modal-ring': theme.ring,
        '--modal-shadow': theme.shadow,
        '--modal-section-shadow': theme.sectionShadow,
        '--modal-glow-one': theme.glowOne,
        '--modal-glow-two': theme.glowTwo,
    } as React.CSSProperties), [theme]);

    const modalStyle = useMemo<React.CSSProperties>(() => ({
        ...themeVariables,
        background: theme.gradient,
        borderColor: theme.sectionBorder,
        boxShadow: theme.shadow,
        color: theme.text,
    }), [themeVariables, theme]);

    useEffect(() => {
        if (!isOpen || !currentUser) return;

        let isCancelled = false;
        const immediateUsers = [currentUser];

        // Paint assignees immediately, then refresh the full team list in the background.
        setUsers(immediateUsers);
        setIsAssigneesLoading(true);
        setTeam(currentUser.department);

        setHoldReason('');
        setProjectId('');
        setProjects([]);
        setProjectSearch('');
        setProjectPage(1);
        setProjectResults([]);

        api.getUsers()
            .then((allUsers) => {
                if (isCancelled) return;
                const activeUsers = Array.isArray(allUsers)
                    ? allUsers.filter((u) => u.status === 'ACTIVE')
                    : [];
                const nextUsers = activeUsers.length > 0 ? activeUsers : [currentUser];
                setUsers(nextUsers);
            })
            .catch((err) => {
                if (isCancelled) return;
                if (err instanceof Error) {
                    console.error('Failed to fetch users for assignee picker:', err.message);
                } else {
                    console.error('Failed to fetch users for assignee picker: Unknown error');
                }
                setUsers(immediateUsers);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsAssigneesLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [isOpen, currentUser, isTicketMode]);

    useEffect(() => {
        if (!isOpen || !currentUser) return;
        let stopped = false;
        let requestId = 0;
        setColumns([]);
        setStatus('');
        const load = async () => {
            const request = ++requestId;
            setIsStatusesLoading(true);
            setStatusError('');
            try {
                const configured = await api.getKanbanColumns();
                if (stopped || request !== requestId) return;
                const active = configured.filter(column => column.isActive !== false).sort((a, b) => a.order - b.order);
                setColumns(active);
                setStatus(current => active.some(column => column.id === current) ? current
                    : active.find(column => column.id === TaskStatus.WAITING_FOR_REQUIREMENT)?.id ?? active[0]?.id ?? '');
                if (!active.length) setStatusError('No active task statuses are available. Contact your workspace owner.');
            } catch {
                if (stopped || request !== requestId) return;
                setColumns([]);
                setStatus('');
                setStatusError('Unable to load active task statuses. Please retry.');
            } finally {
                if (!stopped && request === requestId) setIsStatusesLoading(false);
            }
        };
        const changed = (event: Event) => {
            if ((event as CustomEvent).detail?.tenantId === currentUser.tenantId) void load();
        };
        const stored = (event: StorageEvent) => {
            if (currentUser.tenantId && event.key === configurationStorageKey(currentUser.tenantId)) void load();
        };
        const focused = () => { void load(); };
        void load();
        window.addEventListener(STATUS_CONFIGURATION_EVENT, changed);
        window.addEventListener('storage', stored);
        window.addEventListener('focus', focused);
        return () => {
            stopped = true;
            window.removeEventListener(STATUS_CONFIGURATION_EVENT, changed);
            window.removeEventListener('storage', stored);
            window.removeEventListener('focus', focused);
        };
    }, [isOpen, currentUser?.id, currentUser?.tenantId, statusRetry]);

    useEffect(() => {
        if (!isOpen || !currentUser || isTicketMode) return;
        let active = true;
        setIsProjectsLoading(true);
        setProjectError(null);
        const timer = window.setTimeout(async () => {
            try {
                const response = await api.getProjects({ status: ProjectStatus.ACTIVE, page: projectPage,
                    pageSize: 25, q: projectSearch.trim(), sortBy: 'name', sortOrder: 'asc' });
                if (!active) return;
                const visible = (response.items ?? []).filter(project => project.status === ProjectStatus.ACTIVE);
                setProjectResults(current => projectPage === 1 ? visible
                    : Array.from(new Map([...current, ...visible].map(project => [project.id, project])).values()));
                // Keep selected project metadata while searching other pages. Membership
                // restrictions and inherited approval settings still use this record.
                setProjects(current => Array.from(new Map([...current, ...visible].map(project => [project.id, project])).values()));
                setProjectHasMore(response.page < response.totalPages);
                if (!projectSearch.trim() && projectPage === 1 && response.total === 1 && visible.length === 1) {
                    setProjectId(current => current || visible[0].id);
                }
            } catch (err) {
                if (active) setProjectError(err instanceof Error ? err.message : 'Unable to load projects.');
            } finally {
                if (active) setIsProjectsLoading(false);
            }
        }, projectSearch ? 250 : 0);
        return () => { active = false; window.clearTimeout(timer); };
    }, [isOpen, currentUser, isTicketMode, projectSearch, projectPage, projectRetry]);

    useEffect(() => {
        if (!isOpen || !isTicketMode) return;
        setTitle(ticketTitle ?? '');
        setDescription(ticketDescription ?? '');
    }, [isOpen, isTicketMode, ticketTitle, ticketDescription]);

    const resetForm = () => {
        ++uploadGeneration.current;
        uploadControllers.current.forEach(controller => controller.abort());
        uploadControllers.current.clear();
        setUploads([]);
        setAdditionalOpen(false);
        setDateOptionsOpen(false);
        setTitle(ticketTitle ?? '');
        setDescription(ticketDescription ?? '');
        setAssignedTo([]);
        setFollowerIds([]);
        setPriority(TaskPriority.LOW);
        // Use column id as status so it aligns with how TaskDetailModal and the API expect statuses
        setStatus(''); setHoldReason('');
        // Initialize dueDate and dueTime from initialDueDate if provided
        if (initialDueDate) {
            const date = new Date(initialDueDate);
            setDueDate(formatDateInput(date));
            setDueTime(date.toTimeString().slice(0, 5));
        } else {
            const defaults = resolveDefaultDueDateTime(new Date());
            setDueDate(defaults.date);
            setDueTime(defaults.time);
        }
        setError('');
        setIsSubmitting(false);
        if (currentUser) setTeam(currentUser.department);
        setSubtasks([]);
        setAttachments([]);
        setAttachmentFiles({});
        setCurrentAttachment('');
        setEstimatedHours('');
        setEstimatedMinutes('');
        setRecurrenceRule(RecurrenceRule.NONE);
        setRepeatInterval(1);
        setRepeatEndDate('');
        setTags([]);
        setCurrentTag('');
        setApprovalRequired(false);
        setApproverId(null);
        setSubtaskApprovalOverride('inherit');
        setAssigneeSearch('');
        setFollowerSearch('');
    };

    const handleClose = () => {
        if (submittingRef.current) return;
        resetForm();
        onClose();
    };

    const handleAddSubtask = () => {
            const index = subtasks.length;
            setSubtasks([
                ...subtasks,
                {
                    draftId: crypto.randomUUID(),
                    title: '',
                    completed: false,
                    assignedToId: primaryTaskAssigneeId,
                    status: SubtaskStatus.TODO,
                    assigneeTouched: false,
                },
            ]);
            window.requestAnimationFrame(() => {
                const field = formRef.current?.querySelector<HTMLElement>(`[data-subtask-index="${index}"] [data-subtask-field="title"]`);
                field?.focus();
                field?.scrollIntoView({ block: 'nearest' });
            });
        };
    const handleToggleSubtask = (index: number) => {
        setSubtasks((current) => current.map((subtask, itemIndex) => {
            if (itemIndex !== index) return subtask;
            const completed = !subtask.completed;
            return {
                ...subtask,
                completed,
                status: completed ? SubtaskStatus.DONE : SubtaskStatus.TODO,
            };
        }));
    };
    const handleRemoveSubtask = (index: number) => {
        setSubtasks(subtasks.filter((_, i) => i !== index));
        window.requestAnimationFrame(() => {
            const nextIndex = Math.min(index, subtasks.length - 2);
            const next = formRef.current?.querySelector<HTMLElement>(`[data-subtask-index="${nextIndex}"] [data-subtask-field="title"]`);
            (next ?? addSubtaskRef.current)?.focus();
        });
    };
    const updateSubtaskDraft = (index: number, updates: Partial<SubtaskDraft>) => {
        setSubtasks((current) => current.map((subtask, itemIndex) => {
            if (itemIndex !== index) return subtask;
            const next = { ...subtask, ...updates };
            if (updates.status !== undefined) {
                next.completed = updates.status === SubtaskStatus.DONE;
            }
            return next;
        }));
    };

    const handleAddAttachment = () => {
        if (currentAttachment.trim()) {
            setAttachments([...attachments, currentAttachment.trim()]);
            setCurrentAttachment('');
        }
    };
    const handleRemoveAttachment = (index: number) => {
        const removed = attachments[index];
        const remaining = attachments.filter((_, i) => i !== index);
        setAttachments(remaining);
        if (removed && !remaining.includes(removed)) setAttachmentFiles(current => {
            const next = { ...current }; delete next[removed]; return next;
        });
    };

    const uploadFile = async (id: string, file: File) => {
        const generation = uploadGeneration.current;
        const controller = new AbortController();
        uploadControllers.current.set(id, controller);
        setUploads(current => [...current.filter(item => item.id !== id), { id, file, progress: 0 }]);
        try {
            const uploaded = await api.uploadTaskAttachment(file, progress => {
                if (generation === uploadGeneration.current && !controller.signal.aborted) {
                    setUploads(current => current.map(item => item.id === id ? { ...item, progress } : item));
                }
            }, controller.signal);
            if (generation !== uploadGeneration.current || controller.signal.aborted) return;
            setAttachments(current => [...current, uploaded.url]);
            setAttachmentFiles(current => ({ ...current, [uploaded.url]: file }));
            setUploads(current => current.filter(item => item.id !== id));
        } catch (error) {
            if (generation !== uploadGeneration.current || controller.signal.aborted) return;
            setUploads(current => current.map(item => item.id === id ? { ...item,
                error: error instanceof Error ? error.message : 'Unable to upload this file.' } : item));
        } finally {
            uploadControllers.current.delete(id);
        }
    };
    const handleAttachmentFiles = (files: FileList | File[]) => {
        Array.from(files).forEach(file => { void uploadFile(crypto.randomUUID(), file); });
    };
    useEffect(() => () => {
        ++uploadGeneration.current;
        uploadControllers.current.forEach(controller => controller.abort());
    }, []);

    const focusField = (field: HTMLElement) => {
        if (additionalRef.current?.contains(field)) setAdditionalOpen(true);
        if (field.closest('#task-due-options')) setDateOptionsOpen(true);
        window.requestAnimationFrame(() => {
            field.focus();
            field.scrollIntoView({ block: 'nearest' });
        });
    };

    const handleTagInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e.key === ',' || e.key === 'Enter') && currentTag.trim()) {
            e.preventDefault();
            const newTag = currentTag.trim().replace(',', '');
            if (newTag && !tags.includes(newTag)) {
                setTags([...tags, newTag]);
            }
            setCurrentTag('');
        }
    };
    const handleRemoveTag = (index: number) => setTags(tags.filter((_, i) => i !== index));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submittingRef.current) return;
        const invalid = formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:invalid, textarea:invalid, select:invalid');
        if (invalid) {
            setError(`${invalid.labels?.[0]?.textContent || invalid.getAttribute('aria-label') || 'Field'}: ${invalid.validationMessage}`);
            focusField(invalid);
            return;
        }
        const emptySubtask = subtasks.findIndex(subtask => !subtask.title.trim());
        if (emptySubtask >= 0) {
            setError(`Subtask ${emptySubtask + 1}: Enter a title.`);
            const field = formRef.current?.querySelector<HTMLElement>(`[data-subtask-index="${emptySubtask}"] [data-subtask-field="title"]`);
            if (field) focusField(field);
            return;
        }
        if (uploadControllers.current.size || uploads.some(item => item.error)) {
            setError('Wait for attachments to finish uploading, or retry or remove failed uploads.');
            return;
        }
        if (!currentUser) {
            setError('You must be logged in to create a task.');
            return;
        }
        if (!isTicketMode && (isStatusesLoading || !columns.some(column => column.id === status))) {
            setError(statusError || 'Select an active task status before creating the task.');
            const field = document.getElementById('status');
            if (field) focusField(field);
            return;
        }
        if (!dueDate || !dueTime) {
            setError('Due date and due time are required.');
            const field = document.getElementById(!dueDate ? 'dueDate' : 'dueTime');
            if (field) focusField(field);
            return;
        }
        if (!isTicketMode && !projectId) {
            setError('Select a project before creating the task.');
            const project = document.getElementById('projectId');
            if (project) focusField(project);
            return;
        }
        if (isTicketMode && approvalRequired && !approverId) {
            setError('Select an approver for approval-required tasks.');
            const approver = document.getElementById('taskApprover');
            if (approver) focusField(approver);
            return;
        }
        submittingRef.current = true;
        setIsSubmitting(true);
        setError('');
        try {
            const dueAt = dueTimezone
                ? taskDateTimeInstant(dueDate, dueTime, dueTimezone)
                : `${dueDate}T${dueTime}:00`;
            if (ticketId) {
            await api.createTicketTask(ticketId, {
                dueAt,
                priority,
                approvalRequired,
                approverId: approvalRequired ? approverId : null,
            });
            onTaskCreated();
            submittingRef.current = false;
            handleClose();
            notify('Task added to ticket.');
            return;
        }
            const finalSubtasks: Subtask[] = subtasks.map((subtask, index) => ({
                id: `sub-${Date.now()}-${Math.random()}`,
                title: subtask.title.trim(),
                completed: subtask.completed || subtask.status === SubtaskStatus.DONE,
                assignedToId: subtask.assignedToId,
                dueDate: subtask.hasDueDate ? subtask.dueDate ?? null : null,
                status: subtask.status,
                sortOrder: index,
            }));

            const estimatedHoursValue =
                (Number(estimatedHours) || 0) + ((Number(estimatedMinutes) || 0) / 60);

            const taskData = {
                title,
                description,
                projectId,
                priority,
                status: status as TaskStatus,
                holdReason,
                dueAt,
                team,
                recurringTaskId: null,
                subtasks: finalSubtasks,
                attachments,
                estimatedHours: estimatedHoursValue > 0 ? Number(estimatedHoursValue.toFixed(2)) : null,
                recurrenceRule,
                tags,
                assignedTo,
                followerIds,
                subtaskApprovalRequired:
                    subtaskApprovalOverride === 'inherit'
                        ? null
                        : subtaskApprovalOverride === 'required',
            };

            const shouldLinkGroup = assignedTo.length > 1;
            const groupId =
                shouldLinkGroup && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : shouldLinkGroup
                        ? `task-group-${Date.now()}`
                        : null;

            await api.createTask(
                {
                    ...taskData,
                    assignedTo: assignedTo.length ? assignedTo : null,
                    taskGroupId: groupId,
            },
            currentUser.id,
        );
        onTaskCreated();
        submittingRef.current = false;
        handleClose();
        notify('Task created successfully.');
        } catch (err: any) {
            setError(err.message || 'Failed to create task. Please try again.');
            const message = String(err.message || '').toLowerCase();
            const validationTargets: Record<string, string> = {
                estimated_hours: 'estimatedHours', team: 'team', tags: 'taskTags', follower_ids: 'followers',
                recurrence_rule: 'recurrence', subtask_approval_required: 'subtaskApprovalOverride',
                approver_id: 'taskApprover', approval_required: 'taskApprover', project_id: 'projectId',
                title: 'title', description: 'description', due_at: 'dueDate', assigned_to_ids: 'assignedTo',
                status: 'status', priority: 'priority',
            };
            const validationFields: string[] = Array.isArray(err.validationFields) ? err.validationFields : [];
            const subtaskPath = validationFields.map(path => path.match(/(?:^|\.)subtasks\.(\d+)\.(\w+)/)).find(Boolean);
            const subtaskRow = subtaskPath && formRef.current?.querySelector<HTMLElement>(`[data-subtask-index="${subtaskPath[1]}"]`);
            const subtaskField = subtaskRow?.querySelector<HTMLElement>(`[data-subtask-field="${subtaskPath?.[2]}"]`)
                ?? (subtaskPath?.[2] === 'due_date' ? subtaskRow?.querySelector<HTMLElement>('input[type="date"], .space-y-2 input[type="checkbox"]') : null);
            const validationTarget = validationFields.filter(path => !/(?:^|\.)subtasks\./.test(path)).map(path => path.split('.').find(key => validationTargets[key]))
                .find(Boolean);
            const advancedField = [['estimated', 'estimatedHours'], ['minute', 'estimatedMinutes'], ['hour', 'estimatedHours'],
                ['team', 'team'], ['tag', 'taskTags'], ['recurrence', 'recurrence'], ['follower', 'followers'], ['approv', isTicketMode ? 'taskApprover' : 'subtaskApprovalOverride']]
                .find(([term]) => message.includes(term));
            const targetId = validationTarget ? validationTargets[validationTarget] : advancedField?.[1];
            const field = targetId && document.getElementById(targetId);
            if (subtaskField) focusField(subtaskField);
            else if (field) focusField(field);
            else window.requestAnimationFrame(() => {
                errorRef.current?.focus();
                errorRef.current?.scrollIntoView({ block: 'nearest' });
            });
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const handleTaskGenerated = (data: { title: string; description: string; priority: TaskPriority; subtasks?: string[] }) => {
        setTitle(data.title);
        setDescription(data.description);
        const nextPriority = allowedPriorities.includes(data.priority) ? data.priority : TaskPriority.LOW;
        setPriority(nextPriority);
        if (data.subtasks !== undefined) {
            setSubtasks(data.subtasks
                .filter((item) => item.trim().length > 0)
                .map((item) => ({
                    draftId: crypto.randomUUID(),
                    title: item.trim(),
                    completed: false,
                    assignedToId: primaryTaskAssigneeId,
                    status: SubtaskStatus.TODO,
                    assigneeTouched: false,
                })));
        }
    };

    const fieldClass = 'modal-input w-full text-sm';
    const handleApplyQuickDate = (offset: number) => {
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + offset);
        setDueDate(formatDateInput(base));
    };

    const handleApplyQuickTime = (value: string) => {
        setDueTime(value);
    };

    const handleAddTagSuggestion = (tag: string) => {
        if (!tags.includes(tag)) {
            setTags([...tags, tag]);
        }
    };

    const toggleAssignee = useCallback((userId: string) => {
        setAssignedTo((current) => (
            current.includes(userId)
                ? current.filter((id) => id !== userId)
                : [...current, userId]
        ));
    }, []);

    const toggleFollower = useCallback((userId: string) => {
        setFollowerIds((current) => (
            current.includes(userId)
                ? current.filter((id) => id !== userId)
                : [...current, userId]
        ));
    }, []);

    const selectedProject = useMemo(
        () => projects.find((project) => project.id === projectId) ?? null,
        [projectId, projects],
    );

    const projectMemberIds = useMemo(
        () => new Set((selectedProject?.members ?? []).map((member) => member.userId)),
        [selectedProject],
    );

    const assignableUsers = useMemo(() => {
        if (!selectedProject) {
            return users;
        }
        return users.filter((member) => projectMemberIds.has(member.id));
    }, [projectMemberIds, selectedProject, users]);

    useEffect(() => {
        if (!selectedProject) {
            return;
        }
        setAssignedTo((current) => current.filter((userId) => projectMemberIds.has(userId)));
        setFollowerIds((current) => current.filter((userId) => projectMemberIds.has(userId)));
        setSubtasks((current) => current.map((subtask) => (
            subtask.assignedToId && !projectMemberIds.has(subtask.assignedToId)
                ? { ...subtask, assignedToId: null, assigneeTouched: false }
                : subtask
        )));
    }, [projectMemberIds, selectedProject]);

    useEffect(() => {
        setSubtasks((current) => current.map((subtask) => {
            if (subtask.assigneeTouched || subtask.assignedToId === primaryTaskAssigneeId) {
                return subtask;
            }
            return { ...subtask, assignedToId: primaryTaskAssigneeId };
        }));
    }, [primaryTaskAssigneeId]);

    const filteredAssignees = useMemo(() => {
        const term = assigneeSearch.trim().toLowerCase();
        const matches = term
            ? assignableUsers.filter((member) => (
                member.name.toLowerCase().includes(term)
                || member.email.toLowerCase().includes(term)
                || member.role.toLowerCase().includes(term)
                || (member.department ?? '').toLowerCase().includes(term)
            ))
            : assignableUsers;
        return matches.slice(0, 80);
    }, [assigneeSearch, assignableUsers]);

    const filteredFollowers = useMemo(() => {
        const assignedSet = new Set(assignedTo);
        const term = followerSearch.trim().toLowerCase();
        const availableUsers = assignableUsers.filter((member) => !assignedSet.has(member.id));
        const matches = term
            ? availableUsers.filter((member) => (
                member.name.toLowerCase().includes(term)
                || member.email.toLowerCase().includes(term)
                || member.role.toLowerCase().includes(term)
                || (member.department ?? '').toLowerCase().includes(term)
            ))
            : availableUsers;
        return matches.slice(0, 10);
    }, [assignedTo, followerSearch, assignableUsers]);

    useEffect(() => {
        if (assignedTo.length === 0) return;
        const assignedSet = new Set(assignedTo);
        setFollowerIds((current) => current.filter((userId) => !assignedSet.has(userId)));
    }, [assignedTo]);

    const formatRoleLabel = useCallback((role: Role) => role.charAt(0).toUpperCase() + role.slice(1), []);

    const approverCandidates = useMemo(
        () => users.filter((candidate) => candidate.status === UserStatus.ACTIVE),
        [users],
    );

    const dueDateDisplay = useMemo(() => {
        if (!dueDate) return 'No due date';
        const timeToUse = dueTime || '00:00';
        const scheduled = new Date(`${dueDate}T${timeToUse}`);
        const formatter = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            ...(dueTime ? { timeStyle: 'short' } : {}),
        });
        return formatter.format(scheduled);
    }, [dueDate, dueTime]);

    const filteredTagSuggestions = useMemo(
        () => TAG_SUGGESTIONS.filter((tag) => !tags.includes(tag)),
        [tags]
    );

    const selectedUsers = useMemo(
        () => users.filter((member) => assignedTo.includes(member.id)),
        [assignedTo, users]
    );

    const selectedFollowers = useMemo(
        () => users.filter((member) => followerIds.includes(member.id)),
        [followerIds, users]
    );

    const workloadLabel = useMemo(() => {
        const total = (Number(estimatedHours) || 0) + ((Number(estimatedMinutes) || 0) / 60);
        if (total === 0) return 'Unestimated';
        if (total <= 2) return 'Light workload';
        if (total <= 6) return 'Focused block';
        return 'Heavy lift';
    }, [estimatedHours, estimatedMinutes]);

    const recurrencePreview = useMemo(() => {
        if (recurrenceRule === RecurrenceRule.NONE) return 'Does not repeat';
        const time = dueTime || DEFAULT_EOD_TIME;
        const interval = Math.max(1, repeatInterval || 1);
        const end = repeatEndDate ? ` until ${new Date(repeatEndDate).toLocaleDateString()}` : '';
        if (recurrenceRule === RecurrenceRule.DAILY) {
            return interval === 1 ? `Every day at ${time}${end}` : `Every ${interval} days at ${time}${end}`;
        }
        if (recurrenceRule === RecurrenceRule.WEEKLY) {
            const weekday = dueDate
                ? new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${dueDate}T00:00:00`))
                : 'selected weekday';
            return interval === 1 ? `Every ${weekday} at ${time}${end}` : `Every ${interval} weeks on ${weekday} at ${time}${end}`;
        }
        if (recurrenceRule === RecurrenceRule.MONTHLY) {
            const day = dueDate ? new Date(`${dueDate}T00:00:00`).getDate() : 1;
            return interval === 1 ? `Every month on day ${day} at ${time}${end}` : `Every ${interval} months on day ${day} at ${time}${end}`;
        }
        return `Custom repeat every ${interval} cycle(s) at ${time}${end}`;
    }, [dueDate, dueTime, recurrenceRule, repeatEndDate, repeatInterval]);

    if (!isOpen) return null;

    return createPortal(
        <Dialog open={isOpen} initialFocus={titleRef} onClose={() => {
            if (isAiModalOpen) closeAiModal();
            else handleClose();
        }} className="create-task-dialog" aria-describedby="create-task-subtitle">
            <DialogBackdrop className="create-task-backdrop" />
            <div className="create-task-position">
                <DialogPanel className="task-modal create-task-modal" style={modalStyle} data-theme={themeMode}>
                    <form ref={formRef} onSubmit={handleSubmit} onChange={() => { if (error) setError(''); }} noValidate aria-label="Create task" aria-busy={isSubmitting}>
                        <header className="create-task-header">
                            <div className="create-task-heading">
                                <DialogTitle className="create-task-title">Create task</DialogTitle>
                                <p id="create-task-subtitle">Add the essentials. Customize when needed.</p>
                                {isTicketMode && <p className="create-task-ticket">Linked to ticket #{ticketId?.slice(-6)}</p>}
                            </div>
                            <button ref={aiTriggerRef} type="button" onClick={() => setIsAiModalOpen(true)} className="modal-chip-button create-task-ai" disabled={isSubmitting}>
                                <SparklesIcon className="h-4 w-4" aria-hidden="true" /><span>Generate with AI</span>
                            </button>
                            <button type="button" onClick={handleClose} disabled={isSubmitting} className="create-task-close" aria-label="Close create task">
                                <X size={19} aria-hidden="true" />
                            </button>
                        </header>

                        <div className="create-task-body custom-scrollbar">
                            {error && <p ref={errorRef} role="alert" tabIndex={-1} className="create-task-error">{error}</p>}
                            <div className="create-task-field">
                                <label htmlFor="title">Task title <span aria-hidden="true">*</span></label>
                                <input ref={titleRef} id="title" required readOnly={isTicketMode} value={title} onChange={event => setTitle(event.target.value)}
                                    className={fieldClass} placeholder="Enter a task title..." />
                            </div>
                            <div className="create-task-field">
                                <label htmlFor="description">Description</label>
                                <textarea id="description" rows={3} readOnly={isTicketMode} value={description} onChange={event => setDescription(event.target.value)}
                                    className={`${fieldClass} modal-textarea`} placeholder="Add a short description..." />
                            </div>
                            {!isTicketMode && <div className="create-task-field">
                                <label htmlFor="projectId">Project <span aria-hidden="true">*</span></label>
                                <SearchableMultiSelect id="projectId" label="Project" selectionMode="single" avoidClipping
                                    options={projectOptions} selectedOptions={selectedProject ? [{ id: selectedProject.id,
                                        name: selectedProject.client?.companyName ? `${selectedProject.name} - ${selectedProject.client.companyName}` : selectedProject.name,
                                        active: true, statusLabel: selectedProject.status }] : []}
                                    value={projectId ? [projectId] : []} onToggle={setProjectId}
                                    search={projectSearch} onSearchChange={next => {
                                        setProjectSearch(next); setProjectPage(1); setProjectResults([]); setProjectHasMore(false); setIsProjectsLoading(true);
                                    }} placeholder="Search projects..." searchPlaceholder="Search by project or client name..."
                                    emptyMessage="No projects match your search." loadingMessage="Loading projects..." loading={isProjectsLoading} error={projectError}
                                    onRetry={() => setProjectRetry(current => current + 1)} hasMore={projectHasMore}
                                    onLoadMore={() => { setIsProjectsLoading(true); setProjectPage(current => current + 1); }} selectedStatusLabel="Selected"
                                    renderAvatar={(option, size) => <Avatar user={{ name: projects.find(project => project.id === option.id)?.name || option.name, avatarUrl: null }} size={size} />} />
                            </div>}
                            <div className="create-task-pair">
                                <div className="create-task-field">
                                    <label htmlFor="assignedTo">Assignees</label>
                                    <SearchableMultiSelect id="assignedTo" label="Assignees" avoidClipping
                                        options={filteredAssignees.map(member => ({ id: member.id, name: member.name,
                                            description: `${member.role} · ${member.department || 'No team'}`, active: member.status === UserStatus.ACTIVE,
                                            statusLabel: member.status === UserStatus.ACTIVE ? 'Online' : 'Offline' }))}
                                        selectedOptions={selectedUsers.map(member => ({ id: member.id, name: member.name, active: member.status === UserStatus.ACTIVE, statusLabel: '' }))}
                                        value={assignedTo} onToggle={toggleAssignee} search={assigneeSearch} onSearchChange={setAssigneeSearch}
                                        placeholder="Search assignees..." searchPlaceholder="Search by name, role, email, team..."
                                        emptyMessage="No users found." loadingMessage="Loading assignees..." loading={isAssigneesLoading} selectedStatusLabel="Added"
                                        renderAvatar={(option, size) => <Avatar user={assignableUsers.find(member => member.id === option.id)!} size={size} />} />
                                </div>
                                <div className="create-task-field">
                                    <label htmlFor="status">Status <span aria-hidden="true">*</span></label>
                                    <SingleSelect id="status" options={statusOptions} value={status} onChange={value => { setStatus(value); setHoldReason(''); }}
                                        placeholder={isStatusesLoading ? 'Loading statuses…' : 'Select status...'} disabled={isStatusesLoading || !statusOptions.length} avoidClipping />
                                    {statusError && <p role="alert" className="create-task-hint">{statusError}{' '}
                                        <button type="button" onClick={() => setStatusRetry(current => current + 1)} className="underline">Retry loading statuses</button>
                                    </p>}
                                    {(status === TaskStatus.ON_HOLD || columns.find(column => column.id === status)?.workflowBehavior === 'HOLD') &&
                                        <label className="create-task-hold">Hold reason
                                            <textarea aria-label="New task hold reason" maxLength={500} required={columns.find(column => column.id === status)?.holdReasonRequired}
                                                value={holdReason} onChange={event => setHoldReason(event.target.value)} className={`${fieldClass} modal-textarea`} rows={2} />
                                        </label>}
                                </div>
                            </div>
                            <div className="create-task-pair">
                                <div className="create-task-field">
                                    <label htmlFor="priority">Priority</label>
                                    <SingleSelect id="priority" options={priorityOptions} value={priority} onChange={value => setPriority(value as TaskPriority)}
                                        placeholder="Select priority..." avoidClipping />
                                </div>
                                <div className="create-task-field">
                                    <label htmlFor="taskDueToggle">Due date &amp; time <span aria-hidden="true">*</span></label>
                                    <button id="taskDueToggle" type="button" className="modal-input create-task-due-toggle" aria-expanded={dateOptionsOpen}
                                        aria-controls="task-due-options" onClick={() => setDateOptionsOpen(current => !current)}>
                                        <CalendarDays size={17} aria-hidden="true" /><span>{dueDateDisplay}</span><ChevronDown size={16} aria-hidden="true" />
                                    </button>
                                    <div id="task-due-options" hidden={!dateOptionsOpen} className="create-task-date-options" onKeyDown={event => {
                                        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDateOptionsOpen(false); document.getElementById('taskDueToggle')?.focus(); }
                                    }}>
                                        <div className="create-task-date-inputs">
                                            <div><label htmlFor="dueDate">Due date</label><DatePicker id="dueDate" value={dueDate} onChange={value => setDueDate(value ?? '')}
                                                allowClear={false} timezone={dueTimezone} disabled={isSubmitting} className={fieldClass} /></div>
                                            <div><label htmlFor="dueTime">Due time</label><TimePicker id="dueTime" value={dueTime} onChange={setDueTime} disabled={isSubmitting} className={fieldClass} /></div>
                                        </div>
                                        <div className="create-task-presets">{QUICK_DATE_PRESETS.map(preset => <button key={preset.label} type="button" onClick={() => handleApplyQuickDate(preset.offset)}>{preset.label}</button>)}</div>
                                        <div className="create-task-presets">{QUICK_TIME_PRESETS.map(preset => <button key={preset.label} type="button" onClick={() => handleApplyQuickTime(preset.value)}>{preset.label}</button>)}</div>
                                        {dueTimezone && <p className="create-task-hint">Timezone: {dueTimezone}</p>}
                                    </div>
                                </div>
                            </div>

                            <section className="create-task-section" aria-labelledby="create-subtasks-title">
                                <div className="create-task-section-heading"><h3 id="create-subtasks-title">Subtasks</h3>
                                    <button ref={addSubtaskRef} type="button" className="modal-chip-button" onClick={handleAddSubtask}><PlusIcon className="h-4 w-4" aria-hidden="true" />Add subtask</button>
                                </div>
                                {subtasks.length > 0 && <ul className="create-task-subtasks">{subtasks.map((sub, index) => <li key={sub.draftId || `generated-${index}`} data-subtask-index={index} className="create-task-subtask modal-plain-card">
                                    <div className="create-task-subtask-main">
                                        <input type="checkbox" aria-label={`Mark subtask ${index + 1} complete`} checked={sub.completed} onChange={() => handleToggleSubtask(index)} title="Mark complete" />
                                        <input type="text" data-subtask-field="title" aria-label={`Subtask ${index + 1} title`} placeholder="Subtask title" required value={sub.title}
                                            onChange={event => updateSubtaskDraft(index, { title: event.target.value })} className={`${fieldClass} create-task-subtask-title`} />
                                        <select data-subtask-field="assigned_to_id" aria-label={`Subtask ${index + 1} assignee`} value={sub.assignedToId ?? ''} className={fieldClass}
                                            onChange={event => updateSubtaskDraft(index, { assignedToId: event.target.value || null, assigneeTouched: true })}>
                                            <option value="">Unassigned</option>{assignableUsers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                                        </select>
                                        <select data-subtask-field="status" aria-label={`Subtask ${index + 1} status`} value={sub.status} className={fieldClass} onChange={event => updateSubtaskDraft(index, { status: event.target.value as SubtaskStatus })}>
                                            {Object.values(SubtaskStatus).map(value => <option key={value} value={value}>{formatTaskStatus(value)}</option>)}
                                        </select>
                                        <SubtaskDueDateField enabled={Boolean(sub.hasDueDate)} value={sub.dueDate ?? null}
                                        onChange={(hasDueDate, dueDate) => updateSubtaskDraft(index, { hasDueDate, dueDate })} inputClassName={fieldClass} />
                                        <button type="button" onClick={() => handleRemoveSubtask(index)} className="create-task-icon-button" aria-label={`Remove subtask ${index + 1}`}><X size={16} aria-hidden="true" /></button>
                                    </div>
                                </li>)}</ul>}
                            </section>

                            <section className="create-task-section" aria-labelledby="create-attachments-title">
                                <h3 id="create-attachments-title">Attachments</h3>
                                <div className="create-task-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); handleAttachmentFiles(event.dataTransfer.files); }}>
                                    <input ref={fileInputRef} type="file" multiple hidden aria-label="Upload attachments" onChange={event => {
                                        if (event.target.files) handleAttachmentFiles(event.target.files); event.target.value = '';
                                    }} />
                                    <button type="button" onClick={() => fileInputRef.current?.click()}><Upload size={18} aria-hidden="true" />Drop files here or click to upload</button>
                                </div>
                                <div className="create-task-attachment-link"><input type="url" aria-label="Attachment link" value={currentAttachment} onChange={event => setCurrentAttachment(event.target.value)}
                                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (event.currentTarget.validity.valid) handleAddAttachment(); } }}
                                    className={fieldClass} placeholder="Or paste an attachment link..." />
                                    <button type="button" className="modal-secondary-button" onClick={() => {
                                        const input = formRef.current?.querySelector<HTMLInputElement>('[aria-label="Attachment link"]');
                                        if (input?.reportValidity()) handleAddAttachment();
                                    }} disabled={!currentAttachment.trim()}>Add link</button></div>
                                {attachments.length > 0 && <TaskAttachments attachments={attachments} files={attachmentFiles} onRemove={handleRemoveAttachment} disabled={isSubmitting} />}
                                {uploads.length > 0 && <ul className="create-task-attachments">
                                    {uploads.map(item => <li key={item.id} className="create-task-upload-progress"><span>{item.file.name}</span>
                                        {item.error ? <><span role="alert">{item.error}</span><button type="button" onClick={() => void uploadFile(item.id, item.file)}>Retry upload</button></>
                                            : <progress aria-label={`Uploading ${item.file.name}`} value={item.progress} max={100} />}
                                        <button type="button" className="create-task-icon-button" onClick={() => { uploadControllers.current.get(item.id)?.abort(); uploadControllers.current.delete(item.id); setUploads(current => current.filter(upload => upload.id !== item.id)); }} aria-label={`Remove upload ${item.file.name}`}><X size={16} aria-hidden="true" /></button>
                                    </li>)}
                                </ul>}
                            </section>

                            <section className="create-task-additional">
                                <button type="button" id="additional-options-toggle" className="create-task-additional-toggle" aria-expanded={additionalOpen} aria-controls="additional-options-panel"
                                    onClick={() => setAdditionalOpen(current => !current)}><Settings2 size={20} aria-hidden="true" /><span><strong>Additional options</strong><small>Team, estimates, recurrence, tags, followers &amp; approval</small></span>
                                    <ChevronDown size={19} className={additionalOpen ? 'is-expanded' : ''} aria-hidden="true" /></button>
                                <div ref={additionalRef} id="additional-options-panel" role="region" aria-labelledby="additional-options-toggle" hidden={!additionalOpen} className="create-task-additional-body">
                                    <div className="create-task-pair">
                                        <div className="create-task-field"><label htmlFor="team">Team selector</label>
                                            {teamOptions.length ? <SingleSelect id="team" options={teamOptions} value={team} onChange={setTeam} placeholder="Select team..." avoidClipping />
                                                : <input id="team" className={fieldClass} value={team} onChange={event => setTeam(event.target.value)} placeholder="Select a team" />}
                                        </div>
                                        <fieldset className="create-task-field"><legend>Estimated workload</legend><div className="create-task-date-inputs">
                                            <label htmlFor="estimatedHours" className="create-task-hint">Hours<input id="estimatedHours" type="number" min="0" value={estimatedHours} onChange={event => setEstimatedHours(event.target.value ? Number(event.target.value) : '')} className={fieldClass} placeholder="Hours" /></label>
                                            <label htmlFor="estimatedMinutes" className="create-task-hint">Minutes<input id="estimatedMinutes" type="number" min="0" max="59" step="5" value={estimatedMinutes} onChange={event => setEstimatedMinutes(event.target.value ? Number(event.target.value) : '')} className={fieldClass} placeholder="Minutes" /></label>
                                        </div><p className="create-task-hint">{workloadLabel}</p></fieldset>
                                    </div>
                                    <div className="create-task-field"><label htmlFor="recurrence">Recurrence</label><SingleSelect id="recurrence" options={recurrenceOptions} value={recurrenceRule} onChange={value => setRecurrenceRule(value as RecurrenceRule)} placeholder="Does not repeat" avoidClipping /></div>
                                    {recurrenceRule !== RecurrenceRule.NONE && <div className="create-task-repeat-settings">
                                        <label>Repeat interval<input type="number" min="1" value={repeatInterval} onChange={event => setRepeatInterval(Math.max(1, Number(event.target.value) || 1))} className={fieldClass} /></label>
                                        <label>Repeat end date<input type="date" value={repeatEndDate} onChange={event => setRepeatEndDate(event.target.value)} className={fieldClass} /></label>
                                        <label>Recurrence timezone<input type="text" value={recurrenceTimezone} onChange={event => setRecurrenceTimezone(event.target.value)} className={fieldClass} /></label>
                                        <p className="create-task-hint">{recurrencePreview} · {recurrenceTimezone}</p>
                                    </div>}
                                    <div className="create-task-field"><label htmlFor="taskTags">Tags</label>
                                        <div className="create-task-tags">{tags.map((tag, index) => <span key={tag} className="modal-chip">{tag}<button type="button" onClick={() => handleRemoveTag(index)} aria-label={`Remove tag ${tag}`}><X size={13} aria-hidden="true" /></button></span>)}
                                            <input id="taskTags" type="text" value={currentTag} onChange={event => setCurrentTag(event.target.value)} onKeyDown={handleTagInput} placeholder="Add tags and press Enter" className={fieldClass} /></div>
                                        <div className="create-task-presets">{filteredTagSuggestions.map(tag => <button key={tag} type="button" onClick={() => handleAddTagSuggestion(tag)}>{tag}</button>)}</div>
                                    </div>
                                    <div className="create-task-pair">
                                        <div className="create-task-field"><label htmlFor="followers">Followers</label>
                                            <SearchableMultiSelect id="followers" label="Followers" avoidClipping options={filteredFollowers.map(member => ({ id: member.id, name: member.name,
                                                description: formatRoleLabel(member.role), active: member.status === UserStatus.ACTIVE, statusLabel: followerIds.includes(member.id) ? 'Added' : 'Add' }))}
                                                selectedOptions={selectedFollowers.map(member => ({ id: member.id, name: member.name, active: true, statusLabel: 'Added' }))}
                                                value={followerIds} onToggle={toggleFollower} search={followerSearch} onSearchChange={setFollowerSearch}
                                                placeholder="Search followers..." searchPlaceholder="Search followers..." emptyMessage="No followers available." loadingMessage="Loading followers..." loading={isAssigneesLoading}
                                                renderAvatar={(option, size) => <Avatar user={users.find(member => member.id === option.id)!} size={size} />} />
                                        </div>
                                        {!isTicketMode ? <div className="create-task-field"><label htmlFor="subtaskApprovalOverride">Subtask completion approval</label>
                                            <select id="subtaskApprovalOverride" value={subtaskApprovalOverride} onChange={event => setSubtaskApprovalOverride(event.target.value as 'inherit' | 'required' | 'not_required')} className={fieldClass}>
                                                <option value="inherit">Use project default</option><option value="required">Require approval</option><option value="not_required">Complete without approval</option>
                                            </select>
                                        </div> : <div className="create-task-field"><label className="create-task-approval"><input type="checkbox" checked={approvalRequired} onChange={event => { setApprovalRequired(event.target.checked); if (!event.target.checked) setApproverId(null); }} />Require approval</label>
                                            <label htmlFor="taskApprover">Approver</label><select id="taskApprover" value={approverId ?? ''} disabled={!approvalRequired} onChange={event => setApproverId(event.target.value || null)} className={fieldClass}>
                                                <option value="">Select approver...</option>{approverCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>
                                        </div>}
                                    </div>
                                </div>
                            </section>
                        </div>

                        <footer className="create-task-footer">
                            {uploads.some(item => !item.error) && <span role="status">Uploading attachments…</span>}
                            <button type="button" className="modal-secondary-button" onClick={handleClose} disabled={isSubmitting}>Cancel</button>
                            <button type="submit" className="modal-primary-button" disabled={isSubmitting || uploads.some(item => !item.error) || (!isTicketMode && (isStatusesLoading || !statusOptions.length))}>{isSubmitting ? 'Creating…' : 'Create task'}</button>
                        </footer>
                    </form>
                    {isAiModalOpen && <Dialog open onClose={closeAiModal} className="create-task-ai-dialog" aria-label="Generate Task with AI">
                        <DialogPanel><GenerateTaskWithAIModal isOpen onClose={closeAiModal} onTaskGenerated={handleTaskGenerated} /></DialogPanel>
                    </Dialog>}
                </DialogPanel>
            </div>
        </Dialog>, document.body
    );
};

export default CreateTaskModal;
