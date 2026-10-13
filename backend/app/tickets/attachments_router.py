from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_active_user, get_tenant_id, require_roles
from ..models import User
from ..storage.minio import build_ticket_attachment_key, ensure_bucket_exists, get_minio_client, sanitize_filename
from .models import (
    Ticket,
    TicketAttachment,
    TicketParticipant,
    TicketParticipantRoleEnum,
)


router = APIRouter(prefix="/api/tickets", tags=["tickets"])
settings = get_settings()

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


class AttachmentPresignRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_name: str = Field(min_length=1, max_length=255, alias="fileName")
    content_type: str = Field(min_length=1, max_length=255, alias="contentType")
    size_bytes: int = Field(gt=0, alias="sizeBytes")


class AttachmentPresignResponse(BaseModel):
    uploadUrl: str
    fileKey: str
    headers: dict[str, str]


class AttachmentConfirmRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_key: str = Field(min_length=1, alias="fileKey")


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    tenant_id: uuid.UUID
    file_key: str
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_by: str
    created_at: datetime


def _get_ticket(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> Ticket:
    ticket = db.execute(
        select(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _user_has_access(
    db: Session,
    *,
    ticket: Ticket,
    user_id: str,
    user_department_id: Optional[str],
    roles: set[str],
) -> bool:
    if roles.intersection({"admin", "owner"}):
        return True
    if "manager" in roles and user_department_id and str(ticket.department_id) == str(user_department_id):
        return True
    if ticket.owner_id == user_id or ticket.created_by == user_id:
        return True
    participant = db.execute(
        select(TicketParticipant)
        .where(
            TicketParticipant.tenant_id == ticket.tenant_id,
            TicketParticipant.ticket_id == ticket.id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if not participant:
        return False
    return participant.role in {
        TicketParticipantRoleEnum.OWNER,
        TicketParticipantRoleEnum.ASSIGNEE,
        TicketParticipantRoleEnum.FOLLOWER,
    }


def _require_ticket_access(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: User,
    roles: list[str],
) -> Ticket:
    ticket = _get_ticket(db, tenant_id=tenant_id, ticket_id=ticket_id)
    user_id = str(current_user.id)
    if not _user_has_access(
        db,
        ticket=ticket,
        user_id=user_id,
        user_department_id=current_user.department_id,
        roles={r.lower() for r in roles},
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for ticket")
    return ticket


def _parse_filename_from_key(file_key: str) -> str:
    base = file_key.split("/")[-1]
    parts = base.split("-", 1)
    if len(parts) == 2:
        return parts[1]
    return base


def _validate_file_key(file_key: str, *, tenant_id: uuid.UUID, ticket_id: uuid.UUID) -> None:
    expected_prefix = f"tenant/{tenant_id}/tickets/{ticket_id}/"
    if not file_key.startswith(expected_prefix):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file_key")


def _build_headers(content_type: str) -> dict[str, str]:
    return {"Content-Type": content_type}


def _get_minio_client():
    try:
        return get_minio_client()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.post(
    "/{ticket_id}/attachments/presign",
    response_model=AttachmentPresignResponse,
)
def presign_attachment_upload(
    ticket_id: uuid.UUID,
    payload: AttachmentPresignRequest,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_active_user),
    roles: list[str] = Depends(require_roles()),
) -> AttachmentPresignResponse:
    _require_ticket_access(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )

    if payload.size_bytes > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds max size of 10MB",
        )

    safe_name = sanitize_filename(payload.file_name, fallback="attachment")
    file_key = build_ticket_attachment_key(
        tenant_id=str(tenant_id),
        ticket_id=str(ticket_id),
        filename=safe_name,
    )

    client = _get_minio_client()
    bucket = settings.minio_bucket_ticket_attachments
    try:
        ensure_bucket_exists(client, bucket)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MinIO bucket is not available",
        ) from exc

    try:
        upload_url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": file_key,
                "ContentType": payload.content_type,
            },
            ExpiresIn=300,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload URL",
        ) from exc

    return AttachmentPresignResponse(
        uploadUrl=upload_url,
        fileKey=file_key,
        headers=_build_headers(payload.content_type),
    )


@router.post(
    "/{ticket_id}/attachments/confirm",
    response_model=AttachmentRead,
)
def confirm_attachment_upload(
    ticket_id: uuid.UUID,
    payload: AttachmentConfirmRequest,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_active_user),
    roles: list[str] = Depends(require_roles()),
) -> AttachmentRead:
    _require_ticket_access(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )
    _validate_file_key(payload.file_key, tenant_id=tenant_id, ticket_id=ticket_id)

    existing = db.execute(
        select(TicketAttachment)
        .where(
            TicketAttachment.tenant_id == tenant_id,
            TicketAttachment.ticket_id == ticket_id,
            TicketAttachment.file_key == payload.file_key,
            TicketAttachment.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if existing:
        return existing

    client = _get_minio_client()
    bucket = settings.minio_bucket_ticket_attachments
    try:
        head = client.head_object(Bucket=bucket, Key=payload.file_key)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded object not found",
        ) from exc

    size_bytes = int(head.get("ContentLength") or 0)
    if size_bytes > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds max size of 10MB",
        )

    mime_type = (head.get("ContentType") or "application/octet-stream").split(";")[0]
    file_name = sanitize_filename(_parse_filename_from_key(payload.file_key), fallback="attachment")

    attachment = TicketAttachment(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        file_key=payload.file_key,
        file_name=file_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        uploaded_by=str(current_user.id),
        created_at=datetime.utcnow(),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get(
    "/{ticket_id}/attachments",
    response_model=list[AttachmentRead],
)
def list_ticket_attachments(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_active_user),
    roles: list[str] = Depends(require_roles()),
) -> list[AttachmentRead]:
    _require_ticket_access(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )

    attachments = db.execute(
        select(TicketAttachment)
        .where(
            TicketAttachment.tenant_id == tenant_id,
            TicketAttachment.ticket_id == ticket_id,
            TicketAttachment.deleted_at.is_(None),
        )
        .order_by(TicketAttachment.created_at.desc())
    ).scalars().all()
    return attachments


@router.delete(
    "/{ticket_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_ticket_attachment(
    ticket_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
    current_user: User = Depends(get_current_active_user),
    roles: list[str] = Depends(require_roles()),
) -> None:
    _require_ticket_access(
        db,
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        current_user=current_user,
        roles=roles,
    )

    attachment = db.execute(
        select(TicketAttachment)
        .where(
            TicketAttachment.id == attachment_id,
            TicketAttachment.tenant_id == tenant_id,
            TicketAttachment.ticket_id == ticket_id,
            TicketAttachment.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    attachment.deleted_at = datetime.utcnow()
    db.add(attachment)
    db.commit()
