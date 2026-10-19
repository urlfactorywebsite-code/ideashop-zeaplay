"""Capture ORM mutations in the owning transaction, including internal task producers.

ORM task bulk mutations are captured below; direct Connection SQL needs explicit intent.
"""
import logging

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from .. import models
from ..tickets.models import Ticket, TicketComment, TicketParticipant
from .contracts import Event, durable_enabled
from .outbox import enqueue
from .transport import publish

TASK_MUTATIONS = (models.Task, models.Subtask, models.SubtaskDependency, models.TimeEntry)
logger = logging.getLogger("zeaplay.realtime")


def stage_after_commit(db, envelope):
    transaction = db.get_nested_transaction() or db.get_transaction()
    db.info.setdefault("realtime_after_commit", []).append((transaction, envelope))


def describe(db, obj, connection):
    if isinstance(obj, models.ChatMessage):
        tenant = connection.scalar(select(models.ChatConversation.tenant_id).where(models.ChatConversation.id == obj.conversation_id))
        kind = "message:new" if obj in db.new else "message:deleted" if obj.deleted_at else "message:updated"
        return Event(tenant_id=str(tenant), resource_type="chat", resource_id=obj.conversation_id,
                     actor_id=obj.sender_id if obj in db.new else None, event_type=kind, payload={"message_id": obj.id}) if tenant else None
    if isinstance(obj, TASK_MUTATIONS):
        task_id = obj.id if isinstance(obj, models.Task) else obj.task_id
        if task_id is None and isinstance(obj, models.TimeEntry):
            task_id = connection.scalar(select(models.Subtask.task_id).where(models.Subtask.id == obj.subtask_id))
        task = obj if isinstance(obj, models.Task) else db.get(models.Task, task_id)
        if not task:
            return None
        tenant = connection.scalar(select(models.Project.tenant_id).where(models.Project.id == task.project_id)) if task.project_id else connection.scalar(select(models.User.tenant_id).where(models.User.id == task.created_by_id))
        return Event(tenant_id=str(tenant), resource_type="task", resource_id=task.id, actor_id=task.created_by_id if isinstance(obj, models.Task) and obj in db.new else None,
                     event_type="task.changed", payload={"type": "task.changed", "tenant_id": str(tenant), "task_id": task.id, "action": "invalidate"}) if tenant else None
    if isinstance(obj, (Ticket, TicketComment, TicketParticipant)):
        ticket_id = str(obj.id if isinstance(obj, Ticket) else obj.ticket_id)
        return Event(tenant_id=str(obj.tenant_id), resource_type="ticket", resource_id=ticket_id,
                     event_type="comment" if isinstance(obj, TicketComment) else "ticket.changed",
                     payload={"comment_id": str(obj.id)} if isinstance(obj, TicketComment) else {})
    return None


@event.listens_for(Session, "after_flush")
def capture_changes(db, flush_context):
    connection = db.connection()
    captured = set()
    for obj in list(db.new) + list(db.dirty) + list(db.deleted):
        category = "chat" if isinstance(obj, models.ChatMessage) else "task" if isinstance(obj, TASK_MUTATIONS) else "ticket" if isinstance(obj, (Ticket, TicketComment, TicketParticipant)) else None
        if not category or (category != "ticket" and not durable_enabled(category)):
            continue
        if obj in db.dirty and not db.is_modified(obj, include_collections=False):
            continue
        envelope = describe(db, obj, connection)
        if envelope is None:
            continue
        identity = (envelope.tenant_id, envelope.resource_type, envelope.resource_id, envelope.event_type,
                    envelope.payload.get("message_id") or envelope.payload.get("comment_id"))
        if identity in captured:
            continue
        captured.add(identity)
        if durable_enabled(category):
            enqueue(connection, envelope)
        else:
            stage_after_commit(db, envelope)


@event.listens_for(Session, "after_commit")
def after_commit(db):
    if db.in_nested_transaction():
        return
    for _, envelope in db.info.pop("realtime_after_commit", []):
        try:
            publish(envelope)
        except Exception as exc:
            logger.warning("realtime.post_commit_failed error=%s", type(exc).__name__)


@event.listens_for(Session, "after_rollback")
def after_rollback(db):
    rolled_back = db.get_nested_transaction()
    if rolled_back is None:
        db.info.pop("realtime_after_commit", None)
        return
    def retained(item):
        transaction, _ = item
        while transaction is not None:
            if transaction is rolled_back:
                return False
            transaction = transaction.parent
        return True
    db.info["realtime_after_commit"] = [item for item in db.info.get("realtime_after_commit", []) if retained(item)]


@event.listens_for(Session, "do_orm_execute")
def capture_bulk_task_mutation(state):
    statement = state.statement
    if not (state.is_delete or state.is_update) or getattr(getattr(statement, "table", None), "name", None) != "tasks":
        return
    query = select(func.coalesce(models.Project.tenant_id, models.User.tenant_id)).select_from(models.Task).join(
        models.User, models.User.id == models.Task.created_by_id,
    ).outerjoin(models.Project, models.Project.id == models.Task.project_id)
    if statement.whereclause is not None:
        query = query.where(statement.whereclause)
    connection = state.session.connection()
    for tenant in connection.scalars(query.distinct()):
        if tenant is None:
            continue
        envelope = Event(tenant_id=str(tenant), resource_type="task", resource_id=str(tenant), event_type="task.changed",
                         payload={"type": "task.changed", "tenant_id": str(tenant), "action": "invalidate"})
        if durable_enabled("task"):
            enqueue(connection, envelope)
        else:
            stage_after_commit(state.session, envelope)
