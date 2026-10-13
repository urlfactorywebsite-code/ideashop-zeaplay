import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  User,
  Department,
  Role,
  UserStatus,
  Task,
  TaskStatus,
  DataExportScope,
  DataImportPayload,
  CUSTOM_STATUS_NAMES,
  TaskTransferPayload,
} from '../types';
import { usePresence } from '../hooks/usePresence';
import api from '../services/mockApi';
import { useAuth, useSearch } from '../hooks/useAuth';
import {
  PlusIcon,
  PencilIcon,
  KeyIcon,
  UserCircleIcon,
  NoSymbolIcon,
  CheckCircleIcon,
  EllipsisVerticalIcon,
  StarIcon,
  TrashIcon,
} from '../components/icons';
import CreateUserModal from '../components/CreateUserModal';
import EditUserModal from '../components/EditUserModal';
import PageLoader from '../components/loading/PageLoader';
import ChangeRoleModal from '../components/ChangeRoleModal';
import ResetPasswordModal from '../components/ResetPasswordModal';
import UserStatusBadge from '../components/ui/UserStatusBadge';
import OrganizationTreeSection from '../components/OrganizationTreeSection';
import { augmentTasksWithPoints, calculateUserPointsFromTasks } from '../utils/taskPoints';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { APP_REFRESH_EVENT } from '../utils/appEvents';
import { getUserAvatarUrl } from '../utils/userAvatar';

const XP_PER_LEVEL = 750;
const PROFILE_STORAGE_KEY = 'org-user-profiles-v1';
const MANAGER_STORAGE_KEY = 'org-user-managers-v1';

type UserProfile = {
  title?: string;
  phone?: string;
  location?: string;
  timezone?: string;
  managerEmail?: string;
  shiftName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  morningBreakStart?: string;
  morningBreakEnd?: string;
  lunchBreakStart?: string;
  lunchBreakEnd?: string;
  eveningBreakStart?: string;
  eveningBreakEnd?: string;
  notes?: string;
  skills?: string[];
  projects?: string[];
};

const parseTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const tagListToString = (items?: string[]) => (items && items.length > 0 ? items.join(', ') : '');

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importReport, setImportReport] = useState<{
    title: string;
    added: string[];
    existing: string[];
    scope: 'users' | 'departments';
  } | null>(null);
  const { user: currentUser } = useAuth();
  const { debouncedSearchQuery } = useSearch();
  const { onlineUserIds, status: presenceStatus } = usePresence();
  const [activeSection, setActiveSection] = useState<'list' | 'org' | 'deactivated'>('list');
  const canEditContacts = currentUser?.role === Role.OWNER;

  // Filter states
  const [employerIdFilter, setEmployerIdFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [changingRoleUser, setChangingRoleUser] = useState<User | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<User | null>(null);
  const [isDepartmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [departmentDraftName, setDepartmentDraftName] = useState('');
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState('');
  const [departmentActionLoading, setDepartmentActionLoading] = useState(false);
  const [departmentActionError, setDepartmentActionError] = useState<string | null>(null);
  const [isTransferModalOpen, setTransferModalOpen] = useState(false);
  const [transferFromUserId, setTransferFromUserId] = useState('');
  const [transferToUserId, setTransferToUserId] = useState('');
  const [transferStatuses, setTransferStatuses] = useState<TaskStatus[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [contactUser, setContactUser] = useState<User | null>(null);
  const [isContactEditing, setContactEditing] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: '',
    employerId: '',
    department: '',
    role: Role.USER,
    managerId: '',
    managerEmail: '',
    shiftName: '',
    shiftStart: '',
    shiftEnd: '',
    morningBreakStart: '',
    morningBreakEnd: '',
    lunchBreakStart: '',
    lunchBreakEnd: '',
    eveningBreakStart: '',
    eveningBreakEnd: '',
    title: '',
    phone: '',
    location: '',
    timezone: '',
    notes: '',
    skills: '',
    projects: '',
  });
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, UserProfile>>({});
  const [managerMap, setManagerMap] = useState<Record<string, string | null>>({});
  const [nameFilter, setNameFilter] = useState('');

  // Menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    flip?: boolean;
  } | null>(null);
  const userImportInputRef = useRef<HTMLInputElement | null>(null);
  const departmentImportInputRef = useRef<HTMLInputElement | null>(null);

  const csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const escaped = stringValue.replace(/"/g, '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const toCsv = (rows: Array<Record<string, unknown>>): string => {
    if (rows.length === 0) {
      return '';
    }
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const lines = [headers.join(',')];
    rows.forEach((row) => {
      lines.push(headers.map((key) => csvEscape(row[key])).join(','));
    });
    return lines.join('\n');
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
    return rows.map((values) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = values[index] ?? '';
      });
      return record;
    });
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

  const parseNumber = (value: string, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const parseNullableString = (value: string) => {
    if (!value || value.toLowerCase() === 'null') {
      return null;
    }
    return value;
  };

  const allTaskStatuses = useMemo(() => Object.values(TaskStatus) as TaskStatus[], []);

  const transferStatusCounts = useMemo(() => {
    const counts = new Map<TaskStatus, number>();
    if (!transferFromUserId) {
      return counts;
    }
    tasks.forEach((task) => {
      if (!task.assignedTo || !task.assignedTo.includes(transferFromUserId)) {
        return;
      }
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    });
    return counts;
  }, [tasks, transferFromUserId]);

  const transferPreviewCount = useMemo(() => {
    if (!transferFromUserId || transferStatuses.length === 0) {
      return 0;
    }
    const statusSet = new Set(transferStatuses);
    return tasks.reduce((count, task) => {
      if (!task.assignedTo || !task.assignedTo.includes(transferFromUserId)) {
        return count;
      }
      return statusSet.has(task.status) ? count + 1 : count;
    }, 0);
  }, [tasks, transferFromUserId, transferStatuses]);

  const fetchTasks = useCallback(async () => {
    if (!currentUser) {
      setTasks([]);
      return;
    }
    try {
      const fetchedTasks = await api.getTasks(currentUser.id, currentUser.role);
      setTasks(augmentTasksWithPoints(fetchedTasks, { config: loadPointsConfig() }));
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  }, [currentUser]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedUsers, fetchedDepartments] = await Promise.all([
        api.getUsers(),
        api.getDepartments(),
      ]);
      setUsers(fetchedUsers);
      setDepartments(fetchedDepartments);
    } catch (error) {
      console.error('Failed to fetch users or departments:', error);
    } finally {
      setLoading(false);
    }
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handleRefresh = () => {
      fetchData();
    };
    window.addEventListener(APP_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(APP_REFRESH_EVENT, handleRefresh);
    };
  }, [fetchData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const storedProfiles = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (storedProfiles) {
        setProfileMap(JSON.parse(storedProfiles));
      }
    } catch (error) {
      console.warn('Failed to load user profiles', error);
    }
    try {
      const storedManagers = window.localStorage.getItem(MANAGER_STORAGE_KEY);
      if (storedManagers) {
        setManagerMap(JSON.parse(storedManagers));
      }
    } catch (error) {
      console.warn('Failed to load manager map', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileMap));
    } catch (error) {
      console.warn('Failed to persist user profiles', error);
    }
  }, [profileMap]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(MANAGER_STORAGE_KEY, JSON.stringify(managerMap));
    } catch (error) {
      console.warn('Failed to persist manager map', error);
    }
  }, [managerMap]);

  useEffect(() => {
    const userIds = new Set(users.map((user) => user.id));
    setManagerMap((prev) => {
      const next: Record<string, string | null> = {};
      users.forEach((user) => {
        const managerId = user.managerId ?? prev[user.id] ?? null;
        next[user.id] = managerId && userIds.has(managerId) ? managerId : null;
      });
      return next;
    });
    setProfileMap((prev) => {
      const next: Record<string, UserProfile> = {};
      users.forEach((user) => {
        const profileFromUser: UserProfile = {
          title: user.title ?? undefined,
          phone: user.phone ?? undefined,
          location: user.location ?? undefined,
          timezone: user.timezone ?? undefined,
          managerEmail: user.managerEmail ?? undefined,
          shiftName: user.shiftName ?? undefined,
          shiftStart: user.shiftStart ?? undefined,
          shiftEnd: user.shiftEnd ?? undefined,
          morningBreakStart: user.morningBreakStart ?? undefined,
          morningBreakEnd: user.morningBreakEnd ?? undefined,
          lunchBreakStart: user.lunchBreakStart ?? undefined,
          lunchBreakEnd: user.lunchBreakEnd ?? undefined,
          eveningBreakStart: user.eveningBreakStart ?? undefined,
          eveningBreakEnd: user.eveningBreakEnd ?? undefined,
          notes: user.notes ?? undefined,
          skills: user.skills ?? undefined,
          projects: user.projects ?? undefined,
        };
        const existing = prev[user.id] ?? {};
        const merged = { ...existing, ...profileFromUser };
        if (Object.values(merged).some((value) => value !== undefined && value !== '')) {
          next[user.id] = merged;
        }
      });
      return next;
    });
  }, [users]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePointsConfigChange = () => {
      setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
    };

    window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
    return () => {
      window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
    };
  }, []);

  useEffect(() => {
    if (!contactUser) {
      return;
    }
    const profile = profileMap[contactUser.id] ?? {};
    const profileFromUser: UserProfile = {
      title: contactUser.title ?? undefined,
      phone: contactUser.phone ?? undefined,
      location: contactUser.location ?? undefined,
      timezone: contactUser.timezone ?? undefined,
      managerEmail: contactUser.managerEmail ?? undefined,
      shiftName: contactUser.shiftName ?? undefined,
      shiftStart: contactUser.shiftStart ?? undefined,
      shiftEnd: contactUser.shiftEnd ?? undefined,
      morningBreakStart: contactUser.morningBreakStart ?? undefined,
      morningBreakEnd: contactUser.morningBreakEnd ?? undefined,
      lunchBreakStart: contactUser.lunchBreakStart ?? undefined,
      lunchBreakEnd: contactUser.lunchBreakEnd ?? undefined,
      eveningBreakStart: contactUser.eveningBreakStart ?? undefined,
      eveningBreakEnd: contactUser.eveningBreakEnd ?? undefined,
      notes: contactUser.notes ?? undefined,
      skills: contactUser.skills ?? undefined,
      projects: contactUser.projects ?? undefined,
    };
    const mergedProfile = { ...profile, ...profileFromUser };
    setContactForm({
      name: contactUser.name,
      employerId: contactUser.employerId ?? '',
      department: contactUser.department ?? '',
      role: contactUser.role,
      managerId: contactUser.managerId ?? managerMap[contactUser.id] ?? '',
      managerEmail: mergedProfile.managerEmail ?? '',
      shiftName: mergedProfile.shiftName ?? '',
      shiftStart: mergedProfile.shiftStart ?? '',
      shiftEnd: mergedProfile.shiftEnd ?? '',
      morningBreakStart: mergedProfile.morningBreakStart ?? '',
      morningBreakEnd: mergedProfile.morningBreakEnd ?? '',
      lunchBreakStart: mergedProfile.lunchBreakStart ?? '',
      lunchBreakEnd: mergedProfile.lunchBreakEnd ?? '',
      eveningBreakStart: mergedProfile.eveningBreakStart ?? '',
      eveningBreakEnd: mergedProfile.eveningBreakEnd ?? '',
      title: mergedProfile.title ?? '',
      phone: mergedProfile.phone ?? '',
      location: mergedProfile.location ?? '',
      timezone: mergedProfile.timezone ?? '',
      notes: mergedProfile.notes ?? '',
      skills: tagListToString(mergedProfile.skills),
      projects: tagListToString(mergedProfile.projects),
    });
    setContactError(null);
  }, [contactUser, managerMap, profileMap]);

  const handleUserCreated = (newDepartments?: Department[]) => {
    fetchData();
    if (newDepartments) setDepartments(newDepartments);
  };

  const handleUserUpdated = (newDepartments?: Department[]) => {
    fetchData();
    if (newDepartments) setDepartments(newDepartments);
  };

  const handleOrgUserUpdated = (updatedUser: User) => {
    setUsers((prev) => prev.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
  };

  const handleOrgUserDeleted = (userId: string) => {
    setUsers((prev) => prev.filter((user) => user.id !== userId));
  };

  const resetDepartmentEditor = () => {
    setEditingDepartmentId(null);
    setEditingDepartmentName('');
  };

  const handleOpenDepartmentModal = () => {
    setDepartmentModalOpen(true);
    setDepartmentActionError(null);
    resetDepartmentEditor();
  };

  const handleCloseDepartmentModal = () => {
    setDepartmentModalOpen(false);
    setDepartmentDraftName('');
    setDepartmentActionError(null);
    resetDepartmentEditor();
  };

  const handleAddDepartment = async () => {
    const name = departmentDraftName.trim();
    if (!name) {
      setDepartmentActionError('Enter a department name.');
      return;
    }
    if (departments.some((dept) => dept.name.toLowerCase() === name.toLowerCase())) {
      setDepartmentActionError('Department already exists.');
      return;
    }
    setDepartmentActionLoading(true);
    setDepartmentActionError(null);
    try {
      const newDepartment = await api.addDepartment(name);
      setDepartments((prev) => [...prev, newDepartment].sort((a, b) => a.name.localeCompare(b.name)));
      setDepartmentDraftName('');
    } catch (error) {
      console.error('Failed to add department', error);
      setDepartmentActionError('Failed to add department.');
    } finally {
      setDepartmentActionLoading(false);
    }
  };

  const handleStartEditDepartment = (department: Department) => {
    setEditingDepartmentId(department.id);
    setEditingDepartmentName(department.name);
    setDepartmentActionError(null);
  };

  const handleSaveDepartment = async (department: Department) => {
    const name = editingDepartmentName.trim();
    if (!name) {
      setDepartmentActionError('Enter a department name.');
      return;
    }
    if (department.name === name) {
      resetDepartmentEditor();
      return;
    }
    if (departments.some((dept) => dept.id !== department.id && dept.name.toLowerCase() === name.toLowerCase())) {
      setDepartmentActionError('Department already exists.');
      return;
    }
    setDepartmentActionLoading(true);
    setDepartmentActionError(null);
    try {
      const updated = await api.updateDepartment(department.id, name);
      setDepartments((prev) =>
        prev.map((dept) => (dept.id === department.id ? updated : dept)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setUsers((prev) =>
        prev.map((user) => {
          if (user.departmentId === department.id || user.department === department.name) {
            return { ...user, department: updated.name, departmentId: updated.id };
          }
          return user;
        })
      );
      if (departmentFilter === department.name) {
        setDepartmentFilter(updated.name);
      }
      resetDepartmentEditor();
    } catch (error) {
      console.error('Failed to update department', error);
      setDepartmentActionError('Failed to update department.');
    } finally {
      setDepartmentActionLoading(false);
    }
  };

  const handleDeleteDepartment = async (department: Department) => {
    if (!window.confirm(`Delete department "${department.name}"? This cannot be undone.`)) {
      return;
    }
    setDepartmentActionLoading(true);
    setDepartmentActionError(null);
    try {
      await api.deleteDepartment(department.id);
      setDepartments((prev) => prev.filter((dept) => dept.id !== department.id));
      setUsers((prev) =>
        prev.map((user) => {
          if (user.departmentId === department.id || user.department === department.name) {
            return { ...user, department: '', departmentId: null };
          }
          return user;
        })
      );
      if (departmentFilter === department.name) {
        setDepartmentFilter('');
      }
      if (editingDepartmentId === department.id) {
        resetDepartmentEditor();
      }
    } catch (error) {
      console.error('Failed to delete department', error);
      setDepartmentActionError('Failed to delete department.');
    } finally {
      setDepartmentActionLoading(false);
    }
  };

  const openContactModal = (user: User) => {
    setOpenMenuId(null);
    setContactUser(user);
    setContactEditing(false);
    setContactError(null);
  };

  const closeContactModal = () => {
    setContactUser(null);
    setContactEditing(false);
    setContactLoading(false);
    setContactError(null);
  };

  const openTransferModal = () => {
    setTransferModalOpen(true);
    setTransferFromUserId('');
    setTransferToUserId('');
    setTransferStatuses(allTaskStatuses);
    setTransferError(null);
    setTransferSuccess(null);
  };

  const closeTransferModal = () => {
    setTransferModalOpen(false);
    setTransferFromUserId('');
    setTransferToUserId('');
    setTransferStatuses([]);
    setTransferLoading(false);
    setTransferError(null);
    setTransferSuccess(null);
  };

  const toggleTransferStatus = (status: TaskStatus) => {
    setTransferStatuses((prev) =>
      prev.includes(status) ? prev.filter((value) => value !== status) : [...prev, status]
    );
    setTransferSuccess(null);
  };

  const handleTransferTasks = async () => {
    if (!currentUser) return;
    if (!transferFromUserId || !transferToUserId) {
      setTransferError('Select a source and destination user.');
      return;
    }
    if (transferFromUserId === transferToUserId) {
      setTransferError('Source and destination users must be different.');
      return;
    }
    if (transferStatuses.length === 0) {
      setTransferError('Select at least one task status.');
      return;
    }
    setTransferLoading(true);
    setTransferError(null);
    setTransferSuccess(null);
    try {
      const payload: TaskTransferPayload = {
        fromUserId: transferFromUserId,
        toUserId: transferToUserId,
        statuses: transferStatuses,
      };
      const result = await api.transferUserTasks(payload);
      setTasks((prev) =>
        prev.map((task) => {
          if (!task.assignedTo || !task.assignedTo.includes(transferFromUserId)) {
            return task;
          }
          if (!transferStatuses.includes(task.status)) {
            return task;
          }
          return { ...task, assignedTo: [transferToUserId] };
        })
      );
      setTransferSuccess(`Transferred ${result.updatedCount} task(s).`);
    } catch (error) {
      console.error('Failed to transfer tasks', error);
      setTransferError('Failed to transfer tasks.');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleSaveContact = async () => {
    if (!contactUser || !currentUser) return;
    if (!canEditContacts) {
      setContactError('Only the owner can edit user details.');
      return;
    }

    const trimmedName = contactForm.name.trim();
    if (!trimmedName) {
      setContactError('Name is required.');
      return;
    }
    if (contactForm.managerId && contactForm.managerId === contactUser.id) {
      setContactError('User cannot report to themselves.');
      return;
    }

    const updates: Partial<User> = {};
    if (trimmedName !== contactUser.name) updates.name = trimmedName;
    if ((contactForm.employerId || '') !== (contactUser.employerId || '')) {
      updates.employerId = contactForm.employerId;
    }
    if ((contactForm.department || '') !== (contactUser.department || '')) {
      updates.department = contactForm.department;
    }
    if (contactForm.role !== contactUser.role) {
      updates.role = contactForm.role;
    }

    const profileUpdate: UserProfile = {
      title: contactForm.title.trim() || undefined,
      phone: contactForm.phone.trim() || undefined,
      location: contactForm.location.trim() || undefined,
      timezone: contactForm.timezone.trim() || undefined,
      managerEmail: contactForm.managerEmail.trim() || undefined,
      shiftName: contactForm.shiftName.trim() || undefined,
      shiftStart: contactForm.shiftStart.trim() || undefined,
      shiftEnd: contactForm.shiftEnd.trim() || undefined,
      morningBreakStart: contactForm.morningBreakStart.trim() || undefined,
      morningBreakEnd: contactForm.morningBreakEnd.trim() || undefined,
      lunchBreakStart: contactForm.lunchBreakStart.trim() || undefined,
      lunchBreakEnd: contactForm.lunchBreakEnd.trim() || undefined,
      eveningBreakStart: contactForm.eveningBreakStart.trim() || undefined,
      eveningBreakEnd: contactForm.eveningBreakEnd.trim() || undefined,
      notes: contactForm.notes.trim() || undefined,
      skills: parseTagInput(contactForm.skills),
      projects: parseTagInput(contactForm.projects),
    };

    const updatePayload: Partial<User> = {
      ...updates,
      managerId: contactForm.managerId,
      managerEmail: contactForm.managerEmail.trim(),
      shiftName: contactForm.shiftName.trim(),
      shiftStart: contactForm.shiftStart.trim(),
      shiftEnd: contactForm.shiftEnd.trim(),
      morningBreakStart: contactForm.morningBreakStart.trim(),
      morningBreakEnd: contactForm.morningBreakEnd.trim(),
      lunchBreakStart: contactForm.lunchBreakStart.trim(),
      lunchBreakEnd: contactForm.lunchBreakEnd.trim(),
      eveningBreakStart: contactForm.eveningBreakStart.trim(),
      eveningBreakEnd: contactForm.eveningBreakEnd.trim(),
      title: contactForm.title.trim(),
      phone: contactForm.phone.trim(),
      location: contactForm.location.trim(),
      timezone: contactForm.timezone.trim(),
      notes: contactForm.notes.trim(),
      skills: profileUpdate.skills,
      projects: profileUpdate.projects,
    };

    setContactLoading(true);
    setContactError(null);
    try {
      const updatedUser = await api.updateUser(contactUser.id, updatePayload, currentUser.id);
      setUsers((prev) => prev.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
      setProfileMap((prev) => ({ ...prev, [contactUser.id]: profileUpdate }));
      setManagerMap((prev) => ({ ...prev, [contactUser.id]: contactForm.managerId || null }));
      setContactUser(updatedUser);
      setContactEditing(false);
    } catch (error) {
      console.error('Failed to update user', error);
      setContactError('Failed to update user.');
    } finally {
      setContactLoading(false);
    }
  };

  const handleDeleteContactUser = async () => {
    if (!contactUser || !currentUser) return;
    if (!canEditContacts) {
      setContactError('Only the owner can delete users.');
      return;
    }
    if (!window.confirm(`Delete "${contactUser.name}"? This cannot be undone.`)) {
      return;
    }
    setContactLoading(true);
    setContactError(null);
    try {
      await api.deleteUser(contactUser.id, currentUser.id);
      setUsers((prev) => prev.filter((user) => user.id !== contactUser.id));
      setProfileMap((prev) => {
        const next = { ...prev };
        delete next[contactUser.id];
        return next;
      });
      setManagerMap((prev) => {
        const next: Record<string, string | null> = {};
        Object.entries(prev).forEach(([userId, managerId]) => {
          if (userId === contactUser.id) return;
          next[userId] = managerId === contactUser.id ? null : managerId;
        });
        return next;
      });
      closeContactModal();
    } catch (error) {
      console.error('Failed to delete user', error);
      setContactError('Failed to delete user.');
    } finally {
      setContactLoading(false);
    }
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

  const buildUserRows = (bundle: Awaited<ReturnType<typeof api.exportData>>) =>
    (bundle.users ?? []).map((user) => ({
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

  const buildDepartmentRows = (bundle: Awaited<ReturnType<typeof api.exportData>>) =>
    (bundle.departments ?? []).map((department) => ({
      id: department.id,
      name: department.name,
    }));

  const handleExportUsers = async () => {
    setExportLoading(true);
    try {
      const bundle = await api.exportData(DataExportScope.USERS);
      const csv = toCsv(buildUserRows(bundle));
      const timestamp = new Date().toISOString();
      downloadCsv(`zea-users-${timestamp}.csv`, csv);
    } catch (error) {
      console.error('User export failed', error);
      alert('User export failed. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportDepartments = async () => {
    setExportLoading(true);
    try {
      let bundle: Awaited<ReturnType<typeof api.exportData>>;
      try {
        bundle = await api.exportData(DataExportScope.DEPARTMENTS);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        if (message.includes("Input should be 'users', 'tasks' or 'all'")) {
          bundle = await api.exportData(DataExportScope.ALL);
        } else {
          throw error;
        }
      }
      const csv = toCsv(buildDepartmentRows(bundle));
      const timestamp = new Date().toISOString();
      downloadCsv(`zea-departments-${timestamp}.csv`, csv);
    } catch (error) {
      console.error('Department export failed', error);
      alert('Department export failed. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  const buildUserImportPayload = (records: Array<Record<string, string>>): DataImportPayload => {
    const now = new Date().toISOString();
    const usersPayload = records
      .filter((record) => record.id && record.email)
      .map((record) => ({
        id: record.id,
        name: record.name,
        email: record.email,
        role: record.role as DataImportPayload['users'][number]['role'],
        status: record.status as DataImportPayload['users'][number]['status'],
        departmentId: parseNullableString(record.departmentId) ?? null,
        points: parseNumber(record.points),
        tasksCreated: parseNumber(record.tasksCreated),
        tasksCompleted: parseNumber(record.tasksCompleted),
        clarityScores: parseJsonArray<number>(record.clarityScores),
        claimedRewardIds: parseJsonArray<string>(record.claimedRewardIds),
        unlockedAchievementIds: parseJsonArray<string>(record.unlockedAchievementIds),
        hashedPassword: record.hashedPassword || '',
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now,
      }));

    return {
      scope: DataExportScope.USERS,
      departments: departments.map((department) => ({ id: department.id, name: department.name })),
      users: usersPayload,
      tasks: [],
      achievements: [],
      rewards: [],
      kanbanColumns: [],
      notifications: [],
      userRewards: [],
      userAchievements: [],
    };
  };

  const buildDepartmentImportPayload = (records: Array<Record<string, string>>): DataImportPayload => {
    const departmentsPayload = records
      .filter((record) => record.id && record.name)
      .map((record) => ({
        id: record.id,
        name: record.name,
      }));

    return {
      scope: DataExportScope.DEPARTMENTS,
      departments: departmentsPayload,
      users: [],
      tasks: [],
      achievements: [],
      rewards: [],
      kanbanColumns: [],
      notifications: [],
      userRewards: [],
      userAchievements: [],
    };
  };

  const handleImportUsers = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const content = await file.text();
      let payload: DataImportPayload;
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(content) as Partial<DataImportPayload>;
        if (!parsed.users) {
          throw new Error('Invalid JSON backup. Users data not found.');
        }
        payload = {
          scope: DataExportScope.USERS,
          departments: parsed.departments ?? departments,
          users: parsed.users,
          tasks: [],
          achievements: [],
          rewards: [],
          kanbanColumns: [],
          notifications: [],
          userRewards: [],
          userAchievements: [],
        };
      } else {
        payload = buildUserImportPayload(parseCsv(content));
      }

      const existingEmails = new Set(users.map((user) => user.email.toLowerCase()));
      const existingIds = new Set(users.map((user) => user.id));
      const added: string[] = [];
      const existing: string[] = [];

      payload.users?.forEach((user) => {
        const email = user.email.toLowerCase();
        if (existingIds.has(user.id) || existingEmails.has(email)) {
          existing.push(`${user.name} (${user.email})`);
        } else {
          added.push(`${user.name} (${user.email})`);
        }
      });

      await api.importData(payload);
      setImportReport({
        title: 'User Import Report',
        added,
        existing,
        scope: 'users',
      });
      fetchData();
    } catch (error: any) {
      console.error('User import failed', error);
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (message.includes('Only full imports are supported')) {
        alert('User import failed. Restart the backend so scoped imports are enabled.');
      } else {
        alert('User import failed. Verify the file and try again.');
      }
    } finally {
      setImportLoading(false);
      event.target.value = '';
    }
  };

  const handleImportDepartments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const content = await file.text();
      let payload: DataImportPayload;
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(content) as Partial<DataImportPayload>;
        if (!parsed.departments) {
          throw new Error('Invalid JSON backup. Departments data not found.');
        }
        payload = {
          scope: DataExportScope.DEPARTMENTS,
          departments: parsed.departments,
          users: [],
          tasks: [],
          achievements: [],
          rewards: [],
          kanbanColumns: [],
          notifications: [],
          userRewards: [],
          userAchievements: [],
        };
      } else {
        payload = buildDepartmentImportPayload(parseCsv(content));
      }

      const existingIds = new Set(departments.map((department) => department.id));
      const existingNames = new Set(departments.map((department) => department.name.toLowerCase()));
      const added: string[] = [];
      const existing: string[] = [];

      payload.departments?.forEach((department) => {
        const name = department.name.toLowerCase();
        if (existingIds.has(department.id) || existingNames.has(name)) {
          existing.push(department.name);
        } else {
          added.push(department.name);
        }
      });

      await api.importData(payload);
      setImportReport({
        title: 'Department Import Report',
        added,
        existing,
        scope: 'departments',
      });
      fetchData();
    } catch (error: any) {
      console.error('Department import failed', error);
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (message.includes('Only full imports are supported')) {
        alert('Department import failed. Restart the backend so scoped imports are enabled.');
      } else {
        alert('Department import failed. Verify the file and try again.');
      }
    } finally {
      setImportLoading(false);
      event.target.value = '';
    }
  };

  const handleToggleStatus = async (userToToggle: User) => {
    if (!currentUser) return;
    const newStatus =
      userToToggle.status === UserStatus.ACTIVE
        ? UserStatus.DEACTIVATED
        : UserStatus.ACTIVE;

    try {
      await api.updateUser(userToToggle.id, { status: newStatus }, currentUser.id);
      fetchData();
    } catch (error: any) {
      console.error('Failed to update user status:', error.message);
      alert(`Error: ${error.message}`);
    }
  };

  const handleDeleteUser = async (userToDelete: User) => {
    if (!currentUser) return;
    if (userToDelete.role === Role.OWNER) {
      alert('Cannot delete the owner user.');
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to delete user "${userToDelete.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await api.deleteUser(userToDelete.id, currentUser.id);
      fetchData();
    } catch (error: any) {
      console.error('Failed to delete user:', error.message);
      alert(`Error: ${error.message}`);
    }
  };

  const getLastActiveInfo = (user: User) => {
    if (user.status === UserStatus.DEACTIVATED) {
      return { label: 'Deactivated', isActive: false };
    }
    const isOnline = onlineUserIds.has(user.id);
    if (isOnline) {
      return { label: 'Active now', isActive: true };
    }
    const rawTimestamp = user.updatedAt || user.createdAt;
    if (!rawTimestamp) {
      return { label: 'Unknown', isActive: false };
    }
    const timestamp = new Date(rawTimestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return { label: 'Unknown', isActive: false };
    }
    const diffMs = Math.max(0, Date.now() - timestamp.getTime());
    if (diffMs < 60 * 1000) {
      return { label: 'Just now', isActive: false };
    }
    const minutes = Math.floor(diffMs / (60 * 1000));
    if (minutes < 60) {
      return { label: `${minutes}m ago`, isActive: false };
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return { label: `${hours}h ago`, isActive: false };
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
      return { label: `${days}d ago`, isActive: false };
    }
    const months = Math.floor(days / 30);
    if (months < 12) {
      return { label: `${months}mo ago`, isActive: false };
    }
    const years = Math.floor(months / 12);
    return { label: `${years}y ago`, isActive: false };
  };

  const baseFilteredUsers = useMemo(() => {
    let filtered = users;

    // Apply search query filter
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.department.toLowerCase().includes(q)
      );
    }

    if (nameFilter.trim()) {
      const query = nameFilter.toLowerCase();
      filtered = filtered.filter((u) => u.name.toLowerCase().includes(query));
    }

    // Apply employer ID filter (case insensitive)
    if (employerIdFilter) {
      filtered = filtered.filter((u) =>
        u.employerId?.toLowerCase().includes(employerIdFilter.toLowerCase())
      );
    }

    // Apply role filter
    if (roleFilter) {
      filtered = filtered.filter((u) => u.role === roleFilter);
    }

    // Apply department filter
    if (departmentFilter) {
      filtered = filtered.filter((u) => u.department === departmentFilter);
    }

    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [users, debouncedSearchQuery, nameFilter, employerIdFilter, roleFilter, departmentFilter]);

  const activeUsers = useMemo(
    () => baseFilteredUsers.filter((user) => user.status !== UserStatus.DEACTIVATED),
    [baseFilteredUsers]
  );
  const deactivatedUsers = useMemo(
    () => baseFilteredUsers.filter((user) => user.status === UserStatus.DEACTIVATED),
    [baseFilteredUsers]
  );
  const visibleUsers = activeSection === 'deactivated' ? deactivatedUsers : activeUsers;

  const sortedDepartments = useMemo(
    () => [...departments].sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );
  const contactProfile = contactUser
    ? {
        title: contactUser.title ?? profileMap[contactUser.id]?.title,
        phone: contactUser.phone ?? profileMap[contactUser.id]?.phone,
      location: contactUser.location ?? profileMap[contactUser.id]?.location,
      timezone: contactUser.timezone ?? profileMap[contactUser.id]?.timezone,
      managerEmail: contactUser.managerEmail ?? profileMap[contactUser.id]?.managerEmail,
      shiftName: contactUser.shiftName ?? profileMap[contactUser.id]?.shiftName,
      shiftStart: contactUser.shiftStart ?? profileMap[contactUser.id]?.shiftStart,
      shiftEnd: contactUser.shiftEnd ?? profileMap[contactUser.id]?.shiftEnd,
      morningBreakStart: contactUser.morningBreakStart ?? profileMap[contactUser.id]?.morningBreakStart,
      morningBreakEnd: contactUser.morningBreakEnd ?? profileMap[contactUser.id]?.morningBreakEnd,
      lunchBreakStart: contactUser.lunchBreakStart ?? profileMap[contactUser.id]?.lunchBreakStart,
      lunchBreakEnd: contactUser.lunchBreakEnd ?? profileMap[contactUser.id]?.lunchBreakEnd,
      eveningBreakStart: contactUser.eveningBreakStart ?? profileMap[contactUser.id]?.eveningBreakStart,
      eveningBreakEnd: contactUser.eveningBreakEnd ?? profileMap[contactUser.id]?.eveningBreakEnd,
      notes: contactUser.notes ?? profileMap[contactUser.id]?.notes,
      skills: contactUser.skills ?? profileMap[contactUser.id]?.skills,
      projects: contactUser.projects ?? profileMap[contactUser.id]?.projects,
      }
    : {};
  const activeManagerId = contactUser?.managerId ?? contactForm.managerId;
  const contactManagerName =
    activeManagerId && activeManagerId !== contactUser?.id
      ? users.find((user) => user.id === activeManagerId)?.name || 'Unknown'
      : 'No manager';
  const contactSkills = contactProfile.skills ?? parseTagInput(contactForm.skills);
  const contactProjects = contactProfile.projects ?? parseTagInput(contactForm.projects);

  // Pagination logic
  const totalPages = Math.ceil(visibleUsers.length / pageSize);
  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return visibleUsers.slice(startIndex, startIndex + pageSize);
  }, [visibleUsers, currentPage, pageSize]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  );

  const userPointsMap = useMemo(() => {
    const map = new Map<string, number>();
    users.forEach((user) => {
      map.set(user.id, calculateUserPointsFromTasks(tasks, user.id, { usersById }));
    });
    return map;
  }, [tasks, users, usersById]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, nameFilter, employerIdFilter, roleFilter, departmentFilter, pageSize, activeSection]);

  const canPerformAction = (targetUser: User): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === Role.OWNER) return true;
    if (
      (currentUser.role === Role.ADMIN || currentUser.role === Role.MANAGER) &&
      targetUser.role !== Role.OWNER
    ) {
      return true;
    }
    return false;
  };

  // --- Updated menu toggle with flip logic
  const handleMenuToggle = (userId: string, trigger: HTMLButtonElement) => {
    if (openMenuId === userId) {
      setOpenMenuId(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const screenMid = window.innerHeight / 2;
    const shouldFlip = rect.top > screenMid;

    setMenuPosition({
      top: shouldFlip ? rect.top - 8 : rect.bottom + 8,
      left: rect.right - 208, // 192px menu width + ~arrow/ring offset
      flip: shouldFlip,
    });

    setOpenMenuId(userId);
  };

  const closeMenu = () => setOpenMenuId(null);

  // Close on outside click + Esc
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (loading) return <PageLoader />;

  // Helper for dynamic toggle label/icon
  const openUser = openMenuId ? users.find(u => u.id === openMenuId) : null;
  const isActive = openUser?.status === UserStatus.ACTIVE;
  const toggleLabel = isActive ? 'Deactivate' : 'Activate';
  const canManageUsers =
    currentUser &&
    (currentUser.role === Role.MANAGER ||
      currentUser.role === Role.ADMIN ||
      currentUser.role === Role.OWNER);

  return (
    <div className="p-4 sm:p-6 min-h-screen text-white rounded-lg shadow-2xl relative overflow-hidden"
         style={{
           backgroundImage: 'url("https://urlfactory.website/wp-content/uploads/2025/11/v796-nunny-02-scaled.jpg")',
           backgroundSize: 'cover',
           backgroundPosition: 'center',
           backgroundRepeat: 'no-repeat',
           backgroundAttachment: 'fixed'
         }}>
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />
      {/* Animated color orbs for extra visual interest */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '2s' }} />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500/8 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '4s' }} />
      <div className="absolute top-1/4 right-1/3 w-64 h-64 bg-red-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
      <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-yellow-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '3s' }} />
      <div className="absolute top-3/4 left-1/5 w-56 h-56 bg-green-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '5s' }} />
      <div className="absolute bottom-1/3 right-1/5 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '6s' }} />
      <div className="absolute top-1/3 right-1/4 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '7s' }} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl sm:text-3xl font-bold">User Management</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1 shadow-[0_10px_25px_rgba(0,0,0,0.35)]">
              <button
                onClick={() => setActiveSection('list')}
                className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  activeSection === 'list'
                    ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                All users
              </button>
              <button
                onClick={() => {
                  setActiveSection('org');
                  setOpenMenuId(null);
                }}
                className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  activeSection === 'org'
                    ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Organization Tree
              </button>
              <button
                onClick={() => {
                  setActiveSection('deactivated');
                  setOpenMenuId(null);
                }}
                className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                  activeSection === 'deactivated'
                    ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Deactivated Users
              </button>
            </div>
            {presenceStatus === 'connected' && (
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                  aria-hidden="true"
                />
                Active now ({onlineUserIds.size} users)
              </div>
            )}
            {presenceStatus === 'connecting' && (
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]"
                  aria-hidden="true"
                />
                Presence connecting...
              </div>
            )}
            {presenceStatus === 'offline' && (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-400/30 bg-slate-500/10 px-3 py-1 text-xs font-semibold text-slate-200">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-slate-300 shadow-[0_0_6px_rgba(148,163,184,0.7)]"
                  aria-hidden="true"
                />
                Presence offline
              </div>
            )}
          </div>
        </div>
        {canManageUsers && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportUsers}
              disabled={exportLoading}
              className="rounded-md border border-blue-400/40 bg-blue-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-100 transition hover:bg-blue-500/30 disabled:opacity-50"
            >
              Export users
            </button>
              <button
                onClick={() => userImportInputRef.current?.click()}
                disabled={importLoading}
                className="rounded-md border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Import users
              </button>
              <button
                onClick={openTransferModal}
                className="rounded-md border border-cyan-400/40 bg-cyan-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-500/30"
              >
                Transfer tasks
              </button>
            <button
              onClick={handleExportDepartments}
              disabled={exportLoading}
              className="rounded-md border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
            >
              Export departments
            </button>
            <button
              onClick={() => departmentImportInputRef.current?.click()}
              disabled={importLoading}
              className="rounded-md border border-purple-400/40 bg-purple-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-purple-100 transition hover:bg-purple-500/30 disabled:opacity-50"
            >
              Import departments
            </button>
            <button
              onClick={handleOpenDepartmentModal}
              className="rounded-md border border-slate-400/40 bg-slate-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 transition hover:bg-slate-500/30"
            >
              Department management
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-2 px-4 rounded-md shadow-sm transition-all duration-200 hover:scale-[1.02] flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Create User</span>
            </button>
            <input
              ref={userImportInputRef}
              type="file"
              accept=".csv,application/json"
              onChange={handleImportUsers}
              className="hidden"
            />
            <input
              ref={departmentImportInputRef}
              type="file"
              accept=".csv,application/json"
              onChange={handleImportDepartments}
              className="hidden"
            />
          </div>
        )}
      </div>

      {importReport &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{importReport.title}</h2>
                <button
                  onClick={() => setImportReport(null)}
                  className="text-xs uppercase tracking-[0.2em] text-white/60 hover:text-white"
                >
                  Close
                </button>
              </div>
              <p className="mt-3 text-sm text-white/70">
                {importReport.added.length} added · {importReport.existing.length} already existed
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Added</p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-emerald-100">
                    {importReport.added.length === 0 ? (
                      <p className="text-emerald-200/70">No new entries.</p>
                    ) : (
                      importReport.added.map((item) => <p key={item}>{item}</p>)
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Already exists</p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-100">
                    {importReport.existing.length === 0 ? (
                      <p className="text-amber-200/70">No duplicates.</p>
                    ) : (
                      importReport.existing.map((item) => <p key={item}>{item}</p>)
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {isDepartmentModalOpen &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Department management</h2>
                  <p className="mt-1 text-sm text-white/60">Add, edit, or delete departments.</p>
                </div>
                <button
                  onClick={handleCloseDepartmentModal}
                  className="text-xs uppercase tracking-[0.2em] text-white/60 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4">
                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">Add department</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={departmentDraftName}
                      onChange={(event) => setDepartmentDraftName(event.target.value)}
                      placeholder="Department name"
                      className="flex-1 min-w-[220px] rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                    <button
                      type="button"
                      onClick={handleAddDepartment}
                      disabled={departmentActionLoading}
                      className="rounded-lg border border-blue-400/50 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-100 transition hover:bg-blue-500/30 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">Existing departments</p>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {sortedDepartments.length === 0 ? (
                      <p className="text-sm text-white/50">No departments yet.</p>
                    ) : (
                      sortedDepartments.map((department) => {
                        const isEditing = editingDepartmentId === department.id;
                        const disableActions =
                          departmentActionLoading || (editingDepartmentId !== null && !isEditing);

                        return (
                          <div
                            key={department.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2"
                          >
                            {isEditing ? (
                              <>
                                <input
                                  type="text"
                                  value={editingDepartmentName}
                                  onChange={(event) => setEditingDepartmentName(event.target.value)}
                                  className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveDepartment(department)}
                                    disabled={departmentActionLoading}
                                    className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={resetDepartmentEditor}
                                    disabled={departmentActionLoading}
                                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/60 hover:text-white disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="text-sm text-white">{department.name}</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditDepartment(department)}
                                    disabled={disableActions}
                                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 hover:text-white disabled:opacity-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDepartment(department)}
                                    disabled={disableActions}
                                    className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {departmentActionError && (
                  <p className="text-xs text-rose-300">{departmentActionError}</p>
                )}
              </div>
            </div>
            </div>,
            document.body
          )}

        {isTransferModalOpen &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Transfer tasks</h2>
                    <p className="mt-1 text-sm text-white/60">
                      Move tasks from an exited user to a new owner.
                    </p>
                  </div>
                  <button
                    onClick={closeTransferModal}
                    className="text-xs uppercase tracking-[0.2em] text-white/60 hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                    From user
                    <select
                      value={transferFromUserId}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setTransferFromUserId(nextValue);
                        if (nextValue === transferToUserId) {
                          setTransferToUserId('');
                        }
                        setTransferError(null);
                        setTransferSuccess(null);
                      }}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                    >
                      <option value="">Select exited user</option>
                      {sortedUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                          {user.status === UserStatus.DEACTIVATED ? ' (Deactivated)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                    Transfer to
                    <select
                      value={transferToUserId}
                      onChange={(event) => {
                        setTransferToUserId(event.target.value);
                        setTransferError(null);
                        setTransferSuccess(null);
                      }}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                    >
                      <option value="">Select new owner</option>
                      {sortedUsers
                        .filter((user) => user.id !== transferFromUserId)
                        .filter((user) => user.status !== UserStatus.DEACTIVATED)
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/60">Statuses</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTransferStatuses(allTaskStatuses);
                          setTransferSuccess(null);
                        }}
                        className="rounded-md border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-white/60 hover:text-white"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTransferStatuses([]);
                          setTransferSuccess(null);
                        }}
                        className="rounded-md border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-white/60 hover:text-white"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {allTaskStatuses.map((status) => {
                      const statusLabel = CUSTOM_STATUS_NAMES[status]?.name ?? status;
                      const count = transferStatusCounts.get(status) ?? 0;
                      const checked = transferStatuses.includes(status);
                      return (
                        <label
                          key={status}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                            checked
                              ? 'border-cyan-400/60 bg-cyan-500/10 text-white'
                              : 'border-white/10 bg-white/5 text-white/70'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTransferStatus(status)}
                            className="h-4 w-4 rounded border-white/20 bg-slate-900/80 text-cyan-400"
                          />
                          <span className="flex-1">{statusLabel}</span>
                          <span className="text-xs text-white/50">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
                  <p>Will move {transferPreviewCount} task(s).</p>
                  {transferError && <p className="text-rose-300">{transferError}</p>}
                  {transferSuccess && <p className="text-emerald-200">{transferSuccess}</p>}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeTransferModal}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleTransferTasks}
                    disabled={transferLoading}
                    className="rounded-lg border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    {transferLoading ? 'Transferring...' : 'Transfer tasks'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        {activeSection === 'org' ? (
        <OrganizationTreeSection
          users={users}
          departments={departments}
          onUserUpdated={handleOrgUserUpdated}
          onUserDeleted={handleOrgUserDeleted}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-8 flex flex-wrap gap-6">
            <div className="flex flex-col group">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400">
                Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  placeholder="Search by name..."
                  className="px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-600 focus:shadow-lg"
                />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-focus-within:opacity-100 transition-opacity duration-200 pointer-events-none" />
              </div>
            </div>
            <div className="flex flex-col group">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400">
                Employer ID
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={employerIdFilter}
                  onChange={(e) => setEmployerIdFilter(e.target.value)}
                  placeholder="Search by Employer ID..."
                  className="px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-600 focus:shadow-lg"
                />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-focus-within:opacity-100 transition-opacity duration-200 pointer-events-none" />
              </div>
            </div>
            <div className="flex flex-col group">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400">
                Role
              </label>
              <div className="relative">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as Role | '')}
                  className="pl-4 pr-10 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-600 focus:shadow-lg appearance-none"
                >
                  <option value="">All Roles</option>
                  {Object.values(Role).map((role) => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-focus-within:opacity-100 transition-opacity duration-200 pointer-events-none" />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="flex flex-col group">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400">
                Department
              </label>
              <div className="relative">
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="pl-4 pr-10 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-600 focus:shadow-lg appearance-none"
                >
                  <option value="">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.name}>
                      {dept.name}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-focus-within:opacity-100 transition-opacity duration-200 pointer-events-none" />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setNameFilter('');
                  setEmployerIdFilter('');
                  setRoleFilter('');
                  setDepartmentFilter('');
                }}
                className="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800 text-xs font-semibold uppercase tracking-[0.2em] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                Clear filters
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm overflow-visible">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  {['Name', 'Employer ID', 'Department', 'Role', 'Points', 'Progress', 'Status', 'Last Active', 'Actions'].map(
                    (col) => (
                      <th
                        key={col}
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300"
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {paginatedUsers.map((user) => {
                  const lastActive = getLastActiveInfo(user);
                  const isOnline = onlineUserIds.has(user.id);
                  const avatarUrl = getUserAvatarUrl(user);
                  return (
                    <tr
                      key={user.id}
                      onClick={() => openContactModal(user)}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                        user.status === UserStatus.DEACTIVATED
                          ? 'opacity-60 bg-gray-50 dark:bg-gray-900'
                          : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 flex-shrink-0">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={user.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gray-200 dark:bg-gray-700 text-xs font-semibold uppercase text-gray-700 dark:text-gray-300">
                                {user.name.slice(0, 2)}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                  isOnline ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]' : 'bg-gray-400/70'
                                }`}
                                aria-hidden="true"
                              />
                              <button
                                type="button"
                                onClick={() => openContactModal(user)}
                                className="text-left text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-300"
                              >
                                {user.name}
                              </button>
                            </div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {user.employerId || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{user.department}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            user.role === Role.USER
                              ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                              : user.role === Role.ADMIN
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                              : user.role === Role.MANAGER
                              ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200'
                              : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center">
                          <StarIcon className="h-4 w-4 text-yellow-500 mr-1" />
                          <span>{userPointsMap.get(user.id) ?? user.points ?? 0}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex flex-col gap-1">
                          <div className="text-xs">
                            Lv {Math.floor(((userPointsMap.get(user.id) ?? user.points ?? 0) as number) / XP_PER_LEVEL) + 1}
                          </div>
                          <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-500 rounded-full"
                              style={{
                                width: `${Math.min(100, ((((userPointsMap.get(user.id) ?? user.points ?? 0) as number) % XP_PER_LEVEL) / XP_PER_LEVEL) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="text-xs text-gray-400">
                            {(((userPointsMap.get(user.id) ?? user.points ?? 0) as number) % XP_PER_LEVEL)} / {XP_PER_LEVEL}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <UserStatusBadge status={user.status} />
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={
                            lastActive.isActive
                              ? 'text-emerald-300 font-semibold'
                              : 'text-gray-500 dark:text-gray-400'
                          }
                        >
                          {lastActive.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 relative">
                        {canPerformAction(user) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMenuToggle(user.id, e.currentTarget);
                            }}
                            className="p-1.5 text-gray-500 hover:text-gray-200 dark:text-gray-400 hover:bg-white/5 dark:hover:bg-white/5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === user.id}
                          >
                            <EllipsisVerticalIcon className="h-5 w-5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {paginatedUsers.length === 0 && (
              <div className="text-center py-12">
                <h3 className="text-lg font-semibold">No users found.</h3>
                <p className="text-sm text-gray-500">
                  {debouncedSearchQuery || employerIdFilter || roleFilter || departmentFilter
                    ? 'Try adjusting your filters.'
                    : activeSection === 'deactivated'
                      ? 'No deactivated users yet.'
                      : 'Click "Create User" to add a new user.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {contactUser &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
            <div className="w-full max-w-3xl lg:max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-4 sm:p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">User details</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{contactUser.name}</h3>
                  <p className="text-sm text-white/60">{contactUser.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isContactEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setContactEditing(false);
                        setContactError(null);
                      }}
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 hover:text-white"
                    >
                      Back
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setContactEditing(true);
                        setContactError(null);
                      }}
                      disabled={!canEditContacts}
                      className="rounded-lg border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-100 transition hover:bg-blue-500/30 disabled:opacity-50"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeContactModal}
                    className="text-xs uppercase tracking-[0.2em] text-white/60 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>

              {isContactEditing ? (
                <>
                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Contact</p>
                        <div className="mt-3 space-y-3">
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Name
                            <input
                              type="text"
                              value={contactForm.name}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, name: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Email
                            <input
                              type="text"
                              value={contactUser.email}
                              readOnly
                              className="mt-1 w-full rounded-lg border border-white/5 bg-slate-900/60 px-3 py-2 text-sm text-white/70"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Employer ID
                            <input
                              type="text"
                              value={contactForm.employerId}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, employerId: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Title
                            <input
                              type="text"
                              value={contactForm.title}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, title: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Phone
                            <input
                              type="text"
                              value={contactForm.phone}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, phone: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Work</p>
                        <div className="mt-3 space-y-3">
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Role
                            <select
                              value={contactForm.role}
                              onChange={(event) =>
                                setContactForm((prev) => ({ ...prev, role: event.target.value as Role }))
                              }
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            >
                              {Object.values(Role).map((role) => (
                                <option key={role} value={role}>
                                  {role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Department
                            <select
                              value={contactForm.department}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, department: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            >
                              <option value="">Unassigned</option>
                              {sortedDepartments.map((department) => (
                                <option key={department.id} value={department.name}>
                                  {department.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Reports to
                            <select
                              value={contactForm.managerId}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, managerId: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            >
                              <option value="">No manager</option>
                              {users
                                .filter((user) => user.id !== contactUser.id)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((manager) => (
                                  <option key={manager.id} value={manager.id}>
                                    {manager.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Manager email
                            <input
                              type="email"
                              value={contactForm.managerEmail}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, managerEmail: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Location
                            <input
                              type="text"
                              value={contactForm.location}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, location: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Timezone
                            <input
                              type="text"
                              value={contactForm.timezone}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, timezone: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Shift</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50 sm:col-span-2">
                            Shift name
                            <input
                              type="text"
                              value={contactForm.shiftName}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, shiftName: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Shift start
                            <input
                              type="time"
                              value={contactForm.shiftStart}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, shiftStart: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Shift end
                            <input
                              type="time"
                              value={contactForm.shiftEnd}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, shiftEnd: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Morning break start
                            <input
                              type="time"
                              value={contactForm.morningBreakStart}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, morningBreakStart: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Morning break end
                            <input
                              type="time"
                              value={contactForm.morningBreakEnd}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, morningBreakEnd: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Lunch break start
                            <input
                              type="time"
                              value={contactForm.lunchBreakStart}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, lunchBreakStart: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Lunch break end
                            <input
                              type="time"
                              value={contactForm.lunchBreakEnd}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, lunchBreakEnd: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Evening break start
                            <input
                              type="time"
                              value={contactForm.eveningBreakStart}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, eveningBreakStart: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Evening break end
                            <input
                              type="time"
                              value={contactForm.eveningBreakEnd}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, eveningBreakEnd: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Skills & projects</p>
                        <div className="mt-3 space-y-3">
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Skills (comma separated)
                            <input
                              type="text"
                              value={contactForm.skills}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, skills: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                            Projects (comma separated)
                            <input
                              type="text"
                              value={contactForm.projects}
                              onChange={(event) => setContactForm((prev) => ({ ...prev, projects: event.target.value }))}
                              disabled={!isContactEditing}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Notes</p>
                        <textarea
                          value={contactForm.notes}
                          onChange={(event) => setContactForm((prev) => ({ ...prev, notes: event.target.value }))}
                          disabled={!isContactEditing}
                          rows={6}
                          className="mt-3 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                          placeholder="Add notes about this user for reporting."
                        />
                      </div>
                    </div>
                  </div>

                  {contactError && <p className="mt-4 text-sm text-rose-300">{contactError}</p>}

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                      {canEditContacts ? 'Editable by owner' : 'Read only'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canEditContacts && (
                        <button
                          type="button"
                          onClick={handleDeleteContactUser}
                          disabled={contactLoading}
                          className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          Delete user
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveContact}
                        disabled={!isContactEditing || contactLoading}
                        className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        Save changes
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Contact</p>
                        <div className="mt-3 space-y-2 text-sm text-white/80">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Name</span>
                            <span className="text-right">{contactForm.name || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Email</span>
                            <span className="text-right">{contactUser.email}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Employer ID</span>
                            <span className="text-right">{contactForm.employerId || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Title</span>
                            <span className="text-right">{contactForm.title || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Phone</span>
                            <span className="text-right">{contactForm.phone || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Work</p>
                        <div className="mt-3 space-y-2 text-sm text-white/80">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Role</span>
                            <span className="text-right">
                              {contactForm.role
                                ? contactForm.role.charAt(0).toUpperCase() + contactForm.role.slice(1).toLowerCase()
                                : '-'}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Department</span>
                            <span className="text-right">{contactForm.department || 'Unassigned'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Reports to</span>
                            <span className="text-right">{contactManagerName}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Manager email</span>
                            <span className="text-right">{contactForm.managerEmail || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Location</span>
                            <span className="text-right">{contactForm.location || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Timezone</span>
                            <span className="text-right">{contactForm.timezone || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Shift</p>
                        <div className="mt-3 space-y-2 text-sm text-white/80">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Shift name</span>
                            <span className="text-right">{contactForm.shiftName || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Shift start</span>
                            <span className="text-right">{contactForm.shiftStart || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Shift end</span>
                            <span className="text-right">{contactForm.shiftEnd || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Morning break start</span>
                            <span className="text-right">{contactForm.morningBreakStart || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Morning break end</span>
                            <span className="text-right">{contactForm.morningBreakEnd || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Lunch break start</span>
                            <span className="text-right">{contactForm.lunchBreakStart || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Lunch break end</span>
                            <span className="text-right">{contactForm.lunchBreakEnd || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Evening break start</span>
                            <span className="text-right">{contactForm.eveningBreakStart || '-'}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.2em] text-white/50">Evening break end</span>
                            <span className="text-right">{contactForm.eveningBreakEnd || '-'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Skills & projects</p>
                        <div className="mt-3 space-y-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-white/50">Skills</p>
                            {contactSkills.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {contactSkills.map((skill, index) => (
                                  <span
                                    key={`${skill}-${index}`}
                                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100"
                                  >
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-white/50">No skills listed.</p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-white/50">Projects</p>
                            {contactProjects.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {contactProjects.map((project, index) => (
                                  <span
                                    key={`${project}-${index}`}
                                    className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100"
                                  >
                                    {project}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-white/50">No projects listed.</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Notes</p>
                        <p className="mt-3 text-sm text-white/70">
                          {contactForm.notes.trim() ? contactForm.notes : 'No notes added yet.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-white/50">
                    <span>{canEditContacts ? 'Editable by owner' : 'Read only'}</span>
                    <span>{canEditContacts ? 'Select edit to update details.' : 'Contact the owner to edit.'}</span>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* --- Professional Dropdown Menu (with Activate/Deactivate) */}
      {activeSection !== 'org' && openMenuId && menuPosition &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: menuPosition.flip ? menuPosition.top - 176 : menuPosition.top, // 176 ~ menu height
              left: menuPosition.left,
              zIndex: 9999,
              transformOrigin: menuPosition.flip ? 'bottom right' : 'top right',
            }}
            className={`w-52 rounded-xl shadow-2xl ring-1 ring-white/10 border border-white/10 
              bg-neutral-900/90 backdrop-blur-md overflow-hidden
              animate-[fadeSlide_${menuPosition.flip ? 'up' : 'down'}_0.18s_ease-out_forwards]`}
            role="menu"
            aria-orientation="vertical"
          >
            {/* caret / arrow */}
            <span
              style={{
                position: 'absolute',
                right: 14,
                ...(menuPosition.flip
                  ? { bottom: -6, borderTop: '6px solid rgba(38,38,38,0.9)' }
                  : { top: -6, borderBottom: '6px solid rgba(38,38,38,0.9)' }),
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                pointerEvents: 'none',
              }}
            />

            <div className="py-1">
              <button
                onClick={() => {
                  setEditingUser(users.find((u) => u.id === openMenuId) || null);
                  closeMenu();
                }}
                className="w-full group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                role="menuitem"
              >
                <PencilIcon className="h-4 w-4 text-blue-400 group-hover:scale-110 transition-transform" />
                <span>Edit</span>
              </button>

              <button
                onClick={() => {
                  setChangingRoleUser(users.find((u) => u.id === openMenuId) || null);
                  closeMenu();
                }}
                className="w-full group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                role="menuitem"
              >
                <UserCircleIcon className="h-4 w-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                <span>Change Role</span>
              </button>

              <button
                onClick={() => {
                  setResettingPasswordUser(users.find((u) => u.id === openMenuId) || null);
                  closeMenu();
                }}
                className="w-full group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                role="menuitem"
              >
                <KeyIcon className="h-4 w-4 text-rose-400 group-hover:scale-110 transition-transform" />
                <span>Reset Password</span>
              </button>
            </div>

            <div className="h-px bg-white/10" />

            <div className="py-1">
              <button
                onClick={() => {
                  const u = users.find((x) => x.id === openMenuId);
                  if (u) handleToggleStatus(u);
                  closeMenu();
                }}
                className="w-full group flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 focus:bg-white/5 focus:outline-none 
                  text-gray-200"
                role="menuitem"
              >
                {isActive ? (
                  <NoSymbolIcon className="h-4 w-4 text-amber-400 group-hover:scale-110 transition-transform" />
                ) : (
                  <CheckCircleIcon className="h-4 w-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                )}
                <span>{toggleLabel}</span>
              </button>

              <button
                onClick={() => {
                  const u = users.find((x) => x.id === openMenuId);
                  if (u) handleDeleteUser(u);
                  closeMenu();
                }}
                className="w-full group flex items-center gap-3 px-4 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none"
                role="menuitem"
              >
                <TrashIcon className="h-4 w-4 group-hover:scale-110 transition-transform" />
                <span>Delete</span>
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Modals */}
      {isCreateModalOpen && (
        <CreateUserModal
          isOpen={isCreateModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onUserCreated={handleUserCreated}
          departments={departments}
        />
      )}
      {editingUser && (
        <EditUserModal
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
          user={editingUser}
          onUserUpdated={handleUserUpdated}
          departments={departments}
        />
      )}
      {changingRoleUser && (
        <ChangeRoleModal
          isOpen={!!changingRoleUser}
          onClose={() => setChangingRoleUser(null)}
          user={changingRoleUser}
          onRoleChanged={fetchData}
        />
      )}
      {resettingPasswordUser && (
        <ResetPasswordModal
          isOpen={!!resettingPasswordUser}
          onClose={() => setResettingPasswordUser(null)}
          user={resettingPasswordUser}
        />
      )}

      {/* Pagination */}
      {activeSection !== 'org' && visibleUsers.length > 0 && (
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Show
            </span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              users per page
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Showing {Math.min((currentPage - 1) * pageSize + 1, visibleUsers.length)} to{' '}
              {Math.min(currentPage * pageSize, visibleUsers.length)} of {visibleUsers.length} users
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i;
                if (pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-1 border rounded-md text-sm ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;


