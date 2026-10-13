from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from . import security_audit


SortField = Literal["display_name", "created_at", "updated_at", "email", "status"]
SortOrder = Literal["asc", "desc"]

SORT_FIELDS: dict[str, Any] = {
    "display_name": models.Contact.display_name,
    "created_at": models.Contact.created_at,
    "updated_at": models.Contact.updated_at,
    "email": models.Contact.email,
    "status": models.Contact.status,
}


def _tenant_uuid(value: uuid.UUID | str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def normalize_name(first_name: str, last_name: str | None = None) -> tuple[str, str]:
    first = " ".join(first_name.strip().split())
    last = " ".join((last_name or "").strip().split())
    display = f"{first} {last}".strip()
    return display, " ".join(display.casefold().split())


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    digits = "".join(char for char in value if char.isdigit())
    return digits or None


def normalize_email(value: str | None) -> str | None:
    return value.strip().casefold() if value else None


def _contact_query(tenant_id: uuid.UUID):
    return (
        select(models.Contact)
        .where(models.Contact.tenant_id == tenant_id)
        .options(selectinload(models.Contact.client_links).selectinload(models.ClientContact.client))
    )


def _to_read(contact: models.Contact) -> schemas.ContactRead:
    clients = [
        schemas.ContactClientSummary(
            id=link.client.id,
            company_name=link.client.company_name,
            status=link.client.status,
            is_primary=link.is_primary,
        )
        for link in sorted(contact.client_links or [], key=lambda item: item.client.company_name.casefold())
        if link.client is not None
    ]
    return schemas.ContactRead(
        id=contact.id,
        tenant_id=contact.tenant_id,
        first_name=contact.first_name,
        last_name=contact.last_name,
        display_name=contact.display_name,
        email=contact.email,
        phone=contact.phone,
        title=contact.title,
        notes=contact.notes,
        status=contact.status,
        clients=clients,
        created_by_id=contact.created_by_id,
        updated_by_id=contact.updated_by_id,
        archived_by_id=contact.archived_by_id,
        archived_at=contact.archived_at,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
    )


def _raise_duplicate_conflict(exc: IntegrityError) -> None:
    message = str(getattr(exc, "orig", exc)).lower()
    if "client_contacts" in message or "primary_per_client" in message:
        detail = "This client/contact association already exists or conflicts with the current primary contact"
    elif "email" in message:
        detail = "An active contact with this email already exists"
    else:
        detail = "An active contact with this name and phone already exists"
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


def get_contact(db: Session, *, tenant_id: uuid.UUID | str, contact_id: str) -> models.Contact:
    tenant_uuid = _tenant_uuid(tenant_id)
    contact = db.execute(
        _contact_query(tenant_uuid).where(models.Contact.id == contact_id)
    ).scalars().first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return contact


def _get_client(db: Session, *, tenant_id: uuid.UUID, client_id: str) -> models.Client:
    client = db.execute(
        select(models.Client).where(models.Client.tenant_id == tenant_id, models.Client.id == client_id)
    ).scalars().first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return client


def _ensure_no_active_duplicate(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    normalized_email: str | None,
    normalized_name: str,
    normalized_phone: str | None,
    exclude_id: str | None = None,
) -> None:
    conditions = []
    if normalized_email:
        conditions.append(models.Contact.normalized_email == normalized_email)
    if normalized_phone:
        conditions.append(
            (models.Contact.normalized_name == normalized_name)
            & (models.Contact.normalized_phone == normalized_phone)
        )
    if not conditions:
        return
    stmt = (
        select(models.Contact)
        .where(models.Contact.tenant_id == tenant_id)
        .where(models.Contact.status == models.ContactStatusEnum.ACTIVE)
        .where(or_(*conditions))
    )
    if exclude_id:
        stmt = stmt.where(models.Contact.id != exclude_id)
    duplicate = db.execute(stmt).scalars().first()
    if duplicate:
        if normalized_email and duplicate.normalized_email == normalized_email:
            detail = "An active contact with this email already exists"
        else:
            detail = "An active contact with this name and phone already exists"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _apply_identity(contact: models.Contact, *, first_name: str, last_name: str | None, email: str | None, phone: str | None) -> None:
    display_name, normalized_name = normalize_name(first_name, last_name)
    contact.first_name = first_name
    contact.last_name = last_name
    contact.display_name = display_name
    contact.normalized_name = normalized_name
    contact.email = email
    contact.normalized_email = normalize_email(email)
    contact.phone = phone
    contact.normalized_phone = normalize_phone(phone)


def _sync_links(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    contact: models.Contact,
    client_links: list[schemas.ContactClientLinkInput],
    actor: models.User,
) -> None:
    seen: set[str] = set()
    for link_input in client_links:
        if link_input.client_id in seen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate client link in request")
        seen.add(link_input.client_id)
        set_contact_client_link(
            db,
            tenant_id=tenant_id,
            contact_id=contact.id,
            client_id=link_input.client_id,
            is_primary=link_input.is_primary,
            actor=actor,
            commit=False,
        )

    current_links = db.execute(
        select(models.ClientContact).where(
            models.ClientContact.tenant_id == tenant_id,
            models.ClientContact.contact_id == contact.id,
        )
    ).scalars().all()
    for link in current_links:
        if link.client_id not in seen:
            db.delete(link)


def list_contacts(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
    client_id: str | None = None,
    status_filter: models.ContactStatusEnum | None = None,
    sort_by: SortField = "display_name",
    sort_order: SortOrder = "asc",
) -> schemas.ContactListResponse:
    tenant_uuid = _tenant_uuid(tenant_id)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    stmt = _contact_query(tenant_uuid)

    if status_filter is not None:
        stmt = stmt.where(models.Contact.status == status_filter)
    if client_id:
        stmt = stmt.join(models.ClientContact).where(
            models.ClientContact.tenant_id == tenant_uuid,
            models.ClientContact.client_id == client_id,
        )
    if search:
        needle = f"%{search.strip().casefold()}%"
        stmt = stmt.where(
            or_(
                func.lower(models.Contact.display_name).like(needle),
                func.lower(models.Contact.email).like(needle),
                func.lower(models.Contact.phone).like(needle),
                func.lower(models.Contact.title).like(needle),
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    sort_column = SORT_FIELDS.get(sort_by, models.Contact.display_name)
    order_expr = sort_column.desc() if sort_order == "desc" else sort_column.asc()
    rows = (
        db.execute(
            stmt.order_by(order_expr, models.Contact.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return schemas.ContactListResponse(
        items=[_to_read(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=max(1, math.ceil(total / page_size)) if total else 1,
    )


def create_contact(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    payload: schemas.ContactCreate,
    actor: models.User,
) -> models.Contact:
    tenant_uuid = _tenant_uuid(tenant_id)
    display_name, normalized_name = normalize_name(payload.first_name, payload.last_name)
    normalized_email = normalize_email(str(payload.email) if payload.email else None)
    normalized_phone = normalize_phone(payload.phone)
    _ensure_no_active_duplicate(
        db,
        tenant_id=tenant_uuid,
        normalized_email=normalized_email,
        normalized_name=normalized_name,
        normalized_phone=normalized_phone,
    )
    contact = models.Contact(
        tenant_id=tenant_uuid,
        first_name=payload.first_name,
        last_name=payload.last_name,
        display_name=display_name,
        normalized_name=normalized_name,
        email=str(payload.email) if payload.email else None,
        normalized_email=normalized_email,
        phone=payload.phone,
        normalized_phone=normalized_phone,
        title=payload.title,
        notes=payload.notes,
        status=models.ContactStatusEnum.ACTIVE,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    db.add(contact)
    try:
        db.flush()
        _sync_links(db, tenant_id=tenant_uuid, contact=contact, client_links=payload.client_links, actor=actor)
        security_audit.append_event(
            db,
            actor=actor,
            event_type="contact.created",
            entity_type="contact",
            entity_id=contact.id,
            payload={"client_link_count": len(payload.client_links or []), "status": contact.status.value},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _raise_duplicate_conflict(exc)
    db.refresh(contact)
    return get_contact(db, tenant_id=tenant_uuid, contact_id=contact.id)


def update_contact(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    contact_id: str,
    payload: schemas.ContactUpdate,
    actor: models.User,
) -> models.Contact:
    tenant_uuid = _tenant_uuid(tenant_id)
    contact = get_contact(db, tenant_id=tenant_uuid, contact_id=contact_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return contact

    next_first = update_data.get("first_name", contact.first_name)
    next_last = update_data.get("last_name", contact.last_name)
    next_email = str(update_data["email"]) if update_data.get("email") else update_data.get("email", contact.email)
    next_phone = update_data.get("phone", contact.phone)
    _, next_normalized_name = normalize_name(next_first, next_last)
    next_normalized_email = normalize_email(next_email)
    next_normalized_phone = normalize_phone(next_phone)
    if contact.status == models.ContactStatusEnum.ACTIVE:
        _ensure_no_active_duplicate(
            db,
            tenant_id=tenant_uuid,
            normalized_email=next_normalized_email,
            normalized_name=next_normalized_name,
            normalized_phone=next_normalized_phone,
            exclude_id=contact.id,
        )

    if any(field in update_data for field in {"first_name", "last_name", "email", "phone"}):
        _apply_identity(contact, first_name=next_first, last_name=next_last, email=next_email, phone=next_phone)
    for field in ("title", "notes"):
        if field in update_data:
            setattr(contact, field, update_data[field])
    contact.updated_by_id = actor.id
    if payload.client_links is not None:
        _sync_links(db, tenant_id=tenant_uuid, contact=contact, client_links=payload.client_links, actor=actor)
    security_audit.append_event(
        db,
        actor=actor,
        event_type="contact.updated",
        entity_type="contact",
        entity_id=contact.id,
        payload={"fields": sorted(update_data.keys())},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _raise_duplicate_conflict(exc)
    db.refresh(contact)
    return get_contact(db, tenant_id=tenant_uuid, contact_id=contact.id)


def archive_contact(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    contact_id: str,
    payload: schemas.ContactArchive,
    actor: models.User,
) -> models.Contact:
    contact = get_contact(db, tenant_id=tenant_id, contact_id=contact_id)
    if contact.status == models.ContactStatusEnum.ARCHIVED:
        return contact
    contact.status = models.ContactStatusEnum.ARCHIVED
    contact.archived_at = datetime.utcnow()
    contact.archived_by_id = actor.id
    contact.updated_by_id = actor.id
    if payload.reason:
        existing_notes = contact.notes or ""
        note = f"Archive reason: {payload.reason}"
        contact.notes = f"{existing_notes}\n{note}".strip() if existing_notes else note
    security_audit.append_event(
        db,
        actor=actor,
        event_type="contact.archived",
        entity_type="contact",
        entity_id=contact.id,
        payload={"reason_provided": bool(payload.reason)},
    )
    db.commit()
    db.refresh(contact)
    return get_contact(db, tenant_id=tenant_id, contact_id=contact.id)


def set_contact_client_link(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    contact_id: str,
    client_id: str,
    is_primary: bool,
    actor: models.User,
    commit: bool = True,
) -> models.ClientContact:
    tenant_uuid = _tenant_uuid(tenant_id)
    _get_client(db, tenant_id=tenant_uuid, client_id=client_id)
    get_contact(db, tenant_id=tenant_uuid, contact_id=contact_id)
    link = db.execute(
        select(models.ClientContact).where(
            models.ClientContact.tenant_id == tenant_uuid,
            models.ClientContact.client_id == client_id,
            models.ClientContact.contact_id == contact_id,
        )
    ).scalars().first()
    if is_primary:
        db.execute(
            update(models.ClientContact)
            .where(
                models.ClientContact.tenant_id == tenant_uuid,
                models.ClientContact.client_id == client_id,
                models.ClientContact.contact_id != contact_id,
            )
            .values(is_primary=False, updated_by_id=actor.id)
        )
    if link:
        link.is_primary = is_primary
        link.updated_by_id = actor.id
        event_type = "contact.client_link.updated"
    else:
        link = models.ClientContact(
            id=models.generate_uuid(),
            tenant_id=tenant_uuid,
            client_id=client_id,
            contact_id=contact_id,
            is_primary=is_primary,
            created_by_id=actor.id,
            updated_by_id=actor.id,
        )
        db.add(link)
        event_type = "contact.client_link.added"
    security_audit.append_event(
        db,
        actor=actor,
        event_type=event_type,
        entity_type="client_contact",
        entity_id=link.id,
        payload={"client_id": client_id, "contact_id": contact_id, "is_primary": is_primary},
    )
    if commit:
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            _raise_duplicate_conflict(exc)
        db.refresh(link)
    return link


def remove_contact_client_link(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    contact_id: str,
    client_id: str,
    actor: models.User | None = None,
) -> None:
    tenant_uuid = _tenant_uuid(tenant_id)
    link = db.execute(
        select(models.ClientContact).where(
            models.ClientContact.tenant_id == tenant_uuid,
            models.ClientContact.client_id == client_id,
            models.ClientContact.contact_id == contact_id,
        )
    ).scalars().first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client/contact association not found")
    security_audit.append_event(
        db,
        actor=actor,
        event_type="contact.client_link.removed",
        entity_type="client_contact",
        entity_id=link.id,
        payload={"client_id": client_id, "contact_id": contact_id, "was_primary": link.is_primary},
    )
    db.delete(link)
    db.commit()
