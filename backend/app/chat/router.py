from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..ws import chat as chat_ws
from .services import AttachmentService, ConversationService, DirectoryService, MemberService, MessageService, PinService, ReactionService

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/conversations", response_model=list[schemas.ChatConversationSummary])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ConversationService(db).list_conversations(current_user)


@router.get("/users", response_model=schemas.ChatDirectoryPage)
def list_chat_users(
    search: str | None = Query(default=None, max_length=255),
    cursor: str | None = Query(default=None, max_length=255),
    limit: int = Query(default=100, ge=1, le=100),
    team_id: str | None = Query(default=None, max_length=255),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return DirectoryService(db).list_users(
        current_user,
        search=search,
        cursor=cursor,
        limit=limit,
        team_id=team_id,
    )


@router.post("/conversations", response_model=schemas.ChatConversationSummary, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: schemas.ChatConversationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ConversationService(db).create_conversation(payload, current_user)


@router.post("/direct", response_model=schemas.ChatConversationSummary, status_code=status.HTTP_201_CREATED)
def create_direct_conversation(
    payload: schemas.ChatDirectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ConversationService(db).create_direct(payload, current_user)


@router.get("/conversations/{conversation_id}", response_model=schemas.ChatConversationDetail)
def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ConversationService(db).get_conversation(conversation_id, current_user)


@router.patch("/conversations/{conversation_id}", response_model=schemas.ChatConversationSummary)
def update_conversation(
    conversation_id: str,
    payload: schemas.ChatConversationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ConversationService(db).update_conversation(conversation_id, payload, current_user)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    ConversationService(db).archive_conversation(conversation_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/conversations/{conversation_id}/members", response_model=list[schemas.ChatMemberRead])
def list_members(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MemberService(db).list_members(conversation_id, current_user)


@router.post("/conversations/{conversation_id}/members", response_model=list[schemas.ChatMemberRead], status_code=status.HTTP_201_CREATED)
def add_members(
    conversation_id: str,
    payload: schemas.ChatMemberAdd,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MemberService(db).add_members(conversation_id, payload, current_user)


@router.delete("/conversations/{conversation_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    conversation_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    MemberService(db).remove_member(conversation_id, user_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/conversations/{conversation_id}/members/{user_id}", response_model=schemas.ChatMemberRead)
def update_member(
    conversation_id: str,
    user_id: str,
    payload: schemas.ChatMemberUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MemberService(db).update_member(conversation_id, user_id, payload, current_user)


@router.post("/conversations/{conversation_id}/read", response_model=schemas.ChatMemberRead)
def mark_conversation_read(
    conversation_id: str,
    payload: schemas.ChatReadMarkerUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MemberService(db).mark_read(conversation_id, payload, current_user)


@router.get("/conversations/{conversation_id}/messages", response_model=schemas.ChatMessagePage)
def list_messages(
    conversation_id: str,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MessageService(db).list_messages(conversation_id, current_user, cursor=cursor, limit=limit)


@router.get("/messages/search", response_model=schemas.ChatMessageSearchPage)
def search_messages(
    q: str = Query(min_length=2, max_length=255),
    conversation_id: str | None = None,
    sender_id: str | None = None,
    message_type: models.ChatMessageTypeEnum | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MessageService(db).search_messages(
        current_user,
        q=q,
        conversation_id=conversation_id,
        sender_id=sender_id,
        message_type=message_type,
        date_from=date_from,
        date_to=date_to,
        cursor=cursor,
        limit=limit,
    )


@router.post("/conversations/{conversation_id}/messages", response_model=schemas.ChatMessageRead, status_code=status.HTTP_201_CREATED)
def create_message(
    conversation_id: str,
    payload: schemas.ChatMessageCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    service = MessageService(db)
    message = service.create_message(conversation_id, payload, current_user)
    if service.last_create_inserted:
        background_tasks.add_task(
            chat_ws.manager.broadcast_conversation,
            conversation_id,
            "message:new",
            chat_ws._message_payload(message, payload.client_id),
        )
        background_tasks.add_task(chat_ws._broadcast_unread, conversation_id)
    return message


@router.patch("/messages/{message_id}", response_model=schemas.ChatMessageRead)
def update_message(
    message_id: str,
    payload: schemas.ChatMessageUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return MessageService(db).update_message(message_id, payload, current_user)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    MessageService(db).delete_message(message_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/messages/{message_id}/reactions", response_model=schemas.ChatMessageRead)
def add_message_reaction(
    message_id: str,
    payload: schemas.ChatReactionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ReactionService(db).add_reaction(message_id, payload, current_user)


@router.delete("/messages/{message_id}/reactions/{emoji}", response_model=schemas.ChatMessageRead)
def remove_message_reaction(
    message_id: str,
    emoji: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return ReactionService(db).remove_reaction(message_id, emoji, current_user)


@router.post("/messages/{message_id}/attachments", response_model=schemas.ChatAttachmentRead, status_code=status.HTTP_201_CREATED)
def create_message_attachment(
    message_id: str,
    payload: schemas.ChatAttachmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return AttachmentService(db).create_attachment(message_id, payload, current_user)


@router.post("/conversations/{conversation_id}/attachments", response_model=schemas.ChatAttachmentCreate)
async def upload_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return await AttachmentService(db).upload_attachment(conversation_id, file, current_user)


@router.get("/conversations/{conversation_id}/pins", response_model=list[schemas.ChatPinnedMessageRead])
def list_pins(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return PinService(db).list_pins(conversation_id, current_user)


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/pin",
    response_model=schemas.ChatPinnedMessageRead,
)
def pin_message(
    conversation_id: str,
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    return PinService(db).pin_message(conversation_id, message_id, current_user)


@router.delete("/conversations/{conversation_id}/messages/{message_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def unpin_message(
    conversation_id: str,
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    PinService(db).unpin_message(conversation_id, message_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
