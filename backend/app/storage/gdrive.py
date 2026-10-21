"""Google Drive storage adapter."""

from __future__ import annotations

import io
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from .base import StorageAdapter, StorageHealth, StoredObject


def _configured(value: str | None) -> bool:
    if not value:
        return False
    normalized = value.strip().lower()
    if not normalized:
        return False
    return not (
        "your-" in normalized
        or "your_" in normalized
        or normalized in {"change_me", "changeme", "placeholder"}
    )


class GoogleDriveAdapter(StorageAdapter):
    """Google Drive storage adapter for file operations."""

    def __init__(
        self,
        *,
        parent_folder_id: str | None,
        service_account_path: str | None = None,
        client_email: str | None = None,
        private_key: str | None = None,
        oauth_client_id: str | None = None,
        oauth_client_secret: str | None = None,
        redirect_uri: str | None = None,
    ) -> None:
        super().__init__("gdrive")
        self.parent_folder_id = parent_folder_id
        self.service_account_path = service_account_path
        self.client_email = client_email
        self.private_key = private_key
        self.oauth_client_id = oauth_client_id
        self.oauth_client_secret = oauth_client_secret
        self.redirect_uri = redirect_uri
        self._service = None
        self._file_cache: dict[str, str] = {}  # relative_path -> file_id

    @property
    def is_configured(self) -> bool:
        if not _configured(self.parent_folder_id):
            return False
        service_account_ready = bool(
            _configured(self.parent_folder_id)
            and (
                (_configured(self.service_account_path))
                or (_configured(self.client_email) and _configured(self.private_key))
            )
        )
        return service_account_ready

    @property
    def service(self):
        if not self._service:
            if not self.is_configured:
                raise ValueError("Google Drive adapter is not configured")

            creds = None
            if self.service_account_path:
                creds = service_account.Credentials.from_service_account_file(
                    self.service_account_path,
                    scopes=['https://www.googleapis.com/auth/drive']
                )
            elif self.client_email and self.private_key:
                creds = service_account.Credentials.from_service_account_info(
                    {
                        "type": "service_account",
                        "client_email": self.client_email,
                        "private_key": self.private_key.replace('\\n', '\n'),
                        "token_uri": "https://oauth2.googleapis.com/token",
                    },
                    scopes=['https://www.googleapis.com/auth/drive']
                )
            else:
                # OAuth flow would be implemented here for user authentication
                # For now, raise error as OAuth is not implemented
                raise NotImplementedError("OAuth flow not implemented for Google Drive")

            self._service = build('drive', 'v3', credentials=creds)
        return self._service

    def _get_file_id(self, relative_path: str) -> str | None:
        """Get file ID from cache or search Drive."""
        if relative_path in self._file_cache:
            return self._file_cache[relative_path]

        # Search for file in parent folder
        query = f"name='{relative_path}' and '{self.parent_folder_id}' in parents and trashed=false"
        results = self.service.files().list(q=query, fields="files(id)").execute()
        files = results.get('files', [])
        if files:
            file_id = files[0]['id']
            self._file_cache[relative_path] = file_id
            return file_id
        return None

    def save(self, data: bytes, relative_path: str, *, content_type: str) -> StoredObject:
        # Check if file exists
        file_id = self._get_file_id(relative_path)

        # Prepare file metadata
        file_metadata = {
            'name': relative_path,
            'parents': [self.parent_folder_id]
        }

        # Create media upload
        media = MediaIoBaseUpload(
            io.BytesIO(data),
            mimetype=content_type,
            resumable=True
        )

        if file_id:
            # Update existing file
            file = self.service.files().update(
                fileId=file_id,
                media_body=media,
                fields='id,size'
            ).execute()
        else:
            # Create new file
            file = self.service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id,size'
            ).execute()
            self._file_cache[relative_path] = file['id']

        # Make file publicly readable
        self.service.permissions().create(
            fileId=file['id'],
            body={'type': 'anyone', 'role': 'reader'},
            fields='id'
        ).execute()

        public_url = self.get_public_url(relative_path)
        return StoredObject(
            path=relative_path,
            size=int(file.get('size', len(data))),
            mime_type=content_type,
            public_url=public_url,
        )

    def delete(self, relative_path: str) -> None:
        file_id = self._get_file_id(relative_path)
        if file_id:
            self.service.files().delete(fileId=file_id).execute()
            if relative_path in self._file_cache:
                del self._file_cache[relative_path]

    def save_private(self, data: bytes, relative_path: str, *, content_type: str) -> StoredObject:
        page = None
        while True:
            permissions = self.service.permissions().list(fileId=self.parent_folder_id,
                fields='permissions(type),nextPageToken', pageToken=page).execute()
            if 'permissions' not in permissions or any(p.get('type') in {'anyone', 'domain'} for p in permissions['permissions']):
                raise ValueError('Avatar uploads require a private Google Drive folder')
            page = permissions.get('nextPageToken')
            if not page:
                break
        media = MediaIoBaseUpload(io.BytesIO(data), mimetype=content_type, resumable=True)
        file = self.service.files().create(body={'name': relative_path, 'parents': [self.parent_folder_id]},
            media_body=media, fields='id').execute()
        self._file_cache[relative_path] = file['id']
        return StoredObject(relative_path, len(data), content_type, '')

    def read(self, relative_path: str) -> bytes:
        file_id = self._get_file_id(relative_path)
        if not file_id:
            raise FileNotFoundError(relative_path)
        return self.service.files().get_media(fileId=file_id).execute()

    def get_public_url(self, relative_path: str) -> str:
        file_id = self._get_file_id(relative_path)
        if file_id:
            return f"https://drive.google.com/uc?id={file_id}"
        raise FileNotFoundError(f"File {relative_path} not found in Google Drive")

    def copy(self, source_path: str, destination_path: str) -> str:
        source_id = self._get_file_id(source_path)
        if not source_id:
            raise FileNotFoundError(f"Source file {source_path} not found")

        # Copy file
        file_metadata = {'name': destination_path, 'parents': [self.parent_folder_id]}
        copied_file = self.service.files().copy(
            fileId=source_id,
            body=file_metadata,
            fields='id'
        ).execute()

        self._file_cache[destination_path] = copied_file['id']
        return destination_path

    def move(self, source_path: str, destination_path: str) -> str:
        file_id = self._get_file_id(source_path)
        if not file_id:
            raise FileNotFoundError(f"Source file {source_path} not found")

        # Update file name and parent
        file_metadata = {'name': destination_path}
        self.service.files().update(
            fileId=file_id,
            body=file_metadata,
            addParents=self.parent_folder_id,
            removeParents=self.parent_folder_id,
            fields='id'
        ).execute()

        # Update cache
        if source_path in self._file_cache:
            del self._file_cache[source_path]
        self._file_cache[destination_path] = file_id

        return destination_path

    def health(self) -> StorageHealth:
        if not self.is_configured:
            return StorageHealth(ok=False, details="Missing Google Drive credentials")
        try:
            # Try to list files in the parent folder
            results = self.service.files().list(
                q=f"'{self.parent_folder_id}' in parents and trashed=false",
                pageSize=1,
                fields="files(id)"
            ).execute()
            return StorageHealth(ok=True, details="Google Drive storage ready")
        except Exception as e:
            return StorageHealth(ok=False, details=f"Google Drive connection failed: {str(e)}")
