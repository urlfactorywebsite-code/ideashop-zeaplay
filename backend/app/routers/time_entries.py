from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import time_tracking


router = APIRouter(prefix="/time-entries", tags=["time-entries"])


@router.get("/active", response_model=schemas.TimeEntryActiveResponse)
def get_active_time_entry(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryActiveResponse:
    return schemas.TimeEntryActiveResponse(active=time_tracking.get_active_timer(db, current_user))


@router.post("/start", response_model=schemas.TimeEntryRead, status_code=status.HTTP_201_CREATED)
def start_time_entry(
    payload: schemas.TimeEntryStart,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return time_tracking.start_timer(db, current_user, payload)


@router.post("/stop", response_model=schemas.TimeEntryRead | None)
def stop_active_time_entry(
    payload: schemas.TimeEntryStop | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry | None:
    return time_tracking.stop_timer(db, current_user, entry_id=payload.entry_id if payload else None)


@router.post("/{entry_id}/stop", response_model=schemas.TimeEntryRead)
def stop_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return time_tracking.stop_timer(db, current_user, entry_id=entry_id)


@router.post("/{entry_id}/resume", response_model=schemas.TimeEntryRead, status_code=status.HTTP_201_CREATED)
def resume_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return time_tracking.resume_timer(db, current_user, entry_id)


@router.patch("/{entry_id}/correction", response_model=schemas.TimeEntryRead)
def correct_time_entry(
    entry_id: str,
    payload: schemas.TimeEntryCorrection,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return time_tracking.correct_time_entry(db, current_user, entry_id, payload)


@router.post("/{entry_id}/pause", response_model=schemas.TimeEntryRead)
def pause_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryRead:
    return time_tracking.stop_timer(db, current_user, entry_id=entry_id, reason="paused")


@router.post("/{entry_id}/restart", response_model=schemas.TimeEntryRead, status_code=status.HTTP_201_CREATED)
def restart_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryRead:
    return time_tracking.resume_timer(db, current_user, entry_id, restart=True)
