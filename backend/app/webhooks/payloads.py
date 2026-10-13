from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..config import get_settings
from ..tickets import models as ticket_models
from ..tickets import schemas as ticket_schemas

SUPPORTED_EVENTS = [
    "ticket.created",
    "ticket.updated",
    "ticket.status_changed",
    "ticket.assigned",
    "ticket.closed",
    "ticket.reopened",
    "ticket.mentioned",
    "ticket.approval_requested",
    "ticket.approval_approved",
    "ticket.approval_rejected",
    "ticket.approval_overdue",
    "ticket.approval_escalated",
    "ticket.task_created",
    "ticket.task_updated",
    "ticket.task_completed",
    "ticket.task_deleted",
    "task.created",
    "task.updated",
    "task.completed",
    "task.deleted",
    "task.subtask_updated",
    "comment.created",
    "comment.deleted",
    "user.created",
    "user.updated",
    "user.deleted",
    "notification.created",
    "message.created",
    "message.updated",
    "message.deleted",
    "conversation.created",
    "conversation.updated",
    "member.added",
    "member.removed",
    "reward.created",
    "reward.updated",
    "reward.deleted",
    "reward.expired",
    "reward.claimed",
    "points_table.created",
    "points_table.updated",
    "department.created",
    "department.deleted",
    "test",
]

DEV_ONLY_EVENTS = {"test"}


def to_jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return to_jsonable(value.model_dump())
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): to_jsonable(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    return value


def build_payload(event_name: str, data: dict[str, Any] | None) -> dict[str, Any]:
    payload = {
        "version": "v1",
        "meta": {
            "event": event_name,
            "timestamp": datetime.utcnow().isoformat(),
            "source": "zeaplay",
        },
        "data": data or {},
    }
    return to_jsonable(payload)


def build_ticket_webhook_payload(
    *,
    event_name: str,
    ticket: ticket_models.Ticket,
    actor: models.User | None,
    approval_cycle: dict[str, Any] | None = None,
    task: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> dict[str, Any]:
    occurred_at = occurred_at or datetime.utcnow()
    ticket_data = {
        "id": str(ticket.id),
        "number": str(ticket.id),
        "title": ticket.title,
        "status": ticket.status.value,
        "assigned_to": ticket.assigned_user_id,
        "created_by": ticket.created_by,
        "created_at": ticket.created_at.isoformat(),
        "updated_at": ticket.updated_at.isoformat(),
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
        "resolution_type": ticket.resolution_type.value if ticket.resolution_type else None,
    }
    payload = {
        "event": event_name,
        "occurred_at": occurred_at.isoformat(),
        "ticket_id": str(ticket.id),
        "ticket_number": str(ticket.id),
        "actor_user_id": str(actor.id) if actor else None,
        "actor_name": actor.name if actor else "System",
        "ticket": ticket_data,
    }
    if approval_cycle:
        payload["approval_cycle"] = approval_cycle
    if task:
        payload["task"] = task
    return to_jsonable(payload)


def build_ticket_event_data(
    *,
    ticket: ticket_models.Ticket,
    actor: models.User | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    ticket_data = ticket_schemas.TicketRead.model_validate(ticket).model_dump()
    actor_data = None
    if actor:
        actor_data = {
            "id": actor.id,
            "name": actor.name,
            "email": actor.email,
            "role": actor.role.value,
        }
    return {
        "ticket": ticket_data,
        "actor": actor_data,
        "context": payload,
    }


def _latest_task(db: Session) -> models.Task | None:
    stmt = (
        select(models.Task)
        .options(
            selectinload(models.Task.subtasks),
            selectinload(models.Task.dependencies),
            selectinload(models.Task.creator),
            selectinload(models.Task.assignee),
        )
        .order_by(models.Task.created_at.desc())
    )
    return db.execute(stmt).scalars().first()


def _latest_comment(db: Session) -> models.Comment | None:
    stmt = select(models.Comment).order_by(models.Comment.created_at.desc())
    return db.execute(stmt).scalars().first()


def _latest_user(db: Session) -> models.User | None:
    stmt = (
        select(models.User)
        .options(selectinload(models.User.department))
        .order_by(models.User.created_at.desc())
    )
    return db.execute(stmt).scalars().first()


def _latest_reward(db: Session) -> models.Reward | None:
    stmt = select(models.Reward).order_by(models.Reward.created_at.desc())
    return db.execute(stmt).scalars().first()


def _latest_reward_claim(db: Session) -> models.RewardClaim | None:
    stmt = (
        select(models.RewardClaim)
        .options(
            selectinload(models.RewardClaim.reward),
            selectinload(models.RewardClaim.user),
        )
        .order_by(models.RewardClaim.claimed_at.desc())
    )
    return db.execute(stmt).scalars().first()


def _latest_notification(db: Session) -> models.Notification | None:
    stmt = select(models.Notification).order_by(models.Notification.created_at.desc())
    return db.execute(stmt).scalars().first()


def _latest_department(db: Session) -> models.Department | None:
    stmt = select(models.Department).order_by(models.Department.name.asc())
    return db.execute(stmt).scalars().first()


def _latest_points_table(db: Session) -> models.PointsTableConfig | None:
    return db.get(models.PointsTableConfig, 1)


def _latest_ticket(db: Session) -> ticket_models.Ticket | None:
    stmt = select(ticket_models.Ticket).order_by(ticket_models.Ticket.created_at.desc())
    return db.execute(stmt).scalars().first()


def get_sample_data(db: Session, event_name: str) -> dict[str, Any]:
    settings = get_settings()
    if event_name == "test":
        return {
            "message": "Test webhook from ZeaPlay",
            "environment": settings.environment,
        }
    if event_name.startswith("ticket."):
        ticket = _latest_ticket(db)
        if ticket:
            return {
                "ticket": ticket_schemas.TicketRead.model_validate(ticket).model_dump(),
            }
        return {"ticket": None}
    if event_name.startswith("task."):
        task = _latest_task(db)
        if task:
            return {"task": schemas.TaskRead.model_validate(task).model_dump()}
        return {"task": None}
    if event_name.startswith("comment."):
        comment = _latest_comment(db)
        if comment:
            return {"comment": schemas.CommentRead.model_validate(comment).model_dump()}
        return {"comment": None}
    if event_name.startswith("user."):
        user = _latest_user(db)
        if user:
            return {"user": schemas.UserRead.model_validate(user).model_dump()}
        return {"user": None}
    if event_name.startswith("reward."):
        if event_name == "reward.claimed":
            claim = _latest_reward_claim(db)
            if claim:
                return {"claim": schemas.RewardClaimRead.model_validate(claim).model_dump()}
            return {"claim": None}
        reward = _latest_reward(db)
        if reward:
            return {"reward": schemas.RewardRead.model_validate(reward).model_dump()}
        return {"reward": None}
    if event_name.startswith("notification."):
        notification = _latest_notification(db)
        if notification:
            return {"notification": schemas.NotificationRead.model_validate(notification).model_dump()}
        return {"notification": None}
    if event_name.startswith("points_table."):
        points_table = _latest_points_table(db)
        if points_table:
            return {"points_table": schemas.PointsTableConfigRead.model_validate(points_table).model_dump()}
        return {"points_table": None}
    if event_name.startswith("department."):
        department = _latest_department(db)
        if department:
            return {"department": schemas.DepartmentRead.model_validate(department).model_dump()}
        return {"department": None}
    return {"message": "Sample payload unavailable", "event": event_name}
