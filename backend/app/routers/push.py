from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import push_service

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key", response_model=schemas.PushSubscriptionPublicKey)
def get_vapid_public_key() -> schemas.PushSubscriptionPublicKey:
    public_key = push_service.get_vapid_public_key()
    if not public_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VAPID public key not configured")
    return schemas.PushSubscriptionPublicKey(public_key=public_key)


@router.get("/status", response_model=schemas.PushStatusRead)
def push_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.PushStatusRead:
    count = db.scalar(select(func.count()).select_from(models.PushSubscription).where(
        models.PushSubscription.user_id == current_user.id,
        models.PushSubscription.revoked_at.is_(None),
    ))
    return schemas.PushStatusRead(**push_service.configuration_status(), active_subscription_count=count or 0)


@router.get("/subscriptions", response_model=list[schemas.PushSubscriptionRead])
def list_subscriptions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.PushSubscriptionRead]:
    subscriptions = db.scalars(select(models.PushSubscription).where(
        models.PushSubscription.user_id == current_user.id,
        models.PushSubscription.revoked_at.is_(None),
    ).order_by(models.PushSubscription.created_at.desc(), models.PushSubscription.id)).all()
    return [schemas.PushSubscriptionRead(**push_service.subscription_metadata(subscription)) for subscription in subscriptions]


@router.delete("/subscriptions", status_code=204, response_class=Response)
def revoke_all_subscriptions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    db.execute(update(models.PushSubscription).where(
        models.PushSubscription.user_id == current_user.id,
        models.PushSubscription.revoked_at.is_(None),
    ).values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    return Response(status_code=204)


@router.delete("/subscriptions/{subscription_id}", status_code=204, response_class=Response)
def revoke_device(
    subscription_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    # Missing, foreign, and previously revoked ids intentionally share an
    # idempotent result and never reveal another account's device inventory.
    db.execute(update(models.PushSubscription).where(
        models.PushSubscription.id == subscription_id,
        models.PushSubscription.user_id == current_user.id,
        models.PushSubscription.revoked_at.is_(None),
    ).values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    return Response(status_code=204)


@router.post("/subscribe", response_model=schemas.PushSubscriptionRead)
def subscribe(
    payload: schemas.PushSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.PushSubscriptionRead:
    if not push_service.configuration_status()["configured"]:
        raise HTTPException(status_code=503, detail="Push notifications are not configured correctly")
    subscription = push_service.save_subscription(
        db,
        user_id=str(current_user.id),
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=payload.user_agent,
        device_label=payload.device_label,
    )
    db.commit()
    return schemas.PushSubscriptionRead(**push_service.subscription_metadata(subscription))


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def unsubscribe(
    payload: schemas.PushSubscriptionDelete,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    revoked = push_service.revoke_subscription(db, user_id=str(current_user.id), endpoint=payload.endpoint)
    if revoked:
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test", response_model=schemas.PushTestResult)
def test_notification(
    payload: schemas.PushTestRequest | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.PushTestResult:
    if not push_service.configuration_status()["configured"]:
        raise HTTPException(status_code=503, detail="Push notifications are not configured correctly")
    subscription_id = payload.subscription_id if payload else None
    if subscription_id and not db.scalar(select(models.PushSubscription.id).where(
        models.PushSubscription.id == subscription_id,
        models.PushSubscription.user_id == current_user.id,
        models.PushSubscription.revoked_at.is_(None),
    )):
        raise HTTPException(status_code=404, detail="Active push device not found")
    result = push_service.send_push_result(
        db,
        user_ids=[str(current_user.id)],
        subscription_id=subscription_id,
        payload={
            "title": "ZeaPlay Push Test",
            "body": "Your ZeaPlay test notification has arrived.",
            "url": "/#/settings?tab=push",
            "icon": None,
            "badge": None,
            "module": "users",
            "event_type": "push.test",
        },
    )
    db.commit()
    return schemas.PushTestResult(delivered=result.accepted, **asdict(result))
