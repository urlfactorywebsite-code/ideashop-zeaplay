from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
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


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def subscribe(
    payload: schemas.PushSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    if not payload.endpoint or not payload.keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid subscription payload")
    push_service.save_subscription(
        db,
        user_id=str(current_user.id),
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=payload.user_agent,
        device_label=payload.device_label,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def unsubscribe(
    payload: schemas.PushSubscriptionDelete,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    revoked = push_service.revoke_subscription(db, endpoint=payload.endpoint)
    if revoked:
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test", response_model=schemas.PushTestResult)
def test_notification(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.PushTestResult:
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    delivered = push_service.send_push(
        db,
        user_ids=[str(current_user.id)],
        payload={
            "title": "ZeaPlay Push Test",
            "body": "Push notifications are active on this device.",
            "url": "/settings",
            "icon": None,
            "badge": None,
            "module": "users",
            "event_type": "push.test",
        },
    )
    db.commit()
    return schemas.PushTestResult(delivered=delivered)
