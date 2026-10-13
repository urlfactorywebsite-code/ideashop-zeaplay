from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from ..services import project_dashboard, projects as project_service

router = APIRouter(prefix="/projects", tags=["projects"])


def _parse_status(value: Optional[str]) -> models.ProjectStatusEnum | None:
    if not value:
        return None
    try:
        return models.ProjectStatusEnum(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Status must be ACTIVE or ARCHIVED",
        ) from exc


def _parse_task_status(value: Optional[str]) -> models.TaskStatusEnum | None:
    if not value:
        return None
    try:
        return models.TaskStatusEnum(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid task status",
        ) from exc


def _parse_priority(value: Optional[str]) -> models.TaskPriorityEnum | None:
    if not value:
        return None
    try:
        return models.TaskPriorityEnum(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid task priority",
        ) from exc


@router.get("", response_model=schemas.ProjectListResponse)
def list_projects(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: Optional[str] = Query(default=None, max_length=120),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=32),
    client_id: Optional[str] = Query(default=None, max_length=36),
    mine: bool = Query(default=False),
    sort_by: Literal["name", "created_at", "updated_at", "status", "client"] = "name",
    sort_order: Literal["asc", "desc"] = "asc",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ProjectListResponse:
    return project_service.list_projects(
        db,
        tenant_id=current_user.tenant_id,
        actor=current_user,
        page=page,
        page_size=page_size,
        search=q,
        status_filter=_parse_status(status_filter),
        client_id=client_id,
        mine=mine,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{project_id}", response_model=schemas.ProjectRead)
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ProjectRead:
    project = project_service.get_project(db, tenant_id=current_user.tenant_id, project_id=project_id, actor=current_user)
    return project_service.to_read(project, task_count=project_service.count_project_tasks(db, project_id=project.id))


@router.get("/{project_id}/task-dashboard", response_model=schemas.ProjectTaskDashboardResponse)
def get_project_task_dashboard(
    project_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: Optional[str] = Query(default=None, max_length=120),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=64),
    priority: Optional[str] = Query(default=None, max_length=32),
    member_id: Optional[str] = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ProjectTaskDashboardResponse:
    return project_dashboard.project_task_dashboard(
        db,
        project_id=project_id,
        actor=current_user,
        page=page,
        page_size=page_size,
        search=q,
        status_filter=_parse_task_status(status_filter),
        priority_filter=_parse_priority(priority),
        member_id=member_id,
    )


@router.patch(
    "/{project_id}/tasks/{task_id}/status",
    response_model=schemas.ProjectDashboardTask,
)
def override_project_task_status(
    project_id: str,
    task_id: str,
    payload: schemas.ProjectTaskStatusOverride,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ProjectDashboardTask:
    return project_dashboard.override_project_task_status(
        db,
        project_id=project_id,
        task_id=task_id,
        payload=payload,
        actor=current_user,
    )


@router.post("", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ProjectRead:
    project = project_service.create_project(db, tenant_id=current_user.tenant_id, payload=payload, actor=current_user)
    return project_service.to_read(project)


@router.patch("/{project_id}", response_model=schemas.ProjectRead)
def update_project(
    project_id: str,
    payload: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ProjectRead:
    project = project_service.update_project(
        db,
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        payload=payload,
        actor=current_user,
    )
    return project_service.to_read(project)


@router.put("/{project_id}/members", response_model=schemas.ProjectRead)
def replace_project_members(
    project_id: str,
    payload: schemas.ProjectMembershipInput,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ProjectRead:
    project = project_service.replace_project_members(
        db,
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        payload=payload,
        actor=current_user,
    )
    return project_service.to_read(project)


@router.post("/{project_id}/archive", response_model=schemas.ProjectRead)
def archive_project(
    project_id: str,
    payload: schemas.ProjectArchive | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ProjectRead:
    project = project_service.archive_project(
        db,
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        payload=payload or schemas.ProjectArchive(),
        actor=current_user,
    )
    return project_service.to_read(project)
