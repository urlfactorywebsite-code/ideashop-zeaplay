from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from . import archive_state, entity_notifications, security_audit


SortField = Literal["company_name", "created_at", "updated_at", "country", "status"]
SortOrder = Literal["asc", "desc"]

SORT_FIELDS: dict[str, Any] = {
    "company_name": models.Client.company_name,
    "created_at": models.Client.created_at,
    "updated_at": models.Client.updated_at,
    "country": models.Client.country,
    "status": models.Client.status,
}


def normalize_company_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _tenant_uuid(value: uuid.UUID | str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _client_query(tenant_id: uuid.UUID):
    return select(models.Client).where(models.Client.tenant_id == tenant_id)


def _active_duplicate(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    normalized_company_name: str,
    gst_number: str | None,
    exclude_id: str | None = None,
) -> models.Client | None:
    conditions = [models.Client.normalized_company_name == normalized_company_name]
    if gst_number:
        conditions.append(models.Client.gst_number == gst_number)
    stmt = (
        select(models.Client)
        .where(models.Client.tenant_id == tenant_id)
        .where(models.Client.status == models.ClientStatusEnum.ACTIVE)
        .where(or_(*conditions))
    )
    if exclude_id:
        stmt = stmt.where(models.Client.id != exclude_id)
    return db.execute(stmt).scalars().first()


def _ensure_no_active_duplicate(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    normalized_company_name: str,
    gst_number: str | None,
    exclude_id: str | None = None,
) -> None:
    duplicate = _active_duplicate(
        db,
        tenant_id=tenant_id,
        normalized_company_name=normalized_company_name,
        gst_number=gst_number,
        exclude_id=exclude_id,
    )
    if duplicate:
        if duplicate.normalized_company_name == normalized_company_name:
            detail = "An active client with this company name already exists"
        else:
            detail = "An active client with this GST number already exists"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _raise_duplicate_conflict(exc: IntegrityError) -> None:
    message = str(getattr(exc, "orig", exc)).lower()
    if "uq_clients_active_tenant_gst" in message or "gst_number" in message:
        detail = "An active client with this GST number already exists"
    else:
        detail = "An active client with this company name already exists"
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


def get_client(db: Session, *, tenant_id: uuid.UUID | str, client_id: str) -> models.Client:
    tenant_uuid = _tenant_uuid(tenant_id)
    client = db.execute(
        _client_query(tenant_uuid).where(models.Client.id == client_id)
    ).scalars().first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return client


def list_clients(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
    status_filter: models.ClientStatusEnum | None = None,
    sort_by: SortField = "company_name",
    sort_order: SortOrder = "asc",
) -> schemas.ClientListResponse:
    tenant_uuid = _tenant_uuid(tenant_id)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    stmt = _client_query(tenant_uuid)

    if status_filter is not None:
        stmt = stmt.where(models.Client.status == status_filter)

    if search:
        needle = f"%{search.strip().casefold()}%"
        stmt = stmt.where(
            or_(
                func.lower(models.Client.company_name).like(needle),
                func.lower(models.Client.normalized_company_name).like(needle),
                func.lower(models.Client.gst_number).like(needle),
                func.lower(models.Client.phone).like(needle),
                func.lower(models.Client.email).like(needle),
                func.lower(models.Client.city).like(needle),
                func.lower(models.Client.country).like(needle),
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()

    sort_column = SORT_FIELDS.get(sort_by, models.Client.company_name)
    if sort_order == "desc":
        order_expr = sort_column.desc()
    else:
        order_expr = sort_column.asc()
    rows = (
        db.execute(
            stmt.order_by(order_expr, models.Client.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )

    return schemas.ClientListResponse(
        items=[schemas.ClientRead.model_validate(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=max(1, math.ceil(total / page_size)) if total else 1,
    )


def create_client(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    payload: schemas.ClientCreate,
    actor: models.User,
) -> models.Client:
    tenant_uuid = _tenant_uuid(tenant_id)
    normalized_name = normalize_company_name(payload.company_name)
    _ensure_no_active_duplicate(
        db,
        tenant_id=tenant_uuid,
        normalized_company_name=normalized_name,
        gst_number=payload.gst_number,
    )
    client = models.Client(
        tenant_id=tenant_uuid,
        company_name=payload.company_name,
        normalized_company_name=normalized_name,
        gst_number=payload.gst_number,
        email=str(payload.email) if payload.email else None,
        phone=payload.phone,
        website=payload.website,
        address_line1=payload.address_line1,
        address_line2=payload.address_line2,
        city=payload.city,
        state=payload.state,
        postal_code=payload.postal_code,
        country=payload.country,
        notes=payload.notes,
        status=models.ClientStatusEnum.ACTIVE,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    db.add(client)
    try:
        db.flush()
        security_audit.append_event(
            db,
            actor=actor,
            event_type="client.created",
            entity_type="client",
            entity_id=client.id,
            payload={"status": client.status.value},
        )
        entity_notifications.notify_client(db, client=client, actor=actor, action="created")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _raise_duplicate_conflict(exc)
    db.refresh(client)
    return client


def update_client(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    client_id: str,
    payload: schemas.ClientUpdate,
    actor: models.User,
) -> models.Client:
    client = get_client(db, tenant_id=tenant_id, client_id=client_id)
    update_data = payload.model_dump(exclude_unset=True)
    update_data = {key: value for key, value in update_data.items()
                   if getattr(client, key) != (str(value) if key == "email" and value else value)}
    if not update_data:
        return client

    next_company_name = update_data.get("company_name", client.company_name)
    next_normalized_name = normalize_company_name(next_company_name)
    next_gst = update_data.get("gst_number", client.gst_number)

    if client.status == models.ClientStatusEnum.ACTIVE:
        _ensure_no_active_duplicate(
            db,
            tenant_id=client.tenant_id,
            normalized_company_name=next_normalized_name,
            gst_number=next_gst,
            exclude_id=client.id,
        )

    for field, value in update_data.items():
        if field == "email":
            setattr(client, field, str(value) if value else None)
        else:
            setattr(client, field, value)

    client.normalized_company_name = next_normalized_name
    client.updated_by_id = actor.id
    security_audit.append_event(
        db,
        actor=actor,
        event_type="client.updated",
        entity_type="client",
        entity_id=client.id,
        payload={"fields": sorted(update_data.keys())},
    )

    try:
        entity_notifications.notify_client(db, client=client, actor=actor, action="updated")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _raise_duplicate_conflict(exc)
    db.refresh(client)
    return client


def archive_client(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    client_id: str,
    payload: schemas.ClientArchive,
    actor: models.User,
) -> models.Client:
    client = archive_state.locked_entity(db, models.Client, tenant_id=_tenant_uuid(tenant_id), entity_id=client_id)
    actor = archive_state.management_actor(db, actor, client.tenant_id)
    if client.status == models.ClientStatusEnum.ARCHIVED:
        return client
    previous = archive_state.state(client)
    client.status = models.ClientStatusEnum.ARCHIVED
    client.archived_at = datetime.utcnow()
    client.archived_by_id = actor.id
    client.updated_by_id = actor.id
    if payload.reason:
        existing_notes = client.notes or ""
        note = f"Archive reason: {payload.reason}"
        client.notes = f"{existing_notes}\n{note}".strip() if existing_notes else note
    archive_state.audit_transition(db, record=client, actor=actor, entity_type="client",
        action="archived", previous=previous, reason_provided=bool(payload.reason))
    entity_notifications.notify_client(db, client=client, actor=actor, action="archived")
    db.commit()
    db.refresh(client)
    return client


def restore_client(db: Session, *, tenant_id: uuid.UUID | str, client_id: str, actor: models.User) -> models.Client:
    client = archive_state.locked_entity(db, models.Client, tenant_id=_tenant_uuid(tenant_id), entity_id=client_id)
    actor = archive_state.management_actor(db, actor, client.tenant_id)
    if client.status == models.ClientStatusEnum.ACTIVE:
        return client
    _ensure_no_active_duplicate(db, tenant_id=client.tenant_id,
        normalized_company_name=client.normalized_company_name, gst_number=client.gst_number, exclude_id=client.id)
    previous = archive_state.state(client)
    client.status = models.ClientStatusEnum.ACTIVE
    client.archived_at = None
    client.archived_by_id = None
    client.updated_by_id = actor.id
    archive_state.audit_transition(db, record=client, actor=actor, entity_type="client",
        action="restored", previous=previous)
    try:
        entity_notifications.notify_client(db, client=client, actor=actor, action="restored")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _raise_duplicate_conflict(exc)
    db.refresh(client)
    return client
