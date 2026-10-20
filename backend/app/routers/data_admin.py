from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Dict, Iterable, List

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, inspect, select
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import hash_password, verify_password
from ..database import SessionLocal, get_db, session_scope
from ..dependencies import get_current_owner
from ..email_utils import EmailDeliveryError, resolve_smtp_config, send_notification_email
from ..models import task_dependencies
from ..seed import seed_database
from ..services import rewards as reward_service
from ..lifecycle.context import bind_actor

OTP_EXPIRATION_MINUTES = 10
OTP_MAX_ATTEMPTS = 5

router = APIRouter(prefix="/admin/data", tags=["admin-data"])


def _resolve_tenant_id(employer_id: str | None) -> uuid.UUID:
    if employer_id:
        try:
            return uuid.UUID(str(employer_id))
        except ValueError:
            return uuid.uuid5(uuid.NAMESPACE_URL, f"zea-play-tenant:{employer_id}")
    return uuid.uuid5(uuid.NAMESPACE_URL, "zea-play-tenant:default")


def _serialize_users(users: Iterable[models.User]) -> List[schemas.UserBackup]:
    return [
        schemas.UserBackup(
            id=user.id,
            name=user.name,
            email=user.email,
            employer_id=user.employer_id,
            role=user.role,
            status=user.status,
            department_id=user.department_id,
            manager_id=user.manager_id,
            manager_email=user.manager_email,
            shift_name=user.shift_name,
            shift_start=user.shift_start,
            shift_end=user.shift_end,
            morning_break_start=user.morning_break_start,
            morning_break_end=user.morning_break_end,
            lunch_break_start=user.lunch_break_start,
            lunch_break_end=user.lunch_break_end,
            evening_break_start=user.evening_break_start,
            evening_break_end=user.evening_break_end,
            title=user.title,
            phone=user.phone,
            location=user.location,
            timezone=user.timezone,
            notes=user.notes,
            skills=list(user.skills or []),
            projects=list(user.projects or []),
            points=user.points,
            tasks_created=user.tasks_created,
            tasks_completed=user.tasks_completed,
            clarity_scores=list(user.clarity_scores or []),
            claimed_reward_ids=list(user.claimed_reward_ids or []),
            unlocked_achievement_ids=list(user.unlocked_achievement_ids or []),
            hashed_password=user.hashed_password,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
        for user in users
    ]


def _build_status_title_map(columns: Iterable[models.KanbanColumn]) -> dict[str, str]:
    return {column.id: column.title for column in columns}


def _serialize_tasks(tasks: Iterable[models.Task], status_title_map: dict[str, str] | None = None) -> List[schemas.TaskBackup]:
    status_title_map = status_title_map or {}
    result: List[schemas.TaskBackup] = []
    for task in tasks:
        status_key = getattr(task.status, "value", task.status)
        status_title = status_title_map.get(status_key, status_key)
        subtasks = [
            schemas.TaskSubtaskBackup(
                id=sub.id,
                title=sub.title,
                completed=sub.completed,
                assigned_to_id=sub.assigned_to_id,
                status=sub.status,
                sort_order=sub.sort_order,
            )
            for sub in task.subtasks
        ]
        comments = [
            schemas.TaskCommentBackup(
                id=comment.id,
                user_id=comment.user_id,
                content=comment.content,
                created_at=comment.created_at,
            )
            for comment in task.comments
        ]
        result.append(
            schemas.TaskBackup(
                id=task.id,
                title=task.title,
                description=task.description,
                status=task.status,
                status_title=status_title,
                priority=task.priority,
                team=task.team,
                project_id=task.project_id if task.project_id and session.get(models.Project, task.project_id) else None,
                assigned_to_id=task.assigned_to_id,
                task_group_id=task.task_group_id,
                created_by_id=task.created_by_id,
                created_at=task.created_at,
                updated_at=task.updated_at,
                due_at=task.due_at,
                completed_at=task.completed_at,
                recurrence_rule=task.recurrence_rule,
                recurring_task_id=task.recurring_task_id,
                clarity_rating=task.clarity_rating,
                attachments=list(task.attachments or []),
                estimated_hours=task.estimated_hours,
                tags=list(task.tags or []),
                subtasks=subtasks,
                comments=comments,
                dependencies=[dependency.id for dependency in task.dependencies],
            )
        )
    return result


def _serialize_notifications(notifications: Iterable[models.Notification]) -> List[schemas.NotificationBackup]:
    return [
        schemas.NotificationBackup(
            id=notif.id,
            user_id=notif.user_id,
            type=notif.type,
            message=notif.message,
            is_read=notif.is_read,
            related_task_id=notif.related_task_id,
            related_reward_id=notif.related_reward_id,
            related_chat_id=notif.related_chat_id,
            created_at=notif.created_at,
        )
        for notif in notifications
    ]


def _serialize_reward_claims(claims: Iterable[models.RewardClaim]) -> List[schemas.UserRewardBackup]:
    return [
        schemas.UserRewardBackup(
            id=claim.id,
            user_id=claim.user_id,
            reward_id=claim.reward_id,
            status=claim.status,
            xp_spent=claim.xp_spent,
            claimed_at=claim.claimed_at,
            resolved_at=claim.resolved_at,
            approver_id=claim.approver_id,
        )
        for claim in claims
    ]


def _serialize_user_achievements(
    user_achievements: Iterable[models.UserAchievement],
) -> List[schemas.UserAchievementBackup]:
    return [
        schemas.UserAchievementBackup(
            user_id=item.user_id,
            achievement_id=item.achievement_id,
            unlocked_at=item.unlocked_at,
        )
        for item in user_achievements
    ]


def _serialize_kanban_columns(
    columns: Iterable[models.KanbanColumn],
) -> List[schemas.KanbanColumnBackup]:
    return [
        schemas.KanbanColumnBackup(id=column.id, title=column.title, order=column.order)
        for column in columns
    ]


@router.get("/export", response_model=schemas.DataExportBundle)
def export_data(
    *,
    scope: schemas.DataExportScope = Query(default=schemas.DataExportScope.ALL),
    current_owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> schemas.DataExportBundle:
    del current_owner  # owner already validated by dependency

    departments: List[schemas.DepartmentRead] = []
    users: List[schemas.UserBackup] = []
    tasks: List[schemas.TaskBackup] = []
    achievements: List[schemas.AchievementRead] = []
    rewards: List[schemas.RewardRead] = []
    kanban_columns: List[schemas.KanbanColumnBackup] = []
    notifications: List[schemas.NotificationBackup] = []
    user_rewards: List[schemas.UserRewardBackup] = []
    user_achievements: List[schemas.UserAchievementBackup] = []

    if scope in {schemas.DataExportScope.USERS, schemas.DataExportScope.ALL, schemas.DataExportScope.DEPARTMENTS}:
        departments = [
            schemas.DepartmentRead.model_validate(dept)
            for dept in db.execute(select(models.Department)).scalars().all()
        ]
        if scope in {schemas.DataExportScope.USERS, schemas.DataExportScope.ALL}:
            users = _serialize_users(db.execute(select(models.User)).scalars().all())

    if scope in {schemas.DataExportScope.TASKS, schemas.DataExportScope.ALL}:
        task_query = (
            select(models.Task)
            .options(
                joinedload(models.Task.subtasks),
                joinedload(models.Task.comments),
                joinedload(models.Task.dependencies),
            )
        )
        columns: List[models.KanbanColumn] = []
        try:
            inspector = inspect(db.bind)
            if "kanban_columns" in inspector.get_table_names():
                columns = db.execute(select(models.KanbanColumn)).scalars().all()
        except Exception:
            columns = []
        status_title_map = _build_status_title_map(columns)
        tasks = _serialize_tasks(db.execute(task_query).unique().scalars().all(), status_title_map)
        kanban_columns = _serialize_kanban_columns(columns)

    if scope is schemas.DataExportScope.ALL:
        achievements = [
            schemas.AchievementRead.model_validate(achievement)
            for achievement in db.execute(select(models.Achievement)).scalars().all()
        ]
        rewards = [
            reward_service.get_reward_read(db, reward.id)
            for reward in db.execute(select(models.Reward)).scalars().all()
        ]
        notifications = _serialize_notifications(
            db.execute(select(models.Notification)).scalars().all()
        )
        user_rewards = _serialize_reward_claims(
            db.execute(select(models.RewardClaim)).scalars().all()
        )
        user_achievements = _serialize_user_achievements(
            db.execute(select(models.UserAchievement)).scalars().all()
        )
        if scope not in {schemas.DataExportScope.USERS}:
            if not departments:
                departments = [
                    schemas.DepartmentRead.model_validate(dept)
                    for dept in db.execute(select(models.Department)).scalars().all()
                ]
            if not users:
                users = _serialize_users(db.execute(select(models.User)).scalars().all())

    bundle = schemas.DataExportBundle(
        scope=scope,
        generated_at=datetime.utcnow(),
        departments=departments,
        users=users,
        tasks=tasks,
        achievements=achievements,
        rewards=rewards,
        kanban_columns=kanban_columns,
        notifications=notifications,
        user_rewards=user_rewards,
        user_achievements=user_achievements,
    )
    return bundle


@router.post("/import", status_code=status.HTTP_202_ACCEPTED)
def import_data(
    payload: schemas.DataImportPayload,
    current_owner: models.User = Depends(get_current_owner),
) -> Dict[str, str]:
    with session_scope() as session:
        bind_actor(session, current_owner)
        if payload.scope is schemas.DataExportScope.DEPARTMENTS:
            for department in payload.departments:
                existing_department = session.get(models.Department, department.id)
                if not existing_department:
                    existing_department = session.execute(
                        select(models.Department).where(models.Department.name == department.name)
                    ).scalar_one_or_none()
                if existing_department:
                    existing_department.name = department.name
                else:
                    session.add(models.Department(id=department.id, name=department.name))
            return {"status": "imported_departments"}

        if payload.scope is schemas.DataExportScope.USERS:
            valid_department_ids = set(
                session.execute(select(models.Department.id)).scalars().all()
            )
            department_id_map: Dict[str, str] = {}
            for department in payload.departments:
                existing_department = session.get(models.Department, department.id)
                if not existing_department:
                    existing_department = session.execute(
                        select(models.Department).where(models.Department.name == department.name)
                    ).scalar_one_or_none()
                if existing_department:
                    existing_department.name = department.name
                    department_id_map[department.id] = existing_department.id
                    valid_department_ids.add(existing_department.id)
                else:
                    session.add(models.Department(id=department.id, name=department.name))
                    department_id_map[department.id] = department.id
                    valid_department_ids.add(department.id)

            for user in payload.users:
                mapped_department_id = (
                    department_id_map.get(user.department_id) if user.department_id else None
                )
                department_id = (
                    mapped_department_id
                    if mapped_department_id in valid_department_ids
                    else (user.department_id if user.department_id in valid_department_ids else None)
                )
                existing_user = session.get(models.User, user.id)
                if not existing_user:
                    existing_user = session.execute(
                        select(models.User).where(models.User.email == user.email)
                    ).scalar_one_or_none()
                if existing_user:
                    existing_user.name = user.name
                    existing_user.email = user.email
                    existing_user.employer_id = user.employer_id
                    existing_user.role = user.role
                    existing_user.status = user.status
                    existing_user.department_id = department_id
                    existing_user.manager_id = user.manager_id
                    existing_user.manager_email = user.manager_email
                    existing_user.shift_name = user.shift_name
                    existing_user.shift_start = user.shift_start
                    existing_user.shift_end = user.shift_end
                    existing_user.morning_break_start = user.morning_break_start
                    existing_user.morning_break_end = user.morning_break_end
                    existing_user.lunch_break_start = user.lunch_break_start
                    existing_user.lunch_break_end = user.lunch_break_end
                    existing_user.evening_break_start = user.evening_break_start
                    existing_user.evening_break_end = user.evening_break_end
                    existing_user.title = user.title
                    existing_user.phone = user.phone
                    existing_user.location = user.location
                    existing_user.timezone = user.timezone
                    existing_user.notes = user.notes
                    existing_user.skills = list(user.skills or [])
                    existing_user.projects = list(user.projects or [])
                    existing_user.points = user.points
                    existing_user.tasks_created = user.tasks_created
                    existing_user.tasks_completed = user.tasks_completed
                    existing_user.clarity_scores = list(user.clarity_scores)
                    existing_user.claimed_reward_ids = list(user.claimed_reward_ids)
                    existing_user.unlocked_achievement_ids = list(user.unlocked_achievement_ids)
                    existing_user.hashed_password = user.hashed_password
                    existing_user.created_at = user.created_at
                    existing_user.updated_at = user.updated_at
                else:
                    session.add(
                        models.User(
                            id=user.id,
                            tenant_id=_resolve_tenant_id(user.employer_id),
                            name=user.name,
                            email=user.email,
                            employer_id=user.employer_id,
                            hashed_password=user.hashed_password,
                            role=user.role,
                            status=user.status,
                            department_id=department_id,
                            manager_id=user.manager_id,
                            manager_email=user.manager_email,
                            shift_name=user.shift_name,
                            shift_start=user.shift_start,
                            shift_end=user.shift_end,
                            morning_break_start=user.morning_break_start,
                            morning_break_end=user.morning_break_end,
                            lunch_break_start=user.lunch_break_start,
                            lunch_break_end=user.lunch_break_end,
                            evening_break_start=user.evening_break_start,
                            evening_break_end=user.evening_break_end,
                            title=user.title,
                            phone=user.phone,
                            location=user.location,
                            timezone=user.timezone,
                            notes=user.notes,
                            skills=list(user.skills or []),
                            projects=list(user.projects or []),
                            points=user.points,
                            tasks_created=user.tasks_created,
                            tasks_completed=user.tasks_completed,
                            clarity_scores=list(user.clarity_scores),
                            claimed_reward_ids=list(user.claimed_reward_ids),
                            unlocked_achievement_ids=list(user.unlocked_achievement_ids),
                            created_at=user.created_at,
                            updated_at=user.updated_at,
                        )
                    )

            return {"status": "imported_users"}

        if payload.scope is schemas.DataExportScope.TASKS:
            session.execute(delete(models.Comment))
            session.execute(delete(models.Subtask))
            session.execute(task_dependencies.delete())
            session.execute(delete(models.Task))
            session.execute(delete(models.KanbanColumn))

            for column in payload.kanban_columns:
                session.add(
                    models.KanbanColumn(id=column.id, title=column.title, order=column.order)
                )

            session.flush()

            task_map: Dict[str, models.Task] = {}
            for task in payload.tasks:
                task_obj = models.Task(
                    id=task.id,
                    title=task.title,
                    description=task.description,
                    status=task.status,
                    priority=task.priority,
                    team=task.team,
                    project_id=task.project_id if task.project_id and session.get(models.Project, task.project_id) else None,
                    assigned_to_id=task.assigned_to_id,
                    created_by_id=task.created_by_id,
                    created_at=task.created_at,
                    updated_at=task.updated_at,
                    due_at=task.due_at,
                    completed_at=task.completed_at,
                    recurrence_rule=task.recurrence_rule,
                    recurring_task_id=task.recurring_task_id,
                    clarity_rating=task.clarity_rating,
                    attachments=list(task.attachments),
                    estimated_hours=task.estimated_hours,
                    tags=list(task.tags),
                )
                for subtask in task.subtasks:
                    task_obj.subtasks.append(
                        models.Subtask(
                            id=subtask.id or models.generate_uuid(),
                            title=subtask.title,
                            completed=subtask.completed,
                            assigned_to_id=subtask.assigned_to_id,
                            status=subtask.status or (
                                models.SubtaskStatusEnum.DONE
                                if subtask.completed
                                else models.SubtaskStatusEnum.TODO
                            ),
                            sort_order=subtask.sort_order,
                        )
                    )
                for comment in task.comments:
                    task_obj.comments.append(
                        models.Comment(
                            id=comment.id or models.generate_uuid(),
                            user_id=comment.user_id,
                            content=comment.content,
                            created_at=comment.created_at,
                        )
                    )
                session.add(task_obj)
                task_map[task.id] = task_obj

            session.flush()

            for task in payload.tasks:
                task_obj = task_map.get(task.id)
                if not task_obj:
                    continue
                task_obj.dependencies = [task_map[dep_id] for dep_id in task.dependencies if dep_id in task_map]

            return {"status": "imported_tasks"}

        if payload.scope is not schemas.DataExportScope.ALL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported import scope.",
            )

        # Clear existing data in order respecting FK constraints
        session.execute(delete(models.Notification))
        session.execute(delete(models.RewardClaim))
        session.execute(delete(models.UserAchievement))
        session.execute(delete(models.Comment))
        session.execute(delete(models.Subtask))
        session.execute(task_dependencies.delete())
        session.execute(delete(models.Task))
        session.execute(delete(models.KanbanColumn))
        session.execute(delete(models.Reward))
        session.execute(delete(models.Achievement))
        session.execute(delete(models.User))
        session.execute(delete(models.Department))

        # Departments
        for department in payload.departments:
            session.add(models.Department(id=department.id, name=department.name))

        # Users
        for user in payload.users:
            session.add(
                models.User(
                    id=user.id,
                    tenant_id=_resolve_tenant_id(user.employer_id),
                    name=user.name,
                    email=user.email,
                    employer_id=user.employer_id,
                    hashed_password=user.hashed_password,
                    role=user.role,
                    status=user.status,
                    department_id=user.department_id,
                    manager_id=user.manager_id,
                    manager_email=user.manager_email,
                    shift_name=user.shift_name,
                    shift_start=user.shift_start,
                    shift_end=user.shift_end,
                    morning_break_start=user.morning_break_start,
                    morning_break_end=user.morning_break_end,
                    lunch_break_start=user.lunch_break_start,
                    lunch_break_end=user.lunch_break_end,
                    evening_break_start=user.evening_break_start,
                    evening_break_end=user.evening_break_end,
                    title=user.title,
                    phone=user.phone,
                    location=user.location,
                    timezone=user.timezone,
                    notes=user.notes,
                    skills=list(user.skills or []),
                    projects=list(user.projects or []),
                    points=user.points,
                    tasks_created=user.tasks_created,
                    tasks_completed=user.tasks_completed,
                    clarity_scores=list(user.clarity_scores),
                    claimed_reward_ids=list(user.claimed_reward_ids),
                    unlocked_achievement_ids=list(user.unlocked_achievement_ids),
                    created_at=user.created_at,
                    updated_at=user.updated_at,
                )
            )

        # Achievements and rewards
        for achievement in payload.achievements:
            session.add(
                models.Achievement(
                    id=achievement.id,
                    title=achievement.title,
                    description=achievement.description,
                    points=achievement.points,
                    icon=achievement.icon,
                )
            )

        for reward in payload.rewards:
            session.add(
                models.Reward(
                    id=reward.id,
                    title=reward.title,
                    description=reward.description,
                    image_source=reward.image_source,
                    image_ref=reward.image_ref,
                    xp_required=reward.xp_required,
                    dept_whitelist=list(reward.dept_whitelist or []),
                    auto_redeem=reward.auto_redeem,
                    allow_multiple_claims=reward.allow_multiple_claims,
                    expires_at=reward.expires_at,
                    status=reward.status,
                    created_by_id=reward.created_by_id,
                    updated_by_id=reward.updated_by_id,
                    created_at=reward.created_at,
                    updated_at=reward.updated_at,
                )
            )

        for column in payload.kanban_columns:
            session.add(
                models.KanbanColumn(id=column.id, title=column.title, order=column.order)
            )

        session.flush()

        # Tasks
        task_map: Dict[str, models.Task] = {}
        for task in payload.tasks:
            task_obj = models.Task(
                id=task.id,
                title=task.title,
                description=task.description,
                status=task.status,
                priority=task.priority,
                team=task.team,
                project_id=task.project_id if task.project_id and session.get(models.Project, task.project_id) else None,
                assigned_to_id=task.assigned_to_id,
                created_by_id=task.created_by_id,
                created_at=task.created_at,
                updated_at=task.updated_at,
                due_at=task.due_at,
                completed_at=task.completed_at,
                recurrence_rule=task.recurrence_rule,
                recurring_task_id=task.recurring_task_id,
                clarity_rating=task.clarity_rating,
                attachments=list(task.attachments),
                estimated_hours=task.estimated_hours,
                tags=list(task.tags),
            )
            for subtask in task.subtasks:
                task_obj.subtasks.append(
                    models.Subtask(
                        id=subtask.id or models.generate_uuid(),
                        title=subtask.title,
                        completed=subtask.completed,
                        assigned_to_id=subtask.assigned_to_id,
                        status=subtask.status or (
                            models.SubtaskStatusEnum.DONE
                            if subtask.completed
                            else models.SubtaskStatusEnum.TODO
                        ),
                        sort_order=subtask.sort_order,
                    )
                )
            for comment in task.comments:
                task_obj.comments.append(
                    models.Comment(
                        id=comment.id or models.generate_uuid(),
                        user_id=comment.user_id,
                        content=comment.content,
                        created_at=comment.created_at,
                    )
                )
            session.add(task_obj)
            task_map[task.id] = task_obj

        session.flush()

        for task in payload.tasks:
            task_obj = task_map.get(task.id)
            if not task_obj:
                continue
            task_obj.dependencies = [task_map[dep_id] for dep_id in task.dependencies if dep_id in task_map]

        # Notifications and relations
        for notification in payload.notifications:
            session.add(
                models.Notification(
                    id=notification.id,
                    user_id=notification.user_id,
                    type=notification.type,
                    message=notification.message,
                    is_read=notification.is_read,
                    related_task_id=notification.related_task_id,
                    related_reward_id=notification.related_reward_id,
                    related_chat_id=notification.related_chat_id,
                    created_at=notification.created_at,
                )
            )

        for claim in payload.user_rewards:
            session.add(
                models.RewardClaim(
                    id=claim.id,
                    user_id=claim.user_id,
                    reward_id=claim.reward_id,
                    status=claim.status,
                    xp_spent=claim.xp_spent,
                    claimed_at=claim.claimed_at,
                    resolved_at=claim.resolved_at,
                    approver_id=claim.approver_id,
                )
            )

        for unlock in payload.user_achievements:
            session.add(
                models.UserAchievement(
                    user_id=unlock.user_id,
                    achievement_id=unlock.achievement_id,
                    unlocked_at=unlock.unlocked_at,
                )
            )

    # Re-run seed to ensure reference data like achievements/rewards exist if not provided
    if payload.scope is schemas.DataExportScope.ALL:
        seed_database()

    return {"status": "imported"}


@router.post("/reset/request", status_code=status.HTTP_202_ACCEPTED)
def request_reset_otp(
    current_owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    otp = ''.join(secrets.choice('0123456789') for _ in range(6))
    otp_hash = hash_password(otp)
    expires_at = datetime.utcnow() + timedelta(minutes=OTP_EXPIRATION_MINUTES)

    token = db.get(models.OwnerResetToken, current_owner.id)
    if token:
        token.otp_hash = otp_hash
        token.expires_at = expires_at
        token.attempts = 0
        token.created_at = datetime.utcnow()
    else:
        token = models.OwnerResetToken(
            owner_id=current_owner.id,
            otp_hash=otp_hash,
            expires_at=expires_at,
            attempts=0,
            created_at=datetime.utcnow(),
        )
        db.add(token)
    db.commit()

    smtp_config = resolve_smtp_config(db, "otp", current_owner.tenant_id)
    if not smtp_config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMTP configuration is required before requesting a reset.",
        )
    try:
        send_notification_email(
            db=db,
            notification_type="otp",
            tenant_id=current_owner.tenant_id,
            to_address=current_owner.email,
            subject="Vee Task Manager reset OTP",
            body=(
                "A full system reset was requested.\n\n"
                f"One Time Passcode: {otp}\n"
                "This code expires in 10 minutes. If you did not request this, please contact support."
            ),
        )
    except EmailDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Verification email could not be accepted by the SMTP server. Check SMTP Management.",
        ) from exc

    return {"status": "otp_sent"}


@router.post("/reset/confirm", status_code=status.HTTP_202_ACCEPTED)
def confirm_reset(
    payload: schemas.ResetConfirmPayload,
    current_owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    token = db.get(models.OwnerResetToken, current_owner.id)
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset not requested")

    if datetime.utcnow() > token.expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP expired")

    if token.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts")

    if not verify_password(payload.otp, token.otp_hash):
        token.attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP")

    # OTP valid – perform reset
    db.delete(token)
    db.commit()

    with session_scope() as session:
        bind_actor(session, current_owner)
        session.execute(delete(models.Notification))
        session.execute(delete(models.RewardClaim))
        session.execute(delete(models.UserAchievement))
        session.execute(delete(models.Comment))
        session.execute(delete(models.Subtask))
        session.execute(task_dependencies.delete())
        session.execute(delete(models.Task))
        session.execute(delete(models.KanbanColumn))
        session.execute(delete(models.Reward))
        session.execute(delete(models.Achievement))
        session.execute(delete(models.User))
        session.execute(delete(models.Department))
        session.execute(delete(models.OwnerResetToken))

    seed_database()

    return {"status": "reset"}
