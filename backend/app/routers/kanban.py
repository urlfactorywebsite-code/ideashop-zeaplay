from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_admin, get_current_active_user

router = APIRouter(prefix="/kanban-columns", tags=["kanban"])


@router.get("", response_model=list[schemas.KanbanColumnRead])
def list_columns(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    stmt = select(models.KanbanColumn).order_by(models.KanbanColumn.order)
    return db.execute(stmt).scalars().all()


@router.post("", response_model=schemas.KanbanColumnRead, status_code=status.HTTP_201_CREATED)
def create_column(
    payload: schemas.KanbanColumnCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    if (
        db.execute(select(models.KanbanColumn).where(models.KanbanColumn.title == payload.title))
        .scalar_one_or_none()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Column title already exists")

    column = models.KanbanColumn(title=payload.title, order=payload.order)
    db.add(column)
    db.commit()
    db.refresh(column)
    return column


@router.patch("/{column_id}", response_model=schemas.KanbanColumnRead)
def update_column(
    column_id: str,
    payload: schemas.KanbanColumnUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    column = db.get(models.KanbanColumn, column_id)
    if not column:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")

    if payload.title is not None:
        column.title = payload.title
    if payload.order is not None:
        column.order = payload.order

    db.commit()
    db.refresh(column)
    return column


@router.delete("/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    column_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    column = db.get(models.KanbanColumn, column_id)
    if not column:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")

    db.delete(column)
    db.commit()
