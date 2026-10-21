from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..auth import hash_password, verify_password
from ..avatar_utils import (
    resolve_avatar_asset,
    select_user_avatar,
    set_user_avatar_from_data_url,
)
from ..database import get_db
from ..dependencies import ensure_user_admin_scope as _ensure_user_admin_scope
from ..dependencies import get_current_active_user, get_current_admin
from ..integrations import trigger_n8n_event
from ..services import audit_logger, password_recovery
from ..services import notifications as notification_service

router = APIRouter(prefix="/users", tags=["users"])


def _ensure_avatar_permission(actor: models.User, target: models.User) -> None:
    if actor.tenant_id != target.tenant_id:
        raise HTTPException(404, "User not found")
    if actor.id == target.id:
        return
    if actor.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to update this avatar",
        )
    _ensure_user_admin_scope(actor, target=target)


def _get_admin_ids(db: Session, tenant_id) -> list[str]:
    return (
        db.execute(
            select(models.User.id).where(models.User.tenant_id == tenant_id,
                models.User.role.in_({models.RoleEnum.ADMIN, models.RoleEnum.OWNER, models.RoleEnum.MANAGER}),
                models.User.status == models.UserStatusEnum.ACTIVE)
        )
        .scalars()
        .all()
    )


def _validate_profile_update(db, user, payload):
    expected = getattr(payload, 'expected_updated_at', None)
    def utc_naive(value):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    if expected is not None and utc_naive(expected) != utc_naive(user.updated_at):
        raise HTTPException(409, 'Profile changed. Reload the latest profile before saving.')
    if 'manager_id' in payload.model_fields_set and payload.manager_id:
        manager = db.scalar(select(models.User).where(models.User.id == payload.manager_id, models.User.tenant_id == user.tenant_id))
        if not manager or manager.id == user.id:
            raise HTTPException(400, 'Select a manager in this workspace')
    if 'department_id' in payload.model_fields_set and payload.department_id and not db.get(models.Department, payload.department_id):
        raise HTTPException(400, 'Department not found')


def _apply_user_updates(db: Session, user: models.User, payload: schemas.UserUpdate, *, actor=None) -> None:
    if payload.name is not None:
        user.name = payload.name
    if "employer_id" in payload.model_fields_set:
        user.employer_id = payload.employer_id
    if payload.role is not None:
        user.role = payload.role
    if payload.status is not None:
        user.status = payload.status
    if "department_id" in payload.model_fields_set:
        user.department_id = payload.department_id
    if "manager_id" in payload.model_fields_set:
        user.manager_id = payload.manager_id
    if "manager_email" in payload.model_fields_set:
        user.manager_email = payload.manager_email
    if "shift_name" in payload.model_fields_set:
        user.shift_name = payload.shift_name
    if "shift_start" in payload.model_fields_set:
        user.shift_start = payload.shift_start
    if "shift_end" in payload.model_fields_set:
        user.shift_end = payload.shift_end
    if "morning_break_start" in payload.model_fields_set:
        user.morning_break_start = payload.morning_break_start
    if "morning_break_end" in payload.model_fields_set:
        user.morning_break_end = payload.morning_break_end
    if "lunch_break_start" in payload.model_fields_set:
        user.lunch_break_start = payload.lunch_break_start
    if "lunch_break_end" in payload.model_fields_set:
        user.lunch_break_end = payload.lunch_break_end
    if "evening_break_start" in payload.model_fields_set:
        user.evening_break_start = payload.evening_break_start
    if "evening_break_end" in payload.model_fields_set:
        user.evening_break_end = payload.evening_break_end
    if "title" in payload.model_fields_set:
        user.title = payload.title
    if "phone" in payload.model_fields_set:
        user.phone = payload.phone
    if "location" in payload.model_fields_set:
        user.location = payload.location
    if "timezone" in payload.model_fields_set:
        user.timezone = payload.timezone
    if "notes" in payload.model_fields_set:
        user.notes = payload.notes
    if "skills" in payload.model_fields_set:
        user.skills = payload.skills or []
    if "projects" in payload.model_fields_set:
        user.projects = payload.projects or []
    if payload.points is not None:
        user.points = payload.points
    if payload.tasks_created is not None:
        user.tasks_created = payload.tasks_created
    if payload.tasks_completed is not None:
        user.tasks_completed = payload.tasks_completed
    if payload.clarity_scores is not None:
        user.clarity_scores = payload.clarity_scores
    if payload.claimed_reward_ids is not None:
        user.claimed_reward_ids = payload.claimed_reward_ids
    if payload.unlocked_achievement_ids is not None:
        user.unlocked_achievement_ids = payload.unlocked_achievement_ids
    if payload.password is not None:
        password_recovery.replace_password(db, user, payload.password, actor=actor, reason="admin_profile")
    if "profile_bio" in payload.model_fields_set:
        user.profile_bio = payload.profile_bio
    if "avatar_asset_id" in payload.model_fields_set:
        _ensure_avatar_permission(actor, user)
        asset = resolve_avatar_asset(db, payload.avatar_asset_id, actor)
        select_user_avatar(db, user, asset)
    if "avatar_frame" in payload.model_fields_set:
        _ensure_avatar_permission(actor, user)
        user.avatar_frame = payload.avatar_frame



@router.get("", response_model=list[schemas.UserRead])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.UserRead]:
    stmt = (
        select(models.User)
        .options(selectinload(models.User.avatar_asset))
        .where(models.User.tenant_id == current_user.tenant_id)
    )
    users = db.execute(stmt).scalars().all()
    return [schemas.UserRead.for_viewer(user, current_user) for user in users]


@router.get("/{user_id}", response_model=schemas.UserRead)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.UserRead:
    stmt = (
        select(models.User)
        .options(selectinload(models.User.avatar_asset))
        .where(models.User.id == user_id)
        .where(models.User.tenant_id == current_user.tenant_id)
    )
    user = db.execute(stmt).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return schemas.UserRead.for_viewer(user, current_user)


@router.post("", response_model=schemas.UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: schemas.UserCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.UserRead:
    _ensure_user_admin_scope(current_user, new_role=payload.role)
    if db.execute(select(models.User).where(models.User.email == payload.email)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
    if not current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing tenant identifier")
    if payload.department_id:
        department = db.get(models.Department, payload.department_id)
        if not department:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")

    avatar_asset_id = None
    if payload.avatar_asset_id:
        asset = resolve_avatar_asset(db, payload.avatar_asset_id, current_user)
        avatar_asset_id = asset.id

    user = models.User(
        tenant_id=current_user.tenant_id,
        name=payload.name,
        email=payload.email,
        employer_id=payload.employer_id,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        status=payload.status,
        department_id=payload.department_id,
        manager_id=payload.manager_id,
        manager_email=payload.manager_email,
        shift_name=payload.shift_name,
        shift_start=payload.shift_start,
        shift_end=payload.shift_end,
        morning_break_start=payload.morning_break_start,
        morning_break_end=payload.morning_break_end,
        lunch_break_start=payload.lunch_break_start,
        lunch_break_end=payload.lunch_break_end,
        evening_break_start=payload.evening_break_start,
        evening_break_end=payload.evening_break_end,
        title=payload.title,
        phone=payload.phone,
        location=payload.location,
        timezone=payload.timezone,
        notes=payload.notes,
        profile_bio=payload.profile_bio,
        skills=payload.skills or [],
        projects=payload.projects or [],
        avatar_asset_id=avatar_asset_id,
        avatar_frame=payload.avatar_frame,
    )
    _validate_profile_update(db, user, payload)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create user. Check required fields and references.",
        ) from exc
    db.refresh(user)
    serialized_user = schemas.UserRead.model_validate(user).model_dump()
    background_tasks.add_task(trigger_n8n_event, "user.created", serialized_user)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_CREATED",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            target_user_id=str(user.id),
            entity_type="user",
            entity_id=str(user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"email": user.email, "role": user.role.value},
            request=request,
        )
    )
    for admin_id in _get_admin_ids(db, current_user.tenant_id):
        if admin_id == current_user.id:
            continue
        notification_service.create_notification(
            db,
            user_id=admin_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.USER_CREATED,
            message=f"New user '{user.name}' created.",
            title="User created",
            body=f"User '{user.name}' was created.",
            entity_type=models.NotificationEntityTypeEnum.USER,
            entity_id=str(user.id),
            deep_link=f"/users/{user.id}",
        )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="user.created",
            entity_type="user",
            entity_id=user.id,
            payload={"name": user.name, "email": user.email, "role": user.role.value},
            created_at=datetime.utcnow(),
        )
    )
    db.commit()

    # Send welcome email if SMTP is configured
    try:
        subject = "Welcome to the Task Management System"
        body = f"""
Hello {user.name},

Welcome to our Task Management System! Your account has been created successfully.

You can now log in with your email: {user.email}

Best regards,
The Task Management Team
"""
        from ..services.notification_outbox import enqueue_email
        enqueue_email(
            db, tenant_id=user.tenant_id, recipient_user_id=user.id,
            event_type='welcome', event_id=user.id, dedupe_key=f'welcome:{user.id}',
            subject=subject,
            body=body,
        )
        db.commit()
    except Exception:
        db.rollback()
        # Don't fail user creation if email sending fails
        pass

    return schemas.UserRead.for_viewer(user, current_user)


@router.patch("/{user_id}", response_model=schemas.UserRead)
def update_user(
    user_id: str,
    payload: schemas.UserUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.UserRead:
    user = db.scalar(select(models.User).where(models.User.id == user_id, models.User.tenant_id == current_user.tenant_id).with_for_update().execution_options(populate_existing=True))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _ensure_user_admin_scope(current_user, target=user, new_role=payload.role)

    before: dict[str, object] = {}
    after: dict[str, object] = {}
    if payload.role is not None and payload.role != user.role:
        before["role"] = user.role.value
        after["role"] = payload.role.value
    if payload.status is not None and payload.status != user.status:
        before["status"] = user.status.value
        after["status"] = payload.status.value
    if payload.department_id is not None and payload.department_id != user.department_id:
        before["department_id"] = str(user.department_id) if user.department_id else None
        after["department_id"] = str(payload.department_id) if payload.department_id else None

    _validate_profile_update(db, user, payload)
    _apply_user_updates(db, user, payload, actor=current_user)
    db.commit()
    db.refresh(user)
    serialized_user = schemas.UserRead.model_validate(user).model_dump()
    background_tasks.add_task(trigger_n8n_event, "user.updated", serialized_user)
    update_fields = sorted(payload.model_dump(exclude_unset=True).keys())
    if update_fields:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="USER_UPDATED",
                category=models.AuditLogCategoryEnum.USER,
                actor_id=str(current_user.id),
                actor_role=current_user.role.value if current_user.role else None,
                target_user_id=str(user.id),
                entity_type="user",
                entity_id=str(user.id),
                source=models.AuditLogSourceEnum.MANUAL,
                before=before or None,
                after=after or None,
                metadata={"fields": update_fields},
                request=request,
            )
        )
        recipient_ids = set(_get_admin_ids(db, current_user.tenant_id))
        if user.status == models.UserStatusEnum.ACTIVE:
            recipient_ids.add(user.id)
        for admin_id in recipient_ids:
            if admin_id == current_user.id:
                continue
            notification_service.create_notification(
                db,
                user_id=admin_id,
                actor_id=str(current_user.id),
                notification_type=models.NotificationTypeEnum.USER_UPDATED,
                message=f"User '{user.name}' was updated.",
                title="User updated",
                body=f"User '{user.name}' was updated.",
                entity_type=models.NotificationEntityTypeEnum.USER,
                entity_id=str(user.id),
                deep_link="/settings" if admin_id == user.id else f"/users/{user.id}",
            )
        db.add(
            models.AuditEvent(
                actor_id=current_user.id,
                event_type="user.updated",
                entity_type="user",
                entity_id=user.id,
                payload={"fields": update_fields},
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    return schemas.UserRead.for_viewer(user, current_user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> None:
    stmt = (
        select(models.User)
        .options(selectinload(models.User.avatar_asset))
        .where(models.User.id == user_id, models.User.tenant_id == current_user.tenant_id)
    )
    user = db.execute(stmt).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _ensure_user_admin_scope(current_user, target=user)
    serialized_user = schemas.UserRead.model_validate(user).model_dump()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="USER_DELETED",
            category=models.AuditLogCategoryEnum.USER,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            target_user_id=str(user.id),
            entity_type="user",
            entity_id=str(user.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": user.name, "email": user.email, "role": user.role.value},
            request=request,
        )
    )
    db.add(
        models.AuditEvent(
            actor_id=current_user.id,
            event_type="user.deleted",
            entity_type="user",
            entity_id=user.id,
            payload={"name": user.name, "email": user.email, "role": user.role.value},
            created_at=datetime.utcnow(),
        )
    )
    for admin_id in _get_admin_ids(db, current_user.tenant_id):
        if admin_id == current_user.id:
            continue
        notification_service.create_notification(
            db,
            user_id=admin_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.USER_DELETED,
            message=f"User '{user.name}' was deleted.",
            title="User deleted",
            body=f"User '{user.name}' was deleted.",
            entity_type=models.NotificationEntityTypeEnum.USER,
            entity_id=str(user.id),
            deep_link="/users",
        )
    db.delete(user)
    db.commit()
    background_tasks.add_task(trigger_n8n_event, "user.deleted", serialized_user)


@router.patch("/me", response_model=schemas.UserRead)
def update_current_user(
    payload: schemas.UserProfileUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> schemas.UserRead:
    user = db.scalar(select(models.User).where(models.User.id == current_user.id).with_for_update().execution_options(populate_existing=True))
    employment = {'employer_id', 'department_id', 'manager_email', 'shift_name', 'shift_start', 'shift_end',
        'morning_break_start', 'morning_break_end', 'lunch_break_start', 'lunch_break_end', 'evening_break_start', 'evening_break_end'}
    if payload.model_fields_set & employment and current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(403, 'Employment details require an administrator')
    _validate_profile_update(db, user, payload)
    for field in payload.model_fields_set - {'avatar_asset_id', 'expected_updated_at'}:
        if field == 'name' and payload.name is None:
            raise HTTPException(422, 'Name cannot be empty')
        setattr(user, field, getattr(payload, field))
    if 'avatar_asset_id' in payload.model_fields_set:
        select_user_avatar(db, user, resolve_avatar_asset(db, payload.avatar_asset_id, current_user))

    db.commit()
    db.refresh(user)
    serialized_user = schemas.UserRead.model_validate(user).model_dump()
    background_tasks.add_task(trigger_n8n_event, "user.updated", serialized_user)
    update_fields = sorted(payload.model_dump(exclude_unset=True).keys())
    if update_fields:
        audit_logger.log_event(
            audit_logger.AuditLogInput(
                action="USER_PROFILE_UPDATED",
                category=models.AuditLogCategoryEnum.USER,
                actor_id=str(current_user.id),
                actor_role=current_user.role.value if current_user.role else None,
                target_user_id=str(current_user.id),
                entity_type="user",
                entity_id=str(current_user.id),
                source=models.AuditLogSourceEnum.MANUAL,
                metadata={"fields": update_fields},
                request=request,
            )
        )
        db.add(
            models.AuditEvent(
                actor_id=current_user.id,
                event_type="user.updated",
                entity_type="user",
                entity_id=user.id,
                payload={"fields": update_fields},
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    return schemas.UserRead.for_viewer(user, current_user)


@router.post("/{user_id}/avatar", response_model=schemas.UserRead)
def upload_avatar_for_user(
    user_id: str,
    payload: schemas.AvatarUploadPayload,
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> schemas.UserRead:
    stmt = select(models.User).options(selectinload(models.User.avatar_asset)).where(models.User.id == user_id, models.User.tenant_id == current_user.tenant_id).with_for_update().execution_options(populate_existing=True)
    user = db.execute(stmt).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _ensure_avatar_permission(current_user, user)
    _validate_profile_update(db, user, payload)
    set_user_avatar_from_data_url(db, user, data_url=payload.data_url, actor=current_user, crop=payload.crop)

    db.commit()
    db.refresh(user)
    return schemas.UserRead.for_viewer(user, current_user)


@router.post("/me/avatar", response_model=schemas.UserRead)
def upload_current_user_avatar(
    payload: schemas.AvatarUploadPayload,
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> schemas.UserRead:
    stmt = select(models.User).options(selectinload(models.User.avatar_asset)).where(models.User.id == current_user.id).with_for_update().execution_options(populate_existing=True)
    user = db.execute(stmt).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _validate_profile_update(db, user, payload)
    set_user_avatar_from_data_url(db, user, data_url=payload.data_url, actor=current_user, crop=payload.crop)
    db.commit()
    db.refresh(user)
    return schemas.UserRead.for_viewer(user, current_user)


@router.post("/me/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_current_user_password(
    payload: schemas.UserPasswordChange,
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> None:
    user = db.get(models.User, current_user.id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not verify_password(payload.old_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect password")

    password_recovery.replace_password(db, user, payload.new_password, actor=current_user, reason="self_service")
    db.commit()


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(
    user_id: str,
    payload: schemas.UserResetPassword,
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> None:
    user = db.scalar(select(models.User).where(models.User.id == user_id, models.User.tenant_id == current_user.tenant_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _ensure_user_admin_scope(current_user, target=user)
    password_recovery.replace_password(db, user, payload.new_password, actor=current_user, reason="admin_reset")
    db.commit()


@router.get("/by-employer-id/{employer_id}", response_model=schemas.UserRead)
def get_user_by_employer_id(
    employer_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.UserRead:
    user = db.execute(select(models.User).where(models.User.employer_id == employer_id, models.User.tenant_id == current_user.tenant_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return schemas.UserRead.for_viewer(user, current_user)


@router.get('/{user_id}/avatar/image')
def legacy_avatar_image(user_id: str, size: int = 512,
    current_user: models.User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    from contextlib import closing

    from fastapi import Response

    from ..avatar_utils import normalize_avatar
    from ..config import get_settings
    from ..storage.minio import get_minio_client
    user = db.scalar(select(models.User).where(models.User.id == user_id, models.User.tenant_id == current_user.tenant_id))
    if not user or not user.profile_image_key or user.avatar_asset_id:
        raise HTTPException(404, 'Avatar image unavailable')
    if not user.profile_image_key.startswith(f'avatars/{user.id}/'):
        raise HTTPException(404, 'Avatar image unavailable')
    if size not in (128, 512):
        raise HTTPException(400, 'Avatar size must be 128 or 512')
    settings = get_settings()
    try:
        response = get_minio_client().get_object(Bucket=settings.minio_bucket_attachments, Key=user.profile_image_key)
        with closing(response['Body']) as body:
            data = body.read(settings.avatar_max_file_size_mb * 1024 * 1024 + 1)
        image = normalize_avatar(data, 'image/webp')[0 if size == 512 else 1]
    except Exception as exc:
        raise HTTPException(404, 'Avatar image unavailable') from exc
    return Response(image, media_type='image/webp', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


# Self-service recovery routes must win over /{user_id} and /{user_id}/avatar.
# Otherwise /me is interpreted as an administrative user ID before its handler.
router.routes.sort(key=lambda route: '{' in route.path)
