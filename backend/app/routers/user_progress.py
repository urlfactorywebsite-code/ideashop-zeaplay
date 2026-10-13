from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from .. import models, schemas

router = APIRouter(prefix="/user-progress", tags=["user-progress"])


@router.get("", response_model=list[schemas.UserProgressRead])
def list_user_progress(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Users can only see their own progress, admins can see all
    if current_user.role == models.RoleEnum.ADMIN or current_user.role == models.RoleEnum.OWNER:
        return db.execute(select(models.UserProgress)).scalars().all()
    else:
        return db.execute(
            select(models.UserProgress).where(models.UserProgress.user_id == current_user.id)
        ).scalars().all()


@router.get("/{progress_id}", response_model=schemas.UserProgressRead)
def get_user_progress(
    progress_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    progress = db.get(models.UserProgress, progress_id)
    if not progress:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User progress not found")

    # Users can only access their own progress
    if current_user.role not in [models.RoleEnum.ADMIN, models.RoleEnum.OWNER] and progress.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return progress


@router.post("", response_model=schemas.UserProgressRead, status_code=status.HTTP_201_CREATED)
def create_user_progress(
    payload: schemas.UserProgressCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    progress = models.UserProgress(
        user_id=payload.user_id,
        level_id=payload.level_id,
        season_id=payload.season_id,
        current_points=payload.current_points,
        total_points_earned=payload.total_points_earned,
    )
    db.add(progress)
    db.commit()
    db.refresh(progress)
    return progress


@router.patch("/{progress_id}", response_model=schemas.UserProgressRead)
def update_user_progress(
    progress_id: str,
    payload: schemas.UserProgressUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    progress = db.get(models.UserProgress, progress_id)
    if not progress:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User progress not found")

    if payload.current_points is not None:
        progress.current_points = payload.current_points
    if payload.total_points_earned is not None:
        progress.total_points_earned = payload.total_points_earned

    db.commit()
    db.refresh(progress)
    return progress


@router.delete("/{progress_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_progress(
    progress_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    progress = db.get(models.UserProgress, progress_id)
    if not progress:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User progress not found")
    db.delete(progress)
    db.commit()
