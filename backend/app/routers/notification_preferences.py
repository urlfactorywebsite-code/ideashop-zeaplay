from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user

router = APIRouter(prefix="/notification/preferences", tags=["notifications"])

MODULES: list[schemas.NotificationModule] = [
    "tasks",
    "tickets",
    "users",
    "departments",
    "comments",
]


@router.get("", response_model=list[schemas.NotificationPreferenceRead])
def list_preferences(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.NotificationPreferenceRead]:
    prefs = db.execute(
        select(models.NotificationPreference).where(models.NotificationPreference.user_id == current_user.id)
    ).scalars().all()
    pref_map = {pref.module: pref for pref in prefs}
    response: list[schemas.NotificationPreferenceRead] = []
    for module in MODULES:
        pref = pref_map.get(module)
        response.append(
            schemas.NotificationPreferenceRead(
                module=module,
                push_enabled=pref.push_enabled if pref else True,
                updated_at=pref.updated_at if pref else None,
            )
        )
    return response


@router.post("", response_model=list[schemas.NotificationPreferenceRead])
def update_preferences(
    payload: schemas.NotificationPreferenceBatchUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.NotificationPreferenceRead]:
    now = datetime.now(timezone.utc)
    prefs = db.execute(
        select(models.NotificationPreference).where(models.NotificationPreference.user_id == current_user.id)
    ).scalars().all()
    pref_map = {pref.module: pref for pref in prefs}

    for update in payload.preferences:
        existing = pref_map.get(update.module)
        if existing:
            existing.push_enabled = update.push_enabled
            existing.updated_at = now
        else:
            db.add(
                models.NotificationPreference(
                    user_id=str(current_user.id),
                    module=update.module,
                    push_enabled=update.push_enabled,
                    updated_at=now,
                )
            )
    db.commit()
    return list_preferences(db=db, current_user=current_user)
