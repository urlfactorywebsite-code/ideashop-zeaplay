import re
from datetime import datetime
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..chat.repositories import ConversationRepository
from ..chat.services import build_direct_key
from ..database import get_db
from ..dependencies import get_current_active_user
from ..integrations import trigger_n8n_event
from ..services import notifications as notification_service
from ..services.badge_engine import BadgeEvent, process_badge_event

router = APIRouter(prefix="/comments", tags=["comments"])
MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_.-]{2,80})")


def _get_task(db: Session, task_id: str) -> models.Task:
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _ensure_comment_access(task: models.Task, user: models.User) -> None:
    from .tasks import _ensure_task_access
    _ensure_task_access(task, user)


def _mention_aliases(user: models.User) -> set[str]:
    aliases = {user.id.lower()}
    if user.email:
        aliases.add(user.email.lower())
        aliases.add(user.email.split("@")[0].lower())
    if user.employer_id:
        aliases.add(user.employer_id.lower())
    if user.name:
        name = user.name.strip().lower()
        aliases.add(name.replace(" ", "."))
        aliases.add(name.replace(" ", ""))
        for part in name.split():
            if len(part) >= 2:
                aliases.add(part)
    return {alias for alias in aliases if alias}


def _resolve_mentioned_users(db: Session, content: str, actor: models.User) -> list[models.User]:
    tokens = {match.lower() for match in MENTION_PATTERN.findall(content or "")}
    if not tokens:
        return []

    users = db.execute(
        select(models.User).where(
            models.User.tenant_id == actor.tenant_id,
            models.User.status == models.UserStatusEnum.ACTIVE,
            models.User.id != actor.id,
        )
    ).scalars().all()
    mentioned = [user for user in users if tokens & _mention_aliases(user)]
    return list({user.id: user for user in mentioned}.values())


def _find_direct_conversation(db: Session, actor: models.User, target: models.User) -> models.ChatConversation | None:
    direct_key = build_direct_key(actor.id, target.id)
    conversations = ConversationRepository(db)
    return conversations.find_direct_by_key(actor.tenant_id, direct_key, actor) or conversations.find_direct_between(actor, target)


def _ensure_direct_conversation(db: Session, actor: models.User, target: models.User) -> models.ChatConversation:
    conversation = _find_direct_conversation(db, actor, target)
    direct_key = build_direct_key(actor.id, target.id)
    if conversation:
        if not conversation.direct_key:
            conversation.direct_key = direct_key
        return conversation

    conversation = models.ChatConversation(
        tenant_id=actor.tenant_id,
        type=models.ChatConversationTypeEnum.DIRECT,
        direct_key=direct_key,
        is_private=True,
        created_by_id=actor.id,
    )
    db.add(conversation)
    db.flush()
    db.add_all(
        [
            models.ChatParticipant(
                conversation_id=conversation.id,
                user_id=actor.id,
                role=models.ChatMemberRoleEnum.OWNER,
                is_admin=True,
            ),
            models.ChatParticipant(
                conversation_id=conversation.id,
                user_id=target.id,
                role=models.ChatMemberRoleEnum.MEMBER,
                is_admin=False,
            ),
        ]
    )
    db.flush()
    return conversation


def _bridge_comment_mentions_to_chat(
    db: Session,
    *,
    task: models.Task,
    comment: models.Comment,
    actor: models.User,
) -> None:
    mentioned_users = _resolve_mentioned_users(db, comment.content, actor)
    if not mentioned_users:
        return

    for mentioned_user in mentioned_users:
        try:
            _ensure_comment_access(task, mentioned_user)
        except HTTPException:
            # A mention must not copy private task content into a new chat.
            continue
        conversation = _ensure_direct_conversation(db, actor, mentioned_user)
        now = datetime.utcnow()
        message = models.ChatMessage(
            conversation_id=conversation.id,
            sender_id=actor.id,
            message_type=models.ChatMessageTypeEnum.TEXT,
            content=(
                f"{actor.name} mentioned you in a task comment on \"{task.title}\".\n\n"
                f"{comment.content}\n\n"
                f"Open task: /tasks/{task.id}"
            ),
            created_at=now,
            updated_at=now,
        )
        conversation.last_message_at = now
        db.add(message)
        db.flush()
        db.add(models.MessageMention(message_id=message.id, mentioned_user_id=mentioned_user.id))
        notification_service.create_notification(
            db,
            user_id=mentioned_user.id,
            actor_id=actor.id,
            notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
            title=f"{actor.name} mentioned you",
            message=f"{actor.name} mentioned you in a task comment.",
            body=comment.content[:240],
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link=f"/chat/{conversation.id}?message={message.id}",
            related_task_id=task.id,
            related_chat_id=conversation.id,
        )


@router.get("/task/{task_id}", response_model=List[schemas.CommentRead])
def list_comments_for_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> List[schemas.CommentRead]:
    task = _get_task(db, task_id)
    _ensure_comment_access(task, current_user)

    stmt = (
        select(models.Comment)
        .where(models.Comment.task_id == task_id)
        .order_by(models.Comment.created_at.desc())
    )
    return db.execute(stmt).scalars().all()


@router.post("", response_model=schemas.CommentRead, status_code=status.HTTP_201_CREATED)
def create_comment(
    payload: schemas.CommentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.CommentRead:
    task = _get_task(db, payload.task_id)

    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER} and payload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only comment as yourself")

    _ensure_comment_access(task, current_user)

    commenter = db.get(models.User, payload.user_id)
    if (not commenter or commenter.status != models.UserStatusEnum.ACTIVE
            or str(commenter.tenant_id) != str(current_user.tenant_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment author not found")
    _ensure_comment_access(task, commenter)
    comment = models.Comment(task_id=payload.task_id, user_id=payload.user_id, content=payload.content)
    db.add(comment)
    db.flush()

    commenter_name = commenter.name if commenter else "Someone"
    recipient_ids = {task.assigned_to_id, task.created_by_id}
    recipient_ids.update(follower.id for follower in task.followers)
    recipient_ids.update(subtask.assigned_to_id for subtask in task.subtasks)
    if task.project:
        recipient_ids.update(member.user_id for member in task.project.members
                             if member.role == models.ProjectMemberRoleEnum.MANAGER)
    recipient_ids.discard(None)
    if payload.user_id in recipient_ids:
        recipient_ids.remove(payload.user_id)
    for recipient_id in recipient_ids:
        notification_service.create_notification(
            db,
            user_id=recipient_id,
            actor_id=str(current_user.id),
            notification_type=models.NotificationTypeEnum.COMMENT_ADDED,
            message=f"{commenter_name} commented on: '{task.title}'.",
            title="New comment",
            body=payload.content,
            entity_type=models.NotificationEntityTypeEnum.TASK,
            entity_id=task.id,
            deep_link=f"/tasks/{task.id}",
            related_task_id=task.id,
        )

    if commenter:
        _bridge_comment_mentions_to_chat(db, task=task, comment=comment, actor=commenter)

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="comment",
            event="created",
            actor_id=current_user.id,
            assigned_to_id=task.assigned_to_id,
            created_by_id=payload.user_id,
            priority=task.priority.value,
        ),
    )

    db.commit()
    db.refresh(comment)

    background_tasks.add_task(
        trigger_n8n_event,
        "comment.created",
        {
            "comment": schemas.CommentRead.model_validate(comment).model_dump(),
            "taskId": task.id,
        },
    )

    return comment


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    comment = db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    task = _get_task(db, comment.task_id)
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER} and comment.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own comments")
    _ensure_comment_access(task, current_user)

    comment_snapshot = schemas.CommentRead.model_validate(comment).model_dump()

    process_badge_event(
        db,
        event=BadgeEvent(
            entity="comment",
            event="deleted",
            actor_id=current_user.id,
            assigned_to_id=task.assigned_to_id,
            created_by_id=comment.user_id,
            priority=task.priority.value,
        ),
    )
    db.delete(comment)
    db.commit()

    background_tasks.add_task(
        trigger_n8n_event,
        "comment.deleted",
        {"commentId": comment_id, "taskId": task.id, "comment": comment_snapshot},
    )
