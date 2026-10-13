"""Abstract storage adapter contract for media uploads."""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Optional


@dataclass
class StoredObject:
    path: str
    size: int
    mime_type: str
    public_url: str


@dataclass
class StorageHealth:
    ok: bool
    details: Optional[str] = None


class StorageAdapter(abc.ABC):
    """Shared interface for pluggable storage providers."""

    provider: str

    def __init__(self, provider: str) -> None:
        self.provider = provider

    @abc.abstractmethod
    def save(self, data: bytes, relative_path: str, *, content_type: str) -> StoredObject:
        """Persist bytes at the given path relative to the provider root."""

    @abc.abstractmethod
    def delete(self, relative_path: str) -> None:
        """Delete the object at the given path if it exists."""

    @abc.abstractmethod
    def get_public_url(self, relative_path: str) -> str:
        """Return the publicly accessible URL for the stored object."""

    @abc.abstractmethod
    def copy(self, source_path: str, destination_path: str) -> str:
        """Copy an object and return the new relative path."""

    @abc.abstractmethod
    def move(self, source_path: str, destination_path: str) -> str:
        """Move/rename an object and return the new relative path."""

    @abc.abstractmethod
    def health(self) -> StorageHealth:
        """Return simple diagnostics for status surfaces in the UI."""

    @property
    def is_configured(self) -> bool:
        """Override if the provider requires runtime configuration."""
        return True
