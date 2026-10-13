"""Business logic for the Rewards module."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from math import ceil
from threading import Lock
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..config import get_settings
from . import notifications as notification_service
from .reward_storage import StorageService

settings = get_settings()

DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50
_reward_balance_registry_lock = Lock()
_reward_balance_locks: dict[str, Lock] = {}


@contextmanager
def _reward_balance_lock(user_id: str):
    with _reward_balance_registry_lock:
        lock = _reward_balance_locks.setdefault(user_id, Lock())
    with lock:
        yield


def _utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp for all reward service writes/comparisons."""
    return datetime.now(timezone.utc)


def _ensure_aware_utc(value: Optional[datetime]) -> Optional[datetime]:
    """
    Normalize reward datetimes before Python-side comparisons.

    Older rows or clients may still provide naive datetimes. Treat those values as
    UTC so existing reward records remain claimable/checkable without raising
    "can't compare offset-naive and offset-aware datetimes".
    """
    if value is None:
        return None
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _paginate(page: int = 1, page_size: int = DEFAULT_PAGE_SIZE) -> Tuple[int, int]:
    page = max(1, page or 1)
    page_size = max(1, min(page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
    return page, page_size


def _icon_lookup(db: Session) -> Dict[str, models.RewardIcon]:
    icons = db.execute(select(models.RewardIcon)).scalars().all()
    return {icon.key: icon for icon in icons}


def _image_url(reward: models.Reward, icon_map: Dict[str, models.RewardIcon]) -> Optional[str]:
    if reward.image_source == models.RewardImageSourceEnum.UPLOAD and reward.image_ref:
        return f"{settings.media_public_base.rstrip('/')}/{reward.image_ref}"
    if reward.image_source == models.RewardImageSourceEnum.LIBRARY and reward.image_ref:
        icon = icon_map.get(reward.image_ref)
        if icon:
            return icon.url
    return None


def _serialize_reward(reward: models.Reward, icon_map: Dict[str, models.RewardIcon]) -> schemas.RewardRead:
    return schemas.RewardRead(
        id=reward.id,
        title=reward.title,
        description=reward.description,
        image_source=reward.image_source,
        image_ref=reward.image_ref,
        xp_required=reward.xp_required,
        dept_whitelist=(list(reward.dept_whitelist or []) or None),
        auto_redeem=reward.auto_redeem,
        allow_multiple_claims=reward.allow_multiple_claims,
        expires_at=_ensure_aware_utc(reward.expires_at),
        status=reward.status,
        created_at=reward.created_at,
        updated_at=reward.updated_at,
        created_by_id=reward.created_by_id,
        updated_by_id=reward.updated_by_id,
        image_url=_image_url(reward, icon_map),
    )


def _serialize_claim(
    claim: models.RewardClaim,
    icon_map: Dict[str, models.RewardIcon],
    *,
    reward: Optional[models.Reward] = None,
    user: Optional[models.User] = None,
) -> schemas.RewardClaimRead:
    claim_reward = reward or claim.reward
    claim_user = user or claim.user
    return schemas.RewardClaimRead(
        id=claim.id,
        reward_id=claim.reward_id,
        user_id=claim.user_id,
        status=claim.status,
        xp_spent=claim.xp_spent,
        claimed_at=claim.claimed_at,
        resolved_at=claim.resolved_at,
        approver_id=claim.approver_id,
        reward=_serialize_reward(claim_reward, icon_map),
        user=schemas.RewardClaimUser(
            id=claim_user.id,
            name=claim_user.name,
            email=claim_user.email,
            role=claim_user.role,
            department_id=claim_user.department_id,
        ),
    )


def _log_action(
    db: Session,
    *,
    reward: models.Reward,
    action: models.RewardLogActionEnum,
    actor_id: Optional[str],
    meta: Optional[dict] = None,
) -> None:
    db.add(
        models.RewardLog(
            actor_id=actor_id,
            subject_type="reward",
            subject_id=reward.id,
            action=action,
            meta=meta or {},
        )
    )


def mark_expired_rewards(db: Session) -> int:
    now = _utc_now()
    expired = (
        db.query(models.Reward)
        .filter(
            models.Reward.status == models.RewardStatusEnum.ACTIVE,
            models.Reward.expires_at.is_not(None),
            models.Reward.expires_at <= now,
        )
        .options(joinedload(models.Reward.claims))
        .all()
    )
    for reward in expired:
        reward.status = models.RewardStatusEnum.EXPIRED
        reward.updated_at = now
        _log_action(db, reward=reward, action=models.RewardLogActionEnum.EXPIRED, actor_id=None)
        if reward.image_source == models.RewardImageSourceEnum.UPLOAD and reward.image_ref:
            StorageService.delete(reward.image_ref)
            _log_action(
                db,
                reward=reward,
                action=models.RewardLogActionEnum.IMAGE_DELETED,
                actor_id=None,
                meta={"reason": "expired"},
            )
            reward.image_ref = None
    if expired:
        db.flush()
    return len(expired)


def list_reward_icons(db: Session) -> List[schemas.RewardIconRead]:
    icons = db.execute(select(models.RewardIcon).order_by(models.RewardIcon.label.asc())).scalars().all()
    return [schemas.RewardIconRead.model_validate(icon) for icon in icons]


def list_rewards(
    db: Session,
    *,
    tab: str = "active",
    q: Optional[str] = None,
    dept: Optional[str] = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> schemas.RewardListResponse:
    mark_expired_rewards(db)
    page, page_size = _paginate(page, page_size)

    query = db.query(models.Reward)
    if tab == "expired":
        query = query.filter(models.Reward.status == models.RewardStatusEnum.EXPIRED)
    else:
        query = query.filter(models.Reward.status == models.RewardStatusEnum.ACTIVE)

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(models.Reward.title.ilike(like))

    if dept:
        query = query.filter(
            or_(
                models.Reward.dept_whitelist.is_(None),
                models.Reward.dept_whitelist.contains([dept]),
            )
        )

    total = query.count()
    rewards = (
        query.order_by(models.Reward.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    icon_map = _icon_lookup(db)
    items = [_serialize_reward(reward, icon_map) for reward in rewards]
    total_pages = ceil(total / page_size) if total else 1
    return schemas.RewardListResponse(
        items=items,
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )


def get_reward(db: Session, reward_id: str) -> models.Reward:
    reward = db.get(models.Reward, reward_id)
    if not reward:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reward not found")
    return reward


def get_reward_read(db: Session, reward_id: str) -> schemas.RewardRead:
    reward = get_reward(db, reward_id)
    icon_map = _icon_lookup(db)
    return _serialize_reward(reward, icon_map)


def _ensure_icon(db: Session, icon_key: str) -> None:
    exists = db.query(models.RewardIcon).filter(models.RewardIcon.key == icon_key).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown reward icon key")


def create_reward(
    db: Session,
    *,
    payload: schemas.RewardCreate,
    actor: models.User,
) -> schemas.RewardRead:
    if payload.image_source == models.RewardImageSourceEnum.LIBRARY:
        if not payload.image_ref:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Icon key is required")
        _ensure_icon(db, payload.image_ref)
    elif payload.image_source == models.RewardImageSourceEnum.UPLOAD and not payload.image_ref:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload reference missing")

    reward = models.Reward(
        title=payload.title,
        description=payload.description,
        image_source=payload.image_source,
        image_ref=payload.image_ref,
        xp_required=payload.xp_required,
        dept_whitelist=list(payload.dept_whitelist or []),
        auto_redeem=payload.auto_redeem,
        allow_multiple_claims=payload.allow_multiple_claims,
        expires_at=_ensure_aware_utc(payload.expires_at),
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    db.add(reward)
    db.flush()
    _log_action(db, reward=reward, action=models.RewardLogActionEnum.CREATED, actor_id=actor.id)
    db.commit()
    db.refresh(reward)
    icon_map = _icon_lookup(db)
    return _serialize_reward(reward, icon_map)


def update_reward(
    db: Session,
    *,
    reward_id: str,
    payload: schemas.RewardUpdate,
    actor: models.User,
) -> schemas.RewardRead:
    reward = get_reward(db, reward_id)
    previous_image_ref = reward.image_ref if reward.image_source == models.RewardImageSourceEnum.UPLOAD else None
    previous_image_source = reward.image_source

    if payload.title is not None:
        reward.title = payload.title
    if payload.description is not None:
        reward.description = payload.description
    if payload.image_source is not None:
        reward.image_source = payload.image_source
    if payload.image_ref is not None:
        reward.image_ref = payload.image_ref
    if payload.xp_required is not None:
        reward.xp_required = payload.xp_required
    if payload.dept_whitelist is not None:
        reward.dept_whitelist = list(payload.dept_whitelist or [])
    if payload.auto_redeem is not None:
        reward.auto_redeem = payload.auto_redeem
    if payload.allow_multiple_claims is not None:
        reward.allow_multiple_claims = payload.allow_multiple_claims
    if payload.expires_at is not None:
        reward.expires_at = _ensure_aware_utc(payload.expires_at)

    reward.updated_by_id = actor.id
    db.add(reward)

    if (
        previous_image_source == models.RewardImageSourceEnum.UPLOAD
        and previous_image_ref
        and (reward.image_source != models.RewardImageSourceEnum.UPLOAD or reward.image_ref != previous_image_ref)
    ):
        StorageService.delete(previous_image_ref)
        _log_action(
            db,
            reward=reward,
            action=models.RewardLogActionEnum.IMAGE_DELETED,
            actor_id=actor.id,
            meta={"reason": "image-updated"},
        )

    _log_action(db, reward=reward, action=models.RewardLogActionEnum.EDITED, actor_id=actor.id)
    db.commit()
    db.refresh(reward)
    icon_map = _icon_lookup(db)
    return _serialize_reward(reward, icon_map)


def delete_reward(db: Session, *, reward_id: str, actor: models.User) -> None:
    reward = get_reward(db, reward_id)
    if reward.status == models.RewardStatusEnum.DELETED:
        return
    reward.status = models.RewardStatusEnum.DELETED
    reward.updated_by_id = actor.id
    db.add(reward)
    if reward.image_source == models.RewardImageSourceEnum.UPLOAD and reward.image_ref:
        StorageService.delete(reward.image_ref)
        reward.image_ref = None
        _log_action(
            db,
            reward=reward,
            action=models.RewardLogActionEnum.IMAGE_DELETED,
            actor_id=actor.id,
            meta={"reason": "deleted"},
        )
    _log_action(db, reward=reward, action=models.RewardLogActionEnum.DELETED, actor_id=actor.id)
    db.commit()


def force_expire_reward(db: Session, *, reward_id: str, actor: models.User) -> schemas.RewardRead:
    reward = get_reward(db, reward_id)
    reward.expires_at = _utc_now()
    reward.status = models.RewardStatusEnum.EXPIRED
    reward.updated_by_id = actor.id
    db.add(reward)
    _log_action(db, reward=reward, action=models.RewardLogActionEnum.EXPIRED, actor_id=actor.id)
    if reward.image_source == models.RewardImageSourceEnum.UPLOAD and reward.image_ref:
        StorageService.delete(reward.image_ref)
        reward.image_ref = None
        _log_action(
            db,
            reward=reward,
            action=models.RewardLogActionEnum.IMAGE_DELETED,
            actor_id=actor.id,
            meta={"reason": "expired"},
        )
    db.commit()
    db.refresh(reward)
    icon_map = _icon_lookup(db)
    return _serialize_reward(reward, icon_map)


def clear_expired_rewards(db: Session, *, actor: models.User) -> int:
    expired = db.query(models.Reward).filter(models.Reward.status == models.RewardStatusEnum.EXPIRED).all()
    count = 0
    for reward in expired:
        if reward.image_source == models.RewardImageSourceEnum.UPLOAD and reward.image_ref:
            StorageService.delete(reward.image_ref)
            _log_action(
                db,
                reward=reward,
                action=models.RewardLogActionEnum.IMAGE_DELETED,
                actor_id=actor.id,
                meta={"reason": "clear-expired"},
            )
        _log_action(db, reward=reward, action=models.RewardLogActionEnum.DELETED, actor_id=actor.id)
        db.delete(reward)
        count += 1
    db.commit()
    return count


def _assert_reward_claimable(reward: models.Reward, user: models.User) -> None:
    if reward.status != models.RewardStatusEnum.ACTIVE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reward not active")
    expires_at = _ensure_aware_utc(reward.expires_at)
    if expires_at and expires_at <= _utc_now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reward expired")
    if user.points < reward.xp_required:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="XP requirement not met")
    if reward.dept_whitelist and user.department_id not in set(reward.dept_whitelist):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department not eligible")


def claim_reward(
    db: Session,
    *,
    reward_id: str,
    user: models.User,
) -> schemas.RewardClaimRead:
    with _reward_balance_lock(user.id):
        locked_user = db.execute(
            select(models.User)
            .where(models.User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()
        reward = get_reward(db, reward_id)
        _assert_reward_claimable(reward, locked_user)
        existing = (
            db.query(models.RewardClaim)
            .filter(models.RewardClaim.reward_id == reward_id, models.RewardClaim.user_id == locked_user.id)
            .first()
        )
        if existing and not reward.allow_multiple_claims:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Reward already claimed")

        status_value = (
            models.RewardClaimStatusEnum.REDEEMED
            if reward.auto_redeem
            else models.RewardClaimStatusEnum.PENDING
        )
        resolved_at = _utc_now() if status_value == models.RewardClaimStatusEnum.REDEEMED else None
        claim = models.RewardClaim(
            reward_id=reward_id,
            user_id=locked_user.id,
            status=status_value,
            xp_spent=reward.xp_required,
            resolved_at=resolved_at,
        )
        locked_user.points = max((locked_user.points or 0) - claim.xp_spent, 0)
        db.add(locked_user)
        if not reward.allow_multiple_claims and reward.id not in (locked_user.claimed_reward_ids or []):
            locked_user.claimed_reward_ids = [*(locked_user.claimed_reward_ids or []), reward.id]
        db.add(claim)
        try:
            db.flush()
        except IntegrityError as exc:  # pragma: no cover - race with constraint
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Reward already claimed") from exc

        _log_action(
            db,
            reward=reward,
            action=models.RewardLogActionEnum.CLAIMED,
            actor_id=locked_user.id,
            meta={"user_id": locked_user.id},
        )
        if reward.auto_redeem:
            _log_action(
                db,
                reward=reward,
                action=models.RewardLogActionEnum.AUTO_REDEEMED,
                actor_id=locked_user.id,
                meta={"user_id": locked_user.id},
            )
        notification_service.create_notification(
            db,
            user_id=locked_user.id,
            notification_type=models.NotificationTypeEnum.REWARD_CLAIMED,
            title="Reward claimed",
            message=f"You claimed {reward.title}.",
            body=f"{claim.xp_spent} XP was redeemed from your balance.",
            entity_type=models.NotificationEntityTypeEnum.USER,
            entity_id=locked_user.id,
            deep_link="/achievements",
            related_reward_id=reward.id,
            actor_id=locked_user.id,
        )
        db.commit()
        db.refresh(claim)
        db.refresh(locked_user)
        icon_map = _icon_lookup(db)
        db.refresh(reward)

        return _serialize_claim(claim, icon_map, reward=reward, user=locked_user)


def list_claims(
    db: Session,
    *,
    status_filter: Optional[models.RewardClaimStatusEnum] = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> schemas.RewardClaimListResponse:
    page, page_size = _paginate(page, page_size)
    query = (
        db.query(models.RewardClaim)
        .options(joinedload(models.RewardClaim.reward), joinedload(models.RewardClaim.user))
        .order_by(models.RewardClaim.claimed_at.desc())
    )
    if status_filter:
        query = query.filter(models.RewardClaim.status == status_filter)
    total = query.count()
    claims = query.offset((page - 1) * page_size).limit(page_size).all()
    icon_map = _icon_lookup(db)
    items = [_serialize_claim(claim, icon_map) for claim in claims]
    total_pages = ceil(total / page_size) if total else 1
    return schemas.RewardClaimListResponse(
        items=items,
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )


def _resolve_claim(
    claim: models.RewardClaim,
    *,
    new_status: models.RewardClaimStatusEnum,
    actor: models.User,
) -> None:
    claim.status = new_status
    claim.approver_id = actor.id
    claim.resolved_at = _utc_now()


def approve_claim(db: Session, *, claim_id: str, actor: models.User) -> schemas.RewardClaimRead:
    claim = db.get(models.RewardClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    if claim.status != models.RewardClaimStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Claim already resolved")
    _resolve_claim(claim, new_status=models.RewardClaimStatusEnum.REDEEMED, actor=actor)
    db.add(claim)
    reward = get_reward(db, claim.reward_id)
    _log_action(
        db,
        reward=reward,
        action=models.RewardLogActionEnum.APPROVED,
        actor_id=actor.id,
        meta={"claim_id": claim.id},
    )
    _log_action(
        db,
        reward=reward,
        action=models.RewardLogActionEnum.CLAIMED,
        actor_id=claim.user_id,
        meta={"claim_id": claim.id},
    )
    db.commit()
    db.refresh(claim)
    icon_map = _icon_lookup(db)
    return _serialize_claim(claim, icon_map, reward=reward)


def reject_claim(db: Session, *, claim_id: str, actor: models.User) -> schemas.RewardClaimRead:
    claim = db.get(models.RewardClaim, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    if claim.status != models.RewardClaimStatusEnum.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Claim already resolved")
    _resolve_claim(claim, new_status=models.RewardClaimStatusEnum.REJECTED, actor=actor)
    db.add(claim)
    reward = get_reward(db, claim.reward_id)
    claimant = claim.user
    claimant.points = (claimant.points or 0) + claim.xp_spent
    db.add(claimant)
    if reward.id in (claimant.claimed_reward_ids or []):
        claimant.claimed_reward_ids = [reward_id for reward_id in claimant.claimed_reward_ids if reward_id != reward.id]
    _log_action(
        db,
        reward=reward,
        action=models.RewardLogActionEnum.REJECTED,
        actor_id=actor.id,
        meta={"claim_id": claim.id},
    )
    db.commit()
    db.refresh(claim)
    icon_map = _icon_lookup(db)
    return _serialize_claim(claim, icon_map, reward=reward)


def list_logs(
    db: Session,
    *,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    action: Optional[models.RewardLogActionEnum] = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> schemas.RewardLogListResponse:
    page, page_size = _paginate(page, page_size)
    query = db.query(models.RewardLog).order_by(models.RewardLog.created_at.desc())
    if subject_type:
        query = query.filter(models.RewardLog.subject_type == subject_type)
    if subject_id:
        query = query.filter(models.RewardLog.subject_id == subject_id)
    if action:
        query = query.filter(models.RewardLog.action == action)

    total = query.count()
    logs = query.offset((page - 1) * page_size).limit(page_size).all()
    items = [
        schemas.RewardLogRead(
            id=log.id,
            actor_id=log.actor_id,
            subject_type=log.subject_type,
            subject_id=log.subject_id,
            action=log.action,
            meta=log.meta or {},
            created_at=log.created_at,
        )
        for log in logs
    ]
    total_pages = ceil(total / page_size) if total else 1
    return schemas.RewardLogListResponse(
        items=items,
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )
