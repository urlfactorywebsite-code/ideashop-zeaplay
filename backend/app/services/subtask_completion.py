from __future__ import annotations

import hashlib
import mimetypes
import re
import zipfile
from io import BytesIO
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from ..config import get_settings


DESCRIPTION_MIN_WORDS = 5
DESCRIPTION_MAX_WORDS = 10
MAX_ATTACHMENT_COUNT = 5
MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".txt",
    ".rtf",
    ".doc",
    ".docx",
}

ALLOWED_MIME_BY_EXTENSION = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".gif": {"image/gif"},
    ".webp": {"image/webp"},
    ".txt": {"text/plain"},
    ".rtf": {"application/rtf", "text/rtf"},
    ".doc": {"application/msword", "application/octet-stream"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"},
}


@dataclass(frozen=True)
class StoredCompletionAttachment:
    original_filename: str
    mime_type: str
    file_size: int
    storage_key: str
    checksum_sha256: str


def count_description_words(description: str) -> int:
    return sum(
        1
        for token in re.findall(r"\S+", description.strip(), flags=re.UNICODE)
        if any(character.isalnum() for character in token)
    )


def normalize_description(description: str) -> tuple[str, int]:
    cleaned = " ".join((description or "").strip().split())
    word_count = count_description_words(cleaned)
    if word_count < DESCRIPTION_MIN_WORDS or word_count > DESCRIPTION_MAX_WORDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Completion description must contain {DESCRIPTION_MIN_WORDS}-{DESCRIPTION_MAX_WORDS} words",
        )
    return cleaned, word_count


def approval_required_for(task) -> bool:
    if task.subtask_approval_required is not None:
        return bool(task.subtask_approval_required)
    if task.project:
        return bool(task.project.subtask_approval_required_default)
    return False


def _private_root() -> Path:
    settings = get_settings()
    root = (Path(settings.media_root).resolve() / "private" / "completion-evidence").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_storage_path(storage_key: str) -> Path:
    if "\\" in storage_key or ".." in Path(storage_key).parts:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    root = _private_root()
    path = (root / storage_key).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return path


def _clean_filename(filename: Optional[str]) -> str:
    normalized = (filename or "attachment").replace("\\", "/")
    name = Path(normalized).name.strip()
    name = re.sub(r"[\x00-\x1f\x7f/\\:]+", "_", name)
    return name[:255] or "attachment"


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def _declared_mime(upload: UploadFile, ext: str) -> str:
    declared = (upload.content_type or "").split(";")[0].strip().lower()
    if declared:
        return declared
    guessed = mimetypes.guess_type(f"file{ext}")[0]
    return guessed or "application/octet-stream"


def _signature_mime(data: bytes) -> Optional[str]:
    sample = data[:512]
    if sample.startswith(b"%PDF-"):
        return "application/pdf"
    if sample.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if sample.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if sample.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if sample.startswith(b"RIFF") and len(sample) >= 12 and sample[8:12] == b"WEBP":
        return "image/webp"
    if sample.startswith(b"{\\rtf"):
        return "application/rtf"
    if sample.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "application/msword"
    if sample.startswith(b"PK\x03\x04"):
        return "application/zip"
    if b"\x00" not in sample:
        try:
            sample.decode("utf-8")
            return "text/plain"
        except UnicodeDecodeError:
            return None
    return None


def _validate_content(filename: str, declared_mime: str, data: bytes) -> str:
    ext = _extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment type is not allowed")

    allowed_mimes = ALLOWED_MIME_BY_EXTENSION[ext]
    if declared_mime not in allowed_mimes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment MIME type is not allowed")

    sniffed = _signature_mime(data)
    if not sniffed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment content could not be validated")
    if sniffed not in allowed_mimes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment content does not match its type")
    if ext == ".docx" and sniffed != "application/zip":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment content does not match its type")
    if ext == ".docx":
        try:
            with zipfile.ZipFile(BytesIO(data)) as docx_zip:
                names = set(docx_zip.namelist())
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment content does not match its type") from exc
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment content does not match its type")
    return declared_mime


def delete_stored_attachments(attachments: Iterable[StoredCompletionAttachment]) -> None:
    for attachment in attachments:
        try:
            resolve_storage_path(attachment.storage_key).unlink(missing_ok=True)
        except Exception:
            continue


def store_attachments(
    *,
    tenant_id: object,
    submission_id: str,
    uploads: Iterable[UploadFile],
) -> list[StoredCompletionAttachment]:
    files = [upload for upload in uploads if upload and upload.filename]
    if len(files) > MAX_ATTACHMENT_COUNT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {MAX_ATTACHMENT_COUNT} attachments are allowed",
        )

    root = _private_root()
    stored: list[StoredCompletionAttachment] = []
    total_size = 0
    try:
        for upload in files:
            original_filename = _clean_filename(upload.filename)
            ext = _extension(original_filename)
            data = upload.file.read()
            upload.file.seek(0)
            file_size = len(data)
            if file_size <= 0:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment cannot be empty")
            if file_size > MAX_ATTACHMENT_FILE_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment exceeds 10 MB")
            total_size += file_size
            if total_size > MAX_ATTACHMENT_TOTAL_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachments exceed aggregate size limit")

            declared_mime = _declared_mime(upload, ext)
            mime_type = _validate_content(original_filename, declared_mime, data)
            checksum = hashlib.sha256(data).hexdigest()
            random_key = uuid4().hex
            storage_key = f"{random_key[:2]}/{random_key}{ext}"
            path = resolve_storage_path(storage_key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            stored.append(
                StoredCompletionAttachment(
                    original_filename=original_filename,
                    mime_type=mime_type,
                    file_size=file_size,
                    storage_key=storage_key,
                    checksum_sha256=checksum,
                )
            )
    except Exception:
        delete_stored_attachments(stored)
        raise

    return stored
