from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services.badge_storage import BadgeImageService
from ..services.reward_storage import StorageService
from ..services import audit_logger

router = APIRouter(prefix="/badges", tags=["badges"])


def _assert_admin_or_owner(user: models.User) -> None:
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")


def _serialize_badge(badge: models.Badge, include_rules: bool) -> schemas.BadgeRead:
    payload = schemas.BadgeRead.model_validate(badge)
    rules = None
    if include_rules and badge.ruleset and isinstance(badge.ruleset.rules, dict):
        rules = schemas.BadgeRuleSet.model_validate(badge.ruleset.rules)
    return payload.model_copy(update={"rules": rules})


@router.get("", response_model=list[schemas.BadgeRead])
def list_badges(
    state: Optional[models.BadgeStateEnum] = None,
    include_rules: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    is_admin = current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER}

    stmt = select(models.Badge).options(selectinload(models.Badge.ruleset))
    if is_admin:
        if state is not None:
            stmt = stmt.where(models.Badge.state == state)
    else:
        stmt = stmt.where(models.Badge.state == models.BadgeStateEnum.ACTIVE)

    badges = db.execute(stmt.order_by(models.Badge.created_at.desc())).scalars().all()
    return [_serialize_badge(badge, include_rules and is_admin) for badge in badges]


@router.post("", response_model=schemas.BadgeRead, status_code=status.HTTP_201_CREATED)
def create_badge(
    payload: schemas.BadgeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    badge = models.Badge(
        name=payload.name,
        description=payload.description,
        tier=payload.tier,
        tier_group=payload.tier_group,
        tier_order=payload.tier_order,
        bonus_xp=payload.bonus_xp,
        image_url=payload.image_url,
        image_asset_path=payload.image_asset_path,
        state=payload.state,
        is_system=payload.is_system,
    )
    db.add(badge)
    db.flush()

    ruleset = models.BadgeRule(badge_id=badge.id, rules=payload.rules.model_dump())
    db.add(ruleset)
    db.commit()
    db.refresh(badge)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="BADGE_CREATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="badge",
            entity_id=str(badge.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": badge.name, "tier": badge.tier},
        )
    )
    return _serialize_badge(badge, include_rules=True)


@router.put("/{badge_id}", response_model=schemas.BadgeRead)
def update_badge(
    badge_id: str,
    payload: schemas.BadgeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    badge = db.execute(
        select(models.Badge).options(selectinload(models.Badge.ruleset)).where(models.Badge.id == badge_id)
    ).scalar_one_or_none()
    if not badge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badge not found")

    update = payload.model_dump(exclude_unset=True)
    if "name" in update:
        badge.name = update["name"]
    if "description" in update:
        badge.description = update["description"]
    if "tier" in update:
        badge.tier = update["tier"]
    if "tier_group" in update:
        badge.tier_group = update["tier_group"]
    if "tier_order" in update:
        badge.tier_order = update["tier_order"]
    if "bonus_xp" in update:
        badge.bonus_xp = update["bonus_xp"]
    if "image_url" in update:
        badge.image_url = update["image_url"]
    if "image_asset_path" in update:
        badge.image_asset_path = update["image_asset_path"]
    if "state" in update:
        badge.state = update["state"]
    if "is_system" in update:
        badge.is_system = update["is_system"]

    if payload.rules is not None:
        if badge.ruleset:
            badge.ruleset.rules = payload.rules.model_dump()
        else:
            db.add(models.BadgeRule(badge_id=badge.id, rules=payload.rules.model_dump()))

    db.commit()
    db.refresh(badge)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="BADGE_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="badge",
            entity_id=str(badge.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"fields": list(update.keys())},
        )
    )
    return _serialize_badge(badge, include_rules=True)


@router.delete("/{badge_id}")
def delete_badge(
    badge_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    badge = db.get(models.Badge, badge_id)
    if not badge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badge not found")

    if badge.image_asset_path:
        StorageService.delete(badge.image_asset_path)

    db.delete(badge)
    db.commit()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="BADGE_DELETED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="badge",
            entity_id=str(badge_id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": badge.name},
        )
    )
    return {"ok": True}


@router.post("/{badge_id}/image", response_model=schemas.BadgeRead)
async def upload_badge_image(
    badge_id: str,
    file: UploadFile | None = File(default=None),
    image_url: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    badge = db.execute(
        select(models.Badge).options(selectinload(models.Badge.ruleset)).where(models.Badge.id == badge_id)
    ).scalar_one_or_none()
    if not badge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badge not found")

    if file and image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide a file or image_url, not both")
    if not file and not image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide an image file or image_url")

    if file:
        image_asset_path, public_url, _mime, _size = await BadgeImageService.save_upload(file)
        if badge.image_asset_path:
            StorageService.delete(badge.image_asset_path)
        badge.image_asset_path = image_asset_path
        badge.image_url = public_url
    else:
        clean_url = image_url.strip() if image_url else None
        if not clean_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image_url")
        if badge.image_asset_path:
            StorageService.delete(badge.image_asset_path)
        badge.image_asset_path = None
        badge.image_url = clean_url

    db.commit()
    db.refresh(badge)
    return _serialize_badge(badge, include_rules=True)
