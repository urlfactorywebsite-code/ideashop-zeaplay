from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from ..services import clients as client_service

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("", response_model=schemas.ClientListResponse)
def list_clients(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: Optional[str] = Query(default=None, max_length=120),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=32),
    sort_by: Literal["company_name", "created_at", "updated_at", "country", "status"] = "company_name",
    sort_order: Literal["asc", "desc"] = "asc",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ClientListResponse:
    parsed_status: models.ClientStatusEnum | None = None
    if status_filter:
        try:
            parsed_status = models.ClientStatusEnum(status_filter)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Status must be ACTIVE or ARCHIVED",
            ) from exc
    return client_service.list_clients(
        db,
        tenant_id=current_user.tenant_id,
        page=page,
        page_size=page_size,
        search=q,
        status_filter=parsed_status,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{client_id}", response_model=schemas.ClientRead)
def get_client(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ClientRead:
    client = client_service.get_client(db, tenant_id=current_user.tenant_id, client_id=client_id)
    return schemas.ClientRead.model_validate(client)


@router.post("/{client_id}/restore", response_model=schemas.ClientRead)
def restore_client(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ClientRead:
    return schemas.ClientRead.model_validate(client_service.restore_client(
        db, tenant_id=current_user.tenant_id, client_id=client_id, actor=current_user))


@router.post("", response_model=schemas.ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(
    payload: schemas.ClientCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ClientRead:
    client = client_service.create_client(
        db,
        tenant_id=current_user.tenant_id,
        payload=payload,
        actor=current_user,
    )
    return schemas.ClientRead.model_validate(client)


@router.patch("/{client_id}", response_model=schemas.ClientRead)
def update_client(
    client_id: str,
    payload: schemas.ClientUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ClientRead:
    client = client_service.update_client(
        db,
        tenant_id=current_user.tenant_id,
        client_id=client_id,
        payload=payload,
        actor=current_user,
    )
    return schemas.ClientRead.model_validate(client)


@router.post("/{client_id}/archive", response_model=schemas.ClientRead)
def archive_client(
    client_id: str,
    payload: schemas.ClientArchive | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ClientRead:
    client = client_service.archive_client(
        db,
        tenant_id=current_user.tenant_id,
        client_id=client_id,
        payload=payload or schemas.ClientArchive(),
        actor=current_user,
    )
    return schemas.ClientRead.model_validate(client)
