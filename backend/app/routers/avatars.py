# FastAPI Depends defaults are declarative dependencies.
# ruff: noqa: B008
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..avatar_utils import (
    _decode_data_url,
    asset_adapter,
    create_avatar_asset_from_data_url,
    maybe_cleanup_custom_avatar,
    normalize_avatar,
    resolve_avatar_asset,
)
from ..config import get_settings
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_owner

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get('/limits')
def avatar_limits(current_user=Depends(get_current_active_user)):
    return {'max_bytes': get_settings().avatar_max_file_size_mb * 1024 * 1024,
            'mime_types': ['image/jpeg', 'image/png', 'image/webp']}


@router.get('', response_model=list[schemas.AvatarAssetRead])
def list_avatars(current_user=Depends(get_current_active_user), db: Session = Depends(get_db)):
    stmt = select(models.AvatarAsset).outerjoin(models.User, models.AvatarAsset.created_by_id == models.User.id).where(or_(
        models.AvatarAsset.tenant_id == current_user.tenant_id,
        (models.AvatarAsset.tenant_id.is_(None) & (models.User.tenant_id == current_user.tenant_id)),
        (models.AvatarAsset.created_by_id.is_(None) & models.AvatarAsset.tenant_id.is_(None) & models.AvatarAsset.is_default.is_(True))))
    stmt = stmt.where(or_(models.AvatarAsset.storage_provider.is_(None), models.AvatarAsset.storage_provider != 'legacy-minio'))
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        stmt = stmt.where(or_(models.AvatarAsset.is_default.is_(True), models.AvatarAsset.created_by_id == current_user.id))
    return list(db.scalars(stmt))


@router.get('/{avatar_id}/image')
def avatar_image(avatar_id: str, size: int = 512, current_user=Depends(get_current_active_user), db: Session = Depends(get_db)):
    asset = resolve_avatar_asset(db, avatar_id, current_user)
    if size not in (128, 512):
        raise HTTPException(400, 'Avatar size must be 128 or 512')
    try:
        if asset.storage_provider:
            binary = asset_adapter(asset).read(asset.thumbnail_path if size == 128 and asset.thumbnail_path else asset.file_path)
        else:
            mime, binary = _decode_data_url(asset.data_url) if asset.data_url else (asset.mime_type, asset_adapter(asset).read(asset.file_path))
            binary = normalize_avatar(binary, mime)[0 if size == 512 else 1]
    except (OSError, TypeError, ValueError) as exc:
        raise HTTPException(404, 'Avatar image unavailable') from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, 'Avatar storage temporarily unavailable') from exc
    return Response(binary, media_type='image/webp', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('', response_model=schemas.AvatarAssetRead, status_code=201)
def create_avatar_asset(payload: schemas.AvatarAssetCreate, current_user=Depends(get_current_owner), db: Session = Depends(get_db)):
    if not payload.data_url:
        raise HTTPException(400, 'Upload a JPEG, PNG, or WebP image')
    asset = create_avatar_asset_from_data_url(db, payload.data_url, creator_id=current_user.id, name=payload.name, is_default=True)
    db.commit()
    db.refresh(asset)
    return asset


@router.patch('/{avatar_id}', response_model=schemas.AvatarAssetRead)
def update_avatar_asset(avatar_id: str, payload: schemas.AvatarAssetUpdate, current_user=Depends(get_current_owner), db: Session = Depends(get_db)):
    asset = resolve_avatar_asset(db, avatar_id, current_user, for_update=True)
    if not asset.created_by_id and not asset.tenant_id:
        raise HTTPException(403, 'Built-in avatars cannot be changed')
    if payload.external_url is not None:
        raise HTTPException(400, 'Upload a JPEG, PNG, or WebP image')
    if payload.data_url:
        replacement = create_avatar_asset_from_data_url(db, payload.data_url,
            creator_id=current_user.id, name=asset.name)
        # Swap storage metadata, retaining the assigned library ID. The temporary
        # record now owns the old files and is collected only after commit.
        for field in ('file_path', 'thumbnail_path', 'storage_provider', 'mime_type', 'data_url', 'external_url', 'storage_type'):
            old = getattr(asset, field)
            setattr(asset, field, getattr(replacement, field))
            setattr(replacement, field, old)
        maybe_cleanup_custom_avatar(db, replacement)
    if payload.name is not None:
        asset.name = payload.name
    db.commit()
    return asset


@router.delete('/{avatar_id}', status_code=204)
def delete_avatar_asset(avatar_id: str, current_user=Depends(get_current_owner), db: Session = Depends(get_db)):
    asset = resolve_avatar_asset(db, avatar_id, current_user, for_update=True)
    if not asset.created_by_id and not asset.tenant_id:
        raise HTTPException(400, 'Built-in avatars cannot be removed')
    if db.scalar(select(models.User.id).where(models.User.avatar_asset_id == avatar_id).limit(1)):
        raise HTTPException(409, 'Avatar is still in use')
    asset.is_default = False
    maybe_cleanup_custom_avatar(db, asset)
    db.commit()
