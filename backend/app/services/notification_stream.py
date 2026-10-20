"""Authenticated notification invalidation across workers, without holding DB connections."""
import asyncio
import logging

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .. import models
from ..auth import credentials_match
from ..dependencies import _decode_access_token, _extract_user_id

logger = logging.getLogger(__name__)
POLL_SECONDS = 1
HEARTBEAT_TICKS = 15
MAX_TICKS = 300


def notification_snapshot(bind, *, token, user_id, tenant_id):
    # Revalidate on each tick: logout/credential rotation, tenant changes,
    # deactivation and token expiration must end an already-open connection.
    claims = _decode_access_token(token)
    if _extract_user_id(claims) != user_id or str(claims.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=401, detail="Notification session changed")
    with Session(bind=bind) as db:
        user = db.get(models.User, user_id)
        if (not user or user.status != models.UserStatusEnum.ACTIVE
                or str(user.tenant_id) != str(tenant_id) or not credentials_match(user, claims)):
            raise HTTPException(status_code=401, detail="Notification session ended")
        return tuple(db.execute(select(
            func.count(models.Notification.id),
            func.max(models.Notification.created_at),
            func.sum(case((models.Notification.is_read.is_(False), 1), else_=0)),
        ).where(
            models.Notification.user_id == user_id,
            or_(models.Notification.tenant_id == tenant_id, models.Notification.tenant_id.is_(None)),
        )).one())


async def notification_events(request, bind, *, token, user_id, tenant_id):
    previous = None
    # A bounded connection lets browsers pick up refreshed access tokens.
    # Each query opens and releases its own connection; no transaction spans a wait.
    for tick in range(MAX_TICKS):
        if await request.is_disconnected():
            return
        try:
            snapshot = await asyncio.to_thread(
                notification_snapshot, bind, token=token, user_id=user_id, tenant_id=tenant_id,
            )
        except HTTPException:
            return
        except Exception as exc:
            logger.warning("Notification stream interrupted: error_type=%s", type(exc).__name__)
            return
        if snapshot != previous:
            previous = snapshot
            yield 'event: notifications.changed\ndata: {"type":"notifications.changed"}\n\n'
        elif tick % HEARTBEAT_TICKS == 0:
            yield ": keepalive\n\n"
        await asyncio.sleep(POLL_SECONDS)
