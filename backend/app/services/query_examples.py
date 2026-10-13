from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .. import models


def get_tasks_with_relations(db: Session) -> list[models.Task]:
    stmt = (
        select(models.Task)
        .options(
            joinedload(models.Task.assignee),
            joinedload(models.Task.creator),
            joinedload(models.Task.subtasks),
        )
        .order_by(models.Task.created_at.desc())
    )
    return db.execute(stmt).unique().scalars().all()
