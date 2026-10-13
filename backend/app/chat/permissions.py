from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .. import models
from .repositories import ConversationRepository, MemberRepository


class ChatPermissionService:
    def __init__(self, db: Session):
        self.db = db
        self.conversations = ConversationRepository(db)
        self.members = MemberRepository(db)

    def get_conversation(self, conversation_id: str, user: models.User) -> models.ChatConversation:
        conversation = self.conversations.get_for_user(conversation_id, user)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        return conversation

    def get_membership(self, conversation_id: str, user_id: str) -> models.ChatParticipant | None:
        return self.members.get_membership(conversation_id, user_id)

    def require_member(self, conversation: models.ChatConversation, user: models.User) -> models.ChatParticipant:
        member = self.get_membership(conversation.id, user.id)
        if not member:
            if conversation.type == models.ChatConversationTypeEnum.SPACE and not conversation.is_private:
                return self.add_member(conversation, user, models.ChatMemberRoleEnum.MEMBER)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Conversation access denied")
        return member

    def require_manager(self, conversation: models.ChatConversation, user: models.User) -> models.ChatParticipant:
        member = self.require_member(conversation, user)
        if member.role not in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chat admin privileges required")
        return member

    def add_member(
        self,
        conversation: models.ChatConversation,
        user: models.User,
        role: models.ChatMemberRoleEnum,
    ) -> models.ChatParticipant:
        existing = self.get_membership(conversation.id, user.id)
        if existing:
            return existing
        member = models.ChatParticipant(
            conversation_id=conversation.id,
            user_id=user.id,
            role=role,
            is_admin=role in {models.ChatMemberRoleEnum.OWNER, models.ChatMemberRoleEnum.ADMIN},
        )
        self.db.add(member)
        self.db.flush()
        return member

    def validate_same_tenant_users(self, user_ids: list[str], tenant_id) -> list[models.User]:
        unique_ids = list(dict.fromkeys(user_ids))
        users = self.members.list_same_tenant_users(unique_ids, tenant_id)
        if len(users) != len(unique_ids):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more users are invalid")
        return users

    def validate_chat_eligible_users(self, user_ids: list[str], current_user: models.User) -> list[models.User]:
        unique_ids = list(dict.fromkeys(user_ids))
        users = self.members.list_chat_eligible_users_by_ids(unique_ids, current_user)
        if len(users) != len(unique_ids):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more users are inactive or invalid")
        return users
