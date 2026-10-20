"""Gamification helpers for achievements and rewards."""

from contextlib import contextmanager
from datetime import datetime
from statistics import mean
from threading import Lock
from typing import Optional

from sqlalchemy import func, select, inspect
from sqlalchemy.orm import Session

from .. import models
from .notifications import create_notification
from .badge_engine import BadgeEvent, process_badge_event
from .points_table import (
    get_clarity_points_per_star,
    get_manager_overdue_penalty,
    resolve_task_points,
)

COMPLETED_STATUSES = {models.TaskStatusEnum.DONE, models.TaskStatusEnum.DEPLOYED}
_completion_award_registry_lock = Lock()
_completion_award_locks: dict[str, Lock] = {}
_clarity_award_registry_lock = Lock()
_clarity_award_locks: dict[str, Lock] = {}


@contextmanager
def _completion_award_lock(task_id: str):
    with _completion_award_registry_lock:
        lock = _completion_award_locks.setdefault(task_id, Lock())
    with lock:
        yield


@contextmanager
def _clarity_award_lock(task_id: str):
    with _clarity_award_registry_lock:
        lock = _clarity_award_locks.setdefault(task_id, Lock())
    with lock:
        yield


def _department_matches_team(db: Session, user: models.User, team: str) -> bool:
    if not team or not user.department_id:
        return False
    if user.department and user.department.name:
        department_name = user.department.name
    else:
        department = db.get(models.Department, user.department_id)
        department_name = department.name if department else ""
    normalized_team = "".join(ch for ch in team.lower() if ch.isalnum())
    normalized_department = "".join(ch for ch in department_name.lower() if ch.isalnum())
    return normalized_team != "" and normalized_team == normalized_department


def grant_achievement_by_id(db: Session, user: models.User, achievement_id: str) -> Optional[models.Achievement]:
    try:
        if "badges" in inspect(db.bind).get_table_names():
            return None
    except Exception:
        return None
    if achievement_id in user.unlocked_achievement_ids:
        return None

    achievement = db.get(models.Achievement, achievement_id)
    if not achievement:
        return None

    unlocked_ids = list(user.unlocked_achievement_ids or [])
    unlocked_ids.append(achievement_id)
    user.unlocked_achievement_ids = unlocked_ids
    user.points += achievement.points
    create_notification(
        db,
        user_id=user.id,
        notification_type=models.NotificationTypeEnum.ACHIEVEMENT_UNLOCKED,
        message=f"Achievement unlocked: {achievement.title}!",
    )
    return achievement


def check_and_unlock_achievements(db: Session, user: models.User) -> None:
    try:
        if "badges" in inspect(db.bind).get_table_names():
            return
    except Exception:
        return
    achievements = db.execute(select(models.Achievement)).scalars().all()
    unlocked = set(user.unlocked_achievement_ids)

    for achievement in achievements:
        if achievement.id in unlocked or achievement.id == "ach-4":
            continue

        should_unlock = False
        if achievement.id == "ach-1" and user.tasks_completed >= 1:
            should_unlock = True
        elif achievement.id == "ach-2" and user.tasks_completed >= 5:
            should_unlock = True
        elif achievement.id == "ach-3":
            high_priority_count = db.execute(
                select(func.count(models.Task.id))
                .where(models.Task.assigned_to_id == user.id)
                .where(models.Task.status.in_(COMPLETED_STATUSES))
                .where(models.Task.priority.in_([models.TaskPriorityEnum.HIGH, models.TaskPriorityEnum.URGENT]))
            ).scalar_one()
            if high_priority_count >= 3:
                should_unlock = True
        elif achievement.id == "ach-5" and user.tasks_created >= 5:
            should_unlock = True
        elif achievement.id == "ach-6" and len(user.clarity_scores) >= 3:
            if mean(user.clarity_scores) >= 4:
                should_unlock = True

        if should_unlock:
            grant_achievement_by_id(db, user, achievement.id)


def award_task_completion_points(db: Session, task: models.Task, *, notify_creator: bool = True) -> bool:
    db.flush()
    with _completion_award_lock(task.id):
        locked_task = db.execute(
            select(models.Task)
            .where(models.Task.id == task.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked_task is None:
            return False
        if locked_task.status not in COMPLETED_STATUSES:
            return False
        if locked_task.completion_xp_awarded_at is not None:
            return False

        assignee = db.get(models.User, locked_task.assigned_to_id) if locked_task.assigned_to_id else None
        creator = db.get(models.User, locked_task.created_by_id)
        awarded_points = 0

        if assignee:
            points = resolve_task_points(db, team=locked_task.team, priority=locked_task.priority)
            base_points = points.get("base", 0)
            bonus_points = points.get("beforeDueBonus", 0)
            penalty_points = points.get("overduePenalty", 0)

            completed_at = locked_task.completed_at
            due_at = locked_task.due_at
            is_late = False
            if completed_at and due_at:
                if completed_at <= due_at:
                    total_points = base_points + bonus_points
                else:
                    total_points = base_points + penalty_points
                    is_late = True
            else:
                total_points = base_points

            assignee.points += total_points
            assignee.tasks_completed += 1
            awarded_points = total_points
            check_and_unlock_achievements(db, assignee)

            if locked_task.priority == models.TaskPriorityEnum.URGENT:
                grant_achievement_by_id(db, assignee, "ach-4")

            if creator and assignee.id != creator.id and is_late and creator.role == models.RoleEnum.MANAGER:
                manager_penalty = get_manager_overdue_penalty(db)
                if manager_penalty and _department_matches_team(db, creator, locked_task.team):
                    creator.points += manager_penalty
                    check_and_unlock_achievements(db, creator)

        locked_task.completion_xp_awarded_at = datetime.utcnow()
        locked_task.completion_xp_awarded_to_id = assignee.id if assignee else None
        locked_task.completion_xp_points_awarded = awarded_points

        if creator and notify_creator:
            assignee_name = assignee.name if assignee else "Someone"
            create_notification(
                db,
                user_id=creator.id,
                notification_type=models.NotificationTypeEnum.TASK_COMPLETED,
                message=f"{assignee_name} completed the task: '{locked_task.title}'.",
                related_task_id=locked_task.id,
            )
        db.flush()
        return True


def record_clarity_rating(db: Session, task: models.Task, rating: int) -> bool:
    safe_rating = max(0, min(int(rating), 5))
    db.flush()
    with _clarity_award_lock(task.id):
        locked_task = db.execute(
            select(models.Task)
            .where(models.Task.id == task.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if locked_task is None:
            return False
        if locked_task.clarity_xp_awarded_at is not None:
            return False

        creator = db.get(models.User, locked_task.created_by_id)
        if not creator:
            return False

        awarded_points = safe_rating * get_clarity_points_per_star(db)
        locked_task.clarity_rating = safe_rating
        locked_task.clarity_xp_awarded_at = datetime.utcnow()
        locked_task.clarity_xp_awarded_to_id = creator.id
        locked_task.clarity_xp_points_awarded = awarded_points

        clarity_scores = list(creator.clarity_scores or [])
        clarity_scores.append(safe_rating)
        creator.clarity_scores = clarity_scores
        creator.points += awarded_points
        check_and_unlock_achievements(db, creator)
        process_badge_event(
            db,
            event=BadgeEvent(
                entity="manual",
                event="updated",
                actor_id=creator.id,
                assigned_to_id=locked_task.assigned_to_id,
                created_by_id=creator.id,
                priority=locked_task.priority.value,
            ),
        )
        db.flush()
        return True
