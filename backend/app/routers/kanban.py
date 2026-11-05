"""Compatibility facade: existing URLs now use tenant-owned status configuration."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import task_statuses as service
from .task_statuses import StatusDraft, StatusRemoval, StatusUpdate, commit

router = APIRouter(prefix="/kanban-columns", tags=["kanban"])


def column(row, hold_reason_required=False):
    return {"id": row.legacy_status or row.legacy_column_id or row.id,
            "custom_status_id": None if row.is_system else row.id, "title": row.display_label, "order": row.sort_order,
            "workflow_behavior":row.workflow_behavior, "hold_reason_required":hold_reason_required and row.workflow_behavior=='HOLD'}


def drafts(db, user):
    return [StatusDraft(**{name: getattr(row, name) for name in StatusDraft.model_fields}) for row in service.rows(db, user)]


def resolve(db, user, column_id):
    if not 1 <= len(column_id) <= 36 or any(ord(char) < 32 or ord(char) == 127 for char in column_id):
        raise HTTPException(422, "Invalid column identifier")
    service.scope(db, user, lock=True)
    row = next((row for row in service.rows(db, user) if column_id in (row.id, row.legacy_status, row.legacy_column_id)), None)
    if row is None:
        raise HTTPException(404, "Column not found")
    return row


@router.get("", response_model=list[schemas.KanbanColumnRead])
def list_columns(db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    scope = service.scope(db, user)
    result = [column(row, scope.hold_reason_required) for row in service.rows(db, user) if row.is_active]
    db.commit()
    return result


@router.post("", response_model=schemas.KanbanColumnRead, status_code=201)
def create_column(payload: schemas.KanbanColumnCreate, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    service.require_manager(user)
    def operation():
        current = service.scope(db, user, lock=True)
        draft = drafts(db, user)
        added = StatusDraft(system_name=payload.title, display_label=payload.title)
        index = sum(row.sort_order < payload.order for row in service.rows(db, user))
        draft.insert(index, added)
        service.save(db, user, StatusUpdate(revision=current.revision, statuses=draft))
        created = next(row for row in service.rows(db, user) if row.normalized_label == service.normalize(added.display_label))
        return column(created)
    return commit(db, user, operation)


@router.patch("/{column_id}", response_model=schemas.KanbanColumnRead)
def update_column(column_id: str, payload: schemas.KanbanColumnUpdate, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    service.require_manager(user)
    def operation():
        row = resolve(db, user, column_id)
        current = service.scope(db, user, lock=True)
        ordered = service.rows(db, user)
        draft = drafts(db, user)
        index = next(i for i, item in enumerate(draft) if item.id == row.id)
        changed = draft.pop(index)
        if payload.title is not None:
            changed = StatusDraft(**{**changed.model_dump(), "display_label": payload.title,
                "system_name": changed.system_name if row.is_system else payload.title})
        if payload.order is not None:
            index = sum(item.sort_order < payload.order for item in ordered if item.id != row.id)
        draft.insert(index, changed)
        service.save(db, user, StatusUpdate(revision=current.revision, statuses=draft))
        return column(row)
    return commit(db, user, operation)


@router.delete("/{column_id}", status_code=204)
def delete_column(column_id: str, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    service.require_manager(user)
    def operation():
        row = resolve(db, user, column_id)
        current = service.scope(db, user, lock=True)
        service.remove(db, user, row.id, StatusRemoval(revision=current.revision, action="delete",
            confirmation=row.display_label, expected_task_count=0))
    commit(db, user, operation)
