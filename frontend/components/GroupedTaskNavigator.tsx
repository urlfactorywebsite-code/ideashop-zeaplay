import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogDescription, DialogPanel, DialogTitle } from '@headlessui/react';
import { CalendarDays, ChevronRight, Swords, Target, Timer, UsersRound, X } from 'lucide-react';
import type { Task, User } from '../types';
import { TaskStatus } from '../types';
import api from '../services/mockApi';
import { useAuth } from '../hooks/useAuth';
import { TASK_REALTIME_EVENT, type TaskRealtimeNotice } from '../services/taskRealtimeEvents';
import { WORK_UPDATED_EVENT } from '../hooks/useActiveWork';
import { assignmentMember, formatAssignmentTime } from '../utils/taskGroups';
import { formatDate } from '../utils';
import Avatar, { useAvatarIdentity } from './Avatar';
import TaskStatusBadge from './ui/TaskStatusBadge';
import TaskDetailModal from './TaskDetailModal';
import './GroupedTaskNavigator.css';

type Props = {
  task: Task;
  usersMap: Map<string, User>;
  onClose: () => void;
  onAssignmentUpdated: (task: Task) => void;
  onGroupLoaded: (assignments: Task[]) => void;
};

export default function GroupedTaskNavigator({ task, usersMap, onClose, onAssignmentUpdated, onGroupLoaded }: Props) {
  const { user } = useAuth();
  // Use only the server-visible members. A private assignment stays a solo quest
  // even when the viewer cannot access other assignments of the same task.
  const solo = task.groupAssignments?.length === 1;
  const [assignments, setAssignments] = useState<Task[]>(solo ? task.groupAssignments! : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(solo ? task.groupAssignments![0].id : null);
  const [exiting, setExiting] = useState<'back' | 'close' | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const selectedRef = useRef(selectedId);
  const assignmentsRef = useRef(assignments);
  const callbacks = useRef({ onAssignmentUpdated, onGroupLoaded, onClose });
  selectedRef.current = selectedId;
  assignmentsRef.current = assignments;
  callbacks.current = { onAssignmentUpdated, onGroupLoaded, onClose };
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const inflight = useRef(new Map<string, Promise<void>>());
  const dirty = useRef(new Set<string>());
  const revisions = useRef(new Map<string, number>());

  const replaceGroup = useCallback((members: Task[]) => {
    assignmentsRef.current = members;
    setAssignments(members);
    callbacks.current.onGroupLoaded(members);
    if (solo && !members.some(member => member.id === task.groupAssignments![0].id)) {
      callbacks.current.onClose();
      return;
    }
    if (selectedRef.current && !members.some(member => member.id === selectedRef.current)) setSelectedId(null);
  }, []);
  const updateAssignment = useCallback((updated: Task) => {
    if (!assignmentsRef.current.some(member => member.id === updated.id)) return;
    revisions.current.set(updated.id, (revisions.current.get(updated.id) ?? 0) + 1);
    const members = assignmentsRef.current.map(member => member.id === updated.id ? updated : member);
    assignmentsRef.current = members;
    setAssignments(members);
    callbacks.current.onAssignmentUpdated(updated);
  }, []);
  const loadGroup = useCallback(async () => {
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    // Permission revalidation must never leave stale rows clickable after a failure.
    setLoading(true); setError('');
    try {
      const members = solo
        ? [await api.getTask(task.groupAssignments![0].id, { fresh: true, signal: abort.signal })]
        : await api.getTaskGroup(task.id, { fresh: true, signal: abort.signal });
      if (abort.signal.aborted || !mounted.current || request !== generation.current) return;
      replaceGroup(members);
    } catch {
      if (abort.signal.aborted || !mounted.current || request !== generation.current) return;
      if (solo) { replaceGroup([]); return; }
      setAssignments([]); assignmentsRef.current = []; setSelectedId(null);
      setError('Unable to load assignments. Please try again.');
    } finally {
      if (!abort.signal.aborted && mounted.current && request === generation.current) setLoading(false);
    }
  }, [task.id, replaceGroup]);
  useEffect(() => {
    mounted.current = true;
    // The direct detail view loads its full assignment once. Do not request a
    // second group or flash the picker for a solo quest.
    if (!solo) void loadGroup();
    return () => { mounted.current = false; ++generation.current; controller.current?.abort(); if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, [loadGroup]);
  const refreshAssignment = useCallback((id: string): Promise<void> => {
    if (!assignmentsRef.current.some(member => member.id === id)) return Promise.resolve();
    const pending = inflight.current.get(id);
    if (pending) { dirty.current.add(id); return pending; }
    const requestGeneration = generation.current;
    const revision = revisions.current.get(id) ?? 0;
    const request = (async () => {
      try {
        const updated = await api.getTask(id, { fresh: true, signal: controller.current?.signal });
        if (mounted.current && requestGeneration === generation.current && revision === (revisions.current.get(id) ?? 0)) updateAssignment(updated);
      } catch {
        if (!mounted.current || requestGeneration !== generation.current) return;
        // A deleted or revoked assignment is removed before rechecking group membership.
        replaceGroup(assignmentsRef.current.filter(member => member.id !== id));
        await loadGroup();
      } finally {
        inflight.current.delete(id);
        if (dirty.current.delete(id) && mounted.current) void refreshAssignment(id);
      }
    })();
    inflight.current.set(id, request);
    return request;
  }, [updateAssignment, replaceGroup, loadGroup]);
  useEffect(() => {
    const queued = new Set<string>();
    let revalidate = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (revalidate) { revalidate = false; queued.clear(); void loadGroup(); }
        else { for (const id of queued) void refreshAssignment(id); queued.clear(); }
      }, 150);
    };
    const realtime = (event: Event) => {
      const notice = (event as CustomEvent<TaskRealtimeNotice>).detail;
      if (!user || notice?.userId !== user.id || notice.tenantId !== (user.tenantId ?? null)) return;
      if (String(notice.payload?.type || '').startsWith('comment.')) return;
      const ids = [notice.payload?.task_id ?? notice.payload?.taskId, ...(Array.isArray(notice.payload?.task_ids) ? notice.payload.task_ids : [])].filter((id): id is string => typeof id === 'string');
      if (!ids.length) revalidate = true;
      for (const id of ids) if (assignmentsRef.current.some(member => member.id === id)) {
        revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1);
        queued.add(id);
      }
      if (revalidate || queued.size) schedule();
    };
    const workChanged = () => { if (selectedRef.current) { queued.add(selectedRef.current); schedule(); } };
    window.addEventListener(TASK_REALTIME_EVENT, realtime);
    window.addEventListener(WORK_UPDATED_EVENT, workChanged);
    return () => { if (timer) clearTimeout(timer); window.removeEventListener(TASK_REALTIME_EVENT, realtime); window.removeEventListener(WORK_UPDATED_EVENT, workChanged); };
  }, [user?.id, user?.tenantId, loadGroup, refreshAssignment]);
  const selected = assignments.find(member => member.id === selectedId);
  const complete = assignments.filter(member => member.status === TaskStatus.DONE || member.status === TaskStatus.DEPLOYED).length;
  const progress = assignments.length ? Math.round(complete / assignments.length * 100) : 0;
  const openAssignment = useCallback((id: string) => { listScroll.current = listRef.current?.scrollTop ?? 0; setSelectedId(id); }, []);
  const finishBack = () => {
    const previousId = selectedId;
    setSelectedId(null);
    setExiting(null);
    requestAnimationFrame(() => {
      if (!listRef.current) return;
      listRef.current.scrollTop = listScroll.current;
      listRef.current.querySelector<HTMLButtonElement>(`[data-assignment-id="${CSS.escape(previousId || '')}"] button`)?.focus({ preventScroll: true });
    });
  };
  const leave = (destination: 'back' | 'close') => {
    if (exitTimer.current) return;
    setExiting(destination);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      if (destination === 'back') finishBack();
      else onClose();
    }, duration);
  };
  return <>
    {!solo && <Dialog open={!selected && exiting !== 'close'} unmount={false} onClose={() => leave('close')} className="assignment-navigation">
      <DialogBackdrop transition className="assignment-backdrop" />
      <div className="assignment-viewport"><DialogPanel transition className="assignment-panel">
        <header className="assignment-header"><div className="min-w-0"><div className="assignment-eyebrow"><Swords size={16} aria-hidden="true" /> Quest party</div><DialogTitle className="assignment-title">{error ? 'Task assignments' : task.title}</DialogTitle>
          <DialogDescription className="assignment-description">{error ? 'Retry to load your authorized assignments.' : `${task.project?.name || 'Quest'} · Choose a member to open their assignment.`}</DialogDescription></div>
          <button type="button" className="assignment-close" disabled={!!exiting} onClick={() => leave('close')}><X size={18} aria-hidden="true" /> Close</button>
        </header>
        <section className="assignment-party-stats" aria-label="Quest party summary">
          <div className="assignment-stat"><UsersRound size={18} aria-hidden="true" /><span>Party members<strong>{loading || error ? '—' : assignments.length}</strong></span></div>
          <div className="assignment-stat"><Target size={18} aria-hidden="true" /><span>Completed<strong>{loading || error ? '—' : `${complete} / ${assignments.length}`}</strong></span></div>
          <div className="assignment-party-progress"><div><span>Quest progress</span><strong>{loading || error ? '—' : `${progress}%`}</strong></div><progress className="quest-progress" max={Math.max(1, assignments.length)} value={loading || error ? 0 : complete} aria-label="Quest party progress" /></div>
        </section>
        <div ref={listRef} className="assignment-list-scroll" aria-busy={loading}>
          {loading ? <div role="status" aria-label="Loading assignments" className="assignment-skeletons">{Array.from({length:5}, (_, index) => <div className="assignment-skeleton" key={index}><i /><div><span /><span /></div></div>)}</div>
          : error ? <div role="alert" className="assignment-empty"><p>{error}</p><button type="button" className="assignment-close" onClick={() => void loadGroup()}>Retry</button></div>
          : !assignments.length ? <p className="assignment-empty">No visible assignments.</p>
          : <ul className="assignment-list" aria-label="Task assignments">{assignments.map((assignment, index) => <AssignmentRow key={assignment.id} assignment={assignment} index={index} usersMap={usersMap} onOpen={openAssignment} />)}</ul>}
        </div>
        <footer className="assignment-footer"><span><UsersRound size={14} aria-hidden="true" />{!loading && !error ? `${assignments.length} visible ${assignments.length === 1 ? 'assignment' : 'assignments'}` : 'Assignments'}</span><span>Every member. Their own mission.</span></footer>
      </DialogPanel></div>
    </Dialog>}
    {selected && <TaskDetailModal taskId={selected.id} isOpen initialTask={solo ? null : selected} usersMap={usersMap} onClose={() => leave('close')}
      onTaskUpdated={updateAssignment} onTaskDeleted={id => replaceGroup(assignmentsRef.current.filter(member => member.id !== id))}
      assignmentNavigation={{ assignments, onBack: solo ? undefined : () => leave('back'), onAssignmentsChanged: replaceGroup, exiting: !!exiting }} />}
  </>;
}

const AssignmentRow = React.memo(function AssignmentRow({ assignment, index, usersMap, onOpen }: { assignment: Task; index: number; usersMap: Map<string, User>; onOpen: (id: string) => void }) {
  const { person: member } = useAvatarIdentity(assignmentMember(assignment, usersMap));
  return <li data-assignment-id={assignment.id}><button type="button" className="assignment-row" onClick={() => onOpen(assignment.id)}>
    <span className="assignment-avatar"><Avatar user={member} size={40} /><span className="assignment-slot" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></span><span className="assignment-person"><span className="assignment-name">{member?.name || 'Unassigned'}</span><span className="assignment-due"><CalendarDays size={12} aria-hidden="true" />{assignment.dueAt ? `Due ${formatDate(assignment.dueAt, true)}` : 'No due date'}</span></span>
    <span className="assignment-row-status"><TaskStatusBadge status={assignment.status} customStatusId={assignment.customStatusId} statusTitle={assignment.statusTitle} /></span>
    <span className="assignment-tracked"><span><Timer size={12} aria-hidden="true" />Tracked</span><strong>{formatAssignmentTime(assignment.totalTrackedSeconds)}</strong></span><ChevronRight className="assignment-chevron" size={18} aria-hidden="true" />
  </button></li>;
});
