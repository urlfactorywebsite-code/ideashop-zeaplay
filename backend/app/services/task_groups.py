"""Stable logical-task identity. Legacy missing IDs stay individual, never title-matched."""
from sqlalchemy import and_, case, func

from .. import models


def partition_columns():
    task = models.Task
    return (
        case((func.nullif(task.task_group_id, "").is_(None), 0), else_=1),
        func.coalesce(func.nullif(task.task_group_id, ""), task.id),
        task.project_id,
        case((task.project_id.is_(None), task.created_by_id), else_=""),
    )


def key(task):
    return (bool(task.task_group_id), task.task_group_id or task.id, task.project_id,
            task.created_by_id if task.project_id is None else "")


def predicate(task):
    # Keep the existing task_group_id index usable for batched member retrieval.
    group = models.Task.task_group_id == task.task_group_id if task.task_group_id else models.Task.id == task.id
    conditions = [group, models.Task.project_id == task.project_id]
    if task.project_id is None:
        conditions.append(models.Task.created_by_id == task.created_by_id)
    return and_(*conditions)
