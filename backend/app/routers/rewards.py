from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from ..integrations import trigger_n8n_event
from ..services import rewards as reward_service
from ..services.reward_storage import RewardImageService

router = APIRouter(prefix="/rewards", tags=["rewards"])


@router.get("/icons", response_model=list[schemas.RewardIconRead])
def list_icons(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return reward_service.list_reward_icons(db)


@router.get("", response_model=schemas.RewardListResponse)
def list_rewards_endpoint(
    tab: str = Query("active", pattern="^(active|expired)$"),
    q: str | None = Query(default=None, description="Search query"),
    dept: str | None = Query(default=None, description="Department filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    return reward_service.list_rewards(db, tab=tab, q=q, dept=dept, page=page, page_size=page_size)


@router.get("/{reward_id}", response_model=schemas.RewardRead)
def get_reward(
    reward_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    return reward_service.get_reward_read(db, reward_id)


@router.post("", response_model=schemas.RewardRead, status_code=status.HTTP_201_CREATED)
def create_reward(
    payload: schemas.RewardCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    reward = reward_service.create_reward(db, payload=payload, actor=current_user)
    background_tasks.add_task(trigger_n8n_event, "reward.created", reward.model_dump())
    return reward


@router.put("/{reward_id}", response_model=schemas.RewardRead)
def update_reward(
    reward_id: str,
    payload: schemas.RewardUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    reward = reward_service.update_reward(db, reward_id=reward_id, payload=payload, actor=current_user)
    background_tasks.add_task(trigger_n8n_event, "reward.updated", reward.model_dump())
    return reward


@router.delete("/{reward_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reward(
    reward_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    reward_snapshot = reward_service.get_reward_read(db, reward_id)
    reward_service.delete_reward(db, reward_id=reward_id, actor=current_user)
    background_tasks.add_task(trigger_n8n_event, "reward.deleted", reward_snapshot.model_dump())


@router.post("/{reward_id}/expire", response_model=schemas.RewardRead)
def expire_reward(
    reward_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    reward = reward_service.force_expire_reward(db, reward_id=reward_id, actor=current_user)
    background_tasks.add_task(trigger_n8n_event, "reward.expired", reward.model_dump())
    return reward


@router.post("/clear-expired", response_model=dict)
def clear_expired_rewards(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    deleted = reward_service.clear_expired_rewards(db, actor=current_user)
    return {"deleted": deleted}


@router.post("/{reward_id}/claim", response_model=schemas.RewardClaimRead)
def claim_reward(
    reward_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    claim = reward_service.claim_reward(db, reward_id=reward_id, user=current_user)
    background_tasks.add_task(trigger_n8n_event, "reward.claimed", {"claim": claim.model_dump()})
    return claim


def _ensure_owner_or_admin(user: models.User) -> None:
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner or Admin required")


@router.post("/images/upload", response_model=schemas.RewardImageUploadResponse)
async def upload_reward_image(
    file: UploadFile = File(...),
    _: models.User = Depends(get_current_admin),
):
    image_ref, image_url, mime_type, size = await RewardImageService.save_upload(file)
    return schemas.RewardImageUploadResponse(image_ref=image_ref, image_url=image_url, mime_type=mime_type, size=size)


claims_router = APIRouter(prefix="/claims", tags=["reward-claims"])


@claims_router.get("", response_model=schemas.RewardClaimListResponse)
def list_claims(
    status_filter: models.RewardClaimStatusEnum | None = Query(default=models.RewardClaimStatusEnum.PENDING),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    _ensure_owner_or_admin(current_user)
    return reward_service.list_claims(db, status_filter=status_filter, page=page, page_size=page_size)


@claims_router.post("/{claim_id}/approve", response_model=schemas.RewardClaimRead)
def approve_claim(
    claim_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    _ensure_owner_or_admin(current_user)
    return reward_service.approve_claim(db, claim_id=claim_id, actor=current_user)


@claims_router.post("/{claim_id}/reject", response_model=schemas.RewardClaimRead)
def reject_claim(
    claim_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    _ensure_owner_or_admin(current_user)
    return reward_service.reject_claim(db, claim_id=claim_id, actor=current_user)
