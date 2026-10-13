"""Supabase storage adapter."""

from __future__ import annotations

from supabase import create_client, Client

from .base import StorageAdapter, StorageHealth, StoredObject


class SupabaseAdapter(StorageAdapter):
    """Supabase storage adapter for file operations."""

    def __init__(
        self,
        url: str | None,
        bucket: str | None,
        *,
        anon_key: str | None = None,
        service_role_key: str | None = None,
        public_url: str | None = None,
    ) -> None:
        super().__init__("supabase")
        self.url = url
        self.bucket = bucket
        self.anon_key = anon_key
        self.service_role_key = service_role_key
        self.public_url = public_url
        self._client: Client | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self.url and self.bucket and (self.service_role_key or self.anon_key))

    @property
    def client(self) -> Client:
        if not self._client:
            if not self.is_configured:
                raise ValueError("Supabase adapter is not configured")
            key = self.service_role_key or self.anon_key
            self._client = create_client(self.url, key)
        return self._client

    def save(self, data: bytes, relative_path: str, *, content_type: str) -> StoredObject:
        # Upload file to Supabase storage
        response = self.client.storage.from_(self.bucket).upload(
            path=relative_path,
            file=data,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        if response.status_code not in (200, 201):
            raise Exception(f"Failed to upload to Supabase: {response.json()}")

        public_url = self.get_public_url(relative_path)
        return StoredObject(
            path=relative_path,
            size=len(data),
            mime_type=content_type,
            public_url=public_url,
        )

    def delete(self, relative_path: str) -> None:
        # Delete file from Supabase storage
        response = self.client.storage.from_(self.bucket).remove([relative_path])
        if response.status_code != 200:
            raise Exception(f"Failed to delete from Supabase: {response.json()}")

    def get_public_url(self, relative_path: str) -> str:
        # Get public URL for the file
        if self.public_url:
            return f"{self.public_url}/{relative_path}"
        else:
            # Fallback to Supabase's get_public_url method
            return self.client.storage.from_(self.bucket).get_public_url(relative_path)

    def copy(self, source_path: str, destination_path: str) -> str:
        # Copy file within Supabase storage
        response = self.client.storage.from_(self.bucket).copy(
            from_path=source_path,
            to_path=destination_path
        )
        if response.status_code != 200:
            raise Exception(f"Failed to copy in Supabase: {response.json()}")
        return destination_path

    def move(self, source_path: str, destination_path: str) -> str:
        # Move file within Supabase storage (copy then delete)
        self.copy(source_path, destination_path)
        self.delete(source_path)
        return destination_path

    def health(self) -> StorageHealth:
        if not self.is_configured:
            return StorageHealth(ok=False, details="Missing Supabase credentials")
        try:
            # Try to list files in the bucket to check connectivity
            response = self.client.storage.from_(self.bucket).list(limit=1)
            if response.status_code == 200:
                return StorageHealth(ok=True, details="Supabase storage ready")
            else:
                return StorageHealth(ok=False, details=f"Supabase error: {response.status_code}")
        except Exception as e:
            return StorageHealth(ok=False, details=f"Supabase connection failed: {str(e)}")
