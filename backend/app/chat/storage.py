"""Chat file ownership, quota checks and user-selected cleanup."""
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import exists, func, inspect, select, text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..storage.local import LocalAdapter
from .permissions import ChatPermissionService

CHAT_STORAGE_LIMIT_BYTES = 200 * 1024 * 1024


def upload_url(upload_id: str) -> str:
    return f"/chat/uploads/{upload_id}/content"


@lru_cache(maxsize=16)
def require_storage_schema(bind) -> None:
    # Cache successful checks only. A missing schema can be repaired without
    # restarting the process; do not turn missing setup into an opaque 500.
    if not inspect(bind).has_table(models.ChatUpload.__tablename__):
        raise HTTPException(status_code=503, detail={
            "code": "CHAT_STORAGE_SCHEMA_MISSING",
            "message": "Chat storage is not ready. The server database needs the chat storage update. Please contact your administrator.",
        })


class ChatStorageService:
    def __init__(self, db: Session):
        self.db = db
        require_storage_schema(db.get_bind())
        settings = get_settings()
        self.adapter = LocalAdapter(settings.media_root, settings.media_public_base)

    def lock_owner(self, user: models.User) -> None:
        # Keep the lock through file persistence and commit. PostgreSQL locks one
        # user; SQLite's no-op write acquires its transaction-wide writer lock.
        if self.db.bind.dialect.name == "sqlite":
            self.db.execute(text("UPDATE users SET id = id WHERE id = :user_id"), {"user_id": user.id})
        else:
            self.db.execute(select(models.User.id).where(models.User.id == user.id).with_for_update()).scalar_one()

    def adopt_legacy(self, user: models.User) -> None:
        # Attribute pre-tracking attachments to their sender. Include deleted
        # messages: their bytes still occupy storage until explicitly cleaned.
        rows = self.db.query(models.MessageAttachment, models.ChatMessage, models.ChatConversation).join(
            models.ChatMessage, models.MessageAttachment.message_id == models.ChatMessage.id,
        ).join(models.ChatConversation, models.ChatMessage.conversation_id == models.ChatConversation.id).filter(
            models.ChatMessage.sender_id == user.id,
            ~exists().where(models.ChatUpload.storage_key == models.MessageAttachment.storage_key),
        ).order_by(models.ChatMessage.created_at, models.MessageAttachment.id).all()
        by_key = {}
        for attachment, message, conversation in rows:
            previous = by_key.get(attachment.storage_key)
            if previous:
                previous.file_size = max(previous.file_size, attachment.file_size)
                continue
            upload = models.ChatUpload(
                tenant_id=user.tenant_id, user_id=user.id, conversation_id=conversation.id,
                file_name=attachment.file_name, original_file_name=attachment.original_file_name,
                mime_type=attachment.mime_type, file_size=attachment.file_size, storage_key=attachment.storage_key,
                created_at=attachment.created_at,
            )
            by_key[upload.storage_key] = upload
            self.db.add(upload)
        for upload in by_key.values():
            try:
                path = self.adapter._full_path(upload.storage_key)
                if path.is_file():
                    upload.file_size = path.stat().st_size
            except (OSError, ValueError):
                pass
        self.db.flush()

    def owned(self, user: models.User):
        return self.db.query(models.ChatUpload).filter(
            models.ChatUpload.user_id == user.id, models.ChatUpload.tenant_id == user.tenant_id,
        )

    def used_bytes(self, user: models.User) -> int:
        return int(self.owned(user).with_entities(func.coalesce(func.sum(models.ChatUpload.file_size), 0)).scalar())

    def require_capacity(self, user: models.User, size: int) -> None:
        used = self.used_bytes(user)
        if used + size > CHAT_STORAGE_LIMIT_BYTES:
            raise HTTPException(status_code=413, detail={
                "code": "CHAT_STORAGE_QUOTA_EXCEEDED",
                "message": "Your 200 MB chat storage limit would be exceeded. Clean up storage to upload this file.",
                "used_bytes": used, "limit_bytes": CHAT_STORAGE_LIMIT_BYTES,
                "required_bytes": size, "remaining_bytes": max(0, CHAT_STORAGE_LIMIT_BYTES - used),
            })

    def snapshot(self, user: models.User, *, offset: int = 0, limit: int = 50) -> schemas.ChatStorageRead:
        used = self.used_bytes(user)
        count = self.owned(user).count()
        uploads = self.owned(user).order_by(models.ChatUpload.file_size.desc(), models.ChatUpload.id).offset(offset).limit(limit).all()
        keys = [upload.storage_key for upload in uploads]
        attached = set(self.db.scalars(select(models.MessageAttachment.storage_key).where(models.MessageAttachment.storage_key.in_(keys))).all()) if keys else set()
        return schemas.ChatStorageRead(
            used_bytes=used, limit_bytes=CHAT_STORAGE_LIMIT_BYTES,
            remaining_bytes=max(0, CHAT_STORAGE_LIMIT_BYTES - used),
            max_file_bytes=min(CHAT_STORAGE_LIMIT_BYTES, max(1, get_settings().media_max_file_size_mb) * 1024 * 1024),
            file_count=count, has_more=offset + len(uploads) < count,
            items=[schemas.ChatStorageFileRead(
                id=upload.id, original_file_name=upload.original_file_name, mime_type=upload.mime_type,
                file_size=upload.file_size, created_at=upload.created_at, attached=upload.storage_key in attached,
            ) for upload in uploads],
        )

    def get_storage(self, user: models.User, *, offset: int = 0, limit: int = 50) -> schemas.ChatStorageRead:
        self.lock_owner(user)
        self.adopt_legacy(user)
        result = self.snapshot(user, offset=offset, limit=limit)
        self.db.commit()
        return result

    def resolve_uploads(self, user: models.User, conversation_id: str, payloads: list[schemas.ChatAttachmentCreate]) -> list[models.ChatUpload]:
        if not payloads:
            return []
        self.lock_owner(user)
        self.adopt_legacy(user)
        keys = [item.storage_key for item in payloads]
        if len(set(keys)) != len(keys):
            raise HTTPException(status_code=422, detail="Duplicate attachment")
        uploads = self.owned(user).filter(models.ChatUpload.conversation_id == conversation_id, models.ChatUpload.storage_key.in_(keys)).all()
        by_key = {upload.storage_key: upload for upload in uploads}
        if len(by_key) != len(keys):
            raise HTTPException(status_code=422, detail="Upload the file in this conversation before attaching it")
        return [by_key[key] for key in keys]

    def content_for_upload(self, upload_id: str, user: models.User):
        upload = self.db.get(models.ChatUpload, upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="File not found")
        if upload.user_id == user.id and upload.tenant_id != user.tenant_id:
            raise HTTPException(status_code=404, detail="File not found")
        if upload.user_id != user.id:
            permission = ChatPermissionService(self.db)
            conversation = permission.get_conversation(upload.conversation_id, user)
            permission.require_member(conversation, user)
            sent = self.db.query(models.MessageAttachment.id).join(models.ChatMessage).filter(
                models.MessageAttachment.storage_key == upload.storage_key, models.ChatMessage.deleted_at.is_(None),
                models.ChatMessage.conversation_id == upload.conversation_id,
            ).first()
            if not sent:
                raise HTTPException(status_code=404, detail="File not found")
        return self.local_content(upload)

    def content_for_attachment(self, attachment_id: str, user: models.User):
        attachment = self.db.get(models.MessageAttachment, attachment_id)
        if not attachment or attachment.message.deleted_at:
            raise HTTPException(status_code=404, detail="File not found")
        permission = ChatPermissionService(self.db)
        conversation = permission.get_conversation(attachment.message.conversation_id, user)
        permission.require_member(conversation, user)
        return self.local_content(attachment)

    def local_content(self, item) -> tuple[Path, str, str]:
        try:
            path = self.adapter._full_path(item.storage_key)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="File not found") from exc
        if not path.is_file():
            raise HTTPException(status_code=404, detail="File no longer available")
        return path, item.mime_type, item.original_file_name

    def remove(self, upload_id: str, user: models.User) -> list[models.ChatMessage]:
        self.lock_owner(user)
        self.adopt_legacy(user)
        upload = self.owned(user).filter(models.ChatUpload.id == upload_id).first()
        if not upload:
            raise HTTPException(status_code=404, detail="File not found")
        # Release quota only after the physical file has been removed. Missing
        # files are idempotent; a filesystem failure leaves accounting intact.
        try:
            self.adapter.delete(upload.storage_key)
        except (OSError, ValueError) as exc:
            self.db.rollback()
            raise HTTPException(status_code=503, detail="Could not remove this file. Storage has not been released; please retry.") from exc
        # Ownership is established by the upload record, independently of the
        # conversation's tenant (privileged cross-workspace chats are supported).
        attachments = self.db.query(models.MessageAttachment).filter_by(storage_key=upload.storage_key).all()
        messages = {attachment.message.id: attachment.message for attachment in attachments}
        for attachment in attachments:
            self.db.delete(attachment)
        self.db.delete(upload)
        self.db.flush()
        for message in messages.values():
            self.db.expire(message, ["attachments"])
            if not message.content.strip() and not message.attachments:
                message.content = "Attachment removed during storage cleanup"
            message.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        self.db.commit()
        return list(messages.values())
