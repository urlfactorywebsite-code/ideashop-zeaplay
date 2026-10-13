from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .. import models


VALID_USER_TRANSITIONS: dict[models.SubtaskStatusEnum, set[models.SubtaskStatusEnum]] = {
    models.SubtaskStatusEnum.WAITING: set(),
    models.SubtaskStatusEnum.TODO: {
        models.SubtaskStatusEnum.IN_PROGRESS,
        models.SubtaskStatusEnum.BLOCKED,
        models.SubtaskStatusEnum.IN_REVIEW,
        models.SubtaskStatusEnum.DONE,
    },
    models.SubtaskStatusEnum.IN_PROGRESS: {
        models.SubtaskStatusEnum.TODO,
        models.SubtaskStatusEnum.BLOCKED,
        models.SubtaskStatusEnum.IN_REVIEW,
        models.SubtaskStatusEnum.DONE,
    },
    models.SubtaskStatusEnum.BLOCKED: {
        models.SubtaskStatusEnum.TODO,
        models.SubtaskStatusEnum.IN_PROGRESS,
        models.SubtaskStatusEnum.IN_REVIEW,
    },
    models.SubtaskStatusEnum.IN_REVIEW: {
        models.SubtaskStatusEnum.TODO,
        models.SubtaskStatusEnum.IN_PROGRESS,
        models.SubtaskStatusEnum.BLOCKED,
        models.SubtaskStatusEnum.DONE,
    },
    models.SubtaskStatusEnum.DONE: {
        models.SubtaskStatusEnum.TODO,
        models.SubtaskStatusEnum.IN_REVIEW,
    },
}

SYSTEM_ACTIVATION_TRANSITION = (
    models.SubtaskStatusEnum.WAITING,
    models.SubtaskStatusEnum.TODO,
)
FORCE_START_TRANSITION = (
    models.SubtaskStatusEnum.WAITING,
    models.SubtaskStatusEnum.IN_PROGRESS,
)


@dataclass
class WorkflowDomainEvent:
    event_type: str
    task_id: str
    subtask_id: str
    from_status: Optional[str]
    to_status: str
    actor_id: Optional[str] = None
    reason: Optional[str] = None
    blocked_predecessor_ids: list[str] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowResult:
    changed: bool = False
    domain_events: list[WorkflowDomainEvent] = field(default_factory=list)

    def extend(self, other: "WorkflowResult") -> None:
        self.changed = self.changed or other.changed
        self.domain_events.extend(other.domain_events)


def status_from_completed(
    *,
    completed: Optional[bool],
    status_value: Optional[models.SubtaskStatusEnum],
    current_status: models.SubtaskStatusEnum,
) -> models.SubtaskStatusEnum:
    if status_value is not None:
        return status_value
    if completed is True:
        return models.SubtaskStatusEnum.DONE
    if completed is False:
        return models.SubtaskStatusEnum.TODO
    return current_status


def _task_members(task: models.Task) -> set[str]:
    if not task.project:
        return set()
    return {member.user_id for member in task.project.members}


def can_override_workflow(task: models.Task, actor: models.User) -> bool:
    if actor.role in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN}:
        return True
    if not task.project:
        return actor.role == models.RoleEnum.MANAGER or task.created_by_id == actor.id
    return any(
        member.user_id == actor.id and member.role == models.ProjectMemberRoleEnum.MANAGER
        for member in task.project.members
    )


def _lock_workflow_rows(db: Session, task_id: str) -> tuple[list[models.Subtask], list[models.SubtaskDependency]]:
    subtasks = (
        db.execute(
            select(models.Subtask)
            .where(models.Subtask.task_id == task_id)
            .with_for_update()
        )
        .scalars()
        .all()
    )
    dependencies = (
        db.execute(
            select(models.SubtaskDependency)
            .where(models.SubtaskDependency.task_id == task_id)
            .with_for_update()
        )
        .scalars()
        .all()
    )
    return subtasks, dependencies


def lock_workflow_rows(db: Session, task_id: str) -> tuple[list[models.Subtask], list[models.SubtaskDependency]]:
    return _lock_workflow_rows(db, task_id)


def validate_dependency_mutation(
    *,
    subtasks: list[models.Subtask],
    dependencies: list[models.SubtaskDependency],
    subtask_id: str,
    depends_on_subtask_id: str,
    omit_dependency_id: Optional[str] = None,
) -> tuple[models.Subtask, models.Subtask]:
    subtasks_by_id = {subtask.id: subtask for subtask in subtasks}
    subtask = subtasks_by_id.get(subtask_id)
    depends_on = subtasks_by_id.get(depends_on_subtask_id)
    if not subtask or not depends_on:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")
    if subtask.id == depends_on.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subtask cannot depend on itself")

    parent_map: dict[str, list[str]] = {}
    for edge in dependencies:
        if omit_dependency_id and edge.id == omit_dependency_id:
            continue
        parent_map.setdefault(edge.subtask_id, []).append(edge.depends_on_subtask_id)
    parent_map.setdefault(subtask.id, []).append(depends_on.id)

    stack = list(parent_map.get(depends_on.id, []))
    visited: set[str] = set()
    while stack:
        current = stack.pop()
        if current == subtask.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subtask dependency cycle detected")
        if current in visited:
            continue
        visited.add(current)
        stack.extend(parent_map.get(current, []))
    return subtask, depends_on


def _predecessor_ids(dependencies: list[models.SubtaskDependency], subtask_id: str) -> list[str]:
    return [
        edge.depends_on_subtask_id
        for edge in sorted(dependencies, key=lambda item: (item.dependency_order, item.id))
        if edge.subtask_id == subtask_id
    ]


def _blocked_predecessor_ids(
    subtasks_by_id: dict[str, models.Subtask],
    dependencies: list[models.SubtaskDependency],
    subtask_id: str,
) -> list[str]:
    blocked: list[str] = []
    for predecessor_id in _predecessor_ids(dependencies, subtask_id):
        predecessor = subtasks_by_id.get(predecessor_id)
        if predecessor and predecessor.status != models.SubtaskStatusEnum.DONE:
            blocked.append(predecessor_id)
    return blocked


def _successor_ids(dependencies: list[models.SubtaskDependency], subtask_id: str) -> list[str]:
    return [
        edge.subtask_id
        for edge in sorted(dependencies, key=lambda item: (item.dependency_order, item.id))
        if edge.depends_on_subtask_id == subtask_id
    ]


def _descendant_ids(dependencies: list[models.SubtaskDependency], subtask_id: str) -> list[str]:
    descendants: list[str] = []
    seen: set[str] = set()
    stack = _successor_ids(dependencies, subtask_id)
    while stack:
        current = stack.pop(0)
        if current in seen:
            continue
        seen.add(current)
        descendants.append(current)
        stack.extend(_successor_ids(dependencies, current))
    return descendants


def _record_workflow_event(
    db: Session,
    *,
    task_id: str,
    subtask_id: str,
    event_type: str,
    to_status: models.SubtaskStatusEnum,
    from_status: Optional[models.SubtaskStatusEnum] = None,
    actor_id: Optional[str] = None,
    reason: Optional[str] = None,
    blocked_predecessor_ids: Optional[list[str]] = None,
    payload: Optional[dict[str, Any]] = None,
    event_key: Optional[str] = None,
) -> Optional[WorkflowDomainEvent]:
    blocked = list(blocked_predecessor_ids or [])
    event_values = {
        "id": models.generate_uuid(),
        "event_key": event_key,
        "task_id": task_id,
        "subtask_id": subtask_id,
        "event_type": event_type,
        "from_status": from_status,
        "to_status": to_status,
        "actor_id": actor_id,
        "reason": reason,
        "blocked_predecessor_ids": blocked,
        "payload": payload or {},
        "created_at": datetime.utcnow(),
    }
    if event_key:
        existing = db.execute(
            select(models.SubtaskWorkflowEvent.id)
            .where(models.SubtaskWorkflowEvent.event_key == event_key)
        ).scalar_one_or_none()
        if existing:
            return None
        dialect_name = db.get_bind().dialect.name
        if dialect_name == "sqlite":
            statement = sqlite_insert(models.SubtaskWorkflowEvent).values(**event_values)
            statement = statement.on_conflict_do_nothing(index_elements=["event_key"])
            result = db.execute(statement)
            if result.rowcount == 0:
                return None
        elif dialect_name == "postgresql":
            statement = pg_insert(models.SubtaskWorkflowEvent).values(**event_values)
            statement = statement.on_conflict_do_nothing(index_elements=["event_key"])
            result = db.execute(statement)
            if result.rowcount == 0:
                return None
        else:
            db.add(models.SubtaskWorkflowEvent(**event_values))
    else:
        db.add(models.SubtaskWorkflowEvent(**event_values))
    return WorkflowDomainEvent(
        event_type=event_type,
        task_id=task_id,
        subtask_id=subtask_id,
        from_status=from_status.value if from_status else None,
        to_status=to_status.value,
        actor_id=actor_id,
        reason=reason,
        blocked_predecessor_ids=blocked,
        payload=payload or {},
    )


def _transition_event_type(
    from_status: models.SubtaskStatusEnum,
    to_status: models.SubtaskStatusEnum,
) -> str:
    if to_status == models.SubtaskStatusEnum.DONE:
        return "SUBTASK_COMPLETED"
    if from_status == models.SubtaskStatusEnum.DONE and to_status != models.SubtaskStatusEnum.DONE:
        return "SUBTASK_REOPENED"
    return "SUBTASK_STATUS_CHANGED"


def activate_ready_subtasks(
    db: Session,
    task: models.Task,
    *,
    actor: Optional[models.User] = None,
    locked_rows: Optional[tuple[list[models.Subtask], list[models.SubtaskDependency]]] = None,
) -> WorkflowResult:
    subtasks, dependencies = locked_rows or _lock_workflow_rows(db, task.id)
    subtasks_by_id = {subtask.id: subtask for subtask in subtasks}
    result = WorkflowResult()

    for subtask in sorted(subtasks, key=lambda item: (item.sort_order, item.id)):
        if subtask.status != models.SubtaskStatusEnum.WAITING:
            continue
        predecessor_ids = _predecessor_ids(dependencies, subtask.id)
        if not predecessor_ids:
            continue
        if _blocked_predecessor_ids(subtasks_by_id, dependencies, subtask.id):
            continue

        previous = subtask.status
        subtask.status = models.SubtaskStatusEnum.TODO
        subtask.completed = False
        event = _record_workflow_event(
            db,
            task_id=task.id,
            subtask_id=subtask.id,
            event_type="SUBTASK_ACTIVATED",
            from_status=previous,
            to_status=subtask.status,
            actor_id=actor.id if actor else None,
            payload={"predecessor_ids": predecessor_ids},
            event_key=f"subtask-activated:{task.id}:{subtask.id}",
        )
        if event:
            result.domain_events.append(event)
        result.changed = True

    return result


def transition_subtask(
    db: Session,
    task: models.Task,
    *,
    subtask_id: str,
    actor: models.User,
    target_status: models.SubtaskStatusEnum,
    force_start_reason: Optional[str] = None,
    can_override: bool = False,
) -> WorkflowResult:
    subtasks, dependencies = _lock_workflow_rows(db, task.id)
    subtasks_by_id = {subtask.id: subtask for subtask in subtasks}
    subtask = subtasks_by_id.get(subtask_id)
    if not subtask:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtask not found")

    if subtask.status == target_status:
        return WorkflowResult()

    result = WorkflowResult()
    current_status = subtask.status
    blocked_predecessors = _blocked_predecessor_ids(subtasks_by_id, dependencies, subtask.id)

    if (current_status, target_status) == SYSTEM_ACTIVATION_TRANSITION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subtask activation is managed by dependency completion",
        )

    if current_status == models.SubtaskStatusEnum.WAITING and target_status != models.SubtaskStatusEnum.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Waiting subtasks can only be activated by dependencies or force-started",
        )

    if (current_status, target_status) == FORCE_START_TRANSITION and blocked_predecessors:
        reason = (force_start_reason or "").strip()
        if len(reason) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Force-start requires a reason",
            )
        is_assignee = subtask.assigned_to_id == actor.id
        if not is_assignee and not can_override:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned user or an authorized workflow manager can force-start this subtask",
            )
        subtask.status = target_status
        subtask.completed = False
        event = _record_workflow_event(
            db,
            task_id=task.id,
            subtask_id=subtask.id,
            event_type="SUBTASK_FORCE_STARTED",
            from_status=current_status,
            to_status=target_status,
            actor_id=actor.id,
            reason=reason,
            blocked_predecessor_ids=blocked_predecessors,
            payload={
                "override": can_override and not is_assignee,
                "predecessor_ids": _predecessor_ids(dependencies, subtask.id),
            },
        )
        if event:
            result.domain_events.append(event)
        result.changed = True
        return result

    if current_status == models.SubtaskStatusEnum.WAITING and not blocked_predecessors:
        activation_result = activate_ready_subtasks(db, task, actor=actor, locked_rows=(subtasks, dependencies))
        result.extend(activation_result)
        current_status = subtask.status

    if target_status not in VALID_USER_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invalid subtask transition from {current_status.value} to {target_status.value}",
        )

    previous_status = subtask.status
    subtask.status = target_status
    subtask.completed = target_status == models.SubtaskStatusEnum.DONE
    event = _record_workflow_event(
        db,
        task_id=task.id,
        subtask_id=subtask.id,
        event_type=_transition_event_type(previous_status, target_status),
        from_status=previous_status,
        to_status=target_status,
        actor_id=actor.id,
        payload={"predecessor_ids": _predecessor_ids(dependencies, subtask.id)},
    )
    if event:
        result.domain_events.append(event)
    result.changed = True

    if target_status == models.SubtaskStatusEnum.DONE:
        result.extend(activate_ready_subtasks(db, task, actor=actor, locked_rows=(subtasks, dependencies)))
    elif previous_status == models.SubtaskStatusEnum.DONE:
        for descendant_id in _descendant_ids(dependencies, subtask.id):
            descendant = subtasks_by_id.get(descendant_id)
            if not descendant or descendant.status == models.SubtaskStatusEnum.WAITING:
                continue
            if descendant.status == models.SubtaskStatusEnum.IN_REVIEW:
                continue
            descendant_previous = descendant.status
            descendant.status = models.SubtaskStatusEnum.IN_REVIEW
            descendant.completed = False
            downstream_event = _record_workflow_event(
                db,
                task_id=task.id,
                subtask_id=descendant.id,
                event_type="SUBTASK_DOWNSTREAM_REVIEW_REQUIRED",
                from_status=descendant_previous,
                to_status=descendant.status,
                actor_id=actor.id,
                payload={"reopened_predecessor_id": subtask.id},
            )
            if downstream_event:
                result.domain_events.append(downstream_event)
            result.changed = True

    return result


def event_payloads(events: list[WorkflowDomainEvent]) -> list[dict[str, Any]]:
    return [
        {
            "event_type": event.event_type,
            "task_id": event.task_id,
            "subtask_id": event.subtask_id,
            "from_status": event.from_status,
            "to_status": event.to_status,
            "actor_id": event.actor_id,
            "reason": event.reason,
            "blocked_predecessor_ids": event.blocked_predecessor_ids,
            "payload": event.payload,
            "occurred_at": datetime.utcnow().isoformat(),
        }
        for event in events
    ]
