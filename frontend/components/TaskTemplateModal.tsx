import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TaskTemplate, TaskTemplateAssignmentType, TaskTemplateAssignRequest, TaskPriority, User, Department, RecurrenceRule, Role } from '../types';
import { useAuth } from '../hooks/useAuth';
import api from '../services/mockApi';
import { formatRecurrenceRule } from '../utils';
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon } from './icons';

interface TaskTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateAssigned?: () => void;
}

type ThemeMode = 'dark' | 'colorful' | 'light';

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
    dropdown: 'rgba(15,23,42,0.92)',
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
const TaskTemplateModal: React.FC<TaskTemplateModalProps> = ({ isOpen, onClose, onTemplateAssigned }) => {
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assigningTemplate, setAssigningTemplate] = useState<TaskTemplate | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<TaskTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const theme = THEME_MODES[themeMode];
  const canManageTemplates = !!user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role);

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

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: TaskPriority.MEDIUM,
    team: 'General',
    subtasks: [] as string[],
    attachments: [] as string[],
    estimatedHours: null as number | null,
    tags: [] as string[],
    featuredImage: null as File | null,
    departmentId: null as string | null,
    recurrenceRule: RecurrenceRule.NONE,
  });

  // Assignment state
  const [assignData, setAssignData] = useState<TaskTemplateAssignRequest>({
    assignmentType: TaskTemplateAssignmentType.SINGLE,
    userIds: [],
    departmentId: undefined,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [fetchedUsers, fetchedDepartments, fetchedTemplates] = await Promise.all([
        api.getUsers(),
        api.getDepartments(),
        api.getTaskTemplates(),
      ]);
      setUsers(fetchedUsers);
      setDepartments(fetchedDepartments);
      setTemplates(fetchedTemplates);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      priority: TaskPriority.MEDIUM,
      team: 'General',
      subtasks: [],
      attachments: [],
      estimatedHours: null,
      tags: [],
      featuredImage: null,
      departmentId: null,
      recurrenceRule: RecurrenceRule.NONE,
    });
    setEditingTemplate(null);
  };

  const handleCreate = () => {
    if (!canManageTemplates) return;
    resetForm();
    setShowForm(true);
  };

  const handleEdit = (template: TaskTemplate) => {
    if (!canManageTemplates) return;
    setFormData({
      title: template.title,
      description: template.description,
      priority: template.priority,
      team: template.team,
      subtasks: template.subtasks,
      attachments: template.attachments,
      estimatedHours: template.estimatedHours,
      tags: template.tags,
      featuredImage: null, // Can't pre-fill file input
      departmentId: template.departmentId,
      recurrenceRule: template.recurrenceRule,
    });
    setEditingTemplate(template);
    setShowForm(true);
  };

  const handleDelete = async (templateId: string) => {
    if (!canManageTemplates) return;
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      await api.deleteTaskTemplate(templateId);
      setTemplates(prev => prev.filter(t => t.id !== templateId));
    } catch (error) {
      console.error('Failed to delete template:', error);
      alert('Failed to delete template');
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const templateData = {
        ...formData,
        featuredImage: formData.featuredImage || undefined,
      };

      if (editingTemplate) {
        const updated = await api.updateTaskTemplate(editingTemplate.id, templateData);
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? updated : t));
      } else {
        const created = await api.createTaskTemplate(templateData);
        setTemplates(prev => [...prev, created]);
      }

      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save template:', error);
      alert('Failed to save template');
    }
  };

  const handleAssign = (template: TaskTemplate) => {
    if (!canManageTemplates) return;
    setAssigningTemplate(template);
    setAssignData({
      assignmentType: TaskTemplateAssignmentType.SINGLE,
      userIds: [],
      departmentId: undefined,
    });
    setShowAssign(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningTemplate) return;

    try {
      await api.assignTaskTemplate(assigningTemplate.id, assignData);
      setShowAssign(false);
      setAssigningTemplate(null);
      onTemplateAssigned?.();
      alert('Template assigned successfully');
    } catch (error) {
      console.error('Failed to assign template:', error);
      alert('Failed to assign template');
    }
  };

  const addSubtask = () => {
    setFormData(prev => ({ ...prev, subtasks: [...prev.subtasks, ''] }));
  };

  const updateSubtask = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks.map((s, i) => i === index ? value : s)
    }));
  };

  const removeSubtask = (index: number) => {
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks.filter((_, i) => i !== index)
    }));
  };

  const addTag = () => {
    setFormData(prev => ({ ...prev, tags: [...prev.tags, ''] }));
  };

  const updateTag = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.map((t, i) => i === index ? value : t)
    }));
  };

  const removeTag = (index: number) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index)
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        alert('Image size must be less than 2MB');
        return;
      }
      setFormData(prev => ({ ...prev, featuredImage: file }));
    }
  };

  const activeUsers = users.filter(u => u.status === 'ACTIVE');

  // Filter templates based on search and category
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = searchQuery === '' ||
      template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' ||
      (selectedCategory === 'my-templates' && template.createdById === user?.id) ||
      (selectedCategory === 'department' && template.departmentId === user?.departmentId) ||
      template.team.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  // Get unique categories from templates
  const categories = ['all', 'my-templates', 'department', ...new Set(templates.map(t => t.team.toLowerCase()))];

  const handlePreview = (template: TaskTemplate) => {
    setPreviewTemplate(template);
    setShowPreview(true);
  };

  const sectionClass = 'modal-section rounded-3xl border p-5 backdrop-blur-xl';
  const labelClass = 'modal-label text-xs uppercase tracking-[0.25em]';
  const inputClass = 'modal-input w-full text-sm';
  const textareaClass = 'modal-input modal-textarea w-full text-sm';
  const quickButtonClass = 'modal-quick-action';
  const chipButtonClass = 'modal-chip-button inline-flex items-center gap-2 text-sm font-semibold';
  const featuredImagePreview = useMemo(() => {
    if (formData.featuredImage) {
      return URL.createObjectURL(formData.featuredImage);
    }
    return null;
  }, [formData.featuredImage]);

  useEffect(() => {
    return () => {
      if (featuredImagePreview) {
        URL.revokeObjectURL(featuredImagePreview);
      }
    };
  }, [featuredImagePreview]);

  const previewTemplateImageSrc = useMemo(() => {
    if (!previewTemplate?.featuredImage) return null;
    if (typeof previewTemplate.featuredImage === 'string') {
      return previewTemplate.featuredImage;
    }
    return URL.createObjectURL(previewTemplate.featuredImage);
  }, [previewTemplate]);

  useEffect(() => {
    return () => {
      if (
        previewTemplateImageSrc &&
        previewTemplate?.featuredImage &&
        typeof previewTemplate.featuredImage !== 'string'
      ) {
        URL.revokeObjectURL(previewTemplateImageSrc);
      }
    };
  }, [previewTemplateImageSrc, previewTemplate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="template-modal relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border transition duration-300"
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

        <header className="relative border-b px-6 py-5" style={{ borderColor: 'var(--modal-border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
          >
            Close
          </button>
          <div className="flex flex-col gap-4 pr-28 lg:flex-row lg:items-center lg:justify-between lg:pr-32">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] modal-muted">Blueprint hub</p>
              <h2 className="text-3xl font-bold tracking-tight">Task Templates</h2>
              <p className="max-w-2xl text-sm modal-muted">
                Curate reusable quests, then assign them to squads or departments when the mission calls.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="theme-toggle text-xs font-semibold">
                {(['dark', 'colorful', 'light'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setThemeMode(mode)}
                    className={`min-w-[88px] px-3 py-1 transition duration-150 ${themeMode === mode ? 'active-theme' : ''}`}
                  >
                    {THEME_MODES[mode].name}
                  </button>
                ))}
              </div>
              {canManageTemplates && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className={`${chipButtonClass} px-4 py-2`}
                >
                  <PlusIcon className="h-4 w-4" />
                  New Template
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-6">
          {loading ? (
            <div className="modal-plain-card muted py-10 text-center text-sm">
              Loading templates...
            </div>
          ) : (
            <div className="space-y-6 pb-12">
              <section className={sectionClass}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
                    <input
                      type="text"
                      placeholder="Search by title, description, or tag..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`${inputClass} flex-1`}
                    />
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className={`${inputClass} lg:w-64`}
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category === 'all'
                            ? 'All templates'
                            : category === 'my-templates'
                              ? 'My templates'
                              : category === 'department'
                                ? 'Department'
                                : `${category.charAt(0).toUpperCase()}${category.slice(1)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-sm modal-muted">
                    {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''} available
                  </span>
                </div>
              </section>

              <section className={sectionClass}>
                <div className="space-y-4">
                  {filteredTemplates.length === 0 ? (
                    <div className="modal-plain-card muted py-10 text-center text-sm">
                      No templates yet. Craft a new template to share repeatable missions with the team.
                    </div>
                  ) : (
                    filteredTemplates.map((template) => (
                      <div key={template.id} className="modal-plain-card space-y-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--modal-border)] bg-[var(--modal-input-bg)]">
                                {template.featuredImage ? (
                                  <img
                                    src={
                                      typeof template.featuredImage === 'string'
                                        ? template.featuredImage
                                        : URL.createObjectURL(template.featuredImage)
                                    }
                                    alt={template.title}
                                    className="h-full w-full rounded-full object-cover"
                                  />
                                ) : (
                                  <span className="text-sm font-semibold text-[var(--modal-muted)]">
                                    {template.title.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold text-[var(--modal-text)]">{template.title}</h3>
                                <p className="mt-1 text-sm modal-muted">
                                  {template.description || 'No description provided yet.'}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs modal-muted">
                              <span>Priority: {template.priority}</span>
                              <span>Team: {template.team}</span>
                              {template.estimatedHours && <span>{template.estimatedHours}h estimate</span>}
                              {template.department?.name && <span>Dept: {template.department.name}</span>}
                              <span>Recurs: {formatRecurrenceRule(template.recurrenceRule)}</span>
                            </div>
                            {template.tags.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {template.tags.map((tag, index) => (
                                  <span key={index} className="modal-chip text-xs">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
                            <button
                              type="button"
                              onClick={() => handlePreview(template)}
                              className={`${quickButtonClass} px-3 py-1 text-xs`}
                            >
                              Preview
                            </button>
                            {canManageTemplates && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAssign(template)}
                                  className={`${quickButtonClass} px-3 py-1 text-xs`}
                                >
                                  Assign
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(template)}
                                  className={`${quickButtonClass} px-3 py-1 text-xs`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(template.id)}
                                  className={`${quickButtonClass} px-3 py-1 text-xs text-rose-300`}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Create/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div
              className="template-modal relative flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border transition duration-300"
              style={modalStyle}
              data-theme={themeMode}
            >
              <header className="relative border-b px-6 py-5" style={{ borderColor: 'var(--modal-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
                <h3 className="text-2xl font-semibold">
                  {editingTemplate ? 'Edit Template' : 'Create Template'}
                </h3>
                <p className="mt-2 text-sm modal-muted">
                  Build a reusable mission with subtasks, tags, and optional scheduling.
                </p>
              </header>

              <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-6">
                <form onSubmit={handleFormSubmit} className="space-y-5 pb-4">
                  <section className={sectionClass}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className={labelClass}>Title</label>
                        <input
                          type="text"
                          value={formData.title}
                          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                          className={`${inputClass} mt-2`}
                          required
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>Description</label>
                        <textarea
                          value={formData.description}
                          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                          className={`${textareaClass} mt-2`}
                          rows={3}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Priority</label>
                        <select
                          value={formData.priority}
                          onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as TaskPriority }))}
                          className={`${inputClass} mt-2`}
                        >
                          {Object.values(TaskPriority).map((priority) => (
                            <option key={priority} value={priority}>{priority}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Team</label>
                        <input
                          type="text"
                          value={formData.team}
                          onChange={(e) => setFormData(prev => ({ ...prev, team: e.target.value }))}
                          className={`${inputClass} mt-2`}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Department</label>
                        <select
                          value={formData.departmentId || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, departmentId: e.target.value || null }))}
                          className={`${inputClass} mt-2`}
                        >
                          <option value="">No department</option>
                          {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>{dept.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Estimated hours</label>
                        <input
                          type="number"
                          value={formData.estimatedHours ?? ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, estimatedHours: e.target.value ? Number(e.target.value) : null }))}
                          className={`${inputClass} mt-2`}
                          min="0"
                          step="0.5"
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Recurrence</label>
                        <select
                          value={formData.recurrenceRule}
                          onChange={(e) => setFormData(prev => ({ ...prev, recurrenceRule: e.target.value as RecurrenceRule }))}
                          className={`${inputClass} mt-2`}
                        >
                          {Object.values(RecurrenceRule).map((rule) => (
                            <option key={rule} value={rule}>{formatRecurrenceRule(rule)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>Featured image (optional, max 2MB)</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="mt-2 w-full text-sm modal-muted file:mr-4 file:rounded-full file:border-0 file:bg-[var(--modal-accent-soft)] file:px-4 file:py-2 file:text-[var(--modal-accent)] hover:file:bg-[var(--modal-accent-soft)]/80"
                        />
                        {formData.featuredImage && featuredImagePreview && (
                          <div className="mt-3 flex items-center gap-3">
                            <img
                              src={featuredImagePreview}
                              alt="Preview"
                              className="h-16 w-16 rounded-full border border-[var(--modal-border)] object-cover"
                            />
                            <p className="text-xs modal-muted truncate">{formData.featuredImage.name}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className={sectionClass}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--modal-text)]">Subtasks</span>
                      <button type="button" onClick={addSubtask} className={`${chipButtonClass} px-4 py-2`}>
                        <PlusIcon className="h-4 w-4" />
                        Add subtask
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {formData.subtasks.length === 0 && (
                        <p className="modal-plain-card muted text-sm">No subtasks yet.</p>
                      )}
                      {formData.subtasks.map((subtask, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <input
                            value={subtask}
                            onChange={(e) => updateSubtask(index, e.target.value)}
                            className={`${inputClass} flex-1`}
                          />
                          <button
                            type="button"
                            onClick={() => removeSubtask(index)}
                            className="modal-remove-button"
                            aria-label="Remove subtask"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={sectionClass}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--modal-text)]">Tags</span>
                      <button type="button" onClick={addTag} className={`${chipButtonClass} px-4 py-2`}>
                        <PlusIcon className="h-4 w-4" />
                        Add tag
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {formData.tags.length === 0 && (
                        <p className="modal-plain-card muted text-sm">No tags yet.</p>
                      )}
                      {formData.tags.map((tag, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <input
                            value={tag}
                            onChange={(e) => updateTag(index, e.target.value)}
                            className={`${inputClass} flex-1`}
                          />
                          <button
                            type="button"
                            onClick={() => removeTag(index)}
                            className="modal-remove-button"
                            aria-label="Remove tag"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="modal-secondary-button px-4 py-2 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="modal-primary-button px-6 py-2 text-sm font-semibold">
                      {editingTemplate ? 'Update Template' : 'Create Template'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}        {/* Assign Modal */}
        {showAssign && assigningTemplate && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div
              className="template-modal relative flex h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border transition duration-300"
              style={modalStyle}
              data-theme={themeMode}
            >
              <header className="relative border-b px-6 py-5" style={{ borderColor: 'var(--modal-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowAssign(false)}
                  className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
                <h3 className="text-2xl font-semibold">Assign Template</h3>
                <p className="mt-2 text-sm modal-muted">
                  Assigning: <strong>{assigningTemplate.title}</strong>
                </p>
              </header>

              <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-6">
                <form onSubmit={handleAssignSubmit} className="space-y-5 pb-4">
                  <section className={sectionClass}>
                    <p className="text-sm modal-muted">Choose who should receive this mission.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { label: 'Single user', value: TaskTemplateAssignmentType.SINGLE },
                        { label: 'Multiple users', value: TaskTemplateAssignmentType.MULTIPLE },
                        { label: 'Department', value: TaskTemplateAssignmentType.DEPARTMENT },
                      ].map((option) => (
                        <button
                          type="button"
                          key={option.value}
                          onClick={() => setAssignData(prev => ({ ...prev, assignmentType: option.value }))}
                          className={`${quickButtonClass} px-3 py-1 text-xs ${assignData.assignmentType === option.value ? 'active-theme' : ''}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  {assignData.assignmentType === TaskTemplateAssignmentType.SINGLE && (
                    <section className={sectionClass}>
                      <label className={labelClass}>Select user</label>
                      <select
                        value={assignData.userIds?.[0] || ''}
                        onChange={(e) => setAssignData(prev => ({ ...prev, userIds: e.target.value ? [e.target.value] : [] }))}
                        className={`${inputClass} mt-2`}
                        required
                      >
                        <option value="">Choose a user</option>
                        {activeUsers.map((activeUser) => (
                          <option key={activeUser.id} value={activeUser.id}>{activeUser.name}</option>
                        ))}
                      </select>
                    </section>
                  )}

                  {assignData.assignmentType === TaskTemplateAssignmentType.MULTIPLE && (
                    <section className={sectionClass}>
                      <label className={labelClass}>Select users</label>
                      <div className="mt-3 max-h-40 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                        {activeUsers.map((activeUser) => {
                          const checked = assignData.userIds?.includes(activeUser.id) || false;
                          return (
                            <label key={activeUser.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--modal-border)] px-3 py-2">
                              <span className="text-sm">{activeUser.name}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setAssignData(prev => ({
                                    ...prev,
                                    userIds: isChecked
                                      ? [...(prev.userIds || []), activeUser.id]
                                      : (prev.userIds || []).filter(id => id !== activeUser.id),
                                  }));
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {assignData.assignmentType === TaskTemplateAssignmentType.DEPARTMENT && (
                    <section className={sectionClass}>
                      <label className={labelClass}>Select department</label>
                      <select
                        value={assignData.departmentId || ''}
                        onChange={(e) => setAssignData(prev => ({ ...prev, departmentId: e.target.value }))}
                        className={`${inputClass} mt-2`}
                        required
                      >
                        <option value="">Choose a department</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>{dept.name}</option>
                        ))}
                      </select>
                    </section>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAssign(false)}
                      className="modal-secondary-button px-4 py-2 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="modal-primary-button px-6 py-2 text-sm font-semibold">
                      Assign Template
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}        {/* Preview Modal */}
        {showPreview && previewTemplate && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div
              className="template-modal relative flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border transition duration-300"
              style={modalStyle}
              data-theme={themeMode}
            >
              <header className="relative border-b px-6 py-5" style={{ borderColor: 'var(--modal-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="modal-secondary-button absolute right-6 top-5 px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
                <h3 className="text-2xl font-semibold">Template Preview</h3>
                <p className="mt-2 text-sm modal-muted">A quick look at the mission blueprint.</p>
              </header>

              <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-6">
                <div className="space-y-5 pb-4">
                  <section className={sectionClass}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--modal-border)] bg-[var(--modal-input-bg)]">
                        {previewTemplateImageSrc ? (
                          <img
                            src={previewTemplateImageSrc}
                            alt={previewTemplate.title}
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : (
                          <span className="text-base font-semibold text-[var(--modal-muted)]">
                            {previewTemplate.title.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-[var(--modal-text)]">{previewTemplate.title}</h4>
                        <p className="mt-2 text-sm modal-muted">{previewTemplate.description || 'No description provided.'}</p>
                      </div>
                    </div>
                  </section>

                  <section className={sectionClass}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <span className={labelClass}>Priority</span>
                        <p className="mt-2 text-sm">{previewTemplate.priority}</p>
                      </div>
                      <div>
                        <span className={labelClass}>Team</span>
                        <p className="mt-2 text-sm">{previewTemplate.team}</p>
                      </div>
                      <div>
                        <span className={labelClass}>Estimated hours</span>
                        <p className="mt-2 text-sm">{previewTemplate.estimatedHours ?? 'Not specified'}</p>
                      </div>
                      <div>
                        <span className={labelClass}>Department</span>
                        <p className="mt-2 text-sm">{previewTemplate.department?.name ?? 'Not specified'}</p>
                      </div>
                      <div>
                        <span className={labelClass}>Recurrence</span>
                        <p className="mt-2 text-sm">{formatRecurrenceRule(previewTemplate.recurrenceRule)}</p>
                      </div>
                    </div>
                  </section>

                  {previewTemplate.subtasks.length > 0 && (
                    <section className={sectionClass}>
                      <span className={labelClass}>Subtasks</span>
                      <ul className="mt-3 space-y-2 text-sm">
                        {previewTemplate.subtasks.map((subtask, index) => (
                          <li key={index} className="modal-plain-card">{subtask}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {previewTemplate.tags.length > 0 && (
                    <section className={sectionClass}>
                      <span className={labelClass}>Tags</span>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {previewTemplate.tags.map((tag, index) => (
                          <span key={index} className="modal-chip text-xs">{tag}</span>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskTemplateModal;
