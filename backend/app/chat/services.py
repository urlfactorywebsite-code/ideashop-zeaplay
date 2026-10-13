import base64
import logging
import mimetypes
import re
from pathlib import Path
from uuid import uuid4
from datetime import datetime

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..config import get_settings
from .. import models, schemas
from ..rate_limit import check_rate_limit
from ..services import notifications as notification_service
from ..storage.local import LocalAdapter
from ..webhooks import service as webhook_service
from .permissions import ChatPermissionService
from .repositories import ConversationRepository, MemberRepository, MessageRepository, can_use_global_chat_directory
from .serializers import serialize_conversation, serialize_member, serialize_message

logger = logging.getLogger("zeaplay.chat")
MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_.-]{2,80})")
ALLOWED_ATTACHMENT_EXTENSIONS = {
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "csv",
    "txt",
    "zip",
}
ALLOWED_ATTACHMENT_MIME_PREFIXES = {"image/"}
ALLOWED_ATTACHMENT_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
}
IMAGE_SIGNATURES = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}


def build_direct_key(user_id: str, target_user_id: str) -> str:
    first, second = sorted([user_id, target_user_id])
    return f"direct:{first}:{second}"


def encode_cursor(created_at: datetime, message_id: str) -> str:
    raw = f"{created_at.isoformat()}|{message_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at, message_id = raw.split("|", 1)
        return datetime.fromisoformat(created_at), message_id
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid cursor") from exc


def _emit_domain_event(db: Session, event_name: str, payload: dict) -> None:
    try:
        webhook_service.queue_event(db, event_name=event_name, data=payload)
    except Exception:
        logger.exception("chat.webhook.queue_failed event=%s", event_name)


def _notifications_available(db: Session) -> bool:
    try:
        return "notifications" in inspect(db.bind).get_table_names()
    except Exception:
        return False


def _create_chat_notification(db: Session, **kwargs) -> None:
    if not _notifications_available(db):
        return
    try:
        notification_service.create_notification(db, **kwargs)
    except SQLAlchemyError:
        raise
    except Exception:
        logger.exception("chat.notification.create_failed")


def _sanitize_filename(filename: str) -> str:
    raw = Path(filename or "attachment").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip(".-")
    return cleaned or "attachment"


def _attachment_mime_allowed(mime_type: str) -> bool:
    return mime_type in ALLOWED_ATTACHMENT_MIME_TYPES or any(
        mime_type.startswith(prefix) for prefix in ALLOWED_ATTACHMENT_MIME_PREFIXES
    )


def _attachment_content_allowed(mime_type: str, data: bytes) -> bool:
    if mime_type in IMAGE_SIGNATURES:
        if mime_type == "image/webp":
            return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        return any(data.startswith(signature) for signature in IMAGE_SIGNATURES[mime_type])
    if mime_type == "application/pdf":
        return data.startswith(b"%PDF-")
    if mime_type in {
        "application/zip",
        "application/x-zip-compressed",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        return data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06") or data.startswith(b"PK\x07\x08")
    if mime_type == "application/msword":
        return data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if mime_type in {"text/plain", "text/csv"}:
        return b"\x00" not in data[:4096]
    return True


class ConversationService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)
        self.conversations = ConversationRepository(db)

    def list_conversations(self, user: models.User) -> list[schemas.ChatConversationSummary]:
        conversations = self.conversations.list_for_user(user)
        conversation_ids = [conversation.id for conversation in conversations]
        latest_messages = self.conversations.latest_messages_by_conversation(conversation_ids)
        unread_counts = self.conversations.unread_counts_for_user(conversation_ids, user)
        return [
            serialize_conversation(
                conversation,
                latest_messages.get(conversation.id),
                unread_counts.get(conversation.id, 0),
            )
            for conversation in conversations
        ]

    def get_conversation(self, conversation_id: str, user: models.User) -> schemas.ChatConversationDetail:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        latest_messages = MessageService(self.db).list_messages(conversation_id, user, limit=50).items
        unread_count = self.conversations.unread_counts_for_user([conversation.id], user).get(conversation.id, 0)
        summary = serialize_conversation(conversation, unread_count=unread_count)
        return schemas.ChatConversationDetail(**summary.model_dump(), messages=latest_messages)

    def create_direct(self, payload: schemas.ChatDirectCreate, user: models.User) -> schemas.ChatConversationSummary:
        target_user_id = payload.user_id or payload.target_user_id
        if not target_user_id or target_user_id == user.id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select another user")
        target = self.db.get(models.User, target_user_id)
        if not target or target.status != models.UserStatusEnum.ACTIVE:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if target.tenant_id != user.tenant_id and not can_use_global_chat_directory(user):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        direct_key = build_direct_key(user.id, target.id)
        existing = self.conversations.find_direct_by_key(user.tenant_id, direct_key, user)
        if not existing:
            existing = self.conversations.find_direct_between(user, target)
        if existing:
            if not existing.direct_key:
                existing.direct_key = direct_key
                self.db.commit()
                self.db.refresh(existing)
            return serialize_conversation(existing)

        conversation = models.ChatConversation(
            tenant_id=user.tenant_id,
            type=models.ChatConversationTypeEnum.DIRECT,
            name=None,
            direct_key=direct_key,
            is_private=True,
            created_by_id=user.id,
        )
        self.db.add(conversation)
        self.db.flush()
        self.permissions.add_member(conversation, user, models.ChatMemberRoleEnum.OWNER)
        self.permissions.add_member(conversation, target, models.ChatMemberRoleEnum.MEMBER)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            existing = self.conversations.find_direct_by_key(user.tenant_id, direct_key, user)
            if existing:
                return serialize_conversation(existing)
            raise
        self.db.refresh(conversation)
        logger.info("chat.direct.created conversation_id=%s user_id=%s target_user_id=%s", conversation.id, user.id, target.id)
        return serialize_conversation(conversation)

    def create_conversation(
        self,
        payload: schemas.ChatConversationCreate,
        user: models.User,
    ) -> schemas.ChatConversationSummary:
        if payload.type == models.ChatConversationTypeEnum.DIRECT:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Use the direct endpoint")
        name = payload.name.strip() if payload.name else None
        if payload.type in {models.ChatConversationTypeEnum.GROUP, models.ChatConversationTypeEnum.SPACE} and not name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Conversation name is required")

        member_ids = list(dict.fromkeys([*payload.member_ids, user.id]))
        users = self.permissions.validate_chat_eligible_users(member_ids, user)
        conversation = models.ChatConversation(
            tenant_id=user.tenant_id,
            type=payload.type,
            name=name,
            description=payload.description,
            avatar_url=payload.avatar_url,
            project_id=payload.project_id,
            team_id=payload.team_id,
            is_private=payload.is_private,
            created_by_id=user.id,
        )
        self.db.add(conversation)
        self.db.flush()
        for member_user in users:
            role = models.ChatMemberRoleEnum.OWNER if member_user.id == user.id else models.ChatMemberRoleEnum.MEMBER
            self.permissions.add_member(conversation, member_user, role)
        self.db.commit()
        self.db.refresh(conversation)
        logger.info("chat.conversation.created conversation_id=%s type=%s user_id=%s", conversation.id, conversation.type.value, user.id)
        _emit_domain_event(
            self.db,
            "conversation.created",
            {"conversation_id": conversation.id, "actor_id": user.id, "tenant_id": str(user.tenant_id)},
        )
        return serialize_conversation(conversation)

    def update_conversation(
        self,
        conversation_id: str,
        payload: schemas.ChatConversationUpdate,
        user: models.User,
    ) -> schemas.ChatConversationSummary:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_manager(conversation, user)
        for field, value in payload.model_dump(exclude_unset=True).items():
            if field == "name" and isinstance(value, str):
                value = value.strip() or None
            setattr(conversation, field, value)
        self.db.commit()
        self.db.refresh(conversation)
        _emit_domain_event(
            self.db,
            "conversation.updated",
            {"conversation_id": conversation.id, "actor_id": user.id, "tenant_id": str(user.tenant_id)},
        )
        return serialize_conversation(conversation)

    def archive_conversation(self, conversation_id: str, user: models.User) -> None:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_manager(conversation, user)
        conversation.is_archived = True
        self.db.commit()
        logger.info("chat.conversation.archived conversation_id=%s user_id=%s", conversation.id, user.id)
        _emit_domain_event(
            self.db,
            "conversation.updated",
            {"conversation_id": conversation.id, "actor_id": user.id, "tenant_id": str(user.tenant_id), "archived": True},
        )


class DirectoryService:
    def __init__(self, db: Session):
        self.db = db
        self.members = MemberRepository(db)
        self.conversations = ConversationRepository(db)

    def list_users(
        self,
        user: models.User,
        *,
        search: str | None = None,
        cursor: str | None = None,
        limit: int = 100,
        team_id: str | None = None,
    ) -> schemas.ChatDirectoryPage:
        limit = min(max(limit, 1), 100)
        users = self.members.list_chat_eligible_users(
            user,
            search=search,
            cursor=cursor,
            limit=limit,
            team_id=team_id,
        )
        has_more = len(users) > limit
        page_users = users[:limit]

        conversations = self.conversations.list_for_user(user)
        direct_by_user_id: dict[str, models.ChatConversation] = {}
        direct_conversations: list[models.ChatConversation] = []
        for conversation in conversations:
            if conversation.type != models.ChatConversationTypeEnum.DIRECT:
                continue
            other_member = next((member for member in conversation.participants if member.user_id != user.id), None)
            if not other_member:
                continue
            direct_by_user_id[other_member.user_id] = conversation
            direct_conversations.append(conversation)

        conversation_ids = [conversation.id for conversation in direct_conversations]
        latest_messages = self.conversations.latest_messages_by_conversation(conversation_ids)
        unread_counts = self.conversations.unread_counts_for_user(conversation_ids, user)

        items: list[schemas.ChatDirectoryUserRead] = []
        for directory_user in page_users:
            conversation = direct_by_user_id.get(directory_user.id)
            current_membership = None
            if conversation:
                current_membership = next((member for member in conversation.participants if member.user_id == user.id), None)
            latest_message = latest_messages.get(conversation.id) if conversation else None
            items.append(
                schemas.ChatDirectoryUserRead(
                    id=directory_user.id,
                    name=directory_user.name,
                    email=directory_user.email,
                    avatar_url=directory_user.profile_image_url,
                    presence="OFFLINE",
                    role_name=directory_user.role.value if directory_user.role else None,
                    team_name=directory_user.department.name if directory_user.department else None,
                    title=directory_user.title,
                    existing_conversation_id=conversation.id if conversation else None,
                    is_favorite=bool(current_membership and current_membership.is_pinned),
                    unread_count=unread_counts.get(conversation.id, 0) if conversation else 0,
                    latest_message_preview=latest_message.content if latest_message and not latest_message.deleted_at else None,
                    last_message_at=conversation.last_message_at if conversation else None,
                )
            )
        return schemas.ChatDirectoryPage(
            items=items,
            next_cursor=page_users[-1].name if has_more and page_users else None,
        )


class MemberService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)

    def list_members(self, conversation_id: str, user: models.User) -> list[schemas.ChatMemberRead]:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        return [serialize_member(member) for member in conversation.participants]

    def add_members(
        self,
        conversation_id: str,
        payload: schemas.ChatMemberAdd,
        user: models.User,
    ) -> list[schemas.ChatMemberRead]:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_manager(conversation, user)
        if conversation.type == models.ChatConversationTypeEnum.DIRECT:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot add members to direct conversations")
        users = self.permissions.validate_chat_eligible_users(payload.user_ids, user)
        members = [self.permissions.add_member(conversation, member_user, payload.role) for member_user in users]
        self.db.commit()
        logger.info("chat.members.added conversation_id=%s user_id=%s count=%s", conversation.id, user.id, len(members))
        _emit_domain_event(
            self.db,
            "member.added",
            {
                "conversation_id": conversation.id,
                "actor_id": user.id,
                "tenant_id": str(user.tenant_id),
                "user_ids": [member.user_id for member in members],
            },
        )
        return [serialize_member(member) for member in members]

    def update_member(
        self,
        conversation_id: str,
        target_user_id: str,
        payload: schemas.ChatMemberUpdate,
        user: models.User,
    ) -> schemas.ChatMemberRead:
        conversation = self.permissions.get_conversation(conversation_id, user)
        actor = self.permissions.require_member(conversation, user)
        member = self.permissions.get_membership(conversation.id, target_user_id)
        if not member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

        updates = payload.model_dump(exclude_unset=True)
        self_updates = set(updates) <= {"is_muted", "is_pinned", "last_read_message_id"}
        if target_user_id != user.id or not self_updates:
            if actor.role not in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN}:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chat admin privileges required")
        if conversation.type == models.ChatConversationTypeEnum.DIRECT and "role" in updates:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot change roles in direct conversations")
        if updates.get("role") == models.ChatMemberRoleEnum.MEMBER and member.role == models.ChatMemberRoleEnum.OWNER:
            owner_count = sum(1 for item in conversation.participants if item.role == models.ChatMemberRoleEnum.OWNER)
            if owner_count <= 1:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot remove final owner")
        for field, value in updates.items():
            setattr(member, field, value)
            if field == "role":
                member.is_admin = value in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN}
        self.db.commit()
        self.db.refresh(member)
        return serialize_member(member)

    def remove_member(self, conversation_id: str, target_user_id: str, user: models.User) -> None:
        conversation = self.permissions.get_conversation(conversation_id, user)
        actor = self.permissions.require_member(conversation, user)
        if user.id != target_user_id and actor.role not in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chat admin privileges required")
        member = self.permissions.get_membership(conversation.id, target_user_id)
        if not member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        if member.role == models.ChatMemberRoleEnum.OWNER:
            owner_count = sum(1 for item in conversation.participants if item.role == models.ChatMemberRoleEnum.OWNER)
            if owner_count <= 1:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot remove final owner")
        self.db.delete(member)
        self.db.commit()
        logger.info("chat.member.removed conversation_id=%s actor_id=%s target_user_id=%s", conversation.id, user.id, target_user_id)
        _emit_domain_event(
            self.db,
            "member.removed",
            {"conversation_id": conversation.id, "actor_id": user.id, "tenant_id": str(user.tenant_id), "user_id": target_user_id},
        )

    def mark_read(
        self,
        conversation_id: str,
        payload: schemas.ChatReadMarkerUpdate,
        user: models.User,
    ) -> schemas.ChatMemberRead:
        conversation = self.permissions.get_conversation(conversation_id, user)
        member = self.permissions.require_member(conversation, user)
        read_at = datetime.utcnow()
        if payload.last_read_message_id:
            message = MessageRepository(self.db).get_in_conversation(payload.last_read_message_id, conversation.id)
            if not message:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid read marker")
            read_at = message.created_at
        member.last_read_message_id = payload.last_read_message_id
        member.last_read_at = read_at
        self.db.commit()
        self.db.refresh(member)
        return serialize_member(member)


class MessageService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)
        self.messages = MessageRepository(db)
        self.last_create_inserted = False

    def list_messages(self, conversation_id: str, user: models.User, cursor: str | None = None, limit: int = 50) -> schemas.ChatMessagePage:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        limit = min(max(limit, 1), 100)
        before = decode_cursor(cursor) if cursor else None
        messages = self.messages.list_page(conversation.id, before=before, limit=limit)
        has_more = len(messages) > limit
        page_items = messages[:limit]
        next_cursor = encode_cursor(page_items[-1].created_at, page_items[-1].id) if has_more and page_items else None
        return schemas.ChatMessagePage(items=[serialize_message(message) for message in reversed(page_items)], next_cursor=next_cursor, has_more=has_more)

    def _process_mentions(self, conversation: models.ChatConversation, message: models.ChatMessage, user: models.User) -> list[str]:
        tokens = {match.lower() for match in MENTION_PATTERN.findall(message.content or "")}
        if not tokens:
            return []
        mentioned_user_ids: list[str] = []
        members = conversation.participants or []
        for member in members:
            member_user = member.user
            if not member_user or member_user.status != models.UserStatusEnum.ACTIVE:
                continue
            aliases = {member.user_id.lower()}
            aliases.add((member_user.email or "").split("@")[0].lower())
            aliases.add((member_user.name or "").replace(" ", ".").lower())
            aliases.add((member_user.name or "").replace(" ", "").lower())
            if tokens & aliases and member.user_id != user.id:
                mentioned_user_ids.append(member.user_id)
        for mentioned_user_id in dict.fromkeys(mentioned_user_ids):
            self.db.add(models.MessageMention(message_id=message.id, mentioned_user_id=mentioned_user_id))
            _create_chat_notification(
                self.db,
                user_id=mentioned_user_id,
                notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
                title=f"{user.name} mentioned you",
                message=f"{user.name}: {message.content[:140]}",
                body=message.content[:240],
                deep_link=f"/chat/{conversation.id}?message={message.id}",
                related_chat_id=conversation.id,
                actor_id=user.id,
            )
        return list(dict.fromkeys(mentioned_user_ids))

    def _notify_recipients(self, conversation: models.ChatConversation, message: models.ChatMessage, user: models.User, mentioned_ids: list[str]) -> None:
        if conversation.type != models.ChatConversationTypeEnum.DIRECT and not mentioned_ids:
            return
        for member in conversation.participants:
            if member.user_id == user.id or member.is_muted:
                continue
            if conversation.type != models.ChatConversationTypeEnum.DIRECT and member.user_id not in mentioned_ids:
                continue
            _create_chat_notification(
                self.db,
                user_id=member.user_id,
                notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
                title=f"New message from {user.name}",
                message=f"{user.name}: {message.content[:140]}",
                body=message.content[:240],
                deep_link=f"/chat/{conversation.id}?message={message.id}",
                related_chat_id=conversation.id,
                actor_id=user.id,
            )

    def create_message(self, conversation_id: str, payload: schemas.ChatMessageCreate, user: models.User) -> schemas.ChatMessageRead:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        if conversation.type == models.ChatConversationTypeEnum.DIRECT:
            other_member = next((member for member in conversation.participants if member.user_id != user.id), None)
            if other_member and (not other_member.user or other_member.user.status != models.UserStatusEnum.ACTIVE):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This user is no longer active. You can view previous messages but cannot send new messages.",
                )
        check_rate_limit(f"chat:message:{user.id}", limit=30, window_seconds=60)
        client_id = payload.client_id.strip() if payload.client_id else None
        if client_id:
            existing = self.messages.get_by_client_id(conversation.id, user.id, client_id)
            if existing:
                self.last_create_inserted = False
                return serialize_message(existing)
        if payload.reply_to_message_id:
            parent = self.messages.get_in_conversation(payload.reply_to_message_id, conversation.id)
            if not parent:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid reply target")
        now = datetime.utcnow()
        message = models.ChatMessage(
            conversation_id=conversation.id,
            sender_id=user.id,
            message_type=payload.message_type,
            client_id=client_id,
            content=payload.content,
            reply_to_message_id=payload.reply_to_message_id,
            created_at=now,
            updated_at=now,
        )
        conversation.last_message_at = now
        self.db.add(message)
        self.db.flush()
        for attachment_payload in payload.attachments:
            self.db.add(
                models.MessageAttachment(
                    message_id=message.id,
                    file_name=attachment_payload.file_name,
                    original_file_name=attachment_payload.original_file_name,
                    mime_type=attachment_payload.mime_type,
                    file_size=attachment_payload.file_size,
                    storage_key=attachment_payload.storage_key,
                    url=attachment_payload.url,
                )
            )
        mentioned_ids = self._process_mentions(conversation, message, user)
        self._notify_recipients(conversation, message, user, mentioned_ids)
        _emit_domain_event(
            self.db,
            "message.created",
            {"conversation_id": conversation.id, "message_id": message.id, "actor_id": user.id, "tenant_id": str(user.tenant_id)},
        )
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if client_id:
                existing = self.messages.get_by_client_id(conversation.id, user.id, client_id)
                if existing:
                    self.last_create_inserted = False
                    return serialize_message(existing)
            raise
        self.db.refresh(message)
        self.last_create_inserted = True
        logger.info("chat.message.created conversation_id=%s message_id=%s sender_id=%s", conversation.id, message.id, user.id)
        return serialize_message(message)

    def update_message(self, message_id: str, payload: schemas.ChatMessageUpdate, user: models.User) -> schemas.ChatMessageRead:
        message = self.messages.get(message_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if message.deleted_at:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot edit a deleted message")
        conversation = self.permissions.get_conversation(message.conversation_id, user)
        self.permissions.require_member(conversation, user)
        if message.sender_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the sender can edit this message")
        message.content = payload.content
        message.edited_at = datetime.utcnow()
        _emit_domain_event(
            self.db,
            "message.updated",
            {"conversation_id": conversation.id, "message_id": message.id, "actor_id": user.id, "tenant_id": str(user.tenant_id)},
        )
        self.db.commit()
        self.db.refresh(message)
        return serialize_message(message)

    def delete_message(self, message_id: str, user: models.User) -> None:
        message = self.messages.get(message_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        conversation = self.permissions.get_conversation(message.conversation_id, user)
        member = self.permissions.require_member(conversation, user)
        if message.sender_id != user.id and member.role not in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the sender or chat admins can delete this message")
        message.deleted_at = datetime.utcnow()
        _emit_domain_event(
            self.db,
            "message.deleted",
            {"conversation_id": conversation.id, "message_id": message.id, "actor_id": user.id, "tenant_id": str(user.tenant_id)},
        )
        self.db.commit()
        logger.info("chat.message.deleted conversation_id=%s message_id=%s user_id=%s", conversation.id, message.id, user.id)

    def search_messages(
        self,
        user: models.User,
        *,
        q: str,
        conversation_id: str | None = None,
        sender_id: str | None = None,
        message_type: models.ChatMessageTypeEnum | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> schemas.ChatMessageSearchPage:
        check_rate_limit(f"chat:search:{user.id}", limit=60, window_seconds=60)
        q = q.strip()
        if len(q) < 2:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Search query is too short")
        if conversation_id:
            conversation = self.permissions.get_conversation(conversation_id, user)
            self.permissions.require_member(conversation, user)
        limit = min(max(limit, 1), 100)
        before = decode_cursor(cursor) if cursor else None
        messages = self.messages.search_accessible(
            user,
            query_text=q,
            conversation_id=conversation_id,
            sender_id=sender_id,
            message_type=message_type,
            date_from=date_from,
            date_to=date_to,
            before=before,
            limit=limit,
        )
        has_more = len(messages) > limit
        page_items = messages[:limit]
        next_cursor = encode_cursor(page_items[-1].created_at, page_items[-1].id) if has_more and page_items else None
        unread_counts = ConversationRepository(self.db).unread_counts_for_user([message.conversation_id for message in page_items], user)
        return schemas.ChatMessageSearchPage(
            items=[
                schemas.ChatMessageSearchResult(
                    message=serialize_message(message),
                    conversation=serialize_conversation(message.conversation, unread_count=unread_counts.get(message.conversation_id, 0)),
                )
                for message in page_items
            ],
            next_cursor=next_cursor,
            has_more=has_more,
        )


class ReactionService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)
        self.messages = MessageRepository(db)

    def add_reaction(self, message_id: str, payload: schemas.ChatReactionCreate, user: models.User) -> schemas.ChatMessageRead:
        message = self.messages.get(message_id)
        if not message or message.deleted_at:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        conversation = self.permissions.get_conversation(message.conversation_id, user)
        self.permissions.require_member(conversation, user)
        emoji = payload.emoji
        existing = self.messages.get_reaction(message.id, user.id, emoji)
        if not existing:
            self.db.add(models.MessageReaction(message_id=message.id, user_id=user.id, emoji=emoji))
            try:
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
        refreshed = self.messages.get(message.id)
        return serialize_message(refreshed or message)

    def remove_reaction(self, message_id: str, emoji: str, user: models.User) -> schemas.ChatMessageRead:
        message = self.messages.get(message_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        conversation = self.permissions.get_conversation(message.conversation_id, user)
        self.permissions.require_member(conversation, user)
        reaction = self.messages.get_reaction(message.id, user.id, emoji)
        if reaction:
            self.db.delete(reaction)
            self.db.commit()
        refreshed = self.messages.get(message.id)
        return serialize_message(refreshed or message)


class AttachmentService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)
        self.messages = MessageRepository(db)

    def create_attachment(
        self,
        message_id: str,
        payload: schemas.ChatAttachmentCreate,
        user: models.User,
    ) -> schemas.ChatAttachmentRead:
        message = self.messages.get(message_id)
        if not message or message.deleted_at:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        conversation = self.permissions.get_conversation(message.conversation_id, user)
        self.permissions.require_member(conversation, user)
        attachment = models.MessageAttachment(
            message_id=message.id,
            file_name=payload.file_name,
            original_file_name=payload.original_file_name,
            mime_type=payload.mime_type,
            file_size=payload.file_size,
            storage_key=payload.storage_key,
            url=payload.url,
        )
        self.db.add(attachment)
        self.db.commit()
        self.db.refresh(attachment)
        return schemas.ChatAttachmentRead.model_validate(attachment)

    async def upload_attachment(
        self,
        conversation_id: str,
        file: UploadFile,
        user: models.User,
    ) -> schemas.ChatAttachmentCreate:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        check_rate_limit(f"chat:upload:{user.id}", limit=20, window_seconds=60)
        original_name = _sanitize_filename(file.filename or "attachment")
        extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
        if extension not in ALLOWED_ATTACHMENT_EXTENSIONS:
            logger.warning("chat.attachment.rejected reason=extension user_id=%s conversation_id=%s extension=%s", user.id, conversation.id, extension)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported attachment type")
        data = await file.read()
        settings = get_settings()
        max_bytes = max(1, settings.media_max_file_size_mb) * 1024 * 1024
        if len(data) > max_bytes:
            logger.warning("chat.attachment.rejected reason=size user_id=%s conversation_id=%s bytes=%s", user.id, conversation.id, len(data))
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment is too large")
        detected_mime = mimetypes.guess_type(original_name)[0] or file.content_type or "application/octet-stream"
        declared_mime = (file.content_type or "").split(";", 1)[0].strip().lower()
        if declared_mime and not _attachment_mime_allowed(declared_mime):
            logger.warning("chat.attachment.rejected reason=declared_mime user_id=%s conversation_id=%s mime=%s", user.id, conversation.id, declared_mime)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported attachment MIME type")
        if declared_mime and detected_mime != declared_mime:
            if not (detected_mime.startswith("image/") and declared_mime.startswith("image/")):
                logger.warning("chat.attachment.rejected reason=mime_mismatch user_id=%s conversation_id=%s declared=%s detected=%s", user.id, conversation.id, declared_mime, detected_mime)
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment MIME type does not match file extension")
        if not _attachment_mime_allowed(detected_mime):
            logger.warning("chat.attachment.rejected reason=detected_mime user_id=%s conversation_id=%s mime=%s", user.id, conversation.id, detected_mime)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported attachment MIME type")
        if not _attachment_content_allowed(detected_mime, data):
            logger.warning("chat.attachment.rejected reason=signature user_id=%s conversation_id=%s mime=%s", user.id, conversation.id, detected_mime)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment content does not match file type")
        stored_name = f"{uuid4().hex}.{extension}"
        storage_key = f"chat/{conversation.tenant_id}/{conversation.id}/{stored_name}"
        adapter = LocalAdapter(str(Path(settings.media_root)), settings.media_public_base)
        stored = adapter.save(data, storage_key, content_type=detected_mime)
        return schemas.ChatAttachmentCreate(
            file_name=stored_name,
            original_file_name=original_name,
            mime_type=stored.mime_type,
            file_size=stored.size,
            storage_key=stored.path,
            url=stored.public_url,
        )


class PinService:
    def __init__(self, db: Session):
        self.db = db
        self.permissions = ChatPermissionService(db)
        self.messages = MessageRepository(db)

    def _serialize_pin(self, pin: models.PinnedMessage) -> schemas.ChatPinnedMessageRead:
        return schemas.ChatPinnedMessageRead(
            id=pin.id,
            conversation_id=pin.conversation_id,
            message_id=pin.message_id,
            pinned_by=pin.pinned_by,
            created_at=pin.created_at,
            message=serialize_message(pin.message),
        )

    def list_pins(self, conversation_id: str, user: models.User) -> list[schemas.ChatPinnedMessageRead]:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_member(conversation, user)
        return [self._serialize_pin(pin) for pin in self.messages.list_pins(conversation.id)]

    def pin_message(self, conversation_id: str, message_id: str, user: models.User) -> schemas.ChatPinnedMessageRead:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_manager(conversation, user)
        message = self.messages.get_in_conversation(message_id, conversation.id)
        if not message or message.deleted_at:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        pin = self.messages.get_pin(conversation.id, message.id)
        if not pin:
            pin = models.PinnedMessage(conversation_id=conversation.id, message_id=message.id, pinned_by=user.id)
            self.db.add(pin)
            self.db.commit()
            self.db.refresh(pin)
        return self._serialize_pin(pin)

    def unpin_message(self, conversation_id: str, message_id: str, user: models.User) -> None:
        conversation = self.permissions.get_conversation(conversation_id, user)
        self.permissions.require_manager(conversation, user)
        pin = self.messages.get_pin(conversation.id, message_id)
        if pin:
            self.db.delete(pin)
            self.db.commit()
