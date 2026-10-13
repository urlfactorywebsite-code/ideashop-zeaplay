from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..avatar_utils import (
    avatar_public_url,
    create_avatar_asset_from_data_url,
    remove_avatar_asset_file,

    save_data_url_to_subdir,
)
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_owner

router = APIRouter(prefix="/avatars", tags=["avatars"])


def _decorate_asset(asset: models.AvatarAsset) -> models.AvatarAsset:
    asset.url = avatar_public_url(asset)
    return asset


@router.get("", response_model=list[schemas.AvatarAssetRead])
def list_avatars(
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> list[schemas.AvatarAssetRead]:
    stmt = select(models.AvatarAsset)
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        stmt = stmt.where(
            or_(
                models.AvatarAsset.is_default.is_(True),
                models.AvatarAsset.created_by_id == current_user.id,
            )
        )

    assets = db.execute(stmt).scalars().all()
    return [_decorate_asset(asset) for asset in assets]


@router.post("", response_model=schemas.AvatarAssetRead, status_code=status.HTTP_201_CREATED)
def create_avatar_asset(
    payload: schemas.AvatarAssetCreate,
    current_user: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> schemas.AvatarAssetRead:
    if payload.storage_type == models.AvatarStorageTypeEnum.DATA_URL:
        if not payload.data_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="data_url is required")
        asset = create_avatar_asset_from_data_url(
            db,
            payload.data_url,
            creator_id=current_user.id,
            name=payload.name,
            is_default=True,
            subdir="library",
        )
    elif payload.storage_type == models.AvatarStorageTypeEnum.EXTERNAL_URL:
        if not payload.external_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="external_url is required")
        asset = models.AvatarAsset(
            name=payload.name,
            storage_type=models.AvatarStorageTypeEnum.EXTERNAL_URL,
            external_url=payload.external_url,
            is_default=True,
            created_by_id=current_user.id,
        )
        db.add(asset)
        db.flush()
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File uploads must be provided as base64 data URLs.",
        )

    db.commit()
    db.refresh(asset)
    return _decorate_asset(asset)


@router.patch("/{avatar_id}", response_model=schemas.AvatarAssetRead)
def update_avatar_asset(
    avatar_id: str,
    payload: schemas.AvatarAssetUpdate,
    current_user: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> schemas.AvatarAssetRead:
    asset = db.get(models.AvatarAsset, avatar_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar asset not found")

    if payload.name is not None:
        asset.name = payload.name

    if payload.data_url:
        if asset.file_path:
            remove_avatar_asset_file(asset)
        relative_path, mime_type = save_data_url_to_subdir(payload.data_url, subdir="library")
        asset.storage_type = models.AvatarStorageTypeEnum.FILE
        asset.file_path = relative_path
        asset.mime_type = mime_type
        asset.data_url = None
        asset.external_url = None
    elif payload.external_url is not None:
        if asset.file_path:
            remove_avatar_asset_file(asset)
        asset.storage_type = models.AvatarStorageTypeEnum.EXTERNAL_URL
        asset.external_url = payload.external_url
        asset.file_path = None
        asset.mime_type = None
        asset.data_url = None

    db.commit()
    db.refresh(asset)
    return _decorate_asset(asset)


@router.delete("/{avatar_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar_asset(
    avatar_id: str,
    current_user: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> None:
    asset = db.get(models.AvatarAsset, avatar_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar asset not found")
    if asset.created_by_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Default avatars cannot be removed")

    if asset.file_path:
        remove_avatar_asset_file(asset)

    db.delete(asset)
    db.commit()
