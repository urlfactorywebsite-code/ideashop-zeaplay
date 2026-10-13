import { useState, useMemo, useEffect, useCallback } from "react";
import api from "../services/mockApi";
import { Department, Role, AvatarAsset } from "../types";
import { useAuth } from "../hooks/useAuth";
import SingleSelect from "./ui/SingleSelect";
import AvatarPicker from "./AvatarPicker";
import { useAvatarLibrary } from "../hooks/useAvatarLibrary";
import { FRAME_OPTIONS, getFrameClassName, DEFAULT_FRAME_ID } from "../constants/avatarFrames";

type ThemeMode = "dark" | "colorful" | "light";

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
    name: "Dark",
    gradient: "linear-gradient(135deg, rgba(13,16,35,0.95), rgba(27,31,56,0.95))",
    surface: "linear-gradient(160deg, rgba(17,24,39,0.75), rgba(15,23,42,0.55))",
    sectionBorder: "rgba(148, 163, 184, 0.2)",
    text: "#f8fafc",
    mutedText: "rgba(226, 232, 240, 0.78)",
    placeholder: "rgba(226, 232, 240, 0.58)",
    accent: "#6366f1",
    accentSoft: "rgba(99,102,241,0.25)",
    input: "rgba(15,23,42,0.6)",
    inputHover: "rgba(30,41,59,0.75)",
    dropdown: "rgba(15,23,42,0.92)",
    chipBg: "rgba(99,102,241,0.18)",
    chipText: "#c4c6ff",
    chipBorder: "rgba(99,102,241,0.55)",
    chipHover: "rgba(99,102,241,0.28)",
    ring: "rgba(99,102,241,0.35)",
    shadow: "0 40px 90px rgba(15,23,42,0.65)",
    sectionShadow: "0 20px 45px rgba(15,23,42,0.35)",
    glowOne: "rgba(99,102,241,0.3)",
    glowTwo: "rgba(56,189,248,0.22)",
  },
  colorful: {
    name: "Colorful",
    gradient: "linear-gradient(135deg, rgba(217,70,239,0.85), rgba(59,130,246,0.85), rgba(139,92,246,0.85))",
    surface: "linear-gradient(160deg, rgba(255,255,255,0.9), rgba(241,245,249,0.8))",
    sectionBorder: "rgba(79, 70, 229, 0.25)",
    text: "#111827",
    mutedText: "rgba(55, 65, 81, 0.6)",
    placeholder: "rgba(71, 85, 105, 0.4)",
    accent: "#db2777",
    accentSoft: "rgba(219,39,119,0.2)",
    input: "rgba(255,255,255,0.92)",
    inputHover: "rgba(255,255,255,1)",
    dropdown: "rgba(255,255,255,0.98)",
    chipBg: "rgba(59,130,246,0.2)",
    chipText: "#1e3a8a",
    chipBorder: "rgba(59,130,246,0.35)",
    chipHover: "rgba(59,130,246,0.3)",
    ring: "rgba(219,39,119,0.25)",
    shadow: "0 35px 100px rgba(59,130,246,0.35)",
    sectionShadow: "0 18px 45px rgba(59,130,246,0.28)",
    glowOne: "rgba(217,70,239,0.3)",
    glowTwo: "rgba(59,130,246,0.28)",
  },
  light: {
    name: "Light",
    gradient: "linear-gradient(135deg, rgba(248,250,252,0.95), rgba(226,232,240,0.92))",
    surface: "linear-gradient(160deg, rgba(255,255,255,0.96), rgba(241,245,249,0.92))",
    sectionBorder: "rgba(148, 163, 184, 0.35)",
    text: "#0f172a",
    mutedText: "rgba(30, 41, 59, 0.55)",
    placeholder: "rgba(100, 116, 139, 0.4)",
    accent: "#0ea5e9",
    accentSoft: "rgba(14,165,233,0.18)",
    input: "rgba(248,250,252,0.95)",
    inputHover: "rgba(255,255,255,1)",
    dropdown: "rgba(255,255,255,0.98)",
    chipBg: "rgba(14,165,233,0.12)",
    chipText: "#0369a1",
    chipBorder: "rgba(14,165,233,0.35)",
    chipHover: "rgba(14,165,233,0.22)",
    ring: "rgba(14,165,233,0.3)",
    shadow: "0 30px 80px rgba(148,163,184,0.3)",
    sectionShadow: "0 16px 40px rgba(148,163,184,0.24)",
    glowOne: "rgba(14,165,233,0.25)",
    glowTwo: "rgba(236,72,153,0.22)",
  },
};

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated: (newDepartments?: Department[]) => void;
  departments: Department[];
}

// ✅ Core component remains the same, keep everything else as-is from your version
// ⛔ Do NOT add “import React from 'react'” if using Vite with React 17+
// JSX transform automatically handles React scope now.

const CreateUserModal: React.FC<CreateUserModalProps> = ({ isOpen, onClose, onUserCreated, departments }) => {
    const { user: currentUser } = useAuth();

    const initialDepartment = departments.length > 0 ? departments[0].name : 'add_new';

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [employerId, setEmployerId] = useState('');
    const [role, setRole] = useState<Role>(Role.USER);
    const [department, setDepartment] = useState(initialDepartment);
    const [newDepartmentName, setNewDepartmentName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [themeMode, setThemeMode] = useState<ThemeMode>('dark');

    const { avatars, loading: avatarsLoading } = useAvatarLibrary();
    const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [customAvatarDataUrl, setCustomAvatarDataUrl] = useState<string | null>(null);
    const [avatarFrame, setAvatarFrame] = useState<string>(DEFAULT_FRAME_ID);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const theme = THEME_MODES[themeMode];
    const previewFrameClass = useMemo(() => getFrameClassName(avatarFrame, role), [avatarFrame, role]);

    const handleSelectAvatar = useCallback((asset: AvatarAsset) => {
        setCustomAvatarDataUrl(null);
        setAvatarAssetId(asset.id);
        setAvatarPreview(asset.url ?? asset.externalUrl ?? null);
    }, []);

    const handleCustomAvatarCropped = useCallback(async (dataUrl: string) => {
        setCustomAvatarDataUrl(dataUrl);
        setAvatarAssetId(null);
        setAvatarPreview(dataUrl);
    }, []);

    const handleClearAvatar = useCallback(() => {
        setAvatarAssetId(null);
        setAvatarPreview(null);
        setCustomAvatarDataUrl(null);
    }, []);

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

    const roleOptions = useMemo(() => {
        const options = [
            { id: Role.USER, name: 'User' },
            { id: Role.ADMIN, name: 'Admin' },
            { id: Role.MANAGER, name: 'Manager' },
        ];
        if (currentUser?.role === Role.OWNER) {
            options.push({ id: Role.OWNER, name: 'Owner' });
        }
        return options;
    }, [currentUser]);

    const departmentOptions = useMemo(() => {
        const options = departments.map((dept) => ({ id: dept.name, name: dept.name }));
        options.push({ id: 'add_new', name: '+ Add New Department' });
        return options;
    }, [departments]);

    const fieldClass = 'modal-input w-full text-sm';
    const labelClass = 'modal-label text-xs uppercase tracking-[0.25em]';
    const sectionClass = 'modal-section rounded-3xl border p-5 backdrop-blur-xl';

    const resetForm = () => {
        setName('');
        setEmail('');
        setPassword('');
        setEmployerId('');
        setRole(Role.USER);
        setDepartment(initialDepartment);
        setNewDepartmentName('');
        setError('');
        setIsSubmitting(false);
        setAvatarAssetId(null);
        setAvatarPreview(null);
        setCustomAvatarDataUrl(null);
        setAvatarFrame(DEFAULT_FRAME_ID);
        setAvatarUploading(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleUseEmailAsEmployerId = () => {
        if (!email.includes('@')) return;
        const identifier = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        setEmployerId(identifier);
    };

    const handleGenerateEmployerId = () => {
        const randomId = `EMP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        setEmployerId(randomId);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) {
            setError('Authentication error.');
            return;
        }
        setIsSubmitting(true);
        setError('');

        try {
            let finalDepartment = department;
            let newDepartmentsList: Department[] | undefined;

            if (department === 'add_new') {
                if (!newDepartmentName.trim()) {
                    setError('New department name cannot be empty.');
                    setIsSubmitting(false);
                    return;
                }
                const newDept = await api.addDepartment(newDepartmentName.trim());
                finalDepartment = newDept.name;
                newDepartmentsList = [...departments, newDept];
            }

            let createdUser = await api.createUser(
                {
                    name,
                    email,
                    password,
                    employerId: employerId || null,
                    role,
                    department: finalDepartment,
                    avatarAssetId,
                    avatarFrame,
                },
                currentUser.id,
            );

            let avatarUploadFailed = false;
            if (customAvatarDataUrl) {
                try {
                    setAvatarUploading(true);
                    createdUser = await api.uploadUserAvatar(createdUser.id, customAvatarDataUrl);
                } catch (uploadError: any) {
                    avatarUploadFailed = true;
                    setError(
                        uploadError?.message ??
                            'User created, but we could not save the avatar. You can retry from Edit User.',
                    );
                } finally {
                    setAvatarUploading(false);
                }
            }

            onUserCreated(newDepartmentsList);
            if (avatarUploadFailed) {
                return;
            }
            handleClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create user. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div
                className="user-modal relative flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border transition duration-300"
                style={modalStyle}
                data-theme={themeMode}
            >
                <div
                    className="pointer-events-none absolute -right-12 top-0 h-56 w-56 rounded-full blur-3xl"
                    style={{ background: theme.glowOne }}
                />
                <div
                    className="pointer-events-none absolute -left-16 bottom-[-40px] h-48 w-48 rounded-full blur-3xl"
                    style={{ background: theme.glowTwo }}
                />

                <header className="relative border-b px-6 py-5" style={{ borderColor: 'var(--modal-border)' }}>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
                    >
                        Close
                    </button>
                    <div className="flex flex-col gap-4 pr-24 sm:flex-row sm:items-center sm:justify-between sm:pr-32">
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.35em] modal-muted">New teammate</p>
                            <h2 className="text-2xl font-bold tracking-tight">Create User</h2>
                            <p className="max-w-md text-sm modal-muted">
                                Configure the essentials before inviting a new squad member aboard.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="theme-toggle text-xs font-semibold">
                                {(['dark', 'colorful', 'light'] as ThemeMode[]).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setThemeMode(mode)}
                                        className={`min-w-[84px] px-3 py-1 transition duration-150 ${themeMode === mode ? 'active-theme' : ''}`}
                                    >
                                        {THEME_MODES[mode].name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </header>

                <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-6">
                    <form onSubmit={handleSubmit} className="space-y-6 pb-4">
                        <section className={sectionClass}>
                            <p className="section-heading">Identity</p>
                            <div className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="name" className={labelClass}>Full name</label>
                                    <input
                                        id="name"
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        className={`${fieldClass} mt-2`}
                                        placeholder="e.g. Alex Mercer"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="email" className={labelClass}>Email address</label>
                                    <input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className={`${fieldClass} mt-2`}
                                        placeholder="alex@example.com"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="password" className={labelClass}>Password</label>
                                    <input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className={`${fieldClass} mt-2`}
                                        placeholder="Enter a secure password"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="employerId" className={labelClass}>Employer ID</label>
                                    <input
                                        id="employerId"
                                        type="text"
                                        value={employerId}
                                        onChange={(e) => setEmployerId(e.target.value)}
                                        className={`${fieldClass} mt-2`}
                                        placeholder="Optional identifier"
                                    />
                                    <div className="modal-quick-actions mt-3">
                                        <button type="button" onClick={handleGenerateEmployerId} className="modal-quick-action">Generate</button>
                                        <button type="button" onClick={handleUseEmailAsEmployerId} className="modal-quick-action">Use email</button>
                                        {employerId && (
                                            <button type="button" onClick={() => setEmployerId('')} className="modal-quick-action">Clear</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className={sectionClass}>
                            <p className="section-heading">Profile appearance</p>
                            <div className="mt-4 space-y-6">
                                <AvatarPicker
                                    avatars={avatars}
                                    loading={avatarsLoading}
                                    selectedAvatarId={avatarAssetId}
                                    selectedAvatarUrl={avatarPreview}
                                    customPreviewUrl={customAvatarDataUrl}
                                    onSelectAvatar={handleSelectAvatar}
                                    onRequestClear={handleClearAvatar}
                                    onCustomAvatarCropped={handleCustomAvatarCropped}
                                    uploading={avatarUploading}
                                    previewClassName={previewFrameClass}
                                />

                                <div className="space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] modal-muted">Avatar frame</p>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        {FRAME_OPTIONS.map((option) => {
                                            const isActive = avatarFrame === option.id;
                                            const frameClass = getFrameClassName(option.id, role);
                                            return (
                                                <button
                                                    key={option.id}
                                                    type="button"
                                                    onClick={() => setAvatarFrame(option.id)}
                                                    className={`group rounded-xl border px-3 py-3 text-left transition ${
                                                        isActive
                                                            ? 'border-indigo-500/80 bg-indigo-500/5 shadow-md shadow-indigo-500/20'
                                                            : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-500/5 dark:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm dark:bg-slate-900 ${frameClass}`}
                                                        >
                                                            {(avatarPreview || customAvatarDataUrl) ? (
                                                                <img
                                                                    src={avatarPreview || customAvatarDataUrl}
                                                                    alt="Avatar frame preview"
                                                                    className="h-full w-full object-cover"
                                                                />
                                                                ) : (

                                                                <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                                                                    Frame
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">{option.label}</p>
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">{option.description}</p>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Rings are tinted automatically by role and glow brighter as badge streaks climb.
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className={sectionClass}>
                            <p className="section-heading">Access & department</p>
                            <div className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="role" className={labelClass}>Role</label>
                                    <SingleSelect
                                        id="role"
                                        options={roleOptions}
                                        value={role}
                                        onChange={(value) => setRole(value as Role)}
                                        placeholder="Select role..."
                                        className="mt-2"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="department" className={labelClass}>Department</label>
                                    <SingleSelect
                                        id="department"
                                        options={departmentOptions}
                                        value={department}
                                        onChange={setDepartment}
                                        placeholder="Select department..."
                                        className="mt-2"
                                    />
                                    {department === 'add_new' && (
                                        <input
                                            type="text"
                                            value={newDepartmentName}
                                            onChange={(e) => setNewDepartmentName(e.target.value)}
                                            className={`${fieldClass} mt-3`}
                                            placeholder="New department name"
                                        />
                                    )}
                                </div>
                            </div>
                        </section>

                        {error && (
                            <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
                                {error}
                            </p>
                        )}

                        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
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
                                {isSubmitting ? 'Creating...' : 'Create user'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default CreateUserModal;






