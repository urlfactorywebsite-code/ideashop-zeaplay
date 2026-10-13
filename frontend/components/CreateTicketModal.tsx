import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { Department, Role, TicketApprovalType, TicketCreatePayload, TicketPriority, User, UserStatus } from '../types';
import { useAuth } from '../hooks/useAuth';
import MultiSelect from './ui/MultiSelect';
import { getUserAvatarUrl } from '../utils/userAvatar';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: TicketCreatePayload) => Promise<void>;
  onTicketCreated?: () => void;
}

const priorityOptions = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  onTicketCreated,
}) => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.MEDIUM);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignedUserId, setAssignedUserId] = useState('');
  const [followers, setFollowers] = useState<string[]>([]);
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalType, setApprovalType] = useState<TicketApprovalType>(TicketApprovalType.PARALLEL);
  const [minApprovals, setMinApprovals] = useState(1);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [approvalDeadline, setApprovalDeadline] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const allowDepartmentSelect =
    user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority(TicketPriority.MEDIUM);
    setDepartmentId(user?.departmentId ?? '');
    setAssignedUserId('');
    setFollowers(user?.id ? [user.id] : []);
    setApprovalEnabled(false);
    setApprovalType(TicketApprovalType.PARALLEL);
    setMinApprovals(1);
    setApprovers([]);
    setApprovalDeadline('');
    setDueDate('');
    setError('');
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    setDepartmentId(user?.departmentId ?? '');
    setFollowers(user?.id ? [user.id] : []);
    setLoadingDepartments(true);
    api
      .getDepartments()
      .then((data) => {
        setDepartments(data);
        if (!user?.departmentId && data.length > 0) {
          setDepartmentId(data[0].id);
        }
      })
      .catch(() => {
        setError('Failed to load departments.');
      })
      .finally(() => {
        setLoadingDepartments(false);
      });
    api
      .getUsers()
      .then((data) => setUsers(data))
      .catch(() => {
        setError('Failed to load users.');
      });
  }, [isOpen, user?.departmentId, user?.id]);

  const departmentOptions = useMemo(() => {
    return departments.map((dept) => ({ id: dept.id, name: dept.name }));
  }, [departments]);

  const activeUsers = useMemo(
    () => users.filter((candidate) => candidate.status === UserStatus.ACTIVE),
    [users],
  );

  const userOptions = useMemo(
    () =>
      activeUsers.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        avatarUrl: getUserAvatarUrl(candidate) ?? undefined,
        description: candidate.role.toUpperCase(),
      })),
    [activeUsers],
  );

  const userMap = useMemo(() => new Map(activeUsers.map((candidate) => [candidate.id, candidate])), [activeUsers]);

  const assignedUserOptions = useMemo(() => {
    if (!departmentId) {
      return userOptions;
    }
    return userOptions.filter((option) => userMap.get(option.id)?.departmentId === departmentId);
  }, [departmentId, userOptions, userMap]);

  const approverOptions = useMemo(() => {
    const blockedId = user?.id;
    return userOptions.filter((option) => option.id !== blockedId);
  }, [userOptions, user?.id]);

  useEffect(() => {
    if (!departmentId || assignedUserId) return;
    const manager = activeUsers.find(
      (candidate) => candidate.role === Role.MANAGER && candidate.departmentId === departmentId,
    );
    if (manager) {
      setAssignedUserId(manager.id);
    }
  }, [departmentId, assignedUserId, activeUsers]);

  useEffect(() => {
    if (!departmentId || !assignedUserId) return;
    const assignedUser = userMap.get(assignedUserId);
    if (assignedUser && assignedUser.departmentId !== departmentId) {
      setAssignedUserId('');
    }
  }, [departmentId, assignedUserId, userMap]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleAssignedChange = (value: string[]) => {
    setAssignedUserId(value[value.length - 1] ?? '');
  };

  const handleFollowersChange = (value: string[]) => {
    const creatorId = user?.id;
    const next = creatorId ? Array.from(new Set([...value, creatorId])) : value;
    setFollowers(next);
  };

  const handleApproversChange = (value: string[]) => {
    const next = value.slice(0, 5);
    setApprovers(next);
    if (minApprovals > next.length) {
      setMinApprovals(Math.max(next.length, 1));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    const resolvedDepartmentId = allowDepartmentSelect
      ? departmentId || null
      : user?.departmentId ?? null;

    try {
      if (approvalEnabled && !dueDate) {
        setError('Due date is required when approvals are enabled.');
        setIsSubmitting(false);
        return;
      }
      if (approvalEnabled && approvers.length === 0) {
        setError('Select at least one approver when approvals are enabled.');
        setIsSubmitting(false);
        return;
      }
      if (approvalEnabled && minApprovals > approvers.length) {
        setError('Minimum approvals cannot exceed approver count.');
        setIsSubmitting(false);
        return;
      }

      const dueDateValue = dueDate ? new Date(dueDate).toISOString() : null;
      const approvalDeadlineValue = approvalDeadline ? new Date(approvalDeadline).toISOString() : null;

      await onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        departmentId: resolvedDepartmentId,
        ownerId: assignedUserId || null,
        assignedUserId: assignedUserId || null,
        dueDate: dueDateValue,
        followers,
        approvalEnabled,
        approvalType,
        minApprovals,
        approvers,
        approvalDeadline: approvalDeadlineValue,
      });
      onTicketCreated?.();
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create ticket.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-start p-4 pt-16">
      <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-6xl border border-border-color relative">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-6 top-6 text-text-muted hover:text-text-primary transition"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-text-primary">Create Ticket</h2>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-6">
          <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <label htmlFor="ticket-title" className="block text-sm font-medium text-text-secondary">
                  Title
                </label>
                <input
                  type="text"
                  id="ticket-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                  placeholder="e.g., Login issue on mobile"
                />
              </div>

              <div>
                <label
                  htmlFor="ticket-description"
                  className="block text-sm font-medium text-text-secondary"
                >
                  Description
                </label>
                <textarea
                  id="ticket-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  rows={6}
                  className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                  placeholder="Describe the issue and desired outcome."
                />
              </div>

              {allowDepartmentSelect && (
                <div>
                  <label
                    htmlFor="ticket-department"
                    className="block text-sm font-medium text-text-secondary"
                  >
                    Department
                  </label>
                  <select
                    id="ticket-department"
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    disabled={loadingDepartments}
                    className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                  >
                    {departmentOptions.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  htmlFor="ticket-priority"
                  className="block text-sm font-medium text-text-secondary"
                >
                  Priority
                </label>
                <select
                  id="ticket-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TicketPriority)}
                  className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                >
                  {priorityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary">Assigned to</label>
                <div className="mt-1">
                  <MultiSelect
                    options={assignedUserOptions}
                    value={assignedUserId ? [assignedUserId] : []}
                    onChange={handleAssignedChange}
                    placeholder="Select assignee..."
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <label htmlFor="ticket-due-date" className="block text-sm font-medium text-text-secondary">
                  Due date
                </label>
                <input
                  type="datetime-local"
                  id="ticket-due-date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                />
                {approvalEnabled && (
                  <p className="mt-1 text-xs text-text-muted">Required when approvals are enabled.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary">Followers</label>
                <div className="mt-1">
                  <MultiSelect
                    options={userOptions}
                    value={followers}
                    onChange={handleFollowersChange}
                    placeholder="Add followers..."
                  />
                </div>
                <p className="mt-1 text-xs text-text-muted">Creator stays on the follower list.</p>
              </div>

              <div className="rounded-md border border-border-color bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">Approval required</span>
                  <input
                    type="checkbox"
                    checked={approvalEnabled}
                    onChange={(event) => setApprovalEnabled(event.target.checked)}
                    className="h-4 w-4 text-primary border-border-color bg-background"
                  />
                </div>
                {approvalEnabled && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary">Approval type</label>
                      <select
                        value={approvalType}
                        onChange={(event) => setApprovalType(event.target.value as TicketApprovalType)}
                        className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                      >
                        <option value={TicketApprovalType.SEQUENTIAL}>Sequential</option>
                        <option value={TicketApprovalType.PARALLEL}>Parallel</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary">Minimum approvals</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={minApprovals}
                        onChange={(event) => setMinApprovals(Number(event.target.value))}
                        className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary">Approvers</label>
                      <div className="mt-1">
                        <MultiSelect
                          options={approverOptions}
                          value={approvers}
                          onChange={handleApproversChange}
                          placeholder="Select approvers..."
                        />
                      </div>
                      <p className="mt-1 text-xs text-text-muted">Max 5 approvers. Creator cannot approve.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary">Approval deadline</label>
                      <input
                        type="datetime-local"
                        value={approvalDeadline}
                        onChange={(event) => setApprovalDeadline(event.target.value)}
                        className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="rounded-md border border-border-color bg-background/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-text-muted">Live preview</p>
                <h3 className="mt-3 text-lg font-semibold text-text-primary">
                  {title.trim() || 'Untitled ticket'}
                </h3>
                <p className="mt-2 text-sm text-text-secondary whitespace-pre-line">
                  {description.trim() || 'Add a description to help the team.'}
                </p>
              </div>

              <div className="rounded-md border border-border-color bg-background/40 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Priority</span>
                  <span className="text-text-primary">{priority}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Department</span>
                  <span className="text-text-primary">
                    {departmentOptions.find((dept) => dept.id === departmentId)?.name || 'Unassigned'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Due date</span>
                  <span className="text-text-primary">
                    {dueDate ? new Date(dueDate).toLocaleString() : 'Not set'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Assigned to</span>
                  <span className="text-text-primary">
                    {assignedUserId ? userMap.get(assignedUserId)?.name || 'Unknown' : 'Unassigned'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Followers</span>
                  <span className="text-text-primary">{followers.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Approval</span>
                  <span className="text-text-primary">
                    {approvalEnabled ? `${approvalType} · ${minApprovals} min` : 'Not required'}
                  </span>
                </div>
              </div>

              {followers.length > 0 && (
                <div className="rounded-md border border-border-color bg-background/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-text-muted">Followers</p>
                  <div className="mt-3 space-y-2 text-sm text-text-secondary">
                    {followers.slice(0, 6).map((followerId) => (
                      <div key={followerId} className="flex items-center justify-between">
                        <span>{userMap.get(followerId)?.name || followerId}</span>
                        <span className="text-xs text-text-muted">
                          {userMap.get(followerId)?.role?.toUpperCase?.() || ''}
                        </span>
                      </div>
                    ))}
                    {followers.length > 6 && (
                      <p className="text-xs text-text-muted">+{followers.length - 6} more</p>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end space-x-4 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="py-2 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="py-2 px-4 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTicketModal;
