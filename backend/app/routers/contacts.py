from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from ..services import contacts as contact_service

router = APIRouter(prefix="/contacts", tags=["contacts"])
client_contacts_router = APIRouter(tags=["contacts"])


def _parse_status(value: Optional[str]) -> models.ContactStatusEnum | None:
    if not value:
        return None
    try:
        return models.ContactStatusEnum(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Status must be ACTIVE or ARCHIVED",
        ) from exc


@router.get("", response_model=schemas.ContactListResponse)
def list_contacts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: Optional[str] = Query(default=None, max_length=120),
    client_id: Optional[str] = Query(default=None, max_length=36),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=32),
    sort_by: Literal["display_name", "created_at", "updated_at", "email", "status"] = "display_name",
    sort_order: Literal["asc", "desc"] = "asc",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ContactListResponse:
    return contact_service.list_contacts(
        db,
        tenant_id=current_user.tenant_id,
        page=page,
        page_size=page_size,
        search=q,
        client_id=client_id,
        status_filter=_parse_status(status_filter),
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{contact_id}", response_model=schemas.ContactRead)
def get_contact(
    contact_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ContactRead:
    contact = contact_service.get_contact(db, tenant_id=current_user.tenant_id, contact_id=contact_id)
    return contact_service._to_read(contact)


@router.post("", response_model=schemas.ContactRead, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: schemas.ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ContactRead:
    contact = contact_service.create_contact(db, tenant_id=current_user.tenant_id, payload=payload, actor=current_user)
    return contact_service._to_read(contact)


@router.patch("/{contact_id}", response_model=schemas.ContactRead)
def update_contact(
    contact_id: str,
    payload: schemas.ContactUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ContactRead:
    contact = contact_service.update_contact(
        db,
        tenant_id=current_user.tenant_id,
        contact_id=contact_id,
        payload=payload,
        actor=current_user,
    )
    return contact_service._to_read(contact)


@router.post("/{contact_id}/archive", response_model=schemas.ContactRead)
def archive_contact(
    contact_id: str,
    payload: schemas.ContactArchive | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ContactRead:
    contact = contact_service.archive_contact(
        db,
        tenant_id=current_user.tenant_id,
        contact_id=contact_id,
        payload=payload or schemas.ContactArchive(),
        actor=current_user,
    )
    return contact_service._to_read(contact)


@router.post("/{contact_id}/clients/{client_id}", response_model=schemas.ContactRead)
def add_contact_client_link(
    contact_id: str,
    client_id: str,
    payload: schemas.ContactClientLinkUpdate | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ContactRead:
    contact_service.set_contact_client_link(
        db,
        tenant_id=current_user.tenant_id,
        contact_id=contact_id,
        client_id=client_id,
        is_primary=(payload or schemas.ContactClientLinkUpdate()).is_primary,
        actor=current_user,
    )
    contact = contact_service.get_contact(db, tenant_id=current_user.tenant_id, contact_id=contact_id)
    return contact_service._to_read(contact)


@router.delete("/{contact_id}/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_contact_client_link(
    contact_id: str,
    client_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> Response:
    contact_service.remove_contact_client_link(
        db,
        tenant_id=current_user.tenant_id,
        contact_id=contact_id,
        client_id=client_id,
        actor=current_user,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@client_contacts_router.get("/clients/{client_id}/contacts", response_model=schemas.ContactListResponse)
def list_client_contacts(
    client_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=32),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.ContactListResponse:
    return contact_service.list_contacts(
        db,
        tenant_id=current_user.tenant_id,
        page=page,
        page_size=page_size,
        client_id=client_id,
        status_filter=_parse_status(status_filter),
    )


@client_contacts_router.post("/clients/{client_id}/contacts/{contact_id}", response_model=schemas.ContactRead)
def add_client_contact_link(
    client_id: str,
    contact_id: str,
    payload: schemas.ContactClientLinkUpdate | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.ContactRead:
    return add_contact_client_link(
        contact_id=contact_id,
        client_id=client_id,
        payload=payload,
        db=db,
        current_user=current_user,
    )


@client_contacts_router.delete("/clients/{client_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_client_contact_link(
    client_id: str,
    contact_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> Response:
    return remove_contact_client_link(
        contact_id=contact_id,
        client_id=client_id,
        db=db,
        current_user=current_user,
    )
