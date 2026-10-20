from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
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
    "chat",
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
    insert = postgres_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    # Stable ordering prevents opposite-order batch updates from deadlocking.
    # One atomic UPSERT per module avoids duplicate creation across devices.
    for preference in sorted(payload.preferences, key=lambda item: item.module):
        statement = insert(models.NotificationPreference).values(
            id=models.generate_uuid(), user_id=str(current_user.id), module=preference.module,
            push_enabled=preference.push_enabled, updated_at=now,
        ).on_conflict_do_update(
            index_elements=["user_id", "module"],
            set_={"push_enabled": preference.push_enabled, "updated_at": now},
        )
        db.execute(statement)
    db.commit()
    return list_preferences(db=db, current_user=current_user)
