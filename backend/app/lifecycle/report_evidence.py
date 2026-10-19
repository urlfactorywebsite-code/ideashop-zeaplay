"""Authorized evidence reads. Never follow arbitrary task attachment URLs."""
from hashlib import sha256
from pathlib import Path
import re

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import or_, select, tuple_

from .. import models
from ..services import media_service, subtask_completion
from .analytics import utc
from .report import people, person
from .report_contracts import EvidencePage, ReportEvidence

MAX_READ_BYTES = 50 * 1024 * 1024
PREVIEW_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}
PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
                   "Content-Security-Policy": "sandbox; default-src 'none'", "Referrer-Policy": "no-referrer"}


def allowed_children(task, user):
    from ..routers.tasks import _ensure_completion_attachment_access
    result = []
    for child in task.subtasks:
        try:
            _ensure_completion_attachment_access(task, child, user)
            result.append(child.id)
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
    return result


def completion_query(task, user):
    a, s = models.CompletionAttachment, models.CompletionSubmission
    return select(a, s).join(s, a.submission_id == s.id).where(
        a.tenant_id == user.tenant_id, s.tenant_id == user.tenant_id, s.task_id == task.id,
        s.subtask_id.in_(allowed_children(task, user)))


def completion_evidence(db, task, user, after_id, limit):
    rows = db.execute(completion_query(task, user).where(models.CompletionAttachment.id > after_id)
                      .order_by(models.CompletionAttachment.id).limit(limit + 1)).all()
    names = people(db, [s.submitted_by_id for _, s in rows[:limit]], user.tenant_id)
    items = []
    for attachment, submission in rows[:limit]:
        available = private_path(attachment.storage_key) is not None
        items.append(ReportEvidence(id=attachment.id, source="completion", task_id=task.id,
            subtask_id=submission.subtask_id, submission_id=submission.id,
            filename=attachment.original_filename, mime_type=attachment.mime_type, size_bytes=attachment.file_size,
            uploaded_by=person(submission.submitted_by_id, names), uploaded_at=utc(attachment.created_at),
            availability="available" if available else "missing", can_download=available,
            can_preview=available and attachment.mime_type in PREVIEW_TYPES))
    return EvidencePage(items=items, next_after_id=rows[limit - 1][0].id if len(rows) > limit else None)


def private_path(key):
    try:
        path = subtask_completion.resolve_storage_path(key)
        return path if path.is_file() else None
    except (HTTPException, ValueError, OSError):
        return None


def local_path(key):
    try:
        root = (Path(media_service.settings.media_root).resolve() / "uploads").resolve()
        media_root = Path(media_service.settings.media_root).resolve()
        # MediaItem uploads must never alias the private completion store or app files.
        if media_root not in root.parents:
            return None
        path = (media_root / key).resolve()
        if root not in path.parents or "\\" in key or ".." in Path(key).parts:
            return None
        return path if path.is_file() else None
    except (OSError, ValueError, TypeError):
        return None


def reference_id(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"(?:media:|/api/media/)([a-zA-Z0-9-]{1,36})", value)
    return match[1] if match else value if re.fullmatch(r"[a-zA-Z0-9-]{1,36}", value) else None


def minio_reference(value):
    from urllib.parse import unquote, urlsplit
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if url.scheme not in {"https", "http"} or url.username is not None or url.password is not None:
            return None
        for configured in (media_service.settings.minio_endpoint, media_service.settings.minio_public_base):
            base = urlsplit(configured or "")
            prefix = base.path.rstrip("/") + "/"
            if url.netloc.lower() != base.netloc.lower() or not url.path.startswith(prefix):
                continue
            path = unquote(url.path[len(prefix):], errors="strict")
            if ".." in path.split("/") or "\\" in path:
                return None
            parts = path.split("/", 1)
            if len(parts) == 2 and all(parts):
                return tuple(parts)
    except (ValueError, UnicodeError):
        pass
    return None


def media_queries(user):
    m, f = models.MediaItem, models.MediaFile
    items = select(m).where(m.owner.has(models.User.tenant_id == user.tenant_id))
    files = select(f).where(f.owner.has(models.User.tenant_id == user.tenant_id))
    if user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN, models.RoleEnum.MANAGER}:
        items = items.where(m.owner_id == user.id)
    if user.role == models.RoleEnum.MANAGER:
        files = files.where(f.department_id == user.department_id if user.department_id else f.user_id == user.id)
    elif user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN}:
        files = files.where(f.user_id == user.id)
    return items, files


def resolve_links(db, task, user, refs):
    refs = [ref if isinstance(ref, str) else None for ref in refs]
    items_query, files_query = media_queries(user)
    ids = {reference_id(ref) for ref in refs} - {None}
    objects = {minio_reference(ref) for ref in refs} - {None}
    items = list(db.scalars(items_query.where(or_(models.MediaItem.id.in_(ids), models.MediaItem.public_url.in_([ref for ref in refs if ref is not None])))))
    files = list(db.scalars(files_query.where(or_(models.MediaFile.id.in_(ids),
        tuple_(models.MediaFile.bucket, models.MediaFile.object_key).in_(objects)))))
    mapping = {row.id: ("media", row) for row in items}
    mapping.update({row.public_url: ("media", row) for row in items})
    mapping.update({row.id: ("media_file", row) for row in files})
    objects = {(row.bucket, row.object_key): ("media_file", row) for row in files}
    return [mapping.get(ref) or mapping.get(reference_id(ref)) or objects.get(minio_reference(ref)) for ref in refs]


def linked_evidence(db, task, user, after_id, limit):
    refs = task.attachments if isinstance(task.attachments, list) else []
    try:
        offset = int(after_id or 0)
        if offset < 0:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Invalid linked evidence cursor") from None
    page = refs[offset:offset + limit]
    resolved = resolve_links(db, task, user, page)
    names = people(db, [(row.owner_id if source == "media" else row.user_id)
                        for match in resolved if match for source, row in [match]], user.tenant_id)
    evidence = []
    for index, match in enumerate(resolved):
        if not match:
            # Do not echo untrusted URLs, which can contain credentials or foreign identifiers.
            evidence.append(ReportEvidence(id=sha256(f"{task.id}:{offset + index}".encode()).hexdigest(),
                source="unverified", task_id=task.id, availability="unverified"))
            continue
        source, row = match
        local = source == "media" and row.storage_provider == models.StorageProviderEnum.LOCAL
        state = "deleted" if row.deleted_at else "missing" if local and not local_path(row.storage_path) else "available" if local else "provider_check_required"
        if source == "media_file" and row.status != models.MediaFileStatusEnum.CONFIRMED:
            state = "missing"
        mime = row.mime_type if source == "media" else row.content_type
        evidence.append(ReportEvidence(id=row.id, source=source, task_id=task.id,
            filename=row.filename if source == "media" else row.original_filename, mime_type=mime,
            size_bytes=row.size_bytes, uploaded_by=person(row.owner_id if source == "media" else row.user_id, names),
            uploaded_at=utc(row.created_at), availability=state, can_download=state in {"available", "provider_check_required"},
            can_preview=state in {"available", "provider_check_required"} and mime in PREVIEW_TYPES))
    return EvidencePage(items=evidence, next_after_id=str(offset + limit) if len(refs) > offset + limit else None)


def _remote_bytes(source, row):
    """Only registered storage adapters receive persisted keys, never client URLs."""
    if source == "media_file":
        from ..storage.minio import get_minio_client
        response = get_minio_client().get_object(Bucket=row.bucket, Key=row.object_key)
        body = response["Body"]
        try:
            data = body.read(MAX_READ_BYTES + 1)
        finally:
            body.close()
    else:
        adapter = media_service.get_adapter(row.storage_provider)
        if not adapter.is_configured:
            raise HTTPException(503, "Evidence storage is not configured")
        if row.storage_provider == models.StorageProviderEnum.SUPABASE:
            # The SDK's download() buffers the whole object before checking its size.
            # Stream the same authenticated object endpoint with the existing credentials.
            import httpx
            from urllib.parse import quote
            if ".." in row.storage_path.split("/") or "\\" in row.storage_path:
                raise HTTPException(404, "Evidence file is unavailable")
            key = adapter.service_role_key or adapter.anon_key
            url = f"{adapter.url.rstrip('/')}/storage/v1/object/{quote(adapter.bucket, safe='')}/{quote(row.storage_path, safe='/')}"
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                with client.stream("GET", url, headers={"Authorization": f"Bearer {key}", "apikey": key}) as response:
                    if response.status_code == 404:
                        raise HTTPException(404, "Evidence file is unavailable")
                    response.raise_for_status()
                    data = bytearray()
                    for chunk in response.iter_bytes(chunk_size=64 * 1024):
                        data.extend(chunk)
                        if len(data) > MAX_READ_BYTES:
                            raise HTTPException(413, "Evidence exceeds the report download limit")
                    data = bytes(data)
        elif row.storage_provider == models.StorageProviderEnum.GDRIVE:
            from googleapiclient.http import MediaIoBaseDownload
            from io import BytesIO
            file_id = adapter._get_file_id(row.storage_path)
            if not file_id:
                raise HTTPException(404, "Evidence file is unavailable")
            buffer = BytesIO()
            downloader = MediaIoBaseDownload(buffer, adapter.service.files().get_media(fileId=file_id), chunksize=1024 * 1024)
            done = False
            while not done:
                _, done = downloader.next_chunk(num_retries=0)
                if buffer.tell() > MAX_READ_BYTES:
                    raise HTTPException(413, "Evidence exceeds the report download limit")
            data = buffer.getvalue()
        else:
            raise HTTPException(503, "Evidence storage is not supported")
    if len(data) > MAX_READ_BYTES:
        raise HTTPException(413, "Evidence exceeds the report download limit")
    return data


def evidence_response(db, task, user, source, identifier, preview):
    path = None
    if source == "completion":
        result = db.execute(completion_query(task, user).where(models.CompletionAttachment.id == identifier)).first()
        if not result:
            raise HTTPException(404, "Evidence file is unavailable")
        row, _ = result
        path = private_path(row.storage_key)
        if path is None:
            raise HTTPException(404, "Evidence file is unavailable")
        name, mime, size = row.original_filename, row.mime_type, row.file_size
    else:
        # Recheck the association and the current media permission on every action.
        query, files_query = media_queries(user)
        cls = models.MediaItem if source == "media" else models.MediaFile
        row = db.scalar((query if source == "media" else files_query).where(cls.id == identifier))
        refs = task.attachments if isinstance(task.attachments, list) else []
        if not row or row.deleted_at or not any(reference_id(ref) == identifier or
                (source == "media" and ref == row.public_url) or
                (source == "media_file" and minio_reference(ref) == (row.bucket, row.object_key)) for ref in refs):
            raise HTTPException(404, "Evidence file is unavailable")
        if source == "media_file" and row.status != models.MediaFileStatusEnum.CONFIRMED:
            raise HTTPException(404, "Evidence file is unavailable")
        name = row.filename if source == "media" else row.original_filename
        mime = row.mime_type if source == "media" else row.content_type
        size = row.size_bytes
        if source == "media" and row.storage_provider == models.StorageProviderEnum.LOCAL:
            path = local_path(row.storage_path)
            if path is None:
                raise HTTPException(404, "Evidence file is unavailable")
    if size > MAX_READ_BYTES or (path and path.stat().st_size > MAX_READ_BYTES):
        raise HTTPException(413, "Evidence exceeds the report download limit")
    if preview and mime not in PREVIEW_TYPES:
        raise HTTPException(415, "Preview is not supported for this file")
    data = None
    if not path:
        try:
            data = _remote_bytes(source, row)
        except HTTPException:
            raise
        except Exception:
            # Provider exception text can contain signed URLs, tokens and storage keys.
            raise HTTPException(503, "Evidence storage is temporarily unavailable") from None
    if preview:
        if data is not None:
            sample = data[:4096]
        else:
            with path.open("rb") as stream:
                sample = stream.read(4096)
        if subtask_completion._signature_mime(sample) != mime:
            raise HTTPException(415, "File content is not safe to preview")
    # Downloads use octet-stream so untrusted HTML/SVG cannot render in this origin.
    response_type = mime if preview else "application/octet-stream"
    disposition = "inline" if preview else "attachment"
    name = Path(name.replace("\\", "/")).name.replace("\r", "").replace("\n", "") or "evidence"
    if path:
        return FileResponse(path, media_type=response_type, filename=name, content_disposition_type=disposition, headers=PRIVATE_HEADERS)
    from urllib.parse import quote
    return Response(data, media_type=response_type, headers={**PRIVATE_HEADERS,
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name, safe='')}"})
