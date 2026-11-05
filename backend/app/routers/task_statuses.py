"""Status settings are scoped to the authenticated tenant, never a client tenant ID."""
import unicodedata
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import task_statuses as service

router = APIRouter(prefix="/task-statuses", tags=["task-statuses"])


class StatusDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str | None = Field(default=None, min_length=1, max_length=36, pattern=r"^[^\x00-\x1f\x7f]+$")
    system_name: str = Field(min_length=1, max_length=80)
    display_label: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: Literal["default", "circle", "flag", "play", "pause", "check", "star", "bolt", "clock"] = "circle"
    is_active: bool = Field(default=True, strict=True)
    kanban_visible: bool = Field(default=True, strict=True)
    workflow_behavior: Literal['PENDING','ACTIVE','HOLD','COMPLETED'] | None = None

    @field_validator("system_name", "display_label")
    @classmethod
    def names(cls, value):
        value = " ".join(unicodedata.normalize("NFKC", value).split())
        if not value or len(value) > 80 or any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Names and labels must contain 1-80 visible characters")
        return value

    @field_validator("description")
    @classmethod
    def descriptions(cls, value):
        if any(unicodedata.category(char) == "Cc" and char not in "\n\r\t" for char in value):
            raise ValueError("Descriptions cannot contain control characters")
        return value


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, le=2147483646, strict=True)
    statuses: list[StatusDraft] = Field(min_length=11, max_length=100)
    hold_reason_required: bool | None = Field(default=None, strict=True)


class StatusRemoval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, le=2147483646, strict=True)
    action: Literal["archive", "delete"]
    destination_id: str | None = Field(default=None, min_length=1, max_length=36, pattern=r"^[^\x00-\x1f\x7f]+$")
    confirmation: str = Field(min_length=1, max_length=80)
    expected_task_count: int = Field(ge=0, strict=True)


@router.get("")
def read(response: Response, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    service.require_manager(user)
    result = service.document(db, user)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


def commit(db, user, operation):
    try:
        result = operation()
        db.commit()
    except ValidationError as exc:
        db.rollback()
        raise HTTPException(422, "Review status names, labels, color and icon values") from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "A status is duplicated or still referenced. Reload and review the latest configuration.") from exc
    except Exception:
        db.rollback()
        raise
    try:
        service.invalidate(user.tenant_id)
    except Exception:
        pass  # A cache outage cannot undo the committed transaction.
    return result


@router.put("")
def save(payload: StatusUpdate, response: Response, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    response.headers["Cache-Control"] = "no-store"
    return commit(db, user, lambda: service.save(db, user, payload))


@router.post("/{status_id}/remove")
def remove(status_id: Annotated[str, Path(min_length=1, max_length=36, pattern=r"^[^\x00-\x1f\x7f]+$")], payload: StatusRemoval, response: Response,
           db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    response.headers["Cache-Control"] = "no-store"
    return commit(db, user, lambda: service.remove(db, user, status_id, payload))


@router.get("/audit")
def audit(response: Response, db: Session = Depends(get_db), user=Depends(get_current_active_user), limit: int = 50):
    service.require_manager(user)
    response.headers["Cache-Control"] = "no-store"
    if not 1 <= limit <= 200:
        raise HTTPException(422, "limit must be 1-200")
    return [{"id": row.id, "status_id": row.status_id, "actor_id": row.actor_id, "action": row.action,
        "previous_values": row.previous_values, "new_values": row.new_values, "created_at": row.created_at}
        for row in db.scalars(select(models.StatusConfigurationAudit)
        .where(models.StatusConfigurationAudit.tenant_id == user.tenant_id)
        .order_by(models.StatusConfigurationAudit.created_at.desc(), models.StatusConfigurationAudit.id).limit(limit))]
