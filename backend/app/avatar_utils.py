from __future__ import annotations

import base64
import logging
import math
import re
import warnings
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from . import models
from .config import get_settings
from .storage.local import LocalAdapter

logger = logging.getLogger(__name__)
AVATAR_LIBRARY_DIR = Path("assets/avatars")
MIME_FORMAT_MAP = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}


def ensure_avatar_dirs():
    AVATAR_LIBRARY_DIR.mkdir(parents=True, exist_ok=True)


def can_access_asset(asset, actor):
    if asset.storage_provider == 'legacy-minio':
        return False
    tenant = asset.tenant_id or (asset.creator.tenant_id if asset.creator else None)
    return tenant == actor.tenant_id or (tenant is None and asset.is_default and asset.created_by_id is None)


def resolve_avatar_asset(db, avatar_asset_id, actor=None, *, for_update=False):
    if avatar_asset_id is None:
        return None
    statement = select(models.AvatarAsset).where(models.AvatarAsset.id == avatar_asset_id)
    if for_update:
        statement = statement.with_for_update()
    asset = db.scalar(statement.execution_options(populate_existing=True))
    if not asset or asset.storage_provider == 'legacy-minio' or (actor and not can_access_asset(asset, actor)):
        raise HTTPException(404, "Avatar asset not found")
    return asset


def avatar_public_url(asset):
    if not asset:
        return None
    # Only the ten shipped, immutable SVG assets bypass raster normalization.
    match = re.fullmatch(r'avatar-default-(0[1-9]|10)', asset.id or '')
    if (match and asset.is_default and not asset.created_by_id and not asset.tenant_id
            and not asset.storage_provider and asset.file_path == f'avatars/library/default-avatar-{match[1]}.svg'):
        return f'/assets/{asset.file_path}'
    if asset.file_path or asset.data_url:
        version = asset.updated_at.isoformat() if asset.updated_at else asset.id
        return f"/api/avatars/{asset.id}/image?v={version}"
    if asset.external_url and asset.external_url.startswith('https://'):
        return asset.external_url
    return None


def _decode_data_url(data_url):
    limit = get_settings().avatar_max_file_size_mb * 1024 * 1024
    if len(data_url) > ((limit + 2) // 3) * 4 + 64:
        raise HTTPException(413, "Avatar exceeds the configured file size limit")
    match = re.fullmatch(r"data:(image/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)", data_url)
    if not match or match[1] not in MIME_FORMAT_MAP:
        raise HTTPException(400, "Use a JPEG, PNG, or WebP image")
    try:
        binary = base64.b64decode(match[2], validate=True)
    except ValueError as exc:
        raise HTTPException(400, "Invalid image encoding") from exc
    if len(binary) > limit:
        raise HTTPException(413, "Avatar exceeds the configured file size limit")
    return match[1], binary


def decode_image(binary, mime_type):
    limit = get_settings().avatar_max_file_size_mb * 1024 * 1024
    if not binary or len(binary) > limit:
        raise HTTPException(413, "Avatar exceeds the configured file size limit")
    # Pillow recognizes the file signature, then verify and load validate the full stream.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(binary), formats=["JPEG", "PNG", "WEBP"]) as probe:
                if probe.format != MIME_FORMAT_MAP.get(mime_type):
                    raise HTTPException(400, "Image signature does not match its MIME type")
                if min(probe.size) < 32 or max(probe.size) > 10000 or probe.width * probe.height > get_settings().avatar_max_pixels:
                    raise HTTPException(400, "Avatar dimensions must be at least 32 pixels and within the configured pixel limit")
                if getattr(probe, 'n_frames', 1) != 1:
                    raise HTTPException(400, "Animated avatars are not supported")
                probe.verify()
            with Image.open(BytesIO(binary), formats=["JPEG", "PNG", "WEBP"]) as source:
                source.load()
                image = ImageOps.exif_transpose(source).convert('RGB' if source.mode == 'RGB' else 'RGBA')
                image.info.clear()
                return image
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(400, "Invalid or unsafe image data") from exc


def normalize_avatar(binary, mime_type, crop=None):
    image = decode_image(binary, mime_type)
    if crop:
        values = [crop.get(k, 0) for k in ('x', 'y', 'width', 'height')]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
            raise HTTPException(400, "Invalid crop area")
        x, y, width, height = values
        if x < 0 or y < 0 or width < 1 or height < 1 or x + width > image.width + 1 or y + height > image.height + 1:
            raise HTTPException(400, "Crop is outside the image")
        box = (round(x), round(y), min(image.width, round(x + width)), min(image.height, round(y + height)))
        if box[2] <= box[0] or box[3] <= box[1]:
            raise HTTPException(400, 'Crop must contain image pixels')
        image = image.crop(box)
    variants = []
    for size in (512, 128):
        output = BytesIO()
        ImageOps.fit(image, (size, size), method=Image.Resampling.LANCZOS).save(output, 'WEBP', quality=85, method=4)
        variants.append(output.getvalue())
    return variants


def asset_adapter(asset):
    if not asset.storage_provider:
        return LocalAdapter('assets', '/assets')
    from .services.media_service import get_adapter
    return get_adapter(models.StorageProviderEnum(asset.storage_provider))


def remove_avatar_asset_file(asset):
    if asset.storage_provider == 'legacy-minio':
        from .storage.minio import get_minio_client
        client = get_minio_client()
        for path in (asset.file_path, asset.thumbnail_path):
            if path:
                client.delete_object(Bucket=get_settings().minio_bucket_attachments, Key=path)
        return
    adapter = asset_adapter(asset)
    for path in (asset.file_path, asset.thumbnail_path):
        if path:
            adapter.delete(path)


def cleanup_unused_avatar(db, asset_id):
    asset = db.scalar(select(models.AvatarAsset).where(models.AvatarAsset.id == asset_id).with_for_update())
    if not asset or asset.is_default:
        return
    if db.scalar(select(models.User.id).where(models.User.avatar_asset_id == asset_id).limit(1)):
        return
    remove_avatar_asset_file(asset)
    db.delete(asset)


@event.listens_for(Session, 'after_commit')
def _cleanup_after_commit(db):
    if db.in_nested_transaction():
        return
    db.info.pop('new_avatar_files', None)
    for asset_id in db.info.pop('unused_avatar_ids', set()):
        try:
            with Session(db.get_bind()) as cleanup:
                cleanup_unused_avatar(cleanup, asset_id)
                cleanup.commit()
        except Exception:  # noqa: BLE001 - storage failure must not undo a committed profile
            # Keep the unreferenced asset row so maintenance can retry safely.
            logger.warning('Avatar cleanup deferred for asset %s', asset_id)


@event.listens_for(Session, 'after_rollback')
def _cleanup_after_rollback(db):
    if db.in_nested_transaction():
        return
    db.info.pop('unused_avatar_ids', None)
    for adapter, path, _transaction in db.info.pop('new_avatar_files', []):
        try:
            adapter.delete(path)
        except Exception:  # noqa: BLE001 - best-effort cleanup after a failed transaction
            logger.warning('Rollback avatar file cleanup failed')


@event.listens_for(Session, 'after_soft_rollback')
def _cleanup_savepoint_rollback(db, previous_transaction):
    if not previous_transaction.nested:
        return
    remaining = []
    for adapter, path, transaction in db.info.pop('new_avatar_files', []):
        ancestor = transaction
        while ancestor and ancestor is not previous_transaction:
            ancestor = ancestor.parent
        if ancestor is None:
            remaining.append((adapter, path, transaction))
            continue
        try:
            adapter.delete(path)
        except Exception:  # noqa: BLE001 - retry on outer rollback/session close
            remaining.append((adapter, path, transaction))
            logger.warning('Savepoint avatar file cleanup deferred')
    db.info['new_avatar_files'] = remaining


@event.listens_for(Session, 'after_transaction_end')
def _cleanup_abandoned_transaction(db, transaction):
    # Session.close() can roll back without firing the explicit after_rollback
    # event. A successful commit already cleared these staged paths.
    if transaction.parent is None and db.info.get('new_avatar_files'):
        _cleanup_after_rollback(db)


def maybe_cleanup_custom_avatar(db, asset, user_id=None):
    if asset and not asset.is_default:
        db.info.setdefault('unused_avatar_ids', set()).add(asset.id)


def create_avatar_asset_from_data_url(db, data_url, *, creator_id, name='Custom upload', is_default=False, subdir='custom', crop=None):
    from .services.media_service import get_default_adapter
    mime_type, binary = _decode_data_url(data_url)
    display, thumbnail = normalize_avatar(binary, mime_type, crop)
    creator = db.get(models.User, creator_id)
    adapter = get_default_adapter()
    asset_id = str(uuid4())
    prefix = f'.avatars/{creator.tenant_id}/{asset_id}'
    paths = [prefix + '/display.webp', prefix + '/thumbnail.webp']
    saved = []
    try:
        for path, contents in zip(paths, (display, thumbnail)):
            saved.append(path)
            transaction = db.get_nested_transaction() or db.get_transaction()
            db.info.setdefault('new_avatar_files', []).append((adapter, path, transaction))
            adapter.save_private(contents, path, content_type='image/webp')
    except Exception as exc:
        for path in saved:
            try:
                adapter.delete(path)
            except Exception:  # noqa: BLE001 - transaction-end cleanup retries failed deletes
                logger.warning('Partial avatar upload cleanup deferred')
        raise HTTPException(503, 'Private avatar storage is unavailable; check the configured media provider') from exc
    asset = models.AvatarAsset(id=asset_id, name=name, storage_type=models.AvatarStorageTypeEnum.FILE,
        file_path=paths[0], thumbnail_path=paths[1], storage_provider=adapter.provider,
        mime_type='image/webp', tenant_id=creator.tenant_id, is_default=is_default, created_by_id=creator_id)
    db.add(asset)
    db.flush()
    return asset


def select_user_avatar(db, user, asset):
    if asset:
        # Coordinate selection with cleanup and library replacement/deletion.
        asset = resolve_avatar_asset(db, asset.id, user, for_update=True)
    previous = user.avatar_asset
    if user.profile_image_key and user.profile_image_key.startswith(f'avatars/{user.id}/'):
        # Keep a retryable cleanup record for variants made by the former MinIO
        # workflow. New uploads never populate the legacy user columns.
        legacy = models.AvatarAsset(name='Retired avatar', tenant_id=user.tenant_id,
            storage_type=models.AvatarStorageTypeEnum.FILE, storage_provider='legacy-minio',
            file_path=user.profile_image_key,
            thumbnail_path=user.profile_image_key.replace('/avatar.webp', '/avatar_256.webp') if user.profile_image_key.endswith('/avatar.webp') else None,
            created_by_id=user.id, is_default=False)
        db.add(legacy)
        db.flush()
        maybe_cleanup_custom_avatar(db, legacy)
    user.avatar_asset = asset
    user.avatar_asset_id = asset.id if asset else None
    # The legacy MinIO fields must never shadow a new selection or removal.
    user.profile_image_key = None
    user.profile_image_url = None
    db.flush()
    if previous and previous != asset:
        maybe_cleanup_custom_avatar(db, previous)


def set_user_avatar_from_data_url(db, user, *, data_url, actor, crop=None):
    asset = create_avatar_asset_from_data_url(db, data_url, creator_id=actor.id, crop=crop)
    select_user_avatar(db, user, asset)
    db.add(models.AuditEvent(actor_id=actor.id, event_type='user.avatar.updated', entity_type='user',
        entity_id=user.id, payload={'avatar_asset_id': asset.id}))
