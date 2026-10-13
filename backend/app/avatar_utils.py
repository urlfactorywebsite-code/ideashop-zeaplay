from __future__ import annotations

import base64
import re
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from . import models

AVATAR_LIBRARY_DIR = Path("assets/avatars")
USER_AVATAR_DIR = AVATAR_LIBRARY_DIR / "custom"
MIME_EXTENSION_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
}


def ensure_avatar_dirs() -> None:
    AVATAR_LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    USER_AVATAR_DIR.mkdir(parents=True, exist_ok=True)


def resolve_avatar_asset(db: Session, avatar_asset_id: str | None) -> models.AvatarAsset | None:
    if avatar_asset_id is None:
        return None
    asset = db.get(models.AvatarAsset, avatar_asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar asset not found")
    return asset


def avatar_public_url(asset: models.AvatarAsset | None) -> str | None:
    if not asset:
        return None
    if asset.storage_type == models.AvatarStorageTypeEnum.FILE and asset.file_path:
        return f"/assets/{asset.file_path}"
    if asset.storage_type == models.AvatarStorageTypeEnum.DATA_URL and asset.data_url:
        return asset.data_url
    if asset.storage_type == models.AvatarStorageTypeEnum.EXTERNAL_URL and asset.external_url:
        return asset.external_url
    return None


def _decode_data_url(data_url: str) -> tuple[str, bytes]:
    match = re.match(r"data:(?P<mime>[\w+/.-]+);base64,(?P<data>.+)", data_url)
    if not match:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid avatar data URL")

    mime_type = match.group("mime")
    encoded_data = match.group("data")
    if mime_type not in MIME_EXTENSION_MAP:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Use PNG, JPG, WEBP, GIF, or SVG.",
        )

    try:
        binary = base64.b64decode(encoded_data)
    except (base64.binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not decode avatar image") from exc

    return mime_type, binary


def save_data_url_to_subdir(data_url: str, *, subdir: str) -> tuple[str, str]:
    mime_type, binary = _decode_data_url(data_url)

    ensure_avatar_dirs()
    extension = MIME_EXTENSION_MAP[mime_type]
    filename = f"{uuid4()}{extension}"
    target_dir = AVATAR_LIBRARY_DIR / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    relative_path = Path("avatars") / subdir / filename
    file_path = target_dir / filename
    with file_path.open("wb") as file_handle:
        file_handle.write(binary)

    return str(relative_path).replace("\\", "/"), mime_type


def create_avatar_asset_from_data_url(
    db: Session,
    data_url: str,
    *,
    creator_id: str,
    name: str = "Custom upload",
    is_default: bool = False,
    subdir: str = "custom",
) -> models.AvatarAsset:
    relative_path, mime_type = save_data_url_to_subdir(data_url, subdir=subdir)

    asset = models.AvatarAsset(
        name=name,
        storage_type=models.AvatarStorageTypeEnum.FILE,
        file_path=relative_path,
        mime_type=mime_type,
        is_default=is_default,
        created_by_id=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def remove_avatar_asset_file(asset: models.AvatarAsset) -> None:
    if asset.file_path:
        file_path = Path("assets") / Path(asset.file_path)
        if file_path.exists():
            file_path.unlink()


def maybe_cleanup_custom_avatar(db: Session, asset: models.AvatarAsset | None, user_id: str) -> None:
    if not asset:
        return
    if asset.is_default:
        return
    if asset.created_by_id and asset.created_by_id != user_id:
        return
    remove_avatar_asset_file(asset)
    db.delete(asset)


def set_user_avatar_from_data_url(
    db: Session,
    user: models.User,
    *,
    data_url: str,
    actor: models.User,
) -> None:
    previous_asset = user.avatar_asset
    asset = create_avatar_asset_from_data_url(db, data_url, creator_id=actor.id)
    user.avatar_asset_id = asset.id
    db.flush()
    if previous_asset and previous_asset.id != asset.id:
        maybe_cleanup_custom_avatar(db, previous_asset, user.id)
