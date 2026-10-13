from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from .. import models, schemas

router = APIRouter(prefix="/seasons", tags=["seasons"])


@router.get("", response_model=list[schemas.SeasonRead])
def list_seasons(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return db.execute(select(models.Season)).scalars().all()


@router.get("/{season_id}", response_model=schemas.SeasonRead)
def get_season(
    season_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    season = db.get(models.Season, season_id)
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    return season


@router.post("", response_model=schemas.SeasonRead, status_code=status.HTTP_201_CREATED)
def create_season(
    payload: schemas.SeasonCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    season = models.Season(
        name=payload.name,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
        theme=payload.theme,
        bonus_multiplier=payload.bonus_multiplier,
    )
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


@router.patch("/{season_id}", response_model=schemas.SeasonRead)
def update_season(
    season_id: str,
    payload: schemas.SeasonUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    season = db.get(models.Season, season_id)
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    if payload.name is not None:
        season.name = payload.name
    if payload.description is not None:
        season.description = payload.description
    if payload.start_date is not None:
        season.start_date = payload.start_date
    if payload.end_date is not None:
        season.end_date = payload.end_date
    if payload.theme is not None:
        season.theme = payload.theme
    if payload.bonus_multiplier is not None:
        season.bonus_multiplier = payload.bonus_multiplier
    if payload.is_active is not None:
        season.is_active = payload.is_active

    db.commit()
    db.refresh(season)
    return season


@router.delete("/{season_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_season(
    season_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    season = db.get(models.Season, season_id)
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    db.delete(season)
    db.commit()
