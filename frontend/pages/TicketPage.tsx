import React, { useEffect, useMemo, useState } from 'react';
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../hooks/useAuth';
import { useTickets } from '../hooks/useTickets';
import api from '../services/api';
import ApprovalModal from '../components/ApprovalModal';
import CreateTicketModal from '../components/CreateTicketModal';
import TicketDetailDrawer from '../components/Tickets/TicketDetailDrawer';
import PageLoader from '../components/loading/PageLoader';
import {
  Role,
  TaskApprovalStatus,
  Ticket,
  TicketListFilters,
  TicketPriority,
  TicketStatus,
  User,
} from '../types';

type TabKey = 'all' | 'mine' | 'pendingApproval' | 'closed';

const tabConfig: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All Tickets' },
  { key: 'mine', label: 'My Tickets' },
  { key: 'pendingApproval', label: 'Pending Approval' },
  { key: 'closed', label: 'Closed' },
];

const statusBadgeMap: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  [TicketStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketStatus.WAITING]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketStatus.RESOLVED]: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  [TicketStatus.CLOSED]: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
};

const priorityBadgeMap: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  [TicketPriority.MEDIUM]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketPriority.HIGH]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketPriority.CRITICAL]: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
};

const approvalLabelMap: Record<string, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  none: 'Not Required',
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const TicketPage: React.FC = () => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [approvalModalTicket, setApprovalModalTicket] = useState<Ticket | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [userError, setUserError] = useState<string | null>(null);

  const baseFilters = useMemo<TicketListFilters>(() => {
    const resolvedStatus =
      activeTab === 'closed' ? TicketStatus.CLOSED : statusFilter || undefined;
    return {
      search: searchQuery || undefined,
      status: resolvedStatus,
      priority: priorityFilter || undefined,
      departmentId:
        user?.role === Role.MANAGER ? user.departmentId ?? undefined : undefined,
      assigneeId: assigneeFilter || undefined,
      myTickets: activeTab === 'mine' ? true : undefined,
    };
  }, [searchQuery, statusFilter, priorityFilter, assigneeFilter, activeTab, user]);

  const {
    tickets,
    loading,
    error,
    refetch,
    createTicket,
  } = useTickets(baseFilters);

  useEffect(() => {
    api
      .getUsers()
      .then(setUsers)
      .catch(() => setUserError('Unable to load user list.'));
  }, []);

  const userMap = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);

  const visibleTickets = useMemo(() => {
    const filtered = tickets.filter((ticket) => {
      if (activeTab === 'pendingApproval') {
        if (!(ticket.approvalEnabled && ticket.approvalStatus === TaskApprovalStatus.PENDING)) {
          return false;
        }
      }
      if (rangeStart) {
        const startDate = new Date(`${rangeStart}T00:00:00`);
        if (new Date(ticket.createdAt) < startDate) {
          return false;
        }
      }
      if (rangeEnd) {
        const endDate = new Date(`${rangeEnd}T23:59:59`);
        if (new Date(ticket.createdAt) > endDate) {
          return false;
        }
      }
      if (assigneeFilter && ticket.assignedUserId !== assigneeFilter) {
        return false;
      }
      return true;
    });
    if (activeTab === 'closed') {
      return filtered.filter((ticket) => ticket.status === TicketStatus.CLOSED);
    }
    return filtered;
  }, [tickets, activeTab, rangeStart, rangeEnd, assigneeFilter]);

  const pendingApprovalCount = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          ticket.approvalEnabled && ticket.approvalStatus === TaskApprovalStatus.PENDING,
      ).length,
    [tickets],
  );

  const hasUserApproverAccess = (ticket: Ticket) =>
    Boolean(
      user &&
        (user.role === Role.ADMIN ||
          user.role === Role.OWNER ||
          (ticket.approvalApproverIds ?? []).includes(user.id)),
    );

  const ticketRequiresApproval = (ticket: Ticket) =>
    Boolean(ticket.approvalEnabled && ticket.approvalStatus === TaskApprovalStatus.PENDING);

  const is404 = Boolean(error && error.toLowerCase().includes('404'));

  const handleModalClose = () => setApprovalModalTicket(null);

  const assigneeOptions = useMemo(() => {
    const options: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    tickets.forEach((ticket) => {
      if (!ticket.assignedUserId || seen.has(ticket.assignedUserId)) {
        return;
      }
      seen.add(ticket.assignedUserId);
      const userEntry = userMap.get(ticket.assignedUserId);
      options.push({
        id: ticket.assignedUserId,
        name: userEntry?.name ?? `User ${ticket.assignedUserId.slice(0, 6)}`,
      });
    });
    return options;
  }, [tickets, userMap]);

  if (loading && tickets.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ticket Board</h1>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">
              Pending approvals: {pendingApprovalCount}
            </p>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Create Ticket
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-10 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TicketStatus | '')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {Object.values(TicketStatus).map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as TicketPriority | '')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Priorities</option>
            {Object.values(TicketPriority).map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Assignees</option>
            {assigneeOptions.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={rangeStart}
            onChange={(event) => setRangeStart(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={rangeEnd}
            onChange={(event) => setRangeEnd(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabConfig.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="rounded-2xl border border-gray-200 bg-white/80 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {!loading && error && (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm font-semibold text-rose-600">
                {is404 ? 'Tickets not found (404).' : 'Failed to load tickets.'}
              </p>
              <p className="text-xs text-gray-500">{error}</p>
            </div>
          )}
          {!loading && !error && visibleTickets.length === 0 && (
            <div className="flex h-48 flex-col items-center justify-center text-sm text-gray-500">
              <p>No tickets match your filters.</p>
              <p className="text-xs text-gray-400">Try widening the date range or clearing filters.</p>
            </div>
          )}

          {!loading && !error && visibleTickets.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                <thead className="bg-gray-50 text-xs uppercase tracking-[0.3em] text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Ticket</th>
                    <th className="px-4 py-3 text-left">Title</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Priority</th>
                    <th className="px-4 py-3 text-left">Assigned</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-left">Approval</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {visibleTickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <td className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
                        #{ticket.id.slice(-6)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                        {ticket.title}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusBadgeMap[ticket.status]}`}>
                          {ticket.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${priorityBadgeMap[ticket.priority]}`}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                        {ticket.assignedUserId ? userMap.get(ticket.assignedUserId)?.name ?? 'Unassigned' : 'Unassigned'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(ticket.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                        {approvalLabelMap[ticket.approvalStatus ?? 'none'] ?? 'Not Required'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedTicket(ticket);
                            }}
                            className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:border-sky-400 hover:text-sky-600"
                          >
                            View
                          </button>
                          {ticketRequiresApproval(ticket) && hasUserApproverAccess(ticket) && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setApprovalModalTicket(ticket);
                              }}
                              className="rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50"
                            >
                              Approval
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {userError && (
            <p className="p-4 text-sm text-rose-500">{userError}</p>
          )}
        </div>
      </div>

      <CreateTicketModal
        isOpen={isCreateModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={createTicket}
        onTicketCreated={refetch}
      />

      <TicketDetailDrawer
        ticket={selectedTicket}
        isOpen={Boolean(selectedTicket)}
        onClose={() => setSelectedTicket(null)}
        onTicketUpdated={refetch}
      />

      <ApprovalModal
        ticket={approvalModalTicket}
        isOpen={Boolean(approvalModalTicket)}
        userMap={userMap}
        onClose={handleModalClose}
        onActionComplete={() => {
          refetch();
          handleModalClose();
        }}
      />
    </div>
  );
};

export default TicketPage;
