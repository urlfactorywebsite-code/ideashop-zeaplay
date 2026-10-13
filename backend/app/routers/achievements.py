from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, inspect
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin

router = APIRouter(prefix="/achievements", tags=["achievements"])


@router.get("/me", response_model=list[schemas.BadgeAchievementRead])
def list_my_badges(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    inspector = inspect(db.bind)
    if "badges" not in inspector.get_table_names():
        return []
    badges = (
        db.execute(select(models.Badge).where(models.Badge.state == models.BadgeStateEnum.ACTIVE))
        .scalars()
        .all()
    )
    if not badges:
        return []

    progress_rows = (
        db.execute(
            select(models.UserBadgeProgress).where(
                models.UserBadgeProgress.user_id == current_user.id,
                models.UserBadgeProgress.badge_id.in_([badge.id for badge in badges]),
            )
        )
        .scalars()
        .all()
    )
    progress_by_badge = {item.badge_id: item for item in progress_rows}
    legacy_unlocked = set(current_user.unlocked_achievement_ids or [])

    def _sort_key(badge: models.Badge):
        return (
            badge.tier_group or "",
            badge.tier_order,
            badge.name.lower(),
        )

    results: list[schemas.BadgeAchievementRead] = []
    for badge in sorted(badges, key=_sort_key):
        progress = progress_by_badge.get(badge.id)
        if progress:
            status = progress.status
            progress_percent = min(max(progress.progress_value, 0), 100)
            earned_at = progress.earned_at
        elif badge.id in legacy_unlocked:
            status = models.BadgeProgressStatusEnum.EARNED
            progress_percent = 100
            earned_at = None
        else:
            status = models.BadgeProgressStatusEnum.LOCKED
            progress_percent = 0
            earned_at = None

        if status == models.BadgeProgressStatusEnum.EARNED and progress_percent < 100:
            progress_percent = 100

        results.append(
            schemas.BadgeAchievementRead(
                id=badge.id,
                name=badge.name,
                description=badge.description,
                tier=badge.tier,
                tier_group=badge.tier_group,
                tier_order=badge.tier_order,
                bonus_xp=badge.bonus_xp,
                image_url=badge.image_url,
                state=badge.state,
                is_system=badge.is_system,
                status=status,
                progress_percent=progress_percent,
                earned_at=earned_at,
            )
        )
    return results


@router.get("", response_model=list[schemas.AchievementRead])
def list_achievements(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return db.execute(select(models.Achievement)).scalars().all()


@router.post("", response_model=schemas.AchievementRead, status_code=status.HTTP_201_CREATED)
def create_achievement(
    payload: schemas.AchievementCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    if db.get(models.Achievement, payload.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Achievement ID already exists")

    achievement = models.Achievement(
        id=payload.id,
        title=payload.title,
        description=payload.description,
        points=payload.points,
        icon=payload.icon,
    )
    db.add(achievement)
    db.commit()
    db.refresh(achievement)
    return achievement


@router.patch("/{achievement_id}", response_model=schemas.AchievementRead)
def update_achievement(
    achievement_id: str,
    payload: schemas.AchievementUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    achievement = db.get(models.Achievement, achievement_id)
    if not achievement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found")

    if payload.title is not None:
        achievement.title = payload.title
    if payload.description is not None:
        achievement.description = payload.description
    if payload.points is not None:
        achievement.points = payload.points
    if payload.icon is not None:
        achievement.icon = payload.icon

    db.commit()
    db.refresh(achievement)
    return achievement


@router.delete("/{achievement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_achievement(
    achievement_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    achievement = db.get(models.Achievement, achievement_id)
    if not achievement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found")

    db.delete(achievement)
    db.commit()
