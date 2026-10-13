"""Storage adapters for media uploads."""

from .base import StorageAdapter, StorageHealth, StoredObject
from .local import LocalAdapter
from .supabase import SupabaseAdapter
from .gdrive import GoogleDriveAdapter

__all__ = [
    "StorageAdapter",
    "StorageHealth",
    "StoredObject",
    "LocalAdapter",
    "SupabaseAdapter",
    "GoogleDriveAdapter",
]
