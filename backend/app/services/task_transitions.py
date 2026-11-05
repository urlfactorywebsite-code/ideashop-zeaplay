"""Canonical, label-independent task transitions. Callers own the transaction."""
from datetime import datetime, timezone
import unicodedata

from fastapi import HTTPException
from sqlalchemy import text

from .. import models as m
from ..lifecycle.context import bind_actor
from . import task_statuses
from .task_access import ensure_task_update_access


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def lock_task(db, task, actor):
    ensure_task_update_access(task, actor)
    task_statuses.scope(db, actor, lock=True)
    if db.get_bind().dialect.name == 'sqlite':
        db.execute(text('UPDATE tasks SET id=id WHERE id=:id'), {'id':task.id})
    db.refresh(task, with_for_update=True)
    ensure_task_update_access(task, actor)
    bind_actor(db, actor)
    return task


def apply(db, task, target, *, actor, custom_status_id=None, hold_reason=None, source='task_update', workflow_authorized=False):
    """Apply status invariants after the caller has acquired the task lock.

    The subtask engine may complete/reopen its parent using its already-checked
    child authorization. Other callers must satisfy the normal task policy.
    """
    if not workflow_authorized:
        ensure_task_update_access(task, actor)
    bind_actor(db, actor)
    target = m.TaskStatusEnum(target)
    if custom_status_id:
        configured = task_statuses.custom_for_assignment(db, actor, custom_status_id)
        if task_statuses.native_status(configured) != target.value:
            raise HTTPException(422, 'Custom workflow behavior does not match the task status')
        custom_status_id = configured.id
    from .gamification import COMPLETED_STATUSES
    if target in COMPLETED_STATUSES and any(child.status != m.SubtaskStatusEnum.DONE for child in task.subtasks):
        raise HTTPException(409, 'Complete all subtasks before completing the task')
    previous = task.status
    entering_hold = target == m.TaskStatusEnum.ON_HOLD and previous != target
    if entering_hold:
        hold_reason = ' '.join(unicodedata.normalize('NFKC', hold_reason or '').split())
        if len(hold_reason)>500 or any(unicodedata.category(character).startswith('C') for character in hold_reason):
            raise HTTPException(422, 'Hold reasons must contain at most 500 visible characters')
        configured_scope = db.get(m.TaskStatusScope, actor.tenant_id)
        if configured_scope and configured_scope.hold_reason_required and not (hold_reason or '').strip():
            raise HTTPException(422, 'A hold reason is required')
        task.hold_reason = (hold_reason or '').strip() or None
    if target != previous:
        current_time = utc_now()
        task.status_transitioned_at = max(current_time, task.status_transitioned_at or current_time)
        task.status_transition_version = (task.status_transition_version or 0) + 1
    task.status = target
    task.custom_status_id = custom_status_id
    if target in COMPLETED_STATUSES and previous not in COMPLETED_STATUSES:
        task.completed_at = task.status_transitioned_at or utc_now()
        task.approval_status = m.TaskApprovalStatusEnum.PENDING if task.approval_required else m.TaskApprovalStatusEnum.APPROVED
        if task.approval_required and task.approver_id and task.approver_id != actor.id:
            from .notifications import create_notification
            create_notification(db, user_id=task.approver_id, actor_id=actor.id,
                notification_type=m.NotificationTypeEnum.APPROVAL_REQUESTED,
                message=f"Task '{task.title}' is complete and requires your approval.", related_task_id=task.id)
    elif previous in COMPLETED_STATUSES and target not in COMPLETED_STATUSES:
        task.completed_at = None
        task.approval_status = m.TaskApprovalStatusEnum.NONE
        # Retain the existing one-time award marker. There is no approved
        # automatic points-reversal/re-award policy in the current engine.
    if previous != target:
        db.add(m.AuditEvent(actor_id=actor.id, event_type='task.transition', entity_type='task',entity_id=task.id,
            payload={'previous_status':previous.value,'status':target.value,'custom_status_id':custom_status_id,
                     'hold_reason':task.hold_reason if entering_hold else None,'source':source}))
    return previous != target


def finalize_completion(db, task, *, actor, notify_creator=False):
    from .gamification import award_task_completion_points
    from .badge_engine import BadgeEvent, process_badge_event
    from .scoring_users import lock_scoring_users
    lock_scoring_users(db, [actor.id, task.assigned_to_id, task.created_by_id])
    # The award engine locks the persisted task and checks its permanent marker.
    awarded = award_task_completion_points(db, task, notify_creator=notify_creator)
    if awarded:
        process_badge_event(db, event=BadgeEvent(entity='task', event='completed', actor_id=actor.id,
            assigned_to_id=task.assigned_to_id, created_by_id=task.created_by_id,
            priority=task.priority.value, occurred_at=task.completed_at))
    return awarded


def refresh_hold_summary(db, task):
    db.flush()
    db.refresh(task, attribute_names=['hold_started_at','hold_paused_seconds','hold_previous_status','status_transitioned_at'])
