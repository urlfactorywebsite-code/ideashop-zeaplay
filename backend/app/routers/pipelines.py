from __future__ import annotations

from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


_DEFAULT_STAGE_BLUEPRINT: list[tuple[str, models.TaskStatusEnum]] = [
    ("Waiting", models.TaskStatusEnum.WAITING_FOR_REQUIREMENT),
    ("To Do", models.TaskStatusEnum.TODO),
    ("In Progress", models.TaskStatusEnum.IN_PROGRESS),
    ("Review", models.TaskStatusEnum.IN_REVIEW),
    ("Done", models.TaskStatusEnum.DONE),
]


def _pipeline_base_query() -> select:
    return (
        select(models.Pipeline)
        .options(
            selectinload(models.Pipeline.stages),
            selectinload(models.Pipeline.member_links),
            selectinload(models.Pipeline.department),
        )
        .order_by(models.Pipeline.created_at.desc())
    )


def _get_pipeline_or_404(db: Session, pipeline_id: str) -> models.Pipeline:
    pipeline = db.execute(
        _pipeline_base_query().where(models.Pipeline.id == pipeline_id)
    ).scalars().first()
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return pipeline


def _validate_stage_uniqueness(
    pipeline: models.Pipeline, *, status_value: models.TaskStatusEnum, exclude_stage_id: str | None = None
) -> None:
    for stage in pipeline.stages:
        if stage.status == status_value and stage.id != exclude_stage_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pipeline already has a stage mapped to this status",
            )


def _ensure_stage_orders_unique(stages: Iterable[schemas.PipelineStageCreate]) -> None:
    orders = [stage.order for stage in stages]
    if len(orders) != len(set(orders)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stage order values must be unique",
        )


def _bootstrap_pipeline_stages(
    db: Session,
    pipeline: models.Pipeline,
    stages: list[schemas.PipelineStageCreate] | None,
) -> None:
    stage_payloads = stages or [
        schemas.PipelineStageCreate(label=label, status=status, order=index)
        for index, (label, status) in enumerate(_DEFAULT_STAGE_BLUEPRINT)
    ]

    _ensure_stage_orders_unique(stage_payloads)

    seen_statuses: set[models.TaskStatusEnum] = set()
    for stage_payload in sorted(stage_payloads, key=lambda sp: sp.order):
        status_value = stage_payload.status
        if status_value in seen_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each stage must target a unique status within a pipeline",
            )
        seen_statuses.add(status_value)
        db.add(
            models.PipelineStage(
                pipeline_id=pipeline.id,
                label=stage_payload.label,
                status=status_value,
                order=stage_payload.order,
            )
        )


def _ensure_pipeline_membership(user: models.User, pipeline: models.Pipeline) -> None:
    if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER}:
        return
    if pipeline.id not in {link.pipeline_id for link in user.pipeline_memberships}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this pipeline")


@router.get("", response_model=list[schemas.PipelineRead])
def list_pipelines(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.PipelineRead]:
    stmt = _pipeline_base_query()
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER}:
        stmt = stmt.join(models.PipelineMember).where(models.PipelineMember.user_id == current_user.id)
    pipelines = db.execute(stmt).unique().scalars().all()
    return pipelines


@router.post("", response_model=schemas.PipelineRead, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    payload: schemas.PipelineCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.PipelineRead:
    department = db.get(models.Department, payload.department_id)
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    pipeline = models.Pipeline(
        name=payload.name,
        department_id=department.id,
        created_by_id=current_user.id,
    )
    db.add(pipeline)
    db.flush()

    _bootstrap_pipeline_stages(db, pipeline, payload.stages)

    # ensure the creator can access the pipeline by default
    db.add(models.PipelineMember(pipeline_id=pipeline.id, user_id=current_user.id))

    db.commit()
    db.refresh(pipeline)
    return _get_pipeline_or_404(db, pipeline.id)


@router.patch("/{pipeline_id}", response_model=schemas.PipelineRead)
def update_pipeline(
    pipeline_id: str,
    payload: schemas.PipelineUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.PipelineRead:
    pipeline = _get_pipeline_or_404(db, pipeline_id)

    if payload.name is not None:
        pipeline.name = payload.name
    if payload.department_id is not None:
        department = db.get(models.Department, payload.department_id)
        if not department:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
        pipeline.department_id = payload.department_id

    db.commit()
    return _get_pipeline_or_404(db, pipeline.id)


@router.delete("/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pipeline(
    pipeline_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    pipeline = _get_pipeline_or_404(db, pipeline_id)

    active_tasks = db.execute(
        select(func.count(models.Task.id)).where(models.Task.pipeline_id == pipeline.id)
    ).scalar_one()
    if active_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pipeline has tasks assigned. Reassign or remove them before deleting.",
        )

    db.delete(pipeline)
    db.commit()


@router.post(
    "/{pipeline_id}/stages",
    response_model=schemas.PipelineStageRead,
    status_code=status.HTTP_201_CREATED,
)
def create_stage(
    pipeline_id: str,
    payload: schemas.PipelineStageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.PipelineStageRead:
    pipeline = _get_pipeline_or_404(db, pipeline_id)

    status_value = payload.status
    _validate_stage_uniqueness(pipeline, status_value=status_value)
    if any(stage.order == payload.order for stage in pipeline.stages):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stage order value already in use",
        )

    stage = models.PipelineStage(
        pipeline_id=pipeline.id,
        label=payload.label,
        status=status_value,
        order=payload.order,
    )
    db.add(stage)
    db.commit()
    db.refresh(stage)
    return stage


@router.patch(
    "/{pipeline_id}/stages/{stage_id}",
    response_model=schemas.PipelineStageRead,
)
def update_stage(
    pipeline_id: str,
    stage_id: str,
    payload: schemas.PipelineStageUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.PipelineStageRead:
    pipeline = _get_pipeline_or_404(db, pipeline_id)
    stage = next((stage for stage in pipeline.stages if stage.id == stage_id), None)
    if not stage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")

    if payload.status is not None:
        status_value = payload.status
        _validate_stage_uniqueness(pipeline, status_value=status_value, exclude_stage_id=stage.id)
        stage.status = status_value
    if payload.label is not None:
        stage.label = payload.label
    if payload.order is not None:
        if any(s.id != stage.id and s.order == payload.order for s in pipeline.stages):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stage order value already in use",
            )
        stage.order = payload.order

    db.commit()
    db.refresh(stage)
    return stage


@router.delete(
    "/{pipeline_id}/stages/{stage_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_stage(
    pipeline_id: str,
    stage_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    pipeline = _get_pipeline_or_404(db, pipeline_id)
    stage = next((stage for stage in pipeline.stages if stage.id == stage_id), None)
    if not stage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")

    active_tasks = db.execute(
        select(func.count(models.Task.id)).where(models.Task.stage_id == stage.id)
    ).scalar_one()
    if active_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a stage that still has tasks assigned",
        )

    db.delete(stage)
    db.commit()


@router.put(
    "/{pipeline_id}/members",
    response_model=schemas.PipelineRead,
)
def replace_members(
    pipeline_id: str,
    payload: schemas.PipelineMembershipUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.PipelineRead:
    pipeline = _get_pipeline_or_404(db, pipeline_id)

    target_ids = set(payload.user_ids)
    existing_ids = {link.user_id for link in pipeline.member_links}

    to_add = target_ids - existing_ids
    to_remove = existing_ids - target_ids

    if to_add:
        users = db.execute(select(models.User).where(models.User.id.in_(to_add))).scalars().all()
        if len(users) != len(to_add):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more users do not exist",
            )
        for user in users:
            db.add(models.PipelineMember(pipeline_id=pipeline.id, user_id=user.id))

    if to_remove:
        db.execute(
            select(models.PipelineMember)
            .where(models.PipelineMember.pipeline_id == pipeline.id)
            .where(models.PipelineMember.user_id.in_(to_remove))
        )
        db.execute(
            models.PipelineMember.__table__.delete()
            .where(models.PipelineMember.pipeline_id == pipeline.id)
            .where(models.PipelineMember.user_id.in_(to_remove))
        )

    db.commit()
    return _get_pipeline_or_404(db, pipeline.id)
