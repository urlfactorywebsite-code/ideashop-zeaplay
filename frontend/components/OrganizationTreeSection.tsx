import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Department, Role, User } from '../types';
import { useAuth } from '../hooks/useAuth';
import { ArrowRightIcon, MagnifyingGlassIcon, UsersIcon } from './icons';
import { getUserAvatarUrl } from '../utils/userAvatar';
import api from '../services/mockApi';

type OrgGroup = {
  id: string;
  title: string;
  lead: User | null;
  members: User[];
};

type ManagerNode = {
  user: User;
  children: ManagerNode[];
};

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

const ROLE_PRIORITY: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.USER];
const LEAD_PRIORITY: Role[] = [Role.MANAGER, Role.ADMIN, Role.OWNER, Role.USER];

const roleLabel = (role: Role) => role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

const roleTone: Record<
  Role,
  { badge: string; dot: string; ring: string }
> = {
  [Role.OWNER]: {
    badge: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
    dot: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]',
    ring: 'ring-amber-400/40',
  },
  [Role.ADMIN]: {
    badge: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
    dot: 'bg-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.6)]',
    ring: 'ring-purple-400/40',
  },
  [Role.MANAGER]: {
    badge: 'bg-sky-500/20 text-sky-200 border-sky-400/40',
    dot: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]',
    ring: 'ring-sky-400/40',
  },
  [Role.USER]: {
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
    dot: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]',
    ring: 'ring-emerald-400/40',
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const orderItems = <T extends { id: string }>(items: T[], order: string[]) => {
  const map = new Map(items.map((item) => [item.id, item]));
  const ordered = order.map((id) => map.get(id)).filter(Boolean) as T[];
  const remainder = items.filter((item) => !order.includes(item.id));
  return [...ordered, ...remainder];
};

const moveButtonClass =
  'rounded-full p-1 text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30';

const profileStorageKey = 'org-user-profiles-v1';
const managerStorageKey = 'org-user-managers-v1';

const parseTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const tagListToString = (items?: string[]) => (items && items.length > 0 ? items.join(', ') : '');

const initialsFromName = (name: string) => {
  const parts = name.trim().split(' ').filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || '?';
};

const pickRootUser = (users: User[]): User | null => {
  for (const role of ROLE_PRIORITY) {
    const match = users.find((user) => user.role === role);
    if (match) return match;
  }
  return users[0] ?? null;
};

const pickGroupLead = (users: User[], rootUser: User | null): User | null => {
  const candidates = users.filter((user) => user.id !== rootUser?.id);
  if (candidates.length === 0) {
    return null;
  }
  for (const role of LEAD_PRIORITY) {
    const match = candidates.find((user) => user.role === role);
    if (match) return match;
  }
  return candidates[0] ?? null;
};

const buildGroups = (users: User[], rootUser: User | null, groupByDepartment: boolean): OrgGroup[] => {
  if (users.length === 0) return [];

  if (groupByDepartment) {
    const map = new Map<string, User[]>();
    users.forEach((user) => {
      const dept = user.department?.trim() || 'Unassigned';
      const existing = map.get(dept) ?? [];
      existing.push(user);
      map.set(dept, existing);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, members]) => {
        const lead = pickGroupLead(members, rootUser);
        const team = members.filter((user) => user.id !== lead?.id && user.id !== rootUser?.id);
        return {
          id: `dept-${dept.toLowerCase().replace(/\s+/g, '-')}`,
          title: dept,
          lead,
          members: team,
        };
      })
      .filter((group) => group.lead || group.members.length > 0);
  }

  return ROLE_PRIORITY.map((role) => {
    const members = users.filter((user) => user.role === role && user.id !== rootUser?.id);
    const lead = members[0] ?? null;
    return {
      id: `role-${role}`,
      title: roleLabel(role),
      lead,
      members: members.slice(1),
    };
  }).filter((group) => group.lead || group.members.length > 0);
};

const UserCard: React.FC<{
  user: User;
  subtitle?: string;
  emphasis?: boolean;
  profile?: UserProfile;
  onOpenDetails?: (user: User) => void;
}> = ({ user, subtitle, emphasis = false, profile, onOpenDetails }) => {
  const tone = roleTone[user.role];
  const skillsPreview = profile?.skills?.slice(0, 3) ?? [];
  const projectsPreview = profile?.projects?.slice(0, 2) ?? [];
  const avatarUrl = getUserAvatarUrl(user);

  return (
    <div className="relative group" data-org-card>
      <div
        className={`w-64 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 shadow-[0_20px_45px_rgba(10,10,25,0.55)] ring-1 ${tone.ring} ${
          emphasis ? 'scale-[1.03]' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-slate-700/60 text-sm font-semibold text-white">
            {avatarUrl ? (
              <img src={avatarUrl} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              <span>{initialsFromName(user.name)}</span>
            )}
            <span className={`absolute -bottom-1 right-0 h-3 w-3 rounded-full border border-slate-900 ${tone.dot}`} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-white/60">{user.email}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
          <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
            {roleLabel(user.role)}
          </span>
          <span className="text-white/40">|</span>
          <span>{user.department || 'Unassigned'}</span>
        </div>
        {subtitle && <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-white/40">{subtitle}</p>}
      </div>

      <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-4 w-72 -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-xs text-white/70 opacity-0 shadow-[0_25px_60px_rgba(10,10,30,0.6)] transition group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{user.name}</p>
            <p className="text-xs text-white/60">{profile?.title || roleLabel(user.role)}</p>
          </div>
          {onOpenDetails && (
            <button
              type="button"
              onClick={() => onOpenDetails(user)}
              className="rounded-full border border-blue-400/50 bg-blue-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-100 hover:bg-blue-500/30"
            >
              Contact
            </button>
          )}
        </div>
        <div className="mt-3 space-y-1 text-white/60">
          <p>{user.email}</p>
          <p>{user.employerId ? `ID: ${user.employerId}` : 'No employer ID'}</p>
          {profile?.phone && <p>{profile.phone}</p>}
          {(profile?.location || profile?.timezone) && (
            <p>{[profile?.location, profile?.timezone].filter(Boolean).join(' | ')}</p>
          )}
        </div>
        {(skillsPreview.length > 0 || projectsPreview.length > 0 || profile?.notes) && (
          <div className="mt-3 space-y-2">
            {skillsPreview.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {skillsPreview.map((skill) => (
                  <span key={skill} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-white/60">
                    {skill}
                  </span>
                ))}
              </div>
            )}
            {projectsPreview.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {projectsPreview.map((project) => (
                  <span key={project} className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-100">
                    {project}
                  </span>
                ))}
              </div>
            )}
            {profile?.notes && <p className="max-h-8 overflow-hidden text-[11px] text-white/50">{profile.notes}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

const PlaceholderCard: React.FC<{ label: string }> = ({ label }) => (
  <div
    className="w-64 rounded-2xl border border-dashed border-white/20 bg-white/5 px-4 py-6 text-center text-xs uppercase tracking-[0.3em] text-white/40"
    data-org-card
  >
    {label}
  </div>
);

type OrganizationTreeSectionProps = {
  users: User[];
  departments?: Department[];
  onUserUpdated?: (user: User) => void;
  onUserDeleted?: (userId: string) => void;
};

const OrganizationTreeSection: React.FC<OrganizationTreeSectionProps> = ({
  users,
  departments = [],
  onUserUpdated,
  onUserDeleted,
}) => {
  const { user: currentUser } = useAuth();
  const canEditLayout = currentUser?.role === Role.OWNER;
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByDepartment, setGroupByDepartment] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [zoom, setZoom] = useState(0.9);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [memberOrder, setMemberOrder] = useState<Record<string, string[]>>({});
  const treeRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panState = useRef({
    active: false,
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [profileMap, setProfileMap] = useState<Record<string, UserProfile>>({});
  const [managerMap, setManagerMap] = useState<Record<string, string | null>>({});
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [detailForm, setDetailForm] = useState({
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const rootUser = useMemo(() => pickRootUser(users), [users]);
  const visibleUsers = useMemo(() => {
    if (!normalizedSearch) return users;
    return users.filter((user) => {
      const department = user.department ?? '';
      return (
        user.name.toLowerCase().includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch) ||
        department.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [users, normalizedSearch]);

  const allGroups = useMemo(
    () => buildGroups(users, rootUser, groupByDepartment),
    [users, rootUser, groupByDepartment]
  );
  const visibleGroups = useMemo(
    () => buildGroups(visibleUsers, rootUser, groupByDepartment),
    [visibleUsers, rootUser, groupByDepartment]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const storedProfiles = window.localStorage.getItem(profileStorageKey);
      if (storedProfiles) {
        setProfileMap(JSON.parse(storedProfiles));
      }
    } catch (error) {
      console.warn('Failed to load user profiles', error);
    }

    try {
      const storedManagers = window.localStorage.getItem(managerStorageKey);
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
      window.localStorage.setItem(profileStorageKey, JSON.stringify(profileMap));
    } catch (error) {
      console.warn('Failed to persist user profiles', error);
    }
  }, [profileMap]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(managerStorageKey, JSON.stringify(managerMap));
    } catch (error) {
      console.warn('Failed to persist manager map', error);
    }
  }, [managerMap]);

  useEffect(() => {
    if (!canEditLayout) {
      setArrangeMode(false);
    }
  }, [canEditLayout]);

  useEffect(() => {
    if (!groupByDepartment) {
      setArrangeMode(false);
    }
  }, [groupByDepartment]);

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
    if (!activeUser) {
      return;
    }
    const profile = profileMap[activeUser.id] ?? {};
    const profileFromUser: UserProfile = {
      title: activeUser.title ?? undefined,
      phone: activeUser.phone ?? undefined,
      location: activeUser.location ?? undefined,
      timezone: activeUser.timezone ?? undefined,
      managerEmail: activeUser.managerEmail ?? undefined,
      shiftName: activeUser.shiftName ?? undefined,
      shiftStart: activeUser.shiftStart ?? undefined,
      shiftEnd: activeUser.shiftEnd ?? undefined,
      morningBreakStart: activeUser.morningBreakStart ?? undefined,
      morningBreakEnd: activeUser.morningBreakEnd ?? undefined,
      lunchBreakStart: activeUser.lunchBreakStart ?? undefined,
      lunchBreakEnd: activeUser.lunchBreakEnd ?? undefined,
      eveningBreakStart: activeUser.eveningBreakStart ?? undefined,
      eveningBreakEnd: activeUser.eveningBreakEnd ?? undefined,
      notes: activeUser.notes ?? undefined,
      skills: activeUser.skills ?? undefined,
      projects: activeUser.projects ?? undefined,
    };
    const mergedProfile = { ...profile, ...profileFromUser };
    setDetailForm({
      name: activeUser.name,
      employerId: activeUser.employerId ?? '',
      department: activeUser.department ?? '',
      role: activeUser.role,
      managerId: activeUser.managerId ?? managerMap[activeUser.id] ?? '',
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
    setDetailError(null);
  }, [activeUser, managerMap, profileMap]);

  useEffect(() => {
    setGroupOrder((prev) => {
      const ids = allGroups.map((group) => group.id);
      const next = prev.filter((id) => ids.includes(id));
      ids.forEach((id) => {
        if (!next.includes(id)) next.push(id);
      });
      return next;
    });

    setMemberOrder((prev) => {
      const next: Record<string, string[]> = { ...prev };
      allGroups.forEach((group) => {
        const ids = group.members.map((member) => member.id);
        const current = next[group.id] ?? [];
        const ordered = current.filter((id) => ids.includes(id));
        ids.forEach((id) => {
          if (!ordered.includes(id)) ordered.push(id);
        });
        next[group.id] = ordered;
      });
      Object.keys(next).forEach((groupId) => {
        if (!allGroups.some((group) => group.id === groupId)) {
          delete next[groupId];
        }
      });
      return next;
    });

    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = { ...prev };
      allGroups.forEach((group) => {
        if (next[group.id] === undefined) {
          next[group.id] = false;
        }
      });
      return next;
    });
  }, [allGroups]);

  const orderedGroups = useMemo(() => orderItems(visibleGroups, groupOrder), [visibleGroups, groupOrder]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const moveGroup = (groupId: string, direction: 'left' | 'right') => {
    setGroupOrder((prev) => {
      const next = [...prev];
      const index = next.indexOf(groupId);
      if (index < 0) return prev;
      const swapIndex = direction === 'left' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
  };

  const moveMember = (groupId: string, memberId: string, direction: 'left' | 'right') => {
    setMemberOrder((prev) => {
      const current = prev[groupId] ?? [];
      const next = [...current];
      const index = next.indexOf(memberId);
      if (index < 0) return prev;
      const swapIndex = direction === 'left' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return { ...prev, [groupId]: next };
    });
  };

  const openUserDetails = (user: User) => {
    setActiveUser(user);
    setDetailError(null);
  };

  const closeUserDetails = () => {
    setActiveUser(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const handleSaveDetails = async () => {
    if (!activeUser) return;
    if (!canEditLayout || !currentUser) {
      setDetailError('Only the owner can update user details.');
      return;
    }

    const trimmedName = detailForm.name.trim();
    if (!trimmedName) {
      setDetailError('Name is required.');
      return;
    }
    if (detailForm.managerId && detailForm.managerId === activeUser.id) {
      setDetailError('User cannot report to themselves.');
      return;
    }

    const updates: Partial<User> = {};
    if (trimmedName !== activeUser.name) updates.name = trimmedName;
    if ((detailForm.employerId || '') !== (activeUser.employerId || '')) {
      updates.employerId = detailForm.employerId;
    }
    if ((detailForm.department || '') !== (activeUser.department || '')) {
      updates.department = detailForm.department;
    }
    if (detailForm.role !== activeUser.role) {
      updates.role = detailForm.role;
    }

    const profileUpdate: UserProfile = {
      title: detailForm.title.trim() || undefined,
      phone: detailForm.phone.trim() || undefined,
      location: detailForm.location.trim() || undefined,
      timezone: detailForm.timezone.trim() || undefined,
      managerEmail: detailForm.managerEmail.trim() || undefined,
      shiftName: detailForm.shiftName.trim() || undefined,
      shiftStart: detailForm.shiftStart.trim() || undefined,
      shiftEnd: detailForm.shiftEnd.trim() || undefined,
      morningBreakStart: detailForm.morningBreakStart.trim() || undefined,
      morningBreakEnd: detailForm.morningBreakEnd.trim() || undefined,
      lunchBreakStart: detailForm.lunchBreakStart.trim() || undefined,
      lunchBreakEnd: detailForm.lunchBreakEnd.trim() || undefined,
      eveningBreakStart: detailForm.eveningBreakStart.trim() || undefined,
      eveningBreakEnd: detailForm.eveningBreakEnd.trim() || undefined,
      notes: detailForm.notes.trim() || undefined,
      skills: parseTagInput(detailForm.skills),
      projects: parseTagInput(detailForm.projects),
    };

    const updatePayload: Partial<User> = {
      ...updates,
      managerId: detailForm.managerId,
      managerEmail: detailForm.managerEmail.trim(),
      shiftName: detailForm.shiftName.trim(),
      shiftStart: detailForm.shiftStart.trim(),
      shiftEnd: detailForm.shiftEnd.trim(),
      morningBreakStart: detailForm.morningBreakStart.trim(),
      morningBreakEnd: detailForm.morningBreakEnd.trim(),
      lunchBreakStart: detailForm.lunchBreakStart.trim(),
      lunchBreakEnd: detailForm.lunchBreakEnd.trim(),
      eveningBreakStart: detailForm.eveningBreakStart.trim(),
      eveningBreakEnd: detailForm.eveningBreakEnd.trim(),
      title: detailForm.title.trim(),
      phone: detailForm.phone.trim(),
      location: detailForm.location.trim(),
      timezone: detailForm.timezone.trim(),
      notes: detailForm.notes.trim(),
      skills: profileUpdate.skills,
      projects: profileUpdate.projects,
    };

    setDetailLoading(true);
    setDetailError(null);
    try {
      const nextUser = await api.updateUser(activeUser.id, updatePayload, currentUser.id);
      onUserUpdated?.(nextUser);
      setProfileMap((prev) => ({ ...prev, [activeUser.id]: profileUpdate }));
      setManagerMap((prev) => ({ ...prev, [activeUser.id]: detailForm.managerId || null }));
      setActiveUser(nextUser);
    } catch (error) {
      console.error('Failed to update user', error);
      setDetailError('Failed to update user.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!activeUser) return;
    if (!canEditLayout || !currentUser) {
      setDetailError('Only the owner can delete users.');
      return;
    }
    if (!window.confirm(`Delete "${activeUser.name}"? This cannot be undone.`)) {
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      await api.deleteUser(activeUser.id, currentUser.id);
      setProfileMap((prev) => {
        const next = { ...prev };
        delete next[activeUser.id];
        return next;
      });
      setManagerMap((prev) => {
        const next: Record<string, string | null> = {};
        Object.entries(prev).forEach(([userId, managerId]) => {
          if (userId === activeUser.id) return;
          next[userId] = managerId === activeUser.id ? null : managerId;
        });
        return next;
      });
      onUserDeleted?.(activeUser.id);
      closeUserDetails();
    } catch (error) {
      console.error('Failed to delete user', error);
      setDetailError('Failed to delete user.');
    } finally {
      setDetailLoading(false);
    }
  };

  const zoomOut = () => setZoom((value) => clamp(Number((value - 0.1).toFixed(2)), 0.6, 1.6));
  const zoomIn = () => setZoom((value) => clamp(Number((value + 0.1).toFixed(2)), 0.6, 1.6));
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const scaledWidth = treeSize.width ? treeSize.width * zoom : undefined;
  const scaledHeight = treeSize.height ? treeSize.height * zoom : undefined;
  const departmentOptions = useMemo(() => {
    const names =
      departments.length > 0
        ? departments.map((department) => department.name)
        : users.map((user) => user.department || '').filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [departments, users]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const normalizedManagerMap = useMemo(() => {
    const next: Record<string, string> = {};
    Object.entries(managerMap).forEach(([userId, managerId]) => {
      if (!managerId) return;
      if (managerId === userId) return;
      if (!userById.has(managerId)) return;
      next[userId] = managerId;
    });
    return next;
  }, [managerMap, userById]);

  const handlePanStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, [data-org-card]')) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    panState.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    setIsPanning(true);
    event.preventDefault();
  };

  const handlePanMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!panState.current.active) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const deltaX = event.clientX - panState.current.x;
    const deltaY = event.clientY - panState.current.y;
    container.scrollLeft = panState.current.scrollLeft - deltaX;
    container.scrollTop = panState.current.scrollTop - deltaY;
  };

  const handlePanEnd = () => {
    if (!panState.current.active) {
      return;
    }
    panState.current.active = false;
    setIsPanning(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 0.1 : -0.1;
    setZoom((value) => clamp(Number((value + direction).toFixed(2)), 0.6, 1.6));
  };
  const managerChildrenMap = useMemo(() => {
    const map = new Map<string, User[]>();
    visibleUsers.forEach((user) => {
      const managerId = normalizedManagerMap[user.id];
      if (!managerId) return;
      const current = map.get(managerId) ?? [];
      current.push(user);
      map.set(managerId, current);
    });
    map.forEach((children, managerId) => {
      map.set(
        managerId,
        [...children].sort((a, b) => a.name.localeCompare(b.name))
      );
    });
    return map;
  }, [visibleUsers, normalizedManagerMap]);
  const hierarchyRoots = useMemo(() => {
    const roots: User[] = [];
    visibleUsers.forEach((user) => {
      if (rootUser && user.id === rootUser.id) {
        return;
      }
      const managerId = normalizedManagerMap[user.id];
      if (!managerId || !userById.has(managerId) || managerId === rootUser?.id) {
        roots.push(user);
      }
    });
    return roots.sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleUsers, normalizedManagerMap, rootUser, userById]);
  const hierarchyNodes = useMemo(() => {
    const visited = new Set<string>();
    const buildNode = (user: User): ManagerNode => {
      if (visited.has(user.id)) {
        return { user, children: [] };
      }
      visited.add(user.id);
      const children = (managerChildrenMap.get(user.id) ?? []).map(buildNode);
      return { user, children };
    };
    return hierarchyRoots.map(buildNode);
  }, [hierarchyRoots, managerChildrenMap]);
  const managerOptions = useMemo(() => {
    const list = users.filter((user) => user.id !== activeUser?.id);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, activeUser]);

  useEffect(() => {
    const node = treeRef.current;
    if (!node) return;

    const updateSize = () => {
      setTreeSize({ width: node.scrollWidth, height: node.scrollHeight });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      const id = window.setTimeout(updateSize, 0);
      return () => window.clearTimeout(id);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleGroups, hierarchyNodes, collapsedGroups, groupByDepartment]);

  const renderManagerNode = (node: ManagerNode): React.ReactNode => {
    const memberCount = node.children.length;
    const isCollapsed = collapsedGroups[node.user.id] ?? false;
    return (
      <div key={node.user.id} className="flex flex-col items-center">
        <UserCard
          user={node.user}
          profile={profileMap[node.user.id]}
          onOpenDetails={openUserDetails}
        />
        {memberCount > 0 && (
          <>
            <div className="h-4 w-px bg-white/15" />
            <button
              type="button"
              onClick={() => toggleGroup(node.user.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition ${
                isCollapsed
                  ? 'border-white/20 bg-slate-900/70 text-white/60'
                  : 'border-blue-400/60 bg-blue-500/20 text-blue-100'
              }`}
              aria-expanded={!isCollapsed}
              title={isCollapsed ? 'Show reports' : 'Hide reports'}
            >
              {memberCount}
            </button>
          </>
        )}
        {!isCollapsed && memberCount > 0 && (
          <div className="mt-5 flex flex-col items-center">
            <div className="h-6 w-px bg-white/15" />
            <div className="flex w-max gap-6 pt-4">
              {node.children.map((child) => renderManagerNode(child))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 sm:p-6 shadow-[0_25px_70px_rgba(10,10,30,0.45)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">Organization Tree</h2>
              <p className="text-sm text-white/60">Visualize teams using task manager user data.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search employee"
              className="w-full sm:w-56 rounded-xl border border-white/10 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button
            type="button"
            onClick={() => setGroupByDepartment((value) => !value)}
            className={`rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
              groupByDepartment
                ? 'border-blue-400/60 bg-blue-500/20 text-blue-100'
                : 'border-white/10 bg-slate-900/60 text-white/70 hover:border-white/30'
            }`}
          >
            {groupByDepartment ? 'Group by department' : 'Reporting lines'}
          </button>
          {canEditLayout && groupByDepartment && (
            <button
              type="button"
              onClick={() => setArrangeMode((value) => !value)}
              className={`rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                arrangeMode
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                  : 'border-white/10 bg-slate-900/60 text-white/70 hover:border-white/30'
              }`}
            >
              Arrange layout
            </button>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs uppercase tracking-[0.2em] text-white/70">
            <button
              type="button"
              onClick={zoomOut}
              className="rounded-md px-2 py-1 text-sm font-semibold text-white/80 hover:bg-white/10"
              aria-label="Zoom out"
            >
              -
            </button>
            <span className="min-w-[44px] text-center text-[11px] text-white/60">{zoomLabel}</span>
            <button
              type="button"
              onClick={zoomIn}
              className="rounded-md px-2 py-1 text-sm font-semibold text-white/80 hover:bg-white/10"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-white/20 bg-white/5 p-10 text-center text-sm text-white/60">
          No users are available to build the organization tree yet.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
          onWheel={handleWheel}
          className={`mt-10 overflow-auto pb-6 ${isPanning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        >
          <div className="mx-auto w-fit" style={{ width: scaledWidth, height: scaledHeight }}>
            <div
              ref={treeRef}
              className="flex min-w-max justify-center"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            >
              <div className="flex flex-col items-center">
                {rootUser ? (
                  <UserCard
                    user={rootUser}
                    subtitle="Top of the org"
                    emphasis
                    profile={profileMap[rootUser.id]}
                    onOpenDetails={openUserDetails}
                  />
                ) : (
                  <PlaceholderCard label="Add leader" />
                )}
                {groupByDepartment ? (
                  <>
                    {orderedGroups.length > 0 && (
                      <>
                        <div className="h-8 w-px bg-white/20" />
                        <div className="relative w-max">
                          <div className="absolute left-0 right-0 top-0 h-px bg-white/20" />
                          <div className="flex w-max gap-8 pt-8">
                            {orderedGroups.map((group, groupIndex) => {
                              const orderedMembers = orderItems(group.members, memberOrder[group.id] ?? []);
                              const memberCount = orderedMembers.length;
                              const isCollapsed = collapsedGroups[group.id] ?? false;
                              const showArrange = canEditLayout && arrangeMode;
                              const canMoveLeft = groupIndex > 0;
                              const canMoveRight = groupIndex < orderedGroups.length - 1;

                              return (
                                <div key={group.id} className="flex flex-col items-center">
                                  <div className="h-6 w-px bg-white/20" />
                                  <div className="relative">
                                    {group.lead ? (
                                      <UserCard
                                        user={group.lead}
                                        subtitle={group.title}
                                        profile={profileMap[group.lead.id]}
                                        onOpenDetails={openUserDetails}
                                      />
                                    ) : (
                                      <PlaceholderCard label={group.title} />
                                    )}
                                    {showArrange && (
                                      <div className="absolute -top-3 right-2 flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-1.5 py-1">
                                        <button
                                          type="button"
                                          onClick={() => moveGroup(group.id, 'left')}
                                          disabled={!canMoveLeft}
                                          className={moveButtonClass}
                                          aria-label="Move group left"
                                        >
                                          <ArrowRightIcon className="h-3 w-3 -scale-x-100" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => moveGroup(group.id, 'right')}
                                          disabled={!canMoveRight}
                                          className={moveButtonClass}
                                          aria-label="Move group right"
                                        >
                                          <ArrowRightIcon className="h-3 w-3" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {memberCount > 0 && (
                                    <>
                                      <div className="h-4 w-px bg-white/15" />
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(group.id)}
                                        className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition ${
                                          isCollapsed
                                            ? 'border-white/20 bg-slate-900/70 text-white/60'
                                            : 'border-blue-400/60 bg-blue-500/20 text-blue-100'
                                        }`}
                                        aria-expanded={!isCollapsed}
                                        title={isCollapsed ? 'Show reports' : 'Hide reports'}
                                      >
                                        {memberCount}
                                      </button>
                                    </>
                                  )}
                                  {!isCollapsed && memberCount > 0 && (
                                    <div className="mt-5 flex flex-col items-center">
                                      <div className="h-6 w-px bg-white/15" />
                                      <div className="flex w-max gap-4 pt-4">
                                        {orderedMembers.map((member, memberIndex) => {
                                          const canMoveMemberLeft = memberIndex > 0;
                                          const canMoveMemberRight = memberIndex < orderedMembers.length - 1;

                                          return (
                                            <div key={member.id} className="relative">
                                              <UserCard
                                                user={member}
                                                profile={profileMap[member.id]}
                                                onOpenDetails={openUserDetails}
                                              />
                                              {showArrange && (
                                                <div className="absolute -top-3 right-2 flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-1.5 py-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => moveMember(group.id, member.id, 'left')}
                                                    disabled={!canMoveMemberLeft}
                                                    className={moveButtonClass}
                                                    aria-label="Move member left"
                                                  >
                                                    <ArrowRightIcon className="h-3 w-3 -scale-x-100" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => moveMember(group.id, member.id, 'right')}
                                                    disabled={!canMoveMemberRight}
                                                    className={moveButtonClass}
                                                    aria-label="Move member right"
                                                  >
                                                    <ArrowRightIcon className="h-3 w-3" />
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                    {orderedGroups.length === 0 && (
                      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70">
                        No team nodes match this search yet.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {hierarchyNodes.length > 0 && (
                      <>
                        <div className="h-8 w-px bg-white/20" />
                        <div className="relative w-max">
                          <div className="absolute left-0 right-0 top-0 h-px bg-white/20" />
                          <div className="flex w-max gap-8 pt-8">
                            {hierarchyNodes.map((node) => renderManagerNode(node))}
                          </div>
                        </div>
                      </>
                    )}
                    {hierarchyNodes.length === 0 && (
                      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70">
                        No reporting lines assigned yet.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-3xl lg:max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-4 sm:p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/60">User details</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{activeUser.name}</h3>
                <p className="text-sm text-white/60">{activeUser.email}</p>
              </div>
              <button
                type="button"
                onClick={closeUserDetails}
                className="text-xs uppercase tracking-[0.2em] text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">Contact</p>
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Name
                      <input
                        type="text"
                        value={detailForm.name}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, name: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Email
                      <input
                        type="text"
                        value={activeUser.email}
                        readOnly
                        className="mt-1 w-full rounded-lg border border-white/5 bg-slate-900/60 px-3 py-2 text-sm text-white/70"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Employer ID
                      <input
                        type="text"
                        value={detailForm.employerId}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, employerId: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Title
                      <input
                        type="text"
                        value={detailForm.title}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, title: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Phone
                      <input
                        type="text"
                        value={detailForm.phone}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, phone: event.target.value }))}
                        disabled={!canEditLayout}
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
                        value={detailForm.role}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, role: event.target.value as Role }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {Object.values(Role).map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Department
                      <select
                        value={detailForm.department}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, department: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">Unassigned</option>
                        {departmentOptions.map((department) => (
                          <option key={department} value={department}>
                            {department}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Reports to
                      <select
                        value={detailForm.managerId}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, managerId: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">No manager</option>
                        {managerOptions.map((manager) => (
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
                        value={detailForm.managerEmail}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, managerEmail: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Location
                      <input
                        type="text"
                        value={detailForm.location}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, location: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Timezone
                      <input
                        type="text"
                        value={detailForm.timezone}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, timezone: event.target.value }))}
                        disabled={!canEditLayout}
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
                        value={detailForm.shiftName}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, shiftName: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Shift start
                      <input
                        type="time"
                        value={detailForm.shiftStart}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, shiftStart: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Shift end
                      <input
                        type="time"
                        value={detailForm.shiftEnd}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, shiftEnd: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Morning break start
                      <input
                        type="time"
                        value={detailForm.morningBreakStart}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, morningBreakStart: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Morning break end
                      <input
                        type="time"
                        value={detailForm.morningBreakEnd}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, morningBreakEnd: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Lunch break start
                      <input
                        type="time"
                        value={detailForm.lunchBreakStart}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, lunchBreakStart: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Lunch break end
                      <input
                        type="time"
                        value={detailForm.lunchBreakEnd}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, lunchBreakEnd: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Evening break start
                      <input
                        type="time"
                        value={detailForm.eveningBreakStart}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, eveningBreakStart: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Evening break end
                      <input
                        type="time"
                        value={detailForm.eveningBreakEnd}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, eveningBreakEnd: event.target.value }))}
                        disabled={!canEditLayout}
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
                        value={detailForm.skills}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, skills: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/50">
                      Projects (comma separated)
                      <input
                        type="text"
                        value={detailForm.projects}
                        onChange={(event) => setDetailForm((prev) => ({ ...prev, projects: event.target.value }))}
                        disabled={!canEditLayout}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">Notes</p>
                  <textarea
                    value={detailForm.notes}
                    onChange={(event) => setDetailForm((prev) => ({ ...prev, notes: event.target.value }))}
                    disabled={!canEditLayout}
                    rows={6}
                    className="mt-3 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white disabled:opacity-60"
                    placeholder="Add notes about this user for reporting."
                  />
                </div>
              </div>
            </div>

            {detailError && <p className="mt-4 text-sm text-rose-300">{detailError}</p>}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                {canEditLayout ? 'Editable by owner' : 'Read only'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canEditLayout && (
                  <button
                    type="button"
                    onClick={handleDeleteUser}
                    disabled={detailLoading}
                    className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    Delete user
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveDetails}
                  disabled={!canEditLayout || detailLoading}
                  className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default OrganizationTreeSection;
