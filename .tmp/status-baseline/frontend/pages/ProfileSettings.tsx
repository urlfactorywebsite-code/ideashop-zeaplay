import ProfileMediaEditor from '../components/ProfileMediaEditor';
import ProfileInformationForm from '../components/ProfileInformationForm';
import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';

import { useAuth, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import { passwordError } from '../utils/passwordReset';
import PageLoader from '../components/loading/PageLoader';
import {
    AvatarCropMetadata,
    DataExportScope,
    DataImportPayload,
    Department,
    Reward,
    Role,
} from '../types';
import {
    CheckCircleIcon,
    ExclamationTriangleIcon,
    GiftIcon,
    LockClosedIcon,
    ShieldCheckIcon,
    UserIcon,
} from '../components/icons';
import { CameraIcon } from '../components/icons/CameraIcon';
import SettingsStorageOptionsPanel from '../components/SettingsStorageOptionsPanel';


type StatusMessage = {
    type: 'success' | 'error';
    message: string;
} | null;



const PROFILE_BADGE_STORAGE_KEY = 'owner-selected-badge-id';

const FRAME_OPTIONS = [
    { value: 'classic', label: 'Classic Slate', ringClass: 'ring-2 ring-slate-400' },
    { value: 'aurora', label: 'Aurora Neon', ringClass: 'ring-2 ring-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.65)]' },
    { value: 'solar', label: 'Solar Flare', ringClass: 'ring-2 ring-orange-400 drop-shadow-[0_0_12px_rgba(251,146,60,0.65)]' },
    { value: 'emerald', label: 'Emerald Crest', ringClass: 'ring-2 ring-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.65)]' },
];

const SMTP_NOTIFICATION_OPTIONS = [
    {
        value: 'welcome_password',
        label: 'Welcome + password reset',
    },
    {
        value: 'task_notifications',
        label: 'Task + workflow alerts',
    },
    {
        value: 'achievement_notifications',
        label: 'Achievements + badges',
    },
    {
        value: 'reward_notifications',
        label: 'Rewards + product updates',
    },
    {
        value: 'system_alerts',
        label: 'System status + maintenance',
    },
    {
        value: 'support_notifications',
        label: 'Support requests + helpdesk',
    },
];

const HOSTINGER_SMTP_HOST = 'smtp.hostinger.com';
const HOSTINGER_SMTP_PORT = 587;
const HOSTINGER_SMTP_ENCRYPTION = 'tls';

const TEMPLATE_FALLBACKS: Record<string, { subject: string; body: string }> = {
    welcome_password: {
        subject: 'Welcome to Zea Play',
        body: 'Hello {{name}},\n\nWelcome to Zea Play! Your account is ready. Use the app to sign in and get started.',
    },
    task_notifications: {
        subject: 'Task update: {{task_title}}',
        body: 'Hi {{name}},\n\nA task was updated in your workflow. Open Zea Play to view the latest status.',
    },
    achievement_notifications: {
        subject: 'Achievement unlocked: {{achievement_name}}',
        body: 'Great work {{name}}!\n\nYou unlocked a new achievement. Check your profile for the details.',
    },
    reward_notifications: {
        subject: 'New rewards available',
        body: 'Hi {{name}},\n\nNew rewards and product updates are available. Open Zea Play to explore them.',
    },
    system_alerts: {
        subject: 'System status update',
        body: 'Heads up {{name}},\n\nHere is a system status update. Visit the status panel for more details.',
    },
    support_notifications: {
        subject: 'Support request received',
        body: 'Hi {{name}},\n\nWe received your support request. Our team will follow up shortly.',
    },
};

const HOSTINGER_PROFILE_TEMPLATES = [
    {
        name: 'Gatekeeper mailbox',
        username: 'gatekeeper@urlfactory.website',
        notification_types: ['welcome_password'],
    },
    {
        name: 'Support mailbox',
        username: 'support@urlfactory.website',
        notification_types: ['support_notifications'],
    },
    {
        name: 'Origin alerts',
        username: 'origin@zurlfactory.website',
        notification_types: ['task_notifications', 'achievement_notifications'],
    },
    {
        name: 'Updates & rewards',
        username: 'updates@urlfactory.website',
        notification_types: ['reward_notifications', 'system_alerts'],
    },
];

const AVAILABLE_OAUTH_SCOPES = [
    'tasks.read',
    'tasks.write',
    'notifications.send',
    'achievements.read',
    'rewards.manage',
    'n8n.trigger',
    'profile.read',
    'profile.write',
];

const OAUTH_SCOPE_DESCRIPTIONS: Record<string, string> = {
    'tasks.read': 'Read-only access to tasks, including metadata.',
    'tasks.write': 'Create and update tasks on behalf of the owner.',
    'notifications.send': 'Send notifications to workspace members.',
    'achievements.read': 'Read achievements and badge definitions.',
    'rewards.manage': 'Create, update, and retire rewards.',
    'n8n.trigger': 'Send signed webhook events to n8n workflows.',
    'profile.read': 'Read owner profile information.',
    'profile.write': 'Update owner profile and personalization settings.',
};

const ProfileSettings: React.FC = () => {
    const { user, updateUserInContext } = useAuth();
    const { theme, setTheme } = useTheme();

    const [loading, setLoading] = useState(true);
    const [departments, setDepartments] = useState<Department[]>([]);

    const [profileForm, setProfileForm] = useState({
        name: '',
        employerId: '',
        departmentId: '',
    });
    const [profileStatus, setProfileStatus] = useState<StatusMessage>(null);
    const [profileSubmitting, setProfileSubmitting] = useState(false);

    const [passwordForm, setPasswordForm] = useState({
        current: '',
        next: '',
        confirm: '',
    });
    const [passwordStatus, setPasswordStatus] = useState<StatusMessage>(null);
    const [passwordSubmitting, setPasswordSubmitting] = useState(false);

    const [collectedBadges, setCollectedBadges] = useState<Reward[]>([]);
    const [badgesLoading, setBadgesLoading] = useState(false);
    const [selectedBadgeId, setSelectedBadgeId] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return window.localStorage.getItem(PROFILE_BADGE_STORAGE_KEY) ?? '';
    });
    const [backupScope, setBackupScope] = useState<DataExportScope>(DataExportScope.ALL);
    const [importScope, setImportScope] = useState<DataExportScope>(DataExportScope.ALL);
    const [backupStatus, setBackupStatus] = useState<StatusMessage>(null);
    const [backupLoading, setBackupLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);

    const [resetOtpRequested, setResetOtpRequested] = useState(false);
    const [resetOtp, setResetOtp] = useState('');
    const [resetStatus, setResetStatus] = useState<StatusMessage>(null);
    const [resetLoading, setResetLoading] = useState(false);



    useEffect(() => {
        if (!user) {
            return;
        }

        setProfileForm({
            name: user.name ?? '',
            employerId: user.employerId ?? '',
            departmentId: user.departmentId ?? '',
        });

    }, [user]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (selectedBadgeId) {
            window.localStorage.setItem(PROFILE_BADGE_STORAGE_KEY, selectedBadgeId);
        } else {
            window.localStorage.removeItem(PROFILE_BADGE_STORAGE_KEY);
        }
    }, [selectedBadgeId]);



    useEffect(() => {
        let isMounted = true;

        const hydrateBadges = async () => {
            if (!user?.claimedRewardIds || user.claimedRewardIds.length === 0) {
                if (isMounted) {
                    setCollectedBadges([]);
                    setBadgesLoading(false);
                    setSelectedBadgeId('');
                }
                return;
            }

            setBadgesLoading(true);
            try {
                const activeRewards = await api.getRewards();
                const rewardMap = new Map((activeRewards ?? []).map((reward) => [reward.id, reward]));
                const claimedIds = user.claimedRewardIds ?? [];
                const missingIds = claimedIds.filter((id) => !rewardMap.has(id));
                const missingRewards = await Promise.all(
                    missingIds.map(async (rewardId) => {
                        try {
                            return await api.getReward(rewardId);
                        } catch {
                            return null;
                        }
                    }),
                );
                missingRewards.filter(Boolean).forEach((reward) => {
                    if (reward) {
                        rewardMap.set(reward.id, reward);
                    }
                });
                if (!isMounted) {
                    return;
                }
                const orderedBadges = claimedIds
                    .map((id) => rewardMap.get(id))
                    .filter((reward): reward is Reward => Boolean(reward));
                setCollectedBadges(orderedBadges);
                setSelectedBadgeId((current) => {
                    if (orderedBadges.length === 0) {
                        return '';
                    }
                    if (current && orderedBadges.some((badge) => badge.id === current)) {
                        return current;
                    }
                    const stored =
                        typeof window === 'undefined' ? '' : window.localStorage.getItem(PROFILE_BADGE_STORAGE_KEY) ?? '';
                    if (stored && orderedBadges.some((badge) => badge.id === stored)) {
                        return stored;
                    }
                    return orderedBadges[0]?.id ?? '';
                });
            } catch (error) {
                console.error('Failed to load profile badges', error);
                if (isMounted) {
                    setCollectedBadges([]);
                }
            } finally {
                if (isMounted) {
                    setBadgesLoading(false);
                }
            }
        };

        void hydrateBadges();
        return () => {
            isMounted = false;
        };
    }, [user?.claimedRewardIds]);

    useEffect(() => {
        if (!user) {
            return;
        }

        const load = async () => {
            setLoading(true);
            try {
                const deptData = await api.getDepartments();
                setDepartments(deptData);
            } catch (error) {
                console.error('Failed to load owner settings', error);
                setProfileStatus({
                    type: 'error',
                    message: 'We could not load all owner settings. Please refresh.',
                });
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, [user?.id]);



    const departmentOptions = useMemo(
        () =>
            departments
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((dept) => ({ value: dept.id, label: dept.name })),
        [departments],
    );

    const selectedBadge = useMemo(
        () => collectedBadges.find((badge) => badge.id === selectedBadgeId) ?? null,
        [collectedBadges, selectedBadgeId],
    );


    const handleProfileChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = event.target;
        setProfileForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!user) {
            return;
        }

        setProfileSubmitting(true);
        setProfileStatus(null);

        try {
            const updated = await api.updateCurrentUserProfile(user.id, {
                name: profileForm.name.trim(),
                employerId: profileForm.employerId.trim(),
                department: departments.find((dept) => dept.id === profileForm.departmentId)?.name ?? '',
            });
            updateUserInContext(updated);
            setProfileStatus({
                type: 'success',
                message: 'Profile information updated successfully.',
            });
        } catch (error) {
            console.error('Profile update failed', error);
            setProfileStatus({
                type: 'error',
                message: 'Updating your profile failed. Please try again.',
            });
        } finally {
            setProfileSubmitting(false);
        }
    };

    const isColorfulThemeEnabled =
        ((import.meta.env.VITE_ENABLE_COLORFUL_THEME ?? 'false').trim().toLowerCase() === 'true');
    const themeOptions = (isColorfulThemeEnabled
        ? (['light', 'dark', 'colorful', 'system'] as const)
        : (['light', 'dark', 'system'] as const));

    const handleThemeChange = (value: 'light' | 'dark' | 'colorful' | 'system') => {
        if (value === 'colorful' && !isColorfulThemeEnabled) {
            setTheme('light');
            return;
        }
        setTheme(value);
    };

    const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!user) {
            return;
        }

        setPasswordStatus(null);

        const validation = passwordError(passwordForm.next, passwordForm.confirm);
        if (validation) {
            setPasswordStatus({
                type: 'error',
                message: validation,
            });
            return;
        }

        setPasswordSubmitting(true);
        try {
            await api.changeCurrentUserPassword(user.id, passwordForm.current, passwordForm.next);
            setPasswordStatus({
                type: 'success',
                message: 'Password updated. New credentials are active immediately.',
            });
            setPasswordForm({ current: '', next: '', confirm: '' });
        } catch (error) {
            console.error('Password update failed', error);
            setPasswordStatus({
                type: 'error',
                message: 'Password update failed. Verify your current password and try again.',
            });
        } finally {
            setPasswordSubmitting(false);
        }
    };

    const csvEscape = (value: unknown): string => {
        if (value === null || value === undefined) {
            return '';
        }
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        const escaped = stringValue.replace(/"/g, '""');
        if (/[",\n\r]/.test(escaped)) {
            return `"${escaped}"`;
        }
        return escaped;
    };

    const toCsv = (rows: Array<Record<string, unknown>>, columns?: string[]): string => {
        if (rows.length === 0) {
            return '';
        }
        const header = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
        const lines = [header.join(',')];
        rows.forEach((row) => {
            lines.push(header.map((key) => csvEscape(row[key])).join(','));
        });
        return lines.join('\n');
    };

    const downloadCsv = (filename: string, content: string) => {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(downloadLink.href);
    };

    const parseCsv = (text: string) => {
        const rows: string[][] = [];
        let row: string[] = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            if (inQuotes) {
                if (char === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += char;
                }
            } else if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(field);
                field = '';
            } else if (char === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else if (char !== '\r') {
                field += char;
            }
        }

        if (field.length > 0 || row.length > 0) {
            row.push(field);
            rows.push(row);
        }

        const headers = rows.shift() ?? [];
        return { headers, rows };
    };

    const parseCsvRecords = (text: string) => {
        const { headers, rows } = parseCsv(text);
        return rows.map((row) => {
            const record: Record<string, string> = {};
            headers.forEach((header, index) => {
                record[header] = row[index] ?? '';
            });
            return record;
        });
    };

    const parseNumber = (value: string, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const parseNullableNumber = (value: string) => {
        if (!value || value.toLowerCase() === 'null') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const parseNullableString = (value: string) => {
        if (!value || value.toLowerCase() === 'null') {
            return null;
        }
        return value;
    };

    const parseJsonArray = <T,>(value: string): T[] => {
        if (!value) {
            return [];
        }
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch {
            return [];
        }
    };

    const parseJsonValue = <T,>(value: string, fallback: T): T => {
        if (!value) {
            return fallback;
        }
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    };

    type ImportUser = NonNullable<DataImportPayload['users']>[number];
    type ImportTask = NonNullable<DataImportPayload['tasks']>[number];
    type ImportAchievement = NonNullable<DataImportPayload['achievements']>[number];
    type ImportNotification = NonNullable<DataImportPayload['notifications']>[number];
    type ImportUserReward = NonNullable<DataImportPayload['userRewards']>[number];

    const inferCsvDataset = (filename: string) => {
        const lower = filename.toLowerCase();
        if (lower.includes('user-rewards')) return 'user-rewards';
        if (lower.includes('user-achievements')) return 'user-achievements';
        if (lower.includes('kanban-columns')) return 'kanban-columns';
        if (lower.includes('achievements')) return 'achievements';
        if (lower.includes('notifications')) return 'notifications';
        if (lower.includes('rewards')) return 'rewards';
        if (lower.includes('departments')) return 'departments';
        if (lower.includes('tasks')) return 'tasks';
        if (lower.includes('users')) return 'users';
        return null;
    };

    const parseDepartments = (records: Array<Record<string, string>>): Department[] =>
        records
            .filter((record) => record.id && record.name)
            .map((record) => ({
                id: record.id,
                name: record.name,
            }));

    const parseUsers = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.email)
            .map((record) => ({
                id: record.id,
                name: record.name,
                email: record.email,
                role: record.role as ImportUser['role'],
                status: record.status as ImportUser['status'],
                departmentId: parseNullableString(record.departmentId) ?? null,
                points: parseNumber(record.points),
                tasksCreated: parseNumber(record.tasksCreated),
                tasksCompleted: parseNumber(record.tasksCompleted),
                clarityScores: parseJsonArray<number>(record.clarityScores),
                claimedRewardIds: parseJsonArray<string>(record.claimedRewardIds),
                unlockedAchievementIds: parseJsonArray<string>(record.unlockedAchievementIds),
                hashedPassword: record.hashedPassword,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
            }));

    const parseTasks = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.title)
            .map((record) => {
                const assignedToIds = parseJsonArray<string>(record.assignedToIds);
                return {
                    id: record.id,
                    title: record.title,
                    description: record.description,
                    status: record.status as ImportTask['status'],
                    priority: record.priority as ImportTask['priority'],
                    team: record.team,
                    assignedToIds: assignedToIds.length > 0 ? assignedToIds : null,
                    taskGroupId: record.taskGroupId,
                    createdById: record.createdById,
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt,
                    dueAt: parseNullableString(record.dueAt),
                    completedAt: parseNullableString(record.completedAt),
                    recurrenceRule: record.recurrenceRule as ImportTask['recurrenceRule'],
                    recurringTaskId: parseNullableString(record.recurringTaskId),
                    clarityRating: parseNullableNumber(record.clarityRating),
                    attachments: parseJsonArray<string>(record.attachments),
                    estimatedHours: parseNullableNumber(record.estimatedHours),
                    tags: parseJsonArray<string>(record.tags),
                    subtasks: parseJsonValue(record.subtasks, []),
                    comments: parseJsonValue(record.comments, []),
                    dependencies: parseJsonArray<string>(record.dependencies),
                };
            });

    const parseAchievements = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.title)
            .map((record) => ({
                id: record.id,
                title: record.title,
                description: record.description,
                points: parseNumber(record.points),
                icon: record.icon as ImportAchievement['icon'],
                imageUrl: parseNullableString(record.imageUrl),
                custom: record.custom === 'true' || record.custom === '1',
            }));

    const parseRewards = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.title)
            .map((record) => ({
                id: record.id,
                title: record.title,
                description: record.description,
                imageSource: record.imageSource as Reward['imageSource'],
                imageRef: parseNullableString(record.imageRef),
                imageUrl: parseNullableString(record.imageUrl),
                xpRequired: parseNumber(record.xpRequired),
                deptWhitelist: parseJsonArray<string>(record.deptWhitelist),
                autoRedeem: record.autoRedeem === 'true' || record.autoRedeem === '1',
                allowMultipleClaims: record.allowMultipleClaims === 'true' || record.allowMultipleClaims === '1',
                expiresAt: parseNullableString(record.expiresAt),
                status: record.status as Reward['status'],
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                createdById: parseNullableString(record.createdById),
                updatedById: parseNullableString(record.updatedById),
            }));

    const parseKanbanColumns = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.title)
            .map((record) => ({
                id: record.id,
                title: record.title,
                order: parseNumber(record.order),
            }));

    const parseNotifications = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.userId)
            .map((record) => ({
                id: record.id,
                userId: record.userId,
                type: record.type as ImportNotification['type'],
                message: record.message,
                isRead: record.isRead === 'true' || record.isRead === '1',
                relatedTaskId: parseNullableString(record.relatedTaskId),
                relatedRewardId: parseNullableString(record.relatedRewardId),
                relatedChatId: parseNullableString(record.relatedChatId),
                createdAt: record.createdAt,
            }));

    const parseUserRewards = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.id && record.userId)
            .map((record) => ({
                id: record.id,
                userId: record.userId,
                rewardId: record.rewardId,
                status: record.status as ImportUserReward['status'],
                xpSpent: parseNumber(record.xpSpent),
                claimedAt: record.claimedAt,
                resolvedAt: parseNullableString(record.resolvedAt),
                approverId: parseNullableString(record.approverId),
            }));

    const parseUserAchievements = (records: Array<Record<string, string>>) =>
        records
            .filter((record) => record.userId && record.achievementId)
            .map((record) => ({
                userId: record.userId,
                achievementId: record.achievementId,
                unlockedAt: record.unlockedAt,
            }));

    const handleExport = async () => {
        setBackupLoading(true);
        setBackupStatus(null);
        try {
            const bundle = await api.exportData(backupScope);
            const exportStamp = new Date().toISOString();
            const files: Array<{ name: string; content: string }> = [];

            const pushFile = (suffix: string, rows: Array<Record<string, unknown>>) => {
                if (rows.length === 0) {
                    return;
                }
                const content = toCsv(rows);
                if (!content) {
                    return;
                }
                files.push({
                    name: `zea-backup-${backupScope}-${suffix}-${exportStamp}.csv`,
                    content,
                });
            };

            const departmentRows = (bundle.departments ?? []).map((dept) => ({
                id: dept.id,
                name: dept.name,
            }));
            const userRows = (bundle.users ?? []).map((user) => ({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                departmentId: user.departmentId ?? '',
                points: user.points,
                tasksCreated: user.tasksCreated,
                tasksCompleted: user.tasksCompleted,
                clarityScores: JSON.stringify(user.clarityScores ?? []),
                claimedRewardIds: JSON.stringify(user.claimedRewardIds ?? []),
                unlockedAchievementIds: JSON.stringify(user.unlockedAchievementIds ?? []),
                hashedPassword: user.hashedPassword,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            }));
            const taskRows = (bundle.tasks ?? []).map((task) => ({
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                team: task.team,
                assignedToIds: task.assignedToIds ? JSON.stringify(task.assignedToIds) : '',
                taskGroupId: task.taskGroupId ?? '',
                createdById: task.createdById,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                dueAt: task.dueAt ?? '',
                completedAt: task.completedAt ?? '',
                recurrenceRule: task.recurrenceRule,
                recurringTaskId: task.recurringTaskId ?? '',
                clarityRating: task.clarityRating ?? '',
                attachments: JSON.stringify(task.attachments ?? []),
                estimatedHours: task.estimatedHours ?? '',
                tags: JSON.stringify(task.tags ?? []),
                subtasks: JSON.stringify(task.subtasks ?? []),
                comments: JSON.stringify(task.comments ?? []),
                dependencies: JSON.stringify(task.dependencies ?? []),
            }));

            const achievementRows = (bundle.achievements ?? []).map((achievement) => ({
                id: achievement.id,
                title: achievement.title,
                description: achievement.description,
                points: achievement.points,
                icon: achievement.icon,
                imageUrl: achievement.imageUrl ?? '',
                custom: achievement.custom ?? false,
            }));

            const rewardRows = (bundle.rewards ?? []).map((reward) => ({
                id: reward.id,
                title: reward.title,
                description: reward.description,
                imageSource: reward.imageSource,
                imageRef: reward.imageRef ?? '',
                imageUrl: reward.imageUrl ?? '',
                xpRequired: reward.xpRequired,
                deptWhitelist: JSON.stringify(reward.deptWhitelist ?? []),
                autoRedeem: reward.autoRedeem,
                allowMultipleClaims: reward.allowMultipleClaims,
                expiresAt: reward.expiresAt ?? '',
                status: reward.status,
                createdAt: reward.createdAt,
                updatedAt: reward.updatedAt,
                createdById: reward.createdById ?? '',
                updatedById: reward.updatedById ?? '',
            }));

            const kanbanRows = (bundle.kanbanColumns ?? []).map((column) => ({
                id: column.id,
                title: column.title,
                order: column.order,
            }));

            const notificationRows = (bundle.notifications ?? []).map((notification) => ({
                id: notification.id,
                userId: notification.userId,
                type: notification.type,
                message: notification.message,
                isRead: notification.isRead,
                relatedTaskId: notification.relatedTaskId ?? '',
                relatedRewardId: notification.relatedRewardId ?? '',
                relatedChatId: notification.relatedChatId ?? '',
                createdAt: notification.createdAt,
            }));

            const userRewardRows = (bundle.userRewards ?? []).map((reward) => ({
                id: reward.id,
                userId: reward.userId,
                rewardId: reward.rewardId,
                status: reward.status,
                xpSpent: reward.xpSpent,
                claimedAt: reward.claimedAt,
                resolvedAt: reward.resolvedAt ?? '',
                approverId: reward.approverId ?? '',
            }));

            const userAchievementRows = (bundle.userAchievements ?? []).map((achievement) => ({
                userId: achievement.userId,
                achievementId: achievement.achievementId,
                unlockedAt: achievement.unlockedAt,
            }));

            if (backupScope === DataExportScope.DEPARTMENTS) {
                pushFile('departments', departmentRows);
            } else if (backupScope === DataExportScope.USERS) {
                pushFile('departments', departmentRows);
                pushFile('users', userRows);
            } else if (backupScope === DataExportScope.TASKS) {
                pushFile('tasks', taskRows);
                pushFile('kanban-columns', kanbanRows);
            } else {
                pushFile('departments', departmentRows);
                pushFile('users', userRows);
                pushFile('tasks', taskRows);
                pushFile('achievements', achievementRows);
                pushFile('rewards', rewardRows);
                pushFile('kanban-columns', kanbanRows);
                pushFile('notifications', notificationRows);
                pushFile('user-rewards', userRewardRows);
                pushFile('user-achievements', userAchievementRows);
            }

            files.forEach((file) => downloadCsv(file.name, file.content));
            setBackupStatus({
                type: 'success',
                message:
                    files.length > 1
                        ? `Export complete. ${files.length} CSV files downloaded.`
                        : 'Export complete. Check your downloads for the CSV file.',
            });
        } catch (error) {
            console.error('Data export failed', error);
            setBackupStatus({
                type: 'error',
                message: 'Export failed. Please confirm your admin session is active and retry.',
            });
        } finally {
            setBackupLoading(false);
        }
    };

    const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) {
            return;
        }

        setImportLoading(true);
        setBackupStatus(null);

        try {
            const hasJson = files.some((file) => file.name.toLowerCase().endsWith('.json'));
            let payload: DataImportPayload;

            if (hasJson) {
                if (files.length > 1) {
                    throw new Error('Please select a single JSON backup file.');
                }
                const fileContent = await files[0].text();
                payload = JSON.parse(fileContent) as DataImportPayload;
            } else {
                payload = { scope: importScope };
                let loadedAny = false;

                for (const file of files) {
                    const fileContent = await file.text();
                    const records = parseCsvRecords(fileContent);
                    const dataset = inferCsvDataset(file.name);

                    if (importScope === DataExportScope.ALL && !dataset) {
                        throw new Error('Could not infer CSV type. Use the exported file names for full imports.');
                    }

                    const target = dataset ?? importScope;

                    if (target === 'departments') {
                        payload.departments = parseDepartments(records);
                        loadedAny = true;
                    } else if (target === 'users') {
                        payload.users = parseUsers(records);
                        loadedAny = true;
                    } else if (target === 'tasks') {
                        payload.tasks = parseTasks(records);
                        loadedAny = true;
                    } else if (target === 'achievements') {
                        payload.achievements = parseAchievements(records);
                        loadedAny = true;
                    } else if (target === 'rewards') {
                        payload.rewards = parseRewards(records);
                        loadedAny = true;
                    } else if (target === 'kanban-columns') {
                        payload.kanbanColumns = parseKanbanColumns(records);
                        loadedAny = true;
                    } else if (target === 'notifications') {
                        payload.notifications = parseNotifications(records);
                        loadedAny = true;
                    } else if (target === 'user-rewards') {
                        payload.userRewards = parseUserRewards(records);
                        loadedAny = true;
                    } else if (target === 'user-achievements') {
                        payload.userAchievements = parseUserAchievements(records);
                        loadedAny = true;
                    }
                }

                if (!loadedAny) {
                    throw new Error('No supported CSV data detected for import.');
                }

                if (
                    importScope === DataExportScope.ALL &&
                    (!payload.departments?.length || !payload.users?.length || !payload.tasks?.length)
                ) {
                    throw new Error('Full workspace imports need departments, users, and tasks CSV files.');
                }
            }

            await api.importData(payload);
            setBackupStatus({
                type: 'success',
                message: 'Import completed. Refresh dashboards to review the restored data.',
            });
        } catch (error) {
            console.error('Data import failed', error);
            setBackupStatus({
                type: 'error',
                message: 'Import failed. Verify the backup file and try again.',
            });
        } finally {
            setImportLoading(false);
            event.target.value = '';
        }
    };

    const handleResetRequest = async () => {
        setResetLoading(true);
        setResetStatus(null);
        try {
            await api.requestFullResetOtp();
            setResetOtpRequested(true);
            setResetStatus({
                type: 'success',
                message: 'OTP sent to the owner mailbox. Enter it below to confirm.',
            });
        } catch (error) {
            console.error('Reset OTP request failed', error);
            setResetStatus({
                type: 'error',
                message: 'We could not send an OTP. Confirm SMTP is configured and try again.',
            });
        } finally {
            setResetLoading(false);
        }
    };

    const handleResetConfirm = async () => {
        if (!resetOtp.trim()) {
            setResetStatus({
                type: 'error',
                message: 'Enter the OTP delivered to the owner email address.',
            });
            return;
        }

        setResetLoading(true);
        setResetStatus(null);
        try {
            await api.confirmFullReset(resetOtp.trim());
            setResetStatus({
                type: 'success',
                message: 'Full workspace reset complete.',
            });
            setResetOtp('');
            setResetOtpRequested(false);
        } catch (error) {
            console.error('Reset confirmation failed', error);
            setResetStatus({
                type: 'error',
                message: 'Reset failed. Ensure the OTP is correct and not expired.',
            });
        } finally {
            setResetLoading(false);
        }
    };


    if (!user) {
        return (
            <div className="p-10">
                <p className="text-text-secondary">Sign in to manage your settings.</p>
            </div>
        );
    }

    if (loading) {
        return <PageLoader />;
    }

    return (
        <div className="space-y-8 pb-12">
            <section className="space-y-8">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="bg-surface border border-border-color rounded-xl p-6 space-y-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <UserIcon className="h-6 w-6 text-primary" />
                                <h2 className="text-lg font-semibold text-text-primary">Profile information</h2>
                            </div>
                            {profileStatus && (
                                <StatusBanner status={profileStatus} />
                            )}
                            <ProfileInformationForm user={user} departments={departments} onSaved={updateUserInContext} />
                        </div>

                        <div className="bg-surface border border-border-color rounded-xl p-6 space-y-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <ShieldCheckIcon className="h-6 w-6 text-primary" />
                                <h2 className="text-lg font-semibold text-text-primary">Theme & badge</h2>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-text-secondary">Theme preset</p>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    {themeOptions.map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            onClick={() => handleThemeChange(option)}
                                            className={`rounded-lg border px-4 py-3 text-left transition ${
                                                theme === option
                                                    ? 'bg-primary text-white border-transparent shadow'
                                                    : 'border-border-color text-text-secondary hover:border-primary/40 hover:text-text-primary'
                                            }`}
                                        >
                                            <p className="text-sm font-semibold capitalize">{option}</p>
                                            <p className="text-xs opacity-80">
                                                {option === 'system'
                                                    ? 'Match device preference dynamically.'
                                                    : `Force ${option} mode across the workspace.`}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-text-secondary">Profile badge</p>
                                {badgesLoading ? (
                                    <p className="mt-3 text-sm text-text-secondary">Loading your badges…</p>
                                ) : collectedBadges.length > 0 ? (
                                    <div className="mt-3 grid grid-cols-1 gap-3">
                                        {collectedBadges.map((badgeOption) => (
                                            <button
                                                key={badgeOption.id}
                                                onClick={() => setSelectedBadgeId(badgeOption.id)}
                                                type="button"
                                                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                                    selectedBadgeId === badgeOption.id
                                                        ? 'border-primary bg-primary/10 text-primary'
                                                        : 'border-border-color text-text-secondary hover:border-primary/40 hover:text-text-primary'
                                                }`}
                                            >
                                                <div className="h-12 w-12 overflow-hidden rounded-xl border border-border-color/70 bg-background">
                                                    {badgeOption.imageUrl ? (
                                                        <img src={badgeOption.imageUrl} alt={badgeOption.title} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center">
                                                            <GiftIcon className="h-5 w-5 text-text-secondary" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold">{badgeOption.title}</p>
                                                    <p className="text-xs opacity-80">{badgeOption.description}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-3 text-sm text-text-secondary">
                                        Claim a badge from the Achievements page to equip it here.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <div className="bg-surface border border-border-color rounded-xl p-6 space-y-4 shadow-sm">
                            <div className="flex items-center gap-3">
                                <CameraIcon className="h-6 w-6 text-primary" />
                                <h2 className="text-lg font-semibold text-text-primary">Profile media</h2>
                            </div>
                            <ProfileMediaEditor user={user} onSaved={updateUserInContext} />
                        </div>

                        <div className="bg-surface border border-border-color rounded-xl p-6 space-y-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <LockClosedIcon className="h-6 w-6 text-primary" />
                                <h2 className="text-lg font-semibold text-text-primary">Password reset</h2>
                            </div>
                            {passwordStatus && (
                                <StatusBanner status={passwordStatus} />
                            )}
                            <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                                <div>
                                    <label className="text-sm font-medium text-text-secondary">Current password</label>
                                    <input
                                        type="password"
                                        value={passwordForm.current}
                                        onChange={(event) => setPasswordForm((prev) => ({ ...prev, current: event.target.value }))}
                                        className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                        required
                                    />
                                </div>
                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-sm font-medium text-text-secondary">New password</label>
                                        <input
                                            type="password"
                                            value={passwordForm.next}
                                            onChange={(event) => setPasswordForm((prev) => ({ ...prev, next: event.target.value }))}
                                            className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-text-secondary">Confirm password</label>
                                        <input
                                            type="password"
                                            value={passwordForm.confirm}
                                            onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm: event.target.value }))}
                                            className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                            required
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    disabled={passwordSubmitting}
                                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    {passwordSubmitting ? 'Updating...' : 'Update password'}
                                </button>
                            </form>
                        </div>

                    </div>

                    <SettingsStorageOptionsPanel userRole={user.role} />

                    <div className="bg-surface border border-border-color rounded-xl p-6 space-y-6 shadow-sm">
                        <div className="flex items-center gap-3">
                            <ShieldCheckIcon className="h-6 w-6 text-primary" />
                            <h2 className="text-lg font-semibold text-text-primary">Data backup & maintenance</h2>
                        </div>
                        {backupStatus && (
                            <StatusBanner status={backupStatus} />
                        )}
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Export</h3>
                                <p className="text-sm text-text-secondary">
                                    Export structured CSV files for safe storage or migration. Owner credentials are excluded.
                                </p>
                                <div>
                                    <label className="text-sm font-medium text-text-secondary">Scope</label>
                                    <select
                                        value={backupScope}
                                        onChange={(event) => setBackupScope(event.target.value as DataExportScope)}
                                        className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                    >
                                        <option value={DataExportScope.ALL}>Entire workspace</option>
                                        <option value={DataExportScope.USERS}>Only users</option>
                                        <option value={DataExportScope.TASKS}>Only tasks</option>
                                        <option value={DataExportScope.DEPARTMENTS}>Only departments</option>
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleExport}
                                    disabled={backupLoading}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    <span>{backupLoading ? 'Preparing export...' : 'Download backup'}</span>
                                </button>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Import</h3>
                                <p className="text-sm text-text-secondary">
                                    Restore a previous backup. Existing data for imported scopes will be updated or replaced.
                                </p>
                                <div>
                                    <label className="text-sm font-medium text-text-secondary">Scope</label>
                                    <select
                                        value={importScope}
                                        onChange={(event) => setImportScope(event.target.value as DataExportScope)}
                                        className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                    >
                                        <option value={DataExportScope.ALL}>Entire workspace</option>
                                        <option value={DataExportScope.USERS}>Only users</option>
                                        <option value={DataExportScope.TASKS}>Only tasks</option>
                                        <option value={DataExportScope.DEPARTMENTS}>Only departments</option>
                                    </select>
                                </div>
                                <label className="block">
                                    <span className="text-sm text-text-secondary">Backup file (.csv or .json)</span>
                                    <input
                                        type="file"
                                        accept=".csv,application/json"
                                        onChange={handleImport}
                                        multiple={importScope === DataExportScope.ALL}
                                        className="mt-1 block w-full text-sm text-text-secondary file:mr-4 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-primary file:font-medium hover:file:bg-primary/20"
                                    />
                                </label>
                                {importLoading && <p className="text-xs text-text-secondary">Importing backup...</p>}
                            </div>
                        </div>
                        <div className="rounded-lg border border-border-color bg-muted/40 p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                                <div>
                                    <p className="text-sm font-semibold text-text-primary">Full workspace reset</p>
                                    <p className="text-xs text-text-secondary">
                                        Wipe achievements, tasks, notifications, and departments. Owner account remains intact.
                                    </p>
                                </div>
                            </div>
                            {resetStatus && (
                                <StatusBanner status={resetStatus} />
                            )}
                            {!resetOtpRequested ? (
                                <button
                                    type="button"
                                    onClick={handleResetRequest}
                                    disabled={resetLoading}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-500 text-white font-medium hover:from-rose-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    {resetLoading ? 'Sending OTP...' : 'Send OTP to owner email'}
                                </button>
                            ) : (
                                <div className="flex flex-wrap items-center gap-3">
                                    <input
                                        type="text"
                                        value={resetOtp}
                                        onChange={(event) => setResetOtp(event.target.value)}
                                        placeholder="Enter 6-digit OTP"
                                        className="rounded-md border border-border-color bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none"
                                        maxLength={6}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleResetConfirm}
                                        disabled={resetLoading}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-500 text-white font-medium hover:from-rose-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                    >
                                        {resetLoading ? 'Resetting...' : 'Confirm full reset'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setResetOtp('');
                                            setResetOtpRequested(false);
                                            setResetStatus(null);
                                        }}
                                        className="text-sm text-text-secondary hover:text-text-primary"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
            </section>


        </div>
    );
};

const StatusBanner: React.FC<{ status: StatusMessage }> = ({ status }) => {
    if (!status) return null;
    const Icon = status.type === 'success' ? CheckCircleIcon : ExclamationTriangleIcon;
    const classes =
        status.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40'
            : 'bg-amber-500/10 text-amber-500 border-amber-500/40';

    return (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${classes}`}>
            <Icon className="h-5 w-5 mt-0.5" />
            <span>{status.message}</span>
        </div>
    );
};

const CredentialRow: React.FC<{
    label: string;
    value?: string;
    obfuscate?: boolean;
    onCopy?: () => void;
}> = ({ label, value, obfuscate = false, onCopy }) => (
    <div>
        <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">{label}</p>
        {value ? (
            <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary break-all">
                    {obfuscate ? `${value.slice(0, 4)}****${value.slice(-4)}` : value}
                </span>
                {onCopy && (
                    <button
                        type="button"
                        onClick={onCopy}
                        className="text-xs text-primary hover:underline"
                    >
                        Copy
                    </button>
                )}
            </div>
        ) : (
            <span className="text-xs text-text-secondary">Not generated yet.</span>
        )}
    </div>
);

export default ProfileSettings;
