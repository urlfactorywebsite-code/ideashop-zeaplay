import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import api from '../services/mockApi';
import { Task, User, TaskPriority, Comment, UserStatus, KanbanColumn, TaskStatus, SubtaskStatus, Role, CUSTOM_STATUS_NAMES, TaskTransferWorkflowRead, CompletionSubmissionStatus, Subtask } from '../types';
import { formatDate, timeAgo, formatRecurrenceRule, formatTaskStatus } from '../utils';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { augmentTaskWithPoints, summarizeTaskPoints, formatPointsValue, TaskPointsTone } from '../utils/taskPoints';
import { getUserAvatarUrl } from '../utils/userAvatar';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import TaskStatusBadge from './ui/TaskStatusBadge';
import TaskPriorityBadge from './ui/TaskPriorityBadge';
import MultiSelect from './ui/MultiSelect';
import { StarIcon, PaperClipIcon, TagIcon, TrashIcon } from './icons';
import SameTaskLogModal from './SameTaskLogModal';
import { History } from 'lucide-react';
import { WorkTimerControls } from './ActiveWork';
import { WORK_UPDATED_EVENT } from '../hooks/useActiveWork';

const TaskJourneyModal = React.lazy(() => import('./TaskJourneyModal'));

type TaskTransferLogEntry = {
    id: string;
    fromId: string | null;
    toId: string | null;
    byId: string | null;
    createdAt: string;
    note?: string;
};

type TaskMetaStore = {
    followers: string[];
    transferLog: TaskTransferLogEntry[];
};

const TASK_META_STORAGE_PREFIX = 'zea-play-task-meta:';

const readTaskMeta = (taskId: string): TaskMetaStore => {
    if (typeof window === 'undefined') {
        return { followers: [], transferLog: [] };
    }
    try {
        const raw = window.localStorage.getItem(`${TASK_META_STORAGE_PREFIX}${taskId}`);
        if (!raw) {
            return { followers: [], transferLog: [] };
        }
        const parsed = JSON.parse(raw) as TaskMetaStore;
        return {
            followers: Array.isArray(parsed.followers) ? parsed.followers : [],
            transferLog: Array.isArray(parsed.transferLog) ? parsed.transferLog : [],
        };
    } catch {
        return { followers: [], transferLog: [] };
    }
};

const writeTaskMeta = (taskId: string, meta: TaskMetaStore) => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(`${TASK_META_STORAGE_PREFIX}${taskId}`, JSON.stringify(meta));
    } catch {
    }
};

const formatTrackedTime = (seconds = 0): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
};

const countCompletionWords = (value: string): number => {
    return (value.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
};
interface TaskDetailModalProps {
    focusSubtaskId?: string | null;
    requireFresh?: boolean;
  taskId: string;
  isOpen: boolean;
  initialTask?: Task | null;
  onClose: () => void;
  usersMap: Map<string, User>;
  onTaskDeleted?: (taskId: string) => void;
  onTaskUpdated?: (task: Task) => void;
  notes?: { id: string; title: string; body: string; updatedAt: string; taskId?: string | null }[];
  onUpdateNote?: (id: string, updates: { title: string; body: string }) => void;
  onDeleteNote?: (id: string) => void;
}

const StarRating: React.FC<{
    rating: number;
    setRating: (rating: number) => void;
    disabled?: boolean;
}> = ({ rating, setRating, disabled = false }) => {
    const [hover, setHover] = useState(0);
    return (
        <div className="flex items-center gap-1">
            {[...Array(5)].map((_, index) => {
                const ratingValue = index + 1;
                const isActive = ratingValue <= (hover || rating);
                return (
                    <label
                        key={ratingValue}
                        className={`cursor-pointer transition-transform ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5'}`}
                    >
                        <input
                            type="radio"
                            name="rating"
                            value={ratingValue}
                            onClick={() => !disabled && setRating(ratingValue)}
                            className="sr-only"
                            disabled={disabled}
                        />
                        <StarIcon
                            className={`h-6 w-6 transition-transform transition-colors duration-200 ${
                                isActive
                                    ? 'scale-110 text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.85)]'
                                    : 'text-slate-500 hover:text-amber-200'
                            }`}
                            onMouseEnter={() => !disabled && setHover(ratingValue)}
                            onMouseLeave={() => !disabled && setHover(0)}
                        />
                    </label>
                );
            })}
        </div>
    );
};



const STATUS_AURA: Record<TaskStatus, { gradient: string; legend: string }> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        gradient: 'from-slate-500/25 via-slate-600/25 to-slate-900/40',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.WAITING_FOR_REQUIREMENT]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.TODO]: {
        gradient: 'from-indigo-500/25 via-sky-500/25 to-cyan-500/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.TODO]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.IN_PROGRESS]: {
        gradient: 'from-purple-500/25 via-fuchsia-500/25 to-rose-500/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.IN_PROGRESS]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.BUG_FIXING]: {
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.BUG_FIXING]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.BLOCKED]: {
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.BLOCKED]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.IN_REVIEW]: {
        gradient: 'from-emerald-500/25 via-teal-500/25 to-sky-400/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.IN_REVIEW]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.ON_HOLD]: {
        gradient: 'from-slate-500/25 via-slate-600/25 to-slate-700/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.ON_HOLD]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.DONE]: {
        gradient: 'from-emerald-400/25 via-lime-400/25 to-amber-300/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.DONE]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.DEPLOYED]: {
        gradient: 'from-teal-400/25 via-emerald-400/25 to-lime-300/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.DEPLOYED]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.FAILED]: {
        gradient: 'from-red-500/25 via-rose-500/25 to-pink-500/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.FAILED]?.tooltip ?? 'Status info unavailable',
    },
    [TaskStatus.GRAVEYARD]: {
        gradient: 'from-gray-600/25 via-gray-700/25 to-gray-800/35',
        legend: CUSTOM_STATUS_NAMES[TaskStatus.GRAVEYARD]?.tooltip ?? 'Status info unavailable',
    },
};

const DEFAULT_AURA = {
    gradient: 'from-slate-600/25 via-slate-700/25 to-slate-900/35',
    legend: 'Track the mission status',
};

const metaChipClass =
    'inline-flex items-center rounded-full border border-white/20 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80 backdrop-blur';

const assigneePillClass =
    'inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs text-white/80';

const selectFieldClass =
    'mt-2 w-full rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70';

const subtaskStatuses = Object.values(SubtaskStatus);

const dropdownToggleClass =
    'mt-2 flex w-full items-center justify-between rounded-full border border-white/20 bg-black/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/80 transition hover:border-white/40 hover:bg-white/5';

const formatRoleLabel = (role: Role) => role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

const resolvePointsToneClasses = (tone: TaskPointsTone | undefined) => {
    switch (tone) {
        case 'positive':
            return { card: 'border-emerald-400/40 bg-emerald-500/10', badge: 'border border-emerald-300/60 bg-emerald-500/20 text-emerald-100' };
        case 'negative':
            return { card: 'border-rose-400/40 bg-rose-500/10', badge: 'border border-rose-300/60 bg-rose-500/20 text-rose-100' };
        case 'warning':
            return { card: 'border-amber-400/40 bg-amber-500/10', badge: 'border border-amber-300/60 bg-amber-500/20 text-amber-100' };
        default:
            return { card: 'border-white/10 bg-white/5', badge: 'border border-white/20 bg-white/10 text-white' };
    }
};

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ taskId, isOpen, initialTask = null, onClose, usersMap, onTaskDeleted, onTaskUpdated, notes = [], focusSubtaskId = null, requireFresh = false }) => {
    const statusSelectId = React.useId();
    const [task, setTask] = useState<Task | null>(initialTask);
    const [loading, setLoading] = useState(!initialTask);
    const [error, setError] = useState<string | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [isCommenting, setIsCommenting] = useState(false);
    const [pendingUpdates, setPendingUpdates] = useState<Partial<Task>>({});
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [isSameTaskLogModalOpen, setIsSameTaskLogModalOpen] = useState(false);
    const [journeyOpen, setJourneyOpen] = useState(false);
    const [groupTasks, setGroupTasks] = useState<Task[]>([]);
    const [groupLoading, setGroupLoading] = useState(false);
    const [groupError, setGroupError] = useState<string | null>(null);
    const [assigneeSelection, setAssigneeSelection] = useState<string[]>([]);
    const [isAssigningUser, setIsAssigningUser] = useState(false);
    const [editUnlockCount, setEditUnlockCount] = useState(0);
    const [isEditingCore, setIsEditingCore] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [followers, setFollowers] = useState<string[]>([]);
    const [transferLog, setTransferLog] = useState<TaskTransferLogEntry[]>([]);
    const [transferTargetId, setTransferTargetId] = useState('');
    const [transferNote, setTransferNote] = useState('');
    const [transferError, setTransferError] = useState<string | null>(null);
    const [transferRequests, setTransferRequests] = useState<TaskTransferWorkflowRead[]>([]);
    const [transferRequestsLoading, setTransferRequestsLoading] = useState(false);
    const [isTransferProcessing, setIsTransferProcessing] = useState(false);
    const [transferSuccessMessage, setTransferSuccessMessage] = useState<string | null>(null);
    const [transferPopupVisible, setTransferPopupVisible] = useState(false);
    const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
    const [showFollowerDropdown, setShowFollowerDropdown] = useState(false);
    const [completionDialogSubtaskId, setCompletionDialogSubtaskId] = useState<string | null>(null);
    const [completionDescription, setCompletionDescription] = useState('');
    const [completionFiles, setCompletionFiles] = useState<File[]>([]);
    const [completionError, setCompletionError] = useState<string | null>(null);
    const [completionBusy, setCompletionBusy] = useState(false);
    const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
    const { user } = useAuth();
    const { notify } = useToast();
    useEffect(() => {
        if (!isOpen || !focusSubtaskId || loading || task?.id !== taskId) return;
        const frame = window.requestAnimationFrame(() => {
            const target = document.getElementById(`work-subtask-${focusSubtaskId}`);
            target?.scrollIntoView({ block: 'center', behavior: 'instant' });
            target?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [isOpen, focusSubtaskId, loading, task?.id, taskId]);
    useEffect(() => {
        if (isOpen && taskId) {
            if (initialTask) {
                setTask(initialTask);
                setLoading(false);
            }
            fetchTask();
            setPendingUpdates({});
        }
    }, [isOpen, taskId, initialTask]);

    useEffect(() => {
        if (!isOpen || !taskId) {
            return;
        }
        const meta = readTaskMeta(taskId);
        setFollowers(meta.followers);
        setTransferLog(meta.transferLog);
    }, [isOpen, taskId]);

    useEffect(() => {
        if (!isOpen || !taskId) {
            return;
        }
        writeTaskMeta(taskId, { followers, transferLog });
    }, [followers, transferLog, isOpen, taskId]);

    useEffect(() => {
        if (!isOpen || !taskId) {
            return;
        }
        let isMounted = true;
        const loadTransferRequests = async () => {
            setTransferRequestsLoading(true);
            try {
                const requests = await api.listTaskTransferRequests(taskId);
                if (isMounted) {
                    setTransferRequests(requests);
                }
            } catch (err) {
                console.error('Failed to load transfer requests', err);
            } finally {
                if (isMounted) {
                    setTransferRequestsLoading(false);
                }
            }
        };
        loadTransferRequests();
        return () => {
            isMounted = false;
        };
    }, [isOpen, taskId]);

    useEffect(() => {
        if (!transferSuccessMessage) {
            return;
        }
        setTransferPopupVisible(true);
        const hideTimer = window.setTimeout(() => setTransferPopupVisible(false), 2600);
        const clearTimer = window.setTimeout(() => setTransferSuccessMessage(null), 3000);
        return () => {
            window.clearTimeout(hideTimer);
            window.clearTimeout(clearTimer);
        };
    }, [transferSuccessMessage]);

    useEffect(() => {
        if (!task) {
            return;
        }
        setDraftTitle(task.title ?? '');
        setJourneyOpen(false);
        setDraftDescription(task.description ?? '');
        setIsEditingCore(false);
        setEditUnlockCount(0);
        setTransferTargetId('');
        setTransferNote('');
        setTransferError(null);
        setTransferSuccessMessage(null);
        setTransferPopupVisible(false);
        setShowAssigneeDropdown(false);
        setShowFollowerDropdown(false);
        setCompletionDialogSubtaskId(null);
        setCompletionDescription('');
        setCompletionFiles([]);
        setCompletionError(null);
    }, [task?.id]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            setTask((previous) => (previous ? augmentTaskWithPoints(previous, { config: loadPointsConfig() }) : previous));
        };

        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    const fetchGroupTasks = useCallback(
        async (referenceTask?: Task) => {
            const activeTask = referenceTask ?? task;
            if (!activeTask) {
                return;
            }
            setGroupLoading(true);
            setGroupError(null);
            try {
                const grouped = await api.getTaskGroup(activeTask.id);
                setGroupTasks(grouped);
            } catch (err) {
                console.error('Failed to load linked tasks', err);
                setGroupError('Unable to load linked tasks right now.');
            } finally {
                setGroupLoading(false);
            }
        },
        [task],
    );

    const fetchTask = async () => {
        setLoading((previous) => (task ? previous : true));
        setError(null);
        setGroupLoading(true);
        try {
            const fetchedTask = await api.getTask(taskId, { fresh: requireFresh });
            setTask(fetchedTask);
            setLoading(false);
            const [groupResult, commentsResult] = await Promise.allSettled([
                api.getTaskGroup(fetchedTask.id),
                api.getComments(taskId),
            ]);
            if (groupResult.status === 'fulfilled') {
                setGroupTasks(groupResult.value);
                setGroupError(null);
            } else {
                console.error('Failed to load linked tasks', groupResult.reason);
                setGroupError('Unable to load linked tasks right now.');
            }
            if (commentsResult.status === 'fulfilled') {
                setComments(commentsResult.value);
            } else {
                console.error('Failed to load comments', commentsResult.reason);
            }
        } catch (err) {
            console.error('Error fetching task:', err);
            setError('Failed to load task');
        } finally {
            setLoading(false);
            setGroupLoading(false);
        }
    };
    const refreshTaskAndTimer = async () => { await fetchTask(); };
    useEffect(() => {
        if (!isOpen) return;
        const update = () => { void fetchTask(); };
        window.addEventListener(WORK_UPDATED_EVENT, update);
        return () => window.removeEventListener(WORK_UPDATED_EVENT, update);
    }, [isOpen, taskId]);
    const handleUpdateTask = async (updates: Partial<Task>) => {
        if (!task) return;
        try {
        const updatedTask = await api.updateTask(task.id, updates, user?.id);
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
            await fetchGroupTasks(updatedTask);
            notify('Task updated successfully.');
        } catch (err) {
            console.error('Failed to update task');
        }
    };

    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    const debouncedUpdateTask = useCallback((updates: Partial<Task>) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            handleUpdateTask(updates);
        }, 500); // 500ms debounce
    }, [task, user]);
    const handleSubtaskToggle = async (subtaskId: string, completed: boolean) => {
        if (!task) return;
        try {
            await api.updateSubtask(task.id, subtaskId, { completed });
            setTask({
                ...task,
                subtasks: task.subtasks.map(sub => sub.id === subtaskId ? {
                    ...sub,
                    completed,
                    status: completed ? SubtaskStatus.DONE : SubtaskStatus.TODO,
                } : sub)
            });
        } catch (err) {
            console.error('Failed to update subtask');
        }
    };
    const handleSubtaskUpdate = async (
        subtaskId: string,
        updates: { assignedToId?: string | null; status?: SubtaskStatus },
    ) => {
        if (!task) return;
        try {
            const updatedTask = await api.updateSubtask(task.id, subtaskId, updates);
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
        } catch (err) {
            console.error('Failed to update subtask');
        }
    };
    const openCompletionDialog = (subtaskId: string) => {
        setCompletionDialogSubtaskId(subtaskId);
        setCompletionDescription('');
        setCompletionFiles([]);
        setCompletionError(null);
    };
    const handleSubmitCompletion = async () => {
        if (!task || !completionDialogSubtaskId) return;
        const wordCount = countCompletionWords(completionDescription);
        if (wordCount < 5 || wordCount > 10) {
            setCompletionError('Use 5-10 words in the completion description.');
            return;
        }
        setCompletionBusy(true);
        setCompletionError(null);
        try {
            const updatedTask = await api.submitSubtaskCompletion(
                task.id,
                completionDialogSubtaskId,
                completionDescription,
                completionFiles,
            );
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
            setCompletionDialogSubtaskId(null);
            setCompletionDescription('');
            setCompletionFiles([]);
            notify('Completion submitted.');
        } catch (err) {
            console.error('Failed to submit completion', err);
            setCompletionError('Unable to submit completion evidence.');
        } finally {
            setCompletionBusy(false);
        }
    };
    const handleApproveCompletion = async (subtaskId: string, submissionId: string) => {
        if (!task) return;
        setReviewBusyId(submissionId);
        try {
            const updatedTask = await api.approveSubtaskCompletion(task.id, subtaskId, submissionId);
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
            notify('Completion approved.');
        } catch (err) {
            console.error('Failed to approve completion', err);
            notify('Unable to approve completion.', 'error');
        } finally {
            setReviewBusyId(null);
        }
    };
    const handleRejectCompletion = async (subtaskId: string, submissionId: string) => {
        if (!task) return;
        const reason = window.prompt('Reason for rejection');
        if (!reason || reason.trim().length < 3) {
            notify('Rejection reason is required.', 'error');
            return;
        }
        setReviewBusyId(submissionId);
        try {
            const updatedTask = await api.rejectSubtaskCompletion(task.id, subtaskId, submissionId, reason.trim());
            setTask(updatedTask);
            onTaskUpdated?.(updatedTask);
            notify('Completion returned for changes.');
        } catch (err) {
            console.error('Failed to reject completion', err);
            notify('Unable to reject completion.', 'error');
        } finally {
            setReviewBusyId(null);
        }
    };
    const handlePostComment = async () => {
        if (!task || !newComment.trim()) return;
        setIsCommenting(true);
        try {
            const comment = await api.addComment({
                taskId: task.id,
                userId: user?.id || '',
                content: newComment,
            });
            setComments([...comments, comment]);
            setNewComment('');
        } catch (err) {
            console.error('Failed to post comment');
        } finally {
            setIsCommenting(false);
        }
    };

    const handleDeleteTask = async () => {
    if (!task || !user || ![Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role)) return;
        if (!window.confirm('Are you sure you want to permanently delete this task?')) return;
        
        try {
            await api.deleteTask(task.id);
            onTaskDeleted?.(task.id);
            onClose();
            notify('Task deleted.');
        } catch (err) {
            console.error('Failed to delete task');
        }
    };
    const handleAssigneeSelectionChange = async (nextSelection: string[]) => {
        if (!task) {
            setAssigneeSelection(nextSelection);
            return;
        }
        const currentAssignees = groupAssigneeIds;
        const currentSet = new Set(currentAssignees);
        const nextSet = new Set(nextSelection);
        const additions = nextSelection.filter((id) => !currentSet.has(id));
        const removals = currentAssignees.filter((id) => !nextSet.has(id));
        const isGroupMode = groupTasks.length > 1;

        if (additions.length === 0 && removals.length === 0) {
            return;
        }
        setIsAssigningUser(true);
        let referenceTask = task;
        try {
            if (!isGroupMode) {
                if (additions.length === 0) {
                    const updatedTask = await api.updateTask(task.id, { assignedTo: nextSelection }, user?.id);
                    setTask(updatedTask);
                    onTaskUpdated?.(updatedTask);
                    await fetchGroupTasks(updatedTask);
                    notify('Task updated successfully.');
                    return;
                }

                const currentAssigneeId = task.assignedTo?.[0] ?? null;
                let primaryAssigneeId = currentAssigneeId;
                if (!primaryAssigneeId || !nextSet.has(primaryAssigneeId)) {
                    primaryAssigneeId = nextSelection[0] ?? null;
                }

                if (primaryAssigneeId !== currentAssigneeId) {
                    const updatedTask = await api.updateTask(
                        task.id,
                        { assignedTo: primaryAssigneeId ? [primaryAssigneeId] : [] },
                        user?.id,
                    );
                    setTask(updatedTask);
                    onTaskUpdated?.(updatedTask);
                    referenceTask = updatedTask;
                    notify('Task updated successfully.');
                }

                const normalizedAdditions = additions.filter((id) => id && id !== primaryAssigneeId);
                if (normalizedAdditions.length > 0) {
                    await api.createTask(
                        {
                            title: task.title,
                            description: task.description,
                            priority: task.priority,
                            status: task.status,
                            team: task.team,
                            dueAt: task.dueAt,
                            recurringTaskId: task.recurringTaskId,
                            subtasks: task.subtasks,
                            attachments: task.attachments,
                            estimatedHours: task.estimatedHours,
                            recurrenceRule: task.recurrenceRule,
                            tags: task.tags,
                            clarityRating: task.clarityRating ?? null,
                            assignedTo: normalizedAdditions,
                            taskGroupId: task.taskGroupId ?? task.id,
                        },
                        user?.id || '',
                    );
                }

                await fetchGroupTasks(referenceTask);
                return;
            }

            if (additions.length > 0) {
                await api.createTask(
                    {
                        title: task.title,
                        description: task.description,
                        priority: task.priority,
                        status: task.status,
                        team: task.team,
                        dueAt: task.dueAt,
                        recurringTaskId: task.recurringTaskId,
                        subtasks: task.subtasks,
                        attachments: task.attachments,
                        estimatedHours: task.estimatedHours,
                        recurrenceRule: task.recurrenceRule,
                        tags: task.tags,
                        clarityRating: task.clarityRating ?? null,
                        assignedTo: additions,
                        taskGroupId: task.taskGroupId ?? task.id,
                    },
                    user?.id || '',
                );
            }

            if (removals.length > 0) {
                const removalTaskIds = removals
                    .map((assigneeId) => groupTasks.find((candidate) => (candidate.assignedTo ?? []).includes(assigneeId))?.id)
                    .filter((id): id is string => Boolean(id));
                const uniqueRemovalIds = Array.from(new Set(removalTaskIds));

                    if (nextSelection.length === 0) {
                        const deletions = uniqueRemovalIds.filter((id) => id !== task.id);
                        await Promise.all(deletions.map((id) => api.deleteTask(id)));
                        const updatedTask = await api.updateTask(task.id, { assignedTo: [] }, user?.id);
                        setTask(updatedTask);
                        onTaskUpdated?.(updatedTask);
                        await fetchGroupTasks(updatedTask);
                        notify('Task updated successfully.');
                        return;
                    }

                if (uniqueRemovalIds.length > 0) {
                    await Promise.all(uniqueRemovalIds.map((id) => api.deleteTask(id)));
                    if (uniqueRemovalIds.includes(task.id)) {
                        onTaskDeleted?.(task.id);
                        onClose();
                        return;
                    }
                }
            }

            await fetchGroupTasks(referenceTask);
        } catch (err) {
            console.error('Failed to update assignees', err);
            setAssigneeSelection(groupAssigneeIds);
        } finally {
            setIsAssigningUser(false);
        }
    };
    const subtaskStats = useMemo(() => {
        if (!task) return { total: 0, completed: 0, progress: 0 };
        const total = task.subtasks.length;
        const completed = task.subtasks.filter(sub => sub.completed).length;
        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, progress };
    }, [task]);
    const groupAssigneeIds = useMemo(() => {
        if (groupTasks.length > 0) {
            return groupTasks
                .map((groupTask) => groupTask.assignedTo?.[0])
                .filter((id): id is string => Boolean(id));
        }
        return task?.assignedTo ?? [];
    }, [groupTasks, task]);

    useEffect(() => {
        setAssigneeSelection(groupAssigneeIds);
    }, [groupAssigneeIds]);
    const assignedUsers = useMemo(() => {
        if (groupAssigneeIds.length === 0) {
            return [];
        }

        return groupAssigneeIds
            .map((id) => usersMap.get(id))
            .filter((user): user is User => Boolean(user));
    }, [groupAssigneeIds, usersMap]);
    const assigneeOptions = useMemo(
        () =>
            Array.from(usersMap.values())
                .filter((u) => u.status === UserStatus.ACTIVE || groupAssigneeIds.includes(u.id))
                .map((u) => ({
                    id: u.id,
                    name: u.name,
                    avatarUrl: getUserAvatarUrl(u) ?? undefined,
                    description: `${formatRoleLabel(u.role)}${u.status === UserStatus.ACTIVE ? '' : ' · Inactive'}`,
                })),
        [usersMap, groupAssigneeIds],
    );
    const optionStatusMap = useMemo(() => {
        return assigneeOptions.reduce<Record<string, 'active' | 'inactive'>>((acc, option) => {
            acc[option.id] = groupAssigneeIds.includes(option.id) ? 'active' : 'inactive';
            return acc;
        }, {});
    }, [assigneeOptions, groupAssigneeIds]);

    const canManageTask = Boolean(user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role));
    const editUnlocked = canManageTask && editUnlockCount >= 5;
    const canSubmitCompletion = useCallback((subtask: Subtask) => {
        if (!user || !task) return false;
        const status = subtask.status ?? (subtask.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO);
        if ([SubtaskStatus.WAITING, SubtaskStatus.IN_REVIEW, SubtaskStatus.DONE].includes(status)) {
            return false;
        }
        return subtask.assignedToId === user.id || (!subtask.assignedToId && task.assignedTo?.includes(user.id)) || canManageTask;
    }, [user, task, canManageTask]);

    const pendingCompletion = useCallback((subtask: Subtask) => {
        const latest = subtask.latestCompletionSubmission;
        return latest?.status === CompletionSubmissionStatus.PENDING_REVIEW ? latest : null;
    }, []);

    const transferCandidates = useMemo(() => {
        if (!user) {
            return [];
        }
        const activeUsers = Array.from(usersMap.values()).filter((candidate) => candidate.status === UserStatus.ACTIVE);
        if (user.role !== Role.MANAGER) {
            return activeUsers;
        }
        return activeUsers.filter((candidate) => {
            if (user.departmentId) {
                return candidate.departmentId === user.departmentId;
            }
            if (user.department) {
                return candidate.department === user.department;
            }
            return false;
        });
    }, [usersMap, user]);

    const followerOptions = useMemo(
        () =>
            Array.from(usersMap.values())
                .filter((candidate) => candidate.status === UserStatus.ACTIVE)
                .map((candidate) => ({
                    id: candidate.id,
                    name: candidate.name,
                    avatarUrl: getUserAvatarUrl(candidate) ?? undefined,
                    description: formatRoleLabel(candidate.role),
                })),
        [usersMap],
    );

    const handleEditUnlockClick = useCallback(() => {
        if (!canManageTask || editUnlocked) {
            return;
        }
        setEditUnlockCount((prev) => Math.min(prev + 1, 5));
    }, [canManageTask, editUnlocked]);

    const handleStartEditCore = useCallback(() => {
        if (!task || !editUnlocked) {
            return;
        }
        setDraftTitle(task.title ?? '');
        setDraftDescription(task.description ?? '');
        setIsEditingCore(true);
    }, [task, editUnlocked]);

    const handleCancelEditCore = useCallback(() => {
        if (!task) {
            return;
        }
        setDraftTitle(task.title ?? '');
        setDraftDescription(task.description ?? '');
        setIsEditingCore(false);
    }, [task]);

    const handleSaveEditCore = useCallback(async () => {
        if (!task || !canManageTask) {
            return;
        }
        await handleUpdateTask({
            title: draftTitle.trim() || task.title,
            description: draftDescription,
        });
        setIsEditingCore(false);
    }, [task, canManageTask, draftTitle, draftDescription]);

    const handleFollowersChange = useCallback((nextFollowers: string[]) => {
        setFollowers(nextFollowers);
    }, []);

    const handleRemoveFollower = useCallback((id: string) => {
        setFollowers((prev) => prev.filter((followerId) => followerId !== id));
    }, []);

    const currentAssigneeId = task?.assignedTo?.[0] ?? null;

    const handleTransferTask = useCallback(async () => {
        if (!task || !user) {
            return;
        }
        if (!transferTargetId) {
            setTransferError('Select a teammate to transfer this quest.');
            return;
        }
        if (currentAssigneeId && transferTargetId === currentAssigneeId) {
            setTransferError('This quest is already assigned to that teammate.');
            return;
        }
        const isAllowed = transferCandidates.some((candidate) => candidate.id === transferTargetId);
        if (!isAllowed) {
            setTransferError('You can only transfer to teammates in your department.');
            return;
        }
        setTransferError(null);
        setIsTransferProcessing(true);
        try {
            const transferRequest = await api.createTaskTransferRequest(task.id, {
                toUserId: transferTargetId,
                note: transferNote.trim() ? transferNote.trim() : undefined,
            });
            setTransferRequests((prev) => [transferRequest, ...prev.filter((item) => item.id !== transferRequest.id)]);

            if (transferRequest.status === 'approved') {
                await fetchTask();
                const entry: TaskTransferLogEntry = {
                    id: `transfer-${Date.now()}`,
                    fromId: currentAssigneeId,
                    toId: transferTargetId,
                    byId: user.id ?? null,
                    createdAt: new Date().toISOString(),
                    note: transferNote.trim() ? transferNote.trim() : undefined,
                };
                setTransferLog((prev) => [entry, ...prev]);
                setTransferSuccessMessage('Transfer completed.');
            } else {
                setTransferSuccessMessage('Transfer request sent for approval.');
            }

            setTransferTargetId('');
            setTransferNote('');
        } catch (err) {
            console.error('Failed to submit transfer request', err);
            setTransferError('Unable to submit transfer request.');
        } finally {
            setIsTransferProcessing(false);
        }
    }, [task, user, transferTargetId, transferCandidates, transferNote, fetchTask, currentAssigneeId]);

    const handleTransferDecision = useCallback(async (requestId: string, decision: 'approved' | 'rejected') => {
        if (!task || !user) {
            return;
        }
        setIsTransferProcessing(true);
        try {
            const updatedRequest = await api.approveTaskTransferRequest(requestId, { decision });
            setTransferRequests((prev) =>
                prev.map((item) => (item.id === updatedRequest.id ? updatedRequest : item)),
            );
            if (decision === 'approved') {
                await fetchTask();
                const entry: TaskTransferLogEntry = {
                    id: `transfer-${Date.now()}`,
                    fromId: updatedRequest.fromUserId ?? null,
                    toId: updatedRequest.toUserId,
                    byId: user.id ?? null,
                    createdAt: new Date().toISOString(),
                    note: updatedRequest.note ?? undefined,
                };
                setTransferLog((prev) => [entry, ...prev]);
                setTransferSuccessMessage('Transfer approved and completed.');
            } else {
                setTransferSuccessMessage('Transfer request rejected.');
            }
        } catch (err) {
            console.error('Failed to act on transfer request', err);
            setTransferError('Unable to update transfer request.');
        } finally {
            setIsTransferProcessing(false);
        }
    }, [task, user, fetchTask]);

    const attachmentsCount = task?.attachments?.length || 0;
    const commentCount = comments.length;
    const canRateTask = user && task && groupAssigneeIds.includes(user.id) && !task.clarityRating;
    const columns = Object.values(TaskStatus).map(status => ({ id: status, title: status }));
    const pointsBreakdown = task?.pointsBreakdown ?? null;
    const pointsSummary = useMemo(() => (pointsBreakdown ? summarizeTaskPoints(pointsBreakdown) : null), [pointsBreakdown]);
    const pointsToneClasses = resolvePointsToneClasses(pointsSummary?.tone);

    const dueDisplay = task?.dueAt ? formatDate(task.dueAt, true) : 'No due date';
    const createdBy = usersMap.get(task?.createdBy || '');
    const multiUserCount = groupTasks.length > 0 ? groupTasks.length : (task ? 1 : 0);
    const hasGroupPeers = multiUserCount > 1;
    const pendingTransferRequests = useMemo(
        () => transferRequests.filter((item) => item.status === 'pending'),
        [transferRequests],
    );
    const myPendingTransfer = useMemo(() => {
        if (!user) {
            return null;
        }
        return pendingTransferRequests.find((item) => item.requestedById === user.id) ?? null;
    }, [pendingTransferRequests, user]);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 px-4 pb-6 pt-20 sm:pt-16">
            <div className="relative flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/60 backdrop-blur">
            <button
                onClick={() => {
                    onClose();
                }}
                aria-label="Close modal"
                className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary pointer-events-auto z-50"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            {loading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-white/70">
                    Loading zea.play quest intel...
                </div>
            ) : error || !task ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-white">
                    <p className="text-lg font-semibold">Unable to load quest</p>
                    <p className="text-sm text-white/70">{error || 'Task not found.'}</p>
                </div>
            ) : (
                <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
                    <main className="flex-1 max-h-[85vh] overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-primary scrollbar-track-transparent scrollbar-thumb-rounded-lg">
                        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                            <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
                                <button type="button" onClick={() => setJourneyOpen(true)}
                                    title="Task status journey" aria-label="Open task status journey"
                                    className="inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                    <History size={16} aria-hidden="true" /> Journey
                                </button>
                                <span className={metaChipClass}>
                                    {subtaskStats.completed}/{subtaskStats.total} subtasks
                                </span>
                                <span className={metaChipClass}>{attachmentsCount} attachments</span>
                                <span className={metaChipClass}>{commentCount} comments</span>
                                <span className={metaChipClass}>Updated {timeAgo(task.updatedAt)}</span>
                            </div>
                            <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    {isEditingCore ? (
                                        <input
                                            value={draftTitle}
                                            onChange={(e) => setDraftTitle(e.target.value)}
                                            className="w-full max-w-2xl rounded-2xl border border-white/20 bg-black/40 px-4 py-2 text-2xl md:text-3xl font-bold text-white focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                            placeholder="Quest title"
                                        />
                                    ) : (
                                        <h2
                                            className="text-2xl md:text-3xl font-bold text-white"
                                            onClick={handleEditUnlockClick}
                                        >
                                            {task.title || 'Untitled Task'}
                                        </h2>
                                    )}
                                    {hasGroupPeers && (
                                        <button
                                            type="button"
                                            onClick={() => setIsSameTaskLogModalOpen(true)}
                                            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-black/20"
                                        >
                                            <span role="img" aria-hidden="true">
                                                👥
                                            </span>
                                            {multiUserCount} users
                                        </button>
                                    )}
                                </div>
                                {editUnlocked && !isEditingCore && (
                                    <button
                                        type="button"
                                        onClick={handleStartEditCore}
                                        className="rounded-full border border-primary/50 bg-primary/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary transition hover:bg-primary/25"
                                    >
                                        Edit
                                    </button>
                                )}
                                {isEditingCore && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleSaveEditCore}
                                            className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-500/25"
                                        >
                                            Save
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCancelEditCore}
                                            className="rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:bg-black/60"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-white">Quest summary</h3>
                            {isEditingCore ? (
                                <textarea
                                    value={draftDescription}
                                    onChange={(e) => setDraftDescription(e.target.value)}
                                    rows={4}
                                    className="mt-2 w-full rounded-2xl border border-white/20 bg-black/40 px-4 py-3 text-sm text-white focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                    placeholder="Describe the mission objective..."
                                />
                            ) : (
                                <p className="mt-2 text-sm text-white/80 whitespace-pre-wrap" onClick={handleEditUnlockClick}>
                                    {task.description || 'No description provided.'}
                                </p>
                            )}

                                {task.tags && task.tags.length > 0 && (
                                    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-white/80">
                                        <TagIcon className="h-5 w-5 text-white/60" />
                                        {task.tags.map((tag) => (
                                            <span key={tag} className="rounded-full bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80">
                                    <span className="font-semibold text-white">Tracked {formatTrackedTime(task.totalTrackedSeconds ?? 0)}</span>
                                    <WorkTimerControls taskId={task.id} />
                                </div>
                            </section>

                            {canRateTask && (
                                <section className="mt-6 rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/10 via-amber-400/10 to-rose-400/10 p-5">
                                    <h3 className="text-lg font-semibold text-white">Rate task clarity</h3>
                                    <p className="mt-2 text-sm text-white/80">
                                        Your feedback helps managers craft sharper quests for the team.
                                    </p>
                                    <div className="mt-4">
                                        <StarRating
                                            rating={task.clarityRating || 0}
                                            setRating={(rating) => handleUpdateTask({ clarityRating: rating })}
                                            disabled={!!task.clarityRating}
                                        />
                                        {task.clarityRating && (
                                            <p className="mt-2 text-xs font-semibold text-emerald-300">
                                                Thanks for sending the signal!
                                            </p>
                                        )}
                                    </div>
                                </section>
                            )}

                            <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Subtasks</h3>
                                    <span className="text-xs text-white/70">{subtaskStats.progress}% complete</span>
                                </div>
                                {subtaskStats.total > 0 ? (
                                    <>
                                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/40">
                                            <div
                                                className="h-full rounded-full bg-emerald-400"
                                                style={{ width: `${subtaskStats.progress}%` }}
                                            />
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            {task.subtasks.map((sub) => (
                                                <div
                                                    key={sub.id}
                                                    id={`work-subtask-${sub.id}`}
                                                    tabIndex={-1}
                                                    className={`rounded-2xl border border-white/10 bg-black/30 px-4 py-3 ${sub.completed ? 'opacity-80' : ''}`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={sub.completed}
                                                            onChange={(e) => handleSubtaskToggle(sub.id, e.target.checked)}
                                                            className="mt-1 h-4 w-4 rounded border-white/30 bg-black/20 text-emerald-400 focus:ring-emerald-300"
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <span className="text-sm text-white/80">{sub.title}</span>
                                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-white/55">
                                                                <span>{formatTaskStatus(sub.status ?? (sub.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO))}</span>
                                                                <span>{sub.dependencyState ?? 'READY'}</span>
                                                                {sub.dependencyIds && sub.dependencyIds.length > 0 && (
                                                                    <span>{sub.dependencyIds.length} dependencies</span>
                                                                )}
                                                                <span>{sub.assignedToId ? usersMap.get(sub.assignedToId)?.name ?? 'Assigned user' : 'Unassigned'}</span>
                                                                <span>{formatTrackedTime(sub.totalTrackedSeconds ?? 0)} tracked</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                                        <WorkTimerControls taskId={task.id} subtaskId={sub.id} disabled={sub.status === SubtaskStatus.WAITING || sub.status === SubtaskStatus.DONE}
                                                            canForceStart={sub.status === SubtaskStatus.WAITING && (sub.assignedToId === user?.id || canManageTask)} />
                                                        <button
                                                            type="button"
                                                            disabled={!canSubmitCompletion(sub)}
                                                            onClick={() => openCompletionDialog(sub.id)}
                                                            className="rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 disabled:opacity-50"
                                                        >
                                                            Complete
                                                        </button>
                                                        {sub.latestCompletionSubmission && (
                                                            <span className="text-xs text-white/60">
                                                                Attempt {sub.latestCompletionSubmission.attemptNumber}: {sub.latestCompletionSubmission.status.replace(/_/g, ' ')}
                                                            </span>
                                                        )}
                                                        {canManageTask && pendingCompletion(sub) && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    disabled={reviewBusyId === pendingCompletion(sub)?.id}
                                                                    onClick={() => handleApproveCompletion(sub.id, pendingCompletion(sub)!.id)}
                                                                    className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100 disabled:opacity-50"
                                                                >
                                                                    Approve
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={reviewBusyId === pendingCompletion(sub)?.id}
                                                                    onClick={() => handleRejectCompletion(sub.id, pendingCompletion(sub)!.id)}
                                                                    className="rounded-full border border-rose-400/50 bg-rose-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100 disabled:opacity-50"
                                                                >
                                                                    Reject
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                                        <select
                                                            value={sub.assignedToId ?? ''}
                                                            onChange={(event) => handleSubtaskUpdate(sub.id, { assignedToId: event.target.value || null })}
                                                            className={selectFieldClass}
                                                            aria-label="Subtask assignee"
                                                        >
                                                            <option value="">Unassigned</option>
                                                            {Array.from(usersMap.values())
                                                                .filter((candidate) => candidate.status === UserStatus.ACTIVE || candidate.id === sub.assignedToId)
                                                                .map((candidate) => (
                                                                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                                                ))}
                                                        </select>
                                                        <select
                                                            value={sub.status ?? (sub.completed ? SubtaskStatus.DONE : SubtaskStatus.TODO)}
                                                            onChange={(event) => handleSubtaskUpdate(sub.id, { status: event.target.value as SubtaskStatus })}
                                                            className={selectFieldClass}
                                                            aria-label="Subtask status"
                                                        >
                                                            {subtaskStatuses.map((subtaskStatus) => (
                                                                <option key={subtaskStatus} value={subtaskStatus}>
                                                                    {formatTaskStatus(subtaskStatus)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <p className="mt-2 text-sm text-white/70">No subtasks for this quest yet.</p>
                                )}
                            </section>

                            {completionDialogSubtaskId && (
                                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
                                    <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#10131f] p-5 shadow-2xl">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-semibold text-white">Complete subtask</h3>
                                            <button
                                                type="button"
                                                onClick={() => setCompletionDialogSubtaskId(null)}
                                                className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
                                            >
                                                Close
                                            </button>
                                        </div>
                                        <textarea
                                            value={completionDescription}
                                            onChange={(event) => {
                                                setCompletionDescription(event.target.value);
                                                setCompletionError(null);
                                            }}
                                            rows={3}
                                            placeholder="Summarize the completed work"
                                            className="mt-4 w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                        />
                                        <div className="mt-2 flex items-center justify-between text-xs text-white/60">
                                            <span>{countCompletionWords(completionDescription)} / 5-10 words</span>
                                            <span>Max 5 files, 10 MB each</span>
                                        </div>
                                        <input
                                            type="file"
                                            multiple
                                            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.rtf,.doc,.docx,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                            onChange={(event) => {
                                                setCompletionFiles(Array.from(event.target.files ?? []).slice(0, 5));
                                                setCompletionError(null);
                                            }}
                                            className="mt-4 block w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                                        />
                                        {completionFiles.length > 0 && (
                                            <div className="mt-3 space-y-1 text-xs text-white/60">
                                                {completionFiles.map((file) => (
                                                    <div key={`${file.name}-${file.size}`}>{file.name} ({Math.round(file.size / 1024)} KB)</div>
                                                ))}
                                            </div>
                                        )}
                                        {completionError && (
                                            <p className="mt-3 text-sm text-rose-300">{completionError}</p>
                                        )}
                                        <div className="mt-5 flex justify-end gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setCompletionDialogSubtaskId(null)}
                                                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/70"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={completionBusy}
                                                onClick={handleSubmitCompletion}
                                                className="rounded-full border border-sky-400/50 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-50"
                                            >
                                                {completionBusy ? 'Submitting...' : 'Submit'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                                    <PaperClipIcon className="h-5 w-5 text-white/70" />
                                    Attachments
                                </h3>
                                {attachmentsCount > 0 ? (
                                    <ul className="mt-4 space-y-2 text-sm">
                                        {task.attachments.map((url, index) => (
                                            <li key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block truncate px-4 py-2 text-white/80 transition hover:bg-white/10 hover:text-white"
                                                >
                                                    {url}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-sm text-white/70">No attachments yet.</p>
                                )}
                            </section>

                            {notes.length > 0 && (
                                <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                                    <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        Notes
                                    </h3>
                                    <div className="mt-4 space-y-3">
                                        {notes.map((note) => (
                                            <div key={note.id} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                                                <h4 className="text-sm font-semibold text-white">{note.title}</h4>
                                                <p className="mt-2 text-sm text-white/80 whitespace-pre-wrap">{note.body}</p>
                                                <span className="mt-2 block text-xs text-white/60">Updated {timeAgo(note.updatedAt)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-white">Mission log</h3>
                                    <span className="text-xs text-white/70">{commentCount} entries</span>
                                </div>
                                <div className="mt-4 max-h-60 space-y-3 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-primary scrollbar-track-transparent scrollbar-thumb-rounded-lg">
                                    {comments.length === 0 ? (
                                        <p className="text-sm text-white/70">
                                            No transmissions yet. Drop a note to sync the squad.
                                        </p>
                                    ) : (
                                        comments.map((comment) => {
                                            const author = usersMap.get(comment.userId);
                                            return (
                                                <div key={comment.id} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                                                    <div className="flex items-center justify-between text-xs text-white/70">
                                                        <span className="font-semibold text-white">
                                                            {author?.name || 'Unknown operative'}
                                                        </span>
                                                        <span>{timeAgo(comment.createdAt)}</span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-white/80 whitespace-pre-wrap">{comment.content}</p>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                <div className="mt-5 space-y-3">
                                    <textarea
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        placeholder="Log a quick update or request backup..."
                                        rows={3}
                                        className="w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                    />
                                    <button
                                        type="button"
                                        onClick={handlePostComment}
                                        disabled={isCommenting || !newComment.trim()}
                                        className="inline-flex items-center justify-center rounded-full border border-primary/60 bg-primary/20 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isCommenting ? 'Sending...' : 'Send transmission'}
                                    </button>
                                </div>
                            </section>
                        </main>

                        <aside className="w-full border-t border-white/10 bg-black/30 px-6 py-6 backdrop-blur lg:w-96 lg:border-l lg:border-t-0 scrollbar-thin scrollbar-thumb-primary scrollbar-track-transparent scrollbar-thumb-rounded-lg overflow-y-auto">
                            <h3 className="text-xs font-semibold uppercase tracking-[0.35em] text-white/60">Control panel</h3>
                            <div className="mt-5 space-y-5 text-sm text-white/80">
                                <div>
                                    <label className="text-xs uppercase tracking-[0.25em] text-white/50">Assignees</label>
                                    <button
                                        type="button"
                                        onClick={() => setShowAssigneeDropdown((prev) => !prev)}
                                        disabled={isAssigningUser}
                                        className={`${dropdownToggleClass} ${isAssigningUser ? 'cursor-not-allowed opacity-60' : ''}`}
                                    >
                                        <span>{assigneeSelection.length ? `${assigneeSelection.length} selected` : 'Select assignees'}</span>
                                        <span className="text-[10px] tracking-[0.2em] text-white/50">
                                            {showAssigneeDropdown ? 'Close' : 'Open'}
                                        </span>
                                    </button>
                                    {showAssigneeDropdown && (
                                        <div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3">
                                            <MultiSelect
                                                options={assigneeOptions}
                                                value={assigneeSelection}
                                                onChange={handleAssigneeSelectionChange}
                                                placeholder="Select assignees..."
                                                optionStatusMap={optionStatusMap}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowAssigneeDropdown(false)}
                                                className="mt-3 w-full rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                                            >
                                                Hide
                                            </button>
                                        </div>
                                    )}
                                    {groupLoading && (
                                        <p className="mt-2 text-xs text-white/60">Syncing group members...</p>
                                    )}
                                    {isAssigningUser && !groupLoading && (
                                        <p className="mt-2 text-xs text-emerald-300">Linking teammate to this quest...</p>
                                    )}
                                    {groupError && (
                                        <p className="mt-2 text-xs text-rose-400">{groupError}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs uppercase tracking-[0.25em] text-white/50">Followers</label>
                                    <button
                                        type="button"
                                        onClick={() => setShowFollowerDropdown((prev) => !prev)}
                                        className={dropdownToggleClass}
                                    >
                                        <span>{followers.length ? `${followers.length} selected` : 'Add followers'}</span>
                                        <span className="text-[10px] tracking-[0.2em] text-white/50">
                                            {showFollowerDropdown ? 'Close' : 'Open'}
                                        </span>
                                    </button>
                                    {showFollowerDropdown && (
                                        <div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3">
                                            <MultiSelect
                                                options={followerOptions}
                                                value={followers}
                                                onChange={handleFollowersChange}
                                                placeholder="Add followers..."
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowFollowerDropdown(false)}
                                                className="mt-3 w-full rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                                            >
                                                Hide
                                            </button>
                                        </div>
                                    )}
                                    <p className="mt-2 text-xs text-white/60">Followers do not earn task points.</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {followers.length === 0 ? (
                                            <span className="text-xs text-white/60">No followers yet.</span>
                                        ) : (
                                            followers.map((followerId) => {
                                                const follower = usersMap.get(followerId);
                                                if (!follower) {
                                                    return null;
                                                }
                                                return (
                                                    <div key={followerId} className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/80">
                                                        <span>{follower.name}</span>
                                                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{formatRoleLabel(follower.role)}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveFollower(followerId)}
                                                            className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-300 transition hover:text-rose-200"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                                {user && (
                                    <div>
                                        <label className="text-xs uppercase tracking-[0.25em] text-white/50">Transfer quest</label>
                                        <p className="mt-2 text-xs text-white/60">
                                            {canManageTask
                                                ? 'Move this quest instantly or review pending requests.'
                                                : 'Request a transfer and wait for manager approval.'}
                                        </p>
                                        <select
                                            value={transferTargetId}
                                            onChange={(e) => {
                                                setTransferTargetId(e.target.value);
                                                setTransferError(null);
                                            }}
                                            className={selectFieldClass}
                                        >
                                            <option value="">Select teammate...</option>
                                            {transferCandidates.map((candidate) => (
                                                <option key={candidate.id} value={candidate.id}>
                                                    {candidate.name}
                                                </option>
                                            ))}
                                        </select>
                                        <input
                                            value={transferNote}
                                            onChange={(e) => setTransferNote(e.target.value)}
                                            className="mt-2 w-full rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                            placeholder="Transfer note (optional)"
                                        />
                                        {transferError && (
                                            <p className="mt-2 text-xs text-rose-400">{transferError}</p>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleTransferTask}
                                            disabled={isTransferProcessing || Boolean(myPendingTransfer) || (Boolean(currentAssigneeId) && transferTargetId === currentAssigneeId)}
                                            className="mt-3 w-full rounded-2xl border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {canManageTask ? 'Transfer Task' : myPendingTransfer ? 'Awaiting approval' : 'Request transfer'}
                                        </button>
                                        {isTransferProcessing && (
                                            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                                                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-500" />
                                            </div>
                                        )}
                                        {transferSuccessMessage && (
                                            <div
                                                className={`mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition duration-200 ${
                                                    transferPopupVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                                                }`}
                                            >
                                                {transferSuccessMessage}
                                            </div>
                                        )}
                                        {canManageTask && (
                                            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Pending approvals</span>
                                                    {transferRequestsLoading && (
                                                        <span className="text-[11px] text-white/50">Syncing...</span>
                                                    )}
                                                </div>
                                                {pendingTransferRequests.length === 0 ? (
                                                    <p className="text-xs text-white/60">No pending transfers.</p>
                                                ) : (
                                                    pendingTransferRequests.map((requestItem) => {
                                                        const fromUser = requestItem.fromUserId ? usersMap.get(requestItem.fromUserId) : null;
                                                        const toUser = usersMap.get(requestItem.toUserId);
                                                        const requester = usersMap.get(requestItem.requestedById);
                                                        return (
                                                            <div key={requestItem.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/70">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="font-semibold text-white/90">
                                                                        {fromUser?.name || 'Unassigned'} {' -> '} {toUser?.name || 'Unassigned'}
                                                                    </span>
                                                                    <span>{timeAgo(requestItem.createdAt)}</span>
                                                                </div>
                                                                <div className="mt-1 text-[11px] text-white/60">
                                                                    Requested by {requester?.name || 'Unknown'}
                                                                </div>
                                                                {requestItem.note && (
                                                                    <div className="mt-1 text-[11px] text-white/60">{requestItem.note}</div>
                                                                )}
                                                                <div className="mt-2 flex gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleTransferDecision(requestItem.id, 'approved')}
                                                                        className="flex-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-500/20"
                                                                    >
                                                                        Approve
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleTransferDecision(requestItem.id, 'rejected')}
                                                                        className="flex-1 rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20"
                                                                    >
                                                                        Reject
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                        <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                                            <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Transfer log</span>
                                            {transferLog.length === 0 ? (
                                                <p className="text-xs text-white/60">No transfers recorded.</p>
                                            ) : (
                                                transferLog.map((entry) => {
                                                    const fromUser = entry.fromId ? usersMap.get(entry.fromId) : null;
                                                    const toUser = entry.toId ? usersMap.get(entry.toId) : null;
                                                    const byUser = entry.byId ? usersMap.get(entry.byId) : null;
                                                    return (
                                                        <div key={entry.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/70">
                                                            <div className="flex items-center justify-between">
                                                                <span className="font-semibold text-white/90">
                                                                    {fromUser?.name || 'Unassigned'} {' -> '} {toUser?.name || 'Unassigned'}
                                                                </span>
                                                                <span>{timeAgo(entry.createdAt)}</span>
                                                            </div>
                                                            <div className="mt-1 text-[11px] text-white/60">
                                                                By {byUser?.name || 'System'}
                                                            </div>
                                                            {entry.note && (
                                                                <div className="mt-1 text-[11px] text-white/60">{entry.note}</div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <label htmlFor={statusSelectId} className="text-xs uppercase tracking-[0.25em] text-white/50">Status</label>
                                    <select
                                        id={statusSelectId}
                                        value={pendingUpdates.status !== undefined ? pendingUpdates.status : task.status}
                                        onChange={(e) => setPendingUpdates(prev => ({ ...prev, status: e.target.value as TaskStatus }))}
                                        className={selectFieldClass}
                                    >
                                        {columns.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {CUSTOM_STATUS_NAMES[c.id as TaskStatus]?.name || formatTaskStatus(c.title)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs uppercase tracking-[0.25em] text-white/50">Priority</label>
                                    <select
                                        value={pendingUpdates.priority !== undefined ? pendingUpdates.priority : task.priority}
                                        onChange={(e) => setPendingUpdates(prev => ({ ...prev, priority: e.target.value as TaskPriority }))}
                                        className={selectFieldClass}
                                        disabled={!user || ![Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role)}
                                    >
                                        {Object.values(TaskPriority).map((p) => (
                                            <option key={p} value={p}>
                                                {String(p).charAt(0) + String(p).slice(1).toLowerCase()}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role) && (
                                    <>
                                        <div>
                                            <label className="text-xs uppercase tracking-[0.25em] text-white/50">Due date</label>
                                            <button
                                                onClick={() => setShowDatePicker(!showDatePicker)}
                                                className={selectFieldClass}
                                            >
                                                {pendingUpdates.dueAt !== undefined ? (pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toLocaleDateString() : 'No date') : (task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'Select due date')}
                                            </button>
                                            <div className="relative">
                                                {showDatePicker && (
                                                    <div className="contain top-full right-0 z-60 mt-1 rounded-3xl border border-white/50 bg-black p-3 w-70 overflow-x-auto">
                                                        <DayPicker
                                                            mode="single"
                                                            selected={pendingUpdates.dueAt !== undefined ? (pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt) : undefined) : (task.dueAt ? new Date(task.dueAt) : undefined)}
                                                            onSelect={(date) => {
                                                                const currentTime = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toTimeString().slice(0, 5) : task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '00:00';
                                                                const dueAt = date ? `${date.toLocaleDateString('sv-SE')}T${currentTime}:00` : null;
                                                                setPendingUpdates(prev => ({ ...prev, dueAt }));
                                                                setShowDatePicker(false);
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs uppercase tracking-[0.25em] text-white/50">Due time</label>
                                            <button
                                                onClick={() => setShowTimePicker(!showTimePicker)}
                                                className={selectFieldClass}
                                            >
                                                {pendingUpdates.dueAt !== undefined ? (pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toTimeString().slice(0, 5) : 'Select time') : (task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : 'Select time')}
                                            </button>
                                            <div className="relative">
                                                {showTimePicker && (
                                                    <div className="contain top-full right-0 z-60 mt-1 rounded-2xl border border-white/20 bg-black/40 p-3 w-55">
                                                        <div className="flex gap-2 items-center">
                                                            <select
                                                                value={pendingUpdates.dueAt ? (new Date(pendingUpdates.dueAt).getHours() % 12 || 12) : (task.dueAt ? (new Date(task.dueAt).getHours() % 12 || 12) : 12)}
                                                                onChange={(e) => {
                                                                    const hour12 = parseInt(e.target.value);
                                                                    const currentDate = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toISOString().split('T')[0] : task.dueAt ? new Date(task.dueAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                                                                    const currentMinute = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).getMinutes() : (task.dueAt ? new Date(task.dueAt).getMinutes() : 0);
                                                                    const isAM = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).getHours() < 12 : (task.dueAt ? new Date(task.dueAt).getHours() < 12 : true);
                                                                    const hour24 = isAM ? (hour12 === 12 ? 0 : hour12) : (hour12 === 12 ? 12 : hour12 + 12);
                                                                    const dueAt = `${currentDate}T${hour24.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}:00`;
                                                                    setPendingUpdates(prev => ({ ...prev, dueAt }));
                                                                }}
                                                                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-white text-sm"
                                                            >
                                                                {Array.from({ length: 12 }, (_, i) => i + 1).map(i => (
                                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                                ))}
                                                            </select>
                                                            <span className="text-white">:</span>
                                                            <select
                                                                value={pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).getMinutes() : (task.dueAt ? new Date(task.dueAt).getMinutes() : 0)}
                                                                onChange={(e) => {
                                                                    const minute = parseInt(e.target.value);
                                                                    const currentDate = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toISOString().split('T')[0] : task.dueAt ? new Date(task.dueAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                                                                    const currentHour = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).getHours() : (task.dueAt ? new Date(task.dueAt).getHours() : 0);
                                                                    const dueAt = `${currentDate}T${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
                                                                    setPendingUpdates(prev => ({ ...prev, dueAt }));
                                                                }}
                                                                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-white text-sm"
                                                            >
                                                                {Array.from({ length: 60 }, (_, i) => (
                                                                    <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                                                                ))}
                                                            </select>
                                                            <select
                                                                value={pendingUpdates.dueAt ? (new Date(pendingUpdates.dueAt).getHours() < 12 ? 'AM' : 'PM') : (task.dueAt ? (new Date(task.dueAt).getHours() < 12 ? 'AM' : 'PM') : 'AM')}
                                                                onChange={(e) => {
                                                                    const period = e.target.value;
                                                                    const currentDate = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).toISOString().split('T')[0] : task.dueAt ? new Date(task.dueAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                                                                    const currentMinute = pendingUpdates.dueAt ? new Date(pendingUpdates.dueAt).getMinutes() : (task.dueAt ? new Date(task.dueAt).getMinutes() : 0);
                                                                    const currentHour12 = pendingUpdates.dueAt ? (new Date(pendingUpdates.dueAt).getHours() % 12 || 12) : (task.dueAt ? (new Date(task.dueAt).getHours() % 12 || 12) : 12);
                                                                    const hour24 = period === 'AM' ? (currentHour12 === 12 ? 0 : currentHour12) : (currentHour12 === 12 ? 12 : currentHour12 + 12);
                                                                    const dueAt = `${currentDate}T${hour24.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}:00`;
                                                                    setPendingUpdates(prev => ({ ...prev, dueAt }));
                                                                }}
                                                                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-white text-sm"
                                                            >
                                                                <option value="AM">AM</option>
                                                                <option value="PM">PM</option>
                                                            </select>
                                                        </div>
                                                        <button
                                                            onClick={() => setShowTimePicker(false)}
                                                            className="mt-2 w-full rounded px-2 py-1 bg-primary/20 text-primary text-sm hover:bg-primary/30"
                                                        >
                                                            Done
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    if (Object.keys(pendingUpdates).length > 0) {
                                                        handleUpdateTask(pendingUpdates);
                                                        setPendingUpdates({});
                                                    }
                                                }}
                                                disabled={Object.keys(pendingUpdates).length === 0}
                                                className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Update Task
                                            </button>
                                            <button
                                                onClick={handleDeleteTask}
                                                className="flex-1 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20"
                                            >
                                                Delete Task
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            {pointsBreakdown && pointsSummary && (
                                <div className={`mt-6 space-y-3 rounded-3xl border ${pointsToneClasses.card} p-4 text-xs text-white/80`}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] uppercase tracking-[0.25em] text-white/60">Points</span>
                                        <span className="text-lg font-semibold text-white">{formatPointsValue(pointsSummary.value)}</span>
                                    </div>
                                    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${pointsToneClasses.badge}`}>
                                        {pointsSummary.label}
                                    </div>
                                    {pointsSummary.detail && (
                                        <p className="text-[11px] text-white/70">{pointsSummary.detail}</p>
                                    )}
                                    <div className="grid gap-1 text-[11px] text-white/65">
                                        <div className="flex items-center justify-between">
                                            <span>Base</span>
                                            <span>{formatPointsValue(pointsBreakdown.basePoints)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Bonus</span>
                                            <span>{formatPointsValue(pointsBreakdown.beforeDueBonus)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Penalty</span>
                                            <span>{formatPointsValue(pointsBreakdown.overduePenalty)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Config</span>
                                            <span>{pointsBreakdown.matchedDepartment}</span>
                                        </div>
                                    </div>
                                    {pointsBreakdown.notes.length > 0 && (
                                        <ul className="mt-2 space-y-1 text-[11px] text-white/60">
                                            {pointsBreakdown.notes.map((note) => (
                                                <li key={note}>- {note}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            <div className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
                                <p className="text-xs uppercase tracking-[0.2em] text-white/60">Crew</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {assignedUsers.length === 0 ? (
                                        <span className="text-xs text-white/70">No assignees yet</span>
                                    ) : (
                                        assignedUsers.map((member) => {
                                            const memberAvatar = getUserAvatarUrl(member);
                                            return (
                                                <div key={member.id} className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white shadow-sm">
                                                    <span className="h-7 w-7 overflow-hidden rounded-full border border-white/20">
                                                        {memberAvatar ? (
                                                            <img src={memberAvatar} alt={member.name} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <span className="flex h-full w-full items-center justify-center text-[10px] uppercase">{member.name.slice(0, 2)}</span>
                                                        )}
                                                    </span>
                                                    <span>{member.name}</span>
                                                    <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">{formatRoleLabel(member.role)}</span>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                            <div className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
                                <div className="flex items-center justify-between">
                                    <span>Project</span>
                                    <span className="text-right font-semibold text-white">
                                        {task.project?.name ?? 'Legacy task'}
                                    </span>
                                </div>
                                {task.project?.clientName && (
                                    <div className="flex items-center justify-between">
                                        <span>Client</span>
                                        <span className="text-right font-semibold text-white">{task.project.clientName}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <span>Due date</span>
                                    <span className="font-semibold text-white">{dueDisplay}</span>
                                </div>
                                {task.estimatedHours && (
                                    <div className="flex items-center justify-between">
                                        <span>Estimated effort</span>
                                        <span className="font-semibold text-white">{task.estimatedHours} hours</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <span>Created</span>
                                    <span className="text-right font-semibold text-white">
                                        {formatDate(task.createdAt)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Created by</span>
                                    <span className="text-right font-semibold text-white">
                                        {createdBy?.name || 'Unknown'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Last updated</span>
                                    <span className="text-right font-semibold text-white">{timeAgo(task.updatedAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Recurrence</span>
                                    <span className="text-right font-semibold text-white">
                                        {formatRecurrenceRule(task.recurrenceRule)}
                                    </span>
                                </div>
                                {hasGroupPeers && (
                                    <div className="flex items-center justify-between">
                                        <span>Same task log</span>
                                        <button
                                            onClick={() => setIsSameTaskLogModalOpen(true)}
                                            className="text-right font-semibold text-primary hover:text-primary/80"
                                        >
                                            View
                                        </button>
                                    </div>
                                )}
                            </div>
                        </aside>
                    </div>
                )}
            </div>
            {journeyOpen && user && <React.Suspense fallback={<span role="status" className="sr-only">Loading task journey...</span>}>
                <TaskJourneyModal taskId={taskId} usersMap={usersMap} onClose={() => setJourneyOpen(false)} />
            </React.Suspense>}
            <SameTaskLogModal
                isOpen={isSameTaskLogModalOpen}
                onClose={() => setIsSameTaskLogModalOpen(false)}
                taskId={taskId}
                usersMap={usersMap}
                groupTasks={groupTasks}
                onRefreshGroup={fetchGroupTasks}
            />
        </div>
    );
};

export default TaskDetailModal;
