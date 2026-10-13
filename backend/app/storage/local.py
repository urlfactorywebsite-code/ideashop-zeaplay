"""Local filesystem storage adapter."""

from __future__ import annotations

import shutil
from pathlib import Path

from .base import StorageAdapter, StorageHealth, StoredObject


class LocalAdapter(StorageAdapter):
    """Persist media files to the application server filesystem."""

    def __init__(self, root: str, public_base: str) -> None:
        super().__init__("local")
        self.root = Path(root).resolve()
        self.public_base = public_base.rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    def _normalize(self, relative_path: str) -> str:
        normalized = Path(relative_path.strip("/")).as_posix()
        if normalized in ("", "."):
            raise ValueError("Relative path is required")
        return normalized

    def _full_path(self, relative_path: str) -> Path:
        normalized = self._normalize(relative_path)
        full = (self.root / normalized).resolve()
        if not str(full).startswith(str(self.root)):
            raise ValueError("Attempted path traversal outside MEDIA_ROOT")
        return full

    def save(self, data: bytes, relative_path: str, *, content_type: str) -> StoredObject:
        full_path = self._full_path(relative_path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(data)
        return StoredObject(
            path=self._normalize(relative_path),
            size=len(data),
            mime_type=content_type,
            public_url=self.get_public_url(relative_path),
        )

    def delete(self, relative_path: str) -> None:
        full_path = self._full_path(relative_path)
        try:
            full_path.unlink()
        except FileNotFoundError:
            return

    def get_public_url(self, relative_path: str) -> str:
        normalized = self._normalize(relative_path).lstrip("/")
        base = self.public_base.rstrip("/")

        # Avoid duplicating directory segments like "uploads/uploads/..." when
        # MEDIA_PUBLIC_BASE already ends with the same folder name we prepend.
        if normalized:
            base_last_segment = base.rsplit("/", 1)[-1] if "/" in base else base
            if base_last_segment and normalized.startswith(f"{base_last_segment}/"):
                normalized = normalized[len(base_last_segment) + 1 :]

        if not base.startswith(("http://", "https://", "/")):
            base = f"/{base}"

        return f"{base}/{normalized}" if normalized else base

    def copy(self, source_path: str, destination_path: str) -> str:
        source = self._full_path(source_path)
        destination = self._full_path(destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return self._normalize(destination_path)

    def move(self, source_path: str, destination_path: str) -> str:
        source = self._full_path(source_path)
        destination = self._full_path(destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        return self._normalize(destination_path)

    def health(self) -> StorageHealth:
        if not self.root.exists():
            return StorageHealth(ok=False, details=f"Missing directory {self.root}")
        if not self.root.is_dir():
            return StorageHealth(ok=False, details=f"{self.root} is not a directory")
        try:
            test_dir = self.root / ".healthcheck"
            test_dir.mkdir(parents=True, exist_ok=True)
            test_dir.rmdir()
        except OSError as exc:
            return StorageHealth(ok=False, details=f"Write test failed: {exc}")
        return StorageHealth(ok=True, details="Local filesystem ready")
