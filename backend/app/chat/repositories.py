from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy import and_, case, desc, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import models


GLOBAL_CHAT_ROLES = {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER}


def can_use_global_chat_directory(user: models.User) -> bool:
    return user.role in GLOBAL_CHAT_ROLES


class ConversationRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_for_user(self, user: models.User) -> list[models.ChatConversation]:
        return self.db.execute(
            select(models.ChatConversation)
            .join(models.ChatParticipant)
            .options(
                selectinload(models.ChatConversation.participants).selectinload(models.ChatParticipant.user),
                selectinload(models.ChatConversation.participants)
                .selectinload(models.ChatParticipant.user)
                .selectinload(models.User.department),
            )
            .where(
                models.ChatConversation.is_archived.is_(False),
                models.ChatParticipant.user_id == user.id,
            )
            .order_by(desc(models.ChatConversation.last_message_at), desc(models.ChatConversation.updated_at))
        ).scalars().unique().all()

    def get_for_user(self, conversation_id: str, user: models.User) -> models.ChatConversation | None:
        membership_exists = exists().where(
            models.ChatParticipant.conversation_id == models.ChatConversation.id,
            models.ChatParticipant.user_id == user.id,
        )
        return self.db.execute(
            select(models.ChatConversation)
            .options(
                selectinload(models.ChatConversation.participants).selectinload(models.ChatParticipant.user),
                selectinload(models.ChatConversation.participants)
                .selectinload(models.ChatParticipant.user)
                .selectinload(models.User.department),
            )
            .where(
                models.ChatConversation.id == conversation_id,
                models.ChatConversation.is_archived.is_(False),
                or_(models.ChatConversation.tenant_id == user.tenant_id, membership_exists),
            )
        ).scalars().first()

    def find_direct_between(self, user: models.User, target: models.User) -> models.ChatConversation | None:
        participant_count = func.count(models.ChatParticipant.user_id)
        matched_count = func.sum(
            case((models.ChatParticipant.user_id.in_([user.id, target.id]), 1), else_=0)
        )

        conversation_id = self.db.execute(
            select(models.ChatConversation.id)
            .join(models.ChatParticipant)
            .where(
                models.ChatConversation.type == models.ChatConversationTypeEnum.DIRECT,
                models.ChatConversation.is_archived.is_(False),
            )
            .group_by(models.ChatConversation.id)
            .having(and_(participant_count == 2, matched_count == 2))
            .limit(1)
        ).scalar_one_or_none()
        if not conversation_id:
            return None
        return self.get_for_user(conversation_id, user)

    def find_direct_by_key(self, tenant_id, direct_key: str, user: models.User) -> models.ChatConversation | None:
        conversation_id = self.db.execute(
            select(models.ChatConversation.id)
            .join(models.ChatParticipant)
            .where(
                models.ChatConversation.type == models.ChatConversationTypeEnum.DIRECT,
                models.ChatConversation.direct_key == direct_key,
                models.ChatConversation.is_archived.is_(False),
                models.ChatParticipant.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not conversation_id:
            return None
        return self.get_for_user(conversation_id, user)

    def latest_messages_by_conversation(
        self,
        conversation_ids: Iterable[str],
    ) -> dict[str, models.ChatMessage]:
        ids = list(conversation_ids)
        if not ids:
            return {}

        ranked_messages = (
            select(
                models.ChatMessage.id.label("id"),
                func.row_number()
                .over(
                    partition_by=models.ChatMessage.conversation_id,
                    order_by=(desc(models.ChatMessage.created_at), desc(models.ChatMessage.id)),
                )
                .label("row_number"),
            )
            .where(
                models.ChatMessage.conversation_id.in_(ids),
                models.ChatMessage.deleted_at.is_(None),
            )
            .subquery()
        )

        messages = self.db.execute(
            select(models.ChatMessage)
            .options(
                selectinload(models.ChatMessage.sender),
                selectinload(models.ChatMessage.reactions),
                selectinload(models.ChatMessage.attachments),
                selectinload(models.ChatMessage.mentions),
            )
            .join(ranked_messages, ranked_messages.c.id == models.ChatMessage.id)
            .where(ranked_messages.c.row_number == 1)
        ).scalars().all()
        return {message.conversation_id: message for message in messages}

    def unread_counts_for_user(
        self,
        conversation_ids: Iterable[str],
        user: models.User,
    ) -> dict[str, int]:
        ids = list(conversation_ids)
        if not ids:
            return {}

        rows = self.db.execute(
            select(models.ChatMessage.conversation_id, func.count(models.ChatMessage.id))
            .join(
                models.ChatParticipant,
                and_(
                    models.ChatParticipant.conversation_id == models.ChatMessage.conversation_id,
                    models.ChatParticipant.user_id == user.id,
                ),
            )
            .where(
                models.ChatMessage.conversation_id.in_(ids),
                models.ChatMessage.deleted_at.is_(None),
                models.ChatMessage.sender_id != user.id,
                or_(
                    models.ChatParticipant.last_read_at.is_(None),
                    models.ChatMessage.created_at > models.ChatParticipant.last_read_at,
                ),
            )
            .group_by(models.ChatMessage.conversation_id)
        ).all()
        return {conversation_id: int(count) for conversation_id, count in rows}

    def unread_counts_for_conversation_members(self, conversation_id: str) -> dict[str, int]:
        member_ids = self.db.execute(
            select(models.ChatParticipant.user_id).where(models.ChatParticipant.conversation_id == conversation_id)
        ).scalars().all()
        counts = {user_id: 0 for user_id in member_ids}
        if not counts:
            return counts

        rows = self.db.execute(
            select(models.ChatParticipant.user_id, func.count(models.ChatMessage.id))
            .join(
                models.ChatMessage,
                and_(
                    models.ChatMessage.conversation_id == models.ChatParticipant.conversation_id,
                    models.ChatMessage.deleted_at.is_(None),
                    models.ChatMessage.sender_id != models.ChatParticipant.user_id,
                    or_(
                        models.ChatParticipant.last_read_at.is_(None),
                        models.ChatMessage.created_at > models.ChatParticipant.last_read_at,
                    ),
                ),
            )
            .where(models.ChatParticipant.conversation_id == conversation_id)
            .group_by(models.ChatParticipant.user_id)
        ).all()
        counts.update({user_id: int(count) for user_id, count in rows})
        return counts


class MemberRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_membership(self, conversation_id: str, user_id: str) -> models.ChatParticipant | None:
        return self.db.execute(
            select(models.ChatParticipant).where(
                models.ChatParticipant.conversation_id == conversation_id,
                models.ChatParticipant.user_id == user_id,
            )
        ).scalars().first()

    def list_same_tenant_users(self, user_ids: list[str], tenant_id) -> list[models.User]:
        return self.db.execute(
            select(models.User).where(models.User.id.in_(user_ids), models.User.tenant_id == tenant_id)
        ).scalars().all()

    def chat_eligible_users_query(self, current_user: models.User, *, include_current_user: bool = False):
        query = (
            select(models.User)
            .where(models.User.status == models.UserStatusEnum.ACTIVE)
        )
        if not can_use_global_chat_directory(current_user):
            query = query.where(models.User.tenant_id == current_user.tenant_id)
        if not include_current_user:
            query = query.where(models.User.id != current_user.id)
        return query

    def list_chat_eligible_users(
        self,
        current_user: models.User,
        *,
        search: str | None = None,
        team_id: str | None = None,
        limit: int = 100,
        cursor: str | None = None,
        include_current_user: bool = False,
    ) -> list[models.User]:
        query = self.chat_eligible_users_query(current_user, include_current_user=include_current_user)
        if search:
            needle = f"%{search.strip()}%"
            query = query.where(
                or_(
                    models.User.name.ilike(needle),
                    models.User.email.ilike(needle),
                    models.User.title.ilike(needle),
                    models.User.employer_id.ilike(needle),
                )
            )
        if team_id:
            query = query.where(models.User.department_id == team_id)
        if cursor:
            query = query.where(models.User.name > cursor)
        query = query.order_by(models.User.name.asc(), models.User.id.asc()).limit(limit + 1)
        return self.db.execute(query).scalars().all()

    def list_chat_eligible_users_by_ids(self, user_ids: list[str], current_user: models.User) -> list[models.User]:
        unique_ids = list(dict.fromkeys(user_ids))
        if not unique_ids:
            return []
        return self.db.execute(
            self.chat_eligible_users_query(current_user, include_current_user=True).where(models.User.id.in_(unique_ids))
        ).scalars().all()


class MessageRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_page(
        self,
        conversation_id: str,
        *,
        before: tuple[datetime, str] | None,
        limit: int,
    ) -> list[models.ChatMessage]:
        query = (
            select(models.ChatMessage)
            .options(
                selectinload(models.ChatMessage.sender),
                selectinload(models.ChatMessage.reactions),
                selectinload(models.ChatMessage.attachments),
                selectinload(models.ChatMessage.mentions),
            )
            .where(models.ChatMessage.conversation_id == conversation_id)
            .order_by(desc(models.ChatMessage.created_at), desc(models.ChatMessage.id))
            .limit(limit + 1)
        )
        if before:
            created_at, message_id = before
            query = query.where(
                or_(
                    models.ChatMessage.created_at < created_at,
                    and_(models.ChatMessage.created_at == created_at, models.ChatMessage.id < message_id),
                )
            )
        return self.db.execute(query).scalars().all()

    def get(self, message_id: str) -> models.ChatMessage | None:
        return self.db.execute(
            select(models.ChatMessage)
            .options(
                selectinload(models.ChatMessage.sender),
                selectinload(models.ChatMessage.reactions),
                selectinload(models.ChatMessage.attachments),
                selectinload(models.ChatMessage.mentions),
            )
            .where(models.ChatMessage.id == message_id)
        ).scalars().first()

    def get_by_client_id(self, conversation_id: str, sender_id: str, client_id: str) -> models.ChatMessage | None:
        return self.db.execute(
            select(models.ChatMessage)
            .options(
                selectinload(models.ChatMessage.sender),
                selectinload(models.ChatMessage.reactions),
                selectinload(models.ChatMessage.attachments),
                selectinload(models.ChatMessage.mentions),
            )
            .where(
                models.ChatMessage.conversation_id == conversation_id,
                models.ChatMessage.sender_id == sender_id,
                models.ChatMessage.client_id == client_id,
            )
        ).scalars().first()

    def get_in_conversation(self, message_id: str, conversation_id: str) -> models.ChatMessage | None:
        return self.db.execute(
            select(models.ChatMessage).where(
                models.ChatMessage.id == message_id,
                models.ChatMessage.conversation_id == conversation_id,
            )
        ).scalars().first()

    def get_reaction(self, message_id: str, user_id: str, emoji: str) -> models.MessageReaction | None:
        return self.db.execute(
            select(models.MessageReaction).where(
                models.MessageReaction.message_id == message_id,
                models.MessageReaction.user_id == user_id,
                models.MessageReaction.emoji == emoji,
            )
        ).scalars().first()

    def get_attachment(self, attachment_id: str) -> models.MessageAttachment | None:
        return self.db.execute(
            select(models.MessageAttachment).where(models.MessageAttachment.id == attachment_id)
        ).scalars().first()

    def search_accessible(
        self,
        user: models.User,
        *,
        query_text: str,
        conversation_id: str | None,
        sender_id: str | None,
        message_type: models.ChatMessageTypeEnum | None,
        date_from: datetime | None,
        date_to: datetime | None,
        before: tuple[datetime, str] | None,
        limit: int,
    ) -> list[models.ChatMessage]:
        query = (
            select(models.ChatMessage)
            .join(models.ChatConversation)
            .join(
                models.ChatParticipant,
                models.ChatParticipant.conversation_id == models.ChatConversation.id,
            )
            .options(
                selectinload(models.ChatMessage.sender),
                selectinload(models.ChatMessage.reactions),
                selectinload(models.ChatMessage.attachments),
                selectinload(models.ChatMessage.mentions),
                selectinload(models.ChatMessage.conversation)
                .selectinload(models.ChatConversation.participants)
                .selectinload(models.ChatParticipant.user),
            )
            .where(
                models.ChatConversation.is_archived.is_(False),
                models.ChatParticipant.user_id == user.id,
                models.ChatMessage.deleted_at.is_(None),
            )
            .order_by(desc(models.ChatMessage.created_at), desc(models.ChatMessage.id))
            .limit(limit + 1)
        )
        if query_text:
            query = query.where(models.ChatMessage.content.ilike(f"%{query_text}%"))
        if conversation_id:
            query = query.where(models.ChatMessage.conversation_id == conversation_id)
        if sender_id:
            query = query.where(models.ChatMessage.sender_id == sender_id)
        if message_type:
            query = query.where(models.ChatMessage.message_type == message_type)
        if date_from:
            query = query.where(models.ChatMessage.created_at >= date_from)
        if date_to:
            query = query.where(models.ChatMessage.created_at <= date_to)
        if before:
            created_at, message_id = before
            query = query.where(
                or_(
                    models.ChatMessage.created_at < created_at,
                    and_(models.ChatMessage.created_at == created_at, models.ChatMessage.id < message_id),
                )
            )
        return self.db.execute(query).scalars().unique().all()

    def get_pin(self, conversation_id: str, message_id: str) -> models.PinnedMessage | None:
        return self.db.execute(
            select(models.PinnedMessage)
            .options(selectinload(models.PinnedMessage.message).selectinload(models.ChatMessage.sender))
            .where(
                models.PinnedMessage.conversation_id == conversation_id,
                models.PinnedMessage.message_id == message_id,
            )
        ).scalars().first()

    def list_pins(self, conversation_id: str) -> list[models.PinnedMessage]:
        return self.db.execute(
            select(models.PinnedMessage)
            .options(
                selectinload(models.PinnedMessage.message).selectinload(models.ChatMessage.sender),
                selectinload(models.PinnedMessage.message).selectinload(models.ChatMessage.reactions),
                selectinload(models.PinnedMessage.message).selectinload(models.ChatMessage.attachments),
                selectinload(models.PinnedMessage.message).selectinload(models.ChatMessage.mentions),
            )
            .where(models.PinnedMessage.conversation_id == conversation_id)
            .order_by(desc(models.PinnedMessage.created_at))
        ).scalars().all()
