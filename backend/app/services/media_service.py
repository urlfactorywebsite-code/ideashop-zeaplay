"""Business logic for the Media Library."""

from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import secrets
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import asc, desc
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    MediaCategoryEnum,
    MediaItem,
    RoleEnum,
    StorageProviderEnum,
    User,
)
from ..storage import GoogleDriveAdapter, LocalAdapter, StorageAdapter, SupabaseAdapter
from ..utils.image import probe_image_dimensions

try:
    import magic  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    magic = None  # type: ignore

settings = get_settings()

CATEGORY_EXTENSIONS: Dict[MediaCategoryEnum, Tuple[str, ...]] = {
    MediaCategoryEnum.IMAGE: ("jpg", "jpeg", "png", "svg", "gif", "webp", "avif"),
    MediaCategoryEnum.VIDEO: ("mp4", "webm", "mov"),
    MediaCategoryEnum.MUSIC: ("mp3", "wav", "m4a"),
    MediaCategoryEnum.DOCUMENT: ("pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"),
    MediaCategoryEnum.ZIP: ("zip", "rar", "7z"),
}

EXTENSION_CATEGORY = {
    ext: category for category, extensions in CATEGORY_EXTENSIONS.items() for ext in extensions
}

DEFAULT_PAGE_SIZE = 24
MAX_PAGE_SIZE = 96

SORT_MAP = {
    "created_desc": lambda: desc(MediaItem.created_at),
    "created_asc": lambda: asc(MediaItem.created_at),
    "size_desc": lambda: desc(MediaItem.size_bytes),
    "size_asc": lambda: asc(MediaItem.size_bytes),
}


def _is_admin(user: User) -> bool:
    return user.role in {RoleEnum.ADMIN, RoleEnum.MANAGER, RoleEnum.OWNER}


def _detect_mime(data: bytes, filename: str) -> str:
    if magic:
        try:
            detected = magic.from_buffer(data, mime=True)
            if detected:
                return detected
        except Exception:
            pass
    guess, _ = mimetypes.guess_type(filename)
    return guess or "application/octet-stream"


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9-_]+", "-", name).strip("-") or "file"
    return re.sub(r"-{2,}", "-", base)


def _split_filename(filename: str, fallback_ext: Optional[str] = None) -> Tuple[str, str]:
    base, ext = os.path.splitext(filename)
    ext = (ext.lstrip(".") or fallback_ext or "").lower()
    clean_base = _slugify(base or "media")
    return clean_base, ext


def _build_storage_path(owner_id: str, ext: str) -> str:
    now = datetime.utcnow()
    token = secrets.token_hex(4)
    filename = f"{now.strftime('%Y%m%d')}_{token}.{ext}"
    relative = Path("uploads") / owner_id / f"{now.year}" / f"{now.month:02d}" / filename
    return relative.as_posix()


@lru_cache
def _adapter_for(provider: StorageProviderEnum) -> StorageAdapter:
    if provider == StorageProviderEnum.LOCAL:
        base_root = Path(settings.media_root)
        base_root.mkdir(parents=True, exist_ok=True)
        return LocalAdapter(str(base_root), settings.media_public_base)
    if provider == StorageProviderEnum.SUPABASE:
        return SupabaseAdapter(
            settings.supabase_url,
            settings.supabase_bucket,
            anon_key=settings.supabase_anon_key,
            service_role_key=settings.supabase_service_role_key,
            public_url=settings.supabase_public_url,
        )
    if provider == StorageProviderEnum.GDRIVE:
        return GoogleDriveAdapter(
            parent_folder_id=settings.google_drive_folder_id or settings.gdrive_parent_folder_id,
            service_account_path=settings.google_service_account_json_path
            or settings.gdrive_service_account_json_path,
            client_email=settings.google_client_email,
            private_key=settings.google_private_key,
            oauth_client_id=settings.google_client_id,
            oauth_client_secret=settings.google_client_secret,
            redirect_uri=settings.google_redirect_uri,
        )
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported storage provider")


def get_default_adapter() -> StorageAdapter:
    provider = StorageProviderEnum(settings.storage_provider.lower())
    adapter = _adapter_for(provider)
    if not adapter.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{provider.value} storage is not configured",
        )
    return adapter


def get_adapter(provider: StorageProviderEnum) -> StorageAdapter:
    return _adapter_for(provider)


def _validate_category(category: Optional[MediaCategoryEnum], ext: str) -> MediaCategoryEnum:
    inferred = EXTENSION_CATEGORY.get(ext)
    if not inferred:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '.{ext}'",
        )
    if category and category != inferred:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File extension '.{ext}' does not match requested category '{category.value}'",
        )
    return category or inferred


def _ensure_owner(item: MediaItem, user: User) -> None:
    if not item.owner or item.owner.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media item not found")
    if item.owner_id != user.id and not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this media item")


def _max_file_size_bytes() -> int:
    return max(1, settings.media_max_file_size_mb) * 1024 * 1024


async def create_media_item(
    db: Session,
    *,
    owner: User,
    upload: UploadFile,
    category: Optional[MediaCategoryEnum] = None,
    original_id: Optional[str] = None,
) -> MediaItem:
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file uploaded")
    if len(data) > _max_file_size_bytes():
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    base_name, ext = _split_filename(upload.filename or "upload", fallback_ext="bin")
    mime_type = _detect_mime(data, upload.filename or "")
    resolved_category = _validate_category(category, ext)
    checksum = hashlib.sha256(data).hexdigest()
    width = height = None
    if resolved_category == MediaCategoryEnum.IMAGE:
        width, height = probe_image_dimensions(data)

    storage_path = _build_storage_path(owner.id, ext)
    adapter = get_default_adapter()
    stored = adapter.save(data, storage_path, content_type=mime_type)

    item = MediaItem(
        owner_id=owner.id,
        filename=f"{base_name}.{ext}",
        ext=ext,
        mime_type=mime_type,
        size_bytes=len(data),
        category=resolved_category,
        storage_provider=StorageProviderEnum(adapter.provider),
        storage_path=stored.path,
        public_url=stored.public_url,
        width=width,
        height=height,
        checksum_sha256=checksum,
        original_id=original_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def list_media_items(
    db: Session,
    *,
    user: User,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    q: Optional[str] = None,
    category: Optional[MediaCategoryEnum] = None,
    sort: str = "created_desc",
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    owner_id: Optional[str] = None,
) -> Tuple[List[MediaItem], int]:
    page = max(1, page)
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))

    query = db.query(MediaItem).filter(MediaItem.deleted_at.is_(None))
    query = query.filter(MediaItem.owner.has(User.tenant_id == user.tenant_id))
    if not _is_admin(user):
        query = query.filter(MediaItem.owner_id == user.id)
    elif owner_id:
        query = query.filter(MediaItem.owner_id == owner_id)

    if q:
        ilike = f"%{q}%"
        query = query.filter(MediaItem.filename.ilike(ilike))
    if category:
        query = query.filter(MediaItem.category == category)
    if date_from:
        query = query.filter(MediaItem.created_at >= date_from)
    if date_to:
        query = query.filter(MediaItem.created_at <= date_to)

    total = query.count()

    sort_fn = SORT_MAP.get(sort, SORT_MAP["created_desc"])
    query = query.order_by(sort_fn())
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return items, total


def get_media_item(db: Session, *, media_id: str, user: User) -> MediaItem:
    item = db.get(MediaItem, media_id)
    if not item or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media item not found")
    _ensure_owner(item, user)
    return item


def rename_media_item(db: Session, *, media_id: str, user: User, filename: str) -> MediaItem:
    item = get_media_item(db, media_id=media_id, user=user)
    base, ext = _split_filename(filename, fallback_ext=item.ext)
    if ext != item.ext:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change file extension")
    item.filename = f"{base}.{item.ext}"
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_media_item(
    db: Session,
    *,
    media_id: str,
    user: User,
    hard: bool = False,
) -> None:
    item = get_media_item(db, media_id=media_id, user=user)
    if hard and not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hard delete requires admin")

    if hard:
        adapter = get_adapter(item.storage_provider)
        adapter.delete(item.storage_path)
        db.delete(item)
    else:
        item.deleted_at = datetime.utcnow()
        db.add(item)
    db.commit()


async def replace_media_item(
    db: Session,
    *,
    media_id: str,
    user: User,
    upload: UploadFile,
) -> MediaItem:
    original = get_media_item(db, media_id=media_id, user=user)
    new_original_id = original.original_id or original.id
    new_item = await create_media_item(
        db,
        owner=user,
        upload=upload,
        category=original.category,
        original_id=new_original_id,
    )
    return new_item


def bulk_delete_media(
    db: Session,
    *,
    user: User,
    media_ids: Iterable[str],
    hard: bool = False,
) -> int:
    deleted = 0
    for media_id in media_ids:
        try:
            delete_media_item(db, media_id=media_id, user=user, hard=hard)
            deleted += 1
        except HTTPException:
            continue
    return deleted
