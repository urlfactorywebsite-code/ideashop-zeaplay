import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/mockApi';
import {
    Reward,
    User,
    RewardIcon,
    Department,
    RewardStatus,
    RewardImageSource,
    RewardClaim,
    RewardClaimStatus,
    RewardLog,
    RewardLogAction,
    RewardListResponse,
    RewardClaimListResponse,
    RewardLogListResponse,
    Role,
} from '../types';
import { useAuth } from '../hooks/useAuth';
import MultiSelect from '../components/ui/MultiSelect';
import {
    PlusIcon,
    ArrowPathIcon,
    FunnelIcon,
    TrashIcon,
    ClockIcon,
    PhotoIcon,
    InboxArrowDownIcon,
    XMarkIcon,
    ShieldCheckIcon,
    ShieldExclamationIcon,
    DocumentDuplicateIcon,
} from '../components/icons';

type RewardEditorPayload = {
    title: string;
    description: string;
    imageSource: RewardImageSource;
    imageRef: string | null;
    xpRequired: number;
    deptWhitelist: string[];
    autoRedeem: boolean;
    allowMultipleClaims: boolean;
    expiresAt: string | null;
};

const defaultEditorPayload: RewardEditorPayload = {
    title: '',
    description: '',
    imageSource: RewardImageSource.LIBRARY,
    imageRef: null,
    xpRequired: 0,
    deptWhitelist: [],
    autoRedeem: true,
    allowMultipleClaims: false,
    expiresAt: null,
};

const RewardManagement: React.FC = () => {
    const { user: currentUser } = useAuth();
    const isOwnerOrAdmin = currentUser?.role === Role.OWNER || currentUser?.role === Role.ADMIN;

    const [activeTab, setActiveTab] = useState<'active' | 'expired'>('active');
    const [searchTerm, setSearchTerm] = useState('');
    const [deptFilter, setDeptFilter] = useState<string | null>(null);
    const [rewardPage, setRewardPage] = useState<RewardListResponse | null>(null);
    const [loadingRewards, setLoadingRewards] = useState(true);

    const [icons, setIcons] = useState<RewardIcon[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [editorState, setEditorState] = useState<{ open: boolean; reward: Reward | null }>({ open: false, reward: null });

    const [claimsDrawerOpen, setClaimsDrawerOpen] = useState(false);
    const [claimsPage, setClaimsPage] = useState<RewardClaimListResponse | null>(null);
    const [loadingClaims, setLoadingClaims] = useState(false);

    const [logsDrawer, setLogsDrawer] = useState<{ open: boolean; reward: Reward | null }>({ open: false, reward: null });
    const [logsPage, setLogsPage] = useState<RewardLogListResponse | null>(null);
    const [loadingLogs, setLoadingLogs] = useState(false);

    const [clearModalOpen, setClearModalOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [submittingReward, setSubmittingReward] = useState(false);

    const iconsByKey = useMemo(() => {
        const map = new Map<string, RewardIcon>();
        icons.forEach((icon) => map.set(icon.key, icon));
        return map;
    }, [icons]);

    const deptOptions = useMemo(
        () => departments.map((dept) => ({ id: dept.id, name: dept.name })),
        [departments]
    );

    const fetchRewards = useCallback(async () => {
        setLoadingRewards(true);
        try {
            const page = await api.getRewardPage({
                tab: activeTab,
                search: searchTerm.trim(),
                dept: deptFilter ?? undefined,
                pageSize: 24,
            });
            setRewardPage(page ?? null);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingRewards(false);
        }
    }, [activeTab, searchTerm, deptFilter]);

    useEffect(() => {
        fetchRewards();
    }, [fetchRewards]);

    useEffect(() => {
        const hydrate = async () => {
            const [iconResult, deptResult] = await Promise.allSettled([
                api.getRewardIcons(),
                api.getDepartments(),
            ]);

            if (iconResult.status === 'fulfilled') {
                setIcons(iconResult.value ?? []);
            } else {
                console.error('Failed to load reward icons', iconResult.reason);
                setIcons([]);
            }

            if (deptResult.status === 'fulfilled') {
                setDepartments(deptResult.value ?? []);
            } else {
                console.error('Failed to load departments', deptResult.reason);
                setDepartments([]);
            }
        };
        hydrate();
    }, []);

    useEffect(() => {
        if (!toastMessage) return;
        const timer = window.setTimeout(() => setToastMessage(null), 2600);
        return () => window.clearTimeout(timer);
    }, [toastMessage]);

    const openEditor = (reward: Reward | null = null) => {
        setEditorState({ open: true, reward });
    };

    const closeEditor = () => {
        setEditorState({ open: false, reward: null });
    };

    const handleSaveReward = async (payload: RewardEditorPayload, rewardId?: string) => {
        setSubmittingReward(true);
        try {
            if (rewardId) {
                await api.updateReward(rewardId, payload);
                setToastMessage('Reward updated');
            } else {
                await api.createReward(payload);
                setToastMessage('Reward created');
            }
            closeEditor();
            fetchRewards();
        } catch (error: any) {
            alert(error.message ?? 'Unable to save reward');
        } finally {
            setSubmittingReward(false);
        }
    };

    const handleClaimReward = async (reward: Reward) => {
        try {
            await api.claimReward(reward.id);
            setToastMessage('Claim submitted');
            fetchRewards();
        } catch (error: any) {
            alert(error.message ?? 'Unable to claim reward');
        }
    };

    const handleExpireReward = async (reward: Reward) => {
        try {
            await api.expireReward(reward.id);
            setToastMessage('Reward expired');
            fetchRewards();
        } catch (error: any) {
            alert(error.message ?? 'Unable to expire reward');
        }
    };

    const handleClearExpired = async () => {
        try {
            await api.clearExpiredRewards();
            setToastMessage('Expired rewards cleared');
            setClearModalOpen(false);
            fetchRewards();
        } catch (error: any) {
            alert(error.message ?? 'Unable to clear expired rewards');
        }
    };

    const openClaimsDrawer = () => {
        if (!isOwnerOrAdmin) return;
        setClaimsDrawerOpen(true);
        loadClaims();
    };

    const loadClaims = async () => {
        setLoadingClaims(true);
        try {
            const page = await api.listRewardClaims({ status: RewardClaimStatus.PENDING, pageSize: 50 });
            setClaimsPage(page ?? null);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingClaims(false);
        }
    };

    const handleApproveClaim = async (claimId: string, approve: boolean) => {
        try {
            if (approve) {
                await api.approveRewardClaim(claimId);
            } else {
                await api.rejectRewardClaim(claimId);
            }
            loadClaims();
            fetchRewards();
        } catch (error: any) {
            alert(error.message ?? 'Unable to update claim');
        }
    };

    const openLogsDrawerFor = (reward: Reward) => {
        setLogsDrawer({ open: true, reward });
        loadLogs(reward.id);
    };

    const loadLogs = async (rewardId?: string) => {
        setLoadingLogs(true);
        try {
            const page = await api.getRewardLogs({ subjectId: rewardId, pageSize: 30 });
            setLogsPage(page ?? null);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingLogs(false);
        }
    };

    const visibleRewards = rewardPage?.items ?? [];

    return (
        <div className="space-y-8">
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary">Rewards</h1>
                    <p className="text-text-secondary">Launch perks, review claims, and monitor audit logs.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {isOwnerOrAdmin && (
                        <button
                            type="button"
                            onClick={openClaimsDrawer}
                            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
                        >
                            <ShieldCheckIcon className="h-4 w-4" />
                            Approvals
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => openEditor()}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
                    >
                        <PlusIcon className="h-5 w-5" />
                        New Reward
                    </button>
                </div>
            </header>

            <section className="rounded-2xl border border-border-color bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex rounded-full border border-border-color p-1 text-sm font-semibold">
                        {(['active', 'expired'] as const).map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={`rounded-full px-4 py-1 transition ${
                                    activeTab === tab ? 'bg-primary text-white' : 'text-text-secondary'
                                }`}
                            >
                                {tab === 'active' ? 'Active Rewards' : 'Expired Rewards'}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-3">
                        <label className="flex flex-1 items-center gap-2 rounded-lg border border-border-color bg-background px-3 py-2">
                            <FunnelIcon className="h-4 w-4 text-text-secondary" />
                            <input
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Search rewards"
                                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
                            />
                        </label>
                        <select
                            value={deptFilter ?? ''}
                            onChange={(event) => setDeptFilter(event.target.value || null)}
                            className="rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="">All departments</option>
                            {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                    {dept.name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={fetchRewards}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                        >
                            <ArrowPathIcon className={`h-4 w-4 ${loadingRewards ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        {activeTab === 'expired' && (
                            <button
                                type="button"
                                onClick={() => setClearModalOpen(true)}
                                className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-500 hover:bg-rose-50"
                            >
                                <TrashIcon className="h-4 w-4" />
                                Clear expired
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {loadingRewards &&
                        Array.from({ length: 6 }).map((_, idx) => (
                            <div key={idx} className="animate-pulse rounded-2xl border border-border-color bg-background/60 p-5">
                                <div className="h-4 w-2/3 rounded bg-border-color/70" />
                                <div className="mt-3 h-3 w-full rounded bg-border-color/50" />
                                <div className="mt-3 h-3 w-1/2 rounded bg-border-color/40" />
                            </div>
                        ))}
                    {!loadingRewards &&
                        visibleRewards.map((reward) => (
                            <RewardCard
                                key={reward.id}
                                reward={reward}
                                currentUser={currentUser}
                                iconsByKey={iconsByKey}
                                onEdit={() => openEditor(reward)}
                                onExpire={() => handleExpireReward(reward)}
                                onClaim={() => handleClaimReward(reward)}
                                onViewLogs={() => openLogsDrawerFor(reward)}
                            />
                        ))}
                    {!loadingRewards && visibleRewards.length === 0 && (
                        <div className="col-span-full rounded-2xl border border-dashed border-border-color px-6 py-12 text-center text-text-secondary">
                            No rewards match your filters.
                        </div>
                    )}
                </div>
            </section>

            {toastMessage && (
                <div className="fixed bottom-6 right-6 rounded-lg bg-black/80 px-4 py-2 text-sm text-white shadow-lg">{toastMessage}</div>
            )}

            {editorState.open && (
                <RewardEditorModal
                    reward={editorState.reward}
                    icons={icons}
                    departments={departments}
                    onClose={closeEditor}
                    onSubmit={handleSaveReward}
                    uploadingImage={uploadingImage}
                    setUploadingImage={setUploadingImage}
                    submitting={submittingReward}
                />
            )}

            {claimsDrawerOpen && (
                <ClaimsDrawer
                    claimsPage={claimsPage}
                    loading={loadingClaims}
                    onClose={() => setClaimsDrawerOpen(false)}
                    onRefresh={loadClaims}
                    onDecision={handleApproveClaim}
                />
            )}

            {logsDrawer.open && (
                <LogsDrawer
                    reward={logsDrawer.reward}
                    logsPage={logsPage}
                    loading={loadingLogs}
                    onClose={() => setLogsDrawer({ open: false, reward: null })}
                    onRefresh={() => loadLogs(logsDrawer.reward?.id)}
                />
            )}

            {clearModalOpen && (
                <ConfirmDialog
                    title="Clear expired rewards"
                    description="This permanently deletes every expired reward along with any uploaded images. This action cannot be undone."
                    confirmLabel="Delete expired rewards"
                    onCancel={() => setClearModalOpen(false)}
                    onConfirm={handleClearExpired}
                    destructive
                />
            )}
        </div>
    );
};
type RewardCardProps = {
    reward: Reward;
    currentUser: User | null;
    iconsByKey: Map<string, RewardIcon>;
    onEdit: () => void;
    onExpire: () => void;
    onClaim: () => void;
    onViewLogs: () => void;
};

const RewardCard: React.FC<RewardCardProps> = ({ reward, currentUser, iconsByKey, onEdit, onExpire, onClaim, onViewLogs }) => {
    const isUpload = reward.imageSource === RewardImageSource.UPLOAD;
    const libraryIcon = reward.imageRef ? iconsByKey.get(reward.imageRef) : null;
    const canEdit = currentUser?.role && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(currentUser.role);

    const userDeptId = currentUser?.departmentId ?? null;
    const deptEligible = !reward.deptWhitelist || reward.deptWhitelist.length === 0 || reward.deptWhitelist.includes(userDeptId ?? '');
    const xpEligible = (currentUser?.points ?? 0) >= reward.xpRequired;
    const canClaim = reward.status === RewardStatus.ACTIVE && deptEligible && xpEligible;

    const expiresBadge = reward.expiresAt
        ? `${reward.status === RewardStatus.EXPIRED ? 'Expired' : 'Expires'} ${formatRelativeTime(reward.expiresAt)}`
        : 'No expiry';

    return (
        <article className="relative flex flex-col rounded-2xl border border-border-color bg-background p-5 shadow-sm">
            <div className="flex items-start gap-4">
                <div className="h-14 w-14 overflow-hidden rounded-xl border border-border-color bg-surface">
                    {isUpload && reward.imageUrl && <img src={reward.imageUrl} alt={reward.title} className="h-full w-full object-cover" />}
                    {!isUpload && libraryIcon && <img src={libraryIcon.url} alt={libraryIcon.label} className="h-full w-full object-cover" />}
                    {!reward.imageRef && !reward.imageUrl && (
                        <div className="flex h-full w-full items-center justify-center text-text-secondary">
                            <PhotoIcon className="h-6 w-6" />
                        </div>
                    )}
                </div>
                <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-semibold text-text-primary">{reward.title}</h3>
                            <p className="text-sm text-text-secondary">{reward.description}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-semibold text-text-primary">
                                    <ShieldCheckIcon className="h-3.5 w-3.5 text-primary" />
                                    {reward.xpRequired.toLocaleString()} XP
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5">
                                    <ClockIcon className="h-3.5 w-3.5" />
                                    {expiresBadge}
                                </span>
                                {reward.deptWhitelist && reward.deptWhitelist.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-500">
                                        <ShieldExclamationIcon className="h-3.5 w-3.5" />
                                        Department gated
                                    </span>
                                )}
                                {!reward.autoRedeem && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-500">
                                        Approval required
                                    </span>
                                )}
                                {reward.allowMultipleClaims && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
                                        Multi-claim
                                    </span>
                                )}
                            </div>
                        </div>
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                            {reward.status === RewardStatus.ACTIVE ? 'Active' : reward.status}
                        </span>
                    </div>
                </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={!canClaim}
                    onClick={canClaim ? onClaim : undefined}
                    className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        canClaim ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-surface text-text-secondary cursor-not-allowed'
                    }`}
                >
                    {canClaim ? 'Claim reward' : !deptEligible ? 'Dept locked' : 'Need more XP'}
                </button>
                {canEdit && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onEdit}
                            className="rounded-lg border border-border-color px-3 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            onClick={onViewLogs}
                            className="rounded-lg border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                        >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={onExpire}
                            disabled={reward.status !== RewardStatus.ACTIVE}
                            className="rounded-lg border border-border-color px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-text-secondary"
                        >
                            Expire
                        </button>
                    </div>
                )}
            </div>
        </article>
    );
};

const RewardEditorModal: React.FC<{
    reward: Reward | null;
    icons: RewardIcon[];
    departments: Department[];
    onClose: () => void;
    onSubmit: (payload: RewardEditorPayload, rewardId?: string) => void;
    uploadingImage: boolean;
    setUploadingImage: (flag: boolean) => void;
    submitting: boolean;
}> = ({ reward, icons, departments, onClose, onSubmit, uploadingImage, setUploadingImage, submitting }) => {
    const initialState = useCallback((): RewardEditorPayload => {
        if (!reward) {
            return {
                ...defaultEditorPayload,
                deptWhitelist: [],
            };
        }
        return {
            title: reward.title,
            description: reward.description,
            imageSource: reward.imageSource,
            imageRef: reward.imageRef ?? null,
            xpRequired: reward.xpRequired,
            deptWhitelist: reward.deptWhitelist ?? [],
            autoRedeem: reward.autoRedeem,
            allowMultipleClaims: reward.allowMultipleClaims,
            expiresAt: reward.expiresAt ?? null,
        };
    }, [reward]);

    const [form, setForm] = useState<RewardEditorPayload>(initialState);

    useEffect(() => {
        setForm(initialState());
    }, [initialState]);

    useEffect(() => {
        if (!reward && form.imageSource === RewardImageSource.LIBRARY && !form.imageRef && icons.length > 0) {
            setForm((prev) => ({ ...prev, imageRef: icons[0].key }));
        }
    }, [form.imageRef, form.imageSource, icons, reward]);

    const handleChange = (patch: Partial<RewardEditorPayload>) => setForm((prev) => ({ ...prev, ...patch }));

    const handleFileUpload = async (file: File) => {
        setUploadingImage(true);
        try {
            const uploaded = await api.uploadRewardImage(file);
            if (uploaded) {
                handleChange({ imageSource: RewardImageSource.UPLOAD, imageRef: uploaded.imageRef });
            }
        } catch (error: any) {
            alert(error.message ?? 'Upload failed');
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSubmit(form, reward?.id);
    };

    const deptOptions = departments.map((dept) => ({ id: dept.id, name: dept.name }));
    const requiresLibraryIcon = form.imageSource === RewardImageSource.LIBRARY && !form.imageRef;

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-background shadow-xl">
                <div className="flex items-center justify-between border-b border-border-color px-6 py-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">{reward ? 'Update reward' : 'Create reward'}</p>
                        <h2 className="text-2xl font-bold text-text-primary">{reward ? reward.title : 'New Reward'}</h2>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 hover:bg-border-color/40">
                        <XMarkIcon className="h-5 w-5 text-text-secondary" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1 text-sm font-medium text-text-primary">
                            Title
                            <input
                                required
                                value={form.title}
                                onChange={(event) => handleChange({ title: event.target.value })}
                                className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </label>
                        <label className="space-y-1 text-sm font-medium text-text-primary">
                            XP required
                            <input
                                type="number"
                                min={0}
                                required
                                value={form.xpRequired}
                                onChange={(event) => handleChange({ xpRequired: Number(event.target.value) || 0 })}
                                className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </label>
                    </div>
                    <label className="space-y-1 text-sm font-medium text-text-primary">
                        Description
                        <textarea
                            required
                            value={form.description}
                            onChange={(event) => handleChange({ description: event.target.value })}
                            rows={3}
                            className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </label>

                    <div className="space-y-2">
                        <p className="text-sm font-semibold text-text-primary">Image</p>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => handleChange({ imageSource: RewardImageSource.LIBRARY, imageRef: null })}
                                className={`rounded-lg border px-3 py-2 text-sm ${
                                    form.imageSource === RewardImageSource.LIBRARY ? 'border-primary text-primary' : 'border-border-color text-text-secondary'
                                }`}
                            >
                                Choose from library
                            </button>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
                                <InboxArrowDownIcon className="h-4 w-4" />
                                Upload image
                                <input
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) handleFileUpload(file);
                                    }}
                                />
                            </label>
                            {uploadingImage && <span className="text-sm text-text-secondary">Uploading…</span>}
                        </div>
                        {form.imageSource === RewardImageSource.LIBRARY && (
                            <div className="grid grid-cols-5 gap-3 rounded-xl border border-border-color p-3">
                                {icons.map((icon) => (
                                    <button
                                        key={icon.id}
                                        type="button"
                                        onClick={() => handleChange({ imageRef: icon.key })}
                                        className={`rounded-xl border p-2 ${
                                            form.imageRef === icon.key ? 'border-primary' : 'border-transparent hover:border-border-color'
                                        }`}
                                    >
                                        <img src={icon.url} alt={icon.label} className="h-12 w-12 object-contain" />
                                    </button>
                                ))}
                            </div>
                        )}
                        {requiresLibraryIcon && (
                            <p className="text-xs text-rose-500">Choose a library icon or upload an image to continue.</p>
                        )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1 text-sm font-medium text-text-primary">
                            Expiration date
                            <input
                                type="datetime-local"
                                value={form.expiresAt ?? ''}
                                onChange={(event) => handleChange({ expiresAt: event.target.value || null })}
                                className="w-full rounded-lg border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </label>
                        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                            <input
                                type="checkbox"
                                checked={form.autoRedeem}
                                onChange={(event) => handleChange({ autoRedeem: event.target.checked })}
                                className="h-4 w-4 rounded border-border-color text-primary focus:ring-primary"
                            />
                            Auto redeem without approval
                        </label>
                    </div>

                    <label className="flex items-center justify-between gap-4 rounded-xl border border-border-color bg-surface px-4 py-3 text-sm text-text-primary">
                        <span>
                            <span className="block font-semibold">Allow multiple claims per user</span>
                            <span className="block text-xs text-text-secondary">Users can spend XP and claim this reward more than once.</span>
                        </span>
                        <input
                            type="checkbox"
                            checked={form.allowMultipleClaims}
                            onChange={(event) => handleChange({ allowMultipleClaims: event.target.checked })}
                            className="h-5 w-5 rounded border-border-color text-primary focus:ring-primary"
                        />
                    </label>

                    <div>
                        <p className="text-sm font-semibold text-text-primary">Department restrictions</p>
                        <p className="text-xs text-text-secondary">Leave empty to make the reward available to everyone.</p>
                        <MultiSelect
                            options={deptOptions}
                            value={form.deptWhitelist}
                            onChange={(ids) => handleChange({ deptWhitelist: ids })}
                            className="mt-2"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-border-color px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || requiresLibraryIcon}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {submitting ? 'Saving…' : reward ? 'Update reward' : 'Create reward'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
type ClaimsDrawerProps = {
    claimsPage: RewardClaimListResponse | null;
    loading: boolean;
    onClose: () => void;
    onRefresh: () => void;
    onDecision: (claimId: string, approve: boolean) => void;
};

const ClaimsDrawer: React.FC<ClaimsDrawerProps> = ({ claimsPage, loading, onClose, onRefresh, onDecision }) => (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l border-border-color bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border-color px-5 py-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Manual approvals</p>
                <h3 className="text-xl font-bold text-text-primary">Pending claims</h3>
            </div>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-border-color/40">
                <XMarkIcon className="h-5 w-5 text-text-secondary" />
            </button>
        </div>
        <div className="flex items-center justify-between border-b border-border-color px-5 py-3 text-sm text-text-secondary">
            <span>{claimsPage?.total ?? 0} request(s)</span>
            <button onClick={onRefresh} className="inline-flex items-center gap-1 text-text-primary">
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
        </div>
        <div className="h-[calc(100%-130px)] overflow-y-auto px-5 py-4 space-y-3">
            {loading && <p className="text-sm text-text-secondary">Loading…</p>}
            {!loading && (claimsPage?.items.length ?? 0) === 0 && <p className="text-sm text-text-secondary">No pending claims.</p>}
            {claimsPage?.items.map((claim) => (
                <div key={claim.id} className="rounded-xl border border-border-color bg-surface p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-text-primary">{claim.reward.title}</p>
                            <p className="text-xs text-text-secondary">{claim.user.name}</p>
                        </div>
                        <span className="text-xs text-text-secondary">{new Date(claim.claimedAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={() => onDecision(claim.id, true)}
                            className="flex-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            onClick={() => onDecision(claim.id, false)}
                            className="flex-1 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600"
                        >
                            Reject
                        </button>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

type LogsDrawerProps = {
    reward: Reward | null;
    logsPage: RewardLogListResponse | null;
    loading: boolean;
    onClose: () => void;
    onRefresh: () => void;
};

const LogsDrawer: React.FC<LogsDrawerProps> = ({ reward, logsPage, loading, onClose, onRefresh }) => (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg border-l border-border-color bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border-color px-5 py-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Audit log</p>
                <h3 className="text-xl font-bold text-text-primary">{reward?.title ?? 'All rewards'}</h3>
            </div>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-border-color/40">
                <XMarkIcon className="h-5 w-5 text-text-secondary" />
            </button>
        </div>
        <div className="flex items-center justify-between border-b border-border-color px-5 py-3 text-sm text-text-secondary">
            <span>{logsPage?.total ?? 0} event(s)</span>
            <button onClick={onRefresh} className="inline-flex items-center gap-1 text-text-primary">
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
        </div>
        <div className="h-[calc(100%-130px)] overflow-y-auto px-5 py-4 space-y-3 text-sm">
            {loading && <p className="text-text-secondary">Loading logs…</p>}
            {!loading && (logsPage?.items.length ?? 0) === 0 && <p className="text-text-secondary">No log entries yet.</p>}
            {logsPage?.items.map((log) => (
                <div key={log.id} className="rounded-xl border border-border-color bg-surface/80 px-4 py-3">
                    <p className="font-semibold text-text-primary">{log.action}</p>
                    <p className="text-xs text-text-secondary">
                        {log.actorId ? `Actor: ${log.actorId}` : 'System'} • {new Date(log.createdAt).toLocaleString()}
                    </p>
                    {log.meta && Object.keys(log.meta).length > 0 && (
                        <pre className="mt-2 rounded bg-background/70 p-2 text-xs text-text-secondary">{JSON.stringify(log.meta, null, 2)}</pre>
                    )}
                </div>
            ))}
        </div>
    </div>
);

type ConfirmDialogProps = {
    title: string;
    description: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
    destructive?: boolean;
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, description, confirmLabel, onCancel, onConfirm, destructive }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md rounded-2xl border border-border-color bg-background p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-text-primary">{title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{description}</p>
            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onCancel} className="rounded-lg border border-border-color px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary">
                    Cancel
                </button>
                <button
                    onClick={onConfirm}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary hover:bg-primary-dark'}`}
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    </div>
);

function formatRelativeTime(isoDate?: string | null): string {
    if (!isoDate) return 'No expiry';
    const target = new Date(isoDate);
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 0) return `${Math.abs(minutes)} min ago`;
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `in ${hours}h`;
    const days = Math.round(hours / 24);
    return `in ${days}d`;
}

export default RewardManagement;


