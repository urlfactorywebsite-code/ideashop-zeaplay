from __future__ import annotations

import secrets
from datetime import datetime
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
import sqlalchemy as sa
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_active_user
from ..tickets.models import WebhookSubscription, WebhookDeliveryLog
from ..webhooks import payloads as webhook_payloads
from ..webhooks import service as webhook_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
internal_router = APIRouter(prefix="/internal/webhooks", tags=["webhooks"])


def _ensure_admin_or_owner(user: models.User) -> None:
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or Owner required")


def _normalize_headers(headers: dict[str, Any] | None) -> dict[str, str] | None:
    if not headers:
        return None
    normalized: dict[str, str] = {}
    for key, value in headers.items():
        if not key:
            continue
        if value is None:
            continue
        normalized[str(key)] = str(value)
    return normalized or None


def _validate_events(events: list[str]) -> None:
    settings = get_settings()
    unknown = [event for event in events if event not in webhook_payloads.SUPPORTED_EVENTS]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported events: {', '.join(sorted(set(unknown)))}",
        )
    if settings.environment != "development":
        forbidden = [event for event in events if event in webhook_payloads.DEV_ONLY_EVENTS]
        if forbidden:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Test webhooks are only available in development mode",
            )


def _to_read(subscription: WebhookSubscription) -> schemas.WebhookRead:
    return schemas.WebhookRead(
        id=str(subscription.id),
        name=subscription.name,
        url=subscription.target_url,
        subscribed_events=subscription.subscribed_events or [],
        is_enabled=subscription.enabled,
        secret=subscription.secret,
        custom_headers=subscription.custom_headers,
        created_at=subscription.created_at,
        updated_at=subscription.updated_at,
    )


@router.get("", response_model=list[schemas.WebhookRead])
def list_webhooks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.WebhookRead]:
    _ensure_admin_or_owner(current_user)
    stmt = (
        select(WebhookSubscription)
        .where(WebhookSubscription.deleted_at.is_(None))
        .order_by(WebhookSubscription.created_at.desc())
    )
    subscriptions = db.execute(stmt).scalars().all()
    return [_to_read(subscription) for subscription in subscriptions]


@router.post("", response_model=schemas.WebhookRead, status_code=status.HTTP_201_CREATED)
def create_webhook(
    payload: schemas.WebhookCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.WebhookRead:
    _ensure_admin_or_owner(current_user)
    if not payload.subscribed_events:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one event is required")
    _validate_events(payload.subscribed_events)

    settings = get_settings()
    subscription = WebhookSubscription(
        tenant_id=uuid.UUID(settings.default_tenant_id),
        name=payload.name,
        target_url=str(payload.url),
        secret=secrets.token_urlsafe(32),
        subscribed_events=list(payload.subscribed_events),
        custom_headers=_normalize_headers(payload.custom_headers),
        enabled=payload.is_enabled,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return _to_read(subscription)


@router.put("/{webhook_id}", response_model=schemas.WebhookRead)
def update_webhook(
    webhook_id: str,
    payload: schemas.WebhookUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.WebhookRead:
    _ensure_admin_or_owner(current_user)
    subscription = db.get(WebhookSubscription, webhook_id)
    if not subscription or subscription.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "subscribed_events" in update_data:
        events = update_data["subscribed_events"] or []
        if not events:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one event is required")
        _validate_events(events)
        subscription.subscribed_events = list(events)
    if "name" in update_data:
        subscription.name = update_data["name"] or subscription.name
    if "url" in update_data:
        subscription.target_url = str(update_data["url"])
    if "custom_headers" in update_data:
        subscription.custom_headers = _normalize_headers(update_data["custom_headers"])
    if "is_enabled" in update_data:
        subscription.enabled = bool(update_data["is_enabled"])
    subscription.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(subscription)
    return _to_read(subscription)


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_webhook(
    webhook_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    _ensure_admin_or_owner(current_user)
    subscription = db.get(WebhookSubscription, webhook_id)
    if not subscription or subscription.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    subscription.enabled = False
    subscription.deleted_at = datetime.utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{webhook_id}/test", response_model=schemas.WebhookTestResponse)
def test_webhook(
    webhook_id: str,
    payload: schemas.WebhookTestRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.WebhookTestResponse:
    _ensure_admin_or_owner(current_user)
    subscription = db.get(WebhookSubscription, webhook_id)
    if not subscription or subscription.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    event_name = payload.event_name
    if not event_name:
        if subscription.subscribed_events:
            event_name = subscription.subscribed_events[0]
        elif subscription.event_type:
            event_name = subscription.event_type
    if not event_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook has no events to test")
    _validate_events([event_name])
    data = webhook_payloads.get_sample_data(db, event_name)
    log = webhook_service.create_test_delivery(db, webhook=subscription, event_name=event_name, data=data)
    return schemas.WebhookTestResponse(
        status_code=log.response_status,
        response_body=log.response_body,
        response_time_ms=log.response_time_ms,
        error_message=log.error_message,
        delivered_at=log.updated_at,
    )


@router.get("/deliveries", response_model=schemas.WebhookDeliveryLogPage)
def list_webhook_deliveries(
    page: int = 1,
    page_size: int = 25,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.WebhookDeliveryLogPage:
    _ensure_admin_or_owner(current_user)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    stmt = (
        select(WebhookDeliveryLog)
        .where(WebhookDeliveryLog.deleted_at.is_(None))
        .order_by(WebhookDeliveryLog.created_at.desc())
    )
    total = db.execute(select(sa.func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return schemas.WebhookDeliveryLogPage(
        items=[
            schemas.WebhookDeliveryLogRead(
                id=str(item.id),
                event_type=item.event_type,
                status=item.status.value if hasattr(item.status, "value") else str(item.status),
                response_status=item.response_status,
                response_body=item.response_body,
                response_time_ms=item.response_time_ms,
                error_message=item.error_message,
                attempt_count=item.attempt_count or 0,
                last_attempt_at=item.last_attempt_at,
                created_at=item.created_at,
            )
            for item in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@internal_router.post("/dispatch", status_code=status.HTTP_202_ACCEPTED)
def dispatch_internal_event(
    payload: schemas.WebhookDispatchRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> dict[str, Any]:
    _ensure_admin_or_owner(current_user)
    event_name = payload.event
    _validate_events([event_name])
    data = payload.data or webhook_payloads.get_sample_data(db, event_name)
    created = webhook_service.queue_event(db, event_name=event_name, data=data)
    if created:
        db.commit()
    return {"queued": len(created)}
