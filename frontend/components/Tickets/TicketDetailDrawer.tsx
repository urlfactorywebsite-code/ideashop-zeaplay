import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Department, Ticket, TicketPriority, TicketResolutionType, TicketStatus, TaskApprovalStatus, TaskStatus, NotificationEntityType } from '../../types';
import { useTicket } from '../../hooks/useTickets';
import { useTicketChat } from '../../hooks/useTicketChat';
import { useTicketApprovals } from '../../hooks/useTicketApprovals';
import { useTicketTasks } from '../../hooks/useTicketTasks';
import { useAuth } from '../../hooks/useAuth';
import { useMentionUsers } from '../../hooks/useMentionUsers';
import TicketDetailTabs from './TicketDetailTabs';
import SLATimer from './SLATimer';
import api from '../../services/api';
import TicketApprovalPanel from './TicketApprovalPanel';
import TicketStatusTimeline from './TicketStatusTimeline';
import TicketTasksSummary from './TicketTasksSummary';
import TicketAttachmentsSummary from './TicketAttachmentsSummary';
import TicketParticipantsSummary from './TicketParticipantsSummary';
import TicketSlaApprovalSummary from './TicketSlaApprovalSummary';
import { addMentionNotifications } from '../../utils/inboxStore';
import { extractMentionedUserIds } from '../../utils/mentionUtils';

interface TicketDetailDrawerProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  onTicketUpdated?: () => void;
}

const priorityColors: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  [TicketPriority.MEDIUM]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketPriority.HIGH]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketPriority.CRITICAL]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const statusColors: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  [TicketStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  [TicketStatus.WAITING]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  [TicketStatus.RESOLVED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  [TicketStatus.CLOSED]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const resolutionLabels: Record<TicketResolutionType, string> = {
  [TicketResolutionType.ISSUE_RESOLVED]: 'Issue Resolved',
  [TicketResolutionType.DUPLICATE_ISSUE]: 'Duplicate Issue',
  [TicketResolutionType.ISSUE_NOT_SOLVED]: 'Issue Not Solved',
};

const resolutionDescriptions: Record<TicketResolutionType, string> = {
  [TicketResolutionType.ISSUE_RESOLVED]: 'Issue fixed and confirmed.',
  [TicketResolutionType.DUPLICATE_ISSUE]: 'Duplicate of another ticket.',
  [TicketResolutionType.ISSUE_NOT_SOLVED]: 'Closed but flagged as not solved.',
};

const TicketDetailDrawer: React.FC<TicketDetailDrawerProps> = ({
  ticket,
  isOpen,
  onClose,
  onTicketUpdated,
}) => {
  const ticketId = ticket?.id;
  const { ticket: liveTicket, loading, transferTicket, closeTicket, reopenTicket } = useTicket(ticketId);
  const activeTicket = liveTicket ?? ticket;
  const { user } = useAuth();
  const tasksState = useTicketTasks(ticketId);
  const mentionUsers = useMentionUsers();

  const [activeTab, setActiveTab] = useState<'chat' | 'tasks' | 'logs'>('chat');
  const [commentText, setCommentText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [transferDepartmentId, setTransferDepartmentId] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [resolutionType, setResolutionType] = useState<TicketResolutionType>(TicketResolutionType.ISSUE_RESOLVED);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [duplicateQuery, setDuplicateQuery] = useState('');
  const [duplicateMatches, setDuplicateMatches] = useState<Ticket[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateTicketId, setDuplicateTicketId] = useState<string | null>(null);

  const { connected, messages, sendComment, sendTyping } = useTicketChat(ticketId);
  const approvalsState = useTicketApprovals(ticketId);

  useEffect(() => {
    if (!isOpen) return;
    api.getDepartments().then(setDepartments).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!showCloseModal || resolutionType !== TicketResolutionType.DUPLICATE_ISSUE) return;
    if (!duplicateQuery.trim() || duplicateQuery.trim().length < 2) {
      setDuplicateMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      setDuplicateLoading(true);
      api
        .getTickets({ search: duplicateQuery.trim() })
        .then((items) => {
          const filtered = items.filter((item) => item.id !== ticketId);
          setDuplicateMatches(filtered);
        })
        .catch(() => {})
        .finally(() => setDuplicateLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [duplicateQuery, resolutionType, showCloseModal, ticketId]);

  useEffect(() => {
    setCommentText('');
    setIsInternal(false);
  }, [ticketId]);

  useEffect(() => {
    setCloseError(null);
    if (resolutionType !== TicketResolutionType.DUPLICATE_ISSUE) {
      setDuplicateTicketId(null);
    }
  }, [resolutionType]);

  const handleSendComment = () => {
    if (!commentText.trim()) return;
    if (user && ticketId && mentionUsers.users.length) {
      const mentioned = extractMentionedUserIds(commentText.trim(), mentionUsers.users).filter(
        (userId) => userId !== user.id,
      );
      if (mentioned.length) {
        addMentionNotifications({
          authorName: user.name,
          mentionedUserIds: mentioned,
          message: commentText.trim(),
          entityType: NotificationEntityType.TICKET,
          entityId: ticketId,
          deepLink: `/tickets/${ticketId}`,
        });
      }
    }
    sendComment(commentText.trim(), isInternal);
    setCommentText('');
    setIsInternal(false);
  };

  const handleTransfer = async () => {
    if (!transferDepartmentId || !ticketId) return;
    try {
      await transferTicket({ departmentId: transferDepartmentId });
      setActionMessage('Ticket transferred.');
      onTicketUpdated?.();
    } catch (error) {
      setActionMessage('Transfer failed.');
    }
  };

  const handleClose = () => {
    setCloseError(null);
    setDuplicateQuery('');
    setDuplicateMatches([]);
    setDuplicateTicketId(null);
    setShowCloseModal(true);
  };

  const resetCloseModal = () => {
    setShowCloseModal(false);
    setCloseError(null);
    setDuplicateQuery('');
    setDuplicateMatches([]);
    setDuplicateTicketId(null);
  };

  const handleConfirmClose = async () => {
    if (!ticketId) return;
    if (resolutionType === TicketResolutionType.DUPLICATE_ISSUE && !duplicateTicketId) {
      setCloseError('Select a duplicate ticket before closing.');
      return;
    }
    try {
      await closeTicket({ resolutionType, duplicateTicketId });
      setShowCloseModal(false);
      setActionMessage('Ticket closed.');
      onTicketUpdated?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Close failed.';
      if (message === 'TASKS_PENDING') {
        setActionMessage('Close blocked: complete all linked tasks first.');
      } else if (message === 'TASK_APPROVAL_PENDING') {
        setActionMessage('Close blocked: pending task approvals.');
      } else {
        setActionMessage(message);
      }
    }
  };

  const handleReopen = async () => {
    if (!ticketId) return;
    try {
      await reopenTicket();
      setActionMessage('Ticket reopened.');
      onTicketUpdated?.();
    } catch (error) {
      setActionMessage('Reopen failed.');
    }
  };

  const allTasksDone = tasksState.tasks.every((task) => task.status === TaskStatus.DONE);
  const allApprovalsDone = tasksState.tasks.every(
    (task) => !task.approvalRequired || task.approvalStatus === TaskApprovalStatus.APPROVED,
  );
  const canCloseTicket = Boolean(
    user &&
      activeTicket &&
      user.id === activeTicket.assignedUserId &&
      allTasksDone &&
      allApprovalsDone &&
      !tasksState.loading,
  );

  const previewDescription = useMemo(() => {
    if (!activeTicket?.description) return 'No description yet.';
    const trimmed = activeTicket.description.trim();
    return trimmed.length > 0 ? trimmed : 'No description yet.';
  }, [activeTicket]);

  if (!isOpen || !activeTicket) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-3 pb-3 pt-16 sm:px-6 sm:pb-6 sm:pt-[90px]">
      <div className="relative w-full max-w-7xl max-h-[calc(100vh-2.5rem)] sm:max-h-[calc(100vh-4rem)] bg-white dark:bg-gray-900 shadow-2xl flex flex-col rounded-none sm:rounded-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800"
          aria-label="Close ticket details"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[activeTicket.status]}`}>
              {activeTicket.status.replace('_', ' ')}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[activeTicket.priority]}`}>
              {activeTicket.priority}
            </span>
            <SLATimer ticket={activeTicket} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-5 sm:px-6 sm:pt-6">
            <TicketStatusTimeline ticket={activeTicket} approvals={approvalsState.approvals} />
          </div>

          <div className="grid gap-5 px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6 lg:gap-6 lg:grid-cols-[240px,minmax(0,1fr)] xl:grid-cols-[260px,minmax(0,1fr),320px]">
            <aside className="order-2 space-y-4 lg:order-1">
              <div className="rounded-xl border border-gray-200/40 bg-gray-50/80 p-4 text-gray-900 shadow-sm dark:border-white/10 dark:bg-gray-950/60 dark:text-white">
                <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500 dark:text-gray-400">Ticket Preview</p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">#{activeTicket.id.slice(-6)}</p>
                <h3 className="mt-2 text-lg font-semibold">{activeTicket.title}</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{previewDescription}</p>
              </div>

              <TicketApprovalPanel
                ticket={activeTicket}
                approvals={approvalsState.approvals}
                loading={approvalsState.loading}
                onRequestApproval={approvalsState.requestApproval}
                onApproveApproval={approvalsState.approveApproval}
                onRejectApproval={approvalsState.rejectApproval}
              />

              <div className="flex flex-wrap items-center gap-2">
                {activeTicket.status === TicketStatus.CLOSED ? (
                  <button
                    onClick={handleReopen}
                    className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    <CheckCircleIcon className="h-4 w-4" />
                    Reopen
                  </button>
                ) : (
                  <button
                    onClick={handleClose}
                    disabled={!canCloseTicket}
                    className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    <CheckCircleIcon className="h-4 w-4" />
                    Close Ticket
                  </button>
                )}
                {!canCloseTicket && activeTicket.status !== TicketStatus.CLOSED && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Close unlocks when tasks and approvals are complete.
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={transferDepartmentId}
                  onChange={(event) => setTransferDepartmentId(event.target.value)}
                  className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                >
                  <option value="">Transfer to department...</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleTransfer}
                  disabled={!transferDepartmentId}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowRightIcon className="h-4 w-4" />
                  Transfer
                </button>
              </div>

              {actionMessage && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">{actionMessage}</p>
              )}
            </aside>

            <section className="order-1 min-w-0 space-y-4 lg:order-2">
              <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
                {(['chat', 'tasks', 'logs'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 text-sm font-medium rounded-md ${
                      activeTab === tab
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                </div>
              ) : (
                <TicketDetailTabs
                  ticket={activeTicket}
                  activeTab={activeTab}
                  messages={messages}
                  onSendComment={handleSendComment}
                  commentText={commentText}
                  setCommentText={setCommentText}
                  chatConnected={connected}
                  isInternal={isInternal}
                  setIsInternal={setIsInternal}
                  onTyping={sendTyping}
                  mentionUsers={mentionUsers.users}
                  canCreateTask={Boolean(user && activeTicket && user.id === activeTicket.assignedUserId)}
                />
              )}
            </section>

            <aside className="order-3 space-y-4 self-start lg:col-span-2 xl:col-span-1 xl:sticky xl:top-6">
              <TicketSlaApprovalSummary ticket={activeTicket} approvals={approvalsState.approvals} />
              <TicketTasksSummary ticketId={activeTicket.id} onViewTasks={() => setActiveTab('tasks')} />
              <TicketAttachmentsSummary ticketId={activeTicket.id} />
              <TicketParticipantsSummary ticketId={activeTicket.id} />
            </aside>
          </div>
        </div>
      </div>

      {showCloseModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onClick={resetCloseModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Close ticket</p>
                <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">Select resolution</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Pick how this ticket should be closed.
                </p>
              </div>
              <button
                onClick={() => setShowCloseModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                aria-label="Close close-ticket dialog"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {(Object.values(TicketResolutionType) as TicketResolutionType[]).map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm ${
                    resolutionType === option
                      ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-950/40'
                      : 'border-gray-200/70 bg-white/70 dark:border-gray-700/60 dark:bg-gray-900/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolutionType"
                    checked={resolutionType === option}
                    onChange={() => setResolutionType(option)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {resolutionLabels[option]}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {resolutionDescriptions[option]}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {resolutionType === TicketResolutionType.DUPLICATE_ISSUE && (
              <div className="mt-4 space-y-3">
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
                  Duplicate ticket
                </label>
                <input
                  value={duplicateQuery}
                  onChange={(event) => {
                    setDuplicateQuery(event.target.value);
                    if (!event.target.value.trim()) {
                      setDuplicateTicketId(null);
                    }
                  }}
                  placeholder="Search by ticket id or title..."
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                />
                {duplicateQuery.trim().length > 0 && /^[0-9a-fA-F-]{36}$/.test(duplicateQuery.trim()) && (
                  <button
                    type="button"
                    onClick={() => setDuplicateTicketId(duplicateQuery.trim())}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
                  >
                    Use ID
                  </button>
                )}
                {duplicateLoading && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Searching...</p>
                )}
                {!duplicateLoading && duplicateQuery.trim().length >= 2 && duplicateMatches.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No tickets found.</p>
                )}
                {duplicateMatches.length > 0 && (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-950">
                    {duplicateMatches.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setDuplicateTicketId(item.id);
                          setDuplicateQuery(item.title);
                        }}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                          duplicateTicketId === item.id
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                        }`}
                      >
                        <p className="text-xs text-gray-400">#{item.id.slice(-6)}</p>
                        <p className="font-semibold">{item.title}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {closeError && (
              <p className="mt-3 text-sm text-rose-500">{closeError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetCloseModal}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClose}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirm close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TicketDetailDrawer;
