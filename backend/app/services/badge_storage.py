"""Helpers for handling badge image uploads and lifecycle."""

from __future__ import annotations

import mimetypes
import secrets
from datetime import datetime
from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, UploadFile, status

from ..config import get_settings
from .reward_storage import StorageService

settings = get_settings()

ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
}


def _build_relative_path(ext: str) -> Path:
    now = datetime.utcnow()
    token = secrets.token_hex(4)
    filename = f"{now.strftime('%Y%m%d')}_{token}.{ext.lstrip('.')}"
    return Path("badges") / f"{now.year}" / f"{now.month:02d}" / filename


class BadgeImageService:
    """Upload handling for badge-specific images."""

    max_bytes = settings.media_max_file_size_mb * 1024 * 1024

    @classmethod
    async def save_upload(cls, upload: UploadFile) -> Tuple[str, str, str, int]:
        data = await upload.read()
        if not data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
        if len(data) > cls.max_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds size limit")

        content_type = upload.content_type or mimetypes.guess_type(upload.filename or "")[0]
        if not content_type or content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported image format")

        ext = mimetypes.guess_extension(content_type) or ".bin"
        if ext.startswith(".jpg"):
            ext = ".jpg"
        rel_path = _build_relative_path(ext)
        destination = StorageService.base_upload_dir / rel_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

        public_url = f"{settings.media_public_base.rstrip('/')}/{rel_path.as_posix()}"
        return rel_path.as_posix(), public_url, content_type, len(data)

