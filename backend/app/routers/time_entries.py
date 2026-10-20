from datetime import datetime
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import text, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import time_tracking
from ..work_schemas import WorkMutation, WorkSnapshot


router = APIRouter(prefix="/time-entries", tags=["time-entries"])


def work_read_db(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    # Run before authentication reads users, using its same request-scoped session.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
    else:
        db.execute(text("BEGIN"))
    return db


@router.get("/work/active", response_model=WorkSnapshot)
def active_work(db: Session = Depends(work_read_db), current_user: models.User = Depends(get_current_active_user)):
    from ..services.work_history import read
    return read(db, current_user, active=True, limit=500)


@router.get("/work/history", response_model=WorkSnapshot)
def work_history(db: Session = Depends(work_read_db), current_user: models.User = Depends(get_current_active_user),
                 from_at: datetime | None = None, to_at: datetime | None = None,
                 search: str = Query(default="", max_length=200), offset: int = Query(default=0, ge=0),
                 limit: int = Query(default=30, ge=1, le=100)):
    from ..services.work_history import read
    return read(db, current_user, lower=from_at, upper=to_at, search=search, offset=offset, limit=limit)


@router.get("/work/{session_id}/history", response_model=WorkSnapshot)
def work_session_history(session_id: str, db: Session = Depends(work_read_db),
                         current_user: models.User = Depends(get_current_active_user)):
    from ..services.work_history import read
    return read(db, current_user, session_id=session_id)


def work_mutation(db, user, entry):
    if entry is None:
        return None
    from ..services.work_history import chains, read
    chain = chains(user)
    root_id = db.scalar(select(chain.c.root_id).where(chain.c.entry_id == entry.id))
    snapshot = read(db, user, session_id=root_id) if root_id else read(db, user, active=True)
    return {**schemas.TimeEntryRead.model_validate(entry).model_dump(),
            "session": snapshot["items"][0] if root_id and snapshot["items"] else None,
            "server_time": snapshot["server_time"], "limit": snapshot["limit"], "running_count": snapshot["running_count"]}


@router.get("/active", response_model=schemas.TimeEntryActiveResponse)
def get_active_time_entry(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryActiveResponse:
    return schemas.TimeEntryActiveResponse(active=time_tracking.get_active_timer(db, current_user))


@router.post("/start", response_model=WorkMutation, status_code=status.HTTP_201_CREATED)
def start_time_entry(
    payload: schemas.TimeEntryStart,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return work_mutation(db, current_user, time_tracking.start_timer(db, current_user, payload))


@router.post("/stop", response_model=WorkMutation | None)
def stop_active_time_entry(
    payload: schemas.TimeEntryStop | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry | None:
    return work_mutation(db, current_user, time_tracking.stop_timer(db, current_user, entry_id=payload.entry_id if payload else None))


@router.post("/{entry_id}/stop", response_model=WorkMutation)
def stop_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return work_mutation(db, current_user, time_tracking.stop_timer(db, current_user, entry_id=entry_id))


@router.post("/{entry_id}/resume", response_model=WorkMutation, status_code=status.HTTP_201_CREATED)
def resume_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return work_mutation(db, current_user, time_tracking.resume_timer(db, current_user, entry_id))


@router.patch("/{entry_id}/correction", response_model=schemas.TimeEntryRead)
def correct_time_entry(
    entry_id: str,
    payload: schemas.TimeEntryCorrection,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> models.TimeEntry:
    return time_tracking.correct_time_entry(db, current_user, entry_id, payload)


@router.post("/{entry_id}/pause", response_model=WorkMutation)
def pause_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryRead:
    return work_mutation(db, current_user, time_tracking.stop_timer(db, current_user, entry_id=entry_id, reason="paused"))


@router.post("/{entry_id}/restart", response_model=WorkMutation, status_code=status.HTTP_201_CREATED)
def restart_time_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.TimeEntryRead:
    return work_mutation(db, current_user, time_tracking.resume_timer(db, current_user, entry_id, restart=True))
