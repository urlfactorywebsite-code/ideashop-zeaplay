
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GoogleGenAI } from '@google/genai';
import { 
    LineChart, 
    Line, 
    XAxis, 
    YAxis, 
    Tooltip, 
    ResponsiveContainer 
} from 'recharts';
import { Task, User, Role, TaskStatus, CUSTOM_STATUS_NAMES } from '../types';
import { useAuth } from '../hooks/useAuth';
import api from '../services/mockApi';
import { withGeminiKey } from '../utils/geminiClient';
import { formatDate } from '../utils';
import PageLoader from '../components/loading/PageLoader';

const StatCard: React.FC<{ title: string; value: number | string; delta?: string }> = ({ title, value, delta }) => (
    <div className="bg-surface p-6 rounded-lg border border-border-color">
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider">{title}</h3>
        <p className="mt-2 text-3xl font-semibold text-text-primary">{value}</p>
        {delta && <p className="text-xs text-text-secondary mt-1">{delta}</p>}
    </div>
);

const BarChart: React.FC<{ data: { label: string, value: number }[], title: string }> = ({ data, title }) => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    return (
        <div className="bg-surface p-6 rounded-lg border border-border-color">
            <h3 className="text-lg font-semibold text-text-primary mb-4">{title}</h3>
            <div className="space-y-2">
                {data.length > 0 ? data.map(item => {
                    const percentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
                    return (
                        <div key={item.label} className="flex items-center">
                            <span className="w-28 text-sm text-text-secondary truncate">{item.label}</span>
                            <div className="flex-1 bg-gray-700 rounded-full h-4 mr-2">
                                <div
                                    className="bg-primary h-4 rounded-full"
                                    style={{ width: `${percentage}%` }}
                                ></div>
                            </div>
                            <span className="text-sm font-semibold">{item.value}</span>
                        </div>
                    );
                }) : <p className="text-text-secondary text-sm">No data to display for the current filters.</p>}
            </div>
        </div>
    );
};

const normalizeDepartmentKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const startOfDay = (value: Date): Date => {
    const copy = new Date(value);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const endOfDay = (value: Date): Date => {
    const copy = new Date(value);
    copy.setHours(23, 59, 59, 999);
    return copy;
};

const resolvePeriodRange = (period: string, referenceDate: string, customStart: string, customEnd: string): { start?: Date; end?: Date } => {
    if (period === 'all') {
        return {};
    }

    if (period === 'custom') {
        if (!customStart || !customEnd) {
            return {};
        }
        const start = startOfDay(new Date(customStart));
        const end = endOfDay(new Date(customEnd));
        return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? {} : { start, end };
    }

    const reference = referenceDate ? new Date(referenceDate) : new Date();
    if (Number.isNaN(reference.getTime())) {
        return {};
    }

    if (period === 'daily') {
        return { start: startOfDay(reference), end: endOfDay(reference) };
    }

    if (period === 'weekly') {
        const day = reference.getDay();
        const diff = (day + 6) % 7;
        const start = startOfDay(new Date(reference));
        start.setDate(reference.getDate() - diff);
        const end = endOfDay(new Date(start));
        end.setDate(start.getDate() + 6);
        return { start, end };
    }

    if (period === 'monthly') {
        const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
        const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
        return { start: startOfDay(start), end: endOfDay(end) };
    }

    return {};
};

const formatCsvValue = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (filename: string, rows: Array<Array<string | number | null | undefined>>): void => {
    if (typeof window === 'undefined') {
        return;
    }
    const content = rows.map((row) => row.map(formatCsvValue).join(',')).join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.click();
    window.URL.revokeObjectURL(url);
};

const Reports: React.FC = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [departments, setDepartments] = useState<string[]>([]);
    const [loadingData, setLoadingData] = useState(true);
    const [insight, setInsight] = useState('');
    const [insightLoading, setInsightLoading] = useState(false);
    const [error, setError] = useState('');

    // Filter states
    const [reportScope, setReportScope] = useState<'overall' | 'department' | 'person' | 'department_person' | 'detail'>('overall');
    const [dateRangeFilter, setDateRangeFilter] = useState('all'); // 'daily', 'weekly', 'monthly', 'custom', 'all'
    const [teamFilter, setTeamFilter] = useState('all');
    const [personFilter, setPersonFilter] = useState('all');
    const [taskTypeFilter, setTaskTypeFilter] = useState('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [referenceDate, setReferenceDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [reportGeneratedAt, setReportGeneratedAt] = useState<Date | null>(null);
    const [compareDeptA, setCompareDeptA] = useState('');
    const [compareDeptB, setCompareDeptB] = useState('');
    const [comparePersonA, setComparePersonA] = useState('');
    const [comparePersonB, setComparePersonB] = useState('');
    const [aiPeriod, setAiPeriod] = useState<'full' | 'today' | 'weekly' | 'monthly'>('full');
    const [aiDepartment, setAiDepartment] = useState('all');
    const [aiPerson, setAiPerson] = useState('all');

    const { user } = useAuth();

const RechartsLine: React.FC<{ 
    data: { period: string; created: number; completed?: number }[]; 
    title: string; 
    yKey: 'created' | 'completed';
}> = ({ data, title, yKey }) => (
    <motion.div
        className="bg-gradient-to-r from-purple-900 via-indigo-900 to-blue-900 p-6 rounded-lg border border-cyan-400/50 animate-saber-glow shadow-cyan-500/50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        <div className="w-full h-64">
            {data.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <XAxis dataKey="period" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip />
                        <Line 
                            type="monotone" 
                            dataKey={yKey} 
                            stroke="#60a5fa" 
                            strokeWidth={2}
                            dot={{ fill: '#60a5fa', strokeWidth: 2 }} 
                        />
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="flex items-center justify-center h-full">
                    <p className="text-gray-400">No data available for the selected period</p>
                </div>
            )}
        </div>
    </motion.div>
);

const fetchData = useCallback(async () => {
        if (user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role)) {
            setLoadingData(true);
            try {
                const [fetchedTasks, allUsers] = await Promise.all([
                    api.getTasks(user.id, user.role),
                    api.getUsers(),
                ]);
                setTasks(fetchedTasks);
                const map = new Map<string, User>();
                allUsers.forEach(u => map.set(u.id, u));
                setUsersMap(map);
                try {
                    const deptData = await api.getDepartments();
                    const departmentNames = Array.from(
                        new Set(
                            (deptData ?? [])
                                .map((dept) => dept.name)
                                .filter((name): name is string => Boolean(name)),
                        ),
                    ).sort((a, b) => a.localeCompare(b));
                    setDepartments(departmentNames);
                } catch (deptError) {
                    console.error('Failed to load departments for reports', deptError);
                    setDepartments([]);
                }
            } catch (err) {
                console.error("Failed to fetch report data:", err);
                setError("Could not load report data.");
            } finally {
                setLoadingData(false);
            }
        } else {
             setLoadingData(false);
        }
    }, [user]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const getAssigneeEntries = useCallback(
        (assigneeIds: string[] | null): Array<{ id: string | null; name: string; user?: User }> => {
            if (!assigneeIds || assigneeIds.length === 0) {
                return [{ id: null, name: 'Unassigned' }];
            }

            return assigneeIds.map((id) => {
                const assignee = usersMap.get(id);
                return { id, name: assignee?.name ?? 'Unknown', user: assignee };
            });
        },
        [usersMap]
    );

    const formatAssigneeNames = useCallback(
        (assigneeIds: string[] | null) => {
            if (!assigneeIds || assigneeIds.length === 0) {
                return 'Unassigned';
            }
            const names = assigneeIds
                .map((id) => usersMap.get(id)?.name ?? '')
                .filter((name) => name.length > 0);
            return names.length > 0 ? names.join(', ') : 'Unassigned';
        },
        [usersMap]
    );

    const availableDepartments = useMemo(() => {
        if (departments.length > 0) {
            return departments;
        }
        const uniqueTeams = Array.from(new Set(tasks.map((task) => task.team).filter(Boolean)));
        return uniqueTeams.sort((a, b) => a.localeCompare(b));
    }, [departments, tasks]);

    const availablePeople = useMemo(
        () => Array.from(usersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        [usersMap]
    );

    const periodRange = useMemo(
        () => resolvePeriodRange(dateRangeFilter, referenceDate, startDate, endDate),
        [dateRangeFilter, referenceDate, startDate, endDate]
    );

    const aiPeriodRange = useMemo(() => {
        const mapping: Record<string, string> = {
            full: 'all',
            today: 'daily',
            weekly: 'weekly',
            monthly: 'monthly',
        };
        const normalized = mapping[aiPeriod] ?? 'all';
        return resolvePeriodRange(normalized, new Date().toISOString().slice(0, 10), '', '');
    }, [aiPeriod]);

    const periodFilteredTasks = useMemo(() => {
        if (!periodRange.start || !periodRange.end) {
            return tasks;
        }
        return tasks.filter((task) => {
            const created = new Date(task.createdAt);
            return created >= periodRange.start! && created <= periodRange.end!;
        });
    }, [tasks, periodRange]);

    const baseFilteredTasks = useMemo(() => {
        if (taskTypeFilter === 'all') {
            return periodFilteredTasks;
        }
        return periodFilteredTasks.filter((task) => task.priority === taskTypeFilter);
    }, [periodFilteredTasks, taskTypeFilter]);

    const aiFilteredTasks = useMemo(() => {
        let scoped = tasks;
        if (aiPeriodRange.start && aiPeriodRange.end) {
            scoped = scoped.filter((task) => {
                const created = new Date(task.createdAt);
                return created >= aiPeriodRange.start! && created <= aiPeriodRange.end!;
            });
        }
        if (aiDepartment !== 'all') {
            const normalized = normalizeDepartmentKey(aiDepartment);
            scoped = scoped.filter((task) => normalizeDepartmentKey(task.team) === normalized);
        }
        if (aiPerson !== 'all') {
            scoped = scoped.filter((task) => task.assignedTo?.includes(aiPerson) || task.createdBy === aiPerson);
        }
        return scoped;
    }, [tasks, aiPeriodRange, aiDepartment, aiPerson]);

    const filteredTasks = useMemo(() => {
        let scoped = baseFilteredTasks;
        const useDepartment = reportScope === 'department' || reportScope === 'department_person' || reportScope === 'detail';
        const usePerson = reportScope === 'person' || reportScope === 'department_person' || reportScope === 'detail';

        if (useDepartment && teamFilter !== 'all') {
            const normalized = normalizeDepartmentKey(teamFilter);
            scoped = scoped.filter((task) => normalizeDepartmentKey(task.team) === normalized);
        }

        if (usePerson && personFilter !== 'all') {
            scoped = scoped.filter((task) => task.assignedTo?.includes(personFilter));
        }

        return scoped;
    }, [baseFilteredTasks, reportScope, teamFilter, personFilter]);

    const summarizeTasks = useCallback((items: Task[]) => {
        const total = items.length;
        const completed = items.filter((task) => task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED || task.status === TaskStatus.FAILED);
        const completedCount = completed.length;
        const onTimeCompleted = completed.filter(
            (task) => task.completedAt && task.dueAt && new Date(task.completedAt) <= new Date(task.dueAt)
        ).length;
        const completionRate = completedCount > 0 ? Math.round((onTimeCompleted / completedCount) * 100) : 0;
        const inProgress = items.filter((task) => task.status === TaskStatus.IN_PROGRESS).length;
        const overdue = items.filter((task) => task.status !== TaskStatus.DONE && task.status !== TaskStatus.DEPLOYED && task.dueAt && new Date(task.dueAt) < new Date()).length;
        const avgCompletionDays = (() => {
            const completedTasks = items.filter((task) => task.completedAt);
            if (completedTasks.length === 0) {
                return 0;
            }
            const totalDays = completedTasks.reduce((sum, task) => {
                const completedTime = new Date(task.completedAt as string).getTime();
                const createdTime = new Date(task.createdAt).getTime();
                return sum + (completedTime - createdTime) / (1000 * 60 * 60 * 24);
            }, 0);
            return Math.round((totalDays / completedTasks.length) * 10) / 10;
        })();

        return {
            total,
            completedCount,
            completionRate,
            inProgress,
            overdue,
            avgCompletionDays,
        };
    }, []);

    const reportLabel = useMemo(() => {
        const scopeLabel = reportScope.replace('_', '-');
        const periodLabel = dateRangeFilter;
        const deptLabel = teamFilter !== 'all' ? teamFilter : 'all-departments';
        const personLabel = personFilter !== 'all' ? usersMap.get(personFilter)?.name ?? personFilter : 'all-people';
        return `${scopeLabel}-${periodLabel}-${deptLabel}-${personLabel}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    }, [reportScope, dateRangeFilter, teamFilter, personFilter, usersMap]);

    const showDepartmentFilter = reportScope === 'department' || reportScope === 'department_person' || reportScope === 'detail';
    const showPersonFilter = reportScope === 'person' || reportScope === 'department_person' || reportScope === 'detail';

    const stats = useMemo(() => {
        const summary = summarizeTasks(filteredTasks);
        return {
            totalTasks: summary.total,
            completionRate: summary.completedCount > 0 ? `${summary.completionRate}%` : 'N/A',
            inProgressTasks: summary.inProgress,
            overdueTasks: summary.overdue,
        };
    }, [filteredTasks, summarizeTasks]);

    const emptySummary = useMemo(
        () => ({
            total: 0,
            completedCount: 0,
            completionRate: 0,
            inProgress: 0,
            overdue: 0,
            avgCompletionDays: 0,
        }),
        []
    );

    const departmentComparison = useMemo(() => {
        const leftTasks = compareDeptA
            ? baseFilteredTasks.filter((task) => normalizeDepartmentKey(task.team) === normalizeDepartmentKey(compareDeptA))
            : [];
        const rightTasks = compareDeptB
            ? baseFilteredTasks.filter((task) => normalizeDepartmentKey(task.team) === normalizeDepartmentKey(compareDeptB))
            : [];
        return {
            left: compareDeptA ? summarizeTasks(leftTasks) : emptySummary,
            right: compareDeptB ? summarizeTasks(rightTasks) : emptySummary,
        };
    }, [compareDeptA, compareDeptB, baseFilteredTasks, summarizeTasks, emptySummary]);

    const personComparison = useMemo(() => {
        const leftTasks = comparePersonA ? baseFilteredTasks.filter((task) => task.assignedTo?.includes(comparePersonA)) : [];
        const rightTasks = comparePersonB ? baseFilteredTasks.filter((task) => task.assignedTo?.includes(comparePersonB)) : [];
        return {
            left: comparePersonA ? summarizeTasks(leftTasks) : emptySummary,
            right: comparePersonB ? summarizeTasks(rightTasks) : emptySummary,
        };
    }, [comparePersonA, comparePersonB, baseFilteredTasks, summarizeTasks, emptySummary]);
    
    const workloadData = useMemo(() => {
        const counts = filteredTasks.reduce<Record<string, number>>((acc, task) => {
            const entries = getAssigneeEntries(task.assignedTo);
            entries.forEach(({ name }) => {
                acc[name] = (acc[name] || 0) + 1;
            });
            return acc;
        }, {});

        interface ChartDataItem { 
            label: string; 
            value: number; 
        }
        
        return Object.entries(counts)
            .map(([label, value]) => ({ 
                label, 
                value: value as number 
            }))
            .sort((a, b) => b.value - a.value);

    }, [filteredTasks, getAssigneeEntries]);

    const trendData = useMemo(() => {
        const periods: Record<string, {created: number, completed: number}> = {};
        filteredTasks.forEach(task => {
            const createdDate = new Date(task.createdAt);
            const period = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;
            if (!periods[period]) periods[period] = {created: 0, completed: 0};
            periods[period].created++;
            if (task.completedAt) {
                const completedDate = new Date(task.completedAt);
                const compPeriod = `${completedDate.getFullYear()}-${String(completedDate.getMonth() + 1).padStart(2, '0')}`;
                if (!periods[compPeriod]) periods[compPeriod] = {created: 0, completed: 0};
                periods[compPeriod].completed++;
            }
        });
        return Object.entries(periods).map(([period, counts]) => ({period, ...counts})).sort((a,b) => a.period.localeCompare(b.period));
    }, [filteredTasks]);

    const avgCompletionTime = useMemo(() => {
        const completedTasks = filteredTasks.filter(t => t.completedAt);
        if (completedTasks.length === 0) return 0;
        const totalDays = completedTasks.reduce((sum, t) => {
            const completedTime = new Date(t.completedAt!).getTime();
            const createdTime = new Date(t.createdAt).getTime();
            const days = (completedTime - createdTime) / (1000 * 60 * 60 * 24);
            return sum + days;
        }, 0);
        return Math.round((totalDays / completedTasks.length) * 10) / 10;
    }, [filteredTasks]);

    const topPerformers = useMemo(() => {
        const userStats: Record<string, { total: number; onTime: number }> = {};
        filteredTasks.forEach((task) => {
            if (!(task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED || task.status === TaskStatus.FAILED)) {
                return;
            }

            const entries = getAssigneeEntries(task.assignedTo).filter((entry) => entry.id && entry.user);
            entries.forEach(({ id }) => {
                if (!id) return;
                if (!userStats[id]) {
                    userStats[id] = { total: 0, onTime: 0 };
                }
                userStats[id].total++;
                if (task.completedAt && task.dueAt && new Date(task.completedAt) <= new Date(task.dueAt)) {
                    userStats[id].onTime++;
                }
            });
        });

        return Object.entries(userStats)
            .map(([userId, stats]) => ({
                name: usersMap.get(userId)?.name || 'Unknown',
                rate: stats.total > 0 ? stats.onTime / stats.total : 0
            }))
            .sort((a, b) => b.rate - a.rate);
    }, [filteredTasks, getAssigneeEntries, usersMap]);

    const bottleneckTasks: { title: string; daysStuck: number }[] = useMemo(() => {
        const inProgress = filteredTasks.filter(t => t.status === TaskStatus.IN_PROGRESS);
        const mapped: { title: string; daysStuck: number }[] = inProgress.map(t => {
            const now = Date.now();
            const created = new Date(t.createdAt).getTime();
            const diff = now - created;
            const days = diff / (1000 * 60 * 60 * 24);
            return {
                title: t.title,
                daysStuck: Math.floor(days)
            };
        });
        return mapped.sort((a, b) => b.daysStuck - a.daysStuck);
    }, [filteredTasks]);

    const memberComparison = useMemo(() => {
        const data: Record<string, { name: string; load: number; completed: number }> = {};
        filteredTasks.forEach((task) => {
            const entries = getAssigneeEntries(task.assignedTo);
            entries.forEach(({ id, name }) => {
                const key = id ?? `unassigned:${name}`;
                if (!data[key]) {
                    data[key] = { name, load: 0, completed: 0 };
                }
                data[key].load++;
                if (task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED || task.status === TaskStatus.FAILED) {
                    data[key].completed++;
                }
            });
        });
        return Object.values(data);
    }, [filteredTasks, getAssigneeEntries]);

    const utilizationHeatmap = useMemo(() => {
        const dayCounts: Record<string, number> = {};
        filteredTasks.forEach(task => {
            const date = new Date(task.createdAt).toISOString().split('T')[0];
            dayCounts[date] = (dayCounts[date] || 0) + 1;
        });
        return Object.entries(dayCounts).map(([date, count]) => ({date, count})).sort((a,b) => a.date.localeCompare(b.date));
    }, [filteredTasks]);

    const roleBasedView = useMemo(() => {
        const roleStats: Record<string, { total: number; completed: number; onTime: number }> = {};
        filteredTasks.forEach((task) => {
            const entries = getAssigneeEntries(task.assignedTo).filter((entry) => entry.user);
            entries.forEach(({ user }) => {
                if (!user) return;
                const role = user.role || 'Unknown';
                if (!roleStats[role]) {
                    roleStats[role] = { total: 0, completed: 0, onTime: 0 };
                }
                if (task.status === TaskStatus.DONE || task.status === TaskStatus.DEPLOYED || task.status === TaskStatus.FAILED) {
                    roleStats[role].total++;
                    roleStats[role].completed++;
                    if (task.completedAt && task.dueAt && new Date(task.completedAt) <= new Date(task.dueAt)) {
                        roleStats[role].onTime++;
                    }
                }
            });
        });
        return Object.entries(roleStats).map(([role, stats]) => ({ role, ...stats }));
    }, [filteredTasks, getAssigneeEntries]);

    const generateInsight = async () => {
        setInsightLoading(true);
        setInsight('');
        setError('');
        if (aiFilteredTasks.length === 0) {
            setError("Cannot generate insights without data. Adjust AI filters or create tasks.");
            setInsightLoading(false);
            return;
        }

        try {
            const response = await withGeminiKey(async (apiKey) => {
                const ai = new GoogleGenAI({ apiKey });

                const tasksWithAssigneeNames = aiFilteredTasks.map(task => ({
                    title: task.title,
                    status: CUSTOM_STATUS_NAMES[task.status]?.name ?? task.status,
                    priority: task.priority,
                    assigneeName: (() => {
                        const names = getAssigneeEntries(task.assignedTo).map((entry) => entry.name);
                        return names.length > 0 ? names.join(', ') : 'Unassigned';
                    })(),
                    dueDate: task.dueAt,
                    createdAt: task.createdAt,
                }));

                const aiScopeLabel = aiPeriod === 'full' ? 'Full report' : aiPeriod;
                const aiDepartmentLabel = aiDepartment !== 'all' ? aiDepartment : 'All departments';
                const aiPersonLabel = aiPerson !== 'all' ? usersMap.get(aiPerson)?.name ?? aiPerson : 'All people';

                const prompt = `
                    Analyze the following project task data and provide a brief, actionable insight for a project manager in 2-3 short paragraphs.
                    Focus on potential risks (like bottlenecks or overdue tasks), team workload distribution, and suggestions for improvement based on this specific data slice.
                    The current date is ${new Date().toISOString()}.
                    Report period: ${aiScopeLabel}. Department: ${aiDepartmentLabel}. Person: ${aiPersonLabel}.

                    Task Data (JSON Summary):
                    ${JSON.stringify(tasksWithAssigneeNames.slice(0, 50), null, 2)}
                    ${tasksWithAssigneeNames.length > 50 ? `\n... and ${tasksWithAssigneeNames.length - 50} more tasks.` : ''}
                `;

                return ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        systemInstruction: 'You are a helpful and concise project management assistant. Provide data-driven insights in a professional tone.',
                        temperature: 0.5,
                    }
                });
            });

            setInsight(response.text);

        } catch (err) {
            console.error("Error generating insight:", err);
            const message = err instanceof Error ? err.message : 'An error occurred while generating the AI insight. Please check your API key and try again.';
            const displayMessage =
                message.includes('AI features are disabled') || message.includes('Gemini API keys')
                    ? message
                    : 'An error occurred while generating the AI insight. Please check your API key and try again.';
            setError(displayMessage);
        } finally {
            setInsightLoading(false);
        }
    };

    const rangeLabel = useMemo(() => {
        if (dateRangeFilter === 'all') {
            return 'All time';
        }
        if (dateRangeFilter === 'custom') {
            return startDate && endDate ? `${startDate} to ${endDate}` : 'Custom';
        }
        if (dateRangeFilter === 'daily') {
            return referenceDate ? `Day of ${referenceDate}` : 'Daily';
        }
        if (dateRangeFilter === 'weekly') {
            if (periodRange.start && periodRange.end) {
                return `${periodRange.start.toISOString().slice(0, 10)} to ${periodRange.end.toISOString().slice(0, 10)}`;
            }
            return 'Weekly';
        }
        if (dateRangeFilter === 'monthly') {
            return referenceDate ? `Month of ${referenceDate.slice(0, 7)}` : 'Monthly';
        }
        return 'All time';
    }, [dateRangeFilter, startDate, endDate, referenceDate, periodRange]);

    const handleGenerateReport = () => {
        setReportGeneratedAt(new Date());
    };

    const handleDownloadSummary = () => {
        const summary = summarizeTasks(filteredTasks);
        const rows: Array<Array<string | number | null | undefined>> = [
            ['Report Item', 'Value'],
            ['Scope', reportScope],
            ['Period', rangeLabel],
            ['Department', teamFilter !== 'all' ? teamFilter : 'All'],
            ['Person', personFilter !== 'all' ? usersMap.get(personFilter)?.name ?? personFilter : 'All'],
            ['Priority', taskTypeFilter !== 'all' ? taskTypeFilter : 'All'],
            ['Total Tasks', summary.total],
            ['Completed Tasks', summary.completedCount],
            ['Completion Rate %', summary.completedCount > 0 ? summary.completionRate : 'N/A'],
            ['In Progress', summary.inProgress],
            ['Overdue', summary.overdue],
            ['Avg Completion Days', summary.avgCompletionDays],
        ];
        downloadCsv(`report-summary-${reportLabel}.csv`, rows);
    };

    const handleDownloadDetail = () => {
        const rows: Array<Array<string | number | null | undefined>> = [
            ['Title', 'Status', 'Priority', 'Department', 'Assignees', 'Created At', 'Due At', 'Completed At'],
            ...filteredTasks.map((task) => [
                task.title,
                task.status,
                task.priority,
                task.team,
                formatAssigneeNames(task.assignedTo),
                task.createdAt,
                task.dueAt ?? '',
                task.completedAt ?? '',
            ]),
        ];
        downloadCsv(`report-detail-${reportLabel}.csv`, rows);
    };
    
    if (loadingData) {
        return <PageLoader />;
    }

    return (
        <div>
            <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
                <h1 className="text-3xl font-bold text-text-primary">Reports & Insights</h1>
                <div className="flex flex-col gap-3 bg-surface p-3 rounded-lg border border-border-color">
                    <div className="flex flex-wrap items-center gap-3">
                        <select
                            value={reportScope}
                            onChange={(e) => setReportScope(e.target.value as typeof reportScope)}
                            className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        >
                            <option value="overall">Overall report</option>
                            <option value="department">Department report</option>
                            <option value="person">Person report</option>
                            <option value="department_person">Department + person report</option>
                            <option value="detail">Detailed report</option>
                        </select>
                        <select
                            value={dateRangeFilter}
                            onChange={(e) => setDateRangeFilter(e.target.value)}
                            className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        >
                            <option value="all">All Time</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="custom">Custom Range</option>
                        </select>
                        {dateRangeFilter !== 'all' && dateRangeFilter !== 'custom' && (
                            <input
                                type="date"
                                value={referenceDate}
                                onChange={(e) => setReferenceDate(e.target.value)}
                                className="bg-background border border-border-color rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                aria-label="Report reference date"
                            />
                        )}
                        {dateRangeFilter === 'custom' && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="bg-background border border-border-color rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    placeholder="Start Date"
                                />
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    className="bg-background border border-border-color rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    placeholder="End Date"
                                />
                            </div>
                        )}
                        <select
                            value={taskTypeFilter}
                            onChange={e => setTaskTypeFilter(e.target.value)}
                            className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        >
                            <option value="all">All Priorities</option>
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                            <option value="URGENT">Urgent</option>
                        </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {showDepartmentFilter && (
                            <select
                                value={teamFilter}
                                onChange={(e) => setTeamFilter(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="all">All Departments</option>
                                {availableDepartments.map((department) => (
                                    <option key={department} value={department}>{department}</option>
                                ))}
                            </select>
                        )}
                        {showPersonFilter && (
                            <select
                                value={personFilter}
                                onChange={(e) => setPersonFilter(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="all">All People</option>
                                {availablePeople.map((person) => (
                                    <option key={person.id} value={person.id}>{person.name}</option>
                                ))}
                            </select>
                        )}
                        <button
                            type="button"
                            onClick={handleGenerateReport}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                        >
                            Generate report
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadSummary}
                            className="rounded-md border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                        >
                            Download summary
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadDetail}
                            className="rounded-md border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                        >
                            Download detail
                        </button>
                        {reportGeneratedAt && (
                            <span className="text-xs text-text-secondary">
                                Generated {reportGeneratedAt.toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard title="Total Tasks" value={stats.totalTasks} />
                <StatCard title="On-Time Completion" value={stats.completionRate} />
                <StatCard title="In Progress" value={stats.inProgressTasks} />
                <StatCard title="Overdue" value={stats.overdueTasks} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                 <BarChart data={workloadData} title="Workload Distribution" />
                <div className="bg-surface p-6 rounded-lg border border-border-color">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                        <h2 className="text-xl font-semibold text-text-primary">AI-Powered Insight</h2>
                        <button
                            onClick={generateInsight}
                            disabled={insightLoading}
                            className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span>{insightLoading ? 'Analyzing...' : 'Generate Insight'}</span>
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-3 mb-4">
                        <select
                            value={aiPeriod}
                            onChange={(e) => setAiPeriod(e.target.value as typeof aiPeriod)}
                            className="bg-background border border-border-color rounded-md py-2 px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="full">Full report</option>
                            <option value="today">Today report</option>
                            <option value="weekly">Weekly report</option>
                            <option value="monthly">Monthly report</option>
                        </select>
                        <select
                            value={aiDepartment}
                            onChange={(e) => setAiDepartment(e.target.value)}
                            className="bg-background border border-border-color rounded-md py-2 px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All departments</option>
                            {availableDepartments.map((department) => (
                                <option key={department} value={department}>{department}</option>
                            ))}
                        </select>
                        <select
                            value={aiPerson}
                            onChange={(e) => setAiPerson(e.target.value)}
                            className="bg-background border border-border-color rounded-md py-2 px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All people</option>
                            {availablePeople.map((person) => (
                                <option key={person.id} value={person.id}>{person.name}</option>
                            ))}
                        </select>
                    </div>

                    {error && <p className="text-red-400 my-4 p-3 bg-red-900/50 border border-red-700 rounded-md text-sm">{error}</p>}

                    <div className="min-h-[10rem] py-4">
                        {insightLoading && (
                            <div className="text-center text-text-secondary animate-pulse">
                                Generating analysis based on your filters...
                            </div>
                        )}
                        {insight && (
                            <div className="text-text-secondary space-y-4 text-sm">
                                {insight.split('\n').filter(p => p.trim() !== '').map((paragraph, index) => (
                                    <p key={index}>{paragraph}</p>
                                ))}
                            </div>
                        )}
                        {!insight && !insightLoading && !error && (
                            <div className="flex items-center justify-center h-full text-center text-text-secondary">
                                <p>Click the button to get an AI summary of the filtered data.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="mb-8">
                <h2 className="text-2xl font-bold text-text-primary mb-6">Task Analytics</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                    <StatCard title="Avg Completion Time" value={avgCompletionTime ? `${avgCompletionTime} days` : 'N/A'} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <BarChart data={topPerformers.slice(0,10).map(p => ({label: p.name, value: Math.round(p.rate * 100)}))} title="Top Performers (On-Time Rate %)" />
                    <BarChart data={bottleneckTasks.slice(0,10).map(t => ({label: t.title.length > 20 ? t.title.slice(0,20) + '...' : t.title, value: t.daysStuck}))} title="Bottleneck Tasks (Days Stuck)" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <BarChart data={trendData.map(d => ({label: d.period, value: d.created}))} title="Tasks Created Over Time" />
                    <BarChart data={trendData.map(d => ({label: d.period, value: d.completed}))} title="Tasks Completed Over Time" />
                </div>
            </div>

            <div className="mb-8">
                <h2 className="text-2xl font-bold text-text-primary mb-6">Team Performance</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <BarChart data={memberComparison.map(m => ({label: m.name, value: m.load}))} title="Task Load per Member" />
                    <BarChart data={memberComparison.map(m => ({label: m.name, value: m.completed}))} title="Completed Tasks per Member" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <BarChart data={utilizationHeatmap.slice(-10).map(u => ({label: u.date, value: u.count}))} title="Tasks per Day (Last 10 Days)" />
                    <BarChart data={roleBasedView.map(r => ({label: r.role, value: r.total > 0 ? Math.round((r.onTime / r.total) * 100) : 0}))} title="On-Time Completion Rate by Role %" />
                </div>
            </div>

            {reportScope === 'detail' && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-text-primary">Detailed Report</h2>
                        <button
                            type="button"
                            onClick={handleDownloadDetail}
                            className="rounded-md border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                        >
                            Download CSV
                        </button>
                    </div>
                    <div className="overflow-x-auto border border-border-color rounded-lg bg-surface">
                        <table className="min-w-full text-sm">
                            <thead className="bg-background/60 text-text-secondary">
                                <tr>
                                    <th className="px-4 py-3 text-left">Title</th>
                                    <th className="px-4 py-3 text-left">Status</th>
                                    <th className="px-4 py-3 text-left">Priority</th>
                                    <th className="px-4 py-3 text-left">Department</th>
                                    <th className="px-4 py-3 text-left">Assignees</th>
                                    <th className="px-4 py-3 text-left">Created</th>
                                    <th className="px-4 py-3 text-left">Due</th>
                                    <th className="px-4 py-3 text-left">Completed</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-color">
                                {filteredTasks.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-6 text-center text-text-secondary">
                                            No tasks match the selected report filters.
                                        </td>
                                    </tr>
                                )}
                                {filteredTasks.map((task) => (
                                    <tr key={task.id} className="hover:bg-background/40">
                                        <td className="px-4 py-3 text-text-primary">{task.title}</td>
                                        <td className="px-4 py-3 text-text-secondary">{CUSTOM_STATUS_NAMES[task.status]?.name ?? task.status}</td>
                                        <td className="px-4 py-3 text-text-secondary">{task.priority}</td>
                                        <td className="px-4 py-3 text-text-secondary">{task.team}</td>
                                        <td className="px-4 py-3 text-text-secondary">{formatAssigneeNames(task.assignedTo)}</td>
                                        <td className="px-4 py-3 text-text-secondary">{formatDate(task.createdAt, true)}</td>
                                        <td className="px-4 py-3 text-text-secondary">{task.dueAt ? formatDate(task.dueAt, true) : '--'}</td>
                                        <td className="px-4 py-3 text-text-secondary">{task.completedAt ? formatDate(task.completedAt, true) : '--'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="mb-8">
                <h2 className="text-2xl font-bold text-text-primary mb-2">Comparisons</h2>
                <p className="text-sm text-text-secondary mb-6">
                    Compare two departments or two people using the current period and priority filters.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-surface border border-border-color rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-text-primary mb-4">Department Comparison</h3>
                        <div className="flex flex-wrap gap-3 mb-4">
                            <select
                                value={compareDeptA}
                                onChange={(e) => setCompareDeptA(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="">Select department A</option>
                                {availableDepartments.map((department) => (
                                    <option key={department} value={department}>{department}</option>
                                ))}
                            </select>
                            <select
                                value={compareDeptB}
                                onChange={(e) => setCompareDeptB(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="">Select department B</option>
                                {availableDepartments.map((department) => (
                                    <option key={department} value={department}>{department}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-text-secondary">
                            <div>
                                <p className="font-semibold text-text-primary">{compareDeptA || 'Department A'}</p>
                                <p>Total tasks: {departmentComparison.left.total}</p>
                                <p>Completed: {departmentComparison.left.completedCount}</p>
                                <p>Completion rate: {departmentComparison.left.completedCount > 0 ? `${departmentComparison.left.completionRate}%` : 'N/A'}</p>
                                <p>Overdue: {departmentComparison.left.overdue}</p>
                                <p>Avg completion: {departmentComparison.left.avgCompletionDays} days</p>
                            </div>
                            <div>
                                <p className="font-semibold text-text-primary">{compareDeptB || 'Department B'}</p>
                                <p>Total tasks: {departmentComparison.right.total}</p>
                                <p>Completed: {departmentComparison.right.completedCount}</p>
                                <p>Completion rate: {departmentComparison.right.completedCount > 0 ? `${departmentComparison.right.completionRate}%` : 'N/A'}</p>
                                <p>Overdue: {departmentComparison.right.overdue}</p>
                                <p>Avg completion: {departmentComparison.right.avgCompletionDays} days</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-surface border border-border-color rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-text-primary mb-4">Person Comparison</h3>
                        <div className="flex flex-wrap gap-3 mb-4">
                            <select
                                value={comparePersonA}
                                onChange={(e) => setComparePersonA(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="">Select person A</option>
                                {availablePeople.map((person) => (
                                    <option key={person.id} value={person.id}>{person.name}</option>
                                ))}
                            </select>
                            <select
                                value={comparePersonB}
                                onChange={(e) => setComparePersonB(e.target.value)}
                                className="bg-background border-none rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                            >
                                <option value="">Select person B</option>
                                {availablePeople.map((person) => (
                                    <option key={person.id} value={person.id}>{person.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-text-secondary">
                            <div>
                                <p className="font-semibold text-text-primary">{usersMap.get(comparePersonA)?.name ?? 'Person A'}</p>
                                <p>Total tasks: {personComparison.left.total}</p>
                                <p>Completed: {personComparison.left.completedCount}</p>
                                <p>Completion rate: {personComparison.left.completedCount > 0 ? `${personComparison.left.completionRate}%` : 'N/A'}</p>
                                <p>Overdue: {personComparison.left.overdue}</p>
                                <p>Avg completion: {personComparison.left.avgCompletionDays} days</p>
                            </div>
                            <div>
                                <p className="font-semibold text-text-primary">{usersMap.get(comparePersonB)?.name ?? 'Person B'}</p>
                                <p>Total tasks: {personComparison.right.total}</p>
                                <p>Completed: {personComparison.right.completedCount}</p>
                                <p>Completion rate: {personComparison.right.completedCount > 0 ? `${personComparison.right.completionRate}%` : 'N/A'}</p>
                                <p>Overdue: {personComparison.right.overdue}</p>
                                <p>Avg completion: {personComparison.right.avgCompletionDays} days</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Reports;
