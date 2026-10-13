from .. import models, schemas


def serialize_member(member: models.ChatParticipant) -> schemas.ChatMemberRead:
    user = member.user
    return schemas.ChatMemberRead(
        id=member.id,
        conversation_id=member.conversation_id,
        user_id=member.user_id,
        name=user.name if user else "Unknown user",
        email=user.email if user else "",
        avatar_url=user.profile_image_url if user else None,
        title=user.title if user else None,
        department_name=user.department.name if user and user.department else None,
        account_status=user.status if user else models.UserStatusEnum.DEACTIVATED,
        app_role=user.role if user else models.RoleEnum.USER,
        role=member.role,
        joined_at=member.joined_at,
        last_read_message_id=member.last_read_message_id,
        last_read_at=member.last_read_at,
        is_muted=member.is_muted,
        is_pinned=member.is_pinned,
    )


def serialize_message(message: models.ChatMessage) -> schemas.ChatMessageRead:
    sender = message.sender
    return schemas.ChatMessageRead(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender_name=sender.name if sender else "Unknown user",
        sender_role=sender.role if sender else models.RoleEnum.USER,
        message_type=message.message_type,
        client_id=message.client_id,
        content="" if message.deleted_at else message.content,
        reply_to_message_id=message.reply_to_message_id,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
        created_at=message.created_at,
        updated_at=message.updated_at,
        reactions=list(message.reactions or []),
        attachments=list(message.attachments or []),
        mentions=[mention.mentioned_user_id for mention in message.mentions or []],
    )


def serialize_conversation(
    conversation: models.ChatConversation,
    last_message: models.ChatMessage | None = None,
    unread_count: int = 0,
) -> schemas.ChatConversationSummary:
    return schemas.ChatConversationSummary(
        id=conversation.id,
        tenant_id=str(conversation.tenant_id),
        name=conversation.name,
        description=conversation.description,
        avatar_url=conversation.avatar_url,
        project_id=conversation.project_id,
        team_id=conversation.team_id,
        type=conversation.type,
        is_private=conversation.is_private,
        is_archived=conversation.is_archived,
        created_by_id=conversation.created_by_id,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        last_message_at=conversation.last_message_at,
        members=[serialize_member(member) for member in conversation.participants],
        unread_count=unread_count,
        last_message=serialize_message(last_message) if last_message else None,
    )
