import Avatar from './Avatar';
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import api from '../services/mockApi';
import { TaskPriority, User, UserStatus, RecurrenceRule, KanbanColumn, TaskStatus, Subtask, SubtaskStatus, CUSTOM_STATUS_NAMES, Project, ProjectStatus, Role } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { formatRecurrenceRule, formatTaskStatus } from '../utils';
import { PlusIcon, XMarkIcon, SparklesIcon } from './icons';
import GenerateTaskWithAIModal from './GenerateTaskWithAIModal';
import SingleSelect from './ui/SingleSelect';

type ThemeMode = 'dark' | 'colorful' | 'light';

type SubtaskDraft = {
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

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return [`${hour}:00`, `${hour}:30`];
}).flat();

const TAG_SUGGESTIONS = ['Urgent', 'Client', 'Follow-up', 'QA', 'Research', 'Blocked', 'Launch'];
let cachedActiveAssignees: User[] = [];

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
  initialDueDate?: string | null;
  ticketId?: string;
  ticketTitle?: string;
  ticketDescription?: string;
}

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
    isOpen,
    onClose,
    onTaskCreated,
    initialDueDate = null,
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
    const [dueDate, setDueDate] = useState(() => resolveDefaultDueDateTime().date);
    const [dueTime, setDueTime] = useState(() => resolveDefaultDueDateTime().time);
    const [team, setTeam] = useState('');
    const [projectId, setProjectId] = useState('');
    const [subtaskApprovalOverride, setSubtaskApprovalOverride] = useState<'inherit' | 'required' | 'not_required'>('inherit');
    const [approvalRequired, setApprovalRequired] = useState(false);
    const [approverId, setApproverId] = useState<string | null>(null);

    // Enhancements
    const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
    const [currentSubtask, setCurrentSubtask] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [currentAttachment, setCurrentAttachment] = useState('');
    const [attachmentProgress, setAttachmentProgress] = useState<Record<string, number>>({});
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
    const [isAssigneesLoading, setIsAssigneesLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | undefined>();
    const [activeAssignmentsSelectId, setActiveAssignmentsSelectId] = useState<string | null>(null);
    const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [followerSearch, setFollowerSearch] = useState('');
    const [activeAssigneeIndex, setActiveAssigneeIndex] = useState(0);
    const assigneePickerRef = useRef<HTMLDivElement>(null);
    const assigneeSearchRef = useRef<HTMLInputElement>(null);
    const primaryTaskAssigneeId = assignedTo[0] ?? null;

    const statusOptions = (columns.length > 0
        ? columns.map((column) => ({ id: column.id, name: column.title }))
        : Object.values(TaskStatus).map((taskStatus) => {
            const typedStatus = taskStatus as TaskStatus;
            return {
                id: typedStatus,
                name: CUSTOM_STATUS_NAMES[typedStatus]?.name || formatTaskStatus(typedStatus),
            };
        })
    );

    const allowedPriorities = useMemo(
        () => Object.values(TaskPriority),
        []
    );

    const priorityOptions = allowedPriorities.map((p) => ({
        id: p,
        name: `${String(p).charAt(0)}${String(p).slice(1).toLowerCase()}`,
    }));

    const projectOptions = useMemo(
        () => projects.map((project) => ({
            id: project.id,
            name: project.client?.companyName ? `${project.name} - ${project.client.companyName}` : project.name,
        })),
        [projects],
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

    useEffect(() => {
        if (!isAssigneePickerOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!assigneePickerRef.current?.contains(event.target as Node)) {
                setIsAssigneePickerOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        setTimeout(() => assigneeSearchRef.current?.focus(), 0);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [isAssigneePickerOpen]);

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
        const immediateUsers = cachedActiveAssignees.length > 0
            ? cachedActiveAssignees
            : [currentUser];

        // Paint assignees immediately, then refresh the full team list in the background.
        setUsers(immediateUsers);
        setIsAssigneesLoading(cachedActiveAssignees.length === 0);
        setTeam(currentUser.department);

        const resolvedColumns: KanbanColumn[] = Object.values(TaskStatus).map((taskStatus, index) => ({
            id: taskStatus,
            title: CUSTOM_STATUS_NAMES[taskStatus]?.name || taskStatus,
            order: index,
            pipelineId: 'default',
        }));
        setColumns(resolvedColumns);
        setStatus(TaskStatus.WAITING_FOR_REQUIREMENT);
        setProjectId(projects.length === 1 ? projects[0].id : '');

        api.getUsers()
            .then((allUsers) => {
                if (isCancelled) return;
                const activeUsers = Array.isArray(allUsers)
                    ? allUsers.filter((u) => u.status === 'ACTIVE')
                    : [];
                const nextUsers = activeUsers.length > 0 ? activeUsers : [currentUser];
                cachedActiveAssignees = nextUsers;
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

        if (!isTicketMode) {
            setIsProjectsLoading(true);
            api.getProjects({ status: ProjectStatus.ACTIVE, pageSize: 100, sortBy: 'name', sortOrder: 'asc' })
                .then((response) => {
                    if (isCancelled) return;
                    const visibleProjects = (response.items ?? []).filter((project) => project.status === ProjectStatus.ACTIVE);
                    setProjects(visibleProjects);
                    setProjectId((current) => {
                        if (current && visibleProjects.some((project) => project.id === current)) {
                            return current;
                        }
                        return visibleProjects.length === 1 ? visibleProjects[0].id : '';
                    });
                })
                .catch((err) => {
                    if (isCancelled) return;
                    console.error('Failed to fetch projects for task creation:', err instanceof Error ? err.message : err);
                    setProjects([]);
                })
                .finally(() => {
                    if (!isCancelled) {
                        setIsProjectsLoading(false);
                    }
                });
        }

        return () => {
            isCancelled = true;
        };
    }, [isOpen, currentUser, isTicketMode]);

    useEffect(() => {
        if (!isOpen || !isTicketMode) return;
        setTitle(ticketTitle ?? '');
        setDescription(ticketDescription ?? '');
    }, [isOpen, isTicketMode, ticketTitle, ticketDescription]);

    const resetForm = () => {
        setTitle(ticketTitle ?? '');
        setDescription(ticketDescription ?? '');
        setAssignedTo([]);
        setFollowerIds([]);
        setPriority(TaskPriority.LOW);
        // Use column id as status so it aligns with how TaskDetailModal and the API expect statuses
        setStatus(TaskStatus.WAITING_FOR_REQUIREMENT);
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
        setCurrentSubtask('');
        setAttachments([]);
        setCurrentAttachment('');
        setAttachmentProgress({});
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
        setIsAssigneePickerOpen(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleAddSubtask = () => {
        if (currentSubtask.trim()) {
            setSubtasks([
                ...subtasks,
                {
                    title: currentSubtask.trim(),
                    completed: false,
                    assignedToId: primaryTaskAssigneeId,
                    status: SubtaskStatus.TODO,
                    assigneeTouched: false,
                },
            ]);
            setCurrentSubtask('');
        }
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
    const handleRemoveAttachment = (index: number) => setAttachments(attachments.filter((_, i) => i !== index));

    const handleAttachmentFiles = (files: FileList | File[]) => {
        const nextFiles = Array.from(files);
        if (!nextFiles.length) return;
        const labels = nextFiles.map((file) => file.name);
        setAttachments((current) => [...current, ...labels]);
        labels.forEach((label) => {
            setAttachmentProgress((current) => ({ ...current, [label]: 45 }));
            window.setTimeout(() => {
                setAttachmentProgress((current) => ({ ...current, [label]: 100 }));
            }, 450);
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
        if (!currentUser) {
            setError('You must be logged in to create a task.');
            return;
        }
        if (!dueDate || !dueTime) {
            setError('Due date and due time are required.');
            return;
        }
        if (!isTicketMode && !projectId) {
            setError('Select a project before creating the task.');
            return;
        }
        setIsSubmitting(true);
        setError('');
        try {
            if (ticketId) {
                if (approvalRequired && !approverId) {
                    setError('Select an approver for approval-required tasks.');
                    setIsSubmitting(false);
                    return;
                }
                const dueAt = (dueDate && dueTime)
                    ? `${dueDate}T${dueTime}:00`
                    : dueDate
                        ? `${dueDate}T00:00:00`
                        : null;
            await api.createTicketTask(ticketId, {
                dueAt,
                priority,
                approvalRequired,
                approverId: approvalRequired ? approverId : null,
            });
            onTaskCreated();
            handleClose();
            notify('Task added to ticket.');
            return;
        }
            const finalSubtasks: Subtask[] = subtasks.map((subtask, index) => ({
                id: `sub-${Date.now()}-${Math.random()}`,
                title: subtask.title,
                completed: subtask.completed || subtask.status === SubtaskStatus.DONE,
                assignedToId: subtask.assignedToId,
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
                dueAt: (dueDate && dueTime) ? `${dueDate}T${dueTime}:00` : dueDate ? `${dueDate}T00:00:00` : null,
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
        handleClose();
        notify('Task created successfully.');
        } catch (err: any) {
            setError(err.message || 'Failed to create task. Please try again.');
        } finally {
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
                    title: item.trim(),
                    completed: false,
                    assignedToId: primaryTaskAssigneeId,
                    status: SubtaskStatus.TODO,
                    assigneeTouched: false,
                })));
        }
    };

    const fieldClass = 'modal-input w-full text-sm';
    const areaClass = 'modal-input modal-textarea w-full text-sm';
    const chipButtonClass = 'modal-chip-button inline-flex items-center justify-center gap-2 text-sm font-semibold';
    const removeButtonClass = 'modal-remove-button';
    const labelClass = 'modal-label text-xs uppercase tracking-[0.25em]';
    const sectionClass = 'modal-section flex h-full flex-col rounded-3xl border p-4 backdrop-blur-xl transition duration-200';
    const compactSectionClass = 'modal-section flex flex-col rounded-3xl border p-4 backdrop-blur-xl transition duration-200';
    const missionSectionClass = 'modal-section flex flex-col rounded-3xl border p-3 backdrop-blur-xl transition duration-200';
    const assignmentsSectionClass = [
        sectionClass,
        'xl:col-start-2 xl:row-span-3 xl:row-start-1',
        activeAssignmentsSelectId ? 'is-raised' : '',
    ].filter(Boolean).join(' ');
    const lockedFieldClass = isTicketMode ? 'opacity-70 cursor-not-allowed' : '';

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

    const handleAssignmentsSelectOpen = useCallback((open: boolean, selectId?: string) => {
        if (!selectId) {
            setActiveAssignmentsSelectId(open ? 'assignments' : null);
            return;
        }

        setActiveAssignmentsSelectId((current) => {
            if (open) return selectId;
            return current === selectId ? null : current;
        });
    }, []);

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
        if (!selectedProject || projectMemberIds.size === 0) {
            return users;
        }
        return users.filter((member) => projectMemberIds.has(member.id));
    }, [projectMemberIds, selectedProject, users]);

    useEffect(() => {
        if (!selectedProject || projectMemberIds.size === 0) {
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
        setActiveAssigneeIndex((current) => {
            if (filteredAssignees.length === 0) return 0;
            return Math.min(current, filteredAssignees.length - 1);
        });
    }, [filteredAssignees.length]);

    useEffect(() => {
        if (assignedTo.length === 0) return;
        const assignedSet = new Set(assignedTo);
        setFollowerIds((current) => current.filter((userId) => !assignedSet.has(userId)));
    }, [assignedTo]);

    const handleAssigneeKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!filteredAssignees.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveAssigneeIndex((current) => Math.min(current + 1, filteredAssignees.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveAssigneeIndex((current) => Math.max(current - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const selected = filteredAssignees[activeAssigneeIndex];
            if (selected) toggleAssignee(selected.id);
        } else if (event.key === 'Escape') {
            setIsAssigneePickerOpen(false);
        }
    }, [activeAssigneeIndex, filteredAssignees, toggleAssignee]);

    const formatRoleLabel = useCallback((role: Role) => role.charAt(0).toUpperCase() + role.slice(1), []);

    const assignedUsers = useMemo(
        () => users.filter((user) => assignedTo.includes(user.id)),
        [users, assignedTo]
    );

    const approverCandidates = useMemo(
        () => users.filter((candidate) => candidate.status === UserStatus.ACTIVE),
        [users],
    );

    const priorityLabel = useMemo(
        () => priorityOptions.find((option) => option.id === priority)?.name || 'Medium',
        [priorityOptions, priority]
    );

    const statusLabel = useMemo(
        () => statusOptions.find((option) => option.id === status)?.name || 'Select status',
        [statusOptions, status]
    );

    const recurrenceLabel = useMemo(
        () => recurrenceOptions.find((option) => option.id === recurrenceRule)?.name || 'None',
        [recurrenceOptions, recurrenceRule]
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

    const readinessScore = useMemo(() => {
        let score = 20;
        if (title.trim()) score += 15;
        if (description.trim()) score += 10;
        if (assignedTo.length > 0) score += 20;
        if (dueDate) score += 15;
        if (subtasks.length > 0) score += 10;
        if (tags.length > 0) score += 5;
        if (estimatedHours) score += 5;
        return Math.min(100, score);
    }, [title, description, assignedTo.length, dueDate, subtasks.length, tags.length, estimatedHours]);

    const readinessLabel = readinessScore >= 85
        ? 'Mission-ready'
        : readinessScore >= 60
            ? 'Needs final prep'
            : 'Draft in progress';

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

    const summaryStats = useMemo(
        () => [
            { label: 'Status', value: statusLabel, icon: '🚦' },
            { label: 'Priority', value: priorityLabel, icon: '⚡' },
            { label: 'Team', value: team || 'Unassigned', icon: '🛡️' },
            { label: 'Recurrence', value: recurrencePreview, icon: '🔁' },
            { label: 'Due', value: dueDateDisplay, icon: '📅' },
            { label: 'Estimated Hours', value: workloadLabel, icon: '⏱️' },
        ],
        [statusLabel, priorityLabel, team, recurrencePreview, dueDateDisplay, workloadLabel]
    );

    const summaryNotes = useMemo(() => {
        const notes: string[] = [];
        if (!assignedTo.length) notes.push('Assign at least one teammate to kick off the mission.');
        if (!dueDate) notes.push('Set a due date to keep momentum and unlock time-based rewards.');
        if (subtasks.length === 0) notes.push('Add subtasks so the squad can track progress.');
        if (!description.trim()) notes.push('Provide more mission intel in the description.');
        return notes;
    }, [assignedTo.length, dueDate, subtasks.length, description]);

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-slate-950/25 px-3 py-3 backdrop-blur-sm sm:px-5 sm:py-5">
                <div
                    className="task-modal relative flex max-h-[90vh] w-full max-w-[94rem] flex-col overflow-hidden rounded-3xl border backdrop-blur-xl transition duration-300 max-sm:h-full max-sm:max-h-none max-sm:rounded-2xl"
                    style={modalStyle}
                    data-theme={themeMode}
                >
                    <div
                        className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full blur-3xl"
                        style={{ background: theme.glowOne }}
                    />
                    <div
                        className="pointer-events-none absolute -left-20 bottom-0 h-60 w-60 rounded-full blur-3xl"
                        style={{ background: theme.glowTwo }}
                    />

                    <header className="relative shrink-0 border-b px-4 py-4 transition-colors duration-200 sm:px-5" style={{ borderColor: 'var(--modal-border)' }}>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
                        >
                            Close
                        </button>
                        <div className="flex flex-col gap-4 pr-24 lg:flex-row lg:items-center lg:justify-between lg:pr-32">
                            <div className="space-y-2">
                                <p className="hidden text-xs font-semibold uppercase tracking-[0.35em] modal-muted sm:block">New quest</p>
                                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Create Task</h2>
                                <p className="hidden max-w-xl text-sm modal-muted sm:block">
                                    Shape a mission with clear objectives, allies, and loot so the squad can execute flawlessly.
                                </p>
                                {isTicketMode && (
                                    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.25em]">
                                        Linked to ticket #{ticketId?.slice(-6)}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsAiModalOpen(true)}
                                    className="modal-chip-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                                >
                                    <SparklesIcon className="h-4 w-4" />
                                    <span className="hidden sm:inline">Generate with AI</span>
                                    <span className="sm:hidden">Write AI</span>
                                </button>
                            </div>
                        </div>
                    </header>

                    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar sm:px-5">
                        <form onSubmit={handleSubmit} className="grid min-h-full gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_370px]">
                            <div className="space-y-5 xl:contents">
                                <section className={[missionSectionClass, 'self-start xl:col-start-1 xl:row-start-1'].join(' ')}>
                                    <p className="section-heading">Mission overview</p>
                                    <div className="mt-1.5 space-y-2">
                                        <div>
                                            <label htmlFor="title" className={labelClass}>Title</label>
                                            <input
                                                id="title"
                                                type="text"
                                                value={title}
                                                onChange={(e) => setTitle(e.target.value)}
                                                required
                                                readOnly={isTicketMode}
                                                className={[fieldClass, 'mt-1 min-h-10 py-2', lockedFieldClass].join(' ')}
                                                placeholder="Name your quest..."
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="description" className={labelClass}>Description</label>
                                            <textarea
                                                id="description"
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                readOnly={isTicketMode}
                                                rows={3}
                                                className={[areaClass, 'mt-1 min-h-24 py-2', lockedFieldClass].join(' ')}
                                                placeholder="Tell the squad what success looks like..."
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section className={assignmentsSectionClass}>
                                    <p className="section-heading">Assignments</p>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                                        {!isTicketMode && (
                                            <div className="md:col-span-2 xl:col-span-1 2xl:col-span-2">
                                                <label htmlFor="projectId" className={labelClass}>Project *</label>
                                                <SingleSelect
                                                    id="projectId"
                                                    options={projectOptions}
                                                    value={projectId}
                                                    onChange={setProjectId}
                                                    onOpenChange={handleAssignmentsSelectOpen}
                                                    placeholder={isProjectsLoading ? 'Loading projects...' : 'Select project...'}
                                                    className="mt-2"
                                                />
                                            </div>
                                        )}
                                        <div>
                                            <label htmlFor="assignedTo" className={labelClass}>Assignees</label>
                                            <div ref={assigneePickerRef} className="relative mt-2">
                                                <button
                                                    id="assignedTo"
                                                    type="button"
                                                    onClick={() => setIsAssigneePickerOpen((open) => !open)}
                                                    className="modal-input flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:scale-[1.01]"
                                                >
                                                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                                                        {selectedUsers.length === 0 ? (
                                                            <span className="text-white/45">
                                                                {isAssigneesLoading ? 'Loading assignees...' : 'Search and select assignees...'}
                                                            </span>
                                                        ) : (
                                                            selectedUsers.slice(0, 3).map((member) => {

                                                                return (
                                                                    <span key={member.id} className="modal-chip inline-flex max-w-full items-center gap-2 px-2 py-1 text-xs">
                                                                        <span className="h-5 w-5 overflow-hidden rounded-full bg-black/40">
                                                                            <Avatar user={member} size={20} />
                                                                        </span>
                                                                        <span className="truncate">{member.name}</span>
                                                                    </span>
                                                                );
                                                            })
                                                        )}
                                                        {selectedUsers.length > 3 && (
                                                            <span className="modal-chip px-2 py-1 text-xs">+{selectedUsers.length - 3}</span>
                                                        )}
                                                    </div>
                                                    <span className="text-xs uppercase tracking-[0.2em] modal-muted">{selectedUsers.length} selected</span>
                                                </button>
                                                {isAssigneePickerOpen && (
                                                    <div className="absolute left-0 right-0 top-full z-[140] mt-2 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                                                        <div className="border-b border-white/10 p-2">
                                                            <input
                                                                ref={assigneeSearchRef}
                                                                type="text"
                                                                value={assigneeSearch}
                                                                onChange={(event) => {
                                                                    setAssigneeSearch(event.target.value);
                                                                    setActiveAssigneeIndex(0);
                                                                }}
                                                                onKeyDown={handleAssigneeKeyDown}
                                                                placeholder="Search by name, role, email, team..."
                                                                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/60 focus:outline-none"
                                                            />
                                                        </div>
                                                        <div className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
                                                            {isAssigneesLoading && filteredAssignees.length === 0 ? (
                                                                <div className="px-3 py-3 text-sm text-white/50">Loading assignees...</div>
                                                            ) : filteredAssignees.length === 0 ? (
                                                                <div className="px-3 py-3 text-sm text-white/50">No users found.</div>
                                                            ) : (
                                                                filteredAssignees.map((member, index) => {
                                                                    const isSelected = assignedTo.includes(member.id);

                                                                    const isOnline = member.status === UserStatus.ACTIVE;
                                                                    return (
                                                                        <button
                                                                            key={member.id}
                                                                            type="button"
                                                                            onMouseEnter={() => setActiveAssigneeIndex(index)}
                                                                            onClick={() => toggleAssignee(member.id)}
                                                                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition duration-150 ${
                                                                                index === activeAssigneeIndex ? 'bg-cyan-400/10' : 'hover:bg-white/10'
                                                                            } ${isSelected ? 'text-cyan-100' : 'text-white/80'}`}
                                                                        >
                                                                            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/40">
                                                                                <Avatar user={member} size={36} />
                                                                                <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-slate-950 ${isOnline ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                                                            </span>
                                                                            <span className="min-w-0 flex-1">
                                                                                <span className="block truncate font-semibold">{member.name}</span>
                                                                                <span className="block truncate text-xs text-white/45">{member.role} · {member.department || 'No team'}</span>
                                                                            </span>
                                                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${isSelected ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/40'}`}>
                                                                                {isSelected ? 'Added' : isOnline ? 'Online' : 'Offline'}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="status" className={labelClass}>Status</label>
                                            <SingleSelect
                                                id="status"
                                                options={statusOptions}
                                                value={status}
                                                onChange={setStatus}
                                                onOpenChange={handleAssignmentsSelectOpen}
                                                placeholder="Select status..."
                                                className="mt-2"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="priority" className={labelClass}>Priority</label>
                                            <SingleSelect
                                                id="priority"
                                                options={priorityOptions}
                                                value={priority}
                                                onChange={(value) => setPriority(value as TaskPriority)}
                                                onOpenChange={handleAssignmentsSelectOpen}
                                                placeholder="Select priority..."
                                                className="mt-2"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="dueDate" className={labelClass}>Due date *</label>
                                            <div className="mt-2 space-y-2">
                                                <div className="relative flex gap-2">
                                                    <input
                                                        id="dueDate"
                                                        type="date"
                                                        value={dueDate}
                                                        onChange={(e) => setDueDate(e.target.value)}
                                                        className={fieldClass}
                                                        required
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDatePicker(!showDatePicker)}
                                                        className="modal-chip-button px-3 py-2 text-sm"
                                                    >
                                                        📅
                                                    </button>
                                                    {showDatePicker && (
                                                        <div className="modal-datepicker absolute left-0 top-full mt-2 z-50">
                                                            <DayPicker
                                                                mode="single"
                                                                selected={selectedDate}
                                                                onSelect={(date) => {
                                                                    if (date) {
                                                                        setSelectedDate(date);
                                                                        setDueDate(formatDateInput(date));
                                                                        setShowDatePicker(false);
                                                                    }
                                                                }}
                                                                className="rounded-lg border p-3"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="modal-quick-actions">
                                                    {QUICK_DATE_PRESETS.map((preset) => (
                                                        <button
                                                            key={preset.label}
                                                            type="button"
                                                            onClick={() => handleApplyQuickDate(preset.offset)}
                                                            className="modal-quick-action"
                                                        >
                                                            {preset.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="dueTime" className={labelClass}>Due time *</label>
                                            <div className="mt-2 space-y-2">
                                                <div className="flex gap-2">
                                                    <input
                                                        id="dueTime"
                                                        type="time"
                                                        value={dueTime}
                                                        onChange={(e) => setDueTime(e.target.value)}
                                                        className={fieldClass}
                                                        required
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowTimePicker(!showTimePicker)}
                                                        className="modal-chip-button px-3 py-2 text-sm"
                                                    >
                                                        ⏰
                                                    </button>
                                                </div>
                                                {showTimePicker && (
                                                    <div className="modal-timepicker">
                                                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                                                            {TIME_OPTIONS.map((time) => (
                                                                <button
                                                                    key={time}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setDueTime(time);
                                                                        setShowTimePicker(false);
                                                                    }}
                                                                    className="modal-quick-action text-xs"
                                                                >
                                                                    {time}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="modal-quick-actions">
                                                    {QUICK_TIME_PRESETS.map((preset) => (
                                                        <button
                                                            key={preset.label}
                                                            type="button"
                                                            onClick={() => handleApplyQuickTime(preset.value)}
                                                            className="modal-quick-action"
                                                        >
                                                            {preset.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        {isTicketMode && (
                                            <div className="md:col-span-2 xl:col-span-1 2xl:col-span-2">
                                                <label className={labelClass}>Approval</label>
                                                <div className="mt-2 grid gap-3 md:grid-cols-2">
                                                    <label className="flex items-center gap-2 text-sm">
                                                        <input
                                                            type="checkbox"
                                                            checked={approvalRequired}
                                                            onChange={(e) => {
                                                                const checked = e.target.checked;
                                                                setApprovalRequired(checked);
                                                                if (!checked) {
                                                                    setApproverId(null);
                                                                }
                                                            }}
                                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        Require approval
                                                    </label>
                                                    <select
                                                        value={approverId ?? ''}
                                                        onChange={(e) => setApproverId(e.target.value || null)}
                                                        className={[fieldClass, 'text-sm'].join(' ')}
                                                        disabled={!approvalRequired}
                                                    >
                                                        <option value="">Select approver...</option>
                                                        {approverCandidates.map((candidate) => (
                                                            <option key={candidate.id} value={candidate.id}>
                                                                {candidate.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                        {!isTicketMode && (
                                            <div>
                                                <label htmlFor="subtaskApprovalOverride" className={labelClass}>Subtask completion approval</label>
                                                <select
                                                    id="subtaskApprovalOverride"
                                                    value={subtaskApprovalOverride}
                                                    onChange={(event) => setSubtaskApprovalOverride(event.target.value as 'inherit' | 'required' | 'not_required')}
                                                    className={[fieldClass, 'mt-2 text-sm'].join(' ')}
                                                >
                                                    <option value="inherit">Use project default</option>
                                                    <option value="required">Require approval</option>
                                                    <option value="not_required">Complete without approval</option>
                                                </select>
                                            </div>
                                        )}
                                        <div>
                                            <label htmlFor="team" className={labelClass}>Team selector</label>
                                            {teamOptions.length > 0 ? (
                                                <SingleSelect
                                                    id="team"
                                                    options={teamOptions}
                                                    value={team}
                                                    onChange={setTeam}
                                                    onOpenChange={handleAssignmentsSelectOpen}
                                                    placeholder="Select team..."
                                                    className="mt-2"
                                                />
                                            ) : (
                                                <input
                                                id="team"
                                                type="text"
                                                value={team}
                                                onChange={(e) => setTeam(e.target.value)}
                                                className={[fieldClass, 'mt-2'].join(' ')}
                                                placeholder="Which crew owns this?"
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <label className={labelClass}>Estimated workload</label>
                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                <input
                                                    id="estimatedHours"
                                                    type="number"
                                                    min="0"
                                                    value={estimatedHours}
                                                    onChange={(e) => setEstimatedHours(e.target.value ? Number(e.target.value) : '')}
                                                    className={fieldClass}
                                                    placeholder="Hours"
                                                />
                                                <input
                                                    id="estimatedMinutes"
                                                    type="number"
                                                    min="0"
                                                    max="59"
                                                    step="5"
                                                    value={estimatedMinutes}
                                                    onChange={(e) => setEstimatedMinutes(e.target.value ? Number(e.target.value) : '')}
                                                    className={fieldClass}
                                                    placeholder="Minutes"
                                                />
                                            </div>
                                            <p className="mt-2 text-xs font-semibold text-cyan-100/80">{workloadLabel}</p>
                                        </div>
                                        <div>
                                            <label htmlFor="recurrence" className={labelClass}>Recurrence</label>
                                            <SingleSelect
                                                id="recurrence"
                                                options={recurrenceOptions}
                                                value={recurrenceRule}
                                                onChange={(value) => setRecurrenceRule(value as RecurrenceRule)}
                                                onOpenChange={handleAssignmentsSelectOpen}
                                                placeholder="Select recurrence..."
                                                className="mt-2"
                                            />
                                        </div>
                                        {recurrenceRule !== RecurrenceRule.NONE && (
                                            <div className="md:col-span-2 xl:col-span-1 2xl:col-span-2">
                                                <label className={labelClass}>Task repeat settings</label>
                                                <div className="mt-2 grid gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={repeatInterval}
                                                        onChange={(e) => setRepeatInterval(Math.max(1, Number(e.target.value) || 1))}
                                                        className={fieldClass}
                                                        placeholder="Interval"
                                                    />
                                                    <input
                                                        type="date"
                                                        value={repeatEndDate}
                                                        onChange={(e) => setRepeatEndDate(e.target.value)}
                                                        className={fieldClass}
                                                    />
                                                    <input
                                                        type="text"
                                                        value={recurrenceTimezone}
                                                        onChange={(e) => setRecurrenceTimezone(e.target.value)}
                                                        className={fieldClass}
                                                        placeholder="Timezone"
                                                    />
                                                </div>
                                                <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                                                    {recurrencePreview} · {recurrenceTimezone}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                <section className={[sectionClass, 'xl:col-start-1 xl:row-start-2'].join(' ')}>
                                    <p className="section-heading">Subtasks</p>
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                        <input
                                            type="text"
                                            value={currentSubtask}
                                            onChange={(e) => setCurrentSubtask(e.target.value)}
                                            placeholder="Add a subtask..."
                                            className={[fieldClass, 'flex-1'].join(' ')}
                                        />
                                        <button type="button" onClick={handleAddSubtask} className={chipButtonClass}>
                                            <PlusIcon className="h-4 w-4" />
                                            Add
                                        </button>
                                    </div>
                                    <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1 text-sm custom-scrollbar">
                                        {subtasks.length === 0 ? (
                                            <li className="modal-plain-card muted">
                                                No subtasks yet.
                                            </li>
                                        ) : (
                                            subtasks.map((sub, index) => (
                                                <li
                                                    key={sub.title + '-' + index}
                                                    className="modal-plain-card flex flex-col gap-3"
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <label className="flex min-w-0 flex-1 items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={sub.completed}
                                                                onChange={() => handleToggleSubtask(index)}
                                                                className="h-4 w-4 rounded border-white/20 bg-black/30 text-cyan-400 focus:ring-cyan-400"
                                                            />
                                                            <span className={`truncate ${sub.completed ? 'line-through opacity-60' : ''}`}>{sub.title}</span>
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveSubtask(index)}
                                                            className={removeButtonClass}
                                                            aria-label="Remove subtask"
                                                        >
                                                            <XMarkIcon className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                    <div className="grid gap-2 sm:grid-cols-2">
                                                        <select
                                                            value={sub.assignedToId ?? ''}
                                                            onChange={(event) => updateSubtaskDraft(index, {
                                                                assignedToId: event.target.value || null,
                                                                assigneeTouched: true,
                                                            })}
                                                            className="modal-input text-xs"
                                                            aria-label="Subtask assignee"
                                                        >
                                                            <option value="">Unassigned</option>
                                                            {assignableUsers.map((member) => (
                                                                <option key={member.id} value={member.id}>{member.name}</option>
                                                            ))}
                                                        </select>
                                                        <select
                                                            value={sub.status}
                                                            onChange={(event) => updateSubtaskDraft(index, { status: event.target.value as SubtaskStatus })}
                                                            className="modal-input text-xs"
                                                            aria-label="Subtask status"
                                                        >
                                                            {Object.values(SubtaskStatus).map((subtaskStatus) => (
                                                                <option key={subtaskStatus} value={subtaskStatus}>
                                                                    {formatTaskStatus(subtaskStatus)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </li>
                                            ))
                                        )}
                                    </ul>
                                </section>

                                <section className={[sectionClass, 'xl:col-start-1 xl:row-start-3'].join(' ')}>
                                    <p className="section-heading">Attachments</p>
                                    <div
                                        className="mt-3 rounded-2xl border border-dashed border-cyan-300/30 bg-cyan-300/5 p-3 text-xs text-cyan-100/70 transition hover:border-cyan-200/60 hover:bg-cyan-300/10"
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            handleAttachmentFiles(event.dataTransfer.files);
                                        }}
                                    >
                                        Drop files here or add a link below.
                                    </div>
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                        <input
                                            type="url"
                                            value={currentAttachment}
                                            onChange={(e) => setCurrentAttachment(e.target.value)}
                                            placeholder="https://..."
                                            className={[fieldClass, 'flex-1'].join(' ')}
                                        />
                                        <button type="button" onClick={handleAddAttachment} className={chipButtonClass}>
                                            <PlusIcon className="h-4 w-4" />
                                            Add
                                        </button>
                                    </div>
                                    <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1 text-sm custom-scrollbar">
                                        {attachments.length === 0 ? (
                                            <li className="modal-plain-card muted">
                                                No attachments linked.
                                            </li>
                                        ) : (
                                            attachments.map((att, index) => (
                                                <li
                                                    key={att + '-' + index}
                                                    className="modal-plain-card flex items-center justify-between gap-3"
                                                >
                                                    <span className="flex-1 break-words">{att}</span>
                                                    {attachmentProgress[att] !== undefined && attachmentProgress[att] < 100 && (
                                                        <span className="w-20 rounded-full bg-white/10">
                                                            <span className="block h-1.5 rounded-full bg-cyan-300 transition-all" style={{ width: `${attachmentProgress[att]}%` }} />
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveAttachment(index)}
                                                        className={removeButtonClass}
                                                        aria-label="Remove attachment"
                                                    >
                                                        <XMarkIcon className="h-4 w-4" />
                                                    </button>
                                                </li>
                                            ))
                                        )}
                                    </ul>
                                </section>

                                <section className={[sectionClass, 'xl:col-start-2 xl:row-start-4'].join(' ')}>
                                    <p className="section-heading">Tags</p>
                                    <div className="mt-3 space-y-3">
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <input
                                                type="text"
                                                value={currentTag}
                                                onChange={(e) => setCurrentTag(e.target.value)}
                                                onKeyDown={handleTagInput}
                                                placeholder="Add tags and press Enter"
                                                className={[fieldClass, 'sm:flex-1'].join(' ')}
                                            />
                                        </div>
                                        {filteredTagSuggestions.length > 0 && (
                                            <div className="modal-quick-actions">
                                                {filteredTagSuggestions.map((tag) => (
                                                    <button
                                                        key={tag}
                                                        type="button"
                                                        className="modal-quick-action"
                                                        onClick={() => handleAddTagSuggestion(tag)}
                                                    >
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-2">
                                            {tags.length === 0 ? (
                                                <span className="modal-plain-card muted text-xs">No tags yet.</span>
                                            ) : (
                                                tags.map((tag, index) => (
                                                    <span
                                                        key={tag + '-' + index}
                                                        className={`modal-chip text-xs ${index % 3 === 1 ? 'border-pink-300/50 bg-pink-400/10 text-pink-100' : index % 3 === 2 ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100' : ''}`}
                                                    >
                                                        {tag}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveTag(index)}
                                                            aria-label={'Remove ' + tag}
                                                        >
                                                            <XMarkIcon className="h-3 w-3" />
                                                        </button>
                                                    </span>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </section>

                                <section className={[compactSectionClass, 'xl:col-start-2 xl:row-start-5'].join(' ')}>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <p className="section-heading">Followers</p>
                                        <span className="text-xs uppercase tracking-[0.2em] modal-muted">{selectedFollowers.length} watching</span>
                                    </div>
                                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                value={followerSearch}
                                                onChange={(event) => setFollowerSearch(event.target.value)}
                                                placeholder="Search followers..."
                                                className={fieldClass}
                                            />
                                            <div className="max-h-28 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                                                {isAssigneesLoading && filteredFollowers.length === 0 ? (
                                                    <div className="modal-plain-card muted text-xs">Loading followers...</div>
                                                ) : filteredFollowers.length === 0 ? (
                                                    <div className="modal-plain-card muted text-xs">No followers available.</div>
                                                ) : (
                                                    filteredFollowers.map((member) => {
                                                        const isSelected = followerIds.includes(member.id);

                                                        return (
                                                            <button
                                                                key={member.id}
                                                                type="button"
                                                                onClick={() => toggleFollower(member.id)}
                                                                className={`flex w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left text-xs transition ${
                                                                    isSelected
                                                                        ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100'
                                                                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                                                                }`}
                                                            >
                                                                <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-black/40">
                                                                    <Avatar user={member} size={28} />
                                                                </span>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block truncate font-semibold">{member.name}</span>
                                                                    <span className="block truncate text-white/40">{formatRoleLabel(member.role)}</span>
                                                                </span>
                                                                <span className="text-[10px] uppercase tracking-[0.18em]">{isSelected ? 'Added' : 'Add'}</span>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                            <p className="text-xs uppercase tracking-[0.2em] modal-muted">Selected followers</p>
                                            <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1 custom-scrollbar">
                                                {selectedFollowers.length === 0 ? (
                                                    <span className="modal-plain-card muted text-xs">No followers added.</span>
                                                ) : (
                                                    selectedFollowers.map((member) => (
                                                        <span key={member.id} className="modal-chip inline-flex items-center gap-2 text-xs">
                                                            <span className="truncate">{member.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleFollower(member.id)}
                                                                aria-label={'Remove ' + member.name}
                                                            >
                                                                <XMarkIcon className="h-3 w-3" />
                                                            </button>
                                                        </span>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                {error && (
                                    <p className="text-sm font-semibold xl:col-span-2" style={{ color: '#f87171' }}>
                                        {error}
                                    </p>
                                )}

                                <div className={[compactSectionClass, 'items-end justify-center xl:col-span-2 xl:row-start-6'].join(' ')}>
                                    <div className="flex w-full flex-wrap items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="modal-secondary-button"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="modal-primary-button"
                                    >
                                        {isSubmitting ? 'Creating...' : 'Create quest'}
                                    </button>
                                    </div>
                                </div>
                            </div>

                            <aside className={[sectionClass, 'order-last', 'max-h-[calc(90vh-9rem)]', 'space-y-4', 'overflow-y-auto', 'custom-scrollbar', 'xl:sticky', 'xl:top-0', 'xl:col-start-3', 'xl:row-span-6', 'xl:row-start-1', 'xl:order-none'].join(' ')}>
                                <div>
                                    <p className="section-heading">Live mission preview</p>
                                    <h3 className="mt-3 text-xl font-semibold">
                                        {title.trim() || 'Untitled quest'}
                                    </h3>
                                    <p className="mt-2 whitespace-pre-line text-sm modal-muted">
                                        {description.trim() || 'Add a description to brief the team.'}
                                    </p>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold">{readinessLabel}</span>
                                        <span className="text-sm font-semibold">{readinessScore}%</span>
                                    </div>
                                    <div className="modal-progress-track mt-2">
                                        <div
                                            className="modal-progress-fill"
                                            style={{ width: readinessScore + '%' }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {summaryStats.map((stat) => (
                                        <div key={stat.label} className="summary-stat">
                                            <span className="text-lg">{stat.icon}</span>
                                            <div>
                                                <p className="text-xs uppercase tracking-[0.2em] modal-muted">{stat.label}</p>
                                                <p className="text-sm font-medium">{stat.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <p className="text-xs uppercase tracking-[0.2em] modal-muted">Crew</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {assignedUsers.length === 0 ? (
                                            <span className="modal-plain-card muted text-xs">No assignees yet</span>
                                        ) : (
                                            assignedUsers.map((member) => {

                                                return (
                                                    <div key={member.id} className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-800/70 dark:text-slate-200">
                                                        <span className="h-7 w-7 overflow-hidden rounded-full border border-slate-200 dark:border-slate-600">
                                                            <Avatar user={member} size={28} />
                                                        </span>
                                                        <span>{member.name}</span>
                                                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">{formatRoleLabel(member.role)}</span>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xs uppercase tracking-[0.2em] modal-muted">Tags</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {tags.length === 0 ? (
                                            <span className="modal-plain-card muted text-xs">No tags assigned</span>
                                        ) : (
                                            tags.map((tag) => (
                                                <span key={'summary-' + tag} className="modal-chip text-xs">{tag}</span>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {summaryNotes.length > 0 && (
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.2em] modal-muted">Next suggestions</p>
                                        <ul className="mt-2 space-y-2 text-sm">
                                            {summaryNotes.map((note, index) => (
                                                <li key={'note-' + index} className="modal-plain-card muted">
                                                    {note}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </aside>
                        </form>
                    </div>
                </div>
            </div>

            {isAiModalOpen && (
                <GenerateTaskWithAIModal
                    isOpen={isAiModalOpen}
                    onClose={() => setIsAiModalOpen(false)}
                    onTaskGenerated={handleTaskGenerated}
                />
            )}
        </>
    );
};

export default CreateTaskModal;
